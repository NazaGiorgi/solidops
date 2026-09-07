import { MigrationInterface, QueryRunner } from 'typeorm';

// Registro de cuenta en el portal con auto-vínculo por dominio.
//
//  1. `contacts.customer_id` pasa a ser opcional: un usuario del portal que se
//     registra con dominio personal (o sin vínculo) nace "sin empresa" y queda
//     en la bandeja de staff hasta asociarlo.
//  2. Columnas de verificación de email en `contacts` (email_verified_at,
//     hash del token con expiración). La cuenta no puede loguearse al portal
//     hasta verificar.
//  3. Tabla `customer_domains`: dominios de correo por empresa (una empresa
//     puede tener varios). El vínculo automático corre en la confirmación del
//     email.
//  4. Backfill: las cuentas de portal existentes (con contraseña) se marcan
//     como verificadas; los dominios de los emails de contactos actuales se
//     cargan en `customer_domains`, EXCLUYENDO dominios personales y las
//     empresas duplicadas conocidas (Solidocs/SolidoCS/Cliente solidocs.com.ar
//     y Hierrosmercedes/Hierros Mercedes) hasta que se resuelva cuál es la
//     oficial. En caso de colisión de dominio, gana la primera fila.
export class AddPortalRegistration20260907120000 implements MigrationInterface {
  name = 'AddPortalRegistration20260907120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) Un contacto de portal puede nacer sin empresa.
    await queryRunner.query(`ALTER TABLE contacts ALTER COLUMN customer_id DROP NOT NULL`);

    // 2) Verificación de email para cuentas nuevas del portal.
    await queryRunner.query(`ALTER TABLE contacts ADD COLUMN email_verified_at timestamptz`);
    await queryRunner.query(`ALTER TABLE contacts ADD COLUMN email_verification_token_hash varchar(64)`);
    await queryRunner.query(`ALTER TABLE contacts ADD COLUMN email_verification_expires_at timestamptz`);
    await queryRunner.query(`CREATE INDEX idx_contacts_email_verification_token ON contacts (email_verification_token_hash)`);

    // 3) Dominios por empresa.
    await queryRunner.query(`
      CREATE TABLE customer_domains (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        domain varchar(255) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX uq_customer_domains_domain ON customer_domains (domain)`);
    await queryRunner.query(`CREATE INDEX idx_customer_domains_customer_id ON customer_domains (customer_id)`);

    // 4) Cuentas de portal existentes (con contraseña) = ya verificadas.
    await queryRunner.query(`
      UPDATE contacts SET email_verified_at = now()
      WHERE portal_password_hash IS NOT NULL OR legacy_argon2_hash IS NOT NULL
    `);

    // 5) Backfill de customer_domains desde los emails de los contactos vigentes.
    //    Se excluyen los dominios personales y las empresas duplicadas conocidas.
    await queryRunner.query(`
      INSERT INTO customer_domains (id, customer_id, domain, created_at)
      SELECT gen_random_uuid(), d.customer_id, d.dom, now()
      FROM (
        SELECT DISTINCT customer_id, LOWER(SPLIT_PART(email, '@', 2)) AS dom
        FROM contacts
        WHERE deleted_at IS NULL
          AND email IS NOT NULL
          AND POSITION('@' IN email) > 1
          AND POSITION('.' IN SPLIT_PART(email, '@', 2)) > 0
      ) d
      WHERE d.customer_id NOT IN (
        'd4c953e1-8b11-49e9-ab93-2b843ace2603', -- Solidocs
        'aa9d0ed9-0b6d-43eb-ab97-be83e05df644', -- SolidoCS
        'bd38502e-8cb6-4b39-9343-0c4b119b6e9e', -- Cliente solidocs.com.ar
        '16a4a45a-dbaa-484c-a43c-23210e8628ba', -- Hierrosmercedes
        '2d535bb2-7d63-4cec-a393-8fb9a685d2a6'  -- Hierros Mercedes
      )
        AND d.dom NOT IN (
          'gmail.com', 'gmail.com.ar', 'googlemail.com', 'hotmail.com', 'hotmail.com.ar',
          'hotmail.es', 'outlook.com', 'outlook.com.ar', 'outlook.es', 'live.com',
          'live.com.ar', 'msn.com', 'yahoo.com', 'yahoo.com.ar', 'yahoo.com.mx',
          'icloud.com', 'me.com', 'mac.com', 'aol.com', 'protonmail.com', 'proton.me',
          'zoho.com', 'yopmail.com', 'fibertel.com.ar', 'speedy.com.ar',
          'telecentro.com.ar', 'arnet.com.ar', 'ciudad.com.ar'
        )
      ON CONFLICT (domain) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS customer_domains`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_contacts_email_verification_token`);
    await queryRunner.query(`ALTER TABLE contacts DROP COLUMN IF EXISTS email_verified_at`);
    await queryRunner.query(`ALTER TABLE contacts DROP COLUMN IF EXISTS email_verification_token_hash`);
    await queryRunner.query(`ALTER TABLE contacts DROP COLUMN IF EXISTS email_verification_expires_at`);
    // No se restaura NOT NULL en customer_id: con cuentas huérfanas es seguro
    // dejar la columna nullable (documentado).
  }
}