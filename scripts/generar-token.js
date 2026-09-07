#!/usr/bin/env node
/**
 * Genera un JWT de sesión para usar con scripts administrativos
 * (ej. scripts/migrar-documentos.js --token <JWT>).
 *
 * El JWT de la app vive en una cookie httpOnly (no accesible desde el navegador),
 * así que este script obtiene uno llamando al MISMO endpoint de login del sistema.
 *
 * Uso:
 *   node scripts/generar-token.js --email info@solidocs.com.ar
 *   node scripts/generar-token.js --email info@solidocs.com.ar --password '...'
 *   node scripts/generar-token.js                          # pide email y contraseña
 *
 * Argumentos:
 *   --api       base URL (default http://localhost:4000)
 *   --email     email del usuario (si no, se pide)
 *   --password  contraseña (si no, se pide OCCULTA — no queda en el historial)
 *   --roles     roles permitidos (default 'Administrador,Supervisor')
 *   --admin     solicita un accessToken con duración extendida (JWT_ADMIN_EXPIRES_IN,
 *               default 2h) — solo válido si el usuario es Administrador. Pensado
 *               para migraciones largas (documentos). La sesión del navegador no se
 *               ve afectada.
 */
const readline = require('readline');

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const API = (arg('--api') || 'http://localhost:4000').replace(/\/$/, '');
const ALLOWED = (arg('--roles') || 'Administrador,Supervisor').split(',').map((s) => s.trim()).filter(Boolean);

function askHidden(prompt, stream) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: stream, terminal: true });
    const onData = (char) => {
      // Reemplazar la entrada con asteriscos y no mostrar el carácter real.
      stream.write('*');
      if (char === '\r' || char === '\n') { stream.write('\n'); }
    };
    process.stdin.on('data', onData);
    rl.question(prompt, (answer) => {
      process.stdin.off('data', onData);
      rl.close();
      resolve(answer);
    });
  });
}

const question = (prompt) => new Promise((resolve) => readline.createInterface({ input: process.stdin, output: process.stdout }).question(prompt, resolve));

async function main() {
  const email = arg('--email') || (await question('Email: '));
  const password = arg('--password') || (await askHidden('Contraseña: '));
  const rolesArg = arg('--roles');
  const admin = args.includes('--admin') || args.includes('--purpose-admin');

  const body = { email, password };
  if (admin) body.purpose = 'admin';
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Login falló (${res.status}): ${data.message || 'credenciales inválidas'}`);
    process.exit(1);
  }

  const role = data.user && data.user.role;
  const allowed = rolesArg ? rolesArg.split(',').map((s) => s.trim()).filter(Boolean) : ALLOWED;
  if (!allowed.includes(role)) {
    console.error(`El usuario es "${role}". Permitidos para este script: ${allowed.join(', ')}.`);
    process.exit(1);
  }

  const isAdminTTL = admin && /admin/i.test(role);
  console.log(`\nLogueado como ${data.user.email} (${role}). JWT:${isAdminTTL ? ' [extendido: admin]' : ''}\n`);
  console.log(data.accessToken);
  console.log('\nUsalo así:\n  node scripts/migrar-documentos.js --root "Z:\\SolidoCS_Ambientes" --api "' + API + '" --token "' + data.accessToken + '" --dry-run');
}

main().catch((e) => { console.error(e); process.exit(1); });
