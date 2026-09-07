# PROMPT PARA OPENCODE — FASE 2: CANALES DE ENTRADA (WHATSAPP, EMAIL AVANZADO, PORTAL) + MIGRACIÓN DE ZAMMAD

## 0. Contexto y nombre de la plataforma

La plataforma se llama **SolidOps**. Actualizá el título/branding donde corresponda (header, `<title>`, login) — es solo un nombre, no cambia la arquitectura.

Fase 1 está terminada y verificada en vivo (login, roles, clientes, técnicos, tickets, SLA, agenda completa con drag & drop, alarmas de recordatorio, fusión de tickets, auditoría, notificaciones). Esta Fase 2 agrega los canales de entrada reales y la migración de datos históricos desde Zammad.

## 1. Gestión de casillas de correo + módulo de "cajones" (reglas de enrutamiento)

Esto tiene dos partes, y la primera es un prerrequisito de la segunda.

### 1.1 Gestión de casillas de correo (mailboxes)

Igual que Zammad ("Manage → Channels → Email"), la interfaz debe permitir **agregar, editar y desactivar casillas de correo sin tocar código ni reiniciar el backend** — hoy tenemos una sola casilla conectada (`soporte@solidocs.com.ar`), pero mañana puede sumarse otra sin depender de una vuelta de desarrollo.

**Modelo de datos:**
```
Mailbox (id, email, imap_host, imap_port, imap_user, imap_password (cifrado), imap_ssl (bool),
         smtp_host, smtp_port, smtp_user, smtp_password (cifrado), smtp_ssl (bool),
         keep_on_server (bool, default true), active (bool), shadow_mode (bool, default false),
         last_checked_at, last_error (nullable, para mostrar si falla la conexión))
```

**Requisitos de seguridad:** las contraseñas de estas casillas se guardan cifradas en la base (no en texto plano) — usá el mecanismo de cifrado que ya definimos para secrets/credenciales de integraciones en la arquitectura general. Nunca las devuelvas en texto plano por la API una vez guardadas (al editar, mostrar el campo vacío o enmascarado, no el valor real).

**Pantalla de administración:** lista de casillas conectadas con su estado (activa/con error/en modo sombra), botón "agregar casilla nueva" con formulario (host, puerto, usuario, contraseña, SSL, modo sombra sí/no), y botón "probar conexión" antes de guardar, para detectar credenciales mal cargadas de inmediato en vez de descubrirlo horas después.

El worker que revisa el correo entrante debe iterar sobre **todas** las casillas activas de la tabla `Mailbox`, no sobre una casilla hardcodeada — así agregar una nueva casilla desde la interfaz alcanza para que empiece a procesarse, sin cambios de código.

### 1.2 Reglas de enrutamiento ("cajones")

**Modelo de datos:**
```
MailboxRule (id, mailbox_email, sender_pattern (opcional, regex o texto), subject_pattern (opcional, regex o texto),
             destination: 'ticket' | 'document' | 'discard',
             target_customer_strategy: 'auto_match_asset' | 'fixed_customer_id' | null,
             fixed_customer_id (opcional), priority (orden de evaluación), active (bool))
```

**Comportamiento:** cuando llega un email a cualquier casilla conectada, se evalúan las reglas activas de esa casilla en orden de prioridad; la primera que matchee decide el destino. Si ninguna matchea, comportamiento por defecto configurable (crear ticket sin clasificar, o descartar con log).

**Pantalla de administración:** lista de reglas por casilla, con alta/edición/borrado, y una vista de "correos recientes sin regla" para que el administrador vea qué está llegando sin clasificar y pueda crear una regla nueva fácilmente desde ahí (sugerencia: mostrar remitente/asunto de los últimos N correos no matcheados, con botón "crear regla para este remitente").

**Destino `document`:** cuando un correo matchea a este destino, se crea un registro en el módulo documental (ya diseñado en el prompt de gestión documental), intentando asociarlo automáticamente al cliente/activo si el asunto contiene un nombre reconocible (ej. nombre de un router ya cargado como `Asset`); si no se puede identificar, queda en la bandeja de "documentos sin clasificar" para revisión manual.

## 3. Ingestión de email en "modo sombra" sobre `soporte@solidocs.com.ar`

Este es el punto más delicado — Zammad sigue siendo el sistema que realmente procesa esta casilla (los técnicos responden desde Zammad, no desde SolidOps, durante esta etapa).

- Cargá `soporte@solidocs.com.ar` como una `Mailbox` desde la pantalla de administración del punto 1.1, con `shadow_mode: true` y en modo **lectura únicamente** (nunca marcar como leído de forma que afecte a Zammad, nunca borrar, nunca contestar automáticamente desde acá durante esta etapa). La casilla tiene `keep_on_server: true` del lado de Zammad, así que ambos sistemas pueden leer el mismo correo sin pisarse — confirmado.
- Cada ticket creado en SolidOps a partir de una `Mailbox` con `shadow_mode: true` debe llevar una marca visual clara: **"Modo sombra — no responder desde acá"**, visible en la lista y en el detalle, para que ningún técnico lo confunda con un ticket real a trabajar.
- Cuando llegue el momento del corte real, desactivar `shadow_mode` desde la misma pantalla de administración (sin tocar código) hace que SolidOps pase a procesar de verdad esa casilla. Documentá este paso en el README.

## 4. WhatsApp Business API + Chatbot v1

