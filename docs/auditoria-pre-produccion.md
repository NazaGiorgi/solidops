# Auditoría integral pre-producción — SolidOps (Sistema de Tickets Agenda)

**Fecha:** 2026-09-06
**Tipo:** Auditoría de diagnóstico (solo lectura). Sin cambios de código, sin migraciones, sin escrituras en BD.
**Ámbito:** backend `backend/src`, frontend `frontend/app`, infra `docker-compose.*`, `caddy/Caddyfile`, datos reales (BD `ops_msp`, 40.243 tickets) — verificaciones en vivo limitadas a lecturas y probes HTTP con tokens reales.

---

## A. Diagnóstico — resumen ejecutivo

El sistema tiene una arquitectura sólida en varios planos (separación `id` UUID ↔ `ticket_number` público, numeración secuencial por secuencia, scoping del portal por JWT, firma HMAC del webhook de WhatsApp, credenciales de casillas cifradas AES-256-GCM, paginación server-side real). Sin embargo, se encontraron **varios problemas que deben resolverse antes de producción**, entre ellos:

1. **Las confirmaciones automáticas por email muestran el fragmento UUID del ticket (`Ticket #5B73DF28`) o el ID de Zammad en lugar del número público `TK-2026-XXXXX`.** Es el bug ya confirmado con logs reales (`email.service.ts:119`, `tickets.service.ts:404/518/668`).
2. **`POST /api/email/inbound` es público y sin autenticación ni firma** → cualquier persona que alcance el dominio público puede crear tickets/contactos/clientes y —si el toggle de auto-respuesta está activo— disparar emails salientes a direcciones arbitrarias.
3. **No existe aislamiento por empresa para el staff**: un técnico (perfil de técnico o rol con `tickets:assign`) ve/lee tickets, notas, clientes y documentos de TODAS las empresas. El commentario en `permissions.ts:10-11` declara "row-level customer_id" como intención, pero **no está implementado** para staff (solo para el rol Consulta y el portal de clientes).
4. **El threading de email depende 100% del asunto normalizado (`subject_key`); no se usan `Message-ID`/`In-Reply-To`/`References`** ni entrantes ni salientes. Un cliente que cambie el asunto rompe el hilo.
5. **Búsqueda por ID histórico de Zammad inexistente**: `legacy_zammad_id` (40.155 tickets) no participa en el buscador. Verificado con datos reales: buscar `12345` devuelve el ticket con `ticket_number=12345` (legacy 12413) y **no** el ticket legacy 12345 (ticket_number 12277).
6. **Registro en el portal inexistente** (no hay auto-registro) y asociación por dominio **sin excluir dominios personales** en el flujo runtime de email: un nuevo `@gmail.com` crea/reutiliza un cliente `"Cliente gmail.com"` que agruparía a todos los Gmail como "una misma empresa".
7. **Sin control de versiones** (no hay repo git) y **sin backup automatizado** (solo dumps manuales en `backup/`).
8. Ingresos de login (staff y portal) **sin rate-limit** (brute force posible); `forgot-password` sí lo tiene (5/h IP + 3/h IP+email).

---

## B. Arquitectura actual

### Canal → Ticket → Usuario → Empresa

- **Customer** (empresa): `customers` (PK `id`, `name`, soft-delete). 425 registros.
- **Contact** (persona): `contacts` (PK `id`, `customer_id` FK → customers, `email` [indexada], `phone`, `whatsapp` [sin índice], `portal_enabled`, `portal_password_hash`, `deleted_at`). 698 registros.
- **User/Técnico**: `users` (`role_id` → `roles`, `technician_id` → `technicians`). `technicians` (`user_id` unique, `whatsapp_phone`). Un técnico NO tiene `customer_id` → es global.
- **Ticket**: `tickets` (PK `id` uuid, `customer_id` FK, `contact_id` FK, `technician_id` FK, `ticket_number` int UNIQUE, `subject_key`, `source` varchar(20) = `manual|email|whatsapp|portal`, `status`, `priority`, `legacy_zammad_id`, `shadow`, `deleted_at`). 40.243 tickets; 40.155 con `legacy_zammad_id`.
- **Canales de entrada**:
  - Email: IMAP worker (`mailbox-worker.service.ts`, cron `*/1 * * * *`) → `inbound_mail_log` → `EmailService.ingest` → `TicketsService.upsertFromEmail`. Webhook interno `POST /api/email/inbound` (misma ingest, público sin firma).
  - WhatsApp: webhook Meta `POST /api/whatsapp/webhook` (firma HMAC `x-hub-signature-256` verificada) → chatbot → `TicketsService.upsertFromWhatsapp`.
  - Portal: `PortalService` (JWT tipo `portal`, scoped por `customer_id`).
  - Manual: staff.

