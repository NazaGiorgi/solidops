import { MigrationInterface, QueryRunner } from 'typeorm';

// Agrega privacidad a los turnos de Agenda:
//  - is_private (boolean, default false): evento visible solo para quien lo creó.
//  - created_by_user_id (uuid, nullable, FK a users): el usuario que creó el turno.
//    Null para registros históricos (no se puede saber retroactivamente quién los
//    creó); se preserva el comportamiento actual (is_private = false).
export class AddAppointmentPrivacy20260904130812 implements MigrationInterface {
  name = 'AddAppointmentPrivacy20260904130812';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "is_private" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid`,
    );
    // FK a users (con guarda para no duplicar si synchronize ya la creó).
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_appointments_created_by_user') THEN
          ALTER TABLE "appointments" ADD CONSTRAINT "FK_appointments_created_by_user"
            FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "FK_appointments_created_by_user"`,
    );
    await queryRunner.query(`ALTER TABLE "appointments" DROP COLUMN IF EXISTS "created_by_user_id"`);
    await queryRunner.query(`ALTER TABLE "appointments" DROP COLUMN IF EXISTS "is_private"`);
  }
}
