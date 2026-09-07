// Declaración de tipos mínima para mailparser (sin @types en node_modules).
declare module 'mailparser' {
  export interface ParsedAttachment {
    filename?: string;
    content?: Buffer | string;
    contentType?: string;
    contentDisposition?: string;
    cid?: string;
    contentId?: string;
    size?: number;
    transferEncoding?: string;
  }
  export interface ParsedMail {
    text?: string;
    html?: string | false;
    subject?: string;
    from?: unknown;
    to?: unknown;
    attachments?: ParsedAttachment[];
    messageId?: string;
    date?: Date;
  }
  export function simpleParser(
    source: Buffer | string,
    options?: Record<string, unknown>,
  ): Promise<ParsedMail>;
  export class MailParser {
    on(event: string, cb: (...args: unknown[]) => void): void;
    write(data: Buffer | string): void;
    end(data?: Buffer | string): void;
  }
}
