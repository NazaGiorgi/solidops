# Prompt para OpenCode — Confirmar que el SMTP de `soporte@solidocs.com.ar` funciona de verdad

## Contexto para OpenCode

Este es el punto 3 pendiente desde hace varias sesiones (sección 5.2 del resumen de continuidad del proyecto): nunca se confirmó si los campos SMTP (no solo IMAP) quedaron bien cargados al configurar la casilla `soporte@solidocs.com.ar`, ni si un correo saliente desde esa casilla realmente sale. Esto es una condición previa antes de avanzar con el envío real de auto-respuestas (plantillas ya armadas en un prompt aparte, no implementar acá) — no tiene sentido construir sobre un SMTP sin probar.

Seguir la metodología habitual: explicar → investigar/probar con evidencia real → documentar. No implementar plantillas ni activar el toggle `emailAutoResponseEnabled` en este prompt — es exclusivamente para confirmar que el transporte SMTP funciona.

---

## Parte 1 — Confirmar la configuración guardada

- Revisar en la entidad `Mailbox` (o donde esté guardada la config de `soporte@`) que los campos SMTP estén completos: host, puerto, usuario, contraseña (cifrada), y si corresponde TLS/SSL según el puerto.
- Confirmar que no está reutilizando por error la config IMAP como si fuera SMTP (son credenciales y a veces hosts distintos, aunque sea la misma casilla de correo).
- Si falta algún campo, señalarlo con claridad antes de seguir — no asumir valores.

## Parte 2 — Prueba de envío real

- Enviar un correo de prueba real desde `soporte@solidocs.com.ar` hacia una casilla de destino controlada (usar el mismo `nazareno.giorgi@gmail.com` que se usó en la prueba de ingesta anterior, o la que el usuario indique).
- El asunto y cuerpo deben dejar en claro que es una prueba técnica (ej. "Prueba de envío SMTP — SolidOps — ignorar"), para no confundir a nadie si algo queda mal filtrado.
- Confirmar en los logs del backend que el envío se completó sin error (código de respuesta del servidor SMTP), y no solo que la función se ejecutó sin excepción.
- Confirmar del lado receptor (el usuario revisa la bandeja de `nazareno.giorgi@gmail.com` o la que se use) que el correo efectivamente llegó, y revisar si cayó en spam.

## Parte 3 — Si falla

- Si el envío falla, capturar el error real del servidor SMTP (código y mensaje, no un genérico "Command failed" como pasó antes con el `ImapService` — aplicar el mismo estándar de logging detallado).
- No intentar arreglarlo a ciegas probando puertos al azar — si el error es de autenticación, credenciales, o TLS, documentar la causa probable con evidencia y dejarlo para que el usuario confirme la configuración correcta contra el panel de su proveedor de hosting, igual que se hizo con el host IMAP de `mesadeayuda@`.

## Entregable esperado
- Confirmación de que la config SMTP de `soporte@` está completa (o qué falta, si falta algo).
- Resultado de la prueba real de envío: llegó / no llegó, con evidencia de ambos lados (log de envío + confirmación de recepción).
- Si falló, causa raíz documentada con el error real del servidor, no una suposición.
- No se implementa nada de plantillas ni se toca el toggle de auto-respuesta en este prompt — es solo diagnóstico de transporte.
