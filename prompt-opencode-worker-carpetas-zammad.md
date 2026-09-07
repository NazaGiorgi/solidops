# Prompt para OpenCode — El worker no detecta correos porque Zammad los mueve de carpeta (no solo los marca leídos)

## Contexto crítico para OpenCode

Ya resolvimos el problema de que Zammad marcaba los correos como `\Seen` antes que SolidOps los viera (fix: UID tracking con `BODY.PEEK`, sin depender de `\Seen`). Pero apareció un problema relacionado y más profundo: **Zammad tiene reglas configuradas que mueven/archivan el correo procesado a otra carpeta del buzón**, no solo INBOX. Confirmado por el usuario.

Evidencia: en los logs, el worker de `soporte@` queda estancado en `UID>37046` durante varios ciclos seguidos (13:35 a 13:50), sin detectar nunca el correo nuevo que sí llegó y que Zammad sí procesó (se confirmó visualmente en la interfaz de Zammad). El worker probablemente está buscando únicamente en la carpeta INBOX, y para cuando corre su ciclo, Zammad ya movió el mensaje a otra carpeta.

Seguir la metodología habitual: explicar → investigar con evidencia real → implementar → probar en vivo → verificar que no rompe nada existente → documentar.

**Aclaración de alcance: este cambio es de solo lectura sobre el servidor IMAP.** SolidOps no debe crear, mover, renombrar ni borrar ninguna carpeta del buzón — solo listar las que ya existen y leer su contenido. La creación y organización de carpetas por cliente sigue siendo responsabilidad exclusiva de Zammad, sin ninguna intervención de SolidOps sobre esa estructura.

---

## Parte 1 — Confirmar la carpeta a la que Zammad mueve los correos

**Dato confirmado por el usuario: Zammad organiza los correos procesados en una carpeta por cliente**, no en una única carpeta genérica tipo "Procesados"/"Archive". Esto significa que van a ser decenas o cientos de carpetas (una por cada cliente que tenga Zammad configurado), y esa cantidad va a seguir creciendo con el tiempo. Con este dato, la opción de carpeta específica hardcodeada de la Parte 2 queda descartada de entrada — no tiene sentido mantener una lista manual de carpetas por cliente sincronizada a mano.

- Conectarse por IMAP (con las credenciales ya configuradas de `soporte@`) y listar **todas las carpetas** del buzón (`LIST` o equivalente según la librería usada, ej. `imapflow.list()`), solo para confirmar el patrón (ej. `Clientes/NombreCliente` o similar) y tener una idea del volumen total de carpetas existentes.

## Parte 2 — Estrategia de detección: monitorear todas las carpetas

Dado el volumen (una carpeta por cliente, creciente), la única estrategia viable es:

- El worker de SolidOps debe recorrer **todas las carpetas del buzón** en cada ciclo (INBOX + cada carpeta de cliente), no una lista fija. Al listar las carpetas dinámicamente en cada corrida (o cacheando la lista con refresco periódico, para no listar carpetas en cada ciclo de 5 minutos si el volumen es alto — evaluar el costo real antes de decidir), se cubre automáticamente cualquier carpeta nueva que Zammad cree a futuro sin necesidad de tocar código.
- Mantener un cursor de sincronización **por carpeta** (no uno solo por casilla) — el UID es específico de cada carpeta (`UIDVALIDITY` propio), así que el modelo de `mailbox_sync_state` tiene que soportar `(mailbox_id, folder_name) → last_processed_uid`, no solo `mailbox_id → last_processed_uid`.
- **Crítico — sembrado inicial obligatorio antes de activar el recorrido real:** estas carpetas de cliente ya tienen historial acumulado (meses de correos que Zammad ya procesó normalmente en su momento). Al activar este fix, el primer ciclo debe **sembrar el cursor de cada carpeta al UID más alto existente en ese momento** (igual que se hizo para `soporte@`/`mkbackups@` en el prompt anterior de UID tracking), y no procesar ese historial como si fuera correo nuevo. Si no se hace este paso, el resultado esperado es la creación repentina de un ticket por cada correo histórico en cada carpeta de cliente — un volumen probablemente de cientos o miles de tickets falsos de una sola vez. Confirmar explícitamente en la prueba en vivo que esto no sucede.
- Evaluar el impacto en performance de recorrer muchas carpetas cada 5 minutos — si el volumen de carpetas es alto (cientos), puede convenir espaciar más el ciclo, o paralelizar las consultas IMAP, o alguna otra optimización. Medir antes de asumir que no hay problema.
- Debe seguir sin tocar ni depender de `\Seen` (mantener el fix ya implementado).

## Parte 3 — Implementar y evitar duplicados

- Si un correo se detecta en INBOX y el worker corre de nuevo después de que Zammad lo mueva a la otra carpeta, **no debe procesarse dos veces** como si fueran dos correos distintos. Si la estrategia elegida puede generar ese riesgo (mismo mensaje visto en dos carpetas en momentos distintos), agregar una salvaguarda: usar el `Message-ID` del correo (header estándar, único por mensaje) como chequeo de deduplicación además del UID, ya que el UID cambia si el mensaje cambia de carpeta pero el `Message-ID` no.

## Parte 4 — Prueba en vivo

0. **Antes que nada**, confirmar que el sembrado inicial de cursores (Parte 2) se ejecutó correctamente: revisar que después del primer ciclo con el fix activo, no se haya creado ningún ticket a partir del historial viejo de las carpetas de cliente. Si aparece un volumen alto repentino de tickets nuevos apenas se activa el fix, **detener y revisar antes de seguir** — es la señal de que el sembrado falló.
1. Mandar un correo de prueba nuevo hacia `soporte@`.
2. Esperar a que Zammad lo procese y lo mueva de carpeta (tiempo real, sin apurar el proceso).
3. Confirmar que el worker de SolidOps lo detecta de todas formas, en la carpeta donde haya quedado.
4. Confirmar que no se generó un ticket duplicado si el correo fue visto por el worker tanto en INBOX (antes de que Zammad lo moviera) como en la carpeta destino (después).
5. Confirmar que el flujo de `mkbackups@` y `notificacionesdeestado@` (que no tienen a Zammad de por medio, probablemente) no se vieron afectados por este cambio.

## Entregable esperado
- Patrón de nomenclatura de carpetas confirmado (ej. `Clientes/NombreCliente`) y volumen aproximado de carpetas existentes.
- Estrategia de recorrido de todas las carpetas implementada, con cursor por carpeta (no por casilla).
- Evaluación de performance/costo de recorrer todas las carpetas cada ciclo, con ajuste si hace falta (frecuencia, paralelización, cacheo de listado).
- Resultado de la prueba en vivo de la Parte 4, incluyendo confirmación de que no hay duplicados.
- Documentación actualizada en `docs/MAIL-SYNC-UID.md` explicando este caso y cómo quedó resuelto.
