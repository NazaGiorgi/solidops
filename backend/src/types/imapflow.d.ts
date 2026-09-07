// Ambient declaration for imapflow. The package ships `lib/imap-flow.d.ts` but
// TypeScript's CommonJS module resolution sometimes fails to find it (the
// package uses conditional exports). Declaring the module type here lets the
// code compile regardless, surfacing the public API subset we use.
declare module 'imapflow' {
  export interface ImapFlowOptions {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
    logger?: boolean;
    tls?: Record<string, unknown>;
  }

  export interface FetchMessageObject {
    uid: number;
    envelope?: Record<string, unknown>;
    [key: string]: unknown;
  }

  export interface MailboxLock {
    release(): Promise<void>;
  }

  export interface MailboxObject {
    path: string;
    uidValidity?: number;
    uidNext?: number;
    exists?: number;
    messages?: number;
  }

  export interface SearchObject {
    since?: Date;
    unseen?: boolean;
    seen?: boolean;
    all?: boolean;
    from?: string;
    subject?: string;
    [key: string]: unknown;
  }

  export interface FetchQueryObject {
    uid?: number | number[];
    seq?: number;
    [key: string]: unknown;
  }

  export class ImapFlow {
    mailbox: MailboxObject;
    constructor(options: ImapFlowOptions);
    connect(): Promise<void>;
    logout(): Promise<void>;
    close(): Promise<void>;
    getMailboxLock(path: string): Promise<MailboxLock>;
    search(query: SearchObject, options?: { uid?: boolean }): Promise<false | number[]>;
    fetch(
      range: FetchQueryObject,
      query: Record<string, unknown>,
      options?: { uid?: boolean },
    ): AsyncIterable<FetchMessageObject>;
  }
}
