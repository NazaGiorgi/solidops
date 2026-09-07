# Plataforma de operaciones IT — Análisis arquitectónico
**Versión:** borrador para aprobación · **Fecha:** 29/08/2026

---

## A. Visión del producto

El problema real no es "no tenemos agenda" ni "no tenemos tickets" — es que la información de la operación IT vive repartida entre WhatsApp, mails, cabezas de técnicos y, en el mejor caso, Zammad. Nadie puede responder en 10 segundos "¿qué está pasando ahora?".

La plataforma es el **sistema operativo del equipo IT**: un lugar único donde converge todo lo que un técnico, un supervisor o un cliente necesitan saber sobre el estado de la operación, sin tener que saltar entre herramientas.

Métrica de éxito del producto: un supervisor nuevo, sin contexto previo, debe poder entender el estado completo de la operación en menos de 30 segundos mirando el dashboard.

---

## B. Arquitectura propuesta (visión completa)

Cuatro capas, desacopladas mediante eventos:

1. **Canales** — WhatsApp, email, portal de clientes, chatbot, integraciones NOC (Zabbix/Grafana/Uptime Kuma).
2. **Integration layer** — normaliza todo lo que entra en un modelo común de eventos (`TicketCreated`, `AlertReceived`, `CustomerMessageReceived`, etc.) y lo publica en un event bus. Es la única capa que habla con cada API externa — el núcleo nunca llama a WhatsApp o a una herramienta de monitoreo directamente.
3. **Operations platform (núcleo)** — agenda, tickets, incidentes, clientes, activos, guardias, mantenimientos, conversation engine, automation engine, notification service. Es el *source of truth* único de todo el negocio (no hay Zammad ni Jira compitiendo por ningún dato).
4. **Sistemas satélite** — solo monitoreo (Zabbix/Grafana/Uptime Kuma) y comunicación (Teams/Slack) si se decide sumarlos más adelante.

Principios de diseño:
- **Un solo punto de entrada por canal** — nada dentro del núcleo sabe que existe WhatsApp; solo sabe que llegó un `CustomerMessageReceived`.
- **Event-driven, no polling** salvo donde la API externa no ofrezca webhooks (ver sección de riesgos de Zammad).
- **La IA sugiere, no decide** — ninguna automatización crítica (cerrar ticket, escalar, notificar cliente) se ejecuta sin regla explícita o confirmación humana en la fase inicial.

---

## C. Decisión: reemplazo total de Zammad

**Definición confirmada:** no se usa Jira (fue solo una referencia conceptual del prompt original, no una dependencia real) y **Zammad se reemplaza por completo** — no hay convivencia temporal ni integración de sincronización con él. La plataforma nueva es dueña única de tickets, agenda, clientes, NOC, conversaciones.

**Dato clave que cambia la prioridad:** hoy la mayoría de las consultas ya entran por WhatsApp, no por el portal/Zammad. Eso significa que WhatsApp + chatbot no es un "nice to have" de fase 4 — es el canal principal de entrada de tickets y hay que tratarlo como tal desde el arranque del roadmap (ver sección O, se movió a Fase 2).

Esto simplifica bastante la arquitectura respecto al análisis anterior:

- ✅ Un solo dueño de todos los datos — sin sincronización, sin doble fuente de verdad, sin mapeo de estados entre dos sistemas.
- ✅ Total libertad para diseñar el sistema de tickets como conviene al caso de uso real (WhatsApp, chatbot, IA, SLA a medida) sin las limitaciones de la API de un tercero.
- ✅ Menos superficie de integración externa = menos riesgo operativo de terceros.
- ⚠️ El costo pasa a estar 100% en construir bien el sistema de tickets propio (SLA, workflows, conversaciones) — es el módulo más grande del proyecto.
- ⚠️ Sin Zammad de respaldo, la migración de tickets/clientes existentes (si los hay) hay que planificarla como una tarea explícita de importación única antes de apagarlo — esto sigue pendiente de confirmar (ver pregunta al final).

No hace falta un "Integration Layer" pensado para desacoplar de Zammad — el layer de integraciones queda enfocado en canales externos reales: WhatsApp (prioridad 1), email, y a futuro herramientas de monitoreo NOC.

## C.1 Modelo de negocio: MSP con múltiples clientes pyme (no multi-tenant SaaS)

