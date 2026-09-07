import { Injectable, Logger } from '@nestjs/common';
import { ImapFlow } from 'imapflow';

export interface ImapConnectOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  ssl: boolean;
}

// Thin wrapper around ImapFlow. Used both to verify credentials (test button)
// and by the mailbox worker to read mail.
@Injectable()
export class ImapService {
  private readonly logger = new Logger(ImapService.name);

  // Open a connection, run `fn(client)`, always close afterwards. Throws on
  // connection/auth failure so callers can surface a friendly error.
  async withClient<T>(
    opts: ImapConnectOptions,
    fn: (client: ImapFlow) => Promise<T>,
    peek: boolean,
  ): Promise<T> {
    const client = new ImapFlow({
      host: opts.host,
      port: opts.port,
      secure: opts.ssl,
      auth: { user: opts.user, pass: opts.password },
      logger: false,
    });
    try {
      await client.connect();
      const result = await fn(client);
      return result;
    } finally {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    }
  }

  // Verify that the IMAP credentials are valid. Returns true/false or throws
  // with a descriptive message. Logs the underlying server error (not just a
  // generic "Command failed") so field issues are diagnosable without guessing.
  async testConnection(opts: ImapConnectOptions): Promise<{ ok: boolean; message: string }> {
    try {
      await this.withClient(opts, async () => true, true);
      return { ok: true, message: 'conexión exitosa' };
    } catch (e) {
      const err = e as Error & { responseCode?: string; code?: string; source?: string };
      const detail =
        err.responseCode ||
        err.code ||
        err.source ||
        err.message ||
        'error desconocido';
      this.logger.warn(
        `IMAP test falló (${opts.host}:${opts.port}/${opts.user}): ${detail}`,
      );
      if (err.stack) this.logger.debug(err.stack);
      return { ok: false, message: detail };
    }
  }
}
