# Prompt para OpenCode — Verificar por qué no hay tickets recientes de mkbackups@ (gap de ~1 día) + unificar las dos bandejas "Backups MK" duplicadas

## Contexto crítico para OpenCode

**Problema 1 — urgente**: se cambió la regla de `soporte@` para que los correos de `mkbackups@` creen `Ticket` en vez de `Document`. Pero el usuario confirma que en Zammad hay tickets de backup de **hace 1 hora**, mientras que en la vista "Backups MK" de SolidOps el ticket más reciente es de **hace 1 día** — un salto de ~23 horas sin tickets nuevos, a pesar de que el reporte anterior decía que el worker de `soporte@`/`mkbackups@` estaba activo y sin errores (`last_error=(ok)`).

**Problema 2**: hay dos entradas "Backups MK" en el sidebar con números distintos y lógica distinta — la bandeja vieja por `legacy_group` (727, fija, solo datos de la migración) y la vista nueva por remitente (16.860, la correcta y actualizada). Esto genera confusión real (el usuario miró la vieja por error). Hay que unificarlas en una sola.

Seguir la metodología habitual: explicar → investigar con evidencia real → corregir → probar en vivo → verificar que no rompe nada existente → documentar.

---

## Parte 1 — Diagnosticar el gap de ~1 día sin tickets nuevos

- Revisar los logs del `MailboxWorker` de las últimas 24 horas para `soporte@` y `mkbackups@` — confirmar si el worker efectivamente detectó correos nuevos en ese lapso (`X nuevos`) o si siguió diciendo `0 nuevos` a pesar de que en Zammad sí llegaron correos de backup en ese período.
- Si el worker no detectó nada: revisar el cursor UID de `soporte@` — ¿avanzó en las últimas horas, o quedó estancado? Si quedó estancado, investigar por qué (¿conexión IMAP realmente interrumpida a pesar de `last_error=(ok)`? ¿la VPN se cortó en algún momento?).
- Si el worker SÍ detectó los correos nuevos pero no se crearon tickets: revisar si la regla corregida (`sender=mkbackups@ → ticket`) realmente se está aplicando en el código en tiempo de ejecución, o si hay algún caché de reglas que no se refrescó después del cambio en base de datos (revisar si el servicio de reglas cachea las `MailboxRule` en memoria y necesita un restart o invalidación).
- Confirmar con una consulta directa cuántos `Ticket` con remitente `mkbackups@` se crearon en las últimas 24 horas, comparado contra cuántos `Document` se crearon con ese mismo remitente en el mismo período (para confirmar si siguen yéndose a documentos por algún motivo).

## Parte 2 — Corregir la causa del gap

- Aplicar el fix según la causa real encontrada.
- Si fue necesario reiniciar el backend para que la regla se aplicara, dejarlo confirmado y documentado para que no vuelva a pasar con futuros cambios de reglas.

## Parte 3 — Unificar las dos bandejas "Backups MK"

- Eliminar del sidebar la bandeja vieja por `legacy_group = "Backups MK"` (727, fija) — la vista nueva por remitente (`senderContains: mkbackups`) ya cubre tanto los tickets migrados de Zammad como los nuevos, así que es estrictamente superior y no hace falta mantener las dos.
- Confirmar que la vista nueva efectivamente incluye TODOS los tickets que tenía la bandeja vieja (los 727 migrados) más los nuevos — no debe perderse ningún ticket en la unificación.
- Si por algún motivo técnico no conviene eliminar la bandeja vieja del todo, al menos renombrarla claramente para diferenciarla (ej. "Backups MK (histórico Zammad)") mientras la nueva se llama "Backups MK", para que no haya ambigüedad sobre cuál mirar.

## Parte 4 — Prueba en vivo

1. Confirmar que el worker detecta correos nuevos de `mkbackups@`/`soporte@` en un ciclo reciente (esperar el próximo ciclo de 5 minutos y revisar logs).
2. Confirmar que un correo de backup real y reciente ya aparece como Ticket en la vista "Backups MK" única (post-unificación).
3. Confirmar que el conteo de tickets no se perdió ninguno al unificar (comparar el total antes/después).
4. Confirmar que el sidebar ya no muestra dos entradas separadas con el mismo nombre.

## Entregable esperado
- Causa del gap de ~1 día confirmada y corregida.
- Confirmación de que los tickets nuevos de backup ya están llegando en tiempo real.
- Bandejas "Backups MK" unificadas en el sidebar, sin pérdida de datos.
- Confirmación de las 4 pruebas en vivo.
