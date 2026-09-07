import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Ticket } from '../../entities/ticket.entity';
import {
  SlaStatus,
  ACTIVE_TICKET_STATUSES,
} from '../../common/enums';
import { Task } from '../../entities/task.entity';
import { Appointment } from '../../entities/appointment.entity';
import { Technician } from '../../entities/technician.entity';
import { User } from '../../entities/user.entity';
import { Contract } from '../../entities/contract.entity';
import { SlaService } from '../tickets/sla.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    @InjectRepository(Appointment) private readonly appointments: Repository<Appointment>,
    @InjectRepository(Technician) private readonly technicians: Repository<Technician>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Contract) private readonly contracts: Repository<Contract>,
    private readonly slaService: SlaService,
  ) {}

  // "Mi día": what a technician/coordinator sees on entry.
  async myDay(user: AuthenticatedUser) {
    const userId = user.id;
    const technicianId = user.technicianId;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // Today's appointments (all for the tech, or their own if technician).
    const apptQb = this.appointments
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.customer', 'customer')
      .where('a.start_at BETWEEN :start AND :end', {
        start: todayStart,
        end: todayEnd,
      });
    if (technicianId) apptQb.andWhere('a.technician_id = :techId', { techId: technicianId });
    const appointments = await apptQb.orderBy('a.start_at', 'ASC').getMany();

    // My assigned active tickets.
    const openStatuses = ACTIVE_TICKET_STATUSES;
    const myTicketsQb = this.tickets
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.customer', 'customer')
      .where('t.status IN (:...statuses)', { statuses: openStatuses })
      .andWhere('t.shadow = :sh', { sh: false });
    if (technicianId) {
      myTicketsQb.andWhere('t.technician_id = :techId', { techId: technicianId });
    } else {
      // Coordinators without a technician profile see all active tickets or the
      // ones they created.
      myTicketsQb.andWhere('(t.created_by_user_id = :uid OR t.technician_id IS NOT NULL)', {
        uid: userId,
      });
    }
    const myTickets = await myTicketsQb.orderBy('t.createdAt', 'DESC').getMany();

    // Pending tasks (mine or unassigned)
    const tasks = await this.tasks
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.assignee', 'assignee')
      .where('task.status IN (:...active)', {
        active: ['pendiente', 'en_progreso'],
      })
      .andWhere('(task.assignee_id = :uid OR task.assignee_id IS NULL)', { uid: userId })
      .orderBy('task.dueAt', 'ASC')
      .getMany();

    // Attach SLA status to my tickets.
    const myTicketsWithSla = [];
    for (const t of myTickets) {
      const contract = await this.findContract(t.customerId);
      const { sla, status } = this.slaService.compute(t, contract);
      void sla;
      myTicketsWithSla.push({ ...t, slaStatus: status });
    }

    return { appointments, myTickets: myTicketsWithSla, tasks };
  }

  // General dashboard: supervisor-level aggregate view.
  async general() {
    const [openTickets, criticalTickets, slaAtRisk, techStatuses] =
      await Promise.all([
        this.tickets
          .createQueryBuilder('t')
          .where('t.status IN (:...statuses)', { statuses: ACTIVE_TICKET_STATUSES })
          .andWhere('t.shadow = :sh', { sh: false })
          .getMany(),
        this.tickets
          .createQueryBuilder('t')
          .where('t.status IN (:...statuses)', { statuses: ACTIVE_TICKET_STATUSES })
          .andWhere('t.priority = :p', { p: 'critica' })
          .andWhere('t.shadow = :sh', { sh: false })
          .getMany(),
        this.slaAtRisk(),
        this.technicians
          .createQueryBuilder('tech')
          .leftJoinAndSelect('tech.user', 'user')
          .orderBy('user.name', 'ASC')
          .getMany(),
      ]);

    // Load active contracts for SLA computation.
    const contracts = await this.contracts.find({ where: { active: true } });
    const contractMap = new Map(contracts.map((c) => [c.customerId, c]));

    let openCount = 0;
    let criticalCount = 0;
    let riskCount = 0;
    let redCount = 0;
    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};

    for (const t of openTickets) {
      openCount++;
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
      const contract = t.customerId ? (contractMap.get(t.customerId) ?? null) : null;
      const { sla } = this.slaService.compute(t, contract);
      if (sla.status === SlaStatus.ROJO) redCount++;
      if (sla.status === SlaStatus.AMARILLO) riskCount++;
    }
    for (const t of criticalTickets) criticalCount++;

    // Load per-technician open ticket load.
    const loadByTech: Record<string, number> = {};
    for (const t of openTickets) {
      if (t.technicianId) loadByTech[t.technicianId] = (loadByTech[t.technicianId] || 0) + 1;
    }

    // Non-technician config users are skipped for team status display.
    const techConfigUsers = await this.users
      .createQueryBuilder('u')
      .innerJoin('u.technician', 'tech')
      .getMany();
    void techConfigUsers;

    const team = techStatuses.map((tech) => ({
      technicianId: tech.id,
      name: tech.user?.name ?? '—',
      status: tech.status,
      level: tech.level,
      specialties: tech.specialties,
      load: loadByTech[tech.id] ?? 0,
    }));

    // --- Agenda summary (today's activities + overdue tasks) ---
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    const todayAppts = await this.appointments.find({
      where: { startAt: Between(todayStart, todayEnd) },
      order: { startAt: 'ASC' },
    });
    const agenda = {
      todayAppointments: todayAppts.length,
      upcomingToday: todayAppts.filter((a) => new Date(a.startAt) >= now).length,
      overdueTasks: await this.tasks
        .createQueryBuilder('task')
        .where('task.status IN (:...active)', {
          active: ['pendiente', 'en_progreso'],
        })
        .andWhere('task.due_at IS NOT NULL')
        .andWhere('task.due_at < :now', { now })
        .getCount(),
      dueTodayTasks: await this.tasks
        .createQueryBuilder('task')
        .where('task.status IN (:...active)', {
          active: ['pendiente', 'en_progreso'],
        })
        .andWhere('task.due_at BETWEEN :start AND :end', { start: todayStart, end: todayEnd })
        .getCount(),
    };

    return {
      summary: {
        open: openCount,
        critical: criticalCount,
        slaAtRisk: riskCount,
        slaCritical: redCount,
      },
      byStatus,
      byPriority,
      team,
      agenda,
    };
  }

  private async slaAtRisk(): Promise<number> {
    const tickets = await this.tickets
      .createQueryBuilder('t')
      .where('t.status IN (:...statuses)', { statuses: ACTIVE_TICKET_STATUSES })
      .andWhere('t.shadow = :sh', { sh: false })
      .getMany();
    const contracts = await this.contracts.find({ where: { active: true } });
    const contractMap = new Map(contracts.map((c) => [c.customerId, c]));
    let risk = 0;
    for (const t of tickets) {
      const contract = t.customerId ? (contractMap.get(t.customerId) ?? null) : null;
      const { sla } = this.slaService.compute(t, contract);
      if (sla.status === SlaStatus.AMARILLO || sla.status === SlaStatus.ROJO) risk++;
    }
    return risk;
  }

  private async findContract(customerId: string | null) {
    if (!customerId) return null;
    return this.contracts.findOne({
      where: { customerId, active: true },
      order: { createdAt: 'DESC' },
    });
  }
}