Confirmado: la plataforma es para **una sola empresa (ustedes, el proveedor de soporte)** que gestiona **muchos clientes pyme**. Esto es distinto de "multi-tenant" en el sentido SaaS (instancias aisladas para distintas empresas de soporte que revenden el producto) — es un caso mucho más simple: **un solo tenant, muchos `Customer`**.

Consecuencias de diseño:
- No hace falta aislamiento de tenant a nivel de infraestructura ni `organization_id` en cada tabla — alcanza con el modelo `Customer` ya definido (empresa ABC, empresa XYZ, etc.) con permisos por fila (un técnico o un contacto de portal solo ve los tickets de su/sus clientes asignados).
- Sí conviene agregar una entidad **`Contract`** por cliente (SLA contratado, horas incluidas, horario de cobertura, prioridad de contrato) porque cada pyme probablemente tiene condiciones distintas — esto faltaba en el modelo de datos original y se agrega en la sección E.
- El **portal de clientes** (sección de WhatsApp/portal) debe garantizar que cada pyme solo vea su propia información — control de acceso por `customer_id`, no aislamiento de infraestructura.
- Reportes y facturación (horas trabajadas, tickets, SLA cumplido) deben poder filtrarse y exportarse por cliente individualmente, ya que probablemente se factura por cliente.

---

## D. Diagrama de flujo — ver los dos diagramas mostrados arriba en el chat
(arquitectura de integración general y ciclo de vida de un incidente hasta Jira). No se repiten acá para no duplicar contenido.

---

## E. Modelo de datos (entidades principales y relaciones)

```
User ── belongs to ── Team
User ── has one ── Role (RBAC)
Technician ── extends ── User (especialidades, nivel, horario, disponibilidad)

Customer ── has many ── Contact
Customer ── has many ── Site
Customer ── has one ── Contract (SLA contratado, horas incluidas, horario de cobertura)
Site ── has many ── Asset
Site ── has many ── Service

Ticket ── belongs to ── Customer, Contact, Site (opcional)
Ticket ── has many ── TicketMessage (canal: whatsapp/email/portal/bot/api)
Ticket ── has many ── TicketAttachment
Ticket ── belongs to ── Technician (asignado)
Ticket ── has one ── SLA
Ticket ── may belong to ── Incident

Incident ── has many ── Ticket
Incident ── may have ── Problem
Incident ── may have ── Change

Task ── may belong to ── Ticket | Customer | Incident | Maintenance | Asset (polimórfico)
Task ── belongs to ── User (responsable)
Task ── has ── recurrence rule (opcional)

Appointment ── belongs to ── Technician, Customer (opcional)
Meeting ── has many ── Task (tareas derivadas post-reunión)
Maintenance ── has one ── Checklist
Maintenance ── may generate ── Appointment, Task, Ticket

Shift (guardia) ── belongs to ── Technician ── has period

Conversation ── has many ── Message
Conversation ── belongs to ── Channel (whatsapp/email/portal/bot)
Conversation ── linked to ── Ticket

Notification ── belongs to ── User ── has channel (app/email/whatsapp/teams/slack)
AuditLog ── belongs to ── User ── references entity (polimórfico) + valor anterior/nuevo

Integration ── stores credentials/config por sistema externo (WhatsApp, Zabbix, email...)
Automation ── define regla (condición → acción), referencia eventos del event bus

KnowledgeArticle ── may be linked to ── Ticket, Incident (many-to-many)
```

Consideraciones de diseño:
- **Soft delete** en Ticket, Customer, Asset (nunca se borra historial operativo).
- **Polimorfismo controlado** en Task, Attachment y Notification para no explotar el esquema con tablas repetidas.
- Índices sobre `status`, `priority`, `sla_due_at`, `technician_id`, `customer_id` — son los filtros más usados en dashboard y listados.
- **Modelo de acceso por cliente, no multi-tenant de infraestructura**: como es una sola empresa gestionando muchos clientes pyme (no un SaaS revendido), alcanza con permisos por fila sobre `customer_id` — un contacto del portal o un técnico asignado solo ve los datos de su(s) cliente(s). No hace falta `organization_id` ni aislamiento de infraestructura por tenant.

---

## F. UX / mapa de navegación

Menú lateral (por rol, no todos ven todo):

```
Mi día (default al entrar) · Agenda · Tickets · Incidentes · NOC
Clientes · Técnicos · Activos · Mantenimientos · Guardias
Base de conocimiento · Reportes · Integraciones · Administración
```

