# Listado de Taller: cliente + número de orden primero

## Problema
En `/taller` era difícil identificar equipos porque muchos nombres son genéricos
repetidos (ej. "clon"). El campo más identificatorio, el cliente, aparecía al final
de la fila y no se mostraba el número de orden del ticket vinculado.

## Cambio
Se reordenó el listado para que en cada fila lo **primero y más visible** sea:

1. **Nombre del cliente** (razón social si es empresa; "Clientes particulares" en otro caso).
2. **Número de orden** = el del `Ticket` ya vinculado al equipo (se reutiliza, no se crea
   número nuevo). Convención idéntica al resto de la app: `#<8 caracteres del id>`.

El resto (equipo/marca/modelo, tipo, serie, estado, fecha) queda a segundo plano.

## Archivos tocados

### Backend `backend/src/modules/workshop/workshop.service.ts` (`list()`)
- Se agrega `leftJoinAndSelect('e.ticket', 'tk')` para disponer del id del Ticket.
- Se resuelve el **nombre real del cliente** por lotes (bulk `IN`) desde la tabla
  `customers` (no hay relación declarada en la entidad), con fallback a `customerLabel`.
- Se enriquece cada fila devuelta con:
  - `customerName`: nombre real del cliente (o `customerLabel` si no hay).
  - `ticketNumber`: número de orden del ticket vinculado, ej. `#7e6ef925`.
- Se mejora el **buscador** para que, además de marca/modelo/serie/falla/label, también
  haga match por el **nombre real del cliente** (subquery `EXISTS` sobre `customers.name`).

### Frontend
- `frontend/lib/workshop.ts`: se agregan a `WorkshopEquipment` los campos opcionales
  `customerName` y `ticketNumber`.
- `frontend/app/(app)/taller/page.tsx`:
  - La búsqueda local incluye `customerName`.
  - Se reordenan las columnas: **Cliente · Orden · Equipo · Serie · Estado · Recibido**.
  - El cliente es el enlace principal a `/taller/[id]`; el tipo de equipo pasa como
    sufijo secundario en la columna Equipo.

## Nota técnica (bug corregido durante el desarrollo)
La primera versión del `EXISTS` usaba `e."customerId"` (camelCase citado), lo que rompía
con `column e.customerId does not exist` porque Postgres baja a minúsculas los
identificadores sin citar y TypeORM no traduce raw SQL. Se corrigió a `e.customer_id`
(columna real de la tabla `workshop_equipments`).

## Pruebas realizadas
- Backend: `GET /api/workshop/equipments` responde con `customerName` y `ticketNumber`
  por fila.
- Búsqueda por nombre del cliente real ("particulares") → encuentra el equipo (1 match).
- Búsqueda por marca ("clon") → encuentra el equipo (1 match).
- Typecheck frontend: solo los errores preexistentes (casillas, tickets/[id], .next/types);
  ninguno relacionado con Taller.
- Rutas 200 y bundle servido con la nueva estructura.

## Pendiente (prueba en vivo con navegador autenticado)
1. Ver que en `/taller` cada fila muestra primero **cliente + número de orden**.
2. Buscar por un nombre de cliente real y confirmar que encuentra el equipo.
3. Hacer clic en una fila y confirmar que navega al detalle del equipo.
4. Confirmar que los filtros de estado (Recibido, En diagnóstico, etc.) siguen igual.

## Para aplicar
Los contenedores `ops-backend` y `ops-frontend` son dev con bind-mount; reiniciar para
tomar los cambios del watcher:
```
docker restart ops-backend
docker restart ops-frontend
```