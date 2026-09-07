# Verificación de Fase 1

Checklist de aceptación. Se valida en `localhost` (desarrollo) y es la misma que
se repite en el VPS (ver `MIGRATION-RUNBOOK.md`).

---

## A. Infraestructura

- [ ] `docker compose -f docker-compose.dev.yml up --build` arranca sin errores.
- [ ] `docker compose -f docker-compose.dev.yml ps` muestra todos los servicios `running`.
- [ ] `http://localhost:4000/api/health` responde `{"status":"ok"}`.
- [ ] Consola MinIO en `http://localhost:9001` (minioadmin / minioadmin_dev).
- [ ] La app se abre en `http://localhost:3000`.

## B. Autenticación y RBAC

- [ ] Login con `maria@msp.local` / `demo1234` entra a **Mi día**.
- [ ] Login con `ana@msp.local` / `demo1234` entra al **dashboard**.
- [ ] Un pedido sin token a `/api/tickets` da **401**.
- [ ] Un rol sin permiso (ej. `Consulta`) no puede crear tickets.

## C. Clientes

- [ ] Se puede crear un cliente desde la UI.
- [ ] En el detalle del cliente se agregan **contactos** y **sitios**.
- [ ] El cliente demo (*Panadería Don Pedro*) tiene contrato con SLA activo.

## D. Técnicos

- [ ] Se listan los técnicos con su estado, nivel y especialidades.
- [ ] Se puede cambiar el estado de presencia (disponible / ocupado / fuera de horario).

## E. Tickets + SLA + mensajes

- [ ] Se crea un ticket manualmente, se asigna y cambia de estado.
- [ ] El detalle muestra SLA con **primera respuesta** y **resolución** según el
      horario 9–18 del contrato del cliente.
- [ ] El semáforo cambia correctamente entre verde/amarillo/rojo según el tiempo.
- [ ] Se agregan mensajes al hilo (canal portal) y no rompe el cálculo de SLA.

## F. Ingesta de email

- [ ] Enviando a `/api/email/inbound` con `X-Inbound-Secret` correcto (ver `SETUP.md` → "Probar la ingesta de email") y un remitente conocido se crea/actualiza ticket.
- [ ] Sin el header `X-Inbound-Secret` (o mal) → `401` y no crea nada.
- [ ] Si el mismo remitente reenvía sobre el mismo asunto, **se agrega al hilo** (no se duplica).

## G. Agenda y tareas

- [ ] Se puede crear un turno (reunión/visita/guardia/tarea) y aparece en la semana.
- [ ] Se puede crear una tarea y marcarla como hecha.
- [ ] Una tarea recurrente (diaria/semanal/mensual) genera la siguiente ocurrencia al completarse.

## H. Dashboards

- [ ] "Mi día" muestra agenda de hoy, tickets asignados y tareas pendientes.
- [ ] El dashboard general muestra tickets críticos, SLA en riesgo y carga por técnico.

## I. Notificaciones in-app

- [ ] Al asignar un ticket, el técnico recibe una notificación (badge + listado).
- [ ] Las notificaciones aparecen en tiempo real vía WebSocket cuando hay conexión.

## J. Auditoría

- [ ] Cambios de estado, prioridad y asignación quedan registrados.
- [ ] `/api/audit` lista los eventos con usuario, fecha y valores anterior/nuevo.

---

## K. Pruebas automatizadas

Dentro de `backend/`:

```bash
# Unit tests (SLA, normalización de asunto, recurrencia)
npm test

# Smoke e2e (necesita el stack arriba: postgres + redis + minio)
npm run test:e2e
```

Ambos deberían terminar en verde.

---

## Definición de "Fase 1 terminada"

Se considera terminada cuando **todas** las casillas anteriores se cumplen en
local, y el runbook de migración al VPS (`MIGRATION-RUNBOOK.md`) se probó al
menos una vez con datos reales.
