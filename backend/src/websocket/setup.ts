import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import Redis from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server } from 'socket.io';

// Socket.IO adapter that backs the gateway with a Redis pub/sub so
// notifications reach all connected clients even across processes/replicas.
// Falls back to in-memory (local adapters) if Redis is unreachable.
class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(app: INestApplication) {
    super(app);
    try {
      const config = app.get(ConfigService);
      const redisUrl = config.get<string>('redis.url') || 'redis://redis:6379';
      // The @socket.io/redis-adapter SUBSCRIBES to channels the moment the
      // adapter is constructed — before Redis has connected. So these clients
      // MUST keep enableOfflineQueue on to buffer that first psubscribe,
      // otherwise the app crashes at startup. We only cap the reconnect backoff
      // so a Redis blip can't lead to a long busy retry loop.
      const redisOpts = {
        retryStrategy: (times: number) => {
          if (times > 10) return null; // give up after ~10 attempts
          return Math.min(times * 200, 5000);
        },
      };
      const pubClient: Redis = new Redis(redisUrl, redisOpts);
      const subClient: Redis = pubClient.duplicate();
      pubClient.on('error', (e: Error) =>
        console.warn('Redis pub error:', e.message),
      );
      subClient.on('error', (e: Error) =>
        console.warn('Redis sub error:', e.message),
      );
      this.adapterConstructor = createAdapter(pubClient, subClient);
    } catch {
      // Fall back to in-memory.
      this.adapterConstructor = undefined;
    }
  }

  createIOServer(port: number, options?: Record<string, unknown>): Server {
    const server: Server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}

export function setupWebSocket(app: INestApplication): void {
  app.useWebSocketAdapter(new RedisIoAdapter(app));
}
