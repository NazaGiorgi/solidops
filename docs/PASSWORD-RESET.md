# Recuperación de contraseña — staff y portal de clientes

Flujo "olvidé mi contraseña" para usuarios de staff (`User`) y contactos del portal
(`Contact`). Token de un solo uso con hash, expiración corta y detección de
abuso por rate-limiting.

---

## Modelo de datos

`password_reset_tokens` (se crea sola con `synchronize:true` en dev):

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `owner_type` | varchar(16) | `'user'` (staff) o `'contact'` (portal) |
| `owner_id` | uuid | id del `User` o `Contact` (polimórfico, sin FK) |
| `token_hash` | varchar(64) | SHA-256 del token. **El token nunca se guarda en texto plano** |
| `expires_at` | timestamptz | expiración (1 hora) |
| `used_at` | timestamptz nullable | marca de consumo (single-use) |
| `created_at` / `updated_at` | timestamptz | BaseEntity |

`token_hash` es UNIQUE y `owner_type`+`owner_id` están indexados.

---

## Endpoints

### Staff (`AuthController`, base `/api/auth`)
| Método | Ruta | Público | Body |
|---|---|---|---|
| POST | `/api/auth/forgot-password` | sí | `{ email }` |
| POST | `/api/auth/reset-password` | sí | `{ token, newPassword }` |

### Portal de clientes (`PortalController`, base `/api/portal/auth`)
| Método | Ruta | Público | Body |
|---|---|---|---|
| POST | `/api/portal/auth/forgot-password` | sí | `{ email }` |
| POST | `/api/portal/auth/reset-password` | sí | `{ token, newPassword }` |

Ambos endpoints de solicitud responden **siempre lo mismo** (`{ "ok": true }`) tanto
si el email existe como si no — no se revela qué emails están registrados.

---

## Comportamiento

1. **Solicitud** (`forgot-password`):
   - Rate-limit: 5 req/h por IP + 3 req/h por IP+email (Redis, con fallback en memoria).
   - Si el email existe (y `active`/`portal_enabled`): genera token aleatorio de 32
     bytes (base64url), guarda solo su SHA-256, invalida tokens previos sin usar, y
     envía el link de reseteo por email.
   - Link: `<FRONTEND_URL>/reset-password?token=<raw>&type=staff|portal`.
   - Registra `AuditAction.PASSWORD_RESET_REQUEST`.
2. **Confirmación** (`reset-password`):
   - Valida token existente, no expirado y no usado; lo marca `used_at`.
   - Guarda la nueva contraseña como **bcrypt** en `password_hash` (staff) o
     `portal_password_hash` (contacto).
   - **Borra `legacy_argon2_hash`**: el reseteo reemplaza por completo la necesidad de
     la migración perezosa Argon2→bcrypt para esa cuenta.
   - Registra `AuditAction.PASSWORD_RESET`.

---

## Envío de email

Reutiliza la **config SMTP de la casilla `soporte@solidocs.com.ar`** (o la primera
casilla con SMTP configurado), obtenida y desencriptada por
`MailboxesService.getSmtpConfig()` (`CryptoService`) y enviada por `MailService`
con `nodemailer`.

> **Estado actual del entorno:** ninguna casilla tiene SMTP cargado todavía
> (solo IMAP). Cuando `getSmtpConfig()` devuelve `null`, `MailService` **loguea el
> link de reseteo** (`.log` con prefijo `[NO-SMTP]`) en vez de fallar, para que el
> flujo se pueda probar en dev. Para activar el envío real, cargar SMTP
> (host/puerto/usuario/contraseña) en la casilla `soporte@solidocs.com.ar` vía la UI
> de `Casillas`.

---

## Config

| Env | Descripción | Default |
|---|---|---|
| `ZAMMAD_APPLICATION_SECRET` | pepper de Zammad usado en la verificación Argon2 del legacy | vacío |
| `FRONTEND_URL` | base de la app web para construir los links de reset | primer CORS origin |

---

## Frontend

| Ruta | Pantalla |
|---|---|
| `/forgot-password` | solicitar reseteo (staff) |
| `/reset-password?token=...&type=staff\|portal` | definir contraseña nueva |
| `/portal/forgot-password` | solicitar reseteo (portal clientes) |

Ambos logins muestran "¿Olvidaste tu contraseña?" enlazando a su pantalla
correspondiente. Los mensajes de éxito/error no filtran si el email existe
(misma política de seguridad que el backend).

---

## Verificación en vivo (registrada)

- Staff: solicitud → `{"ok":true}`; reset → bcrypt, legacy borrado; reuso del token
  → 400; login con la nueva → 201; email inexistente → `{"ok":true}` (uniforme);
  rate-limit → 429 tras 3 req/h por IP+email.
- Portal: solicitud → `{"ok":true}`; reset → `portal_password_hash` bcrypt + legacy
  borrado; login de portal → 201.
- Datos de prueba (audit_logs de reset y tokens) limpiados tras validar.

---

## Incidencia resuelta: reset de `info@` que "no funcionaba"

Se reportó que el reset de `info@solidocs.com.ar` no dejaba login funcional. **No es
un bug del flujo de reseteo.** Evidencia:

