# Prompt para OpenCode — Replicar las vistas (Overviews) de Zammad en el sidebar de SolidOps

## Contexto para OpenCode

Se investigaron las 18 "Overviews" reales de Zammad (extraídas directamente del modelo, con sus condiciones de filtro exactas — ver detalle abajo). El usuario quiere que SolidOps tenga las mismas vistas, disponibles como accesos en el sidebar, con el mismo criterio de filtrado real, no una aproximación.

**Hallazgo importante**: la mayoría de estas vistas NO se basan en el grupo (`legacy_group`, ya migrado), sino en **remitente del primer mensaje** (`article.from` → equivalente a sender/from del `Message` en SolidOps) y **texto contenido en el asunto/título** (`ticket.title` / `article.subject` con operador `contains`). Hay que armar un motor de filtro nuevo para esto, no alcanza con lo que ya existe.

Seguir la metodología habitual: explicar → investigar con evidencia real → implementar → probar en vivo → verificar que no rompe nada existente → documentar.

---

## Parte 0 — Investigar qué ya existe en el modelo de datos

Antes de implementar, confirmar con evidencia:
- ¿El `Message`/`Ticket` de SolidOps guarda el remitente (`from`) del mensaje original? Necesario para filtros como "remitente contiene mkbackups".
- ¿Existe algún concepto de etiquetas (`tags`) en `Ticket`? Necesario para "EN ESPERA" (`tags contiene "En espera"`).
- ¿Existe algún concepto de "suscripción"/"mención" de usuario a un ticket? Necesario para "Mis tickets suscritos". Si no existe, marcar esa vista como no implementable por ahora, no inventar la feature en este prompt.
- ¿El usuario tiene un concepto de "organización" propia (no el `Customer`, sino la organización del técnico/staff)? Necesario para "My Organization Tickets" — probablemente NO aplica en SolidOps (los técnicos no tienen organización propia, solo los clientes la tienen), en cuyo caso esta vista se descarta explícitamente, confirmar con el usuario antes de asumir.

Reportar estos hallazgos antes de seguir con la implementación, ya que definen qué vistas son implementables tal cual y cuáles no.

## Parte 1 — Motor de filtro por vista guardada

- Crear una entidad `SavedView` (o el nombre que sea consistente con el proyecto) con: nombre, orden/prioridad, y condición estructurada — soportar como mínimo estos tipos de condición, todos combinables con AND:
  - Estado del ticket (lista de estados válidos).
  - Remitente contiene texto (`sender contains "X"`).
  - Asunto/título contiene texto (`subject contains "X"` / `title contains "X"`), y variante "no contiene".
  - Etiqueta contiene una de la lista (`tags contains one "X"`) / "no contiene ninguna".
  - Propietario/técnico asignado: vacío (sin asignar), o igual al usuario actual.
  - Organización del ticket: sin organización asociada (`not_set`).
- Estas vistas son globales del sistema (no por usuario, salvo las que dependan explícitamente del usuario logueado, ver Parte 2) — se administran centralmente, no cada técnico arma las suyas en este alcance.

## Parte 2 — Cargar las vistas reales (Grupo A — fijas, sin depender del usuario)

Implementar estas vistas con la condición exacta extraída de Zammad:

