# Prompt para OpenCode — Los tickets creados desde correo entrante no muestran el contenido del mensaje

## Contexto para OpenCode

Confirmado en vivo: varios tickets creados automáticamente a partir de correo entrante (`soporte@`) aparecen en SolidOps con el ticket correcto (cliente, asunto, remitente, fecha), pero **la sección de Conversación queda vacía** — se ve la cabecera del mensaje (`cliente · email · hora · remitente`) pero no el cuerpo del correo. Confirmado que pasa con más de un correo, no es un caso aislado de un formato particular.

Ejemplo del caso visto: ticket `d854dd6f-ad89-4a39-a77f-ad82764b8d45`, asunto "correcto: COMERC - CARPETA RAIZ + CARPETA APLIC en Server", remitente `backup.clientes@solidocs.com.ar` (correo automático de backup) — pero el usuario confirma que el problema se repitió con otros correos también, no solo con notificaciones automáticas.

Seguir la metodología habitual: explicar → investigar con evidencia real → implementar el fix → probar en vivo → verificar que no rompe nada existente → documentar.

---

## Parte 1 — Reproducir y diagnosticar la causa real

- Revisar el flujo completo desde que el `MailboxWorker` lee el mensaje por IMAP hasta que se guarda el `Message` asociado al ticket: ¿en qué punto se pierde el contenido?
- Candidatos a revisar, sin asumir cuál es antes de confirmar con evidencia (logs, inspección de datos):
  - **Extracción del cuerpo del correo**: si el parser busca específicamente `text/plain` y el correo solo trae `text/html` (o viceversa), puede estar quedando vacío en vez de caer al otro formato disponible. Revisar qué librería se usa para parsear el MIME del mensaje (`mailparser` u otra) y confirmar que intenta ambos formates con fallback.
  - **Correos multipart mal manejados**: si el mensaje tiene múltiples partes (texto + HTML + adjuntos) y el parser no está iterando correctamente todas las partes.
  - **Contenido guardándose pero no renderizándose**: verificar directamente en la base de datos si el campo de contenido del `Message` está realmente vacío, o si tiene datos pero el frontend no los está mostrando (esto cambiaría completamente el diagnóstico — confirmar con una consulta SQL directa antes de asumir que es un problema de parsing).
  - **Sanitización agresiva**: si hay algún paso de sanitización de HTML (por seguridad, para evitar XSS al mostrar correos de terceros) que esté vaciando el contenido en vez de solo limpiar tags peligrosos.
- Revisar con al menos 2-3 de los correos ya recibidos que tienen este problema (no solo el ticket `d854dd6f`), para confirmar que la causa es la misma en todos los casos y no hay más de un bug mezclado.

## Parte 2 — Implementar el fix

- Una vez confirmada la causa real, implementar el fix correspondiente.
- Si el fix es de extracción/parsing, debe soportar razonablemente los formatos comunes de correo entrante: texto plano simple, HTML simple, HTML con tablas (común en notificaciones automáticas de sistemas), y multipart con adjuntos.
- Si hay sanitización de HTML por seguridad, mantenerla (no eliminar esa protección) pero corregirla para que no vacíe contenido legítimo — debe seguir removiendo scripts/tags peligrosos, pero preservar el texto/estructura visible del mensaje.

## Parte 3 — Reprocesar los tickets ya afectados

- Los tickets que ya se crearon con este bug (contenido vacío) van a seguir vacíos aunque se arregle el bug hacia adelante — el correo original ya se procesó y avanzó el cursor UID, no se va a volver a leer solo.
- Evaluar con el usuario si conviene un script puntual para reprocesar esos mensajes específicos (releer el correo original del servidor por su `Message-ID` o UID guardado, si quedó registrado en algún lado, y volver a extraer el cuerpo con el parser corregido) — sin tener que resetear el cursor de todo el buzón (lo cual reprocesaría todo de nuevo, no solo los afectados).

## Parte 4 — Prueba en vivo

1. Mandar un correo de prueba nuevo con texto plano simple y confirmar que el contenido aparece completo en la conversación del ticket.
2. Mandar un correo de prueba en HTML (puede simularse, o aprovechar que las notificaciones automáticas de backup ya llegan en ese formato) y confirmar que también se ve el contenido, no vacío.
3. Confirmar en base de datos (consulta directa) que el campo de contenido del `Message` tiene el texto real, no solo que se ve bien en la UI.
4. Confirmar que ticket `d854dd6f` (u otro de los ya afectados) se puede reprocesar y termina mostrando su contenido real.

## Entregable esperado
- Causa raíz confirmada con evidencia (no supuesta).
- Fix implementado y probado con al menos 2 formatos distintos de correo (texto plano y HTML).
- Plan de reprocesamiento de los tickets ya afectados, ejecutado o dejado listo para correr con aprobación del usuario.
- Documentación de la causa y el fix en `docs/MAIL-SYNC-UID.md` o el doc correspondiente.
