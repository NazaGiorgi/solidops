# Listado de tickets — sección expandible + tickets con apertura

## Dos comportamientos independientes (definitivo)

1. **Encabezado "TICKETS"**: acordeón que muestra/oculta TODA la lista
   (estado `ticketsExpanded` en la página). Es solo visual — NO llama API, NO navega.
2. **Cada ticket**: al hacer clic **abre su ficha** (`/tickets/[id]`) como siempre
   (la fila es un `<Link>`); **NO** se expande inline.

Ambos son independientes: clic en un ticket no altera la visibilidad de la lista.

## Componentes

- **`frontend/components/ticket-list.tsx`** — listado de **filas compactas** donde
  cada fila es un `<Link href="/tickets/[id]">` (abre el ticket). Badge de estado,
  tiempo relativo, título truncado, prioridad, SLA, cliente, técnico y chevron "→".
- **`frontend/app/(app)/tickets/page.tsx`** — encabezado "TICKETS" expandible
  (`ticketsExpanded` + `aria-expanded`/`aria-controls`) que condiciona la lista
  `{ticketsExpanded && <TicketList/>}`. Los filtros y el buscador quedan **siempre
  visibles** (fuera del bloque colapsable).
- **`frontend/app/globals.css`** — estilos `.ticket-section-*` (encabezado) y
  `.ticket-row-link` (fila enlazada), responsive.

## Historia

- **v1 (revertido)**: hubo un intento de acordeón **por ticket** (`TicketExpanded`,
  `openId`, fetch al expandir). Se **revirtió** y se limpió: el componente
  `ticket-list.tsx` ahora es solo un listado de `<Link>`, sin acordeón individual.
- La apertura por navegación de cada ticket es la **original** (`TicketCard` usa
  `<Link href="/tickets/[id]">`, igual que este listado) — se conserva tal cual.

## Accesibilidad

- Encabezado TICKETS: `<button>` con `aria-expanded` y `aria-controls="tickets-list"`.
  Funciona con click/Enter/Space.
- Filas: `<Link>` accesible (abre la ficha del ticket).

## Responsive

- `>900px`: fila completa (todas las columnas).
- `<=900px`: se ocultan técnico y SLA; el título pasa a una fila propia.
- `<=560px`: se oculta prioridad; tipografía/paddings reducidos.

## Compatibilidad / no-regresión

- Filtros (bandeja `tray`, búsqueda, estados, fusiones), modo sombra y sidebar:
  **idénticos** — no se tocó el backend ni la obtención de datos.
- `TicketCard` (Ficha 360) **intacto** y en uso en `/clientes/[id]`.
- Estados manejados: sin técnico → "sin técnica", sin cliente → "—", sin SLA → "—",
  título largo → truncado, fusionado → badge, modo sombra → badge ☁.

## Backups / rollback

