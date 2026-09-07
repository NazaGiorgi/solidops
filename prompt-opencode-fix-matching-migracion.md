# Prompt para OpenCode — Bug crítico: el script de migración no matchea ningún cliente (0 de 2515 archivos)

## Contexto crítico para OpenCode

Se corrió el dry-run real de `scripts/migrar-documentos.js` contra la carpeta `\\10.88.88.150\SolidoCS_Ambientes` (104 carpetas de nivel superior, 2515 archivos totales). **Resultado: 0 archivos matchearon con algún `Customer` existente — el 100% cayó en "Recursos generales".**

Esto no es plausible como resultado correcto: hay carpetas con nombres que deberían coincidir razonablemente con clientes reales ya cargados en SolidOps (ej. `Calandri e Hijos S.A`, `Internegocios`, `SolidoCS`, entre otras de la lista completa de 130 carpetas sin match que se generó). Confirmado con el usuario que el dry-run no subió nada real (`Subidos: 0`, confirmado también que no aparece nada nuevo en la UI de SolidOps) — es seguro investigar y corregir sin necesidad de revertir nada.

Seguir la metodología habitual: explicar → investigar con evidencia real → implementar el fix → probar en vivo → verificar que no rompe nada existente → documentar.

---

## Parte 1 — Diagnosticar por qué el matching da 0 resultados

No asumir la causa — confirmar con evidencia antes de tocar código. Candidatos a revisar:

- **¿La consulta a `Customer` está trayendo datos realmente?** Confirmar con una consulta directa que la tabla `Customer` tiene registros al momento en que corre el script (podría ser que el script esté apuntando a un `API` o base equivocada, un endpoint que devuelve vacío, o un problema de autenticación silencioso que hace que la consulta de clientes falle y caiga a "sin resultados" sin tirar error visible).
- **¿El criterio de comparación es demasiado estricto?** Si compara nombres con `===` exacto en vez de una comparación normalizada (sin importar mayúsculas/minúsculas, tildes, espacios extra, "S.A." vs "SA", etc.), es esperable que falle sistemáticamente incluso con nombres muy parecidos.
- **¿Hay un bug de tipeo/referencia en el código** (ej. comparando contra el campo equivocado, un array vacío por un filtro mal puesto, una condición invertida) que hace que la función de matching nunca encuentre nada aunque la lógica en teoría esté bien planteada?
- Probar el matching manualmente contra 3-4 casos concretos de la lista (ej. `Calandri e Hijos S.A`, `Internegocios`, `SolidoCS`) y loguear paso a paso qué está comparando contra qué, para encontrar dónde se rompe.

## Parte 2 — Corregir el matching con tolerancia razonable

**Regla dura, sin excepción: el script nunca crea un `Customer` nuevo, y nunca fusiona automáticamente dos carpetas en un mismo cliente.** Cada cliente que ya existe en `Customer` es el único destino válido de match — el objetivo de este fix es que el script *encuentre* esos matches reales que hoy no está encontrando por un bug, no que invente clientes nuevos ni junte carpetas por similitud. Ante cualquier duda entre asignar o no, la opción segura es dejarlo en "Recursos generales" sin asignar — nunca migrarlo a un cliente por aproximación si no hay certeza razonable.

Una vez encontrada la causa, implementar una comparación más robusta:
- Normalizar antes de comparar: minúsculas, sin tildes, sin espacios extra, sin puntuación común (puntos, comas).
- Considerar coincidencia parcial/fuzzy (ej. distancia de Levenshtein con un umbral razonable, o que el nombre de la carpeta contenga o esté contenido en el nombre del cliente) en vez de exigir igualdad exacta — pero con cuidado de no generar falsos positivos que mezclen clientes distintos con nombres parecidos (recordar la advertencia ya dada en el diseño original: ante ambigüedad real entre dos candidatos, no forzar un match, dejarlo con sugerencia en "Recursos generales").

## Parte 3 — Manejar variantes de nombre de la misma carpeta/cliente

**Esta sección es exclusivamente informativa — no implica ninguna fusión ni acción automática.** El reporte reveló casos de la misma empresa con variantes de nombre en distintas carpetas, por ejemplo:
- `Metalúrgica Mercedes`, `Metalúrgica Mercedes - copia`, `Metalúrgica Mercedinina` (con error de tipeo)
- `Frigorifico El Mercedino` / `Frigorífico El Mercedino` (con y sin tilde)
- `Sociedad Italiana` / `Sociedad Italina` (error de tipeo)
- Varias carpetas con sufijo `- copia` / `- copia (2)`

**Cada carpeta se migra por separado, como está, sin unir ni descartar ninguna automáticamente.** El único cambio pedido acá es agregar un aviso en el reporte del dry-run que agrupe visualmente estos nombres parecidos (por similitud entre ellos, no contra `Customer`), para que el usuario tenga visibilidad y decida manualmente — más adelante, y por fuera de este script — si alguna de esas carpetas debería reasociarse a mano a un cliente existente. El script no actúa sobre esa decisión, solo la señala.

## Parte 4 — Prueba en vivo

1. Correr el dry-run de nuevo sobre la carpeta real completa y confirmar que ahora hay una cantidad razonable de matches contra `Customer` (no 0, y tampoco un número sospechosamente alto que sugiera falsos positivos).
2. Mostrar específicamente el resultado de matching para `Calandri e Hijos S.A`, `Internegocios`, y `SolidoCS` — confirmar que matchean correctamente contra sus registros de `Customer` reales.
3. Confirmar que casos de ambigüedad genuina (dos clientes con nombres parecidos) siguen sin forzarse — deben quedar en "Recursos generales" con la sugerencia, no asignados a ciegas.
4. Mostrar el nuevo aviso de "posibles variantes" agrupando al menos los casos de `Metalúrgica Mercedes*` y las carpetas `- copia`.

## Entregable esperado
- Causa raíz del 0% de matching confirmada con evidencia (no supuesta).
- Fix implementado con comparación normalizada/tolerante.
- Nuevo reporte de dry-run con matches reales contra `Customer`.
- Aviso de "posibles variantes del mismo nombre" agregado al reporte.
- Confirmación explícita de que nada se subió realmente en ninguna de las pruebas (seguir en modo dry-run hasta que el usuario apruebe el reporte corregido).
