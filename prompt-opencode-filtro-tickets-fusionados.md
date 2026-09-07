# Prompt para OpenCode — Agregar filtro para buscar tickets fusionados

## Contexto para OpenCode

En la pantalla de listado/filtros de Tickets, hoy no hay forma de filtrar específicamente por tickets que fueron fusionados (padres con tickets hijo fusionados, o los hijos que quedaron fusionados a un padre). Agregar esa opción a los filtros existentes.

Seguir la metodología habitual: explicar → implementar → probar en vivo → verificar que no rompe nada existente → documentar.

---

## Parte 1 — Aclarar el alcance antes de implementar

Antes de tocar código, confirmar con evidencia del modelo de datos actual (`Ticket`, relación de fusión ya implementada en Fase 1) cómo distinguir:
- Tickets **padre** que tienen uno o más tickets hijo fusionados.
- Tickets **hijo** que fueron fusionados a otro (y por lo tanto no deberían operarse directamente).
- Tickets que nunca participaron de una fusión.

## Parte 2 — Agregar el filtro

- Sumar una opción de filtro en la pantalla de listado de Tickets (junto a los filtros existentes: estado, prioridad, SLA, técnico, etc.) del tipo "Fusión" con opciones:
  - Todos (comportamiento actual, sin cambios)
  - Solo padres con fusión
  - Solo hijos fusionados
  - (si aplica) Excluir fusionados — para vistas operativas donde no interesa ver los hijos ya fusionados mezclados con el resto
- El filtro debe combinarse correctamente con los filtros ya existentes (estado, prioridad, técnico, etc.), no reemplazarlos.
- Si ya existe alguna badge o indicador visual de "este ticket está fusionado" en el listado, mantenerlo consistente con el nuevo filtro (no duplicar lógica).

## Parte 3 — Prueba en vivo

1. Fusionar dos tickets de prueba (o usar un caso ya fusionado si existe en los datos de prueba).
2. Aplicar el filtro "Solo padres con fusión" y confirmar que aparece el ticket padre correcto, sin mezclar con tickets sueltos.
3. Aplicar "Solo hijos fusionados" y confirmar que aparece el hijo, no el padre.
4. Combinar el filtro de fusión con otro filtro existente (ej. estado + fusión) y confirmar que el resultado es la intersección correcta, no que un filtro pisa al otro.
5. Confirmar que el comportamiento por defecto ("Todos") no cambió respecto a como funcionaba antes de este cambio.

## Entregable esperado
- Filtro de fusión agregado y funcionando en combinación con los filtros existentes.
- Evidencia de las 5 pruebas en vivo de la Parte 3 (capturas o descripción del resultado).
- Confirmación de que no hay regresión en el comportamiento default del listado de Tickets.
