# Taller: emails automáticos por cambio de estado

## Contexto
`WorkshopService.setStatus` actualizaba el estado de un equipo y lo reflejaba en el
ticket, pero **no enviaba ningún email** al cliente. Este cambio implementa una
notificación por email (best-effort) en cada transición de estado.

## Mecanismo reutilizado
Se reutilizó `MailService` (salida de email del sistema, misma que los auto-responses
de tickets). Se extendió su helper `send` para soportar adjuntos (nodemailer) y se
agregó el método `sendWorkshopStatus` que arma las 6 plantillas. El remitente lo
resuelve `MailboxesService.getSmtpConfig()`, que **prefiere `soporte@solidocs.com.ar`**
(y cae a cualquier casilla con SMTP configurado; en dev sin SMTP, loguea `[NO-SMTP]`).

## Disparo
Dentro de `WorkshopService`:
- `setStatus`: tras guardar el nuevo estado del equipo, llama `notifyStatusChange(id, status, oldStatus)`.
- `createEquipment`: envía la notificación de `RECIBIDO` (el equipo recién recibido).
  (Es la única vía para emitir el email de recepción, porque RECIBIDO es el primer
  estado y no se puede llegar a él vía `setStatus` sin retroceder.)

Toda la lógica de envío es **best-effort**: `notifyStatusChange` va en `try/catch` y
nunca lanza, por lo que un fallo de mail jamás rompe el cambio de estado.

## Plantillas (idioma es-AR, tono formal-cercano, firma institucional)
Firma fija al pie de las 6: `Saludos, / Solido Connecting Solutions / Servicios de Informática`.
- RECIBIDO — "Recibimos tu equipo — Comprobante N.º X" — adjunta comprobante de recepción.
- EN_DIAGNOSTICO — "Estamos revisando tu equipo".
- DIAGNOSTICADO — "Diagnóstico listo — Presupuesto disponible" — adjunta el PDF del
  presupuesto activo (si existe).
- EN_REPARACION — "Comenzamos la reparación de tu equipo".
- LISTO_PARA_RETIRAR — "Tu equipo está listo para retirar".
- ENTREGADO — "Gracias por confiar en nosotros".

## Adjuntos (PDF)
- `RECIBIDO`: `buildReceptionPdf` (reusado, ya async).
- `DIAGNOSTICADO`: se busca `/getActiveQuote`; si hay presupuesto, se adjunta vía
  `buildQuotePdf` (reusado). Si no hay presupuesto, solo el cuerpo.
- Resto: sin adjunto.

Decisión de diseño: el email de estado `DIAGNOSTICADO` SÍ adjunta el presupuesto,
porque el endpoint `sendQuote` (`POST /quotes/:quoteId/send`) **no envía email** (solo
marca `sentAt` y lo deja visible en el portal). No hay riesgo de adjunto duplicado.

## Logging
- Intento: `[WorkshopMail] Enviando email de estado <status> a <email> para equipo <id>`.
- Éxito (MailService): `Workshop <status> enviado a <email> (<asunto>)` + confirmación
  `[WorkshopMail] Email de estado <status> enviado a <email> (equipo <id>)`.
- Falla (MailService): `[NO-SMTP] ...` o excepción capturada → `[WorkshopMail] Fallo al
  enviar email de estado <status> para equipo <id>: <msg>` (nivel ERROR).
- Sin contacto/email: `WARN [WorkshopMail] equipo <id>: sin contacto/email, email de estado <status> omitido`.

## Pruebas realizadas
Equipo nuevo `434e92f8-04ff-47bd-a6c4-0c0d253675c4` (contacto "juan perez prueba",
email `nazareno.giorgi@gmail.com`). Recorridos vía API los 6 estados en orden con
presupuesto `WK-2026-00002` creado y aprobado.

Logs (docker logs ops-backend, desde 6:50 a 6:52):
```
[WorkshopService][WorkshopMail] Enviando email de estado recibido a nazareno.giorgi@gmail.com para equipo 434e...
[MailService] Workshop recibido enviado a nazareno.giorgi@gmail.com (Recibimos tu equipo — Comprobante N.º E-434E92F8)
[WorkshopService][WorkshopMail] Email de estado recibido enviado a nazareno.giorgi@gmail.com (equipo 434e...)

[WorkshopService][WorkshopMail] Enviando email de estado en_diagnostico a nazareno.giorgi@gmail.com para equipo 434e...
[MailService] Workshop en_diagnostico enviado a nazareno.giorgi@gmail.com (Estamos revisando tu equipo)

[WorkshopService][WorkshopMail] Enviando email de estado diagnosticado a nazareno.giorgi@gmail.com para equipo 434e...
[MailService] Workshop diagnosticado enviado a nazareno.giorgi@gmail.com (Diagnóstico listo — Presupuesto disponible)

[WorkshopService][WorkshopMail] Enviando email de estado en_reparacion a nazareno.giorgi@gmail.com para equipo 434e...
[MailService] Workshop en_reparacion enviado a nazareno.giorgi@gmail.com (Comenzamos la reparación de tu equipo)

[WorkshopService][WorkshopMail] Enviando email de estado listo_para_retirar a nazareno.giorgi@gmail.com para equipo 434e...
[MailService] Workshop listo_para_retirar enviado a nazareno.giorgi@gmail.com (Tu equipo está listo para retirar)

[WorkshopService][WorkshopMail] Enviando email de estado entregado a nazareno.giorgi@gmail.com para equipo 434e...
[MailService] Workshop entregado enviado a nazareno.giorgi@gmail.com (Gracias por confiar en nosotros)
[WorkshopService][WorkshopMail] Email de estado entregado enviado a nazareno.giorgi@gmail.com (equipo 434e...)
```
(Nota: los logs "Enviando email" y "enviado a" son el mismo patrón para los 6 estados;
se muestran todos con su hora.)

### Best-effort / sin contacto
- Equipo `51d32eb9-...` creado sin contacto → `WARN [WorkshopMail] equipo 51d32eb9...:
  sin contacto/email, email de estado recibido omitido`; el equipo se creó igual (estado recibido).

### Adjuntos válidos (mismos buffers que llegaron en el mail)
- Comprobante de recepción: `content-type application/pdf`, magic `%PDF-`, tamaño 2419 bytes.
- Presupuesto: magic `%PDF-`, tamaño 2487 bytes.
(Abre correctamente — no hubo regresión del fix de pdfkit.)

## Pendiente (requiere navegador/casilla real, no disponible en este entorno)
1. Recorrer los 6 estados desde el navegador (confirmación visual de pantalla).
2. Confirmar recepción real en la casilla `nazareno.giorgi@gmail.com` (no basta el log
   de SMTP "enviado", que solo prueba que el servidor aceptó el mensaje).
3. Abrir el adjunto del PDF del mail de RECIBIDO (debe abrir sin error).

## Archivos tocados
- `backend/src/modules/mail/mail.service.ts` — `send` con adjuntos + `sendWorkshopStatus` (6 plantillas).
- `backend/src/modules/workshop/workshop.service.ts` — inyecta `MailService`, `notifyStatusChange`,
  llamadas en `setStatus` y `createEquipment`.
- (Sin cambios de frontend.)

## Para aplicar
```
docker restart ops-backend
```