import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { randomUUID } from 'crypto';

// Thin wrapper around MinIO for object storage (attachments, avatars).
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client: Minio.Client;
  private bucket: string;
  private publicBaseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.bucket =
      config.get<string>('storage.bucket') || 'ops-msp';
    this.publicBaseUrl =
      config.get<string>('storage.publicBaseUrl') || '';
    this.client = new Minio.Client({
      endPoint: config.get<string>('storage.endpoint') || 'minio',
      port: config.get<number>('storage.port') || 9000,
      useSSL: config.get<boolean>('storage.useSSL') || false,
      accessKey: config.get<string>('storage.accessKey') || 'minioadmin',
      secretKey: config.get<string>('storage.secretKey') || 'minioadmin_dev',
    });
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucket();
  }

  async ensureBucket(): Promise<void> {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket);
        this.logger.log(`Bucket creado: ${this.bucket}`);
      }
    } catch (e) {
      // Non-fatal: the app can still start; storage calls will surface errors.
      this.logger.warn(`No se pudo asegurar el bucket: ${(e as Error).message}`);
    }
  }

  async putObject(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    prefix = 'attachments',
  ): Promise<{ url: string; key: string }> {
    const key = `${prefix}/${randomUUID()}-${filename}`;
    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      'Content-Type': mimeType,
    });
    // Public URL suitable for browsers (use publicBaseUrl in prod for CDN).
    const url = `${this.publicBaseUrl}/${this.bucket}/${key}`;
    return { url, key };
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key);
  }

  async getPresignedUrl(key: string, seconds = 3600): Promise<string> {
    return this.client.presignedGetObject(this.bucket, key, seconds);
  }

  // Read an object fully into a Buffer (used to serve previews inline and to
  // feed the Office->PDF converter). Never touches the network share.
  async getObject(key: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  // Stat an object (size, etc.). Throws if not found.
  async statObject(key: string): Promise<{ size: number } | null> {
    try {
      const s = await this.client.statObject(this.bucket, key);
      return { size: s.size };
    } catch {
      return null;
    }
  }

  // Persist a pre-converted preview (e.g. an Office->PDF) alongside the source,
  // keyed per document version so a new version gets its own preview.
  async putObjectAs(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      'Content-Type': mimeType,
    });
  }
}
