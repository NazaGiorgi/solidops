import { MigrationInterface, QueryRunner } from 'typeorm';

// Agrega a tickets la columna `last_activity_at` (nullable): la fecha del último
// evento de actividad RELEVANTE (mensaje de staff/cliente por email, WhatsApp o
// portal, cambio de estado, asignación o movimiento de box). Es la fuente del
// "hace cuánto" de cada fila del listado.
//
// No se puede usar `updated_at` para esto: TypeORM solo lo pisa cuando se
// RE-guarda la fila del ticket, y al recibir un mensaje de cliente sobre un
// hilo abierto (WhatsApp/email/portal) el ticket NO se vuelve a salvar — así
// que el último mensaje del cliente jamás movería `updated_at`.
//
// Backfill idempotente: para los tickets existentes se toma el último mensaje
// (MAX ticket_messages.created_at), y si el ticket no tiene mensajes se cae a
// updated_at y luego a created_at. El WHERE last_activity_at IS NULL hace que
// re-correr la migración no pise valores ya asignados (synchronize puede haber
// creado la columna antes o el runner puede ejecutarse dos veces).
export class AddLastActivityAtToTickets20261008120000 implements MigrationInterface {
  name = 'AddLastActivityAtToTickets20261008120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "last_activity_at" timestamptz`,
    );
    await queryRunner.query(`
      UPDATE "tickets" t
      SET "last_activity_at" = COALESCE(
        (SELECT MAX(m."created_at") FROM "ticket_messages" m WHERE m."ticket_id" = t."id"),
        t."updated_at",
        t."created_at"
      )
      WHERE t."last_activity_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tickets" DROP COLUMN IF EXISTS "last_activity_at"`);
  }
}