import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';

// Standalone bootstrap hook to ensure the MinIO bucket exists before Nest
// finishes startup. Kept dependency-light so main.ts can call it without
// needing the full Nest DI context.
export async function initializeStorage(config: ConfigService): Promise<void> {
  const bucket = config.get<string>('storage.bucket') || 'ops-msp';
  const client = new Minio.Client({
    endPoint: config.get<string>('storage.endpoint') || 'minio',
    port: config.get<number>('storage.port') || 9000,
    useSSL: config.get<boolean>('storage.useSSL') || false,
    accessKey: config.get<string>('storage.accessKey') || 'minioadmin',
    secretKey: config.get<string>('storage.secretKey') || 'minioadmin_dev',
  });
  const exists = await client.bucketExists(bucket);
  if (!exists) {
    await client.makeBucket(bucket);
  }
}
