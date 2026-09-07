// Dominios de proveedores de correo personales/gratuitos que NUNCA se usan
// para el matching por dominio de clientes (dos empresas distintas pueden
// tener contactos con @gmail.com sin ser la misma empresa).
export const PERSONAL_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'gmail.com.ar',
  'googlemail.com',
  'hotmail.com',
  'hotmail.com.ar',
  'hotmail.es',
  'outlook.com',
  'outlook.com.ar',
  'outlook.es',
  'live.com',
  'live.com.ar',
  'msn.com',
  'yahoo.com',
  'yahoo.com.ar',
  'yahoo.com.mx',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'zoho.com',
  'yopmail.com',
  'fibertel.com.ar',
  'speedy.com.ar',
  'telecentro.com.ar',
  'arnet.com.ar',
  'ciudad.com.ar',
]);

// Extrae el dominio (todo lo que va después de '@') en minúsculas, o null si
// el email no es válido / no tiene parte de dominio.
export function extractEmailDomain(email: string): string | null {
  const at = email.indexOf('@');
  if (at <= 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain.length > 0 ? domain : null;
}

// ¿El dominio es personal/gratuito (debe excluirse del matching por dominio)?
export function isPersonalEmailDomain(domain: string): boolean {
  return PERSONAL_EMAIL_DOMAINS.has(domain.toLowerCase());
}
