# Prompt para OpenCode — Modo "acumulación silenciosa" mientras convive con Zammad

## Contexto para OpenCode

Mientras SolidOps convive con Zammad (Zammad sigue operando de cara al cliente), el objetivo de esta etapa es que SolidOps **acumule el correo entrante como tickets reales y completos** (cliente, contacto, hilo, cálculo de SLA) para tener el historial listo cuando se complete la migración — pero **sin que el cliente reciba ninguna respuesta ni notificación automática desde SolidOps** durante esta etapa. Zammad sigue siendo la única cara visible para el cliente por ahora.

Esto es una decisión temporal y reversible: en algún momento, cuando se corte Zammad, SolidOps va a tener que empezar a notificar de verdad. No hardcodear esto como si fuera permanente — tiene que poder desactivarse fácilmente más adelante.

Seguir la metodología habitual: explicar → implementar → probar en vivo → verificar que no rompe nada existente → documentar.

---

## Parte 1 — "Modo acumulación" como toggle, no como hardcode

- Agregar un setting claro (a nivel `SystemSettings` si ya existe esa entidad del panel de administración, o una config específica de email) tipo `emailAutoResponseEnabled: boolean`, por defecto `false` en este momento.
- Cuando está en `false`: los tickets creados a partir de correo entrante se generan completos (cliente, contacto, hilo, SLA), pero **no se dispara ningún envío saliente** hacia el remitente — nada de confirmación de recepción, nada de notificación de cambio de estado, nada de respuesta automática.
- Confirmar que esto no afecta las notificaciones **internas** (in-app, badges, dashboard) — esas sí tienen que seguir funcionando con normalidad para el equipo, es solo el correo saliente al cliente lo que se silencia.
- Debe quedar visible y editable desde el panel de Administración (Configuración general) para cuando se quiera activar más adelante sin pedirle código a OpenCode.

## Parte 2 — Ajustar destinos de las casillas activas

- **`soporte@solidocs.com.ar`**: cambiar el `default_destination` (catch-all) de `document` a **`ticket`** — ya no hace falta que sea genérico, ahora que hay modo silencioso no hay riesgo de que un catch-all amplio le mande confirmaciones automáticas al cliente por error.
- **`mkbackups@solidocs.com.ar`**: mantener `document` — sigue siendo puro ruido de backups Mikrotik, no correspondencia de cliente.
- **`notificacionesdeestado@solidocs.com.ar`**: confirmado que son notificaciones automáticas de DVR (cámaras/grabadores), no consultas de clientes — mantener/cambiar a `document` o `discard` (a definir cuál de las dos con el usuario si hace falta distinguir "quiero guardar esto para referencia" vs "es ruido puro que no vale la pena guardar"; por ahora usar `document` como default más seguro, ya que "acumular todo" es el objetivo de esta etapa).
- **`mesadeayuda@solidocs.com.ar`**: sigue con timeout de host pendiente de resolver (aparte, no depende de este prompt) — no tocar su destino hasta que esté conectando.

## Parte 3 — Prueba en vivo

1. Con el modo en `false` (apagado), mandar un correo de prueba a `soporte@` y confirmar:
   - Se crea el ticket completo (cliente/contacto asociado, SLA calculado).
   - **No sale ningún correo** hacia el remitente de prueba (revisar logs del servicio de envío de correo, no solo asumir).
   - Sí se genera la notificación in-app normal para el equipo interno.
2. Activar el setting a `true` momentáneamente en un ambiente de prueba (no en la casilla real) y confirmar que ahí sí se dispara el envío — para validar que el toggle realmente controla el comportamiento y no quedó cableado a `false` de forma permanente.
3. Volver a dejarlo en `false` para producción real.

## Entregable esperado
- Confirmación de que el toggle existe, es editable desde el panel de Administración, y no está hardcodeado.
- Resultado de la prueba en vivo: ticket creado con datos completos + cero correo saliente confirmado en logs.
- Confirmación de los destinos ajustados por casilla (tabla final: `soporte@`→ticket, `mkbackups@`→document, `notificacionesdeestado@`→document).
- Documentar claramente en `docs/` que este modo es temporal y qué pasos habrá que seguir para desactivarlo cuando se corte Zammad (activar el toggle + revisar que las plantillas de notificación salgan bien redactadas antes de exponerlas a clientes reales).
