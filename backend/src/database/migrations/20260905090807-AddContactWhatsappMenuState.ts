import { MigrationInterface, QueryRunner } from 'typeorm';

// Estado de la conversación del bot de WhatsApp por contacto. Guarda el estado del
// menú (esperando opción / reintento) y el historial pendiente de backfill al
// ticket cuando se crea. Null si no hay conversación de WhatsApp en curso.
export class AddContactWhatsappMenuState20260905090807 implements MigrationInterface {
  name = 'AddContactWhatsappMenuState20260905090807';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "whatsapp_menu_state" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "contacts" DROP COLUMN IF EXISTS "whatsapp_menu_state"`);
  }
}
