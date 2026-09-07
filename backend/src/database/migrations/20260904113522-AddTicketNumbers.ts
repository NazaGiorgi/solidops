import { MigrationInterface, QueryRunner } from 'typeorm';

// Numera los tickets existentes con el contador global `ticket_number`
// (TK-{año}-{número}). Los tickets migrados de Zammad se numeran 1..N en el
// orden de created_at (cronológico). La secuencia `ticket_number_seq` se setea
// al ID de ticket Zammad más alto ya migrado (para que los nuevos tickets
// continúen desde ahí, no arranquen de 1 ni colisionen con la numeración
// existente).
//
// NOTA: la columna `ticket_number` ya la crea synchronize:true (nullable + índice
// único). Esta migración la puebla, crea la secuencia y la deja NOT NULL.
export class AddTicketNumbers20260904113522 implements MigrationInterface {
  name = 'AddTicketNumbers20260904113522';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) Numerar los tickets existentes en orden cronológico (created_at, id).
    //    Los que ya tengan número (tickets nuevos creados después de un reintento)
    //    no se tocan.
    await queryRunner.query(`
      UPDATE tickets t
      SET ticket_number = sub.rn
      FROM (
        SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
        FROM tickets
        WHERE ticket_number IS NULL
      ) sub
      WHERE t.id = sub.id
    `);

    // 2) Crear la secuencia y setearla al ID de ticket Zammad más alto migrado
    //    (el siguiente nextval devuelve ese máximo + 1). Así la numeración de
    //    nuevos tickets continúa desde el final de la migración de Zammad.
    await queryRunner.query(`CREATE SEQUENCE IF NOT EXISTS ticket_number_seq`);
    await queryRunner.query(`
      SELECT setval('ticket_number_seq', COALESCE(
        (SELECT MAX(CAST(legacy_zammad_id AS integer)) FROM tickets WHERE legacy_zammad_id ~ '^[0-9]+$'),
        (SELECT MAX(ticket_number) FROM tickets)
      ))
    `);

    // 3) La columna deja de aceptar NULL (ya está poblada).
    await queryRunner.query(`ALTER TABLE tickets ALTER COLUMN ticket_number SET NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No es reversible de forma segura (no re-numera ni borra los números).
    // Se deja documentado que revertir requiere limpiar los valores.
    await queryRunner.query(`DROP SEQUENCE IF EXISTS ticket_number_seq`);
  }
}
