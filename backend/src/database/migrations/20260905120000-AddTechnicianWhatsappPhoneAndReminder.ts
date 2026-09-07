import { MigrationInterface, QueryRunner } from 'typeorm';

// Recordatorios de turnos por WhatsApp para técnicos:
//  1) technicians.whatsapp_phone  — número de WhatsApp del técnico (solo dígitos).
//     Se guarda en el perfil de técnico (no en users) porque es un dato operativo
//     de despacho, igual que Contact.whatsapp del lado cliente.
//  2) appointments.whatsapp_reminder_sent_at — control independiente del email:
//     si WhatsApp falla (plantilla no aprobada / sin teléfono), el cron puede
//     reintentarlo en el siguiente ciclo sin volver a mandar el email.
export class AddTechnicianWhatsappPhoneAndReminder20260905120000 implements MigrationInterface {
  name = 'AddTechnicianWhatsappPhoneAndReminder20260905120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "technicians" ADD COLUMN IF NOT EXISTS "whatsapp_phone" VARCHAR(40)`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "whatsapp_reminder_sent_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "appointments" DROP COLUMN IF EXISTS "whatsapp_reminder_sent_at"`);
    await queryRunner.query(`ALTER TABLE "technicians" DROP COLUMN IF EXISTS "whatsapp_phone"`);
  }
}