#!/usr/bin/env node
/**
 * Migración de documentación de clientes desde la carpeta de red a SolidOps.
 *
 * Estrategia (confirmada): correr FUERA del contenedor, en Windows/WSL2 con
 * acceso a la unidad de red mapeada, y subir por HTTP multipart a la API de
 * SolidOps (POST /api/documents/upload). No requiere montar la red en el
 * contenedor ni tocar docker-compose.
 *
 * IMPORTANTE: SE REQUIERE --token SIEMPRE (también en dry-run) para consultar los
 * clientes contra los que se hace el matching. Sin token el script aborta.
 *
 * Uso:
 *   --dry-run (default) -> solo reporta.
 *   --run  -> sube realmente.
 *
 * Ejemplos:
 *   node scripts/migrar-documentos.js --root "Z:\SolidoCS_Ambientes" \
 *        --api http://localhost:4000 --token <JWT> --dry-run
 *   node scripts/migrar-documentos.js --root "Z:\SolidoCS_Ambientes" \
 *        --api http://localhost:4000 --token <JWT> --run --limit-clientes 2
 *
 * Argumentos:
 *   --root            ruta a SolidoCS_Ambientes
 *   --api             base URL de la API (default http://localhost:4000)
 *   --token           JWT de acceso (obligatorio siempre)
 *   --run             ejecuta la subida real
 *   --limit-clientes  (opcional) subir solo los primeros N clientes matcheados
 *   --verbose         loguear el matching de cada carpeta
 *   --timeout         segundos por llamada HTTP (default 60). Útil para archivos
 *                     grandes: si se agota, loguea el fallo y sigue con el siguiente.
 *   --retries         reintentos por archivo ante fallo transitorio (default 3).
 *   --progress-every  cada N subidas loguea un resumen de avance (default 10).
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const ROOT = arg('--root') || 'Z:\\SolidoCS_Ambientes';
const API = (arg('--api') || 'http://localhost:4000').replace(/\/$/, '');
const TOKEN = arg('--token') || '';
const DRY = args.includes('--dry-run') || !args.includes('--run');
const LIMIT = arg('--limit-clientes') ? parseInt(arg('--limit-clientes'), 10) : Infinity;
const VERBOSE = args.includes('--verbose');
const INACTIVE_FOLDER = 'Clientes ya no abonados';

const SENSITIVE_HINTS = ['credencial', 'acceso', 'password', 'passwords', 'seguridad', 'vpn', 'router'];
const EDITABLE = /\.(docx|xlsx|pptx|odt|txt|md|rtf)$/i;
// Archivos temporales / de sistema que nunca son contenido real migrable.
const JUNK = /^(~\$|\._)|\.(tmp|temp|bak|old)$|^(Thumbs\.db|\.DS_Store|desktop\.ini|~lock\.|\.goutputstream)/i;
// Carpetas de nivel superior que NO corresponden a un cliente puntual (gestión
// interna, general, papeleras, etc.). Se saltan del matching y van directo a
// "Recursos generales" SIN pasar por el algoritmo. Ampliá este array si aparecen
// más casos en el próximo dry-run.
const NON_CUSTOMER_FOLDERS = [
  '1 - GESTION DE BACKUPS (Todas las empresas)',
  '2 - OBRAS',
  'Diagramas',
  'Correo Argentino',
  'Axel NB Backup',
  '#recycle',
  'Nueva carpeta',
  'Nueva carpeta (2)',
];
const headers = { Authorization: `Bearer ${TOKEN}` };

// --- Normalización y matching tolerante -------------------------------------
// Quita tildes, baja a minúsculas, quita TODO lo no-alfanumérico y espacios extra.
function fold(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')            // tildes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')                 // puntos, comas, símbolos -> espacio
    .replace(/\s+/g, ' ')
    .trim();
}

// Palabras "vacías" / sufijos legales que no aportan a la identidad.
const STOPWORDS = new Set(['sa', 's.a', 'srl', 's.r.l', 'ltd', 'ltda', 'the', 'de', 'del', 'la', 'lo', 'el', 'y', 'e', 'cia', 'inc', 'corporation', 'gmbh', 'the', '&']);

function tokens(s) {
  return fold(s).split(' ').filter((w) => w && !STOPWORDS.has(w));
}

// Tokens residuales de duplicado/copia que NO aportan identidad (ruido).
// Se eliminan al computar la proporción de la carpeta cubierta por el cliente,
// para que "Zurich - copia" siga siendo la misma empresa que "Zurich" y no un
// cliente distinto. "copia"/"backup"/"nuevo"/... no representan una empresa.
const DUP_NOISE = new Set(['copia', 'backup', 'backups', 'nuevo', 'nueva', 'viejo', 'vieja', 'original', 'final', 'finalizado', 'finalizada', 'antiguo', 'antigua']);
function cleanTokens(s) {
  return tokens(s).filter((w) => !DUP_NOISE.has(w));
}

// Coincidencia de identidad (no de palabra suelta). Cuenta los tokens comunes
// entre carpeta y cliente, exige que la mayor parte del nombre MAS CORTO esté
// cubierta (evita que una sola palabra común, p.ej. "empresas" en
// "1 - GESTION DE BACKUPS (Todas las empresas)", genere un falso positivo contra
// un cliente "Empresas"). La contención de subcadena SOLO cuenta como señal
// fuerte cuando los nombres casi coinciden por completo.
function similarity(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const ca = fold(a).replace(/ /g, '');
  const cb = fold(b).replace(/ /g, '');
  if (cb.length < 3 && ca !== cb) return 0;

  const setB = new Set(tb);
  let common = 0;
  for (const t of ta) if (setB.has(t)) common++;
  const dice = (2 * common) / (ta.length + tb.length);

  // Cobertura del nombre más corto: qué proporción de sus tokens están en el otro.
  const shorter = ta.length <= tb.length ? ta : tb;
  const longer = ta.length <= tb.length ? tb : ta;
  let covered = 0;
  for (const t of shorter) if (longer.includes(t)) covered++;
  const coverage = covered / shorter.length;

  // Contención solo cuando las cadenas son casi idénticas (no por una palabra).
  const nearFull = Math.abs(ca.length - cb.length) <= Math.min(ca.length, cb.length) * 0.4;
  const contains = nearFull && (ca.includes(cb) || cb.includes(ca)) ? 1 : 0;

  return Math.max(dice, contains) * Math.min(1, coverage);
}

// Proporción del nombre de la CARPETA (sin ruido de "- copia"/duplicados) que
// está cubierta por los tokens del cliente. Evita que un cliente genérico corto
// (nombre de ciudad, palabra común como "sindicato"/"laboratorio") absorba
// carpetas de empresas específicas que solo comparten esa palabra.
function folderCoveredByCustomer(folderName, customerName) {
  const tf = cleanTokens(folderName);
  const tc = cleanTokens(customerName);
  if (!tf.length || !tc.length) return { ratio: 0, folderTokens: tf.length, match: 0 };
  const setC = new Set(tc);
  let match = 0;
  for (const t of tf) if (setC.has(t)) match++;
  return { ratio: match / tf.length, folderTokens: tf.length, customerTokens: tc.length, match };
}

// Un cliente corto (1-2 tokens significativos) es sospechoso si su nombre NO
// cubre la mayor parte de la carpeta: la única coincidencia es esa palabra
// común y el resto del nombre de la carpeta es una empresa NO relacionada.
function isSuspiciousShortMatch(folderName, customer) {
  const tc = cleanTokens(customer.name);
  if (tc.length >= 2) return false;            // cliente multi-palabra: identidad clara
  const cov = folderCoveredByCustomer(folderName, customer.name);
  return cov.ratio <= 0.5;                     // la palabra del cliente es minoría en la carpeta
}

// Da el mejor match (candidato único con confianza >= umbral) o null si es
// ambiguo (dos candidatos con nombres DISTINTOS muy cercanos) o no hay match.
function bestMatch(folderName, customers) {
  const scores = customers
    .map((c) => ({ c, s: similarity(folderName, c.name) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  if (!scores.length) return { match: null, score: 0 };
  const top = scores[0];
  const second = scores[1];
  const AMBIGUITY = 0.15;
  const THRESHOLD = 0.5;

  // Si los dos mejores tienen el MISMO nombre normalizado (ignorando espacios),
  // son duplicados de la misma empresa en la BD (ej. "Solidocs"/"SolidoCS",
  // "Internegocios Sa"/"Internegocios S.A.") -> NO es ambigüedad real; elegimos
  // el que más parecido tenga (o que esté activo).
  const canon = (s) => fold(s).replace(/ /g, '');
  const sameNormalized = second && canon(top.c.name) === canon(second.c.name);
  if (sameNormalized) return { match: top.c, score: top.s };

  if (top.s < THRESHOLD) return { match: null, score: top.s };
  if (second && (top.s - second.s) < AMBIGUITY) return { match: null, score: top.s, candidates: [top.c.name, second.c.name] };

  // Guard antifalso-positivo: cliente corto que no cubre la carpeta -> la única
  // señal ("Mercedes" en "Elec-Tra Mercedes") es la ciudad, no un cliente real.
  if (isSuspiciousShortMatch(folderName, top.c)) {
    return { match: null, score: top.s, suspicious: true, reason: `${top.c.name} (carpeta "${folderName}")` };
  }
  return { match: top.c, score: top.s };
}

function walk(dir, rel) {
  let out = [];
  for (const name of fs.readdirSync(dir)) {
    if (JUNK.test(name)) continue; // saltea archivos temporales/de sistema
    const full = path.join(dir, name);
    const relPath = rel ? rel + '/' + name : name;
    if (fs.statSync(full).isDirectory()) out = out.concat(walk(full, relPath));
    else out.push({ full, relPath, name });
  }
  return out;
}

// Dedupe del mismo documento en la misma carpeta. Los .pdf se tratan como adjunto
// de referencia del .docx/.xlsx editable homónimo (no entrada aparte), pero un
// .pdf SIN par editable se conserva como documento standalone. Dos editables con
// el mismo basename normalizado (ignora espacios extra y mayúsculas, ej.
// "...18012024.docx" vs "...18012024 .xlsx") se unifican en una sola entrada
// (el formato de mayor prioridad docx>xlsx>pptx como principal).
function dedupe(files) {
  const baseOf = (n) => n.toLowerCase().replace(/\s+/g, ' ').trim();
  const extOf = (n) => path.extname(n).toLowerCase();
  const rank = { '.docx': 3, '.xlsx': 2, '.pptx': 1 };
  let duplicatePdfs = 0; // .pdf con par editable homónimo (adjunto, no entrada aparte)
  // Editables (con base normalizada) presentes, para saber si un .pdf tiene par.
  const editableBases = new Set();
  for (const f of files) if (EDITABLE.test(f.name)) editableBases.add(baseOf(path.basename(f.name, extOf(f.name))));

  const kept = [];
  const byBase = new Map();
  for (const f of files) {
    const ext = extOf(f.name);
    if (ext === '.pdf') {
      // Si tiene par editable homónimo, es adjunto de ese documento (no entra);
      // si no, es un documento standalone que se migra.
      const base = baseOf(path.basename(f.name, '.pdf'));
      if (editableBases.has(base)) { duplicatePdfs++; continue; }
      kept.push(f);
      continue;
    }
    if (!EDITABLE.test(f.name)) { kept.push(f); continue; }

    const base = baseOf(path.basename(f.name, ext));
    const existing = byBase.get(base);
    if (!existing) {
      byBase.set(base, f);
      kept.push({ ...f, duplicatePdf: false });
    } else {
      const rF = rank[ext] || 0;
      const rE = rank[extOf(existing.name)] || 0;
      if (rF > rE) {
        const idx = kept.findIndex((k) => k === existing);
        kept[idx] = { ...f, duplicatePdf: false };
        byBase.set(base, f);
      }
    }
  }
  kept.duplicatePdfs = duplicatePdfs;
  return kept;
}

function isSensitivePath(rel) {
  return SENSITIVE_HINTS.some((h) => rel.toLowerCase().includes(h));
}

function categoryPathOf(rel) {
  const parts = rel.split('/').filter(Boolean);
  return parts.slice(1).join('/').trim() || null;
}

function titleOf(filename) {
  return path.basename(filename, path.extname(filename));
}

// Tiempo máximo por llamada HTTP (ms). Archivos muy grandes (925+ de una carpeta,
// 1.86GB) pueden tardar en multipart; los .DBF u otros binarios pueden fallar.
// Se sobreescribe con `--timeout <segundos>` (default 60s por archivo).
const REQUEST_TIMEOUT_MS = arg('--timeout') ? parseInt(arg('--timeout'), 10) * 1000 : 60_000;

// fetch con timeout via AbortController. Si se agota el tiempo, lanza un error
// claro (en vez de colgarse indefinidamente sin feedback).
async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } catch (e) {
    const isAbort = e.name === 'AbortError' || e.name === 'TimeoutError';
    throw new Error(isAbort ? `TIMEOUT tras ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s` : e.message);
  } finally {
    clearTimeout(timer);
  }
}

async function api(pathname, opts) {
  const res = await fetchWithTimeout(`${API}/api${pathname}`, { ...opts, headers });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`${opts?.method || 'GET'} ${pathname} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

// Reintentos por archivo (sobre todo para archivos grandes sobre share SMB, cuyo
// fs.readFileSync puede fallar transitoriamente con "UNKNOWN: unknown error, read").
const UPLOAD_RETRIES = arg('--retries') ? parseInt(arg('--retries'), 10) : 3;

async function uploadFile(file, meta) {
  let lastErr;
  for (let attempt = 1; attempt <= UPLOAD_RETRIES; attempt++) {
    try {
      const buffer = fs.readFileSync(file.full);
      const form = new FormData();
      form.append('file', new Blob([buffer]), file.name);
      form.append('title', meta.title);
      if (meta.customerId) form.append('customerId', meta.customerId);
      if (meta.categoryPath) form.append('categoryPath', meta.categoryPath);
      if (meta.sensitive) form.append('sensitive', 'true');
      if (meta.documentType) form.append('documentType', meta.documentType);
      if (meta.sourcePath) form.append('sourcePath', meta.sourcePath);
      form.append('source', meta.source || 'upload');
      const res = await fetchWithTimeout(`${API}/api/documents/upload`, { method: 'POST', headers, body: form });
      if (!res.ok) throw new Error(`upload ${file.name} -> ${res.status} ${await res.text().catch(() => '')}`);
      return res.json();
    } catch (e) {
      lastErr = e;
      if (attempt < UPLOAD_RETRIES) {
        console.error(`    ↻ reintento ${attempt}/${UPLOAD_RETRIES} de ${file.name} tras: ${e.message}`);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  throw lastErr;
}

// Agrupa carpetas con nombres "parecidos" entre sí (variantes de la misma empresa).
// Umbral moderado para detectar duplicados / errores de tipeo / sufijos "- copia".
function groupVariants(folderNames) {
  const groups = [];
  const used = new Set();
  const sorted = [...folderNames].sort();
  for (let i = 0; i < sorted.length; i++) {
    if (used.has(sorted[i])) continue;
    const group = [sorted[i]];
    used.add(sorted[i]);
    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(sorted[j])) continue;
      if (similarity(sorted[i], sorted[j]) >= 0.35) { group.push(sorted[j]); used.add(sorted[j]); }
    }
    if (group.length > 1) groups.push(group);
  }
  return groups;
}

async function main() {
  console.log(`\n== Migración documental ==`);
  console.log(`Root: ${ROOT}\nModo: ${DRY ? 'DRY-RUN (reporte)' : 'REAL (sube)'}${LIMIT !== Infinity ? ` (limit ${LIMIT})` : ''}\n`);

  if (!fs.existsSync(ROOT)) {
    console.error(`No se puede leer ${ROOT}. Verificá: VPN activa, unidad Z: mapeada, permiso de lectura.`);
    process.exit(2);
  }
  if (!TOKEN) {
    console.error('Se requiere --token (JWT) incluso en dry-run, para consultar los clientes y matchear. Abortando.');
    process.exit(2);
  }

  const topFolders = fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  console.log(`Carpetas de nivel superior: ${topFolders.length}\n`);

  // Clientes de SolidOps — la consulta es crítica: si falla, abortar (no tragar).
  let customers;
  try {
    customers = await api('/customers');
  } catch (e) {
    console.error(`No se pudieron obtener los clientes (¿token válido?): ${e.message}`);
    process.exit(3);
  }
  if (!Array.isArray(customers) || !customers.length) {
    console.error('La API devolvió una lista de clientes vacía o inválida. Abortando para no "matchear" contra nada.');
    process.exit(3);
  }
  console.log(`Clientes cargados: ${customers.length}\n`);

  // Idempotencia (solo en modo real).
  let existingByKey = new Set();
  if (!DRY) {
    try {
      const docs = await api('/documents');
      (docs || []).forEach((d) => existingByKey.add(`${d.customerId || 'null'}::${d.sourcePath || ''}::${d.rawFilename || ''}`));
      console.log(`Docs ya migrados: ${existingByKey.size}\n`);
    } catch (e) { /* ignore */ }
  }

  let total = 0, matched = 0, general = 0, dupPairs = 0, sensitive = 0, uploaded = 0, skipped = 0;
  const unmatched = [];              // carpetas sin match de cliente
  const foldMatches = new Map();    // folder -> { customer, score } resoluciones
  const processedLog = [];          // desglose cliente -> archivos procesados
  const nonCustomerMatches = [];    // carpetas no-cliente excluidas del matching
  const failures = [];              // archivos que fallaron al subir (timeout/error), con motivo
  let attemptCount = 0;             // contador global de intentos de subida (feedback continuo)
  const barAt = arg('--progress-every') ? parseInt(arg('--progress-every'), 10) : 10;

  async function processCustomerFolder(customerName, dir, customer, inactive, parentPath) {
    const files = dedupe(walk(dir, customerName));
    dupPairs += files.duplicatePdfs || 0;
    const beforeTotal = total;
    for (const f of files) {
      total++;
      if (isSensitivePath(f.relPath)) sensitive++;
      if (customer) matched++;
      else general++;
      if (DRY || !customer) continue;
      const key = `${customer?.id || 'null'}::${parentPath || ''}::${f.name}`;
      if (existingByKey.has(key)) { skipped++; continue; }
      const meta = {
        title: titleOf(f.name),
        customerId: customer.id,
        categoryPath: categoryPathOf(f.relPath),
        documentType: isSensitivePath(f.relPath) ? 'credenciales' : 'otro',
        sensitive: isSensitivePath(f.relPath),
        source: 'migracion',
        sourcePath: f.relPath,
        note: inactive ? 'Cliente inactivo (Clientes ya no abonados)' : null,
      };
      attemptCount++;
      try {
        await uploadFile(f, meta);
        uploaded++; existingByKey.add(key);
        if (attemptCount % barAt === 0) {
          console.log(`  [${attemptCount}] ok=${uploaded} fallos=${failures.length} (${customer ? customer.name : 'general'})`);
        }
      } catch (e) {
        failures.push({ relPath: f.relPath, customer: customer.name, error: e.message });
        console.error(`  ⚠ fallo [${attemptCount}] ${f.relPath}: ${e.message}`);
      }
    }
    // Registro visible de qué cliente/carpeta se procesó y cuántos archivos.
    const n = total - beforeTotal;
    processedLog.push({ folder: customerName, customer: customer ? customer.name : '(sin cliente → Recursos generales)', files: n, inactive });
    console.log(`  [procesado] "${customerName}" -> ${customer ? customer.name : 'SIN CLIENTE'} (${n} archivos)${inactive ? ' [inactivo]' : ''}`);
  }

  for (const folder of topFolders) {
    const folderPath = path.join(ROOT, folder);

    // Carpetas confirmadas como NO-cliente (gestión interna, papelera, general).
    // Se saltan del matching por completo y van textualmente apuntadas en el reporte.
    const norm = (s) => fold(s);
    if (NON_CUSTOMER_FOLDERS.some((nf) => norm(nf) === norm(folder))) {
      console.log(`  [no-cliente] "${folder}" → Recursos generales (excluida del matching)`);
      nonCustomerMatches.push(folder);
      continue;
    }

    if (folder === INACTIVE_FOLDER) {
      const subs = fs.readdirSync(folderPath, { withFileTypes: true }).filter((e) => e.isDirectory());
      for (const s of subs) {
        const r = bestMatch(s.name, customers);
        if (!r.match) {
          const extra = r.suspicious ? ` (sospecha falso-positivo: ${r.reason})` : r.candidates ? ` (ambiguo: ${r.candidates.join(' vs ')})` : '';
          unmatched.push(`${folder}/${s.name} (inactivo, sin match${extra})`);
        }
        if (VERBOSE) console.log(`  [inactivo] "${s.name}" -> ${r.match ? r.match.name : 'SIN MATCH'} (${r.score.toFixed(2)})${r.suspicious ? ' [sospecha]' : ''}${r.candidates ? ' [ambig]' : ''}`);
        await processCustomerFolder(s.name, path.join(folderPath, s.name), r.match, true, `${folder}/${s.name}`);
      }
      continue;
    }

    const r = bestMatch(folder, customers);
    foldMatches.set(folder, r);
    if (!r.match) {
      const extra = r.suspicious ? ` (sospecha falso-positivo: ${r.reason})` : r.candidates ? ` (ambiguo: ${r.candidates.join(' vs ')})` : '';
      unmatched.push(folder + extra);
    }
    if (VERBOSE) console.log(`  "${folder}" -> ${r.match ? r.match.name : 'SIN MATCH'} (${r.score.toFixed(2)})${r.suspicious ? ' [sospecha]' : ''}${r.candidates ? ' [ambig]' : ''}`);
    await processCustomerFolder(folder, folderPath, r.match, false, folder);

    if (!DRY && LIMIT !== Infinity && matched >= LIMIT) break;
  }

  const variantGroups = groupVariants(topFolders.filter((f) => f !== INACTIVE_FOLDER));

  console.log(`\n== REPORTE ==`);
  console.log(`Total archivos: ${total}`);
  console.log(`Pares docx/pdf: ${dupPairs}`);
  console.log(`Posibles credenciales (sensitive): ${sensitive}`);
  console.log(`Con cliente: ${matched} · Sin cliente (→ Recursos generales): ${general}`);
  console.log(`Subidos: ${uploaded} · Ya existían: ${skipped}`);
  console.log(`\n== Clientes procesados ==`);
  for (const p of processedLog) console.log(`   • ${p.customer} (${p.files} archivos)${p.inactive ? ' [inactivo]' : ''}`);
  if (failures.length) {
    console.log(`\n== ARCHIVOS FALLIDOS (${failures.length}) ==`);
    console.log('Estos NO se subieron. Revisá el motivo y volvé a intentar con --run (es idempotente).');
    for (const f of failures) console.log(`   ✗ ${f.relPath} [${f.customer}] -> ${f.error}`);
  }
  if (unmatched.length) {
    console.log(`\nCarpetas SIN match (van a Recursos generales): ${unmatched.length}`);
    for (const u of unmatched) console.log(`   - ${u}`);
  }
  if (variantGroups.length) {
    console.log(`\n== Posibles variantes del mismo nombre (solo informativo — NO se unen ni descartan) ==`);
    for (const g of variantGroups) console.log(`   • ${g.join('  ⚠  ')}`);
  }
  if (nonCustomerMatches.length) {
    console.log(`\nCarpetas NO-cliente (excluidas del matching, van a Recursos generales): ${nonCustomerMatches.length}`);
    for (const n of nonCustomerMatches) console.log(`   - ${n}`);
  }
  console.log('\nListo. Las carpetas sin match quedan como customer_id=null en Recursos generales.');
  if (failures.length) console.log(`\nResumen de fallos: ${failures.length} archivo(s) NO se subieron (ver lista arriba). Podés reintentar con --run sin miedo a duplicar (idempotente).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