### Ticket → Mensajes → Canal

- `ticket_messages` (PK `id`, `ticket_id` FK [indexada], `author_type`, `channel` (enum `email|portal|whatsapp`), `body`, `body_html`, `from_email`). 73.167 mensajes. La dedupe/correlación de email por canal:
  - **Entrante email**: `(contact_id, subject_key, shadow, status NOT IN resuelto/cerrado)` → append; reabre si estaba resuelto/cerrado. No usa Message-ID/References (ver C-problema 4).
  - **Entrante WhatsApp**: `(contact_id, source='whatsapp', status abierto)` más reciente → append; si no hay, chatbot→ticket nuevo. Sin ventana de tiempo, sin dedupe por `wamid`.
- `inbound_mail_log`: log/de-dupe del worker por `message_id` (sin índice en `message_id`).

### Numeración

- `ticket_number` (int, UNIQUE, NOT NULL) + secuencia global `ticket_number_seq`. Migración `20260904113522-AddTicketNumbers.ts` pobló legacy 1..N (orden created_at), setea la secuencia a `MAX(legacy_zammad_id)`, y los nativos continúan (hoy `ticket_number` máx 40.482, secuencia en 40.482).
- `ticketNumberDisplay()` → solo frontend (`frontend/lib/helpers.ts:44`), formato `TK-{año de created_at}-{ticket_number}`. No existe equivalente en backend.

---

## C. Problemas encontrados

### P1 — Emails muestran `Ticket #<HEX>` (UUID interno) o el ID de Zammad, no el `TK-2026-XXXXX`

```
Problema: Los 4 puntos de armado del identificador para mails salientes usan
`legacyZammadId || id.slice(0,8).toUpperCase()`:
  - email.service.ts:119 (confirmación "Recibimos tu solicitud")
  - tickets.service.ts:404 (ticket manual "Registramos tu solicitud")
  - tickets.service.ts:518 (in-progress / resuelto)
  - tickets.service.ts:668 (respuesta técnica "Re: ..." en el cuerpo)
Alimentan las plantillas de mail.service.ts (sendTicketReceived/CreatedManual/
InProgress/Resolved/Reply) cuyo subject y body imprimen opcionalmente el texto.
Ejemplos reales: "Ticket #5B73DF28", "Ticket #97232F50" (tickets nativos) y
"Ticket #12345" (legacy = ID de Zammad, no el TK-...). El número público solo
lo arma el frontend (ticketNumberDisplay en helpers.ts:44).
Impacto: Un cliente no puede citar su ticket correctamente; el número que ve en
el email no coincide con el que ve en la plataforma/portal; los legacy además
colisionan conceptualmente con el ID de Zammad histórico. Confusión y pérdida
de trazabilidad en producción con clientes reales.
Severidad: Crítica
Recomendación: Crear utilidad backend `ticketNumber(t)` = `TK-{año}-{n}` (mismo
formato que helpers.ts) y reemplazar las 4 líneas por `ticketNumber(ticket)`.
Aplicar también a los HEX de fusión en el frontend staff (ticket-card.tsx:56,
tickets/[id]/page.tsx:480/495/520/551/839).
¿Debe resolverse antes de producción?: Sí
Archivo(s) involucrado(s): backend/src/modules/email/email.service.ts:119,
backend/src/modules/tickets/tickets.service.ts:404,518,668,
backend/src/modules/mail/mail.service.ts:39,65,87,105,265,
frontend/lib/helpers.ts:44, frontend/components/ticket-card.tsx:56,
frontend/app/(app)/tickets/[id]/page.tsx:480,495,520,551,839
```

### P2 — `POST /api/email/inbound` público y sin firma

```
Problema: EmailController.inbound está marcado @Public() (email.controller.ts:13)
y no valida ningún header/secreto compartido ni repite el rate-limit. En
producción el dominio público (Caddy → backend) expone https://<dominio>/api/email/inbound.
El controller dice "protect this via a secret header (see ... notes in docs)" pero
ese secret NO existe en el código (grep x-*/sharedSecret/api-key: 0). Cualquiera
puede crear tickets/contactos/clientes por dominio y, si emailAutoResponseEnabled
estuviera activo, provocar envíos de correo a direcciones arbitrarias.
Impacto: Abuso/DoS (creación masiva de tickets/clientes basura), spoofing de
remitente ("recibimos tu solicitud" a víctimas, explotable como vector de phishing),
gasto de emails SMTP. Riesgo alto producción.
Severidad: Crítica
Recomendación: Requerir un header secreto compartido (ej. X-Ingest-Token) validado
en el controller (o un guard), configurado por env, y aplicarlo también el worker
IMAP. Alternativa mínima: rate-limit por IP + validación de dominio del remitente
(danger inherente de spoofing: la ingest cree cliente arbitrario).
¿Debe resolverse antes de producción?: Sí
Archivo(s) involucrado(s): backend/src/modules/email/email.controller.ts:13-17,
backend/src/modules/email/email.service.ts (ingest)
```

