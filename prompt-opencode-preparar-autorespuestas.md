# Prompt para OpenCode — Preparar auto-respuestas al cliente (dejar listas, sin activar)

## Contexto para OpenCode

SolidOps ya tiene el toggle `emailAutoResponseEnabled` (implementado en el prompt de "modo acumulación silenciosa"), hoy en `false` porque Zammad sigue siendo la cara visible ante el cliente. Este prompt es para **dejar armadas las auto-respuestas que se van a usar el día que se active ese toggle** — no para activarlo ahora. Al terminar este trabajo, el toggle sigue en `false`; solo queda todo listo para cuando se decida prenderlo.

Seguir la metodología habitual: explicar → implementar → probar en vivo (en modo de prueba, sin mandar nada a clientes reales) → documentar.

---

## Parte 1 — Definir los eventos que disparan auto-respuesta

Implementar plantillas para estos momentos del ciclo de vida de un ticket, cada una como una plantilla editable (no texto hardcodeado en el código):

1. **Ticket recibido** — se dispara apenas se crea el ticket a partir de un correo entrante. Confirma al cliente que su mensaje llegó y quedó registrado, con el número de ticket para que pueda hacer referencia a futuro.
2. **Ticket tomado por un técnico** — se dispara cuando el ticket pasa de "sin asignar" a tener un técnico responsable. Avisa al cliente que alguien del equipo ya está viendo su caso (sin necesariamente decir el nombre del técnico, a definir si se quiere personalizar o mantenerlo genérico).
3. **Ticket resuelto/cerrado** — se dispara al cambiar el estado a resuelto o cerrado. Confirma que se dio por solucionado y deja abierta la puerta a que el cliente responda si el problema persiste (lo cual debería reabrir el ticket, no crear uno nuevo).
4. (Opcional, marcar como fuera de alcance si no se pide ahora) **Nueva respuesta del técnico en el hilo** — si un técnico responde por fuera del cierre del ticket, notificar al cliente de que hay una respuesta nueva.

Cada plantilla debe soportar variables dinámicas como mínimo: nombre del cliente/contacto, número de ticket, asunto original, y (donde aplique) nombre del técnico asignado.

## Parte 2 — Editable desde el panel de Administración

- Las plantillas no deben quedar hardcodeadas en el backend — tienen que poder editarse desde la UI (texto y asunto del correo), en la misma línea de "Configuración general" del panel de Administración ya existente, para que el usuario pueda ajustar la redacción sin pedir cambios de código cada vez.
- Dejar un texto por defecto razonable y profesional en español rioplatense, en tono cordial pero no informal, como punto de partida editable. Ejemplo de tono esperado para "ticket recibido": confirmar recepción, dar el número de ticket, aclarar que un técnico lo va a tomar a la brevedad — sin prometer tiempos específicos de SLA en el texto por defecto (el usuario puede agregarlo después si quiere, pero no asumir compromisos de tiempo en el texto base).

## Parte 3 — Respetar el modo silencioso actual

- Aunque se implementen las plantillas y el disparo de eventos, **mientras `emailAutoResponseEnabled` siga en `false`, no debe salir ningún correo real** — el envío tiene que quedar condicionado a ese mismo toggle que ya existe, no crear un mecanismo separado.
- Probar esto en vivo: con el toggle en `false`, generar los 3 eventos (recibido, tomado, resuelto) sobre un ticket de prueba y confirmar en los logs del servicio de envío que no se disparó nada.
- Solo después, en un ambiente de prueba (no sobre `soporte@` real), activar el toggle temporalmente y confirmar que ahí sí se generan y envían los 3 tipos de correo con las variables correctamente reemplazadas (número de ticket real, nombre real, etc. — no placeholders sin reemplazar).
- Volver a dejar el toggle en `false` al terminar la prueba.

## Parte 4 — Evitar el problema de doble respuesta con Zammad

- Documentar explícitamente en `docs/` que estas plantillas **no deben activarse mientras Zammad siga operando la misma casilla**, para no repetir el problema ya visto (el cliente recibiendo dos confirmaciones distintas del mismo mail). Dejar esto como nota clara en la documentación, no solo como algo implícito.

## Entregable esperado
- 3 plantillas implementadas (recibido / tomado / resuelto), editables desde el panel de Administración, con variables dinámicas funcionando.
- Confirmación en vivo de que con el toggle en `false` no sale nada, y que activándolo en modo prueba sí funciona correctamente.
- Documentación clara de que la activación real debe esperar al corte de Zammad, no antes.
- Sin tocar el estado actual del toggle en producción (queda en `false` al finalizar).
