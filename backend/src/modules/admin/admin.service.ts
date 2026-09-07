import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../../entities/role.entity';
import { SystemSettings } from '../../entities/system-settings.entity';
import { RoleName } from '../../common/enums';
import {
  PERMISSIONS,
  ALL_PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
} from '../../common/auth/permissions';
import { AuditAction, AuditEntityType } from '../../common/enums';
import { AuditService } from '../audit/audit.service';
import { SlaService } from '../tickets/sla.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

// Permissions the 'Administrador' role must ALWAYS keep, so an admin can never
// lock themselves (or the whole system) out of managing roles and users.
const ADMIN_MANDATORY: string[] = [
  PERMISSIONS.USERS_READ,
  PERMISSIONS.USERS_CREATE,
  PERMISSIONS.USERS_UPDATE,
  PERMISSIONS.USERS_DELETE,
  PERMISSIONS.AUDIT_READ,
];

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(SystemSettings) private readonly settings: Repository<SystemSettings>,
    private readonly audit: AuditService,
    private readonly sla: SlaService,
  ) {}

  // All known permission codes (sorted), derived from the real code catalog,
  // plus grouping/labels so the UI can render the role editor without hardcoding.
  permissionCatalog() {
    return {
      permissions: ALL_PERMISSIONS,
      groups: PERMISSION_GROUPS,
      labels: PERMISSION_LABELS,
    };
  }

  async listRoles(): Promise<Role[]> {
    return this.roles.find({ order: { name: 'ASC' } });
  }

  // Update a role's permission set. The Administrator role must retain the
  // mandatory admin permissions; the update applies immediately (role is read
  // fresh from DB on each request). Audited.
  async updatePermissions(
    roleId: string,
    permissions: string[],
    actor: AuthenticatedUser,
  ): Promise<Role> {
    const role = await this.roles.findOne({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Rol no encontrado');

    if (role.name === RoleName.ADMINISTRADOR) {
      for (const p of ADMIN_MANDATORY) {
        if (!permissions.includes(p)) {
          throw new BadRequestException(
            'El rol Administrador debe conservar el permiso para gestionar usuarios y ver auditoría',
          );
        }
      }
    }

    // Also validate the input only contains known permission codes.
    const valid = permissions.filter((p) => ALL_PERMISSIONS.includes(p));
    const oldValue = { permissions: role.permissions };

    role.permissions = valid;
    const saved = await this.roles.save(role);

    await this.audit.log({
      user: actor,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.ROLE,
      entityId: saved.id,
      oldValue: oldValue as unknown as Record<string, unknown>,
      newValue: { name: saved.name, permissions: saved.permissions },
      meta: { action: 'role_permissions_updated' },
    });

    return saved;
  }

  // Get the (singleton) system settings; creates defaults if none exist yet.
  async getSettings(): Promise<SystemSettings> {
    const existing = await this.settings.find();
    if (existing.length) return existing[0];
    const created = await this.settings.save(this.settings.create({}));
    return created;
  }

  // Update system settings (name, business hours, SLA fallback, contact email).
  async updateSettings(dto: Partial<SystemSettings>, actor: AuthenticatedUser): Promise<SystemSettings> {
    const existing = await this.getSettings();
    if (dto.companyName !== undefined) existing.companyName = dto.companyName;
    if (dto.businessHours !== undefined) existing.businessHours = dto.businessHours;
    if (dto.slaFirstResponseMinutes !== undefined)
      existing.slaFirstResponseMinutes = dto.slaFirstResponseMinutes;
    if (dto.slaResolutionHours !== undefined)
      existing.slaResolutionHours = dto.slaResolutionHours;
    if (dto.contactEmail !== undefined) existing.contactEmail = dto.contactEmail;
    if (dto.emailAutoResponseEnabled !== undefined)
      existing.emailAutoResponseEnabled = dto.emailAutoResponseEnabled;
    if (dto.emailSender !== undefined) existing.emailSender = dto.emailSender;

    const oldValue = { ...existing } as unknown as Record<string, unknown>;
    const saved = await this.settings.save(existing);

    // Apply SLA/business-hours changes immediately: the next SLA computation
    // without a contract uses these values without a restart.
    await this.sla.refreshDefaults();

    await this.audit.log({
      user: actor,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.SYSTEM_SETTINGS,
      entityId: saved.id,
      oldValue,
      newValue: {
        companyName: saved.companyName,
        slaFirstResponseMinutes: saved.slaFirstResponseMinutes,
        slaResolutionHours: saved.slaResolutionHours,
        businessHours: saved.businessHours,
        contactEmail: saved.contactEmail,
        emailAutoResponseEnabled: saved.emailAutoResponseEnabled,
        emailSender: saved.emailSender,
      } as unknown as Record<string, unknown>,
      meta: { action: 'system_settings_updated' },
    });

    return saved;
  }
}
