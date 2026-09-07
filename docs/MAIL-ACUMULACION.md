# Modo acumulación silenciosa (convivencia con Zammad)

Mientras SolidOps convive con Zammad (la cara visible al cliente), SolidOps
**acumula** el correo entrante como tickets reales y completos —cliente, contacto,
hilo y cálculo de SLA— para tener el historial listo cuando se complete la
migración, **sin enviar ninguna respuesta ni notificación al cliente**.

> **Temporal y reversible.** No está hardcodeado: es un toggle editable desde el
> panel de Administración → Configuración general → *Comunicaciones*.

---

## Toggle

Campo `SystemSettings.emailAutoResponseEnabled` (boolean, default `false`):

- `false` (default): el correo entrante crea tickets completos pero **no sale
  ningún correo** hacia el remitente. Loguea `[ACUMULACIÓN] ... sin envío saliente
  al cliente`.
- `true`: habilita el envío de la **plantilla "ticket recibido"** al remitente cuando
  se crea un ticket nuevo desde correo entrante (no reenvía para mensajes que solo
  agregan al hilo existente, ni en modo sombra). Implementado en
  `EmailService.ingest` → `MailService.sendTicketReceived(...)`.

### Plantilla "ticket recibido"
```
Asunto: Recibimos tu solicitud — Ticket #{numero}

Hola,

Recibimos tu solicitud y ya quedó registrada como el Ticket #{numero}.
Nuestro equipo de soporte técnico la va a revisar a la brevedad.

Si necesitás agregar más información, simplemente respondé a este correo —
se suma directo al ticket. También podés hacer seguimiento en cualquier momento
desde tu portal de cliente: {link_portal_cliente}

Gracias por confiar en nosotros.

Equipo de Soporte — Solido Connecting Solutions
SolidoCS, lo hacemos simple.
```
- `#{numero}` = `legacyZammadId` (si existe, tickets migrados) o los primeros 8 chars
  del UUID del ticket en mayúsculas.
- `{link_portal_cliente}` = `process.env.PORTAL_URL` (fallback `http://localhost:3000/portal/login`).
- El envío usa el SMTP de la casilla configurada (`MailboxesService.getSmtpConfig`).
- Se dispara en DOS casos (ambos condicionados al toggle y al contacto con email):
  1. Ticket que entra **por correo** (`EmailService.ingest` → `action='created'`).
  2. Ticket creado **manualmente** por un técnico (`TicketsService.create()` →
     `maybeSendReceivedOnCreate`), p.ej. tras un llamado telefónico. Si el ticket
     no tiene contacto con email, se omite sin error.
- No en modo sombra. No se duplica: `create()` (manual) y `upsertFromEmail()` (por
  email) son caminos distintos y no se llaman entre sí.

### Variante para tickets creados manualmente
Para el caso **manual**, el texto es distinto (neutral, no asume el medio — podría
ser telefónico, presencial o chat), usando `MailService.sendTicketCreatedManual`:
```
Asunto: Registramos tu solicitud — Ticket #{numero}

Hola,

Registramos tu solicitud y quedó cargada como el Ticket #{numero}.
Nuestro equipo de soporte técnico la va a revisar a la brevedad.

Podés hacer seguimiento en cualquier momento desde tu portal de cliente:
{link_portal_cliente}

Gracias por confiar en nosotros.

Equipo de Soporte — Solido Connecting Solutions
SolidoCS, lo hacemos simple.
```
- `TicketsService.create()` → `maybeSendReceivedOnCreate()` → `sendTicketCreatedManual`.
- El camino de **correo entrante** (`EmailService.ingest`) sigue usando
  `sendTicketReceived` (texto "Recibimos tu solicitud...") sin cambios.