Reglas de navegación:
- **"Mi día"** es la pantalla de entrada para técnicos y coordinadores — no el dashboard general.
- El **dashboard general** (operación completa) es la pantalla de entrada para supervisores/gerencia.
- Desde cualquier entidad (ticket, cliente, incidente) siempre hay acciones rápidas visibles: Asignar / Escalar / Agendar / Crear tarea — nunca hace falta cambiar de pantalla para eso.
- Búsqueda global `Ctrl+K` disponible en todo momento.

---

## G. Dashboards por rol (diseño conceptual)

- **Técnico:** Mi día (agenda + tickets + tareas de hoy), tareas atrasadas, incidentes donde está asignado.
- **NOC:** alertas activas, disponibilidad de servicios, incidentes abiertos, mantenimientos en curso.
- **Supervisor:** estado del equipo (disponible/ocupado/en visita), tickets críticos, SLA en riesgo, carga por técnico, tareas atrasadas del equipo.
- **Gerencial:** tendencias (tickets/mes, cumplimiento SLA, horas facturables), productividad por técnico/cliente, reincidencias.

Cada widget del dashboard debe poder abrirse en detalle con un click (nunca queda como un número sin acción).

---

## H. Agenda — diseño completo

La agenda es un calendario de **actividades polimórficas**, no solo reuniones. Un mismo modelo (`Appointment`) soporta: reunión, visita técnica, mantenimiento, guardia, tarea con horario, capacitación.

Funciones clave:
- Vistas: diaria / semanal / mensual / por técnico / por cliente / por sitio.
- Drag & drop para mover, redimensionar, reasignar técnico.
- **Tareas recurrentes** (diaria/semanal/mensual/personalizada) vía regla tipo RRULE (estándar iCal), no una tabla de "tareas repetidas" hardcodeada.
- **Seguimientos automáticos**: al cerrar un ticket, el sistema pregunta si crear una tarea de seguimiento (ej. "contactar en 48h") — esto se modela como una automatización estándar, no como código especial.
- **Tareas derivadas de reuniones**: al cerrar una reunión, se puede generar una lista de tareas asociadas con un solo formulario.
- La agenda de un cliente muestra su historial completo (tickets, visitas, reuniones, incidentes) — es, de hecho, el historial operativo del cliente.

---

## I. Sistema de tickets — diseño funcional

- **Workflow configurable** por organización: estados por defecto (nuevo, abierto, asignado, en progreso, esperando cliente/proveedor/repuesto, escalado, resuelto, cerrado), pero el admin puede agregar/quitar estados sin tocar código.
- **SLA** parametrizable por prioridad y calendario laboral (con feriados) — primera respuesta y resolución se calculan sobre horario hábil, no 24/7, salvo que el cliente tenga contrato con cobertura extendida.
- **Conversación unificada**: cada ticket tiene un hilo de mensajes que puede venir de portal, email, WhatsApp o chatbot — todos aparecen en el mismo timeline, sin que el técnico tenga que saltar de app.
- **Email → ticket**: se identifica el remitente contra `Contact`; si hay un ticket abierto reciente del mismo asunto, se agrega como mensaje; si no, se crea uno nuevo. Reglas de "mismo asunto" configurables (por thread-id de email cuando existe).
- **Detección de duplicados**: comparación por cliente + ventana de tiempo + similitud de texto (embeddings) contra tickets abiertos recientes — se muestra como sugerencia ("posible relacionado con #1001"), nunca se fusiona automáticamente.
- **Escalamiento por niveles** (L1/L2/L3/NOC/Infra/Desarrollo/Proveedor) configurable por reglas (ver Automatizaciones).

---

## J. Chatbot — arquitectura

El chatbot es un cliente más del **conversation engine**, no un sistema aparte.

Flujo:
1. Mensaje entra por WhatsApp/portal → conversation engine identifica cliente/contacto.
2. El bot corre un flujo de diagnóstico guiado (preguntas cortas) + búsqueda en base de conocimiento vía embeddings.
3. Si encuentra respuesta con confianza suficiente → la entrega y pregunta si resolvió.
4. Si no resuelve o el cliente pide un humano → crea ticket con: categoría sugerida, prioridad sugerida, resumen generado, datos recopilados durante la conversación, origen = "chatbot".
5. El ticket queda en la cola del equipo con todo el contexto ya armado — el técnico no arranca de cero.

Principio: el bot nunca cierra un ticket ni cambia prioridad de un ticket ya creado por un humano — solo actúa sobre la conversación previa a la creación del ticket.