### P3 — Sin aislamiento por empresa para usuarios staff (técnicos ven todo)

```
Problema: La única row-scope para staff es applyRowScope (tickets.service.ts:91-101):
usuarios SIN technician_id y SIN tickets:assign solo ven sus own tickets (rol Consulta).
Cualquier técnico (o rol con tickets:assign: Supervisor/Coordinador/Administrador)
lee cualquier ticket, nota, cliente y documento de cualquier empresa. Verificado en
vivo: token de técnico maria@msp.local → GET /api/tickets/:id, /api/notes/:id (cliente
Big Five) y /api/customers/:id devuelven 200. Notas/documents/customers ni siquiera
tienen scope por owner: notes.service.ts:105-112 (findOne sin verificar), documents.
service.ts:234-248 (download sin scope), customers.controller (findCustomer sin scope).
El portal SÍ está correctamente scoped (customer_id del JWT, portal.guard.ts).
Impacto: Si el modelo de producción es "técnico con acceso limitado a ciertas
empresas", hoy es directamente imposible: no existe ese límite. Exposición cruzada
de clientes (datos de la competencia, documentos, notas) entre técnicos.
Severidad: Crítica (o decisión de diseño; si el producto así lo quiere, igual hay que
acotar notas/documentos/clientes por empresa para evitar fugas entre clientes pymes
que suelen tener técnicos distintos)
Recomendación: Definir y verificar el modelo: (a) si es multi-cliente con técnicos
globales, documentar la decisión y enfocar en los P mostrar; (b) si no, implementar
scoping por customer_id en una lista de customers permitidos por técnico/rol
(tabla técnico↔empresas) aplicada en listado, detalle, mensajes, adjuntos, notas,
documentos y downloads (extender el patrón de applyRowScope ya existente).
¿Debe resolverse antes de producción?: Sí (al menos definir la decisión; hoy no
hay ningún filtro, solo permiso de módulo)
Archivo(s) involucrado(s): backend/src/modules/tickets/tickets.service.ts:91-101,
backend/src/modules/notes/notes.service.ts:105-112,
backend/src/modules/documents/documents.service.ts:234-248,
backend/src/modules/customers/customers.controller.ts:40-44
```

### P4 — Threading de email solo por asunto normalizado; sin headers estándar

```
Problema: upsertFromEmail dedupe por (contact_id + subject_key + status abierto).
normalizeSubjectKey (backend/src/common/utils/subject-key.util.ts) es robusto, pero
no se usan Message-ID/In-Reply-To/References ni entrantes ni salientes. Message-ID
entrante se guarda en inbound_mail_log solo para de-dupe del worker; ingest lo ignora
(dto.messageId nunca se lee en email.service.ts). El reply del técnico no setea
In-Reply-To/References (mail.service.ts:345-378, solo from/to/subject/text/html).
Impacto: Un cliente que cambia el asunto manualmente ("te paso foto", "nuevo modelo")
rompe el hilo y crea un ticket NUEVO (duplicado) o un ticket abierto del mismo asunto
en vez de continuar. Es el mayor riesgo operativo de duplicados.
Severidad: Alta
Recomendación: Usar threading robusto: al crear ticket por email guardar
`Message-ID` entrante en ticket_messages (columna nueva nullable); en las salidas
(confirmación y replies) construir In-Reply-To/References = message-id del ticket;
en ingest priorizar matching por In-Reply-To/References (o Message-ID del ticket)
antes que por subject_key; subject_key queda como fallback. Actualizar normalizeSubjectKey
(o agregar) para incluir el número TK-... en el asunto saliente para reforzar el match.
¿Debe resolverse antes de producción?: Sí
Archivo(s) involucrado(s): backend/src/modules/tickets/tickets.service.ts:834-954,
backend/src/modules/email/email.service.ts (ingest), backend/src/modules/mail/mail.
service.ts:261-378, backend/src/entities/ticket-message.entity.ts
```

### P5 — Búsqueda no cubre legacy_zammad_id ni teléfono ni nombre de contacto/cliente

