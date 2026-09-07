import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { PERMISSIONS_KEY, PermissionsMeta } from './permissions-key.decorator';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

// RBAC guard.
// - If the @Permissions() metadata is set, the user must hold at least one of
//   those permission codes.
// - Else if the @Roles() metadata is set, the user's role name must be in the list.
// - Else, any authenticated user is allowed.
// The 403 body always carries a clear message: a route-specific one if declared
// via the trailing @Permissions message option, otherwise a generic (localized)
// message, so any API consumer shows meaningful feedback without re-translating.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permMeta = this.reflector.getAllAndOverride<PermissionsMeta>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If neither is declared, allow (subject to JWT guard).
    if (!permMeta && !requiredRoles) return true;

    const user: AuthenticatedUser = context.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('No autenticado');

    const permMsg =
      permMeta?.message ?? 'No tenés permiso para realizar esta acción';

    if (permMeta) {
      const has = permMeta.permissions.some((p) => user.permissions.includes(p));
      if (!has) throw new ForbiddenException(permMsg);
    }

    if (requiredRoles) {
      const inRole = requiredRoles.includes(user.role);
      if (!inRole) throw new ForbiddenException(permMsg);
    }

    return true;
  }
}
