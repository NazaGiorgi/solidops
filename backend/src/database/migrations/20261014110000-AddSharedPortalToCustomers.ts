import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSharedPortalToCustomers20261014110000 implements MigrationInterface {
  name = 'AddSharedPortalToCustomers20261014110000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "shared_portal" boolean NOT NULL DEFAULT false',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "customers" DROP COLUMN IF EXISTS "shared_portal"');
  }
}