---

## K. WhatsApp — arquitectura de integración

- Usar **WhatsApp Business API** (Meta Cloud API o un BSP/proveedor compatible) — no soluciones no oficiales, por riesgo de bloqueo de número.
- Flujo: mensaje entra por webhook → Integration Layer lo normaliza a `CustomerMessageReceived` → Conversation Engine identifica cliente por número de teléfono → si hay ticket abierto reciente, se agrega como mensaje; si no, pasa al chatbot o se crea ticket directo.
- Ventana de 24h de Meta: hay que diseñar el motor de notificaciones para usar **plantillas aprobadas** cuando se necesita reabrir conversación fuera de esa ventana (ej. "tu ticket fue actualizado").
- Adjuntos (fotos, capturas) se guardan como `TicketAttachment` vinculados al mensaje de origen.

---

## L. Casos de uso de IA (siempre en modo sugerencia, no decisión automática crítica)

- Clasificación y priorización sugerida de tickets nuevos.
- Resumen automático de conversaciones largas para que el técnico no lea todo el historial.
- Sugerencia de respuestas basadas en la base de conocimiento.
- Detección de posibles duplicados/incidentes relacionados.
- Detección de sentimiento (para priorizar clientes molestos).
- Predicción de riesgo de incumplimiento de SLA basada en carga actual del técnico asignado.
- Recomendación de técnico a asignar (no asignación automática en el MVP).

Todas estas funciones deben poder desactivarse por organización — no todos los clientes van a querer IA sobre sus conversaciones.

---

## M. Motor de automatizaciones (reglas)

Modelo simple **condición → acción**, sin código, administrable desde UI:

```
SI  prioridad = Crítica
ENTONCES  notificar supervisor + sugerir técnico

SI  SLA restante < 30 min
ENTONCES  notificar técnico asignado

SI  ticket sin asignar > 15 min
ENTONCES  notificar coordinador

SI  alerta NOC recibida (Zabbix) Y servicio = productivo
ENTONCES  crear incidente + crear ticket + sugerir técnico de guardia
```

Todas las reglas se disparan sobre eventos del event bus (`TicketCreated`, `SLAWarning`, `AlertReceived`, etc.), lo que permite agregar reglas nuevas sin tocar el código de cada módulo.

---

## N. Modelo de seguridad

- RBAC con roles iniciales: Administrador, Supervisor, Coordinador, Técnico L1/L2/L3, NOC, Cliente (portal), Consulta.
- Autenticación con sesiones seguras + preparado para MFA desde el diseño de la tabla de usuarios (aunque no se active en el MVP).
- Rate limiting en API pública (portal de clientes, webhooks).
- Todas las credenciales de integraciones (Zammad, Jira, WhatsApp, Zabbix) en un vault de secrets, nunca en variables de entorno planas ni en la base sin cifrar.
- Auditoría de todo cambio de estado, prioridad, asignación y dato sensible de cliente (usuario, fecha, acción, valor anterior/nuevo).
- Backups automáticos con retención definida y prueba periódica de restore (un backup que nunca se probó no es un backup).

---

## O. MVP recomendado

**⚠️ Acción en paralelo, desde ya (no es parte de las fases de desarrollo):** iniciar el trámite de aprobación de WhatsApp Business API (Meta Cloud API o un BSP) hoy mismo. El proceso de verificación de negocio y aprobación de plantillas de mensaje puede demorar semanas — si se espera a llegar a la fase de desarrollo correspondiente para arrancarlo, ese trámite se convierte en el cuello de botella de todo el proyecto. Se puede tramitar en paralelo mientras se construye la Fase 1, sin depender de tener código listo.

**Fase 1 (núcleo operativo):**
Login, usuarios, roles, técnicos, clientes (con contratos/SLA por cliente), dashboard, agenda (con tareas y seguimientos), tickets propios con SLA básico, vista de tickets por email (paridad con el uso actual de Zammad), notificaciones in-app, auditoría.

Justificación: sin agenda + tickets + clientes funcionando bien, nada más importa. Esto es lo que valida si vale la pena seguir.

