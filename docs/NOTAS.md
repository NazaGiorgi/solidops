# Módulo de Notas (estilo Evernote)

Información libre de los técnicos, **compartida por todo el equipo** (no privada por
usuario). Organización doble: **boxes** (cuadernos, una nota en un solo box) +
**etiquetas** (N a una nota, filtro transversal). Vínculo opcional a un **cliente** o
un **ticket** (una nota puede existir totalmente suelta).

## Modelo de datos

| Tabla | Campos | Notas |
|---|---|---|
| `notes` | `id`, `title`, `body`, `box_id` (FK nullable), `customer_id` (FK nullable), `ticket_id` (FK nullable), `created_by_user_id`, `updated_by_user_id`, `search_vector` (tsvector, FTS), `created_at`, `updated_at` | Todas las FK son opcionales (nota suelta permitida). |
| `note_boxes` | `id`, `name`, `order_index`, timestamps | Cuadernos (lista plana, sin sub-boxes). |
| `note_tags` | `id`, `name` (unique), timestamps | Catálogo de etiquetas. |
| `note_tag_notes` | `note_id`, `tag_id` (PK compuesta) | Join M:N (una nota ↔ varias etiquetas, y viceversa). |

- **Contenido**: **Markdown** (se guarda el código en `body`, se renderiza con un
  componente seguro — sin `dangerouslySetInnerHTML` ni `innerHTML` para evitar XSS).
  No se usa librería externa (npm no es fiable en este entorno); el renderizador es
  propio y soporta encabezados, negrita, cursiva, código inline/bloques, listas y
  enlaces.
- **FTS**: `search_vector` (tsvector) + índice GIN + trigger
  `tsvector_update_trigger('search_vector','pg_catalog.spanish','title','body')`
  creados en `NotesService.onModuleInit` (mismo patrón que Documentos).

## Backend

- `NotesModule` (`notes.controller.ts` / `notes.service.ts` / `dto.ts`) con CRUD de
  notas, boxes y etiquetas.
- **Listado con filtros combinables**: `?boxId=`, `?tags=a,b` (AND, por nombre o id),
  `?search=` (FTS sobre título+contenido con fallback `ILIKE`), `?customerId=`,
  `?ticketId=`.
- **Permisos**: `notes:read` + `notes:write` para **todos los roles** (compartidas y
  editables por el equipo), consistente con la decisión para Documentos. Se definieron
  en `PERMISSIONS`, `PERMISSION_LABELS` y `ROLE_PERMISSIONS`.
- **Auditoría**: creación/edición/borrado de notas (+ boxes y etiquetas) registrada en
  el log de auditoría (`AuditEntityType.NOTE` / `NOTE_BOX` / `NOTE_TAG`).
- **Creador / último editor (automático, seguro)**:
  - `created_by_user_id` / `updated_by_user_id` (UUID, FK a `users`) en `notes`.
  - El backend obtiene el usuario autenticado con `@CurrentUser()` (JWT existe de
    SolidOps) en `create`/`update` — **el frontend NO puede decidir el creador**
    (el DTO no acepta `createdBy`/`updatedBy`); se ignoran esos campos si se envían.
  - Crear → `createdBy = updatedBy = usuario autenticado`. Editar → conserva
    `createdBy`, actualiza `updatedBy` al usuario que edita (y `updatedAt`).
  - `list`/`findOne` cargan `createdByUser` y `updatedByUser` (relación a `User`) para
    exponer el nombre en la UI.

### Endpoints
| Método | Ruta | Permiso |
|---|---|---|
| GET | `/api/notes` | `notes:read` |
| GET | `/api/notes/:id` | `notes:read` |
| POST | `/api/notes` | `notes:write` |
| PATCH | `/api/notes/:id` | `notes:write` |
| DELETE | `/api/notes/:id` | `notes:write` |
| GET | `/api/notes/boxes` | `notes:read` |
| POST | `/api/notes/boxes` | `notes:write` |
| PATCH | `/api/notes/boxes/:id` | `notes:write` |
| DELETE | `/api/notes/boxes/:id` | `notes:write` |
| GET | `/api/notes/tags` | `notes:read` |
| POST | `/api/notes/tags` | `notes:write` |
| PATCH | `/api/notes/tags/:id` | `notes:write` |
| DELETE | `/api/notes/tags/:id` | `notes:write` |

`GET /api/notes/boxes` y `GET /api/notes/tags` devuelven también `noteCount`.

## Frontend

- Página **`/notas`**: sidebar de boxes (crear, ver conteo), filtro multi-etiqueta
  (pills), buscador de texto libre (título + contenido), y listado de notas con
  render Markdown. Botón "+ nueva nota" (si `notes:write`).
