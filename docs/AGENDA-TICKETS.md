# Agenda ↔ Tickets: citas/visitas con múltiples técnicos

## Modelo de datos (extensión de `appointments`)
- **`Appointment`** ganó:
  - `ticket_id` (FK → `tickets`, **opcional/nullable**) — una cita puede existir sin ticket (no rompe el uso actual de Agenda).
  - Relación `technicianLinks` (OneToMany → `appointment_technicians`).
- **Nueva tabla `appointment_technicians`** (M:N `appointments` ↔ `technicians`):
  - `appointment_id` + `technician_id` (PK compuesta), cascade.
  - Permite **varios técnicos por cita**. El responsable principal sigue siendo
    `Appointment.technicianId` (compatibilidad), y **también** se incluye en la lista M:N.
- Los recordatorios **no se tocaron**: el frontend (`useAgendaReminders`) consulta
  `/appointments?from=&to=` por rango, filtra `reminderMinutes` y dispara alerta. Como
  el polling no filtra por técnico, **todos los técnicos asignados ven la misma cita y
  reciben el recordatorio** — no solo el responsable.

## Backend (`modules/calendar`)
- `CreateAppointmentDto`/`UpdateAppointmentDto` ganaron `ticketId?` y `technicianIds?: string[]`.
- `ListCalendarQuery` ganó `ticketId?` (para listar citas de un ticket).
- `createAppointment`/`updateAppointment`:
  - Guardan `ticketId`.
  - `replaceTechnicianLinks()` reemplaza la lista M:N (incluye siempre al responsable
    principal si no viene en `technicianIds`).
- `getAppointments` ahora carga `ticket` y `technicianLinks.technician.user` (para mostrar
  técnicos y link del ticket).
- `appearance`: `getAppointment`/create retornan las mismas relaciones.

## Frontend
- **Detalle de ticket** (`/tickets/[id]`): nueva sección **"Citas agendadas"**
  (`components/ticket-appointments.tsx`):
  - Lista de citas (fecha/hora, estado, técnicos asignados, link "ver en agenda").
  - Botón **"+ agendar cita"** → formulario con fecha/hora, duración, y **selector
    múltiple de técnicos** (autocomplete). Crea la cita con `ticketId`, `technicianId`
    (primero) y `technicianIds` (todos).
- **Vista Agenda** (`/agenda`): las citas vinculadas a un ticket muestran un **badge
  "🔗 ticket"** con enlace directo a `/tickets/<id>`.
- **Contacto en el SLA** (Parte 5): el meta del Card SLA ahora muestra
  `contacto: <nombre> (<email>)` — ej. "Andrés Iñiguez (andres@granjaalmeyra.com.ar)".

## Verificación en vivo (API real)
- Cita con **2 técnicos** + ticket → `technicianLinks: [Pedro Técnico, María Técnica]`,
  `ticketId` vinculado; `appointments?ticketId=` la devuelve con `ticket.id`.
- **2 citas** en el mismo ticket coexisten sin problema.
- Contacto: el ticket devuelve `contact.email` (para el meta SLA).

## Alcance / notas
- Citass de Agenda sin ticket siguen igual (campo opcional).
- El recordatorio se mantiene como antes (por cita, todos los técnicos lo ven).
- Técnicos firmados: `technicianId` = responsable principal (compatibilidad), y
  `appointment_technicians` = lista completa (incluye al principal).

