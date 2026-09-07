import { MigrationInterface, QueryRunner } from 'typeorm';

// Agrega a ticket_groups la columna `module_key` (módulo al que el box sirve
// como destino) y un índice único parcial que garantiza que solo haya un box
// ACTIVO por moduleKey.
//
// NOTA sobre el box "Taller": NO se asigna module_key='workshop' aquí para no
// tocar el box real de producción antes de que el mecanismo esté verificado
// (y para permitir probar la desactivación con un box de prueba sin chocar con
// el índice único). La asignación del module_key al box "Taller" es una decisión
// de negocio que se hace desde el Panel de Administración / API una vez
// verificado. Si se prefiere dejarlo en la migración, basta con agregar:
//   UPDATE ticket_groups SET module_key='workshop' WHERE name='Taller' AND active=true;
export class AddModuleKeyToTicketGroups20260904105046 implements MigrationInterface {
  name = 'AddModuleKeyToTicketGroups20260904105046';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ticket_groups" ADD COLUMN IF NOT EXISTS "module_key" character varying(40)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_ticket_groups_module_key_active" ON "ticket_groups" ("module_key") WHERE "active" = true AND "module_key" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_ticket_groups_module_key_active"`);
    await queryRunner.query(`ALTER TABLE "ticket_groups" DROP COLUMN IF EXISTS "module_key"`);
  }
}
