# Prompt para OpenCode — Ficha 360 del cliente (vista unificada)

## Contexto para OpenCode

Hoy la información de un cliente está repartida en pantallas separadas: ficha de `Customer` (contactos/sitios/contratos), listado de Tickets filtrado por cliente, y a futuro el módulo documental. El objetivo es una **vista única por cliente** ("ficha 360") donde el equipo pueda ver de un vistazo todo lo relacionado a ese cliente sin saltar entre secciones — tickets (abiertos e históricos), contratos, contactos/sitios, y documentos (cuando el módulo documental esté migrado).

Seguir la metodología habitual: explicar → implementar → probar en vivo → verificar que no rompe nada existente → documentar.

---

## Parte 1 — Diseño de la pantalla

- Nueva vista accesible desde la ficha de `Customer` existente (o reemplazando/extendiendo esa pantalla, a evaluar cuál es menos disruptivo con lo que ya existe).
- Secciones dentro de la ficha 360, cada una como un bloque resumido con opción de "ver todo":
  - **Datos generales del cliente**: lo que ya existe hoy en la ficha (razón social, contactos, sitios, contrato vigente).
  - **Tickets** (sección principal de esta ficha): listado completo de todos los tickets del cliente, ordenado automáticamente así:
    1. Primero los **abiertos/en curso**, ordenados por urgencia de SLA — rojo primero, después amarillo, después verde (mismo semáforo que ya existe en el sistema).
    2. Después los **resueltos/cerrados**, ordenados por fecha (más reciente primero).
    - Este orden se aplica siempre, sin que el usuario tenga que aplicar filtros manualmente — es el comportamiento por defecto al entrar a la ficha del cliente.
    - Reusar el listado de Tickets ya existente con el filtro de cliente pre-aplicado y este orden como default, en vez de duplicar la lógica de listado en una tabla nueva.
  - **Contratos**: estado vigente, fechas, tipo de abono — lo que ya exista en el modelo de `Contract`.
  - **Documentos** (placeholder si el módulo documental todavía no está migrado, o integrado si ya está disponible al momento de implementar esto — confirmar el estado real antes de asumir).
- Buscador dentro de la ficha 360 para encontrar rápido un ticket o documento puntual de ese cliente sin salir de la pantalla.

## Parte 2 — Acceso rápido desde otras partes del sistema

- Agregar un acceso directo a la ficha 360 desde donde ya aparece el nombre del cliente en otras pantallas (ej. desde el detalle de un ticket, click en el cliente lleva a su ficha 360) — para que sea el punto de entrada natural, no una pantalla aislada a la que solo se llega desde el listado de Clientes.

## Parte 3 — Prueba en vivo

1. Entrar a la ficha 360 de un cliente con tickets abiertos, histórico, y contrato vigente — confirmar que se ve todo correctamente resumido.
2. Desde el detalle de un ticket, confirmar que el acceso directo al cliente lleva a la ficha 360 (no a la ficha vieja/genérica, si quedaron ambas).
3. Confirmar que el listado de tickets dentro de la ficha 360 respeta el orden automático (abiertos por urgencia SLA primero, resueltos/cerrados por fecha después) y usa los mismos datos que el listado general de Tickets, sin duplicar lógica ni mostrar datos desactualizados.
4. Probar con un cliente sin tickets ni contrato vigente (caso vacío) y confirmar que la pantalla no rompe ni muestra errores, solo secciones vacías con mensaje claro.

## Entregable esperado
- Ficha 360 implementada y accesible desde la ficha de cliente y desde el detalle de ticket.
- Confirmación de las 4 pruebas en vivo.
- Estado del módulo documental dentro de la ficha (integrado o placeholder, según corresponda al momento de implementar esto).
