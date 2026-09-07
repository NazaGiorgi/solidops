# Ingestion IMAP/MIME de SolidOps — arquitectura, flujo, diagnóstico y reparación histórica

## Resumen ejecutivo
El correo que se ve bien en Zammad y mal en SolidOps era un problema de **parseo MIME**
(no de render ni de IMAP). El gateway de SolidOps no decodificaba el
`Content-Transfer-Encoding` (quoted-printable/base64) al extraer el cuerpo, por lo que
`producci=F3n` quedaba literal. Además no resolvía `multipart/related`/`Content-ID`
(imágenes inline, que aparecían como `[cid:...]`).

## 0. Reparación histórica (nuevo)
Se comprobó con un correo REAL que **el MIME original sigue disponible en IMAP**
(`keep_on_server=true`). Para el ticket histórico `8de3b37c` (mensaje `bf55de25`):
- Localizado por `message_id = <RIUP284MB4008A6A02FE679529E31BB83ACB72@...OUTLOOK.COM>`,
  `imap_uid = 37093`.
- Descargado el RFC822/MIME completo desde IMAP (1.378.982 bytes).
- Parseado con `mailparser/parseMime` → `body` = "Buen día! Como están? … producción …
  ¡Muchas gracias!" (decodificado), `body_html` = 1.33 MB con la imagen embebida, y la
  **imagen inline** `image/png` 999 KB guardada en MinIO como
  `inline-fd0d39fc.png` + `TicketAttachment`.
- **Idempotente**: re-ejecutar no duplica (mismo mensaje, 1 attachment).

**Herramienta**: `backend/scripts/reparar-emails-historicos.ts` (usa mailparser +
StorageService + IMAP). Con `--dry-run` lista sin modificar. Procesa mensajes con
corrupción real (`[cid:`, `=F3/=ED/=E1/=A1/=E9/=F1`). Resultado: **5/8 reparados** desde
IMAP; los 3 restantes son boletines de marketing sin `message_id`/Uid rastreado en el log
(no recuperables por esa vía). Queda un log de migración en `debug/repair-log/`.

## 1. Diagrama real del pipeline
```
IMAP Server (imapflow)
  → login (IMAP SSL) + select INBOX
  → resolver UIDs a procesar (cursor last_processed_uid + UIDVALIDITY)
  → client.fetch({ uid, envelope, source })   ← msg.source = MIME COMPLETO
  → parseMessage(msg)
      → parseMime(source)                     ← mailparser (simpleParser)
  → emailService.ingest({ body, bodyHtml, attachments })
      → tickets.upsertFromEmail(...)
          → crear/actualizar Ticket + TicketMessage(body + bodyHtml)
          → guardar TicketAttachment (fileUrl a MinIO)
  → frontend /tickets/[id] muestra body (text) o bodyHtml (sanitizado) + attachments
```

## 2. Cómo se descarga el email desde IMAP
- `mailbox-worker.service.ts → processMessages` usa
  `client.fetch({ uid, envelope: true, source: true }, { uid: true })`.
- **`msg.source` contiene el mensaje MIME original COMPLETO**. `source: true` le pide a
  imapflow el mensaje completo (internamente lo streaming por chunks de 64KB hasta el
  fin del mensaje; `hasMore = chunk.length >= chunkSize`).
- **Importante**: el valor anterior `source: { start: 0, maxLength: 300000 }` NO truncaba
  el mensaje (en imapflow `start/maxLength` definen el chunk del streaming, no un límite
  de descarga). Se reemplazó por `source: true` por claridad, garantizando el MIME
  integral. Para emails con imágenes/adjuntos grandes, imapflow descarga todo.
- El worker usa **UID** correctamente (cursor `last_processed_uid`, no `\Seen`), de forma
  idempotente y sin pisar a Zammad. El dedupe es por `Message-ID`.

## 3. Parser MIME robusto
- **`mailparser`** (`simpleParser`) — parser MIME maduro/estándar de Node (agregado como
  dependencia `^3.9.20`). Venía sin tipos TS → se creó declaración local
  `src/types/mailparser.d.ts`.
