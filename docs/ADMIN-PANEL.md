# Panel de Administración

Consolida el editor de roles y permisos y la configuración general del sistema
bajo un ítem de menú **"Administración"**, visible solo para el rol Administrador.

---

## 1. Editor de roles y permisos (`/administracion/roles`)

### Modelo
Los permisos por rol viven en la columna `role.permissions` (jsonb, `string[]`),
que es la **única fuente de verdad** en runtime: `RolesGuard`, `JwtStrategy` y
`AuthService` la leen desde la base en cada request. El mapa hardcodeado
`ROLE_PERMISSIONS` quedó solo como referencia para el seed inicial.

### Permisos disponibles (21, reales del código)
| const | código | módulo |
|---|---|---|
| USERS_READ | `users:read` | usuarios |
| USERS_CREATE | `users:create` | usuarios |
| USERS_UPDATE | `users:update` | usuarios |
| USERS_DELETE | `users:delete` | usuarios |
| TECHNICIANS_READ | `technicians:read` | técnicos |
| TECHNICIANS_UPDATE | `technicians:update` | técnicos |
| CUSTOMERS_READ | `customers:read` | clientes |
| CUSTOMERS_CREATE | `customers:create` | clientes |
| CUSTOMERS_UPDATE | `customers:update` | clientes |
| CUSTOMERS_DELETE | `customers:delete` | clientes |
| CONTRACTS_READ | `contracts:read` | contratos |
| CONTRACTS_UPDATE | `contracts:update` | contratos |
| TICKETS_READ | `tickets:read` | tickets |
| TICKETS_CREATE | `tickets:create` | tickets |
| TICKETS_UPDATE | `tickets:update` | tickets |
| TICKETS_ASSIGN | `tickets:assign` | tickets (+ fusionar) |
| CALENDAR_READ | `calendar:read` | agenda |
| CALENDAR_WRITE | `calendar:write` | agenda |
| DASHBOARD_GENERAL | `dashboard:general` | dashboard |
| NOTIFICATIONS_READ | `notifications:read` | notificaciones |
| AUDIT_READ | `audit:read` | auditoría |

### Endpoints (`@Roles(ADMINISTRADOR)`, base `/api/admin`)
| Método | Ruta | Acción |
|---|---|---|
| GET | `/admin/permissions` | catálogo (códigos, agrupación por módulo, labels) |
| GET | `/admin/roles` | roles con su `permissions` actual |
| PATCH | `/admin/roles/:id/permissions` | actualizar permisos del rol |
| GET | `/admin/settings` | configuración del sistema |
| PUT | `/admin/settings` | actualizar configuración |

### Seguridad
- **El rol Administrador** siempre conserva como mínimo: `users:read/create/update/delete`
  y `audit:read`. El endpoint rechaza guardar una configuración que le quite alguno
  de esos permisos (evita bloquearse a sí mismo).
- No se pueden crear ni borrar roles (los 5 son fijos por ahora).
- El cambio se aplica **de inmediato** (el rol se relee de la DB en cada request);
  no requiere reiniciar el backend.
- Cada cambio queda **auditado** (`AuditAction.UPDATE`, `entity_type=role`,
  permisos antes/después y actor).

---

## 2. Configuración general (`/administracion/configuracion`)

### Modelo
Entidad singleton `SystemSettings` (`system_settings`, una fila):
- `companyName` (nombre de empresa / branding).
- `businessHours` (horario laboral por defecto, mismo formato que `Contract.business_hours`).
- `slaFirstResponseMinutes` (minutos de primera respuesta para clientes sin contrato).
- `slaResolutionHours` (horas de resolución, mismo criterio).
- `contactEmail` (email de contacto / remitente por defecto).
- `emailAutoResponseEnabled` (toggle **modo acumulación**, default `false`).
- `emailSender` (remitente para correos al cliente, opcional).

> **Modo acumulación**: mientras SolidOps convive con Zammad, el correo entrante
> crea tickets completos (cliente, contacto, hilo, SLA) pero **no envía ninguna
> respuesta al cliente** cuando `emailAutoResponseEnabled = false`. Al voltearlo a
> `true` se habilita el envío saliente a clientes (inserción prevista en
> `EmailService.ingest`). Ver `docs/MAIL-ACUMULACION.md` para el runbook de
> desactivación al cortar Zammad.

### Guardado de la configuración (auto-save del toggle)
- El toggle **"Respuestas automáticas por email"** se guarda **inmediatamente** al
  tildar/des-tildar (auto-save `PUT /admin/settings`), con confirmación visual
  "✓ Guardado". No depende del botón "Guardar configuración".
- **El toggle es 100% independiente del formulario**: `toggleAutoResp` hace un PUT
  parcial con **solo** `emailAutoResponseEnabled`. El botón "Guardar configuración"
  **no incluye** ese campo (para evitar que un estado local viejo lo pise). Así el
  toggle nunca se resetea solo — solo cambia cuando el usuario lo tilda.
