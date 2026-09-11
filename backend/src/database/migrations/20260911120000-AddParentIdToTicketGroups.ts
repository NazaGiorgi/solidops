import { MigrationInterface, QueryRunner } from 'typeorm';

// Agrega a ticket_groups la columna `parent_id` (nullable) para permitir boxes
// anidados: un box "contenedor" puede tener otros boxes adentro, y parent_id NULL
// = nivel superior (bajo el ítem "Tickets" del sidebar). Es un FK self-referencial
// con ON DELETE SET NULL (desactivar un box no deja huérfano a su box padre);
// el índice acelera los árboles (hijos por padre) y la validación de ciclos.
//
// No se reasigna ningún ticket: la jerarquía es solo del catálogo; la pertenencia
// de tickets sigue siendo tickets.legacy_group = box.name, y no se toca.
export class AddParentIdToTicketGroups20260911120000 implements MigrationInterface {
  name = 'AddParentIdToTicketGroups20260911120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ticket_groups" ADD COLUMN IF NOT EXISTS "parent_id" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ticket_groups_parent_id" ON "ticket_groups" ("parent_id")`,
    );
    // Postgres NO soporta IF NOT EXISTS en ADD CONSTRAINT (solo en ADD COLUMN /
    // CREATE INDEX). Se verifica en information_schema si ya existe un FOREIGN KEY
    // sobre parent_id (con cualquier nombre, p.ej. el que genera synchronize) y
    // solo entonces se crea el nuestro. Así la migración es idempotente: corre en
    // dev (FK autogenerado) y en prod limpio sin duplicar constraints.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
           AND tc.constraint_schema = kcu.constraint_schema
           AND tc.table_schema = kcu.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema = current_schema()
            AND tc.table_name = 'ticket_groups'
            AND kcu.column_name = 'parent_id'
        ) THEN
          ALTER TABLE "ticket_groups"
            ADD CONSTRAINT "FK_ticket_groups_parent"
            FOREIGN KEY ("parent_id") REFERENCES "ticket_groups"("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ticket_groups" DROP CONSTRAINT IF EXISTS "FK_ticket_groups_parent"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ticket_groups_parent_id"`);
    await queryRunner.query(`ALTER TABLE "ticket_groups" DROP COLUMN IF EXISTS "parent_id"`);
  }
}