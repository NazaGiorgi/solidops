// lo-converter — servicio minimalista de conversión a PDF con LibreOffice headless.
// Recibe un POST multipart con el archivo y devuelve el PDF convertido.
// Lo usa el backend para la vista previa de documentos Word/Excel/PowerPoint.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const PORT = process.env.PORT || 8000;
const TIMEOUT = 60000;

function convert(buffer, name) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-'));
    const src = path.join(dir, name || 'doc');
    fs.writeFileSync(src, buffer);
    const outName = path.basename(src).replace(/\.[^.]+$/, '') + '.pdf';
    execFile('soffice', ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, src], { timeout: TIMEOUT }, (err) => {
      if (err) { fs.rmSync(dir, { recursive: true, force: true }); return reject(err); }
      const out = path.join(dir, outName);
      const pdf = fs.existsSync(out) ? fs.readFileSync(out) : null;
      fs.rmSync(dir, { recursive: true, force: true });
      if (!pdf) return reject(new Error('Conversion no produjo PDF'));
      resolve(pdf);
    });
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
  if (req.method !== 'POST') { res.writeHead(405); return res.end(); }

  const chunks = [];
  let size = 0;
  let contentType = '';
  req.on('data', (c) => { chunks.push(c); size += c.length; if (size > 100 * 1024 * 1024) { res.writeHead(413); res.end('too big'); req.destroy(); } });
  req.on('end', async () => {
    const raw = Buffer.concat(chunks);
    // Parse simple: buscar nombre de archivo y body. Usa la forma: si es
    // multipart, extraer el file; si es raw, usarlo tal cual.
    let fileBuffer = raw; let filename = 'doc';
    const m = raw.toString('latin1').match(/filename="([^"]+)"/);
    if (m) filename = Buffer.from(m[1], 'latin1').toString('utf8');
    const boundary = contentType.match(/boundary=(.+)$/m);
    if (boundary && raw.includes('--' + boundary[1])) {
      // Multipart: split por boundary y quedarnos con el mayor chunk binario.
      const sep = Buffer.from('--' + boundary[1]);
      // El contenido binario real está entre el header y el --final boundary.
      const idxBody = raw.indexOf(Buffer.from('\r\n\r\n'));
      const idxEnd = raw.lastIndexOf(sep);
      fileBuffer = sliceBetween(raw, idxBody + 4, idxEnd);
      // quitar el \r\n final del chunk anterior si aplica
    }
    try {
      const pdf = await convert(fileBuffer, filename);
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename=preview.pdf', 'Content-Length': pdf.length });
      res.end(pdf);
    } catch (e) {
      res.writeHead(422, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: 'No se pudo convertir: ' + e.message }));
    }
  });
});

function sliceBetween(buf, start, end) {
  // Recorta hasta el último \r\n antes de la línea del boundary final.
  let e = end;
  while (e > start && (buf[e - 1] === 0x0a || buf[e - 1] === 0x0d)) e--;
  return buf.subarray(start, e);
}

server.listen(PORT, () => console.log(`lo-converter en :${PORT}`));
