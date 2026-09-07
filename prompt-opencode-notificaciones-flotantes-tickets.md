# Prompt para OpenCode — Notificaciones flotantes (toast) cuando llega un ticket nuevo, estilo Zammad

## Contexto para OpenCode

El usuario quiere que SolidOps muestre una notificación flotante (tipo "toast", una cajita que aparece en una esquina de la pantalla y desaparece sola después de unos segundos) cada vez que llega un ticket nuevo, similar al comportamiento de Zammad.

Ya existe en el proyecto una conexión de WebSocket (`useNotificationsSocket`, vista en los logs de consola durante esta sesión) usada para notificaciones — investigar primero qué tan armada está esa base antes de construir algo nuevo desde cero.

Seguir la metodología habitual: explicar → investigar qué ya existe → implementar solo lo que falte → probar en vivo → verificar que no rompe nada existente → documentar.

---

## Parte 1 — Investigar la base existente

- Revisar `useNotificationsSocket` y el servidor de WebSocket del backend: ¿ya emite algún evento cuando se crea un ticket nuevo? ¿Para todos los tickets, o solo para algunos casos (ej. solo los asignados al usuario actual)?
- Confirmar si ya existe algún componente de "toast"/notificación flotante en el proyecto (usado para otra cosa, ej. confirmaciones de acciones) que se pueda reutilizar, o si hay que crear uno nuevo.
- Confirmar el comportamiento esperado: ¿la notificación debe mostrarse para TODOS los tickets nuevos que entran al sistema (de cualquier bandeja), o solo para ciertas bandejas (ej. no tiene sentido alertar de cada uno de los miles de "Backups MK", pero sí de L1/L2/L3/Nativos)? Si no está claro, preguntarle al usuario antes de implementar, ya que definir mal el alcance puede generar spam de notificaciones inútil.

## Parte 2 — Implementar

- Si falta, emitir un evento de WebSocket desde el backend cuando se crea un ticket nuevo (respetando el alcance acordado en la Parte 1 — probablemente excluyendo bandejas de puro ruido como Backups MK/Notificaciones de RED, salvo que el usuario diga lo contrario).
- En el frontend, al recibir ese evento, mostrar una notificación flotante con: título del ticket, cliente (si tiene), y un enlace/clic que lleve directo al ticket.
- La notificación debe aparecer sin importar en qué pantalla esté el usuario (mientras tenga la app abierta), no solo en la pantalla de Tickets.
- Debe desaparecer sola después de unos segundos (ej. 6-8 segundos), pero permitir cerrarla manualmente antes si el usuario quiere.

## Parte 3 — Prueba en vivo

1. Crear un ticket de prueba nuevo (desde el portal de cliente, o simulando un correo entrante) y confirmar que aparece la notificación flotante en la pantalla, sin importar en qué sección de la app esté el usuario en ese momento.
2. Hacer clic en la notificación y confirmar que lleva directo al ticket correspondiente.
3. Confirmar que la notificación desaparece sola después de unos segundos.
4. Confirmar que un ticket nuevo de una bandeja excluida (si se acordó excluir alguna) NO genera notificación, para evitar spam.

## Entregable esperado
- Confirmación de qué parte de la infraestructura de WebSocket ya existía vs. qué se implementó nuevo.
- Notificación flotante funcionando según el alcance acordado.
- Confirmación de las 4 pruebas en vivo.
