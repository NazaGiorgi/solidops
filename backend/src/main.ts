import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { setupWebSocket } from './websocket/setup';
import { initializeStorage } from './storage/storage.init';

async function bootstrap() {
  // rawBody: el webhook de WhatsApp verifica la firma X-Hub-Signature-256 sobre
  // el body crudo, así que necesitamos req.rawBody (Buffer) en el handler.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: config.get<string[]>('corsOrigins'),
    credentials: true,
    // Exponer Content-Disposition al JS del frontend: el modal de documentos lee
    // el filename del header para proponer el nombre de descarga (con extensión).
    // Sin esto, el fetch cross-origin (3000 -> 4000) no ve `content-disposition`
    // y el frontend guarda como "documento" (sin extensión).
    exposedHeaders: ['Content-Disposition'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const logger = new Logger('Bootstrap');
  try {
    await initializeStorage(config);
  } catch (e) {
    logger.warn(`Storage init warning: ${(e as Error).message}`);
  }

  // Must be applied BEFORE listen so the Socket.IO gateway uses the Redis adapter.
  setupWebSocket(app);

  const port = config.get<number>('port') || 4000;
  await app.listen(port);
  logger.log(`API escuchando en http://localhost:${port}/api`);
}

bootstrap();
