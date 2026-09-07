# Reglas de enrutamiento de email ("cajones")

Gestión **100% manual** desde la UI (pantalla `Casillas` → panel "Reglas de
enrutamiento"), sin cambios de código para dar de alta, editar, reordenar o
desactivar una regla.

---

## Panel de reglas (`/casillas`)

El selector de casilla en la pantalla alimenta el `MailboxRulesPanel`.

### Qué ofrece
1. **Alta manual** de una regla: remitente (patrón/wildcard, ej. `*@mikrotik-alerts.com`),
   asunto (contiene/regex simple), destino (`ticket` / `document` / `discard`),
   estrategia de cliente, y **prioridad/orden** editable.
2. **Edición y borrado** de reglas existentes desde la misma pantalla.
3. **Toggle activa/inactiva** (sin borrar la regla).
4. **Catch-all por casilla** (destino por defecto) editable: lo que no matchea
   ninguna regla específica cae en ese destino. Se guarda en
   `mailboxes.default_destination` (antes estaba hardcodeado a `ticket`).
5. **"Crear regla para este remitente"**: precompleta remitente + casilla desde un
   correo reciente sin regla.
6. **Modo prueba / preview**: botón "probar regla" que cuenta, sobre los últimos
   30 días de `inbound_mail_log` de esa casilla, cuántos correos matchearían la
   regla (y a qué destino), con muestras, para evitar que una regla amplia mande
   de más a `discard`.

### Wildcards
Un patrón con `*` actúa como comodín (cualquier secuencia): `*@mikrotik-alerts.com`
matchea cualquier remitente de ese dominio. Sin `*`, el patrón se escapa y se
prueba como substring (case-insensitive).

### Prioridad
Las reglas activas se evalúan por `priority` ascendente (menor = primero); la
primera que matchea decide. Verificable en vivo: dos reglas que matchean el mismo
correo gana la de menor prioridad.

---

## Modo sombra (`soporte@solidocs.com.ar`)

`shadow_mode = true`: el worker lee pero **no** marca leídos, no borra, no
responde. En sombra ahora también registra los correos en `inbound_mail_log`
(`routed=false`) para que el preview / vista "sin regla" tenga datos reales
sobre qué se hubiera enrutado, sin generar tickets/documentos reales.

---

## Casillas de referencia (Parte 2)

| Casilla | Host IMAP | Catch-all | Sombre | Notas |
|---|---|---|---|---|
| `mkbackups@solidocs.com.ar` | `c1931856.ferozo.com` | `document` | sí | ruido de backups Mikrotik; sin reglas específicas |
| `mesadeayuda@solidocs.com.ar` | `mail.solidocs.com.ar` | `ticket` | sí | lugar para excepciones `discard` futuro |
| `soporte@solidocs.com.ar` | `c1931856.ferozo.com` | `ticket` | sí | **mantener sombra**; regla de prueba `mkbackups → document` |

---

## Endpoints (`@Roles(ADMINISTRADOR, SUPERVISOR)`, base `/api/mailbox-rules`)

| Método | Ruta | Acción |
|---|---|---|
| GET | `/mailbox-rules?mailbox=` | reglas de la casilla |
| GET | `/mailbox-rules/unrouted?mailbox=` | correos recientes sin regla |
| POST | `/mailbox-rules/preview?mailbox=` | simular matcheo (últimos 30 días) |
| POST | `/mailbox-rules` | crear regla |
| PATCH | `/mailbox-rules/:id` | editar regla |
| DELETE | `/mailbox-rules/:id` | borrar regla |

El catch-all se edita vía `PATCH /mailboxes/:id` con `defaultDestination`
(`ticket`/`document`/`discard`).

---

## Verificación en vivo (registrada)
- Preview wildcard `*@mikrotik-alerts.com`/`backup` → matched 0 (sin correos de ese dominio).
- Preview exacto `a@b.com`/`backup` → matched 1 (matchea el correo real de soporte).
- **Prioridad**: reglas prio 10 (discard) y 200 (document) matcheando el mismo correo → gana prio 10 (`discard`).
- **Catch-all**: `mkbackups` no-rule → `document`; `mesadeayuda` no-rule → `ticket`.
- Sombra `soporte` registra correo sin regla (`x@y.com | asunto sin regla`) visible en la vista.
- Tests 19 pasan; `tsc --noEmit` 0 errores; backend/frontend health 200.

## Config
No hay env vars nuevas. El `default_destination` y las reglas viven en la BD.

---

## Novedad: enrutar a un "box" específico del catálogo — 2026-09-04

Las reglas de `destination='ticket'` ahora pueden apuntar a un **box** del catálogo
(`ticket_groups`), de forma que el ticket creado cae en ese box (se escribe
`tickets.legacy_group = ticket_groups.name`) en lugar del destino genérico.

### Cómo se usa
- En el form de regla, con destino `ticket`, aparece el selector **"Box destino
  (opcional)"** alimentado por `GET /api/ticket-groups`. Si se elige uno, la regla
  guarda `target_group_id`.
- `MailboxWorkersService.evaluate()` resuelve el `target_group_id` al `name` del
  box (si el box está activo) y lo devuelve como `targetGroupName`.
- El worker lo pasa como `legacyGroup` en `EmailService.ingest` → `TicketsService.
  upsertFromEmail` → se setea `tickets.legacy_group` al crear el ticket.
- Sin box (o si el box está desactivado) cae al comportamiento actual (destino
  default `ticket`, `legacy_group = NULL` → bandeja "Nativos").

### Esquema
- `mailbox_rules` ganó `target_group_id uuid NULL` (FK a `ticket_groups.id`).
- Validación: `@IsUUID` opcional en `Create/UpdateMailboxRuleDto`.

### Verificación registrada
- Regla con `subjectPattern='opencode-test-inbox'`, `destination=ticket`,
  `targetGroupId=<box "Box de Prueba OpenCode">` creada, guarda `target_group_id`.
- `evaluate()` devuelve `targetGroupName='Box de Prueba OpenCode'`.
- `upsertFromEmail({ legacyGroup })` crea el ticket con `legacy_group` = ese nombre
  (verificado en BD y luego limpiado).
- Backend `Found 0 errors`.

---

## Cambio: backups de routers → tickets (no documentos) — 2026-09-02

### Decisión del usuario
Los correos de la bandeja **`mkbackups@`** son fundamentales para restaurar routers
→ deben ser **tickets accionables** (como en Zammad), no documentos archivados.

### Causa real (con evidencia)
El `default_destination` de `mkbackups@` estaba en `document`, pero **no era lo que
enrutaba**: los correos de backup entran por la casilla **`soporte@solidocs.com.ar`**
(el worker los lee desde ahí; todos quedan en `inbound_mail_log` bajo `soporte@`).
En `soporte@` había una **regla** `sender_pattern = mkbackups@ → destination =
document` que convertía los backups de routers en documentos. Verificado: los 18
correos de hoy `mkbackups@` → `document` por esa regla.

### Cambios aplicados
1. **Regla** `sender=mkbackups@` en `soporte@`: `destination` `document` → **`ticket`**
   (via `UPDATE mailbox_rules`). Los backups de routers ahora crean **tickets**.
2. **Vista "Backups MK"** (seed en `saved-views.service.ts` + BD vía `ensureSeed`):
   se quita `titleContains: 'respaldo'`; queda solo `senderContains: 'mkbackups'`.
   Motivo: no todos los backups traen "respaldo" en el asunto (p.ej.
   "MikroTik - El Mercedino"), y quedaban fuera de la vista. Con el cambio, la vista
   cuenta **16.860** tickets (antes 14.636).
3. `default_destination` de `mkbackups@` también quedó en `ticket` (consistente).

### Verificación en vivo
- `GET /api/mailbox-rules` → la regla `mkbackups@` devuelve `destination=ticket`.
- `GET /api/tickets/views` → `Backups MK: { ..., count: 16860 }` (condición por
  remitente; la API no expone `condition`, se confirmó en BD).
- Query de la vista (solo `senderContains=mkbackups`): 16.860; con la condición vieja
  (`+ titleContains respaldo`): 14.636 (diferencia 2.224 = backups sin "respaldo").
- Páginas 200: `/`, `/tickets`, `/tickets?view=9bb16455...`, `/documentos`,
  `/clientes`, `/dashboard`. Backend 200. `tsc --noEmit` 0 errores.

### Notas
- El cambio es **hacia adelante** (solo correos nuevos que procese el worker;
  no es retroactivo sobre los ~14.600 ya migrados desde Zammad). Los documentos ya
  migrados desde `mkbackups@` **no se tocan**.
- Requiere confirmación del usuario: esperar/forzar un correo real de `mkbackups@`
  y ver que se cree un **Ticket** (no Document) y que aparezca en la vista
  "Backups MK" con el contador actualizado.

---

## Unificación de la bandeja "Backups MK" (sidebar) — 2026-09-02

### Problema
Había **dos** entradas "Backups MK" en el sidebar con lógica y conteos distintos:
1. **Bandeja vieja** (por `legacy_group='Backups MK'`, count 727, fija, solo migración).
2. **Vista nueva** (por `senderContains: mkbackups`, count 16.860, la correcta/actualizada).

Esto confundía (el usuario miraba la vieja por error).

### Solución (sin pérdida de datos)
- **`SavedViewCondition`** ganó `legacyGroupIn?: string[]` y `applyCondition` ahora
  combina `senderContains` **O** `legacyGroupIn` (OR) cuando ambos existen.
- La SavedView **"Backups MK"** quedó con
  `{ senderContains: 'mkbackups', legacyGroupIn: ['Backups MK'] }` → captura por
  remitente **O** por grupo legacy. Conteo unificado: **17.234**.
- En el sidebar (`layout.tsx`) se ocultó la bandeja vieja (`HIDDEN_TRAY_GROUPS =
  ['Backups MK']`) y se quitó de `TRAY_ORDER`/`TRAY_LABELS`. Queda **una sola**
  "Backups MK" (la vista), que incluye BOTH los 727 migrados (373 solo-legacy + 354
  con remitente) y los nuevos.

### Verificación
- Vista unificada = 17.234. Bandeja vieja = 727. `vieja_solo_legacy` = 373 (cubiertos
  por el OR). **Ningún ticket perdido.**
- `/tickets?view=9bb16455...` y sidebar: una sola "Backups MK".
- No-regresión: `/`, `/tickets`, `/clientes`, `/documentos`, `/notas`, `/usuarios`,
  `/dashboard`, `/mi-dia` → 200.


