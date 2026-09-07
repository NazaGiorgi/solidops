# Notificación flotante (toast) de ticket nuevo — estilo Zammad

## Qué existía (base reutilizada)
- **`ToastProvider` / `ToastViewport`** (`frontend/components/toast.tsx`): API completa de
  toasts flotantes con auto-cierre (8s), cierre manual, `actionHref`/`actionLabel` (clic que
  navega), y `tone` (info/success/warning/alarm). Ya estaba montado en el root de la app.
- **`useNotificationsSocket`** (`frontend/lib/use-notifications.ts`): conexión Socket.IO con
  el backend (auth por token), que escucha el evento `notification:new` (notificaciones por
  usuario).
- **Backend `NotificationsGateway`** (`backend/.../notifications.gateway.ts`): gateway
  Socket.IO con `broadcast(event, data)` (emite a TODOS los usuarios conectados) y
  `emitToUser(userId, event, data)`. `NotificationsModule` exporta el gateway.

## Qué se implementó (lo que faltaba)

### Backend — emitir "ticket nuevo" a todos
- Se inyectó `NotificationsGateway` en `TicketsService`.
- Nueva función privada `emitNewTicketBroadcast(ticket)`: hace `gateway.broadcast('ticket:new', {...})`
  con `{ id, title, customerName, technicianName, status, priority, createdAt }`. Es
  best-effort (no rompe la creación del ticket si el socket falla).
- Se llama en:
  - `create()` (ticket manual) tras guardar.
  - `upsertFromEmail()` SOLO en `action='created'` (no en append), para tickets por email.

### Frontend — toast flotante global
- `useNewTicketToast()` (`frontend/components/use-new-ticket-toast.ts`): abre **su propio**
  Socket.IO (evento `ticket:new`, para no interferir con `notification:new` del contador de
  no leídas) y, al recibirlo, `push({ title: "🎫 Nuevo ticket: <título>", body: "Cliente: X ·
  Técnico: Y", tone:'info', actionHref:'/tickets/<id>', actionLabel:'abrir ticket →' })`.
- Se monta en el `Shell` (`app/(app)/layout.tsx`) → funciona **en cualquier pantalla**
  de la app mientras esté abierta.

## Flujo
```
Crear ticket (manual POST /tickets o email → upsertFromEmail)
  → TicketsService.emitNewTicketBroadcast(ticket)
  → NotificationsGateway.broadcast('ticket:new', { id, title, customerName, ... })
  → TODOS los clientes Socket.IO conectados reciben 'ticket:new'
  → useNewTicketToast() → ToastProvider.push(...) → ToastViewport muestra el toast
  → auto-cierra a los 8s · clic navega a /tickets/<id>
```

## Alcance
Decidido por el usuario: **"Todos, sin filtro"** — notifica cualquier ticket nuevo (de
cualquier bandeja: L1/L2/L3, nativos, Backups MK, etc.). No se filtró por bandeja.

## Prueba en vivo
Se creó un ticket de prueba por API y un cliente Socket.IO (autenticado) recibió:
```
TICKET:NEW RECIBIDO: {"id":"6069...","title":"Ticket de prueba toast ...",
  "customerName":"Big Five","technicianName":null,"status":"nuevo","priority":"normal",...}
total ticket:new recibidos: 1 → OK
```
El payload incluye `customerName`, `title`, `id` → el toast muestra cliente y enlace.
El ticket de prueba se limpió después.

## Verificación / no-regresión
`/`, `/tickets`, `/clientes`, `/documentos`, `/notas`, `/usuarios`, `/dashboard` → 200.
Backend 200. Typecheck 0 errores en los archivos tocados (el único aviso de tsc es el
preexistente de `.next/types` de Next).

## Backups / rollback
`backup\new-ticket-toast\` → `tickets.service.ts.bak`, `use-new-ticket-toast.ts.bak`,
`layout.tsx.bak`. Rollback: copiar el `.bak` sobre el actual.

## Limitación / pendiente de confirmación visual
- Se verificó que el **broadcast `ticket:new` llega al cliente Socket.IO** (evidencia real).
- **No pude ver el toast en pantalla** (sin navegador). El render del toast es el mecanismo
  existente (`ToastProvider`/`ToastViewport`), ya probado en otros usos. Requiere que el
  usuario cree un ticket en el navegador y confirme que aparece el toast cuando la app esté
  abierta (en cualquier sección), que el clic navegue al ticket, y que desaparezca en ~8s.
