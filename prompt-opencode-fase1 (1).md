# PROMPT PARA OPENCODE — FASE 1: NÚCLEO OPERATIVO

Vas a construir la Fase 1 de una plataforma web de operaciones IT para una empresa de soporte técnico (MSP) que atiende ~50 clientes pyme con un equipo de 3-4 técnicos. Este prompt define el alcance exacto de esta etapa, las restricciones técnicas obligatorias y la metodología de trabajo. No implementes nada fuera de lo que está listado en "Alcance de esta etapa" — las fases siguientes se abordan en prompts separados, una vez que esta esté probada y aprobada.

---

## 1. Contexto del producto

La plataforma reemplaza por completo un sistema de tickets anterior (Zammad) y es el sistema operativo diario del equipo: agenda, tickets, clientes y técnicos en un solo lugar. No hay integración con Jira ni con Zammad — esto se construye desde cero como fuente única de verdad.

Modelo de negocio: **una sola empresa (el MSP) gestionando muchos clientes pyme** — no es multi-tenant tipo SaaS. Alcanza con permisos por fila sobre `customer_id`, no con aislamiento de infraestructura por tenant.

---

## 2. Restricciones técnicas obligatorias

- **Antes de escribir una sola línea de código, verificá que tu entorno de ejecución tiene acceso real a las herramientas que vas a necesitar.** Corré, en tu propia terminal, en este orden: `node -v`, `npm -v`, `docker --version`, `docker compose version`. Si alguno falla, decilo explícitamente y pedí que se resuelva antes de continuar — no escribas código que no podés ejecutar ni probar. "Escribir sin ejecutar" no es una opción válida para dar por cerrada ninguna etapa de este proyecto.
- **Se desarrolla primero en local, en la computadora del usuario (Windows con Docker Desktop + backend WSL2), y se migra a un VPS recién cuando Fase 1 esté validada.** No configures Caddy con Let's Encrypt todavía — en local no hay dominio público ni certificados válidos. Usá HTTP plano en `localhost` con puertos mapeados (ej. frontend en `localhost:3000`, API en `localhost:4000`, consola de MinIO en `localhost:9001`).
- **Prerrequisito del lado del usuario (documentalo, no lo hagas vos):** Docker Desktop para Windows instalado con el backend WSL2 activado, con integración habilitada para la distro específica donde corre este proyecto, con al menos 4 CPU y 8 GB de RAM asignados a Docker Desktop (Settings → Resources) — sin eso, Postgres + Redis + MinIO + backend + frontend corriendo juntos van a ir lentos o fallar.
- **Dos archivos de compose separados desde el inicio:** `docker-compose.dev.yml` (local, sin TLS, con hot-reload de frontend/backend si es posible) y `docker-compose.prod.yml` (con Caddy + Let's Encrypt, pensado para el VPS). Mantenelos lo más parecidos posible en nombres de servicios y variables, para que migrar sea cambiar configuración, no reescribir infraestructura.
- **Stack:**
  - Backend: Node.js + NestJS (API REST + WebSockets)
  - **ORM: TypeORM** (integración nativa con NestJS, decoradores de entidad, soporte transaccional y compatibilidad con `pgvector` para el futuro) — no uses Prisma ni otro ORM. En desarrollo usá `synchronize: true` (schema automático); documentá en el README, antes de cerrar esta etapa, cuándo y cómo se genera la primera migración real de TypeORM para producción — no lo dejes como algo implícito.
  - Frontend: React + Next.js
  - Base de datos: PostgreSQL (con `pgvector` disponible para el futuro, aunque no se use todavía)
  - Cache/colas: Redis
  - Almacenamiento de archivos: MinIO (API compatible S3, self-hosted)
  - Reverse proxy / TLS: **Caddy** (decisión ya tomada, no la reabras) — solo en `docker-compose.prod.yml`, no en local
- **Autenticación: JWT en cookie `httpOnly` + `secure`, nunca en `localStorage` del frontend.** Esto es no negociable desde esta etapa, no se deja para "cuando pase a producción" — corregirlo después de que el frontend ya asuma `localStorage` es mucho más caro que hacerlo bien ahora.
- **Al final de Fase 1, entregá un runbook de migración a VPS** (ver sección 8) — no asumas que la migración es automática ni que se hace sola.
- **Sizing de referencia del VPS destino (para cuando se migre):** 4 vCPU / 8 GB RAM / 100-160 GB SSD — punto de partida, no un techo; la cartera de clientes no tiene límite en el modelo de datos.
- **Multi-cliente, no multi-tenant:** todas las tablas relevantes llevan `customer_id` donde corresponda; no implementes `organization_id` ni aislamiento de esquema por tenant.

---

## 3. Alcance de esta etapa (Fase 1) — lo único que hay que construir ahora

1. **Autenticación y usuarios**: login, gestión de usuarios, sesiones seguras.
2. **RBAC básico**: roles Administrador, Supervisor, Coordinador, Técnico, Consulta. Permisos por rol sobre cada módulo.
3. **Técnicos**: perfil (nombre, foto, especialidades, nivel, horario, estado disponible/ocupado).
4. **Clientes**: `Customer` con `Contact` (múltiples contactos), `Site` (sitios/sucursales) y `Contract` (SLA contratado, horas incluidas, horario de cobertura — cada pyme puede tener condiciones distintas).
5. **Agenda**: modelo polimórfico de `Appointment` (reunión, tarea con horario, visita, guardia genérica); vistas diaria/semanal/mensual, por técnico; drag & drop para mover/reasignar. Tareas simples (`Task`) con estado, prioridad, fecha, responsable, y opción de recurrencia básica (diaria/semanal/mensual).
6. **Tickets propios**: `Ticket` con estado configurable (nuevo, abierto, asignado, en progreso, esperando cliente, resuelto, cerrado), prioridad, categoría, cliente/contacto/sitio asociado, técnico asignado. `TicketMessage` y `TicketAttachment` para el hilo de conversación (por ahora solo canal "email" y "manual/portal interno" — WhatsApp y chatbot son Fase 2).
7. **SLA básico**: cálculo de tiempo de primera respuesta y resolución según prioridad y horario laboral definido en el `Contract` del cliente. Semáforo visual verde/amarillo/rojo.
8. **Vista de tickets por email**: ingestión de emails entrantes que crean o actualizan un ticket (buscar por remitente contra `Contact`; si hay ticket abierto reciente del mismo asunto, agregar mensaje; si no, crear ticket nuevo).
9. **Dashboard**: pantalla "Mi día" para técnicos/coordinadores (agenda de hoy, tickets asignados, tareas pendientes) y dashboard general para supervisores (tickets críticos, SLA en riesgo, estado del equipo, carga por técnico).
10. **Notificaciones in-app**: centro de notificaciones dentro de la plataforma (ticket asignado, SLA por vencer, tarea atrasada). Nada de canales externos todavía (WhatsApp/email de salida es Fase 2).
11. **Auditoría**: registro de usuario, fecha, acción, objeto afectado, valor anterior/nuevo para cambios de estado, prioridad y asignación.

### Explícitamente fuera de alcance en esta etapa (no lo implementes)
WhatsApp Business API, chatbot, IA (clasificación/resúmenes/duplicados), portal de clientes externo, NOC, incidentes/problemas/cambios, activos, visitas técnicas con checklist, mantenimientos, guardias formales con reemplazos, automatizaciones configurables, base de conocimiento. Todo esto es Fase 2 en adelante.

---

## 4. Modelo de datos de esta etapa

Implementá como mínimo estas entidades y relaciones (podés ajustar nombres/columnas según convenciones de NestJS/TypeORM o Prisma, pero mantené las relaciones):

```
User (id, name, email, password_hash, role_id, active)
Role (id, name) — Administrador | Supervisor | Coordinador | Técnico | Consulta
Technician (id, user_id, specialties[], level, schedule, status: disponible|ocupado|fuera_de_horario)

Customer (id, name, active)
Contact (id, customer_id, name, email, phone, whatsapp, preferred_channel)
Site (id, customer_id, name, address)
Contract (id, customer_id, sla_first_response_minutes, sla_resolution_hours, business_hours, priority_tier)

Ticket (id, customer_id, contact_id, site_id, technician_id, title, status, priority, category, created_at, updated_at)
TicketMessage (id, ticket_id, author_type: cliente|tecnico|sistema, channel: email|portal, body, created_at)
TicketAttachment (id, ticket_message_id, file_url, filename, mime_type)
SLA (id, ticket_id, first_response_due_at, resolution_due_at, first_response_at, resolved_at, status: verde|amarillo|rojo)

Task (id, title, assignee_id, due_at, status, priority, recurrence_rule, related_entity_type, related_entity_id)
Appointment (id, type: reunión|visita|guardia|tarea, technician_id, customer_id, start_at, end_at, notes)

Notification (id, user_id, type, payload, read_at, created_at)
AuditLog (id, user_id, action, entity_type, entity_id, old_value, new_value, created_at)
```

Usá soft delete (`deleted_at`) en `Ticket`, `Customer` y `Contact` — nunca se borra historial operativo. Agregá índices sobre `status`, `priority`, `sla.status`, `technician_id` y `customer_id` en `Ticket`, porque son los filtros principales del dashboard.

---

## 5. Lineamientos de diseño de interfaz

Referencia visual ya validada (mockups aprobados):

- Minimalista, plano, sin gradientes ni sombras decorativas. Bordes finos (0.5px).
- Pocos colores: uso semántico, no decorativo — verde = disponible/resuelto/SLA ok, amarillo = en riesgo/atención, rojo = crítico/vencido, gris/azul para estados neutros.
- Badges de estado y prioridad como pastillas de texto sobre fondo de color suave (nunca texto negro sobre fondo de color).
- Sentence case en todo — nunca Title Case ni mayúsculas.
- Cards planas para listar entidades (tickets, clientes, técnicos), con jerarquía clara: título 14-15px medio, metadata 12-13px en gris secundario.
- Acciones rápidas siempre visibles desde el detalle de una entidad (asignar, escalar, agendar) — nunca obligar a cambiar de pantalla para una acción común.
- Pantalla de entrada según rol: técnicos/coordinadores entran a "Mi día"; supervisores entran al dashboard general.
- Responsive: desktop-first, pero que la vista "Mi día", tickets y agenda funcionen razonablemente en tablet/móvil desde esta fase (no hace falta una app móvil nativa todavía).

---

## 6. Metodología de trabajo (obligatoria)

No generes toda la Fase 1 de una sola vez. Trabajá en este orden, y para cada módulo:

1. Explicá brevemente qué vas a implementar y por qué en ese orden.
2. Implementalo.
3. **Ejecutá vos mismo** las pruebas básicas que validen que funciona — correr `docker compose -f docker-compose.dev.yml up --build` y los tests correspondientes, no solo describir qué pruebas "deberían" correrse. Si tu entorno no te permite ejecutar nada, decilo de inmediato en ese momento, no al final de toda la fase.
4. Verificá explícitamente que no rompiste nada de lo implementado antes.
5. Documentá el cambio (qué se agregó, qué variables de entorno o pasos manuales requiere).
6. Entregá el fragmento de `docker-compose.dev.yml` correspondiente y la lista de env vars/secrets nuevos antes de pasar al siguiente módulo.

Orden sugerido: (1) modelo de datos + auth + roles → (2) clientes/contactos/sitios/contratos → (3) técnicos → (4) tickets + SLA + mensajes → (5) ingestión de email → (6) agenda + tareas → (7) dashboard "Mi día" y general → (8) notificaciones in-app → (9) auditoría transversal (aplicarla sobre lo ya construido).

No asumas que el usuario que te da este prompt puede revisar código línea por línea — priorizá que cada etapa sea algo que se pueda probar funcionalmente desde la interfaz antes de seguir.

---

## 8. Runbook de migración: de tu equipo (local) al VPS

Documentá esto como un procedimiento reproducible, no como pasos sueltos — el usuario no programa, así que tiene que poder seguirlo literal:

1. **Exportar datos:** `pg_dump` de la base de Postgres local + copia del volumen de datos de MinIO (adjuntos, fotos).
2. **Preparar el VPS:** confirmar que ya tiene Docker + Docker Compose instalados y el dominio apuntando (esto lo hace el usuario siguiendo la checklist de infraestructura ya acordada, no el agente).
3. **Copiar el proyecto al VPS:** repo/código + `docker-compose.prod.yml` + archivo `.env.prod` con las variables de producción (dominio real, credenciales nuevas, no las mismas de desarrollo).
4. **Restaurar datos:** importar el dump de Postgres y los archivos de MinIO en los volúmenes del VPS.
5. **Levantar con el compose de producción:** `docker compose -f docker-compose.prod.yml up -d`, verificar que Traefik/Caddy emite el certificado TLS correctamente contra el dominio real.
6. **Checklist de paridad:** login funciona, se puede crear/ver un ticket, la agenda carga, las notificaciones llegan — antes de dar de baja el entorno local como fuente de verdad.
7. **A partir de acá, el entorno local pasa a ser solo de desarrollo/pruebas** de las fases siguientes (Fase 2 en adelante); el VPS es el único ambiente real.

Esto se ejecuta **una sola vez, al final de Fase 1** (no en cada módulo) — mientras se desarrolla, todo el trabajo diario ocurre en local, accedido desde el navegador en `localhost`.

---

## 9. Definición de "Fase 1 terminada"

- Un supervisor puede loguearse, ver el dashboard general y entender el estado de la operación en segundos.
- Un técnico puede loguearse, ver "Mi día" y trabajar tickets/tareas/agenda sin salir de la plataforma.
- Un ticket se puede crear manualmente o por email entrante, asignarse, cambiar de estado, y su SLA se calcula y muestra correctamente según el contrato del cliente.
- Todo cambio relevante queda auditado.
- Todo el stack levanta con `docker compose -f docker-compose.dev.yml up` en la computadora Windows del usuario (con Docker Desktop + WSL2) sin pasos manuales no documentados, y el runbook de migración al VPS está probado al menos una vez.
