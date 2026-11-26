# Tickets con un responsable y técnicos colaboradores

Implementación local en la rama `feat/ticket-colaboradores` (nace de `main`/`ced8c8e`, **no** de `feat/ia-ollama-base`). Propósito: cerrar los huecos de agenda y Mi día cuando en un ticket trabajan varios técnicos, **sin tocar** portal, taller, ingesta de correos ni SLA.

## 1. Modelo y reglas

- El ticket sigue teniendo **un solo responsable**: `tickets.technician_id`.
  SLA rojo, alertas, carga histórica y reportes anteriores siguen mirando ese campo.
- Los colaboradores viven en la tabla nueva `ticket_technicians` (PK compuesta
  `ticket_id + technician_id`) y **no reemplazan** al responsable.
- El responsable **nunca** se guarda como colaborador. Si un colaborador pasa a
  responsable, se lo quita automáticamente de colaboradores.
- Sólo se pueden sumar técnicos activos (`users.active = true`), existentes y sin
  duplicados. No se acepta el id del responsable.
- `technicianId` en la API/listado sigue significando **responsable**.
  El filtro nuevo `assignedTo=<technicianId>` incluye responsables **y**
  colaboradores (UI: casilla “incluir colaboraciones”).

## 2. Permisos

- Ver responsable/colaboradores: cualquier usuario con acceso al ticket.
- Modificarlos: `tickets:assign`. Sin ese permiso los campos se muestran pero no
  se pueden editar; el frontend ni siquiera envía `collaboratorIds` y el backend
  devuelve 403 si alguien lo intenta por API.
- Mantener `tickets:update` para el resto del PATCH.

## 3. Comportamiento por pantalla

| Pantalla | Cambio |
|---|---|
| Ficha de ticket | “Técnico” pasa a “Responsable”; multi-select “Colaboradores”. Al agendar una cita se preseleccionan responsable + colaboradores. |
| Listado | `Pedro +2` con nombres completos en `title` (tooltip nativo, sin colores nuevos). |
| Filtro de listado | Select de técnicos + casilla “incluir colaboraciones” (`assignedTo`). |
| Mi día | Los tickets donde el usuario es colaborador llevan pill “colaborador”; las citas muestran todos los técnicos. |
| Agenda | Alta/edición con varios técnicos (`technicianIds`); el select de reasignar cambia el responsable sin borrar a los secundarios. El guardián del link principal sincroniza `technician_id` con el primer técnico. |
| Dashboard / Reportes | Columna y gráfico separados “como colaborador”, sin mezclar con la carga existente del responsable. |

Estilos: se reutilizan variables del tema (`--surface`, `--border`, `--bg-hover`, `--blue`) y las clases `pill`, `pill-blue`, `pill-gray`. No se agregaron colores fijos nuevos al tema.

## 4. Backend

- Entidad: `backend/src/entities/ticket-technician.entity.ts`.
- Migración: `backend/src/database/migrations/20261124150000-CreateTicketTechnicians.ts`
  (`up` idempotente con `CREATE TABLE IF NOT EXISTS` y guardas para FKs; `down` dropea la tabla).
- `PATCH /api/tickets/:id` acepta `collaboratorIds: string[]`.
  Valida, reemplaza el conjunto, escribe auditoría
  (`oldValue.collaborators` / `newValue.collaborators` con nombres y
  `meta.collaboratorsChanged`) y notifica `TICKET_ASIGNADO` **sólo** a los
  técnicos recién agregados con el mensaje
  `Te sumaron como colaborador en TK-… — <título>`. Emite `ticket:updated`.
- `GET /api/tickets` devuelve `collaborators` y `collaboratorCount`; acepta `assignedTo`.
- `GET /api/dashboard/general` agrega `collaboratorLoad` por técnico.
- `GET /api/reports/summary` agrega `byTechnicianAsCollaborator`.
- Utilidades puras y sus unitarias: `backend/src/common/utils/ticket-collaborators.util.ts`.

### Migración en producción (sólo con autorización)

