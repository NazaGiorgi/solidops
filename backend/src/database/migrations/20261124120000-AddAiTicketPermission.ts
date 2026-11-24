import { MigrationInterface, QueryRunner } from 'typeorm';

// El permiso `ai.ticket` ya está en el mapa canónico de permisos y el seed lo
// aplica cuando RUN_SEED=true. Esta migración cubre el caso de producción con
// el seed apagado: roles ya existentes reciben el permiso sin depender del seed
// y sin alterar ningún otro permiso. Es idempotente.
const ROLES_WITH_AI_TICKET = ['Administrador', 'Supervisor', 'Coordinador', 'Técnico'];

export class AddAiTicketPermission20261124120000 implements MigrationInterface {
  name = 'AddAiTicketPermission20261124120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE roles
       SET permissions = COALESCE(permissions, '[]'::jsonb) || '["ai.ticket"]'::jsonb
       WHERE name = ANY($1::varchar[])
         AND NOT COALESCE(jsonb_exists(permissions, 'ai.ticket'), false)`,
      [ROLES_WITH_AI_TICKET],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE roles
       SET permissions = COALESCE(
         (SELECT jsonb_agg(value)
          FROM jsonb_array_elements(COALESCE(permissions, '[]'::jsonb)) AS value
          WHERE value <> '"ai.ticket"'::jsonb),
         '[]'::jsonb
       )
       WHERE name = ANY($1::varchar[])
         AND COALESCE(jsonb_exists(permissions, 'ai.ticket'), false)`,
      [ROLES_WITH_AI_TICKET],
    );
  }
}