### Plantilla "en proceso"
```
Asunto: Tu ticket #{numero} está en proceso

Hola,

Tu ticket #{numero} está siendo atendido por nuestro equipo de soporte técnico.
Te avisaremos apenas tengamos novedades o necesitemos más información de tu parte.

Equipo de Soporte — Solido Connecting Solutions
SolidoCS, lo hacemos simple.
```
- Se envía cuando el ticket pasa de `nuevo` a `abierto`/`asignado`/`en_progreso`
  (o a un estado de "en proceso"), en `TicketsService.update()`.
- No se reenvía por cada transición entre estados ya "en proceso".

### Plantilla "resuelto"
```
Asunto: Tu ticket #{numero} fue resuelto

Hola,

Tu ticket #{numero} fue marcado como resuelto. Si el problema persiste o tenés
alguna duda, simplemente respondé a este correo y lo reabrimos.

Gracias por confiar en nosotros.
Equipo de Soporte — Solido Connecting Solutions
SolidoCS, lo hacemos simple.
```
- Se envía cuando el ticket pasa a `resuelto` o `cerrado`.

### Notas de implementación
- Las tres plantillas viven en `MailService` (`sendTicketReceived`, `sendTicketInProgress`,
  `sendTicketResolved`) con un helper `send()` común. Todas validan el toggle
  `emailAutoResponseEnabled` internamente (si está apagado, no envían).
- Los disparos por estado están en `TicketsService.update()` → `maybeSendStatusEmail(ticket, oldStatus)`,
  que envía al email del **contacto** del ticket (si tiene) y omite tickets en modo sombra.
- El toggle se lee en `MailService` (repo `SystemSettings`), no en `TicketsService`.

### Remitente desconocido → crear ticket y cliente/contacto (decisión de negocio)
**Todo correo entrante** a una casilla con destino `ticket` genera ticket, sin importar
si el remitente es contacto conocido. En `EmailService.ingest`, si el remitente NO es
un contacto conocido, se crean automáticamente:
- Un **Customer** ("Cliente <dominio>"; si ya existe uno con el mismo dominio, se reutiliza).
- Un **Contact** (email + nombre humanizado de la parte local del email), vinculado a
  ese cliente.
- Luego el ticket, asociado al contacto/cliente.

Comportamiento:
- **Remitente conocido** (existe contacto por email) → se reutiliza **sin crear duplicados**.
- **Remitente desconocido** → se crea Customer+Contact una sola vez; el siguiente correo
  de la misma dirección se asocia al contacto ya creado (idempotente por email).
- La creación automática es idempotente (busca por email antes de crear).

> **Nota**: antes, los correos de remitentes desconocidos no creaban ticket y quedaban
> sueltos en `inbound_mail_log` con `routed=false`. Ahora crean ticket con contacto
> nuevo. Esto es un cambio deliberado de negocio.

> **Riesgo de duplicado con Zammad**: con el toggle en `true`, cada cambio de estado
> del ticket dispara el correo. Si Zammad sigue activo, el cliente puede recibir
> respuestas de ambos sistemas. Se activa por períodos cortos para pruebas.
  `emailAutoResponseEnabled=true`.

> **Advertencia (riesgo de duplicado con Zammad):** con el toggle en `true`, CADA
> correo entrante dispara la respuesta automática. Si el mismo correo también llega
> a Zammad (que sigue activo), el cliente puede recibir dos respuestas. Se activa
> por períodos cortos y controlados para pruebas.

Las **notificaciones internas** (in-app, badges, dashboard, socket) **no se ven
afectadas**: siguen funcionando para el equipo interno, solo el correo saliente al
cliente queda silenciado.

---

## Destinos de casillas (Parte 2)

| Casilla | default_destination | Nota |
|---|---|---|
| `soporte@solidocs.com.ar` | `ticket` | ya no hace falta catch-all genérico con modo silencioso |
| `mkbackups@solidocs.com.ar` | `document` | puro ruido de backups Mikrotik |
| `notificacionesdeestado@solidocs.com.ar` | `document` | notificaciones automáticas de DVR (cámaras/grabadores); se guarda por referencia |
| `mesadeayuda@solidocs.com.ar` | `ticket` | **no tocar** — host con timeout pendiente de resolver (aparte) |

