import { MigrationInterface, QueryRunner } from 'typeorm';

// Tabla de colaboradores de tickets. El responsable sigue siendo
// tickets.technician_id: esta tabla sólo guarda técnicos adicionales, con PK
// compuesta para evitar duplicados.added_by_user_id se conserva con ON DELETE
// SET NULL para no perder el vínculo si se borra un usuario.
export class CreateTicketTechnicians20261124150000 implements MigrationInterface {
  name = 'CreateTicketTechnicians20261124150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ticket_technicians" (
        "ticket_id" uuid NOT NULL,
        "technician_id" uuid NOT NULL,
        "added_by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ticket_technicians" PRIMARY KEY ("ticket_id", "technician_id")
      )
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_ticket_technicians_ticket') THEN
          ALTER TABLE "ticket_technicians" ADD CONSTRAINT "FK_ticket_technicians_ticket"
            FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_ticket_technicians_technician') THEN
          ALTER TABLE "ticket_technicians" ADD CONSTRAINT "FK_ticket_technicians_technician"
            FOREIGN KEY ("technician_id") REFERENCES "technicians"("id") ON DELETE CASCADE;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_ticket_technicians_added_by') THEN
          ALTER TABLE "ticket_technicians" ADD CONSTRAINT "FK_ticket_technicians_added_by"
            FOREIGN KEY ("added_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ticket_technicians_technician" ON "ticket_technicians" ("technician_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "ticket_technicians"`,
    );
  }
}
