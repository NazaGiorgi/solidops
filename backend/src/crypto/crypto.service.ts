import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

// AES-256-GCM encryption for sensitive credentials (mailbox passwords).
// Derives a 32-byte key from ENCRYPTION_SECRET via SHA-256, so the secret is
// never stored directly and the key is stable across restarts.
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(private readonly config: ConfigService) {
    const secret = config.get<string>('encryption.secret');
    if (!secret || secret.length < 16) {
      throw new Error(
        'ENCRYPTION_SECRET no está configurado o es demasiado corto (mínimo 16 caracteres)',
      );
    }
    this.key = createHash('sha256').update(secret).digest();
  }

  // Encrypt a plaintext string -> "iv:authTag:ciphertext" (base64 segments).
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${enc.toString('base64')}`;
  }

  // Decrypt a string produced by encrypt().
  decrypt(payload: string): string {
    const [ivB64, tagB64, dataB64] = payload.split(':');
    if (!ivB64 || !tagB64 || !dataB64) {
      throw new Error('Payload de cifrado inválido');
    }
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }
}
