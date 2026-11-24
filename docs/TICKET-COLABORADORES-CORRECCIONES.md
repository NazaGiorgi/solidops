# Ticket con responsable + colaboradores — correcciones posteriores

Rama: `feat/ticket-colaboradores` (nacida de `main` `ced8c8e`).
Commit de este paso: `fix(tickets): corregir filtros de agenda y transacciones de colaboradores`.

## 1. Qué se corrigió

### 1.1 Filtro por técnico en Agenda y Mi día

- `backend/src/modules/calendar/calendar.service.ts#getAppointments`: antes se usaba
  `techLinks.technicianId = :techId` sobre el `leftJoinAndSelect`, lo que recortaba
  la relación y devolvía la cita con **un solo** técnico. Ahora el filtro es
  `EXISTS (SELECT 1 FROM appointment_technicians ...)`, igual que en tickets.
- `backend/src/modules/dashboard/dashboard.service.ts#myDay`: mismo problema con
  `links.technician_id`; reemplazado por `EXISTS`.

Resultado: al filtrar por María, la cita con Pedro + María + Nazareno se devuelve
con los **tres** `technicianLinks`, tanto en Agenda como en Mi día.

### 1.2 Transacciones

- `replaceCollaborators` ahora delega en `writeCollaborators(manager, ...)`, de modo
  que el `DELETE` y los `INSERT` de `ticket_technicians` ocurren en la misma
  transacción. Devuelve los ids recién sumados y las notificaciones se emiten
  **después** del commit (una notificación fallida no revierte el cambio).
- `tickets.service.ts#update`: `ticket.save` + reemplazo de colaboradores van en
  una sola transacción.
- `tickets.service.ts#assign`: el cambio de responsable y el borrado del
  colaborador promovido van en una sola transacción.

### 1.3 Reportes

`frontend/app/(app)/reportes/page.tsx` ahora muestra la tabla **Carga por técnico**
con las columnas `Técnico`, `Responsable` y **`Como colaborador`**. No se suman
las cargas: son columnas independientes (`byTechnician` vs.
`byTechnicianAsCollaborator`).

## 2. Pruebas y evidencia

Ejecutadas sobre `ops_msp_e2e` (guard `Test DB isolation OK:
127.0.0.1:5432/ops_msp_e2e`). Logs completos:

- `docs/evidencia/TICKET-COLABORADORES-correcciones-e2e.log`
- `docs/evidencia/TICKET-COLABORADORES-correcciones-evidencia.jsonl` (evidencia
  completa; Jest recorta los `console.log` largos)
- `docs/evidencia/TICKET-COLABORADORES-correcciones-unitarias.log`
- `docs/evidencia/TICKET-COLABORADORES-correcciones-tsc-backend.log`
- `docs/evidencia/TICKET-COLABORADORES-correcciones-tsc-frontend.log`

| Prueba | Resultado |
|---|---|
| Unitarias | 4 suites / **23 tests** en verde |
| E2E | 4 suites / **18 tests** en verde (antes 3/12; se agregaron 6 pruebas) |
| `tsc` backend | 0 errores |
| `tsc` frontend | 0 errores |

### 2.1 Notificación a colaboradores nuevos

Ticket `TK-2026-190`; Nazareno no tenía notificaciones antes, tenía **1** después.
Sólo se notifica al recién sumado; María no volvió a recibir otra al quedar
incluida en el segundo `PATCH`. Mensaje verificado:
`Te sumaron como colaborador en TK-2026-190 — __e2e colaboradores ...`,
tipo `ticket_asignado`.

### 2.2 403 sin `tickets:assign`

Login como María Técnica (tiene `tickets:update`, no `tickets:assign`).
`PATCH /api/tickets/:id` con `collaboratorIds` devolvió **403** con
`No tenés permiso para editar colaboradores`. Los colaboradores quedaron
inalterados: `María Técnica, Nazareno Giorgi`.

### 2.3 Colaborador que pasa a responsable

- `POST /api/tickets/:id/assign` con María: `technicianId` pasó a María y su
  entrada desapareció de colaboradores (quedó sólo Nazareno). Auditoría:
  `newValue.removedFromCollaborators = <María>`.
- `PATCH /api/tickets/:id` con `technicianId=Nazareno` (sin `collaboratorIds`):
  Nazareno salió de colaboradores y la lista quedó vacía.

### 2.4 Cita creada desde la página Agenda con 3 técnicos

Se creó por UI (browser real, no por API) la cita
`E2E UI 3 tecnicos 1795550700000`, id
`f1f3a921-2619-4ab0-921e-6091b1ae2bdf`, con Pedro, María y Nazareno.

- `GET /api/appointments?technicianId=<cada uno>` devolvió la cita con los 3
  `technicianLinks` para Pedro, María y Nazareno.
- `GET /api/dashboard/my-day` con el token de cada técnico también devolvió los 3.
- En la UI, al filtrar Agenda por **María**, el chip sigue mostrando
  `técnicos: Nazareno Giorgi, María Técnica, Pedro Técnico`.

Evidencia: `docs/evidencia/TICKET-COLABORADORES-correcciones-ui.json` y capturas:

- `docs/evidencia/TICKET-COLABORADORES-correcciones-agenda-creada.png`
- `docs/evidencia/TICKET-COLABORADORES-correcciones-agenda-filtro-maria-3-tecnicos.png`

### 2.5 Columna “como colaborador” en reportes

Columnas leídas del DOM: `["Técnico","Responsable","Como colaborador"]`.
Fila de María: `María Técnica | 1 | 1`.
En el e2e, el reporte pasó de `María Técnica: 1 → 2` y
`Nazareno Giorgi: 1 → 2` al sumar una colaboración nueva, sin tocar
`byTechnician` (responsable).

Captura: `docs/evidencia/TICKET-COLABORADORES-correcciones-reportes-como-colaborador.png`.

### 2.6 Conteo del filtro `technicianId` antes y después

Técnico con más tickets en la BD de e2e: **Pedro Técnico**
(2 tickets baseline; 3 al incluir el ticket creado por la prueba).

```
technicianId=<Pedro> ANTES de agregar colaborador: 3
technicianId=<Pedro> DESPUES de agregar colaborador: 3
IGUALDAD: true
```

El colaborador agregado fue María. `assignedTo=<María>` sí aumenta, porque ese
filtro incluye colaboraciones; `technicianId` sigue midiendo sólo responsables.

## 3. Seguridad / clientes

- No se tocó `.env`, producción, portal, taller, ingesta ni SLA.
- Se mantuvo el blindaje del paso 0.b: `MAILBOX_WORKER_ENABLED=false`,
  `WHATSAPP_ACCESS_TOKEN` vacío, sin envíos a clientes.
- No se usó `--remove-orphans`. `ops-ollama` sigue corriendo. Sólo se reiniciaron
  `ops-backend` y `ops-frontend` para que tomaran el código modificado.
