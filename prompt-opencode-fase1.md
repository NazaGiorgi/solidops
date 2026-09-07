# PROMPT PARA OPENCODE — FASE 1: NÚCLEO OPERATIVO

Vas a construir la Fase 1 de una plataforma web de operaciones IT para una empresa de soporte técnico (MSP) que atiende ~50 clientes pyme con un equipo de 3-4 técnicos. Este prompt define el alcance exacto de esta etapa, las restricciones técnicas obligatorias y la metodología de trabajo. No implementes nada fuera de lo que está listado en "Alcance de esta etapa" — las fases siguientes se abordan en prompts separados, una vez que esta esté probada y aprobada.

---

## 1. Contexto del producto

La plataforma reemplaza por completo un sistema de tickets anterior (Zammad) y es el sistema operativo diario del equipo: agenda, tickets, clientes y técnicos en un solo lugar. No hay integración con Jira ni con Zammad — esto se construye desde cero como fuente única de verdad.

Modelo de negocio: **una sola empresa (el MSP) gestionando muchos clientes pyme** — no es multi-tenant tipo SaaS. Alcanza con permisos por fila sobre `customer_id`, no con aislamiento de infraestructura por tenant.

---

## 2. Restricciones técnicas obligatorias

- **Todo corre en contenedores Docker sobre un VPS propio.** Nada de servicios cloud gestionados (sin AWS S3, sin RDS gestionado, etc.).
- **Stack:**
  - Backend: Node.js + NestJS (API REST + WebSockets)
  - Frontend: React + Next.js
  - Base de datos: PostgreSQL (con `pgvector` disponible para el futuro, aunque no se use todavía)
  - Cache/colas: Redis
  - Almacenamiento de archivos: MinIO (API compatible S3, self-hosted)
  - Reverse proxy / TLS: Traefik o Caddy con Let's Encrypt
- **Orquestación:** un `docker-compose.yml` por ambiente (dev/prod). Cada módulo que agregues debe venir con el fragmento de compose correspondiente y la lista de variables de entorno/secrets nuevas que hay que cargar.
- **Sizing de referencia del VPS destino:** 4 vCPU / 8 GB RAM / 100-160 GB SSD. Diseñá pensando en ese límite de recursos — nada de servicios pesados innecesarios corriendo en paralelo.
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
3. Escribí o corré pruebas básicas que validen que funciona.
4. Verificá explícitamente que no rompiste nada de lo implementado antes.
5. Documentá el cambio (qué se agregó, qué variables de entorno o pasos manuales requiere).
6. Entregá el fragmento de `docker-compose.yml` correspondiente y la lista de env vars/secrets nuevos antes de pasar al siguiente módulo.

Orden sugerido: (1) modelo de datos + auth + roles → (2) clientes/contactos/sitios/contratos → (3) técnicos → (4) tickets + SLA + mensajes → (5) ingestión de email → (6) agenda + tareas → (7) dashboard "Mi día" y general → (8) notificaciones in-app → (9) auditoría transversal (aplicarla sobre lo ya construido).

No asumas que el usuario que te da este prompt puede revisar código línea por línea — priorizá que cada etapa sea algo que se pueda probar funcionalmente desde la interfaz antes de seguir.

---

## 7. Definición de "Fase 1 terminada"

- Un supervisor puede loguearse, ver el dashboard general y entender el estado de la operación en segundos.
- Un técnico puede loguearse, ver "Mi día" y trabajar tickets/tareas/agenda sin salir de la plataforma.
- Un ticket se puede crear manualmente o por email entrante, asignarse, cambiar de estado, y su SLA se calcula y muestra correctamente según el contrato del cliente.
- Todo cambio relevante queda auditado.
- Todo el stack levanta con `docker-compose up` en un VPS limpio siguiendo la documentación entregada, sin pasos manuales no documentados.