```
Problema: findAll (tickets.service.ts:110-118) busca solo title/subject_key/
ticket_number::text/el literal reconstruido 'TK-{año}-{ticket_number}'. No incluye
legacy_zammad_id, ni contact.phone/whatsapp, ni customer.name, ni contact.name, ni
UUID. Verificado con datos: ticket legacy 12345 (ticket_number 12277) NO aparece en la
búsqueda "12345"; aparece el ticket con ticket_number=12345 (legacy 12413) → resultado
INCORRECTO. Además el frontend del Cliente 360 filtra client-side por título sobre 200
filas (clientes/[id]/page.tsx:68-95).
Impacto: Un técnico que busca el ID histórico de Zammad de un cliente migrado obtiene
otro ticket o nada; no se puede buscar por teléfono/empresa/nombre de contacto en la
lista principal. Frustración y omisión de tickets.
Severidad: Alta
Recomendación: Ampliar el WHERE de búsqueda a legacy_zammad_id (::text), contact_name,
customer_name, contact_phone/whatsapp (con exists/joins). Y en el Cliente 360, pasar la
búsqueda al backend (server-side) en vez de filtrar 200 filas en el navegador.
¿Debe resolverse antes de producción?: Sí
Archivo(s) involucrado(s): backend/src/modules/tickets/tickets.service.ts:110-118,
frontend/app/(app)/clientes/[id]/page.tsx:68-95
```

### P6 — Sin filtro por canal (source) en el listado de tickets

```
Problema: El ticket tiene source (email/whatsapp/portal/manual) y la UI muestra el icono
(ticket-list.tsx:74, SOURCE_ICONS helpers.ts:155-173), pero NO existe filtro por canal
ni en el endpoint (ListTicketsQuery dto.ts:124-195 no tiene source/channel) ni en la
página (tickets/page.tsx: solo tray/search/status/merge/shadow).
Impacto: Imposible segmentar "tickets de WhatsApp" vs "de email" en el listado; el icono
es decorativo.
Severidad: Media
Recomendación: Agregar `source` (multivalor) al DTO y `andWhere('t.source IN (:...)')`,
y un `select` de canales en la página.
¿Debe resolverse antes de producción?: No (nice-to-have)
Archivo(s) involucrado(s): backend/src/modules/tickets/dto.ts:124-195,
backend/src/modules/tickets/tickets.service.ts:103-198,
frontend/app/(app)/tickets/page.tsx
```

### P7 — Sin rate-limit en logins (staff y portal)

```
Problema: RateLimitService solo se usa en forgot-password (auth.service.ts:206-207 y
portal.service.ts:226-227, 5/h IP + 3/h IP+email). /api/auth/login y
/api/portal/auth/login no tienen límite ni bloqueo por intentos (grep en backend/src:
Throttler: 0; limit/attempt en auth.service: solo los 2 forgot).
Impacto: Fuerza bruta de contraseñas de usuarios staff y contactos del portal.
Severidad: Alta
Recomendación: Aplicar rate-limit a /auth/login y /portal/auth/login (por IP y por
IP+email), p.ej. 5 intentos/h de login fallido + backoff, con el RateLimitService ya
existente (usa Redis).
¿Debe resolverse antes de producción?: Sí
Archivo(s) involucrado(s): backend/src/common/auth/rate-limit.service.ts,
backend/src/modules/auth/auth.service.ts/login, backend/src/modules/portal/portal.
service.ts/login
```

### P8 — Asociación por dominio sin exclusión de dominios personales (runtime email)

```
Problema: ensureContactForUnknownSender (email.service.ts:166-194) asigna customer por
dominio con ILIKE %dominio% y si no existe crea "Cliente {dominio}". No usa
isPersonalEmailDomain (backend/src/common/utils/email-domain.ts la definen y solo la
usan suggestByDomain y el import Zammad). Un email nuevo @gmail.com crea/reutiliza
"Cliente gmail.com" → todos los Gmail del mundo en una misma "empresa". El import Zammad
usa "Clientes particulares" (zammad-meta-import.service.ts:127). Rutas inconsistentes.
Verificado en BD: los 125 contactos gmail/hotmail/outlook/yahoo están repartidos en 13
customers, el mayor = "Clientes particulares" (74).
Impacto: En producción, un cliente nuevo con @gmail.com (muy común en pymes) queda
agrupado con cualquier otro Gmail como si fueran la misma empresa; el portal de un
contacto vería tickets de otro Gmail. Fuga de datos entre personas.
Severidad: Crítica
Recomendación: En el flujo runtime (email ingest) aplicar isPersonalEmailDomain: si el
dominio es personal → customer "Clientes particulares" (o uno e2e de referencia), igual
que el import; para dominios corporativos reutilizar customer por ILIKE %dominio% pero
solo si existe como nombre comercial razonable (evitar match parcial tipo "gmail").
¿Debe resolverse antes de producción?: Sí
Archivo(s) involucrado(s): backend/src/modules/email/email.service.ts:166-194,
backend/src/common/utils/email-domain.ts
```

