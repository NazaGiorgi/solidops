# Prompt OpenCode — Tareas pendientes: crear, ver y completar tareas (LOCAL, notebook)

## Contexto (revisado en el código de `feat/ticket-colaboradores`)

- **Entidad `Task`** (`backend/src/entities/task.entity.ts`): `title`, `assigneeId` (→ **User**, no Technician), `dueAt`, `status`
  (`pendiente`, `en_progreso`, `hecha`, `cancelada`, `pospuesta`), `priority`, `recurrenceRule` (none/daily/weekly/monthly), `notes`,
  `relatedEntityType` / `relatedEntityId`, `recurrenceParentId`.
- **Backend** (`calendar.controller.ts` / `calendar.service.ts`): ya existen `GET /tasks`, `GET /tasks/:id`, `POST /tasks`, `PATCH /tasks/:id`
  y la recurrencia (`spawnNextOccurrence` al marcar `hecha`).
- **"Mi día"** (`dashboard.service.ts`) muestra tareas `pendiente`/`en_progreso` asignadas al usuario o sin asignar.
- **No existe ninguna pantalla para crear tareas.** En Agenda → "+ nuevo turno" hay un tipo **"tarea"**, pero crea un **turno** (appointment), no una `Task`.
  Por eso "Tareas pendientes" siempre dice "0 tareas".

### Errores encontrados en el backend actual (corregir en este prompt)

1. `calendar.controller.ts#getTasks` pasa `user.technicianId` como filtro, pero `task.assignee_id` es un **user id** → un técnico nunca ve sus tareas en la Agenda.
2. `calendar.service.ts#updateTask` registra la auditoría **después** de mutar el objeto: `oldValue` sale igual a `newValue`.
3. `spawnNextOccurrence`: la ocurrencia nueva **no copia** `relatedEntityType`/`relatedEntityId` (se pierde el vínculo con ticket/cliente), no audita,
   e ignora otros cambios que vengan en el mismo PATCH.
4. `getTasks` con rango `from/to` excluye las tareas **sin vencimiento** (`dueAt` null) y las **vencidas** antes del rango.

### Diferencia que tiene que quedar clara en la interfaz

- **Turno:** tiene día, hora y duración (visita, reunión). Va en la grilla de la Agenda.
- **Tarea:** algo para hacer con fecha límite, sin hora fija (presupuestar, llamar, renovar licencia, revisar backups todos los lunes). Va en "Tareas" y en "Mi día".

## Paso 0 — Backup, rama y blindaje (OBLIGATORIO)

1. Backup **local** verificado (pg_dump + `pg_restore --list`, MinIO + `tar -tzf`) en `backup/`. Backup de producción: **no aplica** (todo local).
2. Rama **`feat/tareas` creada desde `feat/ticket-colaboradores`**.
3. Blindaje: verificar **dentro del contenedor backend** (`docker exec ... env`) que `MAILBOX_WORKER_ENABLED=false`, `WHATSAPP_ACCESS_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID` vacíos y `MAIL_DEV_OUTBOX` definido; y en el log, "Worker de casillas pausado". Nunca usar `--remove-orphans`.
4. Contar cuántos **turnos** existen hoy con tipo `tarea` (sólo lectura) e informarme el número. **No convertirlos** sin mi OK.
5. Evidencia siempre en `backup/` (nunca en el repo, que es público). Sin evidencia no se avanza.

## Paso 1 — Backend

1. **Corregir los 4 errores** de arriba:
   - `getTasks`: filtrar por **user id** (`user.id`), no por technicianId.
   - Auditoría con valores anteriores reales (copiar antes de mutar) en `updateTask`.
   - `spawnNextOccurrence`: copiar vínculo (`relatedEntityType`/`relatedEntityId`) y asignado, auditar la creación de la próxima,
     y devolver `{ done, next }` para que el frontend pueda mostrar "Próxima: lunes 1/12".
   - Listado: incluir tareas sin vencimiento y vencidas (parámetro `includeOverdue=true` por defecto en las vistas de pendientes).
2. **Filtros de `GET /tasks`:** `assigneeId` (o `mine=true`), `status` (default: pendiente + en_progreso), `relatedEntityType` + `relatedEntityId`, `overdue=true`, `from`/`to`.
3. **Validaciones:** `title` obligatorio (máx. 200); `relatedEntityType` sólo `ticket` o `customer` y que exista; `assigneeId` usuario interno activo.
4. **Notificación interna** al asignar una tarea a otra persona: "Te asignaron la tarea: <título> (vence <fecha>)" (mismo canal que las notificaciones de tickets). Nada a clientes.
5. **Ticket:** al cerrar un ticket que tiene tareas vinculadas pendientes, **no bloquear**; devolver un aviso en la respuesta ("Este ticket tiene 2 tareas pendientes") para mostrarlo.
6. Permisos: crear/editar con `CALENDAR_WRITE` (como hoy); ver con `CALENDAR_READ`.

