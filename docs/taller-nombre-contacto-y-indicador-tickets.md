# Taller: mostrar nombre real de la persona + indicador "🔧 Taller" en Tickets

## Problema
1. En `/taller`, la columna "Cliente" mostraba "Clientes particulares" (el nombre del
   `Customer` genérico) en vez del nombre real de la persona cargada (ej. "Juan Pérez"),
   que vive como `Contact.name` dentro de ese bucket.
2. En la lista general de Tickets, un ticket vinculado a un equipo de Taller (ej.
   "Equipo: PC clon") no mostraba ningún indicador ni el nombre del contacto.

## Modelo de datos (evidencia)
- Los clientes particulares comparten un `Customer` bucket llamado **"Clientes
  particulares"** (nombre reservado, mismo en `new-equipment-form`, `zammad` import y
  este módulo). La persona real se guarda como `Contact` (con `contact_id` en el equipo).
- `workshop_equipments` guarda `customer_id`, `contact_id` y `customer_label`.
- Cada ticket de Taller tiene un equipo asociado vía `workshop_equipments.ticket_id`.

## Parte 1 — Nombre real en el listado de Taller
`backend/src/modules/workshop/workshop.service.ts` (`list()`):
- Se resuelve el `Contact` por lote (bulk `IN`) según `contact_id` de cada equipo.
- Si el `Customer` es el bucket de particulares (`Customer.name === 'Clientes particulares'`),
  el nombre mostrado pasa a ser el del `Contact` (la persona real). Para una empresa real
  (nombre distinto del bucket), se sigue mostrando el nombre de la empresa como siempre.
- Se exporta `PARTICULARS_BUCKET_NAME` para reutilizarlo en otros módulos.
- El buscador de texto libre ahora también hace match por el **nombre del Contact**
  (`EXISTS` sobre `contacts.name`), además de marca/modelo/serie/falla/label/cliente.

## Parte 2 — Indicador "🔧 Taller" en Tickets
### Backend `backend/src/modules/tickets/tickets.service.ts`
- Se inyecta el repo `WorkshopEquipment` y se lo agrega al `TicketsModule`.
- `findAll()` y `findOne()` adjuntan por ticket un campo `workshop`:
  `{ equipmentId, contactName }` cuando existe un equipo con `ticket_id = <ticket>`.
  `contactName` usa la misma corrección: para el bucket de particulares muestra el nombre
  del Contact real; en otro caso el nombre del cliente/empresa.
- Método privado `workshopLinksForTickets(ids)` resuelve por lotes (sin N+1) usando bulk
  `IN` sobre equipos, contactos y clientes.

### Frontend
- `tickets/page.tsx`, `components/ticket-list.tsx`, `tickets/[id]/page.tsx`: se agrega el
  campo `workshop?: { equipmentId; contactName } | null` a los tipos.
- `components/ticket-list.tsx`: en la celda de cliente, si hay `workshop`, se muestra
  `workshop.contactName` (nombre real) + un pill "🔧 Taller" (`pill-blue`) que enlaza a
  `/taller/<equipmentId>`. Para tickets sin `workshop` no cambia nada (no hay indicador).
- `tickets/[id]/page.tsx`: el encabezado muestra `workshop.contactName` + pill "🔧 Taller"
  cuando aplica; para tickets normales conserva el comportamiento anterior.
- `globals.css`: nuevos estilos `.ticket-cell-cust-name` (ellipsis) y `.ticket-cell-workshop`
  (pill chico compacto), consistente con `.ticket-cell-merged`.

## Pruebas realizadas (automáticas)
- `/taller` (`GET /api/workshop/equipments`): `customerName` ahora = `juan perez prueba`
  (antes "Clientes particulares") para el equipo del bucket con contacto.
- Búsqueda:
  - `search=juan` (nombre real del contacto) → 1 match.
  - `search=particulares` (bucket) → 1 match.
  - `search=clon` (marca) → 1 match.
- Tickets:
  - `GET /api/tickets` para "Equipo: PC clon" → `workshop={equipmentId, contactName:'juan perez prueba'}`.
  - `GET /api/tickets/[id]` mismo ticket → igual (findOne).
  - Tickets NO de Taller → `workshop=null` (sin indicador).
- Rutas 200: `/taller`, `/tickets`, `/tickets/<id>`, `/taller/<id>`.
- Typecheck frontend: solo los errores preexistentes (casillas, tickets/[id], .next/types);
  **ninguno** nuevo por este cambio.
- Bundle servido: contiene `workshop`, `contactName` y el pill `ticket-cell-workshop`.

## Notas / decisiones
- El encabezado del detalle de Taller (`/taller/[id]`) sigue mostrando `customerLabel`.
  Queda fuera de alcance; si se quiere, se puede aplicar la misma corrección allí.
- Empresa real: al no ser el bucket de particulares, `customerName` se usa tal cual; el
  override del Contact solo se aplica al bucket reservado.

## Pendiente (prueba en vivo con navegador autenticado)
1. `/taller` muestra "Juan Pérez" real (no "Clientes particulares").
2. Crear equipo con cliente empresa → muestra el nombre de la empresa (sin romperse).
3. Lista general de Tickets → el ticket de Taller muestra "🔧 Taller" + nombre real del contacto.
4. Clic en el indicador → lleva al equipo correcto en `/taller/[id]`.
5. Ticket normal (no Taller) → sin indicador nuevo.

## Para aplicar
Reiniciar los contenedores dev (bind-mount / watcher):
```
docker restart ops-backend
docker restart ops-frontend
```