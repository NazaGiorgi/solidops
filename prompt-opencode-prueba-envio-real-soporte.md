# Prompt para OpenCode — Prueba de envío real desde `soporte@solidocs.com.ar` (SMTP ya confirmado)

## Contexto para OpenCode

El usuario ya cargó las credenciales SMTP reales de `soporte@solidocs.com.ar` en la UI (host `c1931856.ferozo.com`, puerto 587, STARTTLS) y el botón "Probar SMTP" (`nodemailer.verify()`) dio **conexión exitosa** — el handshake y la autenticación funcionan. Este es el último paso: confirmar que un correo enviado de verdad sale del servidor y llega a destino, cerrando el pendiente histórico de "SMTP de soporte@ sin confirmar" que se arrastraba desde varias sesiones atrás.

**No activar el toggle `emailAutoResponseEnabled` en este prompt** — sigue en modo acumulación silenciosa. Este envío es una prueba manual y puntual, no debe quedar disparándose de forma automática ni repetirse en cada ingesta de correo.

Seguir la metodología habitual: explicar → implementar → probar en vivo con evidencia real → documentar.

---

## Parte 1 — Enviar el correo de prueba real

- Enviar un único correo real desde `soporte@solidocs.com.ar` hacia `nazareno.giorgi@gmail.com`.
- Asunto: `Prueba de envío SMTP — SolidOps — ignorar`
- Cuerpo: algo simple que dejе claro que es una prueba técnica, con fecha/hora de envío incluida en el texto para poder correlacionar con el log.
- Esto debe hacerse con un script o endpoint de prueba puntual (no reusar el flujo de auto-respuestas, que no está implementado todavía, ni el modo acumulación) — algo mínimo que solo llame al transporte SMTP ya configurado y mande ese correo puntual.

## Parte 2 — Confirmar el envío del lado del servidor

- Capturar en los logs del backend el código de respuesta del servidor SMTP tras el envío (ej. `250 OK` o equivalente) — no alcanza con que la función no tire una excepción, hay que ver la confirmación real que devuelve el servidor.
- Si el servidor devuelve algo distinto a una confirmación de aceptación, documentar el código y mensaje exacto.

## Parte 3 — Confirmar del lado del receptor

- El usuario va a revisar manualmente la bandeja de `nazareno.giorgi@gmail.com` (incluida la carpeta de spam) para confirmar la llegada real — esto no lo puede hacer OpenCode, así que dejar la instrucción clara de qué debe revisar el usuario y esperar su confirmación antes de dar el punto por cerrado.

## Entregable esperado
- Confirmación del código de respuesta del servidor SMTP al enviar (evidencia de log).
- Instrucción clara para que el usuario confirme la recepción real del lado de Gmail.
- Confirmación explícita de que el toggle `emailAutoResponseEnabled` sigue en `false` y no se disparó ningún otro envío además de este correo puntual de prueba.
- Una vez confirmada la recepción por el usuario, este prompt cierra el pendiente histórico de "SMTP de soporte@ sin confirmar" — documentarlo así en `docs/MAIL-ACUMULACION.md` o el doc correspondiente.
