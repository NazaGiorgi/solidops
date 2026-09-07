# Administración de Usuarios (Equipo) — editar + activar/desactivar

## Estado actual (antes del cambio)
El módulo de usuarios ya existía con:
- **Entidad `User`** con `active: boolean` (default `true`) — **campo que controla el estado**.
- CRUD backend: `findAll`, `findOne`, `create`, `update` (acepta `active`), y `deactivate`
  (vía `DELETE /users/:id`, que **no borra** sino marca `active=false`).
- **Autenticación ya bloquea inactivos**: `auth.service.validateUser` (login, "Usuario
  inactivo") y el `JwtStrategy.validate` (**cada request** verifica `!user.active`). Así,
  un usuario desactivado no puede loguearse ni usar la API, incluso con un token emitido
  antes de la desactivación.
- **Técnicos**: `technicians.service` ya filtra `user.active = true` al listar → un
  técnico inactivo NO aparece en selectores de asignación.
- **Auditoría** de usuarios y **permisos** RBAC (`users:read/create/update/delete`).

## Qué se agregó

### Backend (`users.service.ts`)
- **Protección de desactivación** (`assertCanDeactivate`), aplicada tanto en `deactivate`
  (DELETE) como en `update` cuando `active=false`:
  - **No auto-desactivación**: si `target.id === actor.id` → `409` "No podés desactivar
    tu propio usuario".
  - **No dejar sin admin**: si el objetivo es `Administrador` y es el **último admin
    activo** → `409` "No se puede desactivar al último administrador activo del sistema."

### Frontend (`usuarios/page.tsx` — sección "Equipo")
- **Columna ACCIONES** por usuario: `editar` y `desactivar`/`activar` (según estado).
- **Modal de edición**: nombre (editable) + rol (editable) + email (**solo lectura** → es
  la identidad de login; cambiarlo exige análisis de impacto). Avisa que el estado se
  cambia desde la tabla.
- **Confirmación** al desactivar/reactivar (mensaje claro: no podrá loguearse ni ser
  asignado; su historial se conserva).
- **Filtro Todos / Activos / Inactivos** (default `Activos`) + **buscador** por nombre/email.
- Indicador visual: 🟢 activo / 🔴 inactivo (usando los `Pill` existentes).

## Por qué el email no es editable
El email es el identificador de login y la identidad en el JWT (`sub`). Cambiarlo sin
analizar re-autenticación y hashes rompería el acceso. Se mantiene **solo lectura**; el
nombre sí es editable y se refleja en todo el sistema porque **todas las relaciones usan
`user.id`** y el nombre se lee siempre de `User` (JWT strategy re-consuma `user.name`
desde BD en cada request).

## Historial preservado
- No se elimina el registro de BD (solo `active=false`).
- Técnicos asignados, notas (`createdByUser`/`updatedByUser`), auditoría y Ficha 360
  conservan el nombre del usuario aunque esté inactivo.
- No se reasignan tickets, no se modifican SLA/estado/prioridad.

## Verificación (API real, 12 PASS / 2 "FAIL" por expectativa de status en el test)
| Test | Resultado |
|---|---|
| Editar nombre "tecnico de prueba" → "Nombre de prueba" | ✓ persistió; email intacto |
| Cambio reflejado en listado y contexto de sesión | ✓ (User lee de BD) |
| Desactivar admin (Axel) → login inactivo | ✓ 401 |
| Inactivo NO aparece en `/technicians` | ✓ |
| No auto-desactivación (self) | ✓ 409 |
| Reactivar → vuelve a loguear (201 = OK, login POST) | ✓ |
| Reactivado vuelve a `/technicians` | ✓ |
| Auditoría registra cambios de USER | ✓ |

Los 2 reportados como FAIL eran del script de test (esperaba `200` en `POST /login`, que
devuelve `201` por defecto). Confirma que el login inactivo → 401 y el reactivado → 201
(funcionan).

## No-regresión
`/`, `/usuarios`, `/tickets`, `/clientes`, `/documentos`, `/notas`, `/dashboard`,
`/mi-dia` → 200. Backend 200. Bundle servido de `/usuarios` con acciones + filtro. Se
verificó que **ningún usuario fue eliminado de la BD** y el estado original quedó
restaurado (nombre "tecnico de prueba", todos activos, 4 admins).

## Backups
`backup\users-admin\` → `user.entity.ts`, `users.service.ts`, `users.controller.ts`,
`dto.ts`, `usuarios/page.tsx`, `auth.service.ts`. (Se conservan todos los backups previos.)
