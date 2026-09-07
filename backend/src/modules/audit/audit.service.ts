import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../../entities/audit-log.entity';
import { AuditAction } from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

// Records audit entries. Used both by the global interceptor (auto diffing
// status/priority/assignment) and directly by services for domain actions.
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog) private readonly auditRepo: Repository<AuditLog>,
  ) {}

  async log(entry: {
    user?: AuthenticatedUser | null;
    action: AuditAction;
    entityType: string;
    entityId: string;
    oldValue?: Record<string, unknown> | null;
    newValue?: Record<string, unknown> | null;
    meta?: Record<string, unknown> | null;
  }): Promise<void> {
    try {
      const log = this.auditRepo.create({
        userId: entry.user?.id ?? null,
        userEmail: entry.user?.email ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        oldValue: entry.oldValue ?? null,
        newValue: entry.newValue ?? null,
        meta: entry.meta ?? null,
      });
      await this.auditRepo.save(log);
    } catch (e) {
      // Auditing must never break the main request.
      this.logger.error(`Fallo al auditar: ${(e as Error).message}`);
    }
  }
}
