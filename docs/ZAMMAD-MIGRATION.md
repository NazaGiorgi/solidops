# Migración histórica desde Zammad — runbook

Este procedimiento migra el historial de tickets de Zammad (grupos L1/L2/L3, ~178
tickets reales) hacia SolidOps. Se ejecuta **una sola vez**, y **solo** cuando la
Fase 2 esté validada.

> **Regla de oro:** no se corre la importación masiva (los 178) sin que **ambos
> backups** (Zammad y SolidOps) estén confirmados. La muestra de 20 es una prueba
> funcional y no requiere backup.

---

## 0. Flujo general

1. Exportar desde Zammad (`export_zammad.rb`) → JSON.
2. **Backup de Zammad** y **backup de SolidOps** (previos a la importación masiva).
3. Importar en SolidOps (`npm run import:zammad`).
4. Verificar en la interfaz.
5. Recién entonces, importar el resto (los 178 completos).

---

## 1. Exportar desde Zammad

Script: `import/export_zammad.rb` (en el repo, en la carpeta `import/`).

En la VM de Zammad, vía SSH, **modo muestra (primeros 20)**:

```bash
# Copiá el script a la VM (desde tu máquina):
scp import/export_zammad.rb root@IP_ZAMMAD:/tmp/export_zammad.rb

# Ejecutalo (muestra de 20 por defecto) y redirigí la salida a un archivo:
zammad run rails runner /tmp/export_zammad.rb > /tmp/zammad/export_l1l2l3.json
```

**Modo completo (los 178, sin límite)** — solo después de validar la muestra y de
haber hecho los backups:

```bash
ZAMMAD_LIMIT=0 zammad run rails runner /tmp/export_zammad.rb > /tmp/zammad/export_l1l2l3_full.json
```

Traé el archivo a tu máquina / al proyecto:

```bash
scp root@IP_ZAMMAD:/tmp/zammad/export_l1l2l3.json ./import/export_l1l2l3.json
```

> El JSON es un arreglo con la forma:
> `{ id, group, title, status, priority, customer_email, customer_name, created_at, articles: [{ author_type, body, created_at }] }`

---

## 2. BACKUP — Paso obligatorio antes de la importación masiva

### 2.1 Backup de Zammad (en la VM, por SSH, ANTES de vaciar/migrar)

Zammad usa PostgreSQL. El comando de backup nativo es `pg_dump` de su base.
EJEMPLO (ajustá usuario/tu base a tu instalación; en un Zammad estándar el usuario
es `zammad` y la base `zammad_production`):

```bash
su - zammad -s /bin/bash -c \
  "pg_dump -Fc -Z9 zammad_production > /tmp/zammad/zammad_backup.dump"
```

Alternativa con el backup nativo de Zammad:

```bash
zammad run rake zammad:backup:create
```

Verificá que el archivo exista y no esté vacío:

```bash
ls -lh /tmp/zammad/zammad_backup.dump
```

Guardá ese `.dump` en un lugar seguro (fuera del servidor, además).

### 2.2 Backup de SolidOps (en la máquina de desarrollo / el contenedor, ANTES de importar)

#### Dump de la base

```bash
# Con el stack levantado (docker compose -f docker-compose.dev.yml up):
docker compose -f docker-compose.dev.yml exec -T postgres \
  pg_dump -U ops -Fc -Z9 ops_msp > backup/ops_msp_pre_zammad.dump
```

O en texto plano:

```bash
docker compose -f docker-compose.dev.yml exec -T postgres \
  pg_dump -U ops ops_msp > backup/ops_msp_pre_zammad.sql
```

> Guardo el respaldo en `backup/` (carpeta del proyecto). Verificá que NO esté vacío:
> `ls -lh backup/ops_msp_pre_zammad.dump`

#### Datos en MinIO (adjuntos/fotos de tickets) — opcional pero recomendado

