import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

export interface PortalTokenPayload {
  sub: string; // contact id
  type: 'portal';
  customerId: string | null;
  email: string;
  name: string;
}

// Validates the dedicated portal JWT (type: 'portal'). This token is separate
// from the staff access token, so it's only accepted on portal routes and never
// grants staff privileges. Attaches `req.portalContact`.
@Injectable()
export class PortalGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest();
    const auth = request.headers['authorization'] as string | undefined;
    if (!auth || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token de portal requerido');
    }
    const token = auth.slice(7);
    try {
      const payload = await this.jwt.verifyAsync<PortalTokenPayload>(token, {
        secret: this.config.get<string>('jwt.secret'),
      });
      if (payload.type !== 'portal') {
        throw new UnauthorizedException('Token inválido');
      }
      request.portalContact = {
        id: payload.sub,
        customerId: payload.customerId,
        email: payload.email,
        name: payload.name,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Token de portal inválido o expirado');
    }
  }
}
