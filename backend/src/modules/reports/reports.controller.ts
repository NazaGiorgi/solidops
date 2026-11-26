import { Controller, Get, UseGuards, Query, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ticket } from '../../entities/ticket.entity';
import { Technician } from '../../entities/technician.entity';
import { Contract } from '../../entities/contract.entity';
import { SlaService } from '../tickets/sla.service';
import { RoleName } from '../../common/enums';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('reports')
export class ReportsController {
  constructor(
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectRepository(Technician) private readonly technicians: Repository<Technician>,
    @InjectRepository(Contract) private readonly contracts: Repository<Contract>,
    private readonly slaService: SlaService,
  ) {}

  // Internal reports (supervisors). Excludes shadow-mode tickets.
  // Optional date range filter: ?from=ISO&to=ISO (inclusive, on createdAt).
  @Roles(RoleName.ADMINISTRADOR, RoleName.SUPERVISOR)
  @UseGuards(RolesGuard)
  @Get('summary')
  async summary(@Query('from') from?: string, @Query('to') to?: string) {
    const qb = this.tickets
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.technician', 'tech')
      .leftJoinAndSelect('tech.user', 'techUser')
      .where('t.shadow = :sh', { sh: false });

    // Lazy migration hints from Zammad keep their original createdAt; import has
    // preserved those, so filtering by createdAt is correct for history too.
    let fromDate: Date | null = null;
    let toDate: Date | null = null;
    if (from || to) {
      fromDate = from && !Number.isNaN(Date.parse(from)) ? new Date(from) : null;
      toDate = to && !Number.isNaN(Date.parse(to)) ? new Date(to) : null;
      if (from && !fromDate) throw new BadRequestException('from inválido');
      if (to && !toDate) throw new BadRequestException('to inválido');
      if (fromDate) qb.andWhere('t.createdAt >= :from', { from: fromDate });
      if (toDate) {
        // End of day inclusive.
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        qb.andWhere('t.createdAt <= :to', { to: end });
      }
    }

    const tickets = await qb.getMany();

    // Colaboraciones: conteo aparte, con el MISMO rango de fechas. No se suma
    // a byTechnician (ese sigue midiendo sólo al responsable).
    const collabParams: unknown[] = [];
    let collabRangeSql = '';
    if (fromDate) {
      collabParams.push(fromDate);
      collabRangeSql += ` AND t.created_at >= $${collabParams.length}`;
    }
    if (toDate) {
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      collabParams.push(end);
      collabRangeSql += ` AND t.created_at <= $${collabParams.length}`;
    }
    const collabRows = await this.tickets.query<Array<{ technicianId: string; count: number }>>(
      `SELECT tt.technician_id AS "technicianId", COUNT(DISTINCT tt.ticket_id)::int AS count
       FROM ticket_technicians tt
       JOIN tickets t ON t.id = tt.ticket_id
       WHERE t.shadow = false AND t.deleted_at IS NULL ${collabRangeSql}
       GROUP BY tt.technician_id`,
      collabParams,
    );

    const contracts = await this.contracts.find({ where: { active: true } });
    const contractMap = new Map(contracts.map((c) => [c.customerId, c]));

    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    const techLoad: Record<string, number> = {};
    const slaStatus: Record<string, number> = { verde: 0, amarillo: 0, rojo: 0 };

    for (const t of tickets) {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
      if (t.technicianId) techLoad[t.technicianId] = (techLoad[t.technicianId] || 0) + 1;

      const contract = t.customerId ? (contractMap.get(t.customerId) ?? null) : null;
      const { sla } = this.slaService.compute(t, contract);
      slaStatus[sla.status] = (slaStatus[sla.status] || 0) + 1;
    }

    // Resolve technician ids to names.
    const techs = await this.technicians.find({ relations: { user: true } });
    const nameById = new Map(techs.map((x) => [x.id, x.user?.name ?? '—']));
    const byTechnician: Record<string, number> = {};
    for (const [id, n] of Object.entries(techLoad)) {
      byTechnician[nameById.get(id) ?? id] = n;
    }
    const byTechnicianAsCollaborator: Record<string, number> = {};
    for (const row of collabRows) {
      byTechnicianAsCollaborator[nameById.get(row.technicianId) ?? row.technicianId] = Number(row.count);
    }

    return { byStatus, byPriority, byTechnician, byTechnicianAsCollaborator, slaStatus };
  }
}