```bash
docker compose -f docker-compose.dev.yml exec -T minio ...   # o copiá el volumen:
docker cp ops-minio:/data ./backup/minio-data
```

#### Cómo RESTAURAR SolidOps si hay que deshacer la importación

Si el import masivo salió mal y querés volver al estado pre-importación:

```bash
# 1) Detené el backend para evitar escrituras durante el restore.
docker compose -f docker-compose.dev.yml stop backend

# 2) Tirá la base actual y restaurá el dump.
docker compose -f docker-compose.dev.yml exec -T postgres \
  dropdb -U ops ops_msp --if-exists
docker compose -f docker-compose.dev.yml exec -T postgres \
  createdb -U ops ops_msp
docker compose -f docker-compose.dev.yml exec -T postgres \
  pg_restore -U ops -d ops_msp --clean --if-exists < backup/ops_msp_pre_zammad.dump

# 3) Volvé a levantar el backend.
docker compose -f docker-compose.dev.yml up -d backend
```

> `--clean --if-exists` recrea el esquema desde el dump, dejando la base igual a
> como estaba antes de importar.

---

## 3. Importar en SolidOps

Con el archivo JSON en el repo (ej. `import/export_l1l2l3.json`):

```bash
docker compose -f docker-compose.dev.yml exec backend \
  npm run import:zammad -- src/database/import/export_l1l2l3.json
```

Mapeos que hace el import:

- `Customer` / `Contact`: se buscan por email; si ya existen, **se reutilizan**
  (sin duplicar). Si no, se crean.
- `Ticket`: `status`/`priority` de Zammad → enums de SolidOps; `legacy_zammad_id`
  guarda el id original (trazabilidad); **si ya existe un ticket con ese
  `legacy_zammad_id`, se saltea** (re-ejecución no duplica).
- `TicketMessage`: un registro por artículo, **conservando la fecha original**
  (`created_at` del artículo), no la fecha de importación.

---

## 4. Verificación post-import

- Login como supervisor → Tickets → confirmá que aparecen los importados.
- Abrí un ticket → verificá el hilo con las fechas originales de los artículos.
- `GET /api/audit` o el listado: los tickets tienen `source='email'` y carry
  `legacy_zammad_id`.

---

## 5. Confirmación de estado

La importación masiva (178) **no se corre** hasta que:
- [ ] La muestra (20) se validó en la interfaz.
- [ ] Backup de Zammad confirmado (ver §2.1).
- [ ] Backup de SolidOps confirmado (ver §2.2).

---

## 6. Migración de usuarios, organizaciones y casillas (Sección 6.1)

Este paso migra **además** de los tickets:

- **Organizaciones** de Zammad → `Customer` de SolidOps (**se migran primero todas**).
- **Usuarios staff** (rol `Admin`/`Agent`) → `User` de SolidOps + perfil `Technician`.
- **Usuarios cliente** (rol `Customer`) → `Contact` con acceso a portal (`portal_enabled=true`).
- **Canales de email** (`Channel::Email` → IMAP/SMTP) → `Mailbox` de SolidOps.

### 6.1 Exportar (Zammad VM, SSH)

Script: `import/export_zammad_meta.rb`.

```bash
scp import/export_zammad_meta.rb root@IP_ZAMMAD:/tmp/export_zammad_meta.rb
zammad run rails runner /tmp/export_zammad_meta.rb > /tmp/zammad/zammad_meta.json
scp root@IP_ZAMMAD:/tmp/zammad/zammad_meta.json ./import/zammad_meta.json
```

> Produce un objeto con tres arreglos:
> `{ organizations:[{id,name}], users:[{email,firstname,lastname,role,active,legacy_argon2_hash}], email_channels:[{email,adapter,host,port,user,ssl}] }`.
> `legacy_argon2_hash` es el hash **Argon2id** que Zammad usa; se guarda tal cual y
> se verifica en el primer login (migración perezosa a bcrypt). Nunca expone contraseñas.

### 6.2 Importar en SolidOps

