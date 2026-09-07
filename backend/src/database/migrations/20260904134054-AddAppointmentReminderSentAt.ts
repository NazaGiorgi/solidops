import { MigrationInterface, QueryRunner } from 'typeorm';

// Columna de control para el recordatorio de citas de Agenda: `reminder_sent_at`
// marca cuándo se envió (o se intentó enviar) el email de recordatorio al técnico
// asignado, para que el cron de 5 minutos no lo reenvíe en la siguiente corrida.
export class AddAppointmentReminderSentAt20260904134054 implements MigrationInterface {
  name = 'AddAppointmentReminderSentAt20260904134054';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "reminder_sent_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "appointments" DROP COLUMN IF EXISTS "reminder_sent_at"`);
  }
}