- El resto de los campos (empresa, email, SLA, horario laboral) se guarda con el
  botón **"Guardar configuración"** (flotante/sticky, siempre visible).
- `emailAutoResponseEnabled` sólo se persiste `true` temporalmente para pruebas; al
  terminar debe quedar `false` (ver `docs/MAIL-ACUMULACION.md`).

> **Causa histórica de que el toggle se "reseteaba solo"**: `toggleAutoResp` y
> `save()` ambos enviaban `emailAutoResponseEnabled`; si el formulario se guardaba
> con el valor local `autoResp` aún viejo, pisaba el toggle. Se corrigió aislando
> el toggle (PUT parcial + quitarlo del formulario). El seed de settings tiene
> guarda `count>0` y nunca pisa el valor existente.

### Uso en runtime
`SlaService` (sla.service.ts) carga estos valores y los usa como **fallback**
cuando un ticket no tiene contrato activo (`resolveTargets`), en lugar de los
valores fijos anteriores (60 min / 8 hs). Al guardar desde la pantalla, se llama
a `SlaService.refreshDefaults()`, así el **próximo** cálculo SLA sin contrato usa
los valores nuevos sin reiniciar.

---

## 3. Menú "Administración"

- Ítem en la barra lateral visible **solo para rol Administrador**.
- Agrupa: Roles y permisos, Configuración general, y accesos directos a
  Usuarios y Casillas de correo (pantallas existentes, no se movieron).

---

## 3bis. Boxes de tickets (`/administracion/boxes`)

Catálogo editable de **boxes** (grupos/bandejas del sidebar, antes derivados
solo de los valores únicos de `tickets.legacy_group`). Un box es una fila de la
tabla `ticket_groups`; el valor que se escribe en `tickets.legacy_group`
coincide con `ticket_groups.name`.

### Modelo (`ticket_groups`)
- `id uuid`, `name varchar(80) UNIQUE`, `color varchar(20) NULL`,
  `sort_order int DEFAULT 0`, `active bool DEFAULT true`,
  `module_key varchar(40) NULL` (módulo al que el box sirve como destino),
  timestamps.
- Índice único parcial: `UQ_ticket_groups_module_key_active` (`WHERE active =
  true AND module_key IS NOT NULL`) → solo un box **activo** por module_key.

### Decisión de diseño: string validado (no FK)
Se mantuvo `tickets.legacy_group` como **string** (= `ticket_groups.name`) en vez
de migrarlo a FK a `ticket_groups.id`, porque:
- `legacy_group` ya se usa como texto en muchos lados (`findAll` por `tray`,
  `groupCounts` groupBy, SavedViews `legacyGroupIn`, import). Pasarlo a FK
  rompe todo ese código.
- La validación se hace en backend al **crear/mover** tickets contra el catálogo
  (`bulk-move` valida que el box exista y esté activo). Riesgo residual: si algo
  escribe `legacy_group` directo a la columna sin validar, se mantiene; pero los
  puntos de escritura conocidos (`upsertFromEmail`, `bulk-move`, import) sí
  validan/usan el catálogo.

### Migración
`CreateTicketGroupsMigrateToBoxes` crea la tabla y **siembra** un box por cada
valor único existente de `tickets.legacy_group` (L1, L2, L3, Users, Taller,
Ventas, Backups MK, Mesa de ayuda…), `ON CONFLICT (name) DO NOTHING` (idempotente).
No toca tickets (los conteos por grupo no cambian).

### Endpoints (base `/api/ticket-groups`)
| Método | Ruta | Acceso |
|---|---|---|
| GET | `/ticket-groups` | `tickets:read` (cualquier staff — el sidebar lo lee) |
| GET | `/ticket-groups/:id` | `tickets:read` |
| POST | `/ticket-groups` | Admin/Supervisor |
| PATCH | `/ticket-groups/:id` | Admin/Supervisor |
| DELETE | `/ticket-groups/:id` | Admin/Supervisor (soft-delete: `active=false`) |

El **soft-delete** (desactivar) no borra la fila ni toca tickets → nunca quedan
tickets huérfanos en un box inexistente; solo se oculta del sidebar (que lo
filtra por `active=true`).

### Desactivación con fallback obligatorio (`DELETE /ticket-groups/:id`)
Al desactivar un box se exige **obligatoriamente** un `fallbackGroupId` en el
body (box activo, distinto del que se desactiva). Si no se envía, se devuelve
`400` con mensaje claro. Todo dentro de una **transacción**:
1. Se mueven todos los tickets del box a desactivar al box fallback (se setea
   `tickets.legacy_group = fallback.name`), auditando cada movimiento con
   `meta: { reason: 'box_deactivated', fromGroupId, toGroupId, ... }`.
2. Se reapuntan todas las `mailbox_rules` con `target_group_id` = box a
   desactivar al box fallback (así los correos futuros caen en el box correcto,
   sin reglas huérfanas).