Copiar el JSON a la carpeta de import del backend (montada con bind en el
contenedor) y ejecutar:

```bash
# El JSON normalmente vive en ./import/<archivo>.json. El mount del backend es
# ./backend -> /app, así que copiá el archivo dentro de backend/import/ para que
# el contenedor pueda leerlo:
cp import/zammad_meta.json backend/import/zammad_meta.json

docker compose -f docker-compose.dev.yml exec backend \
  npm run import:zammad:meta -- import/zammad_meta.json
```

Mapeos:

- **Organización** → `Customer` (por nombre; si ya existe, se reutiliza). Se
  migran **primero todas**, antes que los usuarios.
- **Staff** (`Admin`→`Administrador`, `Agent`→`Técnico`) → `User` con `password_hash`
  vacío y `legacy_argon2_hash` cargado; se crea su perfil `Technician` (el supervisor
  reasigna especialidades/nivel manualmente). Si el `User` **ya existe** y el export
  trae un hash Argon2id real, se arma la migración perezosa (se vacía el bcrypt y se
  carga el legacy).
- **Cliente** (`Customer`) → `Contact` con `portal_enabled=true`, `portal_password_hash`
  vacío y `legacy_argon2_hash` cargado. Reglas de asociación, en orden:
  1. Se omite cualquier email de **sistema/notificación** (`no-reply@`, `do-not-reply@`,
     `@zammad.org`, `@microsoft.com`, `@trello.com`, `@evernote.com`, `@accounts.google.com`,
     `@cpanel@`, etc.) — nunca se crea una cuenta de portal para estos.
  2. Se vincula al `Customer` de su **organización** (por `lastname`/nombre).
  3. Si no: se infiere por **dominio del email**. Dominios corporativos
     (`@melacrom.com.ar`, `@industriassparks.com.ar`, …) crean/reutilizan un `Customer`
     por dominio. Dominios de correo personal (`gmail`, `hotmail`, `yahoo`, `outlook`,
     `live`, `icloud`, …) se agrupan en un único `Customer` "Clientes particulares",
     para no crear empresas falsas tipo "Gmail" ni "Hotmail".
- **Canal email** → `Mailbox` en **modo inactivo** (`active=false`) hasta que el
  operador complete las credenciales IMAP/SMTP reales desde `Casillas`. Si el export
  trae canales **vacíos** (sin `host`/`user`, p.ej. `Email::Notification`), se ignoran
  y no se crea ningún `Mailbox`.

### 6.3 Password: migración perezosa (Argon2 → bcrypt)

> **IMPORTANTE (secret de Zammad).** Zammad NO hashea con Argon2id a secas:
> `lib/password_hash.rb` usa `Argon2::Password.new(secret: Setting.get('application_secret'))`.
> Ese `application_secret` actúa como "pepper" y es **obligatorio** para verificar el
> hash. Si SolidOps verifica el `legacy_argon2_hash` sin ese secret, el hash decodifica
> pero **ninguna contraseña real coincide** (el login da siempre 401). 
> 
> **Antes de la migración, configurá el secret en SolidOps:**
> ```bash
> # obtenerlo en la VM de Zammad:
> zammad run rails runner "puts Setting.get('application_secret')"
> # luego en .env / compose:
> ZAMMAD_APPLICATION_SECRET=<ese valoR>
> ```
> Sin `ZAMMAD_APPLICATION_SECRET` los usuarios migrados no pueden loguear (se
> comporta como si no hubiera manera de validar su contraseña). Nunca committear
> el valor real.

Zammad hashea con **Argon2id**, incompatible con bcrypt. En SolidOps cada usuario
migrado guarda el hash original en `legacy_argon2_hash` y deja su `password_hash`
en **NULL** (la columna es nullable). Al primer login exitoso:

1. Se verifica la contraseña contra `legacy_argon2_hash` (Argon2id) usando el
   `application_secret` de Zammad (ver nota arriba).