### P9 — No existe auto-registro en el portal

```
Problema: No hay endpoint /portal/register ni flujo de alta. Los únicos caminos para
que exista un contacto de portal: email entrante (auto-habilita portal vía
ensurePortalEnabled), WhatsApp (NO habilita portal), staff manual (admin crea/habilita/
fija password), import Zammad. El login del portal es solo email+password + forgot/
reset (portal.controller.ts: solo login/refresh/forgot/reset + CRUD).
Impacto: Un cliente sin ticket previo no puede registrarse. No es un bug per se, es una
restricción funcional; a definir comercialmente.
Severidad: Media (funcional, no seguridad)
Recomendación: Decidir explícitamente si se quiere auto-registro; hoy no existe.
¿Debe resolverse antes de producción?: No (decisión de producto)
Archivo(s) involucrado(s): backend/src/modules/portal/portal.controller.ts,
frontend/app/portal/login/page.tsx
```

### P10 — WhatsApp: sin dedupe por wamid, sin state de delivery, sin ventana de conversación

```
Problema: handleIncoming (whatsapp.service.ts:167-172) ignora msg.id (wamid). No hay
tabla de conversación (solo contacts.whatsapp_menu_state jsonb). El criterio "mismo
hilo" = (contact, source whatsapp, status no cerrado) sin ventana de tiempo: un ticket
en 'esperando_cliente' de hace semanas sigue capturando mensajes. Los receipts de Meta
(value.statuses) se ignoran; los envíos no persisten delivery/error (sendOutbound solo
loguea). No hay índice en contacts.whatsapp (lookup full-scan).
Impacto: Reintentos de Meta duplican mensajes; un cliente retomando un tema viejo por
WA continúa un hilo de hace un mes (o no, según estado); sin evidencia de entrega.
Severidad: Media
Recomendación: Persistir wamid en ticket_messages (columna nullable + índice) y dedupe
por él; procesar statuses para marcar estado; definir ventana de inactividad (ej. 24 h)
para cerrar / preguntar si es un tema nuevo; indexar contacts.whatsapp.
¿Debe resolverse antes de producción?: No (mejora operativa; la dedupe por wamid es clave
si hay reintentos)
Archivo(s) involucrado(s): backend/src/modules/whatsapp/whatsapp.service.ts:147-198,
291-355,424-446, backend/src/entities/contact.entity.ts:23-27,
backend/src/entities/ticket-message.entity.ts
```

### P11 — Sin control de versiones (git) en el repositorio del proyecto

```
Problema: El workspace no es un repo git (no existe .git). Todo el código/historial de
cambios vive solo en disco + dumps manuales en backup/.
Impacto: Na a permite comparar/volver a versiones de código, revisar diffs, ni
trackear cambios con 30+ carpetas de backup ad-hoc; riesgo de pérdida o regresión
irreversible en producción.
Severidad: Alta
Recomendación: Inicializar git y commit inicial (con .gitignore de .env, node_modules,
backups de datos). 
¿Debe resolverse antes de producción?: Sí
Archivo(s) involucrado(s): . (raíz; nuevo .git + .gitignore)
```

### P12 — Sin backup automatizado de la base de datos

```
Problema: docker-compose.prod.yml no define servicio de backup/cron. backup/ contiene
solo dumps manuales (algún .dump de preparación). No hay pg_dump programado ni retención.
Impacto: Pérdida de datos de clientes ante fallo (40k tickets, 73k mensajes) sin
posibilidad de recuperar.
Severidad: Alta
Recomendación: Añadir job pg_dump diario (puede ser un servicio cron en el VPS o un
sidecar en compose) con retención (ej. 30d) y copia off-site; probar restore.
¿Debe resolverse antes de producción?: Sí
Archivo(s) involucrado(s): docker-compose.prod.yml (nuevo servicio backup)
```

### P13 — MinIO console expuesto en el dominio público de producción

