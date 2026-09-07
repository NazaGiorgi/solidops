# Prompt para OpenCode — Agregar sección SMTP a la pantalla de Casillas de correo (hoy solo tiene IMAP)

## Contexto crítico para OpenCode

Se descubrió en vivo que la pantalla de "Casillas de correo" (Administración → Casillas) **solo tiene campos de IMAP** (Servidor IMAP, Usuario IMAP, Puerto, SSL) — no existe ningún campo separado para SMTP. Esto confirma el diagnóstico anterior de por qué `soporte@` nunca tuvo SMTP cargado: no es que faltaran las credenciales, es que la UI nunca tuvo dónde cargarlas.

**Incidente relacionado, para que quede documentado:** el usuario, al no ver campos de SMTP, intentó cambiar el puerto del campo IMAP existente de 993 a 587 (puerto de envío), lo cual generó `ERR_SSL_WRONG_VERSION_NUMBER` al probar conexión. **No se guardó ese cambio.** Confirmar que el puerto IMAP de `soporte@` sigue en su valor correcto (993, SSL sí) después de este incidente, por las dudas.

Seguir la metodología habitual: explicar → implementar → probar en vivo → verificar que no rompe nada existente (especialmente: que el flujo de IMAP/UID-tracking que ya funciona no se vea afectado) → documentar → entregar env vars/compose.

---

## Parte 1 — Separar visualmente IMAP y SMTP en el formulario

- En la pantalla de "Editar casilla" (y "Agregar casilla"), dividir claramente en dos secciones diferenciadas: **"Entrada (IMAP)"** y **"Salida (SMTP)"** — no deben poder confundirse ni mezclarse visualmente como está hoy.
- Sección SMTP nueva, con:
  - Servidor SMTP (host)
  - Puerto
  - Usuario SMTP
  - Contraseña SMTP (cifrada igual que la de IMAP, vía `CryptoService`)
  - Tipo de seguridad: selector explícito entre **STARTTLS** (típico en puerto 587) y **SSL/TLS implícito** (típico en puerto 465) — no un solo campo "SSL: sí/no" ambiguo como el que ya existe para IMAP, porque son mecanismos distintos y por eso se dio el error de la prueba anterior (puerto 587 espera STARTTLS, no un handshake SSL directo).
  - Los campos SMTP son opcionales al crear/editar una casilla (una casilla puede tener solo IMAP si todavía no se configuró el envío, como es el caso actual de las demás casillas).

## Parte 2 — "Probar conexión" debe testear cada protocolo por separado

- El botón actual de "probar conexión" hoy prueba IMAP. Agregar un botón separado "Probar SMTP" que testee específicamente el envío (handshake STARTTLS/SSL según corresponda, sin necesariamente mandar un correo real todavía) — para que un error de configuración de SMTP no se confunda con uno de IMAP, como pasó en el incidente de esta sesión.
- Mensajes de error específicos por protocolo, no genéricos.

## Parte 3 — Migrar datos existentes sin romper nada

- Confirmar que las casillas ya cargadas (`soporte@`, `mkbackups@`, `notificacionesdeestado@`) mantienen su configuración IMAP intacta después de este cambio — no debe haber ninguna migración destructiva de esos datos.
- Los campos SMTP quedan vacíos para todas hasta que se carguen manualmente.

## Parte 4 — Prueba en vivo

1. Confirmar que el formulario de `soporte@` ahora muestra la sección SMTP vacía, sin haber tocado el IMAP existente (que sigue funcionando con el UID tracking).
2. Cargar los datos SMTP de `soporte@` de prueba: host `c1931856.ferozo.com`, puerto `587`, seguridad `STARTTLS`, usuario y contraseña (el usuario los va a cargar él mismo, con las credenciales reales que consiga del panel de su hosting).
3. Usar el botón "Probar SMTP" y confirmar que el handshake se completa (o mostrar el error real y específico si falla).
4. Confirmar que el flujo de ingesta IMAP sigue funcionando con normalidad después de todo el cambio (no regresión).

## Entregable esperado
- Formulario con secciones IMAP/SMTP claramente separadas, con selector de tipo de seguridad explícito para SMTP.
- Botón "Probar SMTP" funcionando con mensajes de error específicos.
- Confirmación de que no se rompió nada del flujo de IMAP existente.
- Confirmación de que el puerto IMAP de `soporte@` sigue correcto (993) tras el incidente de esta sesión.