2. Si es válida, se re-hashea a bcrypt (`password_hash`), se guarda, y se vacía
   `legacy_argon2_hash`.
3. Si la contraseña es inválida, el login falla **sin revelar cuál** campo (no hay
   señal de si el problema es el hash legacy o la contraseña).

Esto aplica tanto al login staff (`AuthService`) como al portal (`PortalService`).
Usuarios sin hash (staff `ana@...` de ejemplo, sin password) quedan con `legacy_argon2_hash`
vacío y deben hacer un reset de contraseña en la interfaz.

> **Nota backups:** la extracción de contraseñas de un canal de email **no** se
> exporta (Zammad guarda los secretos por separado). Las casillas se crean inactivas
> y el operador completa las credenciales desde la UI de `Casillas`.

### 6.4 Verificación del login perezoso (staff y portal)

Scripts de diagnóstico incluidos en el repo (misma librería y misma llamada que
`AuthService`/`PortalService`: `@node-rs/argon2.verify`):

```bash
# staff (tabla users)
docker exec ops-backend node /app/verify-lazy.js --secret "<application_secret>" "<email>" "<password>"

# portal de clientes (tabla contacts)
docker exec ops-backend node /app/verify-lazy-contact.js --secret "<application_secret>" "<email>" "<password>"
```

Devuelven `verify('...') = true/false` por cada contraseña. Si da `| true` → el hash
y el secret son correctos y el login funcionará. `false` → contraseña incorrecta o
el secret no es el de Zammad. El secret **nunca** se pega en el chat (se pasa por
argumento o env `SECRET`).

#### Estado de la validación

- **Staff**: la integración con secret se verificó de punta a punta (login real → 201,
  migración a bcrypt + legacy null) usando un hash+secret de prueba inyectados.
- **Portal de clientes**: el mecanismo con secret contra la tabla `contacts` se
  verificó con un hash+secret de prueba inyectados (`verify true/false` correctos).
  **PENDIENTE:** confirmación 100% real con la contraseña de un cliente humano, ya
  que a la fecha de la migración no se dispone de la contraseña real de ningún cliente.
  Cuando un cliente real intente entrar por el portal después del corte:
  - Si funciona: migra sin intervención.
  - Si falla (401): **el soporte técnico debe estar atento y resetearle el acceso
    manualmente sin demora** (asignar/reestablecer contraseña del portal vía la UI
    de admin de clientes). No esperar varios intentos fallidos.

---

## 7. Migración MASIVA de tickets (~40.100, con `legacy_group`)

Discovery previo confirmado: Zammad tiene **~40.100 tickets**, pero solo **~178**
son soporte real a clientes (grupos `L1`/`L2`/`L3`); el resto es ruido automático
(`Users`, `Backups MK`, `Taller`, `Ventas`). **Decisión: migrar TODOS**, usando el
campo `legacy_group` para poder filtrar.

La UI de Tickets ganó un **selector de "bandeja"** que por defecto muestra solo
`legacy_group IN (L1,L2,L3)` + tickets nativos (sin legacy_group), ocultando el
ruido — pero se puede cambiar para verlo.

### 7.1 Backups obligatorios (ANTES de tocar nada)

- **Zammad** (en la VM): `su - zammad -s /bin/bash -c "pg_dump -Fc -Z9 zammad_production > /tmp/zammad/zammad_backup.dump"` (ver §2.1). Verificar no vacío.
- **SolidOps**: ya generado en `backup/ops_msp_pre_tickets_20260831-204553.dump` (1.3 MB, 23 tablas, no vacío).
- **Mucho cuidado**: los adjuntos (si se migran todos) requieren exportar el binario
  desde Zammad y subirlo a MinIO. Volumen potencialmente grande (ver §7.4).

### 7.2 Extracción en bloque desde Zammad (script Ruby, vía rails runner)

`import/export_tickets_full.rb` recorre **TODOS** los tickets (no solo L1/L2/L3) en
lotes (default 1000) y escribe NDJSON particionado + carpetas de adjuntos.