```
Problema: caddy/Caddyfile enrutó handle /minio-console/* → minio:9001. En producción
https://<dominio>/minio-console queda públicamente alcanzable (autenticación de MinIO
de por medio, pero expuesto a internet + enumeración).
Impacto: Superficie de ataque extra (consola de objetos con credenciales root si se
filtran); exposición no necesaria para el operador.
Severidad: Media
Recomendación: Quitar el bloque /minio-console del Caddyfile de producción (admin solo
por SSH/socat) o limitarlo a IP del operador.
¿Debe resolverse antes de producción?: Sí (rápido)
Archivo(s) involucrado(s): caddy/Caddyfile
```

### P14 — Cuentas demo con contraseña pública y activas en la BD actual

```
Problema: El seed crea ana@/lucas@/maria@/pedro@msp.local con password 'demo1234'
(seed.service.ts:99-172, contraseña documentada en el repo). En la BD actual están
activas (Supervisor y Coordinador con tickets:assign) y maria/pedro son técnicos
activos. Si esta BD se copiara a producción, esas cuentas seguirían válidas.
Rol Consulta (consulta@msp.local) también activo. El login staff no tiene rate-limit (P7).
Impacto: Acceso no autorizado si la BD se promueve sin rotar credenciales.
Severidad: Alta (condicional a que la BD vaya a prod con esas cuentas)
Recomendación: Rotar/eliminar cuentas demo antes del pase a producción (setup manual o
script de "no-seed"). En esta BD de trabajo, dejar solo cuentas reales.
¿Debe resolverse antes de producción?: Sí
Archivo(s) involucrado(s): backend/src/database/seeds/seed.service.ts:94-174
```

### P15 — Índices faltantes para volumen actual (40k tickets)

```
Problema: tickets.ticket_number tiene PK y UNIQUE (ticket_number). Faltan índices para
los filtros de búsqueda: title/subject_key (ILIKE %x% igual no los usa), created_at
(ORDER BY/ límite), source (futuro filtro canal). contacts.whatsapp y contacts.phone SIN
índice (WhatsApp resuelve por full-scan). inbound_mail_log.message_id SIN índice (de-dupe
del worker = full-scan). notifications.user_id existe pero el query de unread (user_id +
read) no lo cubre compuesto.
Impacto: Con 40k tickets y 10k+ mensajes de WA futuros, listar/buscar degrada
progresivamente; la de-dupe del worker hace full-scan de inbound_mail_log.
Severidad: Media (hoy 40k es manejable; con 10x no)
Recomendación: Crear índices: tickets(created_at DESC, status), tickets(source),
contacts(whatsapp) y contacts(phone), inbound_mail_log(message_id),
notifications(user_id, read_at) compuesto.
¿Debe resolverse antes de producción?: No (opcional ante crecimiento)
Archivo(s) involucrado(s): backend/src/entities/*.entity.ts (decoradores @Index +
synchronize) y/o migración index
```

### P16 — Diversos menores

```
Problema:
 1) workshop.service.ts:135,583,724 muestra `${eq.id.slice(0,8)}` (HEX de equipo) en
    comprobantes/PDF/emails de taller ("E-XXXX"). Mismo patrón semántico que P1 (externo).
 2) Lógica de window "ticket abierto" de WhatsApp sin ventana temporal (ver P10).
 3) portal createTicket usa nextval (correcto) — pero coinciden numeración portal/taller
    y email/manual en una única secuencia global (sin colisión, OK).
 4) Consu rol tiene DOCUMENTS_WRITE (permissions.ts:194) pese a describirse read-only.
 5) GET /api/health público (health.controller.ts:11) expone estado de DB interna.
 6) Dev compose expone postgres/redis/minio en el host (dev-only, ok si no va a prod).
 7) inbound_mail_log sin job de retención (docs mencionan 30 días).
Impacto: Menor/operativo.
Severidad: Baja
Recomendación: 1) usar ticketNumberDisplay/equivalente en taller; 2) ver P10; 4) revisar
si Consulta debe poder escribir documentos; 5) restringir /health o desactivar detalle; 
6) asegurar que el deploy prod usa docker-compose.prod.yml; 7) job de limpieza.
¿Debe resolverse antes de producción?: No (opcional)
Archivo(s) involucrado(s): backend/src/modules/workshop/workshop.service.ts:135,583,724,
backend/src/common/auth/permissions.ts:187-196, backend/src/health/health.controller.ts,
docker-compose.dev.yml
```

---

## D. Solución propuesta (por severidad Crítica / Alta)

### D1 (P1) — Número único en todos los canales
Crear util backend `formatTicketNumber(ticket)` = `TK-${year(createdAt)}-${ticketNumber}` + versión string para legacy (o fallback genérico). Reemplazar las 4 líneas:
- `email.service.ts:119`
- `tickets.service.ts:404, 518, 668`
Frontend: reemplazar los 6 HEX de fusión por `ticketNumberDisplay(...)` (fetch del ticket padre/hijo ya presente). Mensajes luego del P4 podrían además incluir el TK en el asunto saliente.

