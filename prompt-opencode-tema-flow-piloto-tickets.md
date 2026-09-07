# Prompt para OpenCode — Sistema de tema visual intercambiable: "SolidOps Classic" (actual) vs. "SolidOps Flow" (nuevo, estilo Zendesk) — piloto en Tickets

## Contexto crítico para OpenCode

El usuario quiere un rediseño visual grande, inspirado en la estética de Zendesk: más simple, más denso/dinámico, filas de lista compactas en vez de tarjetas grandes, sidebar de íconos, colores sutiles. Referencia visual acordada con el usuario:

- Filas de lista compactas: un punto de color chico (no un badge grande) indicando prioridad/urgencia, título en negrita, línea de metadata chica debajo (cliente + tiempo), badge de estado sutil a la derecha.
- Más densidad de información visible por pantalla, menos espacio "de aire" entre elementos que el diseño actual.

**Decisión clave de arquitectura (backup en vivo, no solo backup de archivos)**: en vez de reemplazar el diseño actual, implementar un **sistema de dos temas intercambiables** con un toggle visible para el usuario:
- **"SolidOps Classic"**: el diseño actual, sin cambios.
- **"SolidOps Flow"**: el diseño nuevo inspirado en Zendesk.

El usuario debe poder cambiar entre ambos con un botón/switch, en cualquier momento, sin perder datos ni funcionalidad — es un cambio puramente visual. Esto es más seguro que solo un backup de código, porque permite volver atrás instantáneamente si algo no convence, sin intervención técnica.

**Alcance de este prompt — SOLO Tickets como piloto**: no tocar Documentos, Notas, Agenda, Taller, Clientes todavía. Confirmar que el mecanismo de temas funciona bien en una sola sección antes de expandirlo al resto en un prompt futuro.

**Garantía dura, no negociable**: bajo NINGUNA circunstancia el cambio de tema debe hacer que se pierda acceso a alguna opción, botón, o funcionalidad que hoy existe en cualquier parte de la plataforma — ni en Tickets, ni en el resto de la app. Si en algún momento del desarrollo se detecta que el tema "Flow" oculta o dificulta acceder a algo que "Classic" sí muestra, detenerse y corregirlo antes de continuar, o directamente no aplicar ese cambio visual puntual. La app debe ser 100% funcional en ambos temas, siempre, sin excepción.

Seguir la metodología habitual: explicar → backup fresco → diseñar la arquitectura del sistema de temas → implementar el piloto en Tickets → probar en vivo (incluyendo cambiar de tema ida y vuelta) → verificar que no rompe nada existente → documentar.

---

## Parte 0 — Backup fresco (obligatorio antes de tocar código)

- Backup de `ops_msp` (aunque este cambio es solo visual y no debería tocar datos, hacerlo de todas formas por precaución).
- Confirmar el estado actual del código en git/control de versiones si el proyecto lo usa, o backup de archivos como se hizo en cambios anteriores de esta sesión.

## Parte 1 — Diseñar la arquitectura del sistema de temas

- La forma más segura y mantenible: usar variables CSS (custom properties) para todos los valores de diseño (colores, espaciado, tamaños de fuente) que ya se usan en el proyecto, y definir un segundo set de valores para "Flow" activado mediante un atributo en el `<html>` o `<body>` (ej. `data-theme="flow"` vs `data-theme="classic"` o sin atributo = classic por defecto).
- El toggle debe guardar la preferencia del usuario (ej. en `localStorage` del navegador, o en la configuración del usuario en la base de datos si se prefiere que persista entre dispositivos — decidir cuál es más simple de implementar de forma segura y proponerlo).
- Confirmar este diseño de arquitectura antes de escribir el CSS del tema "Flow" en sí — es la base que va a soportar todo el resto del rediseño en prompts futuros.

## Parte 2 — Implementar el toggle y el tema "Flow" para Tickets

- Agregar el control de cambio de tema en un lugar accesible (ej. cerca del usuario logueado en el sidebar, o en Configuración) — con las etiquetas "SolidOps Classic" y "SolidOps Flow".
- Aplicar el diseño "Flow" únicamente a la pantalla de listado de Tickets: filas compactas con punto de color por prioridad, título en negrita, metadata chica debajo, badge de estado sutil a la derecha — reemplazando las tarjetas grandes actuales cuando el tema Flow esté activo.
- El resto de la app (Documentos, Notas, Agenda, Taller, Clientes, sidebar general) debe seguir viéndose exactamente igual que hoy, sin importar qué tema esté seleccionado — el cambio de tema en este prompt solo afecta la lista de Tickets.

## Parte 3 — Prueba en vivo

1. Confirmar que el toggle aparece y es fácil de encontrar.
2. Cambiar a "SolidOps Flow" y confirmar que la lista de Tickets se ve con el diseño nuevo (compacto, denso).
3. Confirmar que el resto de la app (Documentos, Agenda, etc.) sigue igual que siempre con el tema Flow activado — no se rompió nada fuera de Tickets.
4. Volver a "SolidOps Classic" y confirmar que la lista de Tickets vuelve exactamente a como se veía antes, sin ningún resabio visual del tema Flow.
5. Confirmar que hacer clic en un ticket, filtrar, buscar, y todas las funcionalidades ya existentes de la lista de Tickets siguen funcionando igual de bien en ambos temas — el cambio es solo visual, cero cambios funcionales.
6. Recargar la página (F5) y confirmar que el tema elegido se mantiene (no vuelve a Classic por defecto sin que el usuario lo pida).
7. Con el tema Flow activo, recorrer TODA la app (Documentos, Notas, Agenda, Taller, Clientes, Administración, portal de clientes) y confirmar explícitamente que absolutamente ninguna opción, botón, o funcionalidad quedó inaccesible o rota — todo debe verse y funcionar igual que con Classic en esas secciones no tocadas.

## Entregable esperado
- Backup fresco confirmado.
- Sistema de temas intercambiables implementado (arquitectura reusable para expandir a otras secciones después).
- Tema "SolidOps Flow" aplicado solo a la lista de Tickets, con el toggle funcionando.
- Confirmación de las 6 pruebas en vivo.
- Documentación de cómo funciona el sistema de temas, para que sea fácil expandirlo a otras secciones en un prompt futuro.