```bash
# En la VM de Zammad (SSH):
mkdir -p /tmp/zammad/export
# Sin adjuntos:
zammad run rails runner /tmp/export_tickets_full.rb
# Con adjuntos (decidido: se migran todos):
ZAMMAD_INCLUDE_ATTACHMENTS=1 zammad run rails runner /tmp/export_tickets_full.rb
# Ajustar tamaño de lote si se quiere:
ZAMMAD_LOT_SIZE=500 ZAMMAD_INCLUDE_ATTACHMENTS=1 zammad run rails runner /tmp/export_tickets_full.rb
```

Salida en `/tmp/zammad/export/`:
- `tickets_000001.ndjson`, `tickets_000002.ndjson`, … (una línea por ticket).
- `attachments_000001/` … carpetas con los archivos adjuntos (uno por artículo/adjunto).

Transferir a la PC de desarrollo (dar el comando exacto, ejemplo con `lote 1`):
```bash
scp -r administrador@10.88.88.40:/tmp/zammad/export ./import/zammad_tickets_export/
```

**Importante**: no se puede exportar uno por uno con `rails r` individual por
ticket (inviable en tiempo con 40k). El script lo hace en bloque.

### 7.3 Mapeo contra clientes/contactos YA migrados (por email, no por nombre)

**Hallazgo crítico**: la migración previa de organizaciones/usuarios (Fase 6.1)
**NO preservó IDs de Zammad** en `Customer` ni `Contact` (mapeó Organización→Customer
por nombre, Usuario→Contact por email/dominio). No hay `legacy_zammad_id` en esas
tablas (solo en `Ticket`).

Por eso el mapeo de tickets es **exclusivamente por email del contacto** (sin
falsos positivos por nombre ni adivinanzas por organización):
1. `ticket.customer_email` → `Contact.email` existente → usa su `Customer` + `Contact`.
2. Si el email no matchea (o no hay email), el ticket se migra igual con
   `customer_id = NULL` (visible y filtrable), criterio de "Recursos generales".
   **No** se intenta mapear por nombre de organización.

`Ticket.customer_id` pasó a ser **nullable** para soportar tickets sin cliente.

### 7.4 Adjudientes (decidido: migrar todos)

El script Ruby incluye cada adjunto del artículo (metadata + binario en
`attachments_*/`). El import Node sube el binario a **MinIO** (`prefix 'tickets'`)
y crea el `TicketAttachment` con `fileUrl`/`filename`/`mimeType`/`sizeBytes`.

> El volumen puede ser grande (ver la sorpresa de la migración documental). Si en
> el dry-run del export se detecta cientos de GB, revisar antes de transferir todo.

### 7.5 Modelo de datos y UI

- `Ticket.legacy_group` (string, indexado) — grupo original de Zammad.
- El import NO dispara notificaciones, correos, ni crea registros SLA:
  - `firstresponseAt`/`resolvedAt` quedan NULL.
  - No se pasa por `addMessage`/`notifications` (se escribe directo a base).
- **Selector de bandeja** en `/tickets` (parámetro `tray`):
  - `support` (default): `legacy_group IS NULL OR IN (L1,L2,L3)`.
  - `general`: `legacy_group IN (Users, Backups MK, Taller, Ventas)`.
  - `nativo`: `legacy_group IS NULL` (solo tickets creados en SolidOps).
  - un grupo exacto, o `all`.
  - Backend: `ListTicketsQuery.tray`; la UI lo expone como dropdown.