```bash
# 1) BACKUP de producción ANTES de cualquier cambio
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U <POSTGRES_USER> -d <POSTGRES_DB> --clean --if-exists \
  > backup/ops_msp.pre-colaboradores.dump

docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U <POSTGRES_USER> -d <POSTGRES_DB> -Fc \
  > backup/ops_msp.pre-colaboradores.custom.dump

# 2) Backup de MinIO (por si el rollback tiene que ser total)
docker compose -f docker-compose.prod.yml exec -T minio \
  mc mirror --overwrite local /backup/minio-pre-colaboradores 2>/dev/null || true

# 3) Verificar los backups (tamaño + sha256) antes de seguir
Get-FileHash backup/ops_msp.pre-colaboradores.custom.dump -Algorithm SHA256
Get-Item backup/ops_msp.pre-colaboradores.custom.dump | Select-Object Length

# 4) Desplegar el código y aplicar la migración
docker compose -f docker-compose.prod.yml up -d --no-deps --build backend frontend
docker compose -f docker-compose.prod.yml exec backend \
  node dist/database/migration-source.js

# 5) Verificación
docker compose -f docker-compose.prod.yml exec -T postgres psql -U <POSTGRES_USER> -d <POSTGRES_DB> -c \
  "SELECT count(*) AS colaboradores FROM ticket_technicians;"
docker compose -f docker-compose.prod.yml exec -T postgres psql -U <POSTGRES_USER> -d <POSTGRES_DB> -c \
  "SELECT name FROM migrations WHERE name='CreateTicketTechnicians20261124150000';"
```

Nota: el proyecto hoy tiene `synchronize: true` también en producción, así que la tabla puede crearse sola al iniciar. La migración es idempotente y deja constancia en la tabla `migrations`; ejecutarla igualmente es seguro y hace explícito el cambio.

Verificación funcional mínima:

1. Abrir un ticket, poner un responsable y dos colaboradores, guardar.
2. En el listado debe verse `Nombre +2` y el tooltip con los tres nombres.
3. Agendar una cita: los tres técnicos deben aparecer preseleccionados.
4. En Mi día de un colaborador debe aparecer el ticket con pill “colaborador”.
5. Contar antes y después con el mismo filtro de responsable; tiene que dar igual:
   ```sql
   SELECT count(*) FROM tickets WHERE technician_id = '<id>';
   SELECT count(*) FROM tickets
    WHERE technician_id = '<id>'
       OR EXISTS (SELECT 1 FROM ticket_technicians tt
                  WHERE tt.ticket_id = tickets.id AND tt.technician_id = '<id>');
   ```

## 5. Rollback

**Rollback de aplicación (recomendado, sin pérdida de datos):** volver a desplegar la imagen/commit anterior (`main` o el commit previo a `cb651d2`). La tabla `ticket_technicians` queda huérfana pero no rompe nada: el código viejo no la consulta. No hace falta borrarla.

**Rollback de datos (sólo si se quiere quitar también la tabla):**

1. Primero volver el código (el código nuevo espera que la tabla exista).
2. Verificar que no hay colaboradores que se necesiten:
   ```sql
   SELECT count(*) FROM ticket_technicians;
   ```
3. Quitar la tabla y su registro de migración:
   ```sql
   DROP TABLE IF EXISTS ticket_technicians;
   DELETE FROM migrations WHERE name = 'CreateTicketTechnicians20261124150000';
   ```
4. Si se requiere volver al estado exacto previo (incluidos tickets/nombres/citas creados durante la prueba), restaurar el dump `backup/ops_msp.pre-colaboradores.custom.dump` en una DB nueva, validar y recién entonces hacer el switch. **Nunca** restaurar directamente sobre la DB en uso sin ventana de mantenimiento.

## 6. Pruebas y evidencia local

- Unitarias: `cd backend && npm test -- --runInBand` → 4 suites, 23 tests.
- E2E (DB aislada `ops_msp_e2e`, nunca `ops_msp`):
  `npm run test:e2e:setup` y `npm run test:e2e` → 3 suites, 12 tests.
  El guard `test/test-db.guard.ts` exige sufijo `_e2e`/`_test` y `E2E_ALLOW_DB`.
- `tsc`: backend y frontend sin errores.
- Evidencia en `backup/`: `TICKET-COLABORADORES-paso0-evidencia.txt`, `TICKET-COLABORADORES-paso0b-evidencia.txt`, logs `TICKET-COLABORADORES-e2e-*.log` y capturas `TICKET-COLABORADORES-*.png`.

## 7. Superposición con `feat/ia-ollama-base`

Esta rama se creó desde `main`, no desde la de IA. Archivos compartidos a revisar al integrar:

- Seguros (cambios ajenos distintos): `backend/src/modules/tickets/tickets.service.ts`, `frontend/app/(app)/tickets/[id]/page.tsx`.
- Probables conflictos: `backend/src/modules/tickets/dto.ts`, `frontend/app/globals.css`, `backend/src/app.module.ts`.
- Bajo riesgo: `backend/src/common/interceptors/audit.interceptor.ts`.

No se hizo merge a `main` y no se debe hacer sin revisar esa superposición.