- `parseMime` (en `mime.helper.ts`) envuelve `simpleParser` y devuelve:
  `{ text, html, images, attachments }`.
  - Decodifica CTE (quoted-printable/base64) y charset (UTF-8, ISO-8859-1, Windows-1252) 
    de forma **correcta** (mailparser).
  - `multipart/alternative` → `text` (plain, para BD) + `html` (sanitizado, para display).
  - `multipart/related` + `Content-ID` → imágenes inline en `images`.
  - Adjuntos reales (`Content-Disposition: attachment`) en `attachments`.
  - Sanitiza el HTML (quita script/iframe/on*/javascript:/tags no permitidos).

## 4. Tratamiento de imágenes inline (CID) y adjuntos
- En el worker (`parseMessage`), las imágenes inline se suben a **MinIO** con
  `StorageService.putObject`, y los `src="cid:..."` del HTML **se reemplazan por la URL**
  del attachment (endpoint protegido). Así no aparece `[cid:...]` y la imagen se ve.
- Los adjuntos reales se suben a MinIO y se guarda metadata en `TicketAttachment`
  (`fileUrl`, `filename`, `mimeType`, `sizeBytes`), asociados a su `TicketMessage`.
- Endpoint de descarga: `GET /api/tickets/attachments/:id/download` (JWT) lee de MinIO y
  sirve con `Content-Disposition`.

## 5. Modelo BD
- `ticket_messages.body_html` (nullable) — HTML sanitizado (creado por `synchronize`,
  idempotente). `body` sigue siendo texto plano. No se borra nada de tickets/notas/auditoría.

## 6. Diagnóstico de un email real (herramienta)
- El worker guarda el **MIME RAW original** en `debug/imap-raw/<message-id>.eml` si
  `IMAP_DEBUG_RAW=1` (opción en `docker-compose.dev.yml`, default `"0"`). Sirve para
  comparar con Zammad y verificar que el RAW llega completo. No registra credenciales.
- Ejemplo verificado: un MIME con `Content-Type: text/plain; charset=iso-8859-1`,
  `Content-Transfer-Encoding: quoted-printable` y `Buen d=EDa producci=F3n` se guardó
  intacto y `parseMime` devolvió **"Buen día producción"**.

## 7. Pruebas (ejecutadas)
- **Unidad `parseMime` — 21 PASS / 0 FAIL** (mailparser): QP latin1 (=ED/=F3/=E1/=A1),
  UTF-8, multipart/alternative, multipart/related+CID, attachment PDF base64, HTML
  malicioso, email malformado no lanza.
- **End-to-end real — PASS**: email MIME completo (QP + imagen inline + PDF) → `ingest`
  → ticket con body decodificado, bodyHtml, PDF attachment, sin `[cid:` ni `=F3`. Endpoint
  download 200 `application/pdf`.
- **Diagnóstico `.eml` — PASS**: se guardó el RAW y se decodificó "Buen día producción".
- **No-regresión**: `/`, `/tickets`, `/clientes`, `/documentos`, `/notas`, `/usuarios`,
  `/dashboard`, `/mi-dia` → 200. Backend 200. `tsc --noEmit` 0 errores.

## 8. Cómo reiniciar el worker / redeploy
- Dev: `docker restart ops-backend` (el worker es un `@Cron('*/5 * * * *')` del backend;
  al reiniciar el contenedor, el scheduler relanza el polling).
- Para activar el diagnóstico: en `docker-compose.dev.yml` setear `IMAP_DEBUG_RAW: "1"` y
  `docker compose up -d backend` (o `docker restart ops-backend` tras modificar el compose
  con `docker compose up`).

## 9. Rollback
- Backups en `backup\imap-ingestion-deep-fix\`: `.bak` (originales previos) + `.current`.
  Para revertir: copiar el `.bak` correspondiente sobre el archivo actual.
- Para quitar `mailparser`: quitar de `package.json` + `npm uninstall mailparser` y restaurar
  `mime.helper.ts` desde `backup\imap-ingestion-deep-fix\backend_src_modules_mailboxes_mime.helper.ts`.

## 10. Limitaciones
- **Históricos**: los tickets que ya guardaron `=F3`/`=ED`/`[cid:...]` en `body` NO se
  reconstruyen (no conservamos el MIME original en BD). Solo los emails **nuevos** se
  procesan bien. La reparación histórica es una tarea aparte.
- `IMAP_DEBUG_RAW=1` guarda `.eml` en disco (solo para diagnóstico puntual; apagarlo
  después para no acumular archivos).
