# Procesamiento de emails entrantes — MIME, UTF-8, Quoted-Printable, HTML, imágenes CID y adjuntos

## Problema
Los tickets creados desde emails mostraban contenido corrupto:
- `Buen d=EDa! Como est=E1n?` en vez de `Buen día! ¿Cómo están?`
- `producci=F3n` en vez de `producción`
- `[cid:fd0d39fc-...]` en vez de la imagen incrustada
- La imagen del email no se veía.

## Causa raíz (confirmada con evidencia)
En `mailbox-worker.service.ts` el extractor usaba `@zone-eu/mailsplit` y hacía
`chunk.value` → `toString('utf8')` o `iconv.decode(...)` **SIN decodificar el
Content-Transfer-Encoding** (quoted-printable/base64). Por eso `=F3`/`=ED`/`=E1`
quedaban literales. Además no resolvía `multipart/related` ni `Content-ID` (dejando
`[cid:...]`), ni procesaba adjuntos.

**Por qué Zammad funciona y SolidOps no**: Zammad usa un parser MIME completo que
decodifica CTE + charset + relaciona imágenes CID. SolidOps solo separaba partes y
mostraba el charset sin decodificar CTE ni resolver CID/adjuntos.

## Solución implementada

### Nuevo parser MIME: `backend/src/modules/mailboxes/mime.helper.ts`
- Recorre las partes con `@zone-eu/mailsplit`.
- **Decodifica Content-Transfer-Encoding** con `Decoder` de `libqp` (quoted-printable)
  y `libbase64` (base64) — decodificación real (la función `.decode()` directa de esas
  librerías NO decodifica; se usa el stream `Decoder`).
- **Convierte charset** con `iconv-lite` (UTF-8, ISO-8859-1, Windows-1252, etc.).
- **multipart/alternative**: `text` (guardado en BD) del `text/plain` si existe (para
  conservar el texto completo); `html` para display del `text/html`. Si solo hay uno,
  se usa.
- **multipart/related**: detecta imágenes inline por `Content-ID` → mapa `images`.
- **Adjuntos reales** (`Content-Disposition: attachment`) → listado `attachments`.
- **Sanitización HTML** propia (`sanitizeHtml`): elimina `<script>`, `<style>`,
  `<iframe>`, `<object>`, `<form>`, atributos `on*`, `javascript:`, y tags no
  permitidos; conserva tags de email normal (`p div span br strong em b i ul ol li
  table tr td img a h1-h6 code pre`).
- No lanza en emails malformados (devuelve cuerpo mínimo).

### Worker: `mailbox-worker.service.ts`
- `parseMessage()` (método privado) usa `parseMime`, **sube imágenes inline y adjuntos
  a MinIO** con `StorageService.putObject`, y **resuelve los `cid:`** en el HTML por la
  URL del attachment.
- Pasa `body`, `bodyHtml` y `attachments` a `emailService.ingest`.

### Email service + tickets
- `InboundEmailDto` + `bodyHtml` y `attachments` con `sizeBytes`/`cid`/`disposition`.
- `email.service.ingest` → `upsertFromEmail(... bodyHtml, attachments)`.
- `upsertFromEmail` guarda el mensaje con `bodyHtml` y persiste los **attachments**
  asociados al mensaje (`TicketAttachment` con `fileUrl` a MinIO).
- Nuevo endpoint `GET /api/tickets/attachments/:id/download` (protegido por JWT) que
  lee de MinIO y sirve con `Content-Disposition`.

### BD
- Columna nueva opcional `body_html` en `ticket_messages` (creada por `synchronize`,
  idempotente). No se borra nada de tickets/notas/auditoría existentes.

### Frontend (`tickets/[id]/page.tsx`)
- Muestra el contenido del mensaje: si hay `bodyHtml` (sanitizado en backend), lo
  renderiza con `dangerouslySetInnerHTML` (el backend ya lo saneó); si no, texto plano
  con `pre-wrap`. Muestra los attachments con link de descarga al endpoint protegido.
- No se rediseñó la ficha del ticket.

## Flujo resultante
```
Email (IMAP) → imapflow → source (bytes)
  → parseMime (CTE qp/base64 + charset + multipart/alternative/related)
  → imágenes inline (CID) → MinIO; adjuntos → MinIO
  → HTML con cid: → URL del attachment
  → emailService.ingest → upsertFromEmail → Ticket + mensaje(body + bodyHtml) + attachments
  → frontend muestra texto decodificado + HTML + imagen + adjunto
```

## Pruebas
### Unidad (mime.helper) — 21 PASS / 0 FAIL
TEST1 QP latin1 (=`ED/=F3/=E1/=A1`) → correcto. TEST2 UTF-8. TEST3 multipart/alternative
(HTML). TEST4 multipart/related (imagen CID). TEST5 attachment PDF (base64). TEST6 HTML
malicioso (script/onerror/javascript eliminado). TEST7 email malformado no lanza.

### End-to-end real (email MIME completo → ingest → BD) — PASS
Email con QP latin1 + imagen inline + PDF adjunto → ticket creado con body decodificado
("Buen día! producci=F3n"→ producción), bodyHtml guardado, attachment PDF presente, sin
`[cid:` ni `=F3`. Endpoint download → 200 application/pdf %PDF.

### No-regresión
`/`, `/tickets`, `/clientes`, `/documentos`, `/notas`, `/dashboard`, `/usuarios`,
`/mi-dia` → 200. Backend 200. `tsc --noEmit` 0 errores.

## Limitaciones
- Los **tickets históricos** que ya guardaron `=F3`/`=ED`/`[cid:...]` en el `body` NO se
  reconstruyen (el MIME original no se conserva en BD). Solo los emails **nuevos** se
  procesan correctamente. La reparación histórica sería una tarea aparte (no se hizo).
- La imagen inline queda embebida en el HTML (vía URL del attachment protegido); el
  `body` de texto plano no contiene la imagen (es texto), lo cual es correcto.

## Archivos modificados / nuevos
- **Nuevo**: `backend/src/modules/mailboxes/mime.helper.ts`
- Backend: `mailbox-worker.service.ts`, `email.service.ts`, `email/dto.ts`,
  `tickets.service.ts`, `tickets.controller.ts`, `ticket-message.entity.ts`,
  `ticket-attachment.entity.ts`.
- Frontend: `app/(app)/tickets/[id]/page.tsx`.

## Backups / rollback
`backup\email-mime-fix\` → originales (antes de modificar) + `.current` (versión actual)
con SHA256. Para revertir un archivo: copiar el `.bak` correspondiente sobre el actual.
Se conservan todos los backups previos (notes-module, ticket-list-redesign, etc.).
