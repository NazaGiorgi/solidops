# Detección de correo nuevo por UID (sin depender de \Seen)

## Contexto

`soporte@solidocs.com.ar` se lee en paralelo por Zammad y SolidOps. Zammad marcaba
los correos como `\Seen` primero, y el worker de SolidOps consultaba "no leídos"
(`UNSEEN`) → SolidOps nunca veía ese correo (pérdida silenciosa). Mientras dos
sistemas lean la misma casilla IMAP y ambos usen `\Seen` como criterio, gana el
que lee primero. Esto es inaceptable.

## Solución: tracking por UID

Se reemplazó el criterio `UNSEEN` por **UID tracking**, que no depende del estado
de lectura del correo.

### Mecanismo
- **`mailboxes.last_processed_uid`** (int, nullable): último UID procesado.
- **`mailboxes.sync_uid_validity`** (bigint, nullable): el `UIDVALIDITY` bajo el
  cual ese cursor es válido.
- En cada ciclo el worker busca `UID >= last_processed_uid + 1` (`UID <n>:*`).
- **Nunca se usa ni se toca `\Seen`** (ni para detectar ni para marcar). El fetch
  usa `BODY.PEEK` (imapflow no marca `\Seen` por defecto), así SolidOps queda
  invisible para Zammad y viceversa.
- **Cambio de `UIDVALIDITY`**: si el servidor reindexa el buzón (cambia
  UIDVALIDITY), el cursor deja de ser válido; se re-corta desde los últimos 7 días
  y se actualiza la validity.
- **Filtro defensivo**: los UIDs devueltos se filtran `> cursor`, para garantizar
  idempotencia aunque el servidor devuelva UIDs de secuencia que incluyan el
  cursor.

### Aplica a sombra y real
El mismo criterio UID se usa tanto en modo real como en sombra (la sombra también
se basaba en "no leídos últimas 24h", con el mismo problema de fondo).

## Migración del estado (Parte 2)

En el primer ciclo tras el deploy, el worker **siembra el cursor** al UID máximo
existente de cada casilla (`uidNext - 1`) y **no** reprocesa el historial — los
correos que ya estaban no se tratan como nuevos. Estado inicial por casilla:

| Casilla | last_processed_uid | sync_uid_validity | Estado |
|---|---|---|---|
| `soporte@solidocs.com.ar` | 37046 | 1705502958 | inicializado |
| `mkbackups@solidocs.com.ar` | 103 | 1705783017 | inicializado |
| `notificacionesdeestado@solidocs.com.ar` | 102 | 1705508193 | inicializado |
| `mesadeayuda@solidocs.com.ar` | — | — | falla conexión (host) |
| `nuevab@solidocs.com.ar` | — | — | desactivada (DNS) |
| `prueba@noexiste.inventado.com` | — | — | desactivada (host) |

## Parte 4 — Diagnóstico

- **`mkbackups@`**: CONNECT OK (usando `c1931856.ferozo.com`). La credencial **se
  descifra bien**. La intermitencia anterior era transitoria / del criterio UNSEEN;
  **no comparte causa** con el bug de contraseña.
- **`mesadeayuda@`**: CONNECT falla con `ETIMEDOUT` (host `mail.solidocs.com.ar` no
  responde IMAP). Problema de **host/red**, no de credenciales. **Pendiente**: el
  usuario verifica el host IMAP correcto en su panel de hosting. No se resolvió
  apagándola.
- **`nuevab@`**: DNS `ENOTFOUND imap.solidocs.com.ar` → **desactivada**.
- **`prueba@`**: host inexistente → **desactivada**.

### Logs mejorados
`ImapService.testConnection` ahora loguea el **error real** del servidor
(`responseCode` / `code` / `source`) en vez de solo "Command failed", para poder
diagnosticar sin adivinar.

## Limpieza (Parte 3, confirmada con el usuario)
- Desactivadas (`active = false`): `prueba@noexiste.inventado.com`, `nuevab@solidocs.com.ar`.
- No tocadas: `mesadeayuda@`, `notificacionesdeestado@` (pendiente confirmar si es real),
  `soporte@` y `mkbackups@` quedan en **modo real** (decisión intencional).

## Parte 5 — Prueba en vivo (registrada)

Contra el servidor real de `soporte@` (host `c1931856.ferozo.com`):
```
cursor=37046  fromUid=37047  uidNext=37047
search({uid:'37047:*'}) raw=[37046] filtered=[]   (el cursor se filtra)
repeat filtered=[]    (idempotente)
unseenSearch => []     (el método viejo habría perdido el correo ya marcado \\Seen por Zammad)
```
- **No se usa UNSEEN**: grep confirma 0 usos de `unseen`/`\Seen`/`seen:` en el
  backend de email.
- **Idempotencia**: dos ciclos idénticos devuelven lo mismo; el filtro `> cursor`
  impide reprocesar.
- Los logs muestran `[REAL] soporte@: 0 nuevos (UID>37046)` — criterio UID, no UNSEEN.

## Verificación
- `tsc --noEmit` 0 errores; 19 tests pasan; backend health 200.
- Columnas nuevas creadas por synchronize (`last_processed_uid`, `sync_uid_validity`).

## Nota
Para la prueba de "enviar correo real y que SolidOps lo detecte" (Parte 5 §1), el
entorno no tiene un servidor de envío IMAP accesible desde el contenedor; la
evidencia de que el mecanismo es correcto se obtuvo con el servidor real de
`soporte@` (Mikrotik/ferozo) vía el search UID. Cuando llegue un correo nuevo
(UID > 37046), SolidOps lo detectará aunque Zammad lo marque como leído.

---

## Investigación: ¿Zammad mueve correos a carpetas por cliente? — NO APLICA

**Contexto.** Se planteó que SolidOps no detectaba correos porque Zammad los movía
a carpetas de cliente (una por cliente) — lo que invalidaría el recorrido de solo
INBOX del worker.

**Investigación con evidencia real.** Se listaron las carpetas IMAP de las 3
casillas activas (`soporte@`, `mkbackups@`, `notificacionesdeestado@`); todas
tienen **la misma estructura de 6 carpetas estándar**, sin ninguna carpeta por
cliente:

```
INBOX / INBOX.Sent Items / INBOX.Drafts / INBOX.spam / INBOX.Trash / INBOX.Promociones
```
delimiter `.`.

**Conclusión:** lo que se interpretó como "carpeta por cliente" es la **vista
interna de Zammad** (organización de tickets por cliente/organización en su base
de datos), **no** carpetas reales del servidor IMAP. No hay correos movidos a
otras carpetas que el worker de SolidOps no vea.

**El problema original ya está resuelto por el fix de UID-tracking.** Verificado
en logs: el worker de `soporte@` creó el ticket del correo nuevo (UID 37050 →
ticket `d854dd6f`) el 2026-08-31 ~16:05. El "estancamiento" en `UID>37046` era
simplemente ausencia de correo nuevo entre ciclos, no una pérdida de detección.

**Decisión:** no se implementa el recorrido multi-carpeta (no aplica). Sin cambios
de código en este prompt; solo queda documentada la investigación.

---

## Fix: body del mensaje vacío en tickets de correos entrantes

**Problema (confirmado en vivo):** varios tickets creados automáticamente a partir
de correo entrante (`soporte@`) aparecen con la sección de Conversación **vacía** —
se ve la cabecera (cliente · email · hora · remitente) pero no el cuerpo del correo.

**Causa raíz (confirmada con evidencia, no supuesta):** el `MailboxWorker` pedía
`text: true` a `imapflow` y leía `msg.text` para el cuerpo. Para un conjunto de
correos (HTML de notificaciones, `multipart` con adjuntos, o `text/plain` con el
header `Content-Type: text/plain; charset="UTF-8"` con el charset entre comillas),
`imapflow` devuelve **`msg.text = ''`**. El fallback ley
`bodyStructure.text`, que también venía vacío para esos mensajes. Resultado:
`body` guardado como vacío (longitud 0) — y de ahí la conversación vacía.

Se confirmó con consultas a `ticket_messages` (5 mensajes con `length(body)=0`,
de remitentes heterogéneos: `backup.clientes@`, `Mailer-Daemon@`, `wordpress@`,
`nazareno.giorgi@gmail.com` — o sea, no solo automáticas) y leyendo el raw del
correo en el servidor real (UID 37050 → `Content-Type: text/plain; charset=UTF-8`
con cuerpo legible que imapflow no decodificaba en `msg.text`).

**Solución implementada (`mailbox-worker.service.ts`):**
- El fetch ahora pide `source: { start: 0, maxLength }` (el rfc822 completo acotado)
  en lugar de `text: true`, y desciende los adjuntos grandes con `maxLength`.
- Nueva `extractBodyFromMime(raw)` que parsea el MIME con `@zone-eu/mailsplit`
  (`Splitter`), recorre **todas** las partes, ignora adjuntos, y elige la mejor:
  `text/plain` si existe, si no `text/html` (convertido a texto legible al quitarle
  los tags). Soporta charset no-UTF-8 vía `iconv-lite`.
- La sanitización de seguridad se mantiene (el HTML se convierte a texto visible,
  no se inyecta crudo; además el frontend hace saneamiento).

**Reprocesamiento (Parte 3):** se corrigieron los 5 tickets ya afectados con un
script puntual que re-lee el correo original por su `imap_uid` (guardado en
`inbound_mail_log`), extrae el body con el parser corregido y actualiza el campo
`body`. Sin resetear el cursor UID del buzón (no se reprocesa todo). Verificado:
**0 mensajes con `body` vacío** tras el reproceso.

**Prueba en vivo (Parte 4):**
1. Correo en texto plano (backup COMERC) → contenido completo. ✓
2. Correo en HTML (wordpress, Mailer-Daemon) → contenido convertido a texto. ✓
3. Confirmado en BD (`ticket_messages.body` con el texto real, no vacío). ✓
4. Ticket afectado `d854dd6f` reprocesado y con su contenido. ✓

**No-regresión:** `tsc --noEmit` 0 errores, backend health 200, worker corre sin
errores de extracción (los "0 nuevos" son ausencia de correo nuevo, no fallo).
