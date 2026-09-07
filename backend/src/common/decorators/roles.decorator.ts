import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
// Declares which role names can access a route/controller.
// Guard logic: if the metadata is absent, any authenticated role is allowed
// (subject to existing guards). If present, the user's role must be in the list.
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
