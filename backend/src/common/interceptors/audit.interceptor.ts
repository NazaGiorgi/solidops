import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from '../../modules/audit/audit.service';
import { AuditAction, AuditEntityType } from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

// Transversal audit interceptor.
//
// For every HTTP request that returns the result of a service method on a
// supported entity, it records a row. The service layer already emits
// rich `status_change` / `priority_change` / `assignment_change` events via
// AuditService; this interceptor captures the generic create/update for
// entities the services annotate. To keep it simple and not duplicate rows,
// we only audit here the requests the services didn't already audit (guarded
// by a service-level flag). Most domain auditing is done in services.
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  private readonly selfAuditedResources = new Set<string>([
    // Entities whose service already emits rich audit rows (with real
    // old/new values) via AuditService: ticket status/priority/assignment,
    // user create/update/deactivate, technician presence, customer/contact/
    // site/contract CRUD, appointment/task CRUD. For these, the generic
    // interceptor row is redundant and carries null/null values, so we skip it
    // to avoid noisy, empty entries and keep a single consistent audit trail.
    'tickets',
    'users',
    'roles',
    'technicians',
    'customers',
    'contacts',
    'sites',
    'contracts',
    'appointments',
    'tasks',
    'mailboxes',
    'mailbox-rules',
  ]);

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = ctx.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = request.user;
    if (!user) return next.handle();

    const method = request.method;
    const entityType = this.resolveEntityType(request.route?.path || '');
    const entityId: string | undefined = request.params?.id;

    // Only intercept mutating verbs on a clearly-identified entity.
    const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    if (!mutating || !entityType || !entityId) return next.handle();

    // The entity's service self-audits its changes with real values, so the
    // interceptor must not double-log.
    const resource = this.resourceOf(request.route?.path || '');
    if (resource && this.selfAuditedResources.has(resource)) return next.handle();

    const action = this.mapAction(method);

    return next.handle().pipe(
      tap(() => {
        void this.audit.log({
          user,
          action,
          entityType,
          entityId,
          meta: { method, path: request.route?.path, bodyKey: Object.keys(request.body ?? {}) },
        });
      }),
    );
  }

  private resourceOf(path: string): string | null {
    const segments = path.replace('/api', '').split('/').filter(Boolean);
    return segments[0] ?? null;
  }

  private mapAction(method: string): AuditAction {
    switch (method) {
      case 'POST':
        return AuditAction.CREATE;
      case 'DELETE':
        return AuditAction.DELETE;
      default:
        return AuditAction.UPDATE;
    }
  }

  private resolveEntityType(path: string): string | null {
    const segments = path.replace('/api', '').split('/').filter(Boolean);
    if (segments.length < 2) return null;
    const resource = segments[0];
    const known: Record<string, string> = {
      users: AuditEntityType.USER,
      roles: AuditEntityType.ROLE,
      technicians: AuditEntityType.TECHNICIAN,
      customers: AuditEntityType.CUSTOMER,
      contacts: AuditEntityType.CONTACT,
      sites: AuditEntityType.SITE,
      contracts: AuditEntityType.CONTRACT,
      tickets: AuditEntityType.TICKET,
      appointments: AuditEntityType.APPOINTMENT,
      tasks: AuditEntityType.TASK,
      notifications: AuditEntityType.NOTIFICATION,
      mailboxes: AuditEntityType.MAILBOX,
      'mailbox-rules': AuditEntityType.MAILBOX_RULE,
    };
    return known[resource] ?? null;
  }
}
