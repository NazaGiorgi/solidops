import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contact } from '../../entities/contact.entity';

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
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
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
      // No confiar solo en claims: una cuenta deshabilitada, eliminada o movida
      // de cliente debe perder acceso aunque su access token siga vigente.
      const contact = await this.contacts.findOne({ where: { id: payload.sub } });
      if (
        !contact ||
        !contact.portalEnabled ||
        !contact.emailVerifiedAt ||
        contact.customerId !== payload.customerId
      ) {
        throw new UnauthorizedException('Acceso de portal no disponible');
      }
      request.portalContact = {
        id: contact.id,
        customerId: contact.customerId,
        email: contact.email ?? '',
        name: contact.name,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Token de portal inválido o expirado');
    }
  }
}