- El hash guardado tras el reset es **bcrypt válido** (`$2b$10$...`, 60 chars) y el
  `legacy_argon2_hash` se borró correctamente.
- Test E2E del flujo completo: `bcrypt.compare(pwNueva, hash) = true` y
  `AuthService.validateUser` → **`LOGIN OK`** (endpoint real → 201). El flujo funciona.
- **Causa real**: hubo **dos resets** ese día (19:22:43 y 19:25:45, en `audit_logs`),
  con dos tokens usados. El **segundo** reset sobreescribió el hash del primero, así
  que la contraseña que el usuario recordaba del primer intento dejó de ser válida.
- **No es específico de cuentas migradas de Zammad**: el flujo de reset + login por
  bcrypt es el mismo para cuentas nativas y migradas; el `legacy` se borra igual.

**Mejora derivada**: los audit de `password_reset` guardan `user_email=null` (se pasa
`user: null`). Para mejor trazabilidad convendría registrar el email del usuario
afectado en `meta` (ya tiene `{email}`), y sería ideal que el mail de reset indique
explícitamente que es un link de un solo uso (si se repite la solicitud, el link
anterior queda inválido).

**Nota**: dado que un reseteo invalida el token anterior, si un usuario hace el flujo
dos veces, **solo la contraseña del ÚLTIMO reseteo es válida**. Si el mail llega con
retraso y se usan dos links, gana el segundo.

---

## Cambio manual de contraseña de portal (staff) — 2026-09-04

Vía alternativa al autoservicio (forgot/reset) para cuando el cliente no puede
acceder a su correo: el staff fija la contraseña de portal de un contacto
directamente desde el sistema.

### Endpoint
`POST /api/customers/:id/contacts/:contactId/portal/password` con body
`{ password: string }` (mínimo 8 chars). Permiso: `customers:update` (mismo que
editar el contacto; no restringido a un rol especial).

### Comportamiento
- Hashea con **`bcrypt.hash(password, 10)`** (el mismo mecanismo que
  `reset-password` del portal).
- Limpia `legacy_argon2_hash` (igual que el reset).
- **NO toca `portal_enabled`** (no habilita/deshabilita el portal; eso se hace
  con `PATCH .../portal`).
- **NO envía la contraseña por email** y **no la loguea** ni la devuelve.
  El staff la ve/copia en pantalla una sola vez (la escribe o la genera con el
  botón "generar" del frontend) y se la comunica por el canal que corresponda.
- **Sin forzar cambio en el próximo login**: no existe flag de fuerza de cambio
  en el modelo, así que la contraseña queda tal cual.

> **Mecanismo único (unificación)**: `PATCH .../portal` **ya no toca la contraseña**
> — solo habilita/deshabilita `portal_enabled`. La fijación/cambio de contraseña
> de portal es responsabilidad **exclusiva** de `POST .../portal/password`.
> Antes, `PATCH .../portal` aceptaba un `password` opcional que, al llegar con un
> valor residual en el form, podía pisar en silencio la contraseña correcta fijada
> por el staff. Se eliminó para eliminar esa ambigüedad de raíz.

### Auditoría
`AuditAction.PASSWORD_RESET` + `AuditEntityType.CONTACT`, `entityId` = contacto,
`meta: { email, method: 'manual', changedByStaff: true }`. **Nunca** se guarda la
contraseña ni el hash en `oldValue`/`newValue`/`meta`.

### Frontend
En el modal "Editar contacto" (`clientes/[id]`):
- Sección "Habilitar portal del cliente" = **solo** el selector sí/no (sin campo
  de contraseña). Si el portal está habilitado **sin** contraseña, muestra el
  aviso: "Portal habilitado sin contraseña — usá «Cambiar contraseña de portal
  manualmente» para fijar una antes de que el cliente pueda ingresar."
- Sección "Cambiar contraseña de portal manualmente" = mecanismo único para fijar
  la contraseña (tanto al habilitar por primera vez como al cambiarla): campo con
  mostrar/ocultar, botón "generar" (contraseña aleatoria de 14 chars) y
  confirmación antes de guardar.
- El botón "guardar" del modal envía a `PATCH .../portal` **solo** `{ enabled }`.

El backend expone `hasPortalPassword` (boolean) por contacto en `GET /customers/:id`
para que la UI sepa si ya hay contraseña (nunca el hash).

### Verificación registrada
- Set de `PortalManual1234` → `{ ok, email, portalEnabled }` (sin password).
- Login de portal con la nueva → 201 (token válido).
- Login con contraseña vieja/incorrecta → 401.
- Contraseña < 8 → 400.
- **Bug del "doble mecanismo"**: tras fijar `PortalManual1234`, editar otro campo
  y tocar "guardar" (que ahora envía solo `{ enabled }`) → la contraseña sigue
  funcionando (no se sobreescribió). Defensivo: enviar `password` a
  `PATCH .../portal` se **ignora** (el backend ya no hashea desde ahí).
- Auditoría: `password_reset` sobre `contact` con `meta: { email, method: 'manual',
  changedByStaff: true }`; sin password ni hash. Logs del backend sin la contraseña.


