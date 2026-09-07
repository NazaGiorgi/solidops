# SMTP en la pantalla de Casillas de correo

La pantalla **Administración → Casillas → Editar/Agregar casilla** ahora distingue
visualmente **Entrada (IMAP)** de **Salida (SMTP)**. Antes solo existía IMAP, por
eso `soporte@solidocs.com.ar` nunca tuvo SMTP cargado (no era falta de credenciales,
era falta de UI).

---

## Parte 1 — Formulario separado IMAP / SMTP

- **Entrada (IMAP)**: servidor, puerto, usuario, contraseña, SSL (sí/no). Botón
  **Probar IMAP**.
- **Salida (SMTP)** (opcional): servidor, puerto, usuario, contraseña (cifrada vía
  `CryptoService`), y **tipo de seguridad** explícito:
  - **STARTTLS** (típico puerto 587)
  - **SSL/TLS implícito** (típico puerto 465)
  → se agregó el campo `mailboxes.smtp_security` (`'starttls' | 'implicit'`). El
  `smtp_ssl` boolean queda para compatibilidad, pero el selector es el que manda.

Los campos SMTP son opcionales: una casilla puede tener solo IMAP si aún no se
configuró el envío (como las demás casillas hoy).

## Parte 2 — Botón "Probar SMTP" separado

- Endpoint `POST /api/mailboxes/test-smtp` que hace **handshake del transporte**
  (con `nodemailer.verify()`), **sin enviar correo real**.
- Mensajes de error **específicos por protocolo** (no genéricos): incluye el código
  de respuesta del servidor (ej. `535 Incorrect authentication data`). Evita la
  confusión del incidente anterior donde se cambió el puerto IMAP a 587 y dio
  `ERR_SSL_WRONG_VERSION_NUMBER` (por mezclar STARTTLS con un puerto/handshake
  que esperaba otra cosa).

## Config saved / transporte
- `getSmtpConfig()` (MailboxesService) ahora resuelve `secure`/`requireTLS` según
  `smtp_security`: `starttls` → `secure:false, requireTLS:true`; otro/null → `secure:true`.
- `MailService` (outbound) usa `requireTLS` para el envío de password-reset, etc.

## Parte 3 — Sin migración destructiva
- Las casillas existentes conservan su IMAP intacto (host/puerto/ssl/cursor UID).
- SMTP queda vacío hasta cargarlo manualmente desde la UI.

## Prueba en vivo (registrada)
- **IMAP soporte@ intacto** tras el incidente: `imap_port=993`, `imap_ssl=true`
  (el cambio a 587 no se guardó). Flujo IMAP/UID-tracking sigue funcionando
  (`0 nuevos (UID>37046)` a las 13:35).
- **test-smtp** con credenciales dummy + host real `c1931856.ferozo.com`:
  - 587 + STARTTLS → `535 Incorrect authentication data` (handshake TLS OK; la
    credencial fue rechazada por el servidor).
  - 465 + implicit → `535 Incorrect authentication data` (igual).
  → El transporte SMTP conecta y negocia TLS; solo faltan **credenciales reales**.

## Verificación
- `tsc --noEmit` 0 errores · 19 tests pasan · health 200.
- Columna `smtp_security` creada por synchronize.

## Para completar el envío real (siguiente paso, fuera de este prompt)
1. Cargar SMTP de `soporte@` desde la UI: host `c1931856.ferozo.com`, puerto 587,
   seguridad STARTTLS, usuario + contraseña reales (del panel del hosting).
2. "Probar SMTP" → debe dar `✓ conexión SMTP exitosa`.
3. Luego se podrá probar un envío real (ver `docs/MAILBOX-SMTP.md` y el toggle
   `emailAutoResponseEnabled` en `docs/MAIL-ACUMULACION.md`).
