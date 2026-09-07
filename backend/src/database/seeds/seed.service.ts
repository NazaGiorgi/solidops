import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { Role } from '../../entities/role.entity';
import { User } from '../../entities/user.entity';
import { Customer } from '../../entities/customer.entity';
import { Contract } from '../../entities/contract.entity';
import { SystemSettings } from '../../entities/system-settings.entity';
import { RoleName, TechnicianLevel, TechnicianStatus } from '../../common/enums';
import { permissionsForRole } from '../../common/auth/permissions';
import { Technician } from '../../entities/technician.entity';
import { Contact } from '../../entities/contact.entity';
import { Site } from '../../entities/site.entity';

// Creates the baseline system roles, key users, a demo customer and contract so
// the platform is usable end-to-end right after `docker-compose up`.
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Technician) private readonly technicians: Repository<Technician>,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    @InjectRepository(Contract) private readonly contracts: Repository<Contract>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(Site) private readonly sites: Repository<Site>,
    @InjectRepository(SystemSettings) private readonly settings: Repository<SystemSettings>,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get('runSeed') !== true) {
      this.logger.log('Seed omitido (RUN_SEED != true)');
      return;
    }
    try {
      await this.seedRoles();
      await this.seedSettings();
      await this.seedUsers();
      await this.seedDemoCustomer();
      this.logger.log('Seed completado.');
    } catch (e) {
      this.logger.error('Error al sembrar datos: ' + (e as Error).message);
    }
  }

  async seedRoles(): Promise<void> {
    for (const name of Object.values(RoleName)) {
      const perms = permissionsForRole(name);
      const existing = await this.roles.findOne({ where: { name } });
      if (existing) {
        // Keep DB in sync with the canonical map: refresh permissions even if
        // the role already exists (roles are now DB-backed, single source).
        if (JSON.stringify(existing.permissions) !== JSON.stringify(perms)) {
          existing.permissions = perms;
          await this.roles.save(existing);
          this.logger.log(`Rol actualizado: ${name}`);
        }
        continue;
      }
      await this.roles.save(this.roles.create({ name, permissions: perms }));
      this.logger.log(`Rol creado: ${name}`);
    }
  }

  // Seed the singleton system settings row with inline defaults (same values as
  // the previous hardcoded SLA/hours fallback), only if none exists.
  async seedSettings(): Promise<void> {
    const count = await this.settings.count();
    if (count > 0) return;
    const defaultHours = {
      mon: [{ start: '09:00', end: '18:00' }],
      tue: [{ start: '09:00', end: '18:00' }],
      wed: [{ start: '09:00', end: '18:00' }],
      thu: [{ start: '09:00', end: '18:00' }],
      fri: [{ start: '09:00', end: '18:00' }],
    };
    await this.settings.save(
      this.settings.create({
        companyName: 'SolidOps',
        businessHours: defaultHours,
        slaFirstResponseMinutes: 60,
        slaResolutionHours: 8,
        contactEmail: null,
      }),
    );
    this.logger.log('Configuración del sistema creada');
  }

  async seedUsers(): Promise<void> {
    if ((await this.users.count()) > 0) {
      this.logger.log('Usuarios ya existen; seed de usuarios omitido.');
      return;
    }
    const password = 'demo1234'; // documented default; change in production
    const hashed = await bcrypt.hash(password, 10);

    const roleOf = (name: RoleName) =>
      this.roles.findOneOrFail({ where: { name } });

    const specs: Array<{
      name: string;
      email: string;
      role: RoleName;
      tech?: {
        level: TechnicianLevel;
        specialties: string[];
        status: TechnicianStatus;
        schedule: Record<string, unknown>;
      };
    }> = [
      {
        name: 'Ana Supervisor',
        email: 'ana@msp.local',
        role: RoleName.SUPERVISOR,
      },
      {
        name: 'Lucas Coordinador',
        email: 'lucas@msp.local',
        role: RoleName.COORDINADOR,
      },
      {
        name: 'María Técnica',
        email: 'maria@msp.local',
        role: RoleName.TECNICO,
        tech: {
          level: TechnicianLevel.SENIOR,
          specialties: ['redes', 'servidores', 'email'],
          status: TechnicianStatus.DISPONIBLE,
          schedule: { mon: [{ start: '09:00', end: '18:00' }] },
        },
      },
      {
        name: 'Pedro Técnico',
        email: 'pedro@msp.local',
        role: RoleName.TECNICO,
        tech: {
          level: TechnicianLevel.MID,
          specialties: ['soporte-applicaciones', 'impresoras'],
          status: TechnicianStatus.DISPONIBLE,
          schedule: { mon: [{ start: '09:00', end: '18:00' }] },
        },
      },
    ];

    for (const spec of specs) {
      const role = await roleOf(spec.role);
      const user = await this.users.save(
        this.users.create({
          name: spec.name,
          email: spec.email,
          passwordHash: hashed,
          roleId: role.id,
          active: true,
        }),
      );
      if (spec.tech) {
        await this.technicians.save(
          this.technicians.create({
            userId: user.id,
            level: spec.tech.level,
            specialties: spec.tech.specialties,
            status: spec.tech.status,
            schedule: spec.tech.schedule,
          }),
        );
      }
      this.logger.log(`Usuario creado: ${spec.email} / ${password}`);
    }
  }

  async seedDemoCustomer(): Promise<void> {
    if ((await this.customers.count()) > 0) {
      this.logger.log('Clientes ya existen; seed de cliente omitido.');
      return;
    }
    const customer = await this.customers.save(
      this.customers.create({ name: 'Panadería Don Pedro', active: true }),
    );
    await this.contacts.save(
      this.contacts.create({
        customerId: customer.id,
        name: 'Pedro Pérez',
        email: 'pedro.panaderia@example.com',
        phone: '+541112345678',
        whatsapp: '+541112345678',
        preferredChannel: 'email' as never,
      }),
    );
    await this.sites.save(
      this.sites.create({
        customerId: customer.id,
        name: 'Local central',
        address: 'Av. Siempre Viva 123, Buenos Aires',
      }),
    );
    await this.contracts.save(
      this.contracts.create({
        customerId: customer.id,
        name: 'Básico',
        slaFirstResponseMinutes: 60,
        slaResolutionHours: 8,
        businessHours: {
          mon: [{ start: '09:00', end: '18:00' }],
          tue: [{ start: '09:00', end: '18:00' }],
          wed: [{ start: '09:00', end: '18:00' }],
          thu: [{ start: '09:00', end: '18:00' }],
          fri: [{ start: '09:00', end: '18:00' }],
        },
        priorityTier: {
          critica: { first_response_minutes: 15, resolution_hours: 1 },
          alta: { first_response_minutes: 30, resolution_hours: 4 },
        },
      }),
    );
    this.logger.log('Cliente demo y contrato creados.');
  }
}
