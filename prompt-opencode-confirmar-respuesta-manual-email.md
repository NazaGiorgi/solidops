# Prompt para OpenCode — [PARA MÁS ADELANTE, antes de cortar Zammad] Confirmar que responder un ticket manualmente dispara email real al cliente

## Contexto para OpenCode

**No correr este prompt todavía** — es para cuando se esté por activar `emailAutoResponseEnabled = true` y cortar Zammad definitivamente, no antes (mientras Zammad siga operando, esto generaría el problema de doble respuesta ya visto).

El usuario necesita confirmar, antes de depender de esto en producción, que cuando un técnico responde manualmente un ticket desde el panel de SolidOps (no una notificación automática de cambio de estado, sino texto libre escrito por el técnico), esa respuesta:
1. Se envía por email real al contacto del cliente (usando el SMTP ya confirmado funcionando de `soporte@`).
2. El contenido del email es el texto real que escribió el técnico, no una plantilla genérica.
3. Esto solo debe dispararse cuando `emailAutoResponseEnabled` esté en `true` — confirmar que con el toggle en `false` (como está hoy) una respuesta manual NO dispara ningún email, para no generar sorpresas antes de tiempo.
4. Si el ticket también es accesible desde el portal de clientes, la respuesta debe aparecer ahí también (esto ya se probó en Fase 1, solo confirmar que sigue funcionando).

Seguir la metodología habitual: explicar → investigar con evidencia real → confirmar o corregir si falta conectar algo → probar en vivo → documentar.

---

## Parte 1 — Investigar el camino actual

- Revisar el código del endpoint/servicio que maneja la respuesta manual de un técnico a un ticket (probablemente `POST /tickets/:id/messages` u equivalente).
- Confirmar si ese camino ya dispara un envío de email condicionado al toggle `emailAutoResponseEnabled`, o si nunca se conectó (ya que hasta ahora el foco estuvo en las notificaciones automáticas de cambio de estado, no en la respuesta manual).

## Parte 2 — Conectar si falta

- Si no está conectado, implementarlo: al guardar una respuesta manual de un técnico en un ticket con contacto de email conocido, y con el toggle en `true`, enviar un email real con el contenido de la respuesta.
- Reusar el servicio de envío SMTP ya confirmado funcionando (el mismo que se probó con el correo de prueba a `soporte@`).

## Parte 3 — Prueba en vivo

1. Con el toggle en `false` (default actual), responder un ticket de prueba manualmente y confirmar que NO sale ningún email (revisando logs).
2. En un ambiente de prueba, activar el toggle temporalmente, responder un ticket de prueba con un contacto de email real controlado por el usuario, y confirmar que el email llega con el contenido exacto escrito.
3. Confirmar que si el ticket es también visible en el portal de clientes, la respuesta aparece ahí también.
4. Volver a dejar el toggle en `false` al terminar la prueba.

## Entregable esperado
- Confirmación de si el camino ya estaba conectado o hubo que implementarlo.
- Prueba en vivo de las 4 partes de la Parte 3.
- Confirmación de que el toggle en `false` bloquea correctamente el envío, evitando sorpresas antes del corte de Zammad.
