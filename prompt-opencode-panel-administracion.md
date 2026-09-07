# PROMPT PARA OPENCODE — PANEL DE ADMINISTRACIÓN GENERAL

## Contexto

Hoy la gestión de usuarios existe (pantalla "Usuarios"), pero los roles y sus permisos están **hardcodeados en el código** (el mapa `ROLE_PERMISSIONS` en el backend) — no hay forma de ver ni cambiar qué puede hacer cada rol sin tocar código. Tampoco existe una pantalla de configuración general del sistema. Este prompt agrega ambas cosas, consolidadas bajo un nuevo ítem de menú **"Administración"**.

## 1. Editor de roles y permisos

**Modelo de datos:** si `Role` ya es una entidad en base (probablemente sí, dado que `roleId` se usa en `User`), agregale un campo `permissions` (array de strings, o JSON) que reemplace al `ROLE_PERMISSIONS` hardcodeado del código. Migrá los valores actuales del mapa hardcodeado a la base como seed inicial, para no perder el estado actual de permisos por rol.

**Pantalla `/administracion/roles`:**
- Lista de los 5 roles existentes (Administrador, Supervisor, Coordinador, Técnico, Consulta).
- Para cada rol, un editor con checkboxes de todos los permisos disponibles en el sistema (`tickets:assign`, `technicians:read`, `audit:read`, y cualquier otro que ya exista en el código — listalos todos, no inventes nombres nuevos).
- Guardar debe actualizar el registro en base, y el cambio debe aplicarse de inmediato a las próximas peticiones de usuarios con ese rol (no requiere reiniciar el backend).
- **Restricción de seguridad:** el rol Administrador siempre debe conservar como mínimo el permiso de gestionar roles y usuarios — no permitir guardar una configuración donde ningún rol pueda administrar el sistema (evitar que alguien se bloquee a sí mismo por error).
- Auditoría: cada cambio de permisos por rol queda registrado (quién, cuándo, rol afectado, permisos antes/después).

**No permitir crear ni borrar roles todavía** (los 5 roles son fijos por ahora) — solo editar qué permisos tiene cada uno. Si en el futuro hace falta crear roles nuevos, es una fase posterior.

## 2. Configuración general del sistema

**Modelo de datos:** una entidad simple `SystemSettings` (puede ser una sola fila, tipo key-value, o columnas fijas — lo que sea más simple de mantener) con al menos:
- Nombre de la empresa (usado en headers/emails/branding donde corresponda).
- Horario laboral por defecto (para SLA de clientes sin contrato específico — ya existe este concepto en `resolveTargets`/`sla.service.ts`, ahora debe ser configurable desde acá en vez de estar fijo en código).
- Valores de SLA por defecto (minutos de primera respuesta, horas de resolución) para clientes sin contrato — mismo criterio, hoy hardcodeado en el fallback de `resolveTargets`.
- Email de contacto general / remitente por defecto para notificaciones del sistema.

**Pantalla `/administracion/configuracion`:**
- Formulario simple con los campos de arriba.
- Al guardar, el sistema debe usar estos valores en tiempo real — por ejemplo, si cambiás el horario laboral por defecto, el próximo cálculo de SLA sin contrato debe usar el valor nuevo, no requerir reiniciar el backend.

## 3. Menú "Administración" (consolidación)

Agregá un ítem de menú **"Administración"** (visible solo para rol Administrador), que agrupe:
- Roles y permisos (sección 1).
- Configuración general (sección 2).
- Enlaces/accesos directos a lo que ya existe pero está disperso: Usuarios, Casillas de correo, Reglas de enrutamiento.

No muevas físicamente las pantallas existentes (Usuarios, Casillas, Reglas) de donde están hoy en el menú lateral — solo agregá accesos directos a ellas desde este panel nuevo, para no romper flujos que el equipo ya conoce y usa.

## 4. Metodología (igual que siempre)

Explicar el plan antes de codificar si hay algo ambiguo → implementar → probar en vivo (crear un rol de prueba con permisos limitados, loguearte con un usuario de ese rol, confirmar que efectivamente no puede hacer lo que le sacaste) → verificar que no rompe nada existente → documentar → entregar env vars/compose si aplica.

**Antes de tocar código**, si hay algo ambiguo sobre qué permisos exactos existen hoy en el sistema, hacé el discovery vos mismo revisando el código (`@Roles`, `@Permissions`, guards) en vez de asumir una lista — y mostrame la lista completa que encontraste antes de construir la pantalla, para que la confirme.
