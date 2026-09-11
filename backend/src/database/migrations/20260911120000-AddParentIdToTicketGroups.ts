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
    await queryRunner.query(
      `ALTER TABLE "ticket_groups" ADD CONSTRAINT IF NOT EXISTS "FK_ticket_groups_parent" FOREIGN KEY ("parent_id") REFERENCES "ticket_groups"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ticket_groups" DROP CONSTRAINT IF EXISTS "FK_ticket_groups_parent"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ticket_groups_parent_id"`);
    await queryRunner.query(`ALTER TABLE "ticket_groups" DROP COLUMN IF EXISTS "parent_id"`);
  }
}