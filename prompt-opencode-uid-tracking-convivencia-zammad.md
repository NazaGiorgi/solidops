# Prompt para OpenCode — Cambiar estrategia de detección de correo nuevo (no depender de "no leído")

## Contexto crítico para OpenCode

Confirmamos en vivo que `soporte@solidocs.com.ar` sigue activa en **Zammad** en paralelo a SolidOps. Un correo de prueba llegó a la casilla, Zammad lo procesó primero (creó ticket #6340148, mandó respuesta automática) y lo marcó como leído (`\Seen`) en el servidor IMAP. El worker de SolidOps consulta "no leídos" para decidir qué procesar — como Zammad se adelantó y marcó el correo como leído, SolidOps nunca lo detectó, aunque `keep_on_server: true` evitó que se borrara.

**Diagnóstico de fondo:** mientras dos sistemas lean la misma casilla IMAP y ambos usen el flag `\Seen` como criterio de "correo nuevo a procesar", va a haber pérdida silenciosa e impredecible de correos — gana el que lea primero en cada ciclo. Esto no es aceptable ni siquiera como transición temporal.

**Decisión tomada:** en vez de cortar Zammad de forma abrupta, cambiar la estrategia de detección de SolidOps para que **no dependa de `\Seen`**, permitiendo que ambos sistemas convivan leyendo la misma casilla durante la migración gradual.

Seguir la metodología habitual: explicar → implementar → probar en vivo → verificar que no rompe nada existente → documentar → entregar env vars/compose.

---

## Parte 1 — Cambiar la estrategia de detección de correo nuevo

Reemplazar el criterio actual (`UNSEEN` / no leído) por uno que no dependa del estado de lectura del correo. Opciones estándar de IMAP a evaluar e implementar la más robusta:

- **UID tracking**: guardar por casilla el último `UID` procesado (columna nueva en `Mailbox` o tabla de estado aparte, ej. `mailbox_sync_state`). En cada ciclo, pedir al servidor solo los mensajes con `UID` mayor al último procesado (`UID SEARCH UID X:*` o equivalente según la librería IMAP usada). Es el método más confiable porque el UID es estable por casilla mientras no cambie el `UIDVALIDITY`.
- Contemplar el caso de cambio de `UIDVALIDITY` (puede pasar si el servidor reindexa el buzón) — si cambia, hay que resincronizar desde una fecha de corte razonable en vez de reprocesar todo el historial.
- **No usar ni tocar el flag `\Seen`** en ningún punto del flujo de SolidOps — ni para detectar, ni para marcar después de procesar. Así SolidOps queda invisible para Zammad y viceversa; cada sistema puede seguir marcando como leído para sí mismo sin pisarse.
- Aplicar el mismo criterio tanto en modo sombra como en modo real — hoy en sombra también se basa en "no leídos últimas 24h", que tiene el mismo problema de fondo aunque ahí sea de solo lectura.

## Parte 2 — Migración del estado existente

- Para las casillas que ya están corriendo, inicializar el `mailbox_sync_state` con el UID más alto existente al momento del deploy del fix, para no reprocesar de golpe todo el historial viejo como si fuera correo nuevo.
- Documentar claramente qué UID/fecha de corte quedó para cada casilla tras el fix.

## Parte 3 — Limpieza de casillas de prueba detectadas en los logs

Se detectaron 3 casillas en los logs que no deberían estar activas en producción, generando ruido de errores cada 5 minutos:
- `prueba@noexiste.inventado.com`
- `nuevab@solidocs.com.ar` (falla por DNS: `getaddrinfo ENOTFOUND imap.solidocs.com.ar`)
- Confirmar con el usuario si `notificacionesdeestado@solidocs.com.ar` es una casilla real cargada a propósito o también un resto de pruebas.

Pedirle al usuario confirmación de cuáles borrar antes de eliminarlas (no asumir).

## Parte 4 — Revisar la intermitencia de `mkbackups@` y falla constante de `mesadeayuda@`

En el mismo log había:
- `mkbackups@` fallando de forma intermitente (funcionó a las 12:10 y 12:20, falló a las 12:15) con el mismo error genérico IMAP.
- `mesadeayuda@` fallando siempre.
- Mensajes `WARN [ImapService] IMAP test falló: Command failed` sin detalle de la causa real.

Esto puede compartir causa raíz con el bug ya reportado de que la contraseña de `mkbackups@` no se guarda correctamente. Antes de dar este punto por separado, revisar si viene de ahí. Mejorar el log de `ImapService` para que muestre el error real devuelto por el servidor IMAP (código de error, no solo "Command failed") — es indispensable para poder diagnosticar sin adivinar.

## Parte 5 — Prueba en vivo

1. Mandar un correo de prueba nuevo a `soporte@` y confirmar que SolidOps lo detecta y lo enruta según las reglas, **sin importar si Zammad lo marca como leído primero**.
2. Confirmar en los logs que el criterio usado ya no es `UNSEEN`.
3. Confirmar que Zammad sigue funcionando con normalidad sobre la misma casilla (el usuario lo valida desde su panel de Zammad).
4. Repetir la prueba una segunda vez para confirmar que no se reprocesa el mismo correo dos veces (idempotencia del UID tracking).

## Entregable esperado
- Explicación de qué mecanismo de tracking se implementó y por qué.
- Confirmación de que ya no se usa `\Seen`/`UNSEEN` como criterio en ningún lado del flujo.
- Estado de sincronización inicial documentado por casilla.
- Resultado de la prueba en vivo (correo detectado y no reprocesado en corrida duplicada).
- Diagnóstico de la Parte 4 (si comparte o no causa raíz con el bug de contraseña).
- Lista de casillas de prueba a limpiar, esperando confirmación del usuario antes de borrar.