### D2 (P2) — Proteger `/api/email/inbound`
- Env `INGEST_SECRET`; el controller valida header `x-ingest-token` (timing-safe) si `INGEST_SECRET` está configurado (backward-compat solo si no está configurado); el worker IMAP manda el header.
- Agregar validación de remitente: direcciones reservadas/`<dominio>` interno descartadas (el LOOP-GUARD ya cubre auto-mails).
- Evaluar rate-limit por IP.

### D3 (P3) — Definir y aplicar scoping por empresa
Decisión de producto primero (¿multi-tenant o técnicos globales?). Si se quiere por-empresa:
- Tabla `technician_customers` (technician_id, customer_id) o columna `customer_ids`/relación en technicians.
- En `applyRowScope`: si el actor tiene `technicianId` y NO es admin/supervisor → `AND t.customer_id IN (:...allowed)`.
- Extender a: `notes` (scope por customer_id del note), `documents` (scope por customer_id del doc, incluido download), `customers` (find por id verifica pertenencia), mensajes/adjuntos de tickets (ya cubiertos por el ticket), workshop/calendar.
- Reusar el patrón comprobado del portal (customer_id desde JWT) pero para técnicos con lista de empresas.

### D4 (P4) — Threading por headers estándar
- `ticket_messages.message_id` (nullable) — guardar Message-ID entrante del primer mensaje del ticket (o por ticket).
- En salidas (confirmación y reply): `messageId = <${uuid}@solidocs>` persistido; `In-Reply-To`/`References` = referencia del ticket cuando aplique (reply); la confirmación puede incluir `Message-ID` propio.
- En ingest: primero match por `In-Reply-To`/`References`/`Message-ID` del ticket (índice en la columna); si no matchea, fallback al `subject_key` + contacto actual.

### D5 (P5) — Búsqueda extendida
Ampliar el WHERE de búsqueda con: `legacy_zammad_id::text ILIKE`, `contact.name ILIKE`, `customer.name ILIKE`, `contact.phone/whatsapp ILIKE` (joins ya existen en `listQuery`). Mover el 360 a server-side.

### D6 (P7) — Rate-limit logins
Extender `RateLimitService.check` a `/auth/login` (falta password→login fallido) por IP+email, y `/portal/auth/login` igual. Máximos tipo 5/h con backoff, bloqueo de cuenta opcional.

### D7 (P8) — Dominios personales en runtime
En `ensureContactForUnknownSender`: si `isPersonalEmailDomain(domain)` → customer `Clientes particulares` (buscar/crear el genérico, igual al import Zammad); si corporativo → reutilizar customer cuyo nombre contenga el dominio SOLO si parece nombre comercial (y no colisionar con dominios personales tipo "gmail"). Esto evita agrupar Gmail.
Además: al habilitar portal (ensurePortalEnabled) si el contacto es de dominios personales, igual se habilita (correcto), pero el Hito D3/D7 no debe mezclar clientes personales entre sí: usar SIEMPRE el customer "Clientes particulares" único (un solo bucket, no uno por dominio).

### D8 (P11/P12) — SCM + backups
- `git init` + `.gitignore` (`.env*`, `node_modules/`, `backup/*.dump`, `dist/`, `.next/`).
- Servicio `backup` en compose prod: `pg_dump` diario (cron) a volumen persistente + retención 30 días + nota de restore en docs; probar.

### D9 (P13) — Quitar `/minio-console` de Caddy prod (o restringir por IP).
### D10 (P14) — Script de higiene pre-producción: borrar/rotar cuentas `*@msp.local` y obligar cambio de contraseña para las cuentas reales con password débil.

---

## E. Cambios de código estimados

