// The shape of data we attach to req.user after successful JWT validation.
export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: string; // role name, e.g. 'Técnico'
  roleId: string;
  technicianId?: string | null; // present only if linked to a Technician profile
  permissions: string[]; // distinct permission codes derived from the role
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  roleId: string;
  technicianId?: string | null;
  type: 'access' | 'refresh';
}