- **Navegación por bandejas en el menú lateral** (estilo panel de Zammad): bajo el
  ítem "Tickets" del sidebar se muestran accesos directos por bandeja con contador
  (`L1`, `L2`, `L3`, `Nativos`, `Users`, `Backups MK`, `Taller`, `Ventas`,
  `Mesa de ayuda`). Cada acceso enlaza a `/tickets?tray=<grupo>` (reusa el filtro
  `tray`; no duplica lógica).
  - Conteos reales vía `GET /tickets/groups` (`TicketsService.groupCounts`), que
    respeta `applyRowScope` (técnico ve solo sus tickets) y excluye `shadow`.
  - Se recalculan en cada carga de página (el `Shell` lo pide con el mismo efecto
    que `attention-count`), no quedan hardcodeados.
  - La vista por defecto de "Tickets" (sin `?tray`) sigue siendo `support` — la
    navegación por bandejas es un complemento, no un reemplazo.

> **Fix de los 7 tickets fallidos:** la importación había fallado en 7 tickets
> (ids Zammad 32, 39, 41, 43, 106, 112, 185, todos del grupo `Users`) con
> `value too long for type character varying(200)` porque sus `title` superaban
> 200 chars (224-250, automatismos de Trello: "ha movido la tarjeta…"). Se amplió
> `Ticket.title` de `varchar(200)` a `varchar(500)` (sin perder info real, y con
> `ALTER TABLE` directo porque `synchronize` no altera la longitud de columnas
> existentes) y se reimportaron solo esos 7 (el import es idempotente: salteó los
> ya creados y reintentó los fallidos → `ticketsCreated=7`). Total final: 40184.

### 7.6 Importación a SolidOps (script Node, directo a base)

`npm run import:zammad:full -- --ndjson-dir <carpeta> [--dry-run] [--limit N]`

- **Directo a base** (no por API): más rápido para 40k, sin pasar por validaciones
  de la API. Usa transacciones por ticket (ticket + mensajes + adjuntos en una
  transacción; si un adjunto falla, se revierte ese ticket).
- **Dry-run** primero: solo reporta (creea el reporte de fallidos), no escribe.
- **Idempotencia**: saltea tickets cuyo `legacy_zammad_id` ya existe (re-ejecución
  no duplica).
- **Reporte de fallidos** en `import/fail-report.txt` (totales, por grupo, con/sin
  cliente, lista de fallidos con motivo).

> **Nota de rendimiento**: el import precarga el mapa de contactos por email al
> inicio para no consultar la BD por cada uno de los ~40k tickets.

### 7.7 Flujo de aprobación (Parte 6 — prueba en vivo)

1. **Dry-run sobre el export completo** → mostrar el reporte al usuario (totales,
   por grupo, con/sin cliente). No avanzar sin aprobación.
2. **Prueba parcial** `--limit 150` (incluyendo L1/L2/L3 + grupos de ruido) → revisar
   en la UI con la bandeja, confirmar que no genera notificaciones/SLAs, que los
   mensajes conservan orden y fechas originales.
3. Recién con la prueba aprobada → **importación completa** (~40k).

### 7.8 Estado del código implementado (2026-08-31)

- Backend: `Ticket.legacy_group` + `customer_id` nullable; `Ticket.title` `varchar(500)`;
  filtro `tray` en `ListTicketsQuery` + `findAll` (incluye `nativo`);
  `groupCounts` + `GET /tickets/groups`; `TicketImportService` + `run-ticket-import.ts`
  (directo a base, dry-run, idempotencia, adjuntos a MinIO, reporte de fallidos).
- Frontend: selector de bandeja en `/tickets`; navegación por bandejas en el
  sidebar (accesos directos por bandeja + contador, enlazando a `?tray=`).
- `import/export_tickets_full.rb` (export masivo con adjuntos).
- Script npm: `import:zammad:full`.
- **Pendiente (requiere acceso a la VM de Zammad)**: backup de Zammad + correr el
  export Ruby + transferir los NDJSON + aprobar dry-run y prueba parcial antes de
  importar todo.

---

## 8. Vistas guardadas (réplica de las Overviews de Zammad) en el sidebar

Se replicaron las vistas (Overviews) del panel lateral de Zammad como **`SavedView`**
(entidad `saved_views`, condición JSONB) más un **conteo por vista** en el sidebar.