3. Si el box a desactivar tiene `module_key`, se **transfiere** ese `module_key`
   al box fallback (se limpia en el origen y se asigna al fallback). Si el
   fallback ya tiene un `module_key` **distinto** → `400` pidiendo elegir un
   fallback sin conflicto (solo un box activo por module_key).
4. Recién después se pone `active = false` el box original.
Si algún paso falla → rollback completo (el box no queda desactivado a medias).

El panel admin (`/administracion/boxes`) muestra los **conteos** por box
(`ticketCount`, `ruleCount` — vía `listWithCounts()`) y al "desactivar" abre un
modal que pide elegir el fallback entre los boxes activos (excluyendo el actual),
informando cuántos tickets y reglas se moverán.

### Conectar módulos a un box (`module_key`)
Un box puede ser el **destino de un módulo** que crea tickets (p.ej. el módulo
Taller). Cuando ese módulo crea un ticket, busca el box **activo** con su
`module_key` y le setea `tickets.legacy_group = box.name`. Si no hay ningún box
activo con ese `module_key`, el ticket cae en "Nativos" (comportamiento previo).

- Módulos conectados: **`workshop`** (Taller) → `workshop.service.ts`
  `createEquipment` setea `tickets.legacy_group` del box con `module_key='workshop'`
  (mantiene `category='Taller'`).
- El panel admin permite asignar/limpiar el `module_key` de un box (selector con
  nombre legible, ej. "Taller"). Solo un box **activo** por module_key.
- Al **desactivar** un box con `module_key`, ese `module_key` pasa al box fallback
  (paso 3 de la desactivación), así los tickets nuevos del módulo siguen
  cayendo en el box correcto.

> **Decisión de diseño**: `module_key` es **una sola** columna (un module_key por
> box activo), no un array. Al desactivar, si el fallback ya tiene un module_key
> distinto → 400 (se elige un fallback neutro). Rompe menos que un array/join
> y coincide con la realidad de que cada módulo tiene un único box de destino.
>
> **Sobre la asignación inicial del box "Taller"**: el box Taller real (95 tickets
> migrados) se configuró con `module_key='workshop'` **después** de verificar el
> mecanismo con un box de prueba (para respetar "no tocar el box Taller de
> producción hasta verificar"). La migración de esquema solo agrega la columna y
> el índice único parcial; la asignación se hace desde el panel/API.

### Sidebar
`layout.tsx` carga el catálogo (`/ticket-groups`) además de los conteos
(`/tickets/groups`) y muestra **todos los boxes activos** (aunque estén vacíos,
para que un box recién creado aparezca de una), ordenados por `sort_order`, con
su contador de tickets. El bucket sintético `nativo` (tickets sin `legacy_group`)
se agrega aparte. Al desactivar un box, además de moverse los tickets al fallback,
el box deja de listarse (filtro `active=true` → oculto del sidebar) de inmediato.

### Mover tickets a un box
`PATCH /api/tickets/bulk-move` con `{ ticketIds: string[], groupId: string }`:
valida que el box exista y esté activo, setea `tickets.legacy_group = name` para
cada ticket y audita cada movimiento (`AuditAction.UPDATE`, `entity_type=ticket`,
`meta: { action: 'bulk_move' }`).

### Verificación registrada
- Migración: 8 boxes sembrados; los conteos por grupo no cambiaron antes/después.
- CRUD: crear (nombre/color/orden), editar, desactivar/activar (soft-delete).
- **Desactivar con fallback**: box de prueba con `tickets=3` y `rule=1` →
  desactivado en `Taller` (fallback): `{ ok, movedTickets:3, reroutedRules:1 }`.
  Los 3 tickets pasaron a Taller (95→98), la regla se reapuntó a Taller, el box
  quedó `active=false`. Sin fallback → 400 con mensaje claro; fallback = mismo
  box → 400.
- bulk-move 3 tickets de Taller → nuevo box; aparecieron ahí y desaparecieron de
  Taller (95 → 92). A box inexistente → 404; a box desactivado → 400.
- Sidebar/permisos: Técnico puede leer `/ticket-groups` (200) pero no mutar (403).
- Backend `Found 0 errors`; páginas `/tickets` y `/administracion/boxes` 200.


---

## 4. Verificación en vivo (registrada)

- **PATCH de permisos (rol Técnico)** → quitar `tickets:create`; un usuario Técnico
  ya no pudo crear tickets (403) **sin reiniciar**; restaurado y volvió a poder.
- **Restricción Admin** → intentar quitarle `users:update` al rol Administrador
  devuelve 400 con mensaje claro.
- **Catálogo desde DB** → `/admin/permissions` devuelve 21 códigos + grupos + labels.
- **SLA configurable** → cambiar a 30min/4h hizo que un ticket sin contrato se
  calcara con `target_first_response_minutes=30` y `target_resolution_hours=4`.
- **Regresión RBAC** → Admin /audit 200, Técnico /audit 403, Técnico /tickets 200.
- Datos y settings de prueba restaurados a su estado original al finalizar.