1. **EN ESPERA**: `tags contiene "En espera"` + `estado = open`.
2. **Ordenes de Servicio**: `estado en [cerrado, nuevo, abierto, pending close, pending reminder]` + `remitente contiene "ordendetrabajosolidocs"` + `título contiene "NUEVA ORDEN DE SERVICIO CREADA"`.
3. **Ordenes de Trabajo**: mismos estados + mismo remitente + `asunto contiene "NUEVA PC TALLER"`.
4. **Backups MK**: mismos estados + `remitente contiene "mkbackups"` + `asunto contiene "respaldo"`.
5. **Notificaciones de RED**: mismos estados + `remitente contiene "mkbackups"` + `asunto contiene "notificación"` (ojo con el encoding — en el JSON crudo aparece corrupto como "notificaciÃ³n", asegurarse de usar el texto correcto con tilde real, no el corrupto).
6. **CORRECTO - backup clientes**: mismos estados + `remitente contiene "backup.clientes"` + `asunto contiene "correcto:"`.
7. **INCORRECTO - backup clientes**: mismos estados + `remitente contiene "backup.clientes"` + `asunto contiene "incorrecto:"`.
8. **Tickets no asignados y abiertos**: `estado en [abierto, nuevo, pending reminder]` + `propietario sin asignar`.
9. **Todos los tickets** (nombre real en Zammad es engañoso, "Todos los tickets cerrados", pero en realidad incluye TODOS los estados — replicar el comportamiento real, no el nombre): `estado en [cerrado, nuevo, abierto, pending close, pending reminder, id 6]` — confirmar qué estado es "id 6" contra el mapeo de estados ya usado en la migración de tickets antes de asumir.

## Parte 3 — Vistas dependientes del usuario logueado (Grupo B)

Implementar como vistas especiales que se recalculan según quién está logueado (no una condición fija guardada):

1. **Mis tickets asignados**: `propietario = usuario actual` + `estado en [abierto, nuevo, pending reminder, pending close]`.
2. **Mis tickets pendientes**: `propietario = usuario actual` + `estado = pending reminder` + `tiempo de pendiente ya vencido` (equivalente a `pending_time` en el pasado).
3. **Mis tickets suscritos**: solo implementar si en la Parte 0 se confirmó que existe un concepto de suscripción/mención en SolidOps. Si no existe, omitir y dejarlo documentado como pendiente de una feature de suscripción que no existe todavía.

## Parte 4 — Vistas descartadas (Grupo C, no aplican)

No implementar, dejar documentado el motivo:
- **My Replacement Tickets** (reemplazo por ausencia — feature no migrada a SolidOps).
- **Tickets escalados / Pending Reached** (dependen del motor de escalamiento de Zammad; SolidOps tiene su propio sistema de SLA con semáforo — no es un calco directo, requeriría diseño aparte si el usuario lo pide en el futuro).
- **My Organization Tickets** (solo si se confirma en la Parte 0 que no aplica el concepto).

## Parte 5 — UI

- Agregar estas vistas al sidebar (mismo lugar donde ya están las bandejas por `legacy_group`), como una sección separada o combinada — a definir la mejor UX, pero deben convivir sin confundirse con las bandejas ya existentes.
- Cada una con su contador real, actualizado en cada carga.
- Al hacer clic, filtrar el listado de Tickets aplicando la condición correspondiente (reusar la infraestructura de filtrado ya existente, extendiéndola para soportar los nuevos tipos de condición de la Parte 1, no duplicar lógica de listado).

## Parte 6 — Prueba en vivo

1. Para cada vista del Grupo A, hacer clic y confirmar que el resultado tiene sentido (ej. "CORRECTO - backup clientes" solo muestra tickets con ese patrón de asunto/remitente).
2. Para "Backups MK", comparar el conteo de esta vista nueva contra el conteo de la bandeja `legacy_group = Backups MK` ya existente — pueden no coincidir exactamente (la vista de Zammad tiene una condición más específica que el simple agrupamiento migrado), confirmar que la diferencia tiene sentido y no es un bug.
3. Loguearse con 2 usuarios técnicos distintos y confirmar que "Mis tickets asignados" muestra resultados distintos y correctos para cada uno.
4. Confirmar que el bug de navegación del sidebar (si ya se corrigió en un prompt anterior) sigue funcionando bien con estas vistas nuevas también — no reintroducir el mismo problema.

## Entregable esperado
- Hallazgos de la Parte 0 (qué campos/features ya existen).
- Motor de filtro por vista guardada implementado.
- Vistas del Grupo A y B implementadas y accesibles desde el sidebar.
- Grupo C documentado como no implementado, con motivo.
- Confirmación de las 4 pruebas en vivo.