- **Original (pre-rediseño, INTACTO)**: `backup\ticket-list-redesign\` →
  `tickets-page.tsx.bak`, `ticket-card.tsx.bak`, `helpers.ts.bak`, `globals.css.bak`.
- **Acordeón individual (v1, revertido)**: `backup\ticket-list-accordion-v1\` →
  `ticket-list.tsx.bak`, `tickets-page.tsx.bak`, `globals.css.bak`.

Rollback al estado original (tarjetas en grilla):
```powershell
Copy-Item "backup\ticket-list-redesign\tickets-page.tsx.bak" "frontend\app\(app)\tickets\page.tsx" -Force
Copy-Item "backup\ticket-list-redesign\globals.css.bak"        "frontend\app\globals.css" -Force
Remove-Item "frontend\components\ticket-list.tsx" -Force
```

> **No borrar los backups.** Deben quedar disponibles.

---

## Fix de rendimiento: sidebar de bandejas lento (paginación de /tickets)

### Síntoma
Con 40.184 tickets migrados, hacer clic en una bandeja del sidebar (ej. `Users`,
39.057 tickets) tardaba ~3s y el navegador mostraba "Unexpected end of JSON input"
/ scroll enorme / congelamiento. El filtro `<select>` de arriba era rápido.

Medición en vivo (ANTES):

| Request | Tiempo | Bytes | Filas |
|---|---|---|---|
| `/tickets?tray=Users` | **2986 ms** | **47.9 MB** | 39.057 |
| `/tickets?tray=all` | 3287 ms | 49.3 MB | 40.187 |
| `/tickets?tray=L1` | 26 ms | 178 KB | 147 |

### Causa raíz (confirmada, no supuesta)
`findAll` en `tickets.service.ts` hacía `qb.getMany()` **sin paginar**: el backend
traía TODAS las filas de la bandeja (39.057) con 5 LEFT JOINs (`customer`,
`contact`, `site`, `technician.user`, `slaRecords`) y además calculaba SLA en JS
por cada fila => 48MB de payload y ~3s. `TicketList` luego renderiza **todos** los
nodos React (`.map()` sobre el array completo). El `<select>` parecía rápido solo
porque en modo `support`/bandejas chicas (L1=147, support=210) trae pocas filas.

No era caching de contadores, ni índices (el índice `IDX_9431...` sobre
`legacy_group` ya existe y la query base es 13ms — el costo estaba en traer/joinear
39.057 filas + serializar 48MB).

### Fix aplicado
- **Backend** `dto.ts` + `tickets.service.ts`:
  - `ListTicketsQuery` ahora acepta `page` (1-based) y `take` (tamaño, máx 500).
  - `findAll` aplica `skip()`/`take()` (default `take=100`) y devuelve
    `{ items, total, page, pageSize }` (con `getCount()` para el total).
- **Frontend** `tickets/page.tsx`: lee `{ items, total, page }`, agrega paginador
  («‹ anterior / siguiente ›», muestra "mostrando N de M · página P"), y resetea a
  página 1 al cambiar de bandeja.
- **Frontend** `clientes/[id]/page.tsx` (Ficha 360): ahora lee `items` del shape
  paginado (con `take=200`).

Medición en vivo (DESPUÉS, misma bandeja `Users`):

| Request | ANTES | DESPUÉS |
|---|---|---|
| `/tickets?tray=Users` | 2986 ms / 47.9 MB | **118 ms / 118 KB** (100 filas) |
| `/tickets?tray=Users&page=2` | — | 87 ms / 118 KB |
| `/tickets?tray=all` | 3287 ms / 49.3 MB | 68 ms / 142 KB |
| `/tickets?tray=L1` | 26 ms | 26 ms (sin cambio) |
| `/tickets/groups` (contador sidebar) | 21 ms | 16 ms |

**~25x más rápido y ~400x menos payload** para el peor caso (Users), sin afectar
las bandejas chicas. JSON correcto: `items=100 total=39057 page=1 pageSize=100`.

### Resumen para el usuario
- El sidebar de bandejas ahora carga solo la primera página (100 tickets) y muestra
  el total en el paginador. La bandeja `Users` pasa de ~3s a <0.2s.
- Los contadores del sidebar (`/tickets/groups`, 16ms) y las vistas guardadas
  (`/tickets/views`) no cambiaron.
- La Ficha de cliente (360) sigue trayendo sus tickets (hasta 200) sin romperse.

### Backup / rollback
`backup\tickets-paginacion\` → `tickets.service.ts.bak`, `dto.ts.bak`,
`tickets-page.tsx.bak`, `clientes-id-page.tsx.bak`.

---

## Fix: sidebar de Tickets seguía lento al navegar (solo F5 lo aceleraba)

### Síntoma (tras la paginación)
El servidor respondía rápido (118ms/118KB verificados con la API), pero en el
navegador: haciendo clic en una bandeja del **sidebar** seguía lento — hasta que
apretabas F5 (recarga completa), y ahí sí cargaba rápido con los datos paginados.

### Causa raíz (confirmada, no era caché de red de Next)
No era el Router Cache / RSC payload. `/tickets` es un **Client Component puro**
(`'use client'`, `useEffect` + `fetch` del navegador a `http://localhost:4000`),
así que los datos de tickets nunca pasan por el cache del servidor de Next.