## Paso 2 — Frontend

1. **Formulario de tarea** reutilizable (modal), con el estilo y las clases del tema existente:
   - Título (obligatorio), Asignado a (usuarios internos activos; por defecto yo; opción "sin asignar"),
     Vence (fecha; hora opcional), Prioridad, Se repite (no / diaria / semanal / mensual), Notas,
     Vinculada a (ticket o cliente; se completa sola si se crea desde un ticket o un cliente).
   - Mensajes de validación claros en el formulario (no sólo el aviso del navegador).
2. **Agenda:** botón **"+ nueva tarea"** al lado de "+ nuevo turno". En la tarjeta "Tareas": cada tarea con título, asignado, vencimiento,
   prioridad, ícono ↻ si se repite y link al ticket/cliente. Al hacer clic: ver/editar, **Marcar hecha**, **Posponer** (elige nueva fecha), **Cancelar**.
3. **Quitar el tipo "tarea" de "+ nuevo turno"**, y en su lugar un texto chico: "¿Es algo sin hora fija? Creá una tarea". Los turnos viejos de tipo "tarea" se siguen mostrando como hoy.
4. **"Mi día" → Tareas pendientes:**
   - Checkbox para **marcar hecha**, con aviso "Hecha · Deshacer" durante 5 segundos.
   - Etiquetas: **Vencida** (rojo), **Vence hoy** (amarillo), o la fecha. Orden: vencidas, hoy, próximas, sin fecha.
   - Si se repite, al marcarla mostrar "Próxima: <fecha>".
   - Link al ticket/cliente vinculado y botón **"+ nueva tarea"**.
5. **Detalle del ticket:** sección **"Tareas"** (como "Notas" y "Citas agendadas"): tareas vinculadas y botón **"+ tarea de seguimiento"**
   (vinculada al ticket, asignada por defecto al responsable del ticket). Al cerrar el ticket con tareas pendientes, mostrar el aviso del backend.
6. **Ficha del cliente:** lista de tareas vinculadas al cliente (pendientes primero) y "+ tarea".

## Paso 3 — Pruebas (unitarias, e2e en `ops_msp_e2e`, y en vivo con evidencia en `backup/`)

1. Crear tarea desde Agenda asignada a mí con vencimiento hoy → aparece en "Mi día" como "Vence hoy".
2. Crear tarea asignada a María → María la ve en su "Mi día" y en la Agenda (prueba del error 1 corregido) y recibe la notificación.
3. Tarea vencida (ayer) y tarea sin fecha → aparecen en "Mi día" en el orden pedido.
4. Marcar hecha desde "Mi día" y deshacer → vuelve a pendiente.
5. Tarea semanal vinculada a un ticket → marcar hecha → la próxima se crea a la semana **con el mismo vínculo y asignado** (error 3 corregido).
6. Editar prioridad → la auditoría muestra el valor anterior real (error 2 corregido).
7. "+ tarea de seguimiento" desde un ticket → queda vinculada y asignada al responsable; cerrar el ticket → aviso de tareas pendientes (no bloquea).
8. "+ nuevo turno" ya no ofrece el tipo "tarea"; los turnos viejos de ese tipo se siguen viendo.
9. Usuario sin `CALENDAR_WRITE` → no puede crear ni editar (403).
10. Nada sale hacia clientes (blindaje). `tsc` backend/frontend, unitarias y e2e en verde.
Capturas: formulario de tarea, Agenda con tareas, "Mi día" con vencida/hoy/repetitiva, ticket con sección Tareas.

## Paso 4 — Volver atrás

- No hay cambios de esquema en la tabla `tasks` (si hiciera falta un índice nuevo, va en migración con `down`).
- Código: volver al commit anotado en el Paso 0. Las tareas creadas en pruebas se pueden cancelar.
- Documentar en `docs/TAREAS.md`: cómo funciona, qué se corrigió, y qué hay que hacer al desplegar en producción (backup de producción primero).

## Entregables

Commits separados por paso en `feat/tareas` + push (sin merge a `main`), lista de archivos tocados, el número de turnos viejos de tipo "tarea",
resultados de las pruebas y capturas (en `backup/`).

Ya hiciste el backup, la rama y el conteo (1 turno tipo “tarea”). Completá solo el punto 3 del Paso 0 (verificación del blindaje dentro del contenedor), guardá este prompt como prompt-opencode-tareas-local.md en la raíz del repo y esperá mi OK para el Paso 1.
