# Pantalla de Clientes — filtro/búsqueda por nombre

Listado de clientes en `/clientes`.

## Contexto

Con **416 clientes cargados** (tras la migración Zammad), la lista era imposible de
recorrer a mano. Se agregó un **campo de búsqueda por nombre** que filtra la lista
en tiempo real mientras se escribe (sin botón "buscar", sin recargar).

## Comportamiento

- **Insensible a mayúsculas/tildes**: usa la misma normalización que el matching
  documental (`normalize('NFD')` quita acentos + `toLowerCase`). Buscar `merce`,
  `MERCE` o `Metalúrgica` (con tilde) encuentra las variantes con/sin acento.
- **Parcial**: coincide si el texto buscado aparece en cualquier parte del nombre
  (`includes`), no solo al inicio.
- **En tiempo real**: el filtrado corre en un `useMemo` sobre `customers` según el
  estado `query` — sin debounce necesario dado el volumen (416).
- **Combinable con otros filtros**: el `useMemo` `filtered` filtra por `query` y
  está estructurado para sumar más criterios (ej. un futuro filtro activo/inactivo)
  sin reemplazar la búsqueda.
- **Estados**:
  - `customers.length === 0` → "Sin clientes todavía".
  - `filtered.length === 0` (pero hay clientes) → `Sin resultados para "<query>"`.
  - Botón "limpiar" que aparece mientras hay texto en la búsqueda.
  - El subtítulo del header muestra `X de Y clientes`.

## Implementación

- `frontend/app/(app)/clientes/page.tsx`: `normalize()`, estado `query`, `useMemo`
  `filtered`, input de búsqueda con placeholder "buscar por nombre…".

## Prueba en vivo

- Buscar `merce` → 13 clientes con "Mercedes"/"Mercedino" (incluye variantes con
  tilde: `Metalúrgica Mercedes`, `Matadero y Frigorífico El Mercedino`). ✓
- Buscar `Metalúrgica` (con tilde) → encuentra `Metalúrgica Mercedes` y
  `Metalurgica Mercedes`. ✓
- Tildes/mayúsculas insensibles: confirmado con la función `normalize`.
