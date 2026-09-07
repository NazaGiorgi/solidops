# Prompt para OpenCode — Reglas de enrutamiento de email ("cajones") 100% manuales + carga de casillas de ejemplo

## Contexto para OpenCode

SolidOps ya tiene el modelo `MailboxRule` (sender/subject pattern → destino `ticket`/`document`/`discard`) y la entidad `Mailbox` (cifrada con AES-256-GCM vía `CryptoService`). Antes de seguir migrando correo real, necesitamos confirmar que la gestión de reglas es **completamente manual desde la UI** — sin que el usuario final tenga que pedir cambios de código para dar de alta, editar o reordenar una regla.

Seguir la metodología habitual: explicar → implementar → **probar en vivo (no solo compilar)** → verificar que no rompe nada existente → documentar → entregar env vars/compose → recién ahí dar el paso por cerrado.

---

## Parte 1 — Auditar y completar la UI de reglas (`MailboxRule`)

Revisar la pantalla actual de reglas y confirmar/completar que tenga:

1. **Alta manual de regla**, con formulario:
   - Casilla a la que aplica (selector de `Mailbox` existente)
   - Patrón de remitente (soporta wildcard o dominio, ej. `*@mikrotik-alerts.com`)
   - Patrón de asunto (contiene / regex simple, ej. "backup", "SMART", "health check")
   - Destino: `ticket` / `document` / `discard`
   - Prioridad/orden explícito y **editable** (si dos reglas matchean el mismo correo, define cuál gana)
   - Toggle activa/inactiva (sin necesidad de borrar la regla)

2. **Edición y borrado** de reglas existentes desde la misma pantalla, sin tener que reprocesar histórico ni tocar la base de datos a mano.

3. **Regla catch-all por casilla**, editable desde la UI (no hardcodeada en código): todo lo que no matchea ninguna regla específica cae en el destino por defecto de esa casilla.

4. Confirmar que el botón **"crear regla para este remitente"** (ya existe según lo documentado) sigue funcionando y precompleta remitente + casilla correctamente.

5. **Modo de prueba / previsualización** (si no existe, agregarlo): antes de guardar una regla, poder ver contra cuántos correos de los últimos 30 días de esa casilla aplicaría — para evitar que una regla amplia mande de más a `discard` o a un destino equivocado.

Si alguno de estos 5 puntos ya existe, no reescribir de cero — solo confirmar y mostrar evidencia (captura o log) de que funciona.

---

## Parte 2 — Cargar las 3 casillas como ejemplo de referencia

Cargar (o confirmar que ya están cargadas correctamente) estas casillas, con sus reglas iniciales:

### `mkbackups@solidocs.com.ar`
- Host: `c1931856.ferozo.com`
- Regla catch-all → destino `document`
- Sin reglas específicas por ahora (es puro ruido de backups Mikrotik)

### `mesadeayuda@solidocs.com.ar`
- Host: `mail.solidocs.com.ar`
- Regla catch-all → destino `ticket`
- Dejar preparado (pero no obligatorio para esta prueba) el lugar para agregar excepciones a `discard` si aparece ruido automático mezclado

### `soporte@solidocs.com.ar`
- **Mantener en modo sombra** (no desactivar — eso queda pendiente de una decisión aparte, no tocar en este prompt)
- Cargar reglas de prueba sobre el modo sombra para poder validar el enrutamiento contra el correo real que ya está entrando, sin que generen tickets/documentos reales todavía
- Objetivo: que el usuario pueda mirar en la bandeja de "correos sin regla" / vista de simulación cómo se hubieran enrutado, antes de decidir sacarla de modo sombra

---

## Parte 3 — Prueba en vivo pedida

1. Confirmar en el navegador que se puede dar de alta una regla nueva desde cero para `mesadeayuda@` sin ayuda de OpenCode (el usuario la va a probar él mismo).
2. Mandar o simular un correo de prueba a `mkbackups@` y confirmar que aparece como `document`, no como `ticket`.
3. Mostrar cómo se ve la vista de simulación/preview para `soporte@` en modo sombra.
4. Confirmar que el orden de prioridad entre reglas se respeta si se cargan dos reglas que podrían matchear el mismo correo.

## Entregable esperado
- Confirmación de los 5 puntos de la Parte 1 (qué ya existía vs. qué se agregó)
- Las 3 casillas cargadas con sus reglas iniciales, visibles en la UI
- Capturas o logs de las 4 pruebas de la Parte 3
- Cualquier env var nueva agregada a `backend/.env` documentada
