import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
export interface PermissionsMeta {
  permissions: string[];
  message?: string;
}

// Declares required permission codes on a route/controller for RBAC. Accepts a
// trailing { message } object so the 403 body can carry a route-specific reason.
export const Permissions = (...args: (string | { message?: string })[]) => {
  const last = args[args.length - 1];
  const message = last && typeof last === 'object' && 'message' in last ? last.message : undefined;
  const permissions = (message ? args.slice(0, -1) : args) as string[];
  const meta: PermissionsMeta = { permissions };
  if (message) meta.message = message;
  return SetMetadata(PERMISSIONS_KEY, meta);
};