El problema era **qué disparaba el re-render**. En `TicketsContent`, `tray`/`view`/
`customerId` se leían de `window.location.search` **dentro del cuerpo del render**
(no con `useSearchParams`). Para que `load()` corra (el `useEffect` depende de
`tray`), el componente necesita re-renderizarse para recalcular `tray`:

- **`<select>` (rápido)**: `changeTray()` llama a `setPage(1)` → cambia un estado →
  fuerza re-render → `tray` se recalcula → `useEffect` corre `load()`. Funciona.
- **Sidebar `<Link href="/tickets?tray=Users">`**: es navegación de Next.js que NO
  llama a ningún setter. Al no cambiar ningún estado, `TicketsContent` no se
  re-renderiza, `tray` queda con el valor viejo en el `useEffect`, y `load()` no
  vuelve a correr. Solo F5 (mount fresco) re-leía `tray` correctamente.

### Fix aplicado (`tickets/page.tsx`)
- Se reemplazó la lectura de `window.location.search` por **`useSearchParams()`**,
  que es reactivo: al navegar client-side se actualiza y re-renderiza el
  componente, instando a `load()` con la bandeja nueva.
- Se envolvió `TicketsContent` en `<Suspense>` (el hook suspende si no hay uno).
  Como el estado del acordeón (`ticketsExpanded`) vive en `TicketsPage` **fuera**
  del `Suspense`, NO se re-monta ni se pierde al suspender (misma estrategia de
  estabilidad que ya funcionaba).

### Verificación
- Bundle servido (`page.js`) confirmado con `useSearchParams`, fallback "cargando",
  paginador (`take=`, `page=`, "mostrando…de…").
- Páginas 200: `/`, `/tickets`, `/tickets?tray=Users`, `/tickets?tray=L1`,
  `/tickets?tray=L2`, `/clientes`, `/dashboard`, `/mi-dia`, `/documentos`.
- Typecheck 0 errores.

> **Nota**: en `next build` (producción) `useSearchParams` exige `<Suspense>`; ya
> está envuelto, así que el build no falla por esto.

### Backup / rollback
`backup\tickets-router-cache\tickets-page.tsx.bak`.

---

## Fix: ítem "activo" del sidebar desincronizado con la bandeja mostrada

### Síntoma
La lista y el filtro de arriba mostraban la bandeja correcta (ej. "Users"), pero el
ítem resaltado en azul en el sidebar era otro (ej. "Nativos"). Bug puramente visual:
los datos eran correctos, solo el indicador de "cuál está seleccionado" quedaba
desactualizado.

### Causa raíz
Mismo patrón que el bug anterior de paginación: `renderTicketTrays`/`renderSavedViews`
(en `layout.tsx`) determinaban el ítem activo leyendo
`window.location.search` **durante el render**. Como `Shell` no se re-renderiza al
navegar client-side (su `usePathname()` sigue siendo `/tickets` sin cambios de
query), el valor de `tray`/`view` quedaba congelado en el render previo → el
indicador activo seguía apuntando a la bandeja anterior.

### Fix aplicado (`layout.tsx`)
- Se reemplazaron las dos funciones de render por un componente **`TicketSidebarLinks`**
  que determina el ítem activo con **`useSearchParams()`** (reactivo): al navegar,
  se actualiza y el resaltado coincide siempre con la bandeja/vista mostrada.
- Está envuelto en **`<Suspense fallback={null}>`** (el hook suspende si no hay uno),
  y recibe `groups`/`views`/`hasPerm` del `Shell` — así no se toca `useSearchParams`
  en el `Shell` compartido por todas las páginas.

### Verificación
- Bundle servido (`app/(app)/layout.js`) con `useSearchParams` + `sidebar-sub`.
- Páginas 200: `/`, `/tickets`, `?tray=Users`, `?tray=L1`, `?tray=Taller`,
  `/clientes`, `/dashboard`, `/mi-dia`, `/documentos`.
- Typecheck del código: sin errores (el único aviso de tsc era sobre `.next/types`
  generados por Next, artefacto del typecheck de archivos de build, no del código).

### Backup / rollback
`backup\sidebar-active-fix\layout.tsx.bak`.

> **Nota**: no borrar los backups.