## Backups / rollback
- `backup\agenda-tickets\` → `appointment.entity.ts`, `appointment-technician.entity.ts`,
  `calendar.service.ts`, `calendar.module.ts`, `calendar-dto.ts`, `ticket-appointments.tsx`,
  `agenda-page.tsx`, `tickets-id-page.tsx`.

## Fix selector de técnicos (crash + desplegable multi-select)
**Causa raíz del crash**: `components/ticket-appointments.tsx` esperaba `{ id, name }`
direcamente de la API `/technicians`, pero la API devuelve el nombre en **`user.name`**.
En consecuencia `t.name` era siempre `undefined` y al escribir en el buscador
`t.name.toLowerCase()` rompía con `TypeError`. (Los 5 técnicos reales SÍ tienen nombre
en `user.name`, así que no era un problema de datos vacíos sino de mapeo.)

**Correcciones**:
- Mapeo corregido a `techName = t.name || t.user?.name || 'Técnico sin nombre'`
  (fallback ante cualquier tecnico sin nombre, sin importar la causa).
- Buscador de texto libre reemplazado por un **desplegable de selección múltiple**:
  botón que abre una lista con **checkboxes** de todos los técnicos; se elige de la lista
  sin escribir nada. Adentro del desplegable hay un filtro opcional (para listas largas)
  que actúa sobre `techOptions` ya mapeadas, blindado con `(label ?? '')`—no puede romper.
- Al cerrar, resumen de seleccionados como pills removibles.

**Verificación en vivo vía API**:
- 5 técnicos con `user.name` (Axel, Felipe, Joaquín, María Técnica, Pedro Técnico) → el
  mapeo los muestra correctamente, sin undefined.
- Selección de 2 técnicos → `POST /appointments` 201, `technicianLinks: [Axel, Felipe]`,
  cita visible en `?ticketId=`. Cita de prueba eliminada luego.
- No-regresión: `/`, `/tickets`, detalle de ticket, `/agenda`, `/clientes`, `/documentos`,
  `/notas`, `/dashboard` → 200. `tsc` 0 errores en el componente.

**Backup**: `backup\agenda-tickets\multi-select-fix\ticket-appointments.tsx.bak`.


---

## Eventos privados en la Agenda � 2026-09-04

Se agreg� privacidad por evento en `appointments`:
- **`is_private`** (boolean, default false): evento visible solo para quien lo cre�.
  Ning�n otro rol tiene excepci�n.
- **`created_by_user_id`** (uuid, FK a users, nullable): el usuario autenticado que
  cre� el turno. Los registros hist�ricos (sin este dato) quedan `null` y
  `is_private = false` (comportamiento actual preservado).

### Backend
- `createAppointment` setea `created_by_user_id = actor.id` y acepta `isPrivate`.
- `updateAppointment` acepta `isPrivate`.
- `getAppointments`/`getAppointment` reciben el usuario autenticado y **filtran**:
  un evento `is_private = true` solo aparece (listado) o se puede leer (detalle)
  si `created_by_user_id == actor.id`; si no, el detalle devuelve 404.
- Se incluye la relaci�n `createdBy` (con el nombre del usuario) en las respuestas.

### Frontend
- Formulario "Nuevo turno" (agenda) + modal "Editar turno" (`activity-detail`) +
  form de "Agendar cita" (ticket): checkbox **"Privado (solo yo lo veo)"**.
- La vista de la Agenda (chips) y el modal muestran **qui�n cre�** cada turno
  (`createdBy.name`); para hist�ricos sin creador ? **"Creador desconocido"**.
- Los eventos privados no llegan desde el backend a quien no es su due�o (la
  protecci�n es del lado del servidor).

### Verificaci�n
- Evento privado creado por A ? A lo ve (listado + detalle 200).
- Usuario B ? no aparece en su listado ni se puede leer por ID (404).
- Evento no privado ? visible para ambos.
- `createdBy.name` presente en listado y detalle.
- Backend `Found 0 errors`; frontend 200.


---

## Email de recordatorio para citas de la Agenda � 2026-09-04

La columna `appointments.reminder_minutes` ya exist�a pero nunca se usaba. Se
implement� el env�o de email de recordatorio al/los t�cnico(s) asignado(s).

### Backend
- **Columna** `appointments.reminder_sent_at` (timestamptz, nullable): marca cu�ndo
  se envi� (o se intent�) el recordatorio, para que el cron no lo reenv�e.
  Migraci�n `AddAppointmentReminderSentAt`.
- **`MailService.sendAppointmentReminder(to, opts)`**: plantilla es-AR con asunto
  "Recordatorio: {asunto} � {hora}" y cuerpo con asunto, fecha/hora, cliente y
  notas (opcionales). Reusa el `send()` privado (SMTP del mailbox).
- **`JobsService.checkAppointmentReminders()`** (llamado desde el cron `*/5`):
  - Busca citas con `reminder_minutes IS NOT NULL`, `reminder_sent_at IS NULL`,
    `start_at > now()` y `start_at - reminder_minutes <= now()` (ventana iniciada).
  - Re�ne los t�cnicos (principal `technicianId` + `technicianLinks` M:N, sin
    duplicar) con su email v�a `technician.user`.
  - Env�a el recordatorio a cada uno; si no tiene email o falla, loguea
    `WARN`/`ERROR` y **marca igual `reminder_sent_at`** (no reintenta en loop
    infinito � decisi�n documentada).

### Verificaci�n
- Cita con `reminder_minutes=25` y `start_at` en el futuro ? el cron envi� el
  recordatorio (log `[MailService] Recordatorio cita enviado a ...`).
- `reminder_sent_at` qued� seteado; en la siguiente corrida **no** se reenvi�
  (la query lo excluye; conteo de env�os se mantuvo en 1).
- Cita sin `reminder_minutes` (null) ? nunca se elige.
- Cita con **2 t�cnicos** ? se envi� a ambos (pedro@ y maria@).
- Backend `Found 0 errors`.


---

## Recordatorio de citas por WhatsApp para técnicos — 2026-09-05

Suma el mismo recordatorio de Agenda por **WhatsApp** (además del email), reusando
el canal de `WhatsappService` pero con **plantilla pre-aprobada de Meta** (los
mensajes iniciados por la empresa fuera de la ventana de 24 h NO admiten texto
libre, solo templates).

### Decisión de modelo: teléfono en `technicians` (no en `users`)
- Se agregó `technicians.whatsapp_phone` (varchar 40, nullable, solo dígitos).
- **Por qué en el perfil de técnico y no en User**: `User` es la capa de
  autenticación (nombre/email/rol) compartida por todos los roles; el teléfono es
  un dato **operativo de despacho** que va junto a `schedule`, `status`, `notes`
  del perfil de técnico. Es el mismo criterio que el lado cliente, donde el
  teléfono/WhatsApp vive en `Contact` y no en `Customer`.
- Contactos de la API: `POST/PATCH /technicians` aceptan `whatsappPhone` (solo
  dígitos, validado con `@Matches(/^\d+$/)`).

### Independencia de canales: `whatsapp_reminder_sent_at`
- Se agregó `appointments.whatsapp_reminder_sent_at` (timestamptz, nullable)
  **separada** de `reminder_sent_at`, para controlar cada canal por su cuenta:
  - **Email**: se marca siempre tras el intento (comportamiento original, no
    reintenta en loop).
  - **WhatsApp**: se marca SOLO si al menos un envío fue exitoso; si falla todo
    (plantilla sin aprobar / sin teléfono / sin credenciales), queda NULL y el
    cron lo **reintenta en el próximo ciclo** sin re-enviar el email.
  - La query del cron ahora selecciona citas con
    `reminder_sent_at IS NULL OR whatsapp_reminder_sent_at IS NULL`.

### Backend (`JobsService` + `WhatsappService`)
- `checkAppointmentReminders()` además del email, por cada técnico asignado
  (principal + `technicianLinks`, sin duplicar):
  - Si tiene `whatsapp_phone` → llama a
    `WhatsappService.sendAppointmentReminderTemplate(to, customerName, startAt)`.
  - Payload `type: "template"` con `template.name` + `template.components[].body.parameters`
    (NO `type: "text"`).
  - Fallo silencioso: solo `WARN`/`ERROR` de log; **no** afecta el email.
- Constante `APPOINTMENT_REMINDER_TEMPLATE = 'appointment_reminder'` (fácil de
  cambiar si el nombre aprobado en Meta difiere).

### Plantilla de Meta (paso manual, fuera del código)
Crear/someter en Meta Business Manager (categoría **Utility**), con el texto
sugerido y variables numeradas:
```
Recordatorio: tenés un turno asignado con {{1}} a las {{2}}.
```
- `{{1}}` = cliente/sitio, `{{2}}` = hora del turno (es-AR, TZ Argentina).
- Nombre exacto/lenguaje (`es_AR`) a confirmar según acepte el editor de Meta;
  ajustar la constante si difiere del valor por defecto.

### Verificación en desarrollo
En este entorno NO hay credenciales reales de WhatsApp → el envío **falla en
silencioso** (esperado). Se confirmó:
- Cita con **2 técnicos** (Axel + Felipe, ambos con `whatsapp_phone`): el cron
  intentó WhatsApp a **cada uno**, logueando `[CITA-WA] ... WhatsApp no
  configurado (faltan credenciales) ... (se reintenta en próximo ciclo)`.
- **Email sin cambios**: ambos recibieron el email normalmente (`[CITA-REMINDER]`).
- Con `reminder_sent_at` ya seteado y `whatsapp_reminder_sent_at` NULL: en el
  ciclo siguiente se **reintentó WhatsApp** y **NO** se reenvió el email
  (independencia de canales confirmada).
- Migración aplicada, `whatsapp_phone`/`whatsapp_reminder_sent_at` presentes en
  DB; backend `Found 0 errors`.
