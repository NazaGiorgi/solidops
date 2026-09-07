# Prompt para OpenCode — Falso positivo confirmado: cliente "Mercedes" absorbiendo negocios no relacionados

## Contexto crítico para OpenCode

Confirmado con el usuario: el `Customer` "Mercedes" en la base (contacto `ebasualdo@mercedes.gob.ar`) es el **Municipio/Gobierno de Mercedes**. Las carpetas `Elec-Tra Mercedes` y `Rodamientos Mercedes` que matchearon contra él (score 0.500/0.667) **no tienen relación con el municipio** — son negocios privados distintos que simplemente están ubicados en la ciudad de Mercedes, y "Mercedes" en sus nombres es el nombre de la ciudad, no una referencia al cliente municipal.

Es el mismo patrón de falso positivo que el caso "Empresas"/"backups" — una palabra común (en este caso, un nombre de ciudad muy frecuente en las carpetas del usuario) generando matches sin relación real de identidad.

**Contexto adicional del usuario, importante para calibrar el fix**: no le preocupa que carpetas queden sin match perfecto (van a "Recursos generales" y las ubica manualmente sin problema) — lo que sí le importa es evitar que el contenido de un negocio termine mezclado en la ficha de un cliente que no le corresponde.

Seguir la metodología habitual: explicar → implementar → probar en vivo → verificar que no rompe nada existente → documentar.

---

## Parte 1 — Corregir el caso puntual

- `Elec-Tra Mercedes` y `Rodamientos Mercedes` (activa e inactiva) deben ir a "Recursos generales", no al cliente "Mercedes".

## Parte 2 — Proteger contra el patrón general (nombres de ciudad/palabra común como cliente)

- El problema de fondo: cuando un `Customer` tiene un nombre corto que coincide con una palabra muy frecuente en los nombres de carpeta (nombres de ciudad, palabras genéricas como "empresas"), el algoritmo de similitud por tokens/contención es propenso a falsos positivos, porque esa palabra sola ya cruza el umbral de score sin que el resto del nombre de la carpeta tenga relación real.
- Evaluar un ajuste general (no solo para este caso puntual): cuando el nombre del `Customer` candidato es corto (una o dos palabras) y esa coincidencia es la única señal de similitud (el resto del nombre de la carpeta no se parece en nada al cliente), exigir un umbral más alto que el estándar 0.5, o requerir que el nombre del cliente aparezca como una porción proporcionalmente grande del nombre de la carpeta, no solo como una palabra suelta entre varias.
- Alternativa complementaria: mantener una lista de "nombres ambiguos conocidos" (nombres de ciudad, palabras genéricas) que requieran confirmación humana explícita antes de aceptarse como match automático, en vez de aplicarse solo. "Mercedes" debería sumarse a esa lista junto con "Empresas".
- Priorizar que el ajuste no vuelva a introducir el problema opuesto (perder matches legítimos que sí correspondían) — el objetivo es specificamente frenar coincidencias basadas en una sola palabra común, no volverse más estricto en general.

## Parte 3 — Prueba en vivo

1. Correr el dry-run de nuevo sobre la carpeta real completa y confirmar que `Elec-Tra Mercedes` y `Rodamientos Mercedes` ahora van a "Recursos generales", no a "Mercedes".
2. Confirmar que los matches legítimos de otros clientes con nombres cortos (si los hay) siguen funcionando — no se rompió nada por volverse más estricto.
3. Mostrar el reporte actualizado con el conteo final de "con cliente" vs "Recursos generales" tras este ajuste.

## Entregable esperado
- Fix aplicado para el caso puntual de "Mercedes".
- Ajuste general documentado para prevenir el mismo patrón con otros nombres cortos/ambiguos a futuro.
- Nuevo dry-run confirmando el resultado corregido.

---

## Parte 4 — Agregar filtro/búsqueda por nombre en la pantalla de Clientes

Con 416 clientes cargados, la pantalla de Clientes no tiene forma de filtrar por nombre — hay que buscar a mano scrolleando toda la lista, lo cual es poco práctico dado el volumen.

- Agregar un campo de búsqueda/filtro por nombre en la parte superior del listado de Clientes, que filtre en tiempo real (o con un pequeño debounce) a medida que se escribe, sin necesidad de apretar un botón "buscar" aparte.
- La búsqueda debe ser insensible a mayúsculas/minúsculas y tildes (mismo criterio de normalización ya usado en el matching de la migración documental), para que no haga falta escribir el nombre exacto con acentos correctos.
- Si ya existe un filtro de estado activo/inactivo u otro filtro en esa pantalla (parte del CRUD de Clientes ya armado o en curso), el nuevo campo de búsqueda debe combinarse con esos filtros existentes, no reemplazarlos.
- Prueba en vivo: escribir un nombre parcial de un cliente real (ej. "merce" para encontrar variantes de "Mercedes") y confirmar que el listado se filtra correctamente y de forma instantánea, sin necesidad de recargar la página.

### Entregable adicional
- Campo de búsqueda por nombre funcionando en la pantalla de Clientes, combinable con filtros existentes.
- Confirmación de la prueba en vivo de búsqueda parcial.