### Motor de filtro (`SavedViewsService` + `applyCondition`)

Condiciones combinables con AND: `statusIn`, `senderContains` (primer/los mensajes
con `fromEmail` contiene), `titleContains` / `titleNotContains`, `ownerIsNull`,
`ownerIsCurrentUser`. Se agrega a `ListTicketsQuery.view` para filtrar el listado
extendiendo `findAll` (no duplica lógica de listado). Endpoints:
- `GET /tickets/views` → vistas + conteo (respeta rol/técnico).
- `GET /tickets?view=<id>` → listado con la condición aplicada.

**Si se pide `?view=`, la bandeja NO se aplica** (evita la intersección vacía con el
default `support`).

### Vistas implementadas

**Grupo A (fijas)**: Ordenes de Servicio, Ordenes de Trabajo, Backups MK,
Notificaciones de RED (`title` `notificación`), CORRECTO/INCORRECTO - backup
clientes, Tickets no asignados y abiertos, Todos los tickets.

**Grupo B (userScoped, dependen del técnico logueado)**: Mis tickets asignados,
Mis tickets pendientes. Se evalúan con `t.technician_id = actor.technicianId`
(perfil de técnico), distintas por usuario.

### Vistas NO implementadas (con motivo)
- **EN ESPERA** → depende de etiquetas manuales (`tags`); SolidOps **no tiene
  etiquetas**. Pendiente hasta que exista la feature de tags.
- **Mis tickets suscritos** → no existe concepto de suscripción/mención.
- **Tickets escalados / Pending Reached** → motor de escalamiento de Zammad
  distinto; SolidOps tiene SLA con semáforo, no es un calco.
- **My Replacement Tickets / My Organization Tickets** → features no migradas
  (reemplazo por ausencia; técnicos sin organización propia).

### Detalles
- Estados de Zammad (`closed`/`open`/`new`/`pending reminder`/`pending close`/
  `id 6`) se mapean a los reales de SolidOps: `closed→cerrado`, `open→abierto`,
  `new→nuevo`, `pending→esperando_cliente`; `id 6`/`pending_*` no existen (la
  migración los fundió). Las vistas "de contenido" usan `cerrado`+activos; "Todos
  los tickets" usa los 7 estados (el nombre "cerrados" en Zammad es engañoso e
  incluye todo).
- Las etiquetas aún no existen; el motor las soportaría cuando se agreguen.
- Conteos verificados: Backups MK=14636, Notificaciones RED=250, CORRECTO=9948,
  INCORRECTO=1435, Sin asignar y abiertos=1279, Todos=40183. Mis tickets (maria)=1,
  (pedro)=0 — distintos por técnico. Ordenes de Servicio/Trabajo=0 (datos reales:
  ningún ticket migrado cumple ese remitente+asunto exacto).

### Fix: la URL es la fuente de verdad única para "tray"/"view"

**Problema (confirmado en vivo):** al hacer clic en un acceso de bandeja del
sidebar, la URL cambiaba y el ítem quedaba activo, **pero la lista de tickets no se
refrescaba** (seguía mostrando la bandeja anterior). El dropdown de arriba sí
actualizaba. Causa: la página leía el `tray` de la prop `searchParams` **solo al
montar** (`useState(searchParams?.tray)`) y el `<select>` la cambiaba con estado
local `setTray` — **fuente de verdad dividida** (URL vs estado local), y el
componente no reaccionaba a la navegación client-side del sidebar.

**Fix (`tickets/page.tsx`):**
- Se eliminó el estado local `tray` y la prop `searchParams`.
- `tray`/`view`/`customerId` ahora se derivan de **`useSearchParams()`** (reactivo),
  y los Links del sidebar, el `<select>` y el botón atrás/adelante del navegador
  operan todos sobre la **URL** (el select usa `router.replace`), no sobre estado
  duplicado.
