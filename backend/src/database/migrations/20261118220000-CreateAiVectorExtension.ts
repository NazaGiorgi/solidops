import { MigrationInterface, QueryRunner } from 'typeorm';

// pgvector se habilita con SQL crudo: TypeORM/synchronize no conoce el tipo
// `vector` y no debe intentar crear ni alterar columnas de ese tipo.
// El mismo DDL idempotente se ejecuta en AiService.onModuleInit para que la
// extensión exista aunque las migraciones no se ejecuten automáticamente.
export class CreateAiVectorExtension20261118220000 implements MigrationInterface {
  name = 'CreateAiVectorExtension20261118220000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No dropeamos la extensión: puede ser usada por otras tablas/funciones.
    await queryRunner.query(`SELECT 1`);
  }
}