**Fase 2 — se adelanta, es el canal real de hoy:**
Integración WhatsApp Business API (una vez aprobada) + conversation engine + chatbot v1 (triage básico: identificar cliente, preguntas de diagnóstico simples, creación automática de ticket con categoría/prioridad sugerida) + email → ticket + **portal de clientes básico** (crear ticket, ver estado, responder — es el reemplazo directo de la consola de clientes de Zammad que usan hoy, no puede quedar para el final). Esta fase es la más importante porque cubre exactamente los tres canales que usan actualmente (portal, consola de agente, email) más el canal que ya predomina en la práctica (WhatsApp).

**Fase 3:**
Activos, visitas técnicas, mantenimientos, guardias, incidentes, NOC (capa de visualización), automatizaciones, base de conocimiento, portal de clientes avanzado (SLA visible, mantenimientos, solicitud de visitas).

**Fase 4:**
IA avanzada (resúmenes de conversación, detección de duplicados, sugerencia de técnico), integraciones de monitoreo reales (Zabbix/Grafana/Uptime Kuma).

---

## P. Roadmap y riesgos técnicos

Riesgos principales a vigilar:
- **WhatsApp Business API es el riesgo de mayor impacto en el cronograma**: no está aprobada todavía y el proceso (verificación de negocio + aprobación de plantillas de mensaje) puede demorar semanas. Es la razón por la que este trámite debe arrancar en paralelo desde ya, no esperar a la Fase 2 de desarrollo.
- **Corte de Zammad debe ser un cutover, no un apagado prematuro**: aunque arquitectónicamente se reemplaza por completo (sin integración), conviene mantener Zammad corriendo en paralelo, sin tocarlo, hasta que la plataforma nueva tenga paridad real en los tres canales que usan hoy (portal de clientes, vista de agente, email) — recién ahí se apaga. Cortarlo antes de esa paridad deja a las pymes sin canal de contacto.
- **Subestimar el sistema de tickets propio**: es, con diferencia, el módulo de mayor esfuerzo de todo el proyecto — SLA, workflows y conversaciones unificadas no son triviales.
- **Multi-tenant retrofit**: si no se diseña `organization_id` desde el modelo de datos inicial, migrar después es doloroso.
- **IA como caja negra**: cualquier sugerencia de IA debe ser explicable/auditable (qué datos usó, por qué sugirió X) para que el equipo confíe en ella.

---

## Q. Stack tecnológico recomendado

**Restricción de despliegue confirmada: todo corre en contenedores Docker sobre tu propio VPS — nada de servicios cloud gestionados.** Esto descarta cualquier dependencia tipo AWS S3, RDS gestionado, etc. y hace que el stack se elija priorizando componentes que corran bien auto-hospedados con recursos moderados.

