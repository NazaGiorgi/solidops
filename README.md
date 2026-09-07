# SolidOps — Plataforma de operaciones IT

Plataforma web de operaciones IT para una empresa de soporte técnico (MSP) que
atiende ~50 clientes pyme. Reemplaza el sistema de tickets anterior (Zammad).

**Stack:** NestJS (API + WebSocket) · Next.js · PostgreSQL + pgvector · Redis ·
MinIO · Caddy (TLS). Todo en contenedores Docker sobre un VPS propio.

## Qué hay en la Fase 1

1. Autenticación y usuarios (JWT + refresh, bcrypt).
2. RBAC: roles Administrador / Supervisor / Coordinador / Técnico / Consulta con permisos por módulo.
3. Técnicos: perfil, especialidades, nivel, horario, estado de presencia.
4. Clientes: `Customer` + `Contact` + `Site` + `Contract` (SLA y horario laboral).
5. Agenda: `Appointment` polimórfico (reunión/visita/guardia/tarea) y `Task` con recurrencia.
6. Tickets: estados configurables, prioridad, categoría, asignación, hilo de mensajes y adjuntos.
7. SLA: primera respuesta + resolución según prioridad y horario del contrato. Semáforo verde/amarillo/rojo.
8. Ingresión de emails entrantes → crea o actualiza ticket.
9. Dashboards: "Mi día" (técnicos/coordinadores) y general (supervisores).
10. Notificaciones in-app sobre WebSocket (ticket asignado, SLA en riesgo, tarea atrasada).
11. Auditoría transversal.

## Qué hay en la Fase 2 (en curso)

1. **Gestión de casillas de correo**: alta/edición/desactivación de mailboxes desde la UI
   (`/casillas`), con contraseñas cifradas (AES-256-GCM) y worker cron que itera todas
   las activas. Soporta **modo sombra** (lectura-only).
2. Reglas de enrutamiento ("cajones") y destino `document`.
3. Migración histórica desde Zammad (export vía `import/export_zammad.rb` + import
   con `npm run import:zammad`; **backups obligatorios** previos — ver
   `docs/ZAMMAD-MIGRATION.md`).
4. Portal de clientes y WhatsApp + chatbot (en paralelo, según credenciales).

## Estructura

```
docker-compose.dev.yml     # local (Windows + Docker Desktop/WSL2), HTTP, hot-reload
docker-compose.prod.yml    # VPS, Caddy + Let's Encrypt, HTTPS
backend/                   # NestJS + TypeORM
frontend/                  # Next.js
caddy/Caddyfile            # reverse proxy + TLS (producción)
docs/                      # guías: SETUP, migración a VPS, verificación
```

## Arranque rápido (local)

1. **Prerrequisito:** Docker Desktop para Windows con el backend de **WSL2**
   activado. En *Settings → Resources* asigná al menos **4 CPU y 8 GB de RAM**.
2. Cloná este repo y creá tu `.env` a partir de `.env.example`.
3. Levantá el stack:

   ```bash
   docker compose -f docker-compose.dev.yml up --build
   ```

4. Abrí <http://localhost:3000>.

Los servicios registran logs; la base se crea y se siembra automáticamente la
primera vez (`RUN_SEED=true`).

### Usuarios de demostración (contraseña `demo1234`)

| Email              | Rol         |
| ------------------ | ----------- |
| `ana@msp.local`    | Supervisor (entra al dashboard) |
| `lucas@msp.local`  | Coordinador |
| `maria@msp.local`  | Técnico (entra a "Mi día") |
| `pedro@msp.local`  | Técnico |

> En producción cambiá estas contraseñas y el `JWT_SECRET` / `JWT_REFRESH_SECRET`.

### Puertos en local

| Servicio          | URL                    |
| ----------------- | ---------------------- |
| Frontend          | http://localhost:3000  |
| API               | http://localhost:4000  |
| Consola MinIO     | http://localhost:9001  |

## Documentación

- [SETUP local](docs/SETUP.md) — cómo levantar, probar y solucionar problemas.
- [Migración al VPS](docs/MIGRATION-RUNBOOK.md) — runbook completo de puesta en producción.
- [Verificación de Fase 1](docs/VERIFICATION.md) — checklist de aceptación.
- [Migración desde Zammad](docs/ZAMMAD-MIGRATION.md) — export, backups obligatorios e import del historial.

## Casillas de correo y "modo sombra"

Las casillas se administran desde **`/casillas`** (solo Admin/Supervisor). Cada casilla
tiene un **modo sombra** (`shadow_mode`) que, mientras está activo, hace que SolidOps
**lea la casilla sin marcar como leído, sin borrar ni responder** — pensado para la etapa
en la que Zammad sigue siendo el sistema que procesa `soporte@solidocs.com.ar`.

**Paso del corte (cuando Zammad deja de ser el que procesa):**
1. Andá a `/casillas`.
2. Desactivá el **modo sombra** en la casilla `soporte@solidocs.com.ar` (toggle "salir de sombra").
3. El worker pasa de solo lectura a procesamiento real. Este paso **no requiere reiniciar el
   backend ni tocar código**.

> **Seguridad:** las contraseñas de las casillas se guardan cifradas (AES-256-GCM) mediante
> `ENCRYPTION_SECRET`. La API nunca devuelve el valor real — lo reemplaza por `••••••••`.
> En producción, usar un `ENCRYPTION_SECRET` largo y aleatorio, distinto de `JWT_SECRET`.

## Scripts de testing

Dentro de `backend/`:

```bash
# Unit tests (SLA, subject-key, recurrencia)
npm test

# Smoke e2e (requiere stack arriba: base + redis + minio)
npm run test:e2e
```
