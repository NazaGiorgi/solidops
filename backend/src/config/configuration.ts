// Normalize a JWT expiry value to be interpreted by jsonwebtoken as SECONDS.
// A bare numeric string like "900" would otherwise be read as milliseconds,
// causing tokens to expire almost instantly. If the value already carries a
// unit (e.g. "900s", "4h", "30m"), leave it untouched.
function normalizeSeconds(value: string): string {
  if (/^\d+$/.test(value)) {
    return value + 's';
  }
  return value;
}

interface EnvConfig {
  port: number;
  nodeEnv: string;
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
  };
  redis: {
    url: string;
    host: string;
    port: number;
  };
  storage: {
    endpoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    bucket: string;
    publicBaseUrl: string;
  };
  jwt: {
    secret: string;
    refreshSecret: string;
    expiresIn: string;
    refreshExpiresIn: string;
    adminExpiresIn: string;
  };
  encryption: {
    secret: string;
  };
  zammad: {
    // Zammad hashes passwords with Argon2id + this application_secret as a
    // "pepper". Migrated legacy_argon2_hash values can only be verified (and
    // lazily re-hashed to bcrypt) by passing this secret to argon2.verify.
    applicationSecret: string | null;
  };
  whatsapp: {
    accessToken: string;
    phoneNumberId: string;
    verifyToken: string;
    appSecret: string;
  };
  // Shared secret required by the (public) inbound-email webhook endpoint. The
  // real ingestion path (IMAP worker) calls EmailService.ingest() in-process and
  // is NOT affected; this only protects the HTTP endpoint `POST /api/email/inbound`.
  inboundEmailSecret: string;
  frontendUrl: string;
  corsOrigins: string[];
  runSeed: boolean;
}

export default (): EnvConfig => {
  const redisHost = process.env.REDIS_HOST || 'redis';
  const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

  return {
    port: parseInt(process.env.PORT || '4000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    database: {
      host: process.env.DB_HOST || 'postgres',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USER || 'ops',
      password: process.env.DB_PASSWORD || 'ops_dev_password',
      name: process.env.DB_NAME || 'ops_msp',
    },
    redis: {
      url: `redis://${redisHost}:${redisPort}`,
      host: redisHost,
      port: redisPort,
    },
    storage: {
      endpoint: process.env.MINIO_ENDPOINT || 'minio',
      port: parseInt(process.env.MINIO_PORT || '9000', 10),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      // Prefer dedicated keys, fall back to the MinIO root service creds.
      accessKey:
        process.env.MINIO_ACCESS_KEY ||
        process.env.MINIO_ROOT_USER ||
        'minioadmin',
      secretKey:
        process.env.MINIO_SECRET_KEY ||
        process.env.MINIO_ROOT_PASSWORD ||
        'minioadmin_dev',
      bucket: process.env.MINIO_BUCKET || 'ops-msp',
      publicBaseUrl:
        process.env.MINIO_PUBLIC_BASE_URL ||
        `http://localhost:${process.env.MINIO_PORT || '9000'}`,
    },
    jwt: {
      secret: process.env.JWT_SECRET || 'change-me-dev-jwt-secret',
      refreshSecret: process.env.JWT_REFRESH_SECRET || 'change-me-dev-jwt-refresh-secret',
      // jsonwebtoken treats a bare numeric string (e.g. "900") as MILLISECONDS.
      // Append 's' so these env values are read as SECONDS as intended.
      expiresIn: normalizeSeconds(process.env.JWT_EXPIRES_IN || '900'),
      refreshExpiresIn: normalizeSeconds(process.env.JWT_REFRESH_EXPIRES_IN || '604800'),
      // Duración extendida para tokens de scripts administrativos (migración,
      // etc.). Se usa solo cuando el login pide `purpose: 'admin'` y el usuario
      // es administrador. La sesión normal del navegador sigue con `expiresIn`.
      adminExpiresIn: normalizeSeconds(process.env.JWT_ADMIN_EXPIRES_IN || '7200'),
    },
    // Key used to derive the AES key that encrypts sensitive credentials.
    encryption: {
      secret:
        process.env.ENCRYPTION_SECRET ||
        process.env.JWT_SECRET ||
        'change-me-dev-encryption-secret',
    },
    // Only present if the import came from Zammad. Empty string -> null.
    zammad: {
      applicationSecret: process.env.ZAMMAD_APPLICATION_SECRET || null,
    },
    whatsapp: {
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
      verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
      appSecret: process.env.WHATSAPP_APP_SECRET || '',
    },
    // Requested via the `X-Inbound-Secret` header. Empty -> the endpoint always
    // rejects (secure-by-default: no secret configured, no access).
    inboundEmailSecret: process.env.INBOUND_EMAIL_SECRET || '',
    // Base URL of the web frontend used to build password-reset links.
    frontendUrl:
      process.env.FRONTEND_URL ||
      process.env.CORS_ORIGINS?.split(',')[0]?.trim() ||
      'http://localhost:3000',
    corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    runSeed: process.env.RUN_SEED === 'true',
  };
};