- **Frontend:** React/Next.js — se sirve como contenedor propio o build estático detrás del reverse proxy.
- **Backend:** Node.js (NestJS) — un contenedor único de API + WebSockets + jobs; suficiente para el volumen de un MSP mediano sin necesitar microservicios separados.
- **Base de datos:** PostgreSQL en contenedor propio, con volumen persistente en el VPS y backup programado (pg_dump) a un destino fuera del mismo disco.
- **Cache/colas:** Redis en contenedor — cache + colas de jobs + pub/sub simple para el event bus (no hace falta un broker separado como RabbitMQ/NATS al volumen inicial de un MSP; se puede escalar a eso después si hace falta).
- **Almacenamiento de archivos (adjuntos, fotos de visitas):** MinIO en contenedor — API compatible con S3 pero 100% self-hosted, corre bien en un VPS.
- **Reverse proxy / TLS:** Traefik o Caddy — certificados automáticos (Let's Encrypt) sin depender de un balanceador cloud.
- **Búsqueda/IA:** pgvector como extensión de Postgres para embeddings — evita sumar otro motor de base de datos al stack.
- **Observabilidad:** logs estructurados a archivo/volumen + un contenedor liviano de métricas (ej. Uptime Kuma para health checks del propio stack) — nada que dependa de un servicio SaaS externo obligatorio.

Todo se orquesta con un único `docker-compose.yml` por ambiente (dev/prod), lo que facilita que se despliegue y actualice módulo por módulo en tu VPS sin infraestructura adicional.

## R. Despliegue y forma de trabajo

- **Todo el desarrollo se ejecuta con un agente de código (OpenCode u equivalente) trabajando módulo por módulo**, siguiendo exactamente la metodología ya definida: se explica qué se va a hacer, se implementa, se prueba, se verifica que no se rompió nada existente, se documenta, y recién ahí se pasa al siguiente módulo. Vos no escribís código — tu rol es revisar, probar y aprobar cada etapa antes de avanzar.
- **Entregable de cada etapa:** no solo el código, sino un `docker-compose.yml` (o el fragmento que corresponda agregar) y una guía corta de qué variables de entorno/secrets hay que cargar en tu VPS para levantar esa parte.
- **Un solo VPS, todo containerizado:** esto simplifica el despliegue pero también significa que el dimensionamiento de recursos (CPU/RAM/disco) del VPS hay que revisarlo antes de sumar módulos pesados (IA local, por ejemplo) — si en algún momento se necesita un modelo de IA corriendo localmente, probablemente convenga usar una API externa de IA en vez de alojar el modelo en el mismo VPS, para no competir por recursos con la base de datos y el backend.
- **Backups**: al ser autoalojado, el respaldo es 100% responsabilidad de la infraestructura propia — hay que definir desde la Fase 1 un job de backup automático (Postgres + volumen de MinIO) hacia un destino distinto del VPS (otro servidor, un storage externo, etc.), no opcional para más adelante.

### Sizing de VPS recomendado (punto de partida — no un límite del sistema)

**Importante: la cantidad de clientes no tiene ningún límite en el modelo de datos** — agregar un cliente nuevo (activo o inactivo) es simplemente una fila más en `Customer`, indexada por `customer_id` en todo lo demás. El sizing de abajo es una recomendación de infraestructura para el volumen de arranque, no un techo arquitectónico. A medida que la cartera de clientes crezca, lo que se ajusta es el tamaño del VPS (más CPU/RAM/disco), no el diseño del sistema.

A esta escala inicial (3-4 técnicos, cartera de clientes que puede crecer con el tiempo) el volumen de tickets/día es bajo, así que no conviene sobredimensionar desde el día uno. Recomendación concreta de arranque:

| Recurso | Recomendado | Justificación |
|---|---|---|
| vCPU | 4 | Postgres + Redis + backend + MinIO + reverse proxy corriendo juntos, con margen para picos (ej. varios técnicos actualizando tickets a la vez) |
| RAM | 8 GB | ~2 GB Postgres, ~1 GB Redis, ~1 GB MinIO, ~2 GB backend/frontend, resto para el SO y overhead de Docker |
| Disco | 100–160 GB SSD | Base de datos crece lento a este volumen; lo que realmente ocupa espacio son los adjuntos (fotos de visitas, documentos, capturas de WhatsApp) vía MinIO — con 100 GB hay margen para bastante tiempo |
| Ancho de banda | El estándar del proveedor alcanza | WhatsApp/webhooks son livianos; no hay streaming ni archivos pesados constantes |

Esto equivale a un VPS de gama media (ej. Hetzner CPX31/CPX41, DigitalOcean droplet de 8 GB, o equivalente) — nada exótico ni caro.

**Cómo escalar a medida que crece la cartera de clientes:** el camino natural es escalado vertical (subir CPU/RAM/disco del mismo VPS) mientras el volumen lo permita — es la opción más simple de administrar para un equipo que no programa. Señales concretas para revisar el sizing (no un número fijo de clientes, sino métricas reales a monitorear): uso sostenido de CPU/RAM por encima del 70-80%, tiempos de respuesta de la base de datos que empiezan a degradarse, o disco por encima del 70% de uso. Si se llega a un volumen donde escalar verticalmente ya no alcanza (miles de clientes activos, cientos de tickets simultáneos), ahí sí conviene evaluar separar la base de datos a un servidor propio o mover a un esquema con más de un nodo — pero eso está lejos del punto de partida actual y no hay que diseñarlo prematuramente.

Si en algún momento se suma IA con modelo propio corriendo localmente (no recomendado en este VPS, ver más arriba — mejor usar una API externa de IA), ahí también conviene reevaluar CPU/RAM por separado, independientemente de cuántos clientes haya.

---

## Estructura inicial de proyecto (referencia)

```
/apps
  /web            → frontend
  /api            → backend (REST + WebSockets)
  /integration    → integration layer / conversation engine / event consumers
/packages
  /shared-types   → tipos compartidos frontend/backend
/infra            → IaC, migraciones, configuración de despliegue
```

---

## Próximo paso

Con esta arquitectura aprobada, el siguiente paso es arrancar **Fase 1** módulo por módulo: primero el modelo de datos y auth, después agenda, después tickets. Cada módulo se implementa, se prueba, y se valida que no rompe lo anterior antes de avanzar al siguiente — como pediste en la metodología de desarrollo.