- **Editor de nota** (modal): título, contenido Markdown, selector de box, etiquetas
  (coma-separadas), vínculo opcional a cliente o ticket con **autocomplete**.
- **Sidebar** (layout.tsx): nuevo ítem "Notas" (perm `notes:read`), mismo nivel que
  Tickets/Clientes/Documentos.
- **Integraciones**:
  - Ficha 360 de cliente (`/clientes/[id]`): sección "Notas" (`NotesSection
    customerId=...`) con acceso directo a `/notas`.
  - Detalle de ticket (`/tickets/[id]`): sección "Notas" (`NotesSection ticketId=...`).
- **Accesos desde la app**:
  - Sidebar principal → ítem **"Notas"** → `/notas` (mismo nivel que
    Tickets/Clientes/Documentos).
  - `/clientes/[id]` → sección "Notas" (Ficha 360).
  - `/tickets/[id]` → sección "Notas".

### Importante: por qué "Notas" no aparece en el sidebar (re-sync de sesión)
El ítem está en el NAV del layout (`href: "/notas"`, `perm: "notes:read"`). Si no
aparece tras un login previo, es porque **`hasPerm` se evalúa contra el `user`
cacheado en `sessionStorage` (`opssm_user`)**, que se guardó en un login ANTERIOR a
que existiera `notes:read`. Aunque se recargue (F5), ese `user` viejo no tiene el
permiso → el sidebar lo oculta.

**Fix (frontend `lib/auth.tsx`)**: en el bootstrap, si al user cacheado le falta un
permiso que TODOS los roles tienen (lista `ALL_ROLE_PERMISSIONS`, incl. `notes:read`),
se descarta el cache, se limpian tokens y se redirige a `/login` una vez. Al
re-autenticar, el login regenera `user.permissions` con `notes:read` y el ítem
"Notas" aparece en el sidebar.

> Nota: si el usuario aún no ve "Notas", debe **cerrar sesión y volver a entrar**
> (o esperar el redirect automático del re-sync). El código y el bundle servido
> ya contienen el ítem.


### Nota sobre `/api/customers`
Se agregó soporte `?search=` al listado de clientes para el autocomplete del editor
(no existía). Filtrar por `name ILIKE %q%`.

## Verificación (13/13 PASS, vía API real)

1. Crear box + nota con 2 etiquetas → PASS.
2. Filtrar `?tags=red` → solo la nota correcta → PASS.
3. Buscar `?search=VLAN` → encuentra por **contenido** (no solo título) → PASS.
4. Nota vinculada a cliente + `?customerId=` → PASS; visible en Ficha 360.
5. Nota vinculada a ticket + `?ticketId=` → PASS; visible en detalle de ticket.
6. Nota totalmente suelta (sin box/cliente/ticket) → PASS, no rompe.
7. Editar nota → `updated_at`/`updated_by` actualizados → PASS.
- Extras: `boxes` con `noteCount`, `tags` con `noteCount` → PASS.
- FTS por contenido ("Datos", "apunte") → PASS.
- **Autor/editor con 2 usuarios reales (7/7 PASS)**:
  - A (`maria@msp.local`, Técnico) crea → `createdBy=María`, `updatedBy=María`.
  - B (`pedro@msp.local`, Técnico) edita → `createdBy=María` (se conserva),
    `updatedBy=Pedro`.
  - A edita de nuevo → `createdBy=María`, `updatedBy=María`.
  - Seguridad: enviar `createdByUserId`/`createdBy` manipulados en el POST → el
    backend los **ignora**; `createdBy=María` (usuario autenticado) → PASS.
  - Ficha 360 y detalle de ticket exponen `createdByUser`/`updatedByUser`.

**No-regresión**: `/`, `/notas`, `/clientes`, `/tickets`, `/documentos`, `/dashboard`
→ 200. Backend 200. Typecheck backend 0 errores; los únicos errores de tsc del
frontend son **preexistentes** en `tickets/[id]` (editor de ticket: campos
`technicianId`, `mergedChildren*`), ajenos a este módulo.

## Config / env
Sin env vars nuevas. Las tablas se crean con `synchronize: true` (dev).

## Backup / rollback
`backup\notes-module\` → todos los archivos del módulo (entidades, service, controller,
module, dto, permissions, enums, app.module, customers controller/service, front
`notas/page.tsx`, `markdown-preview.tsx`, `notes-section.tsx`, `layout.tsx`,
`clientes/[id]/page.tsx`, `tickets/[id]/page.tsx`).
