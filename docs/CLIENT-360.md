# Ficha 360 del cliente (vista unificada)

Vista única por cliente en `/clientes/[id]` que reúne en una sola pantalla: datos
generales (contactos, sitios), **tickets** (sección principal) y contratos. El
módulo documental aparece como placeholder hasta su migración.

---

## Parte 1 — Diseño

Secciones en la ficha 360 (extiende la ficha de cliente existente, sin crear una
ruta nueva):

1. **Datos generales del cliente** — lo que ya existía (razón social, contactos,
   sitios, contrato vigente).
2. **Tickets** (sección principal):
   - Listado completo de todos los tickets del cliente, consumiendo
     `GET /tickets?customerId=<id>` (el **mismo** endpoint del listado general —
     no se duplica lógica).
   - **Orden automático** (siempre, sin filtros manuales):
     1. Tickets **abiertos/en curso** primero, por urgencia de SLA: rojo → amarillo → verde.
     2. Después **resueltos/cerrados**, por fecha (más reciente primero).
   - Buscador interno por título (sin salir de la ficha).
   - Botón "ver todos los tickets →" hacia `/tickets?customerId=<id>`.
   - Reutiliza el componente `TicketCard` (mismo render que `/tickets`), extraído
     para no duplicar la presentación.
3. **Contratos** — estado vigente, fechas de SLA, tipo de abono (lo que ya devuelve
   el modelo, ampliado con el pill activo/inactivo).
4. **Documentos** — **placeholder** (el módulo documental aún NO está migrado:
   `Document` es solo receptor pasivo de correo enrutado; no hay controller/service/UI).

---

## Reutilización (sin duplicar lógica)

- **Listado de tickets**: `GET /tickets?customerId=` devuelve `slaStatus`,
  `status`, `priority` (igual que el listado general). El orden por SLA+fecha se
  hace en el cliente con `sortTickets()` (módulo `clientes/[id]/page.tsx`).
- **Componente `TicketCard`** (`components/ticket-card.tsx`): extraído del listado
  `/tickets` y reutilizado tanto allí como en la ficha 360 — una sola fuente de
  presentación.
- **Helpers/UI**: `STATUS_*`, `PRIORITY_*`, `SLA_*`, `Card`, `Pill`, `Empty`.

## Parte 2 — Acceso rápido

- Desde el **detalle de ticket** (`/tickets/[id]`): el nombre del cliente (subtitulo
  del `PageHeader` y la fila "cliente" del detalle) ahora es un **Link** a
  `/clientes/<id>` (ficha 360), en vez de texto plano.
- Desde el **listado de Clientes**: ya navega a `/clientes/<id>`.

## Parte 3 — Prueba en vivo

1. Ficha 360 de `Cliente Portal E2E` → devuelve `GET /customers/:id` (2 contactos,
   0 sitios, 0 contratos) y `GET /tickets?customerId=` (11 tickets con `slaStatus`).
   La sección Tickets se muestra con el orden automático (abiertos por SLA, luego
   cerrados por fecha); los datos vienen del listado general (no duplicados).
2. Desde `/tickets/[id]` → el nombre del cliente es un link a la ficha 360.
3. El listado usa los mismos datos de `GET /tickets` (no obsoletos).
4. Caso vacío (`Abiertoinprogress`, sin tickets/contrato) → la ficha renderiza 200
   con secciones vacías y mensajes claros (`Empty`), sin errores.

---

## Estado del módulo documental

**Placeholder.** Al día de hoy `Document` solo almacena correo enrutado a destino
`document` (vía `mailbox-rules.service.ts`); no hay controller/service/UI de
documentos ni permisos `documents:*`. La sección muestra un mensaje claro hasta
que se migre el módulo.

---

## Filtro de tickets fusionados (`/tickets`)

El listado de Tickets tiene un filtro "Fusión" (junto a estado, búsqueda y sombra)
con opciones:

| Valor | Significado |
|---|---|
| (vacío) | todas (comportamiento default, sin cambios) |
| `parents` | solo tickets **padre** con uno o más hijos fusionados |
| `children` | solo tickets **hijo** fusionados a otro |
| `exclude` | solo tickets que **nunca** participaron de una fusión |

**Modelo (Fase 1):** `tickets.merged_into_id` (null para padre, apunta al padre
para hijo) y `tickets.merge_group_id` (compartido por el grupo):
- Padre: `merge_group_id != null` AND `merged_into_id IS NULL`.
- Hijo: `merged_into_id IS NOT NULL`.
- Sin fusión: ambos null.

Se combina con los demás filtros (estado, prioridad, técnico, búsqueda) por
intersección — no reemplaza ninguno. Implementado en el backend
(`ListTicketsQuery.merge` + `findAll`) y en el frontend (`tickets/page.tsx`).

**Pruebas en vivo (registradas):**
- `merge=parents` → solo el padre `0e55da65` (Mail caido en servidor).
- `merge=children` → solo los hijos `78d4f28d`, `2d251b57`.
- `merge=children&status=en_progreso` → solo `2d251b57` (intersección correcta).
- `merge=exclude` → 34 (37 total − 3 fusionados).
- Default sin `merge` → 37 (sin cambios).

---

## Verificación
- Frontend compila: `/clientes`, `/clientes/[id]`, `/tickets`, `/tickets/[id]` → 200.
- `tsc --noEmit` backend 0 errores · health 200 (no se tocó backend para esto).
- Sin regresión: el listado de tickets reutiliza `TicketCard` y mantiene su render.