- Estado del trámite: todavía no iniciado por el usuario (arrancar en paralelo, no bloqueante para el desarrollo de esta sección hasta que haya credenciales reales — mientras tanto, desarrollá contra un mock/sandbox de la API si es necesario para no bloquear el trabajo).
- Integración vía Meta Cloud API (o BSP compatible) al `Conversation Engine` ya diseñado.
- Chatbot v1: triage básico — identificar cliente por número de teléfono contra `Contact`, preguntas de diagnóstico simples, creación automática de ticket con categoría/prioridad sugerida y resumen de lo conversado, escalamiento a humano si no resuelve o el cliente lo pide.
- Igual que el email, cada ticket debe indicar claramente que se originó por WhatsApp, con el hilo de conversación completo visible.

## 5. Portal de clientes básico

- Reemplazo directo de la consola de clientes de Zammad: crear ticket, ver estado, responder, ver historial.
- Autenticación propia para contactos de cliente (no comparte roles con el staff interno).
- Cada cliente solo ve sus propios tickets — control de acceso por `customer_id`.
- **Probar en vivo desde la perspectiva real del cliente, no solo del staff**: crear un contacto de prueba, loguearse como ese contacto (no como Admin/Supervisor), crear un ticket desde el portal, confirmar que aparece del lado del staff en SolidOps con el técnico correspondiente, responder desde el staff, y confirmar que el contacto lo ve reflejado en el portal. Esta ida y vuelta completa es el criterio de "terminado", no solo que cada pantalla cargue por separado.

## 6. Migración histórica desde Zammad

Discovery ya realizado (no repetir): Zammad tiene ~40.100 tickets en total, de los cuales:
- **178 son soporte real** (grupos `L1`, `L2`, `L3`) → migrar completos, con historial de mensajes, a la tabla `Ticket`.
- **~39.946 son notificaciones automáticas** (grupos `Users`, `Backups MK`, `Taller`, `Ventas` — backups de Mikrotik, backups de sistemas de clientes, alertas SMART de Proxmox, tests de salud de mail) → migrar completos, pero al **módulo documental/archivo** (no a `Ticket`), asociando por nombre de equipo/cliente cuando se pueda reconocer automáticamente; el resto queda en "sin clasificar" para revisión manual.
- Grupos vacíos o de prueba (`Mesa de ayuda` con 4 tickets de prueba, los dos `Clone:`, `EN ESPERA`) → no migrar, o migrar como referencia histórica de muy baja prioridad si sobra tiempo.

**Cómo migrar:** import de una sola vez (no sincronización continua) contra la base de Zammad (acceso SSH ya confirmado, vía `zammad run rails r`). Mapear:
- `Ticket.customer` → `Contact` (crear `Customer`/`Contact` si no existe ya en SolidOps, matcheando por email).
- `Ticket.articles` (mensajes) → `TicketMessage`, conservando fecha original, no la fecha de importación.
- Preservar el ID original de Zammad en un campo `legacy_zammad_id` para trazabilidad, sin que choque con los IDs nuevos de SolidOps.

No corras la migración masiva sin antes correr un import de prueba con una muestra chica (ej. 20 tickets de L1) y que el usuario la revise en la interfaz antes de migrar el resto.

## 7. Reportes básicos con gráficos (lado interno Y lado cliente)

### 7.1 Lado interno (Administrador/Supervisor)

Sección de "Reportes" en el menú lateral de SolidOps, con al menos estos gráficos de torta:

- **Tickets por estado** (nuevo/asignado/en progreso/resuelto/cerrado/fusionado).
- **Tickets por prioridad** (crítica/alta/normal/baja).
- **Tickets por técnico** (carga de trabajo, cuántos tickets tiene asignados cada uno).
- **Cumplimiento de SLA** (verde/amarillo/rojo, proporción del total).

Alcance: toda la operación (todos los clientes, todos los técnicos).

### 7.2 Lado cliente (Portal)

En el portal de clientes (sección 5), agregá una vista de reportes acotada **solo a los datos de ese cliente** — nunca de otros clientes ni de la operación general:

- **Sus tickets por estado** (cuántos tiene abiertos, en progreso, resueltos).
- **Cumplimiento de SLA de sus propios tickets** (verde/amarillo/rojo).

No incluyas ahí datos de carga por técnico ni nada que exponga información interna de la operación — el cliente solo ve el resumen de su propia relación con el soporte.

### Común a ambos

Usá `recharts` (ya disponible en el stack del frontend) para los gráficos — no sumes otra librería de charting nueva. Cada gráfico debe tener filtro por rango de fechas (esta semana/este mes/personalizado) y, al pasar el mouse sobre una porción, mostrar el número exacto además del porcentaje. Mismos colores semánticos que ya usa el resto de la plataforma (verde/amarillo/rojo/celeste).

Esto es un alcance acotado para esta fase — reportes más avanzados (tendencias en el tiempo, exportación, comparativas históricas) quedan para una fase posterior; acá alcanza con la foto actual en gráficos de torta, en ambos lados.

## 8. Metodología (igual que Fase 1)

Explicar → implementar → probar en vivo (no solo compilar) → verificar que no rompe nada de Fase 1 → documentar → entregar fragmento de compose/env vars → recién ahí seguir. Orden sugerido: (1) gestión de casillas de correo → (2) reglas de enrutamiento (cajones) → (3) email en modo sombra sobre `soporte@` → (4) migración de prueba con muestra chica de L1 → (5) migración completa una vez aprobada la muestra → (6) portal de clientes básico (con prueba de ida y vuelta completa) → (7) reportes con gráficos de torta → (8) WhatsApp + chatbot (última, por depender de las credenciales del trámite externo).
