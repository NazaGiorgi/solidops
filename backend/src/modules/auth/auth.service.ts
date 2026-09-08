import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as argon2 from '@node-rs/argon2';
import { User } from '../../entities/user.entity';
import { verifyPasswordLazy } from '../../common/auth/password.util';
import { PasswordResetService } from '../../common/auth/password-reset.service';
import { RateLimitService } from '../../common/auth/rate-limit.service';
import { MailService } from '../mail/mail.service';
import { JwtPayload } from '../../common/interfaces/authenticated-user.interface';
import { AuditAction, AuditEntityType } from '../../common/enums';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

// Neutral response for forgot-password regardless of whether the email exists.
const FORGOT_OK = { ok: true };

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly resetTokens: PasswordResetService,
    private readonly mail: MailService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .addSelect('user.legacyArgon2Hash')
      .leftJoinAndSelect('user.role', 'role')
      .where('user.email = :email', { email })
      .getOne();
    if (!user) throw new UnauthorizedException('Credenciales inválidas');
    if (!user.active) throw new UnauthorizedException('Usuario inactivo');

    // Lazy migration: Zammad's Argon2id -> SolidOps bcrypt on first login.
    const ok = await verifyPasswordLazy({
      password,
      bcryptHash: user.passwordHash,
      legacyArgon2Hash: user.legacyArgon2Hash,
      zammadSecret: this.config.get<string>('zammad.applicationSecret') || null,
      onMigrate: async (newHash) => {
        user.passwordHash = newHash;
        user.legacyArgon2Hash = null;
        await this.users.save(user);
      },
    });
    if (!ok) throw new UnauthorizedException('Credenciales inválidas');
    return user;
  }

  private toUserContext(user: User): AuthenticatedUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role?.name ?? '',
      roleId: user.roleId,
      technicianId: user.technicianId ?? null,
      permissions: user.role?.permissions ?? [],
    };
  }

  async login(email: string, password: string, purpose?: string, ip = '127.0.0.1') {
    const normalized = (email || '').toLowerCase().trim();
    // Anti fuerza-bruta: máx. 10 intentos por IP y 5 por IP+email en 15 min.
    // Keys distintas a las de forgot-password para no mezclar contadores.
    await this.rateLimit.check(`login:${ip}`, 10, 900);
    await this.rateLimit.check(`login:${ip}:${normalized}`, 5, 900);

    const user = await this.validateUser(email, password);
    // Éxito: limpiar contadores para que logins legítimos no acumulen.
    await this.rateLimit.reset(`login:${ip}`);
    await this.rateLimit.reset(`login:${ip}:${normalized}`);
    const context = this.toUserContext(user);
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: context.role,
      roleId: user.roleId,
      technicianId: user.technicianId ?? null,
      type: 'access',
    };
    const refreshPayload: JwtPayload = { ...payload, type: 'refresh' };

    // Duración extendida para scripts administrativos (migración, etc.):
    // solo cuando el login lo pide explícitamente (`purpose: 'admin'`) y el
    // usuario es administrador. La sesión normal del navegador (sin `purpose`)
    // sigue con `jwt.expiresIn`.
    const wantsAdmin = purpose === 'admin';
    const isAdmin = /admin/i.test(context.role);
    const accessTtl = wantsAdmin && isAdmin
      ? this.config.get<string>('jwt.adminExpiresIn')
      : this.config.get<string>('jwt.expiresIn');

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get('jwt.secret'),
      expiresIn: accessTtl,
    });
    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: this.config.get('jwt.refreshSecret'),
      expiresIn: this.config.get('jwt.refreshExpiresIn'),
    });

    await this.audit.log({
      user: context,
      action: AuditAction.LOGIN,
      entityType: AuditEntityType.USER,
      entityId: user.id,
      meta: { event: 'login' },
    });

    return { accessToken, refreshToken, user: context };
  }

  async refresh(refreshToken: string) {
    // Note: verifyAsync returns the DECODED payload, which jsonwebtoken decorates
    // with `iat` and `exp`. We must NOT spread that directly into a new sign()
    // while also passing `expiresIn` (the lib forbids both). So we only read
    // `sub`/`type` and rebuild a clean payload, letting `expiresIn` compute `exp`.
    let verified: JwtPayload;
    try {
      verified = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.get('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }
    if (verified.type !== 'refresh') {
      throw new UnauthorizedException('Token inválido');
    }
    const user = await this.users.findOne({
      where: { id: verified.sub },
      relations: { role: true },
    });
    if (!user || !user.active) {
      throw new UnauthorizedException('Usuario inactivo o eliminado');
    }
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        role: user.role?.name ?? '',
        roleId: user.roleId,
        technicianId: user.technicianId ?? null,
        type: 'access',
      },
      {
        secret: this.config.get('jwt.secret'),
        expiresIn: this.config.get('jwt.expiresIn'),
      },
    );
    return { accessToken, user: this.toUserContext(user) };
  }

  async changePassword(
    userId: string,
    current: string,
    next: string,
  ): Promise<void> {
    if (next.length < 8) {
      throw new BadRequestException('La nueva contraseña debe tener al menos 8 caracteres');
    }
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .addSelect('user.legacyArgon2Hash')
      .where('user.id = :id', { id: userId })
      .getOne();
    if (!user) throw new UnauthorizedException('Usuario no encontrado');

    // Accept the current password whether it is bcrypt (native) or Argon2id
    // (migrated, passwordHash still null before the first lazy login).
    let ok: boolean;
    if (user.passwordHash) {
      ok = await bcrypt.compare(current, user.passwordHash);
    } else if (user.legacyArgon2Hash) {
      const secret = this.config.get<string>('zammad.applicationSecret');
      try {
        ok = secret
          ? await argon2.verify(user.legacyArgon2Hash, current, {
              secret: Buffer.from(secret, 'utf8'),
            })
          : await argon2.verify(user.legacyArgon2Hash, current);
      } catch {
        ok = false;
      }
    } else {
      ok = false;
    }
    if (!ok) throw new BadRequestException('Contraseña actual incorrecta');
    user.passwordHash = await bcrypt.hash(next, 10);
    user.legacyArgon2Hash = null;
    await this.users.save(user);
  }

  // Request a password reset for a staff user. Always returns the same neutral
  // response whether or not the email exists (no account enumeration). Rate
  // limited per IP + email. Sends the reset link via the configured SMTP mailbox
  // (or logs it when SMTP is not configured yet).
  async forgotPassword(email: string, ip: string): Promise<typeof FORGOT_OK> {
    const normalized = (email || '').toLowerCase().trim();
    await this.rateLimit.check(RateLimitService.consumerKey(ip), 5, 3600);
    await this.rateLimit.check(RateLimitService.consumerKey(ip, normalized), 3, 3600);

    const user = await this.users.findOne({ where: { email: normalized } });
    if (!user || !user.active) {
      return FORGOT_OK;
    }

    const rawToken = await this.resetTokens.create('user', user.id);
    const frontend = this.config.get<string>('frontendUrl') || 'http://localhost:3000';
    const resetUrl = `${frontend}/reset-password?token=${encodeURIComponent(rawToken)}&type=staff`;
    await this.mail.sendPasswordReset(user.email, resetUrl);

    await this.audit.log({
      user: null,
      action: AuditAction.PASSWORD_RESET_REQUEST,
      entityType: AuditEntityType.USER,
      entityId: user.id,
      meta: { email: user.email },
    });
    return FORGOT_OK;
  }

  // Complete a password reset with a one-time token. Invalidates the lazy
  // Argon2 migration for the account (bcrypt replaces anything legacy).
  async resetPassword(rawToken: string, next: string): Promise<void> {
    if (next.length < 8) {
      throw new BadRequestException('La contraseña debe tener al menos 8 caracteres');
    }
    const userId = await this.resetTokens.consume('user', rawToken);
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('El enlace de recuperación no es válido');

    user.passwordHash = await bcrypt.hash(next, 10);
    user.legacyArgon2Hash = null;
    const saved = await this.users.save(user);

    await this.audit.log({
      user: null,
      action: AuditAction.PASSWORD_RESET,
      entityType: AuditEntityType.USER,
      entityId: saved.id,
      meta: { email: saved.email },
    });
  }
}
