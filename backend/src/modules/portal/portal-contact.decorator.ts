import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface PortalContact {
  id: string; // contact id
  customerId: string | null; // row-level scope for the portal (null = no vinculada)
  email: string;
  name: string;
}

// Injects the portal contact validated by PortalGuard (req.portalContact).
export const CurrentPortalContact = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): PortalContact => {
    const request = ctx.switchToHttp().getRequest();
    return request.portalContact;
  },
);