| Problema | Archivos tocados |
|---|---|
| P1 | `backend/src/common/utils/ticket-number.util.ts` (nuevo), `email.service.ts`, `tickets.service.ts`, `mail.service.ts`, `frontend/lib/helpers.ts` (export backend ya existe display), `ticket-card.tsx`, `tickets/[id]/page.tsx` |
| P2 | `email.controller.ts` (guard/header), `mailbox-worker.service.ts` (header), `config/configuration.ts`, `.env(.prod)` |
| P3 | `technicians`/nueva entidad o DTO, `tickets.service.ts` (applyRowScope), `notes.service.ts`, `documents.service.ts`, `customers.controller/service`, guards/decoradores |
| P4 | `ticket-message.entity.ts`, `email.service.ts`, `mail.service.ts`, `tickets.service.ts` (upsert/reply), DTO ingest |
| P5 | `tickets.service.ts` (WHERE), `frontend/app/(app)/clientes/[id]/page.tsx` |
| P6 | `dto.ts`, `tickets.service.ts`, `frontend/app/(app)/tickets/page.tsx` |
| P7 | `auth.service.ts`, `portal.service.ts`, `rate-limit.service.ts` (reuso) |
| P8 | `email.service.ts` (ensureContactForUnknownSender) |
| P10 | `whatsapp.service.ts`, `ticket-message.entity.ts`, `contact.entity.ts` |
| P11 | `.git`, `.gitignore` |
| P12 | `docker-compose.prod.yml`, script `scripts/backup-db.sh` |
| P13 | `caddy/Caddyfile` |
| P14 | script `scripts/higiene-pre-produccion.ts` (o manual) |
| P15 | entidades `@Index` + migración |
| P16 | workshop.service, permissions.ts, health.controller |

---

## F. Cambios de base de datos estimados

- `ticket_messages.message_id` varchar(400) nullable + índice (P4, P10).
- Opcional `tickets.search` o índice GIN/tsvector para búsqueda global (P5, P15).
- Índices (P15): `tickets(created_at DESC, status)`, `tickets(source)`, `inbound_mail_log(message_id)`, `contacts(whatsapp)`, `contacts(phone)`, `notifications(user_id, read_at)`.
- P3 (si aplica): tabla `technician_customers` (technician_id FK, customer_id FK, PK compuesta) — sin migración de datos.
- P8: sin cambio de esquema (uso de "Clientes particulares" existente); eventual INDEX en contacts(email) ya existe.
- P2: sin cambio de esquema.
- Migraciones: usar las ya existentes (`20260904113522-AddTicketNumbers.ts` como patrón); el proyecto usa `synchronize:true` para columnas + migraciones para datos.

---

## G. Estrategia de migración

- **P1 (números)**: solo presentación; no requiere migración de datos. Aplicar en rama feature + verificación puntual (un email de confirmación real con TK-...). Rollback: revertir diffs.
- **P2 (ingest secret)**: aditivo; despliegue 2 fases — primero el backend acepta header si está (flag env), después se activa en worker; si algo falla, apagar el flag. Sin pérdida de datos (ingest sigue logueando en `inbound_mail_log`).
- **P3 (scoping)**: introducir columna/tabla con default = todos (para no bloquear operación) y luego ir cerrando por role. Rollback: vaciar `technician_customers` = vuelve a comportamiento actual.
- **P4 (threading)**: aditivo — nuevas columnas nullables; el fallback por subject_key se mantiene como primera prioridad durante N días y luego se invierte el orden tras monitorear duplicados. Reversión inmediata sin tocar datos.
- **P5/P6/P7/P15**: sin migración de datos; DDL aditivo (CREATE INDEX es rápido en 40k). Índice con `CREATE INDEX CONCURRENTLY` si se aplica en producción.
- **P8 (dominios personales)**: correr script de re-clasificación de contactos ya creados con `Cliente {dominio}` de dominios personales → `Clientes particulares` (mover contactos y tickets por customer_id; transaccional, idempotente, con backup previo como los `.dump` ya existentes). Backout: re-ejecutar script inverso o restaurar dump.
- **P12 (backup)**: primer pg_dump completo ANTES de cualquier cambio; verificar restore en instancia de prueba.
- **Regla global**: todo cambio de esquema/datos en producción requiere dumper previo (`backup/ops_msp_pre_*.dump` — patrón ya usado) y aprobación en prompt separado (este documento NO implementa nada).

---

## Fortalezas confirmadas (no son problemas)

- Numeración `ticket_number` + secuencia global (UNIQUE/NOT NULL) correcta y estable.
- Portal scoped por customer_id del JWT (multi-tenant correcto para clientes).
- Webhook WhatsApp con firma HMAC verificada; GET challenge con verify_token.
- Credenciales de mailboxes cifradas (AES-256-GCM, `ENCRYPTION_SECRET`) y nunca expuestas por API.
- Global guards JWT + RolesGuard; permisos leídos frescos por request.
- Paginación server-side real (`LIMIT/OFFSET` + COUNT), cap de 500.
- Búsqueda y normalización de `subject_key` robusta (tests incluidos).
- Auditoría con interceptor sobre entidades clave.
- WhatsApp: al fallar envío de respuesta se inserta mensaje de sistema visible (no fallo silencioso).