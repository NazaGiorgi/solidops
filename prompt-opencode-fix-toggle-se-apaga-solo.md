# Prompt para OpenCode — URGENTE: el toggle "Respuestas automáticas por email" se desactiva solo, sin que nadie lo pida

## Contexto crítico para OpenCode

**ACTUALIZACIÓN URGENTE**: el problema es más grave de lo que parecía. El usuario reporta que, además del toggle desactivándose solo, **los tickets nuevos NO están llegando en absoluto** desde correos entrantes reales a `soporte@solidocs.com.ar` — ni el ticket se crea, ni el mail de confirmación, ni nada. Esto sugiere que el worker de ingesta de correo puede estar caído o fallando silenciosamente, no solo un problema del toggle.

**Prioridad de investigación, en este orden:**
1. Primero confirmar si el worker de `soporte@` está vivo y procesando correos en absoluto (más urgente y más grave).
2. Después investigar por qué el toggle se resetea solo.

El usuario quiere el control 100% manual del toggle — lo prende y apaga él mismo cuando quiere, sin que ningún mecanismo automático lo toque, y sin tener que estar reactivándolo constantemente porque algo se lo resetea solo.

El usuario activó manualmente el toggle `emailAutoResponseEnabled` (confirmado "✓ Guardado" en la UI), y minutos después, sin haber pedido nada, lo encuentra desactivado de nuevo. Esto pasó más de una vez seguida. **No hay ningún prompt en curso que esté pidiendo desactivarlo** — esta vez es un comportamiento espontáneo del sistema, no una instrucción de un prompt anterior.

Esto es grave porque el usuario necesita confiar en que el toggle se mantiene en el estado que él elige, sin sorpresas — especialmente antes del corte de Zammad, donde este control va a ser crítico.

Seguir la metodología habitual: explicar → investigar con evidencia real → corregir → probar en vivo → verificar que no rompe nada existente → documentar.

---

## Parte -1 — URGENTE: confirmar si el worker de correo está vivo (antes que nada más)

- Revisar el estado del `MailboxWorker` para `soporte@solidocs.com.ar`: ¿está activo? ¿cuándo fue su último ciclo (`last_checked_at`)? ¿tiene algún error (`last_error`)?
- Conectarse directamente al servidor IMAP (como se hizo en un diagnóstico anterior de esta sesión) y comparar el `uidNext` real del servidor contra el cursor guardado del worker — confirmar si el worker está al día o quedó estancado.
- Revisar los logs del backend de los últimos 15-20 minutos buscando cualquier actividad (o error) relacionada a `soporte@` o al procesamiento de correos entrantes.
- Si el worker está caído o con error: esa es la causa raíz real y más urgente — corregirla primero, antes de seguir con el tema del toggle.

## Parte 1 — Investigar con evidencia real, sin asumir

- Revisar si existe algún seed/inicialización que se ejecute al arrancar el backend (`SeedService` u otro) que resetee `emailAutoResponseEnabled` a `false` por defecto — si el backend se reinició varias veces esta noche (por los múltiples cambios de código), esto explicaría el patrón.
- Revisar si hay algún cron job, tarea programada, o `setInterval` en el código que toque este setting periódicamente por algún motivo (por ejemplo, residuo de alguna lógica de seguridad "apagar automáticamente después de X minutos" que se haya agregado en algún momento y haya quedado sin que el usuario lo supiera).
- Revisar el historial de valores de `emailAutoResponseEnabled` en la tabla de auditoría (si el cambio de settings se audita) — confirmar CUÁNDO y CÓMO cambió a `false` cada vez, y si hay un patrón de timing (¿siempre pasa X minutos después de activarlo? ¿coincide con un reinicio del contenedor?).
- Revisar los logs del backend alrededor del momento en que el usuario activó el toggle la última vez, buscando cualquier log que mencione este setting.

## Parte 2 — Corregir

- Si la causa es un seed que resetea el valor en cada arranque del backend: corregir para que el seed NUNCA sobreescriba un valor ya configurado por el usuario — el seed debe solo aplicar un valor por defecto la primera vez (cuando la fila no existe), nunca pisar un valor existente en reinicios posteriores.
- Si la causa es otra (cron, timer, etc.): eliminarla, ya que el usuario quiere control 100% manual de este toggle, sin ningún mecanismo automático que lo apague.

## Parte 3 — Prueba en vivo

1. Confirmar que el worker de `soporte@` procesa un correo de prueba real y crea el ticket correctamente (esto es lo más urgente — probarlo primero).
2. Activar el toggle, confirmar "✓ Guardado".
3. Reiniciar el contenedor del backend (`docker compose restart backend`) para simular lo que pasó esta noche.
4. Confirmar que el toggle SIGUE activado después del reinicio — este es el test clave para el bug del toggle.
5. Esperar varios minutos sin tocar nada y confirmar que sigue activado (para descartar un timer).
6. Con el worker funcionando y el toggle activado y estable, mandar un correo de prueba real y confirmar que llega el ticket Y el mail de confirmación.

## Entregable esperado
- Causa raíz del worker de correo caído/fallando confirmada y corregida (si aplica) — prioridad máxima.
- Causa raíz de por qué el toggle se resetea solo, confirmada con evidencia real (no suposición).
- Fix aplicado para que el toggle nunca cambie de valor salvo que el usuario lo haga manualmente.
- Confirmación de las 6 pruebas en vivo, especialmente la de sobrevivir a un reinicio del backend y la de recibir un ticket real por correo.
