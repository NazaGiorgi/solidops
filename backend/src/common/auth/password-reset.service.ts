import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import * as crypto from 'crypto';
import { PasswordResetToken, ResetTokenOwnerType } from '../../entities/password-reset-token.entity';

// Creates, validates and consumes one-time password reset tokens. Only the SHA-256
// hash is stored; the raw token travels only in the email. Single-use + 1h expiry.
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private static readonly TTL_MS = 60 * 60 * 1000; // 1 hour

  constructor(
    @InjectRepository(PasswordResetToken)
    private readonly tokens: Repository<PasswordResetToken>,
  ) {}

  private hash(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  // Create a new token for the given owner. Invalidates any previous pending
  // (unused) tokens for that owner (single active reset link at a time).
  async create(ownerType: ResetTokenOwnerType, ownerId: string): Promise<string> {
    const raw = crypto.randomBytes(32).toString('base64url');
    const tokenHash = this.hash(raw);
    const expiresAt = new Date(Date.now() + PasswordResetService.TTL_MS);

    // Revoke any unused prior tokens for the same owner.
    await this.tokens.update(
      { ownerType, ownerId, usedAt: IsNull() },
      { usedAt: new Date() },
    );

    await this.tokens.save(
      this.tokens.create({ ownerType, ownerId, tokenHash, expiresAt, usedAt: null }),
    );
    return raw;
  }

  // Validate + consume a token. Returns the owning account id or throws.
  async consume(ownerType: ResetTokenOwnerType, rawToken: string): Promise<string> {
    const tokenHash = this.hash(rawToken);
    const token = await this.tokens.findOne({ where: { ownerType, tokenHash } });
    if (!token) {
      throw new BadRequestException('El enlace de recuperación no es válido');
    }
    if (token.usedAt) {
      throw new BadRequestException('El enlace de recuperación ya fue usado');
    }
    if (token.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('El enlace de recuperación expiró');
    }
    token.usedAt = new Date();
    try {
      await this.tokens.save(token);
    } catch (e) {
      this.logger.error('No se pudo marcar el token como usado', e as Error);
      throw new BadRequestException('El enlace de recuperación no es válido');
    }
    return token.ownerId;
  }
}