---

## Verificación en vivo (registrada)

**Modo `false`** (default):
```
[EmailService] [ACUMULACIÓN] pedro.panaderia@example.com → created ticket ... (sin envío saliente al cliente)
TICKET: { status:"nuevo", source:"email", has_contact:true, has_customer:true, msg_count:1, sla_count:1 }
```
- Ticket creado **completo** (contacto, cliente, hilo `msg_count=1`, SLA `sla_count=1`).
- **Cero envío saliente** (marcado explícito en log; no hay llamada a `sendMail` en
  el flujo de ingest).
- Notificaciones internas siguen activas (separadas del camino de correo).

**Modo `true`** (prueba de control):
- El log `[ACUMULACIÓN] ... sin envío` **NO aparece** → el toggle controla el camino
  y no quedó cableado a `false`.

Se revirtió a `false` para producción.

---

## SMTP de `soporte@` — confirmado con envío real (cerrado)

**Pendiente histórico resuelto.** Se cargó el SMTP de `soporte@solidocs.com.ar` en
la UI (host `c1931856.ferozo.com`, puerto **465**, seguridad **implicit**, usuario
` soporte@solidocs.com.ar`, con credenciales reales). El botón "Probar SMTP" dio
`✓ conexión SMTP exitosa`; y se hizo un envío puntual manual hacia
`nazareno.giorgi@gmail.com`.

**Evidencia de log del servidor (aceptación):**
```
smtp host=c1931856.ferozo.com port=465 secure=true requireTLS=false from=soporte@solidocs.com.ar
ACCEPTED responseCode=250 OK id=1x12Mx-00Gt8o-93
messageId=<d2145aa3-6108-6e3b-3cf2-8e22f014e4c1@solidocs.com.ar>
accepted=["nazareno.giorgi@gmail.com"] rejected=[]
SENT_OK
```
- `250 OK` es la confirmación de aceptación del servidor SMTP (no solo que la
  función no tiró excepción).
- `accepted=["nazareno.giorgi@gmail.com"]`, `rejected=[]`.

### Confirmación de recepción (del lado de Gmail)
Revisar la bandeja de `nazareno.giorgi@gmail.com` (incluida la carpeta **Spam**) y
confirmar la llegada del correo:
- Asunto: `Prueba de envío SMTP — SolidOps — ignorar`
- Fecha/hora de envío (UTC) en el cuerpo: `2026-08-31T13:43:..Z` (la que salga en
  el mensaje), para correlacionar con el log.

Mientras no se confirme la recepción, este punto queda abierto en su lado.

### Toggle / modo acumulación (sin cambios)
- `emailAutoResponseEnabled` sigue en **`false`** (no se activó).
- El worker procesó `0 nuevos` en soporte@/mkbackups@ en el ciclo posterior — **no
  se disparó ningún otro envío** además del correo puntual de prueba.
- El envío fue un script mínimo puntual (`smtp-send-test.ts`), eliminado después.

---

## Runbook: cómo desactivar el modo acumulación al cortar Zammad

1. **Preparar plantillas de correo al cliente** (confirmación de recepción,
   notificación de estado) y revisar que salgan bien redactadas **antes** de
   exponerlas a clientes reales.
2. En el panel **Administración → Configuración general → Comunicaciones**, activar
   **Modo acumulación** (`emailAutoResponseEnabled = true`) y configurar el
   **remitente** (`emailSender`).
3. Implementar/verificar el envío saliente en `EmailService.ingest` (la inserción
   `if (auto) { await this.sendOutboundToCustomer(...) }` está marcada como TODO
   Fase 2; requiere el transporte SMTP ya usado por `MailService` y las plantillas).
4. Probar con un cliente de prueba que el correo salga correctamente.
5. Recién ahí dejar el toggle activo en producción.

> El toggle es la **llave**: sin él, aunque exista el código de envío, SolidOps se
> mantiene silencioso ante el cliente.