- El fetch se dispara en un `useEffect` dependiente de `tray`/`view`/`customerId`,
  así cualquier cambio de URL recarga la lista.
- `useSearchParams` vive dentro de un `<Suspense>` (exigido por Next para el build
  estático; mismo patrón que `reset-password/page.tsx`).

Verificado: arranque por URL con `?tray=Users|Mesa de ayuda|Backups MK|nativo|
support` y `?view=<id>` devuelven los tickets correctos desde el inicio.


---

## N�mero de ticket humano-legible (TK-a�o-N) � 2026-09-04

Los tickets ahora tienen un n�mero corto legible TK-{a�o}-{n�mero} (columna
	ickets.ticket_number, integer �nico) + secuencia Postgres 	icket_number_seq
para los nuevos. El prefijo TK-{a�o} se arma en el frontend a partir de
created_at (el a�o del momento en que se numer�/cre� el ticket).

- **Numeraci�n existente**: los ~40.243 tickets migrados se numeraron 1..N en
  orden de created_at ascendente (migraci�n AddTicketNumbers). La secuencia
  sigue desde N+1. El ID Zammad m�s alto era **40406** (contexto), pero la
  numeraci�n continua de SolidOps arranca en 1 y sigue desde 40.244.
- **Nuevos tickets**: todos los canales (email/IMAP, portal, manual, Taller)
  usan 
extval('ticket_number_seq') (a prueba de concurrencia).
- **B�squeda**: el buscador de tickets matchea por 	icket_number (ej. "40255")
  y por el string completo TK-2026-40255.
- **Mostrado**: portal de clientes y vista de staff muestran el n�mero en el
  encabezado; el listado lo muestra como badge junto al t�tulo.


> **Correcci�n (2026-09-04, re-verificaci�n):** la secuencia `ticket_number_seq`
> contin�a desde el ID de ticket Zammad m�s alto migrado (**40406**), por lo que
> los tickets nuevos van desde **TK-2026-40407** en adelante (no desde 40.244).
> Los ~40.243 tickets existentes quedaron numerados 1..40243 en orden de
> `created_at`. La numeraci�n es �nica y continua; no reinicia por a�o.


---

## Backfill: mensajes migrados con HTML crudo en `body` (body_html = NULL) � 2026-09-04

El importer de tickets de Zammad nunca pobl� `body_html`; todo el contenido de
los art�culos se volc� al campo `body` (HTML crudo sin procesar). Se detectaron
**36.954** mensajes con `body_html IS NULL` y HTML crudo en `body`.

### Soluci�n
Script `backend/src/database/backfill-message-html.ts` (se ejecuta con
`node dist/database/backfill-message-html.js` tras `npm run build`):
- Para cada mensaje afectado (detectado por heur�stica: `body LIKE '%<br%' OR
  '%<div%' OR '%</%'` � no hay campo `content_type` en el NDJSON de Zammad):
  - `body_html = sanitizeHtml(body)` (el mismo sanitizador que usa la ingesta
    en vivo, `mime.helper.ts` � exportado para reutilizarlo).
  - `body = htmlToText(body)` (html-to-text, texto plano sin tags).
- Procesa en lotes de 500 (resumible, loguea progreso) � 36.954 procesados,
  0 fallidos.

### Verificaci�n
- `COUNT(*) WHERE body_html IS NULL AND (body LIKE '<br' OR '<div' OR '</')` ? **0**.
- 37.019 mensajes con `body_html` (36.954 backfilled + 65 preexistentes).
- 0 mensajes con scripts/on*/javascript: en `body_html` (sanitizaci�n ok).
- Ticket de ejemplo `54597236-...` corregido (mensaje del t�cnico con firma
  Axel se ve con formato real; `body` qued� en texto plano).
- Backup previo: `backend/import/ticket_messages_backup_20260904.sql`
  (pg_dump de `ticket_messages`, 73.134 filas, 68.5 MB) � disponible por si
  hay que revertir.
