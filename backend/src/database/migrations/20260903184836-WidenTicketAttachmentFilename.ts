import { MigrationInterface, QueryRunner } from 'typeorm';

// Amplía las columnas ticket_attachments.filename y ticket_attachments.mime_type.
//
// - filename:  varchar(255) -> varchar(500)  (margen amplio para nombres largos
//   reales con espacios, paréntesis, prefijos "[EXT]... [Ticket#...]" o
//   URL-encoding tipo UTF-8''...).
//
// - mime_type: varchar(120) -> varchar(500)  (FIX REAL del import: la mime_type
//   que viene de Zammad incluye el parámetro `; name="..."` con el nombre
//   original, y supera fácilmente 120 chars — p.ej. 123, 126, 148 — provocando
//   "value too long for type character varying(120)". Por eso el reintento de
//   adjuntos fallía SIEMPRE aunque el filename fuera corto.)
export class WidenTicketAttachmentFilename20260903184836 implements MigrationInterface {
  name = 'WidenTicketAttachmentFilename20260903184836';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ticket_attachments" ALTER COLUMN "filename" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ticket_attachments" ALTER COLUMN "mime_type" TYPE character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ticket_attachments" ALTER COLUMN "mime_type" TYPE character varying(120)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ticket_attachments" ALTER COLUMN "filename" TYPE character varying(255)`,
    );
  }
}