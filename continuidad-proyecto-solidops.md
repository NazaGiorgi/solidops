# CONTINUIDAD DE PROYECTO — SolidOps (plataforma de operaciones IT)

Pegá este documento completo al inicio de un chat nuevo con Claude para retomar exactamente donde quedamos.

## 1. Quién soy y qué estoy construyendo

Soy dueño/gerente de un MSP (empresa de soporte IT, dominio `solidocs.com.ar`) que da soporte a clientes pyme. Estoy reemplazando **Zammad** (nuestro sistema de tickets actual) por una plataforma propia llamada **SolidOps**, construida por un agente de código (**OpenCode**) al que yo le paso los prompts — yo no programo, ejecuto comandos que me indican y reporto resultados.

## 2. Stack técnico y entorno

- Backend: NestJS + TypeORM + PostgreSQL (con pgvector) + Redis + MinIO.
- Frontend: Next.js + React + TypeScript.
- Todo corre en **Docker, en mi PC Windows 11 con Docker Desktop + WSL2 (Ubuntu)** — desarrollo local, migración a VPS pendiente para más adelante.
- Ruta del proyecto: `/mnt/d/Sistema de Tickets Agenda` (en WSL2) / `D:\Sistema de Tickets Agenda` (en Windows).
- Comandos típicos: `docker compose -f docker-compose.dev.yml up -d --build`, `docker compose -f docker-compose.dev.yml ps`, `docker compose -f docker-compose.dev.yml logs backend --tail N`.
- **No multi-tenant SaaS** — una sola empresa (nosotros) gestionando muchos clientes (`Customer`), permisos por fila via `customer_id`.

## 3. Metodología de trabajo (crítica, seguirla siempre)

Con cada pedido a OpenCode: explicar → implementar → **probar en vivo (no solo compilar)** → verificar que no rompe nada existente → documentar → entregar env vars/compose → recién ahí seguir. Nunca aceptar "listo"/"verificado" solo de palabra — siempre pedir evidencia real (captura, log, resultado de comando) antes de dar un paso por cerrado. Si algo no se prueba en el navegador con mis propios ojos, no está confirmado.

**Lecciones aprendidas duras de esta sesión** (para no repetir):
- Un hard refresh (Ctrl+F5) resuelve la mayoría de los "no funciona" — el frontend en `next dev` cachea agresivo.
- Nunca correr comandos de Docker mientras OpenCode está trabajando en paralelo — se pisan y generan falsos negativos (reinicios de contenedor a mitad de una prueba).
- El filtro "Verbose" de la consola del navegador puede estar desactivado por defecto, ocultando todos los `console.log` — si "no aparece ningún log", revisar el filtro antes de sospechar del código.
- Copiar contraseñas del gestor del navegador en vez de tipearlas a mano — varios falsos bugs fueron simplemente errores de transcripción de contraseñas con símbolos especiales.
- OpenCode a veces reescribe archivos completos (ej. `globals.css`) en vez de agregar al final, perdiendo trabajo anterior — se le pidió separar CSS por dominio en archivos distintos para evitar esto.

## 4. Fase 1 — CERRADA y verificada en vivo

Login + RBAC (roles: Administrador, Supervisor, Coordinador, Técnico, Consulta), clientes/contactos/sitios/contratos, técnicos, tickets con SLA (semáforo verde/amarillo/rojo), ingesta de email básica, agenda completa (vista día/semana/mes, drag & drop, detalle editable por modal, estados incluido pospuesto/cumplido, alarmas de recordatorio con toast persistente que no se autocierra), fusión de tickets (con permiso `tickets:assign` solo Supervisor/Coordinador), dashboards (Mi día + general con KPIs de agenda), notificaciones in-app + WebSocket, auditoría, badges numéricos en menú, visibilidad completa de agenda/tickets entre técnicos con highlight de "asignado a mí" (celeste pastel `#e8f2fc`).

## 5. Fase 2 — EN CURSO

### 5.1 Completado y verificado
- **Gestión de casillas de correo** (`Mailbox`, cifradas con AES-256-GCM vía `CryptoService`, `ENCRYPTION_SECRET` en env) + **reglas de enrutamiento "cajones"** (`MailboxRule`: sender/subject pattern → destino `ticket`/`document`/`discard`) + bandeja "correos sin regla" con botón "crear regla para este remitente".
- **Modo sombra** sobre `soporte@solidocs.com.ar` (IMAP real, `keep_on_server: true`, confirmado que no pisa a Zammad) — tickets en sombra aislados del flujo operativo normal (no en dashboard/Mi día/contadores), con aviso visual "Modo sombra — no responder desde acá".
- **Portal de clientes** (`/portal/*`) — auth propia (`type: 'portal'` en JWT, separado de staff), historial completo por defecto (no solo abiertos), CRUD de tickets desde el cliente, **rediseñado visualmente** estilo "centro de ayuda" (header oscuro `#1B2430`, búsqueda prominente, tarjetas en grid con borde superior de color por estado, tipografías Space Grotesk + Inter, acento azul `#2657FF` — todo en variables CSS `--portal-*` para ajuste rápido). Prueba de ida y vuelta confirmada (cliente crea → staff ve y responde → cliente ve la respuesta).
- **Reportes con gráficos de torta** (`recharts`) — lado interno (`/reportes`: por estado/prioridad/SLA/técnico, con filtro de fecha) y lado cliente (`/portal`: solo sus propios datos, sin carga por técnico).
- **Migración de usuarios/organizaciones desde Zammad**: 69 organizaciones → `Customer`, ~314 inferidos por dominio corporativo + 1 "Clientes particulares" (dominios genéricos gmail/hotmail/etc.), 6 staff → `User`+`Technician` (mapeo Admin→Administrador, Agent→Técnico), 695 `Contact` (~686 clientes reales con `portal_enabled: true`).
- **Migración perezosa de contraseñas Argon2→bcrypt**: Zammad usa Argon2id **con un `application_secret` (pepper)** propio (`Setting.get('application_secret')` en Zammad, código en `lib/password_hash.rb`) — sin ese secret, la verificación siempre falla aunque el hash sea idéntico. Ya configurado como `ZAMMAD_APPLICATION_SECRET` en `backend/.env`, confirmado funcionando en vivo con cuenta real (`axel.perruelo@solidocs.com.ar`).
- **Recuperación de contraseña** (staff + portal): `PasswordResetToken`, flujo forgot/reset, respuesta neutral (no revela si el email existe), rate limiting (Redis), SMTP reutilizando la config de `soporte@`, borra `legacy_argon2_hash` al resetear. Verificado en backend; **falta confirmar que el email de reseteo realmente llega** (o revisar el log `[NO-SMTP]` si SMTP de `soporte@` no está bien cargado).
- **Fix de permisos en fusión de tickets**: 403 ahora devuelve mensaje JSON claro (`{"message": "..."}`) desde el backend vía `@Permissions(..., { message })`, retrocompatible. El botón "fusionar ticket" se ocultó para rol Técnico en el frontend — **último estado sin confirmar si ya se aplicó** (última captura mostraba el botón visible con 403 para un usuario sin identificar el rol).
- **Regresión de CSS corregida y prevenida**: se había perdido CSS de agenda/modales/toasts/burbujas de mensajes al reescribir `globals.css`; se restauró y se separó en `agenda.css` / `components.css` / `globals.css` para evitar que vuelva a pasar.

### 5.2 Pendiente de confirmar AHORA MISMO (retomar acá)
1. **Login de `info@solidocs.com.ar`** — tras varias vueltas (contraseña vieja no funcionaba, reseteo generó otra que tampoco coincidía en bcrypt), OpenCode generó una contraseña nueva más reciente — **falta confirmar en el navegador que esa entra y persiste**.
2. **Botón "fusionar ticket" para rol Técnico** — confirmar si ya está oculto (última captura lo mostraba visible con 403).
3. **SMTP real en `soporte@solidocs.com.ar`** — confirmar si los campos SMTP (no solo IMAP) quedaron cargados al agregar la casilla, y si el email de reseteo de contraseña realmente llega a la bandeja.

### 5.3 Prompts armados y pendientes de enviar/confirmar
- **Panel de Administración general** (archivo `prompt-opencode-panel-administracion.md`, ya en curso de discovery por OpenCode): editor de roles/permisos desde DB (no hardcodeado), configuración general del sistema (nombre empresa, horario laboral y SLA por defecto, email remitente), menú "Administración" consolidando Usuarios/Casillas/Reglas. Decisiones ya confirmadas: opción "Todo + catálogo desde DB" (sin borrar `ROLE_PERMISSIONS` del código, que queda como seed), Administrador conserva mínimo `users:*` + `audit:read` como permiso irrevocable.
- **CRUD de Clientes** (armado, no enviado aún): falta editar cliente (no solo contactos), "eliminar" = soft delete/desactivar (nunca borrado real, por historial de tickets/contratos), filtro por nombre + estado activo/inactivo + con/sin contrato, bloquear tickets nuevos a clientes inactivos.

