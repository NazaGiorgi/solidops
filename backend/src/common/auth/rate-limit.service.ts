import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { HttpException, HttpStatus } from '@nestjs/common';

// Minimal Redis-backed rate limiter for sensitive public endpoints (e.g.
// forgot-password). Falls back to in-memory counting if Redis is unavailable,
// so the flow never hard-fails in dev/staging. Throws a 429 when a key exceeds
// its limit within the window.
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly redis: Redis | null;
  private readonly memory = new Map<string, { count: number; resetAt: number }>();

  constructor(config: ConfigService) {
    const url = config.get<string>('redis.url');
    let redis: Redis | null = null;
    try {
      if (url) {
        redis = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 1, enableOfflineQueue: false });
        redis.on('error', (e) => this.logger.warn(`redis rate-limit: ${e.message}`));
      }
    } catch {
      redis = null;
    }
    this.redis = redis;
    if (!redis) this.logger.warn('Redis no disponible; rate limit en memoria');
  }

  // Returns a normalized consumer key from an IP + optional account key.
  static consumerKey(ip: string, extra = ''): string {
    return `forgot:${ip}${extra ? ':' + extra : ''}`;
  }

  // Check and increment. `limit` max hits per `windowSec`. Throws on overflow.
  async check(key: string, limit: number, windowSec: number): Promise<void> {
    if (this.redis) {
      try {
        const count = await this.redis.incr(key);
        if (count === 1) await this.redis.expire(key, windowSec);
        if (count > limit) throw new HttpException('Demasiadas solicitudes, intentá más tarde', HttpStatus.TOO_MANY_REQUESTS);
        return;
      } catch (e) {
        if (e instanceof HttpException && e.getStatus() === HttpStatus.TOO_MANY_REQUESTS) throw e;
        // Redis hiccup: fall through to memory.
        this.logger.warn(`redis incr falló: ${(e as Error).message}`);
      }
    }

    const now = Date.now();
    let entry = this.memory.get(key);
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + windowSec * 1000 };
      this.memory.set(key, entry);
    }
    entry.count++;
    if (entry.count > limit) throw new HttpException('Demasiadas solicitudes, intentá más tarde', HttpStatus.TOO_MANY_REQUESTS);
  }

  // Clear a key after a successful reset (so the same IP/account can request again).
  async reset(key: string): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.del(key);
        return;
      } catch {
        /* ignore */
      }
    }
    this.memory.delete(key);
  }
}
