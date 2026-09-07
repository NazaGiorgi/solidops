import { MigrationInterface, QueryRunner } from 'typeorm';

// Crea el catálogo de boxes (ticket_groups) y lo puebla con todos los valores
// únicos ya existentes en tickets.legacy_group (L1, L2, L3, Users, Taller,
// Ventas, Backups MK, Mesa de ayuda, etc.), para no perder ni renombrar ningún
// grupo migrado. No toca tickets (tickets.legacy_group sigue siendo string; se
// valida contra este catálogo). INSERT ... ON CONFLICT DO NOTHING es idempotente.
//
// NOTA de entorno: el backend usa synchronize:true en dev, así que la tabla
// suele crearse sola al añadir la entidad. Esta migración usa CREATE TABLE IF
// NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS para ser segura en ambos
// escenarios (dev synchronize o producción con migraciones), y hace el seed.
export class CreateTicketGroupsMigrateToBoxes20260904081632 implements MigrationInterface {
  name = 'CreateTicketGroupsMigrateToBoxes20260904081632';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ticket_groups" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(80) NOT NULL,
        "color" character varying(20),
        "sort_order" integer NOT NULL DEFAULT 0,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ticket_groups" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ticket_groups_name" UNIQUE ("name")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ticket_groups_name" ON "ticket_groups" ("name")
    `);
    // Seed: cada valor único de tickets.legacy_group se convierte en un box
    // activo. ON CONFLICT DO NOTHING para no duplicar si ya existe.
    await queryRunner.query(`
      INSERT INTO "ticket_groups" ("name", "color", "sort_order", "active", "created_at", "updated_at")
      SELECT DISTINCT t.legacy_group, NULL, 0, true, now(), now()
      FROM "tickets" t
      WHERE t.legacy_group IS NOT NULL
      ON CONFLICT ("name") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Volver atrás es destructivo (quita el catálogo y cualquier box creado
    // después): recomendado sólo en un entorno de prueba.
    await queryRunner.query(`DROP TABLE IF EXISTS "ticket_groups"`);
  }
}