## 6. Migración histórica de Zammad — pendiente

**Discovery ya hecho** (VM Zammad en Proxmox, acceso SSH `administrador@10.88.88.40`, comandos vía `sudo -u zammad zammad run rails r "..."`):
- ~40.100 tickets totales. Solo **178 reales** en grupos `L1`/`L2`/`L3` (soporte a clientes). El resto (~39.946) son notificaciones automáticas: `Users` (backups Mikrotik+sistemas cliente), `Backups MK`, `Taller`, `Ventas` (mismo ruido: backups, alertas SMART Proxmox, health checks de mail).
- **Decisión final del usuario**: migrar **TODOS** los ~40.100 tickets (no solo los 178), pero cada uno debe entrar a la bandeja correspondiente según su grupo original de Zammad — usar campo `legacy_group` en el `Ticket` migrado, con selector de "bandeja" en la interfaz de Tickets (tabs/dropdown), **por defecto mostrando solo L1/L2/L3** para no ensuciar el uso diario, pero permitiendo cambiar el filtro para ver el resto cuando haga falta. **Este prompt todavía no se armó del todo ni se envió** — es el siguiente paso grande de la migración.
- Prueba de muestra (20 tickets de L1) ya migrada y confirmada en vivo (cliente/contacto correcto, mensajes en orden, fechas originales).
- **Antes de la migración masiva completa**: hacer backup de Zammad (`pg_dump` o backup nativo, por SSH) y backup de SolidOps (`pg_dump` de `ops_msp`) — obligatorio, ya documentado en `docs/ZAMMAD-MIGRATION.md`, pero **todavía no se corrió para la migración completa** (solo hubo un backup pre-import de usuarios).
- 3 casillas de correo reales cargadas manualmente (no vía script, que salió con datos vacíos): `soporte@solidocs.com.ar` (modo sombra activo), y hay que cargar **`mesadeayuda@solidocs.com.ar`** (host `mail.solidocs.com.ar`, destino por defecto: `ticket`) y **`mkbackups@solidocs.com.ar`** (host `c1931856.ferozo.com`, destino por defecto: `document`) — decisión ya tomada, reglas catch-all en modo sombra, **prompt armado pero no confirmado si ya se envió/aplicó**.
- **Importante de seguridad**: las contraseñas viejas de las 3 casillas de email quedaron expuestas en el chat en algún momento — deberían haberse rotado ya (recomendado hacerlo si no se hizo).

## 7. Fase 2 — pendientes de más adelante (no urgente todavía)
- WhatsApp Business API + chatbot v1 — **trámite de aprobación de Meta todavía no iniciado por el usuario**, es la dependencia crítica de cronograma, recomendado iniciar en paralelo cuanto antes.
- Reportes/gráficos ya cerrados (ver 5.1).

## 8. Archivos de referencia ya generados en esta sesión (en outputs, pedir que se regeneren si hace falta)
- `arquitectura-plataforma-operaciones-it.md` — arquitectura general del sistema.
- `prompt-opencode-fase1.md` — prompt histórico de Fase 1 (ya completado).
- `prompt-opencode-fase2.md` — prompt maestro de Fase 2 completo y actualizado (fuente de verdad del alcance).
- `prompt-opencode-modulo-documental.md` — módulo de gestión documental (diseñado, no iniciado aún — relevante para cuando se migren los ~39.946 tickets de ruido a `document`).
- `prompt-opencode-panel-administracion.md` — panel de administración (en curso).
- `resumen-sesion-30-08-2026.md` — resumen de la sesión anterior (Fase 1).

## 9. Próximo paso inmediato al retomar
Confirmar en vivo los 3 puntos de la sección 5.2 (login de `info@`, botón fusionar oculto para Técnico, SMTP de `soporte@`), y decidir si seguir con el panel de Administración en curso, el CRUD de Clientes, o directamente armar el prompt de migración completa de los 40.100 tickets con `legacy_group`.
