# Prompt para OpenCode — Módulo de gestión documental (migración de carpetas locales de clientes)

## Contexto para OpenCode

Ya existe un diseño previo para un módulo de gestión documental (`prompt-opencode-modulo-documental.md`), pensado originalmente para organizar los tickets de "ruido" que la migración de Zammad va a enrutar como `document`. **Antes de escribir código, revisar ese diseño existente** y confirmar si este nuevo requerimiento se puede resolver extendiéndolo, o si hace falta un módulo separado — no duplicar diseño de cero.

**Nuevo requerimiento:** hoy el equipo guarda documentación de clientes (manuales, diagramas de red, **credenciales de acceso**) en carpetas locales con subcarpetas por cliente, en la PC/entorno de trabajo. Se decidió migrar todo esto a SolidOps: de acá en más se sube, se edita y se descarga desde el sistema — deja de usarse la carpeta local como fuente de verdad.

**Punto crítico de seguridad:** parte de este contenido son credenciales de acceso reales (contraseñas de routers, accesos VPN, etc.). No pueden tratarse igual que un manual o diagrama de red genérico.

Seguir la metodología habitual: explicar → implementar → probar en vivo → verificar que no rompe nada existente → documentar → entregar env vars/compose.

---

## Parte 1 — Modelo de datos

- Entidad `Document` (o extender la ya diseñada si el módulo previo la contempla): archivo en MinIO, nombre, categoría/carpeta de origen, `customer_id` (mismo patrón de permisos por fila que el resto del sistema), usuario que subió, fecha, y **versión** (no sobreescribir un archivo al editarlo — cada subida nueva de un documento existente genera una versión, con historial accesible).
- Campo `sensitive: boolean` (o una categoría explícita tipo `document_type: 'manual' | 'diagrama' | 'credenciales' | 'otro'`) para distinguir credenciales de acceso del resto.
- Los documentos marcados como `credenciales` (o `sensitive: true`) deben:
  - Ser visibles para **todos los roles** (Administrador, Supervisor, Coordinador, Técnico, Consulta) — decisión confirmada por el usuario, sin restricción de permiso adicional más allá del acceso normal al sistema.
  - Quedar auditados en el log de auditoría existente cada vez que alguien los ve o descarga (no solo cuando se editan) — a diferencia del resto de los documentos, donde solo auditar creación/edición/borrado puede ser suficiente. Esto es importante justamente porque el acceso es amplio: la trazabilidad de quién vio qué queda como el único control, así que no debe faltar.

## Parte 2 — Migración de la estructura de carpetas existente

### Consideración técnica previa — acceso a la carpeta de red

La carpeta origen **no es un disco local**: es un recurso compartido SMB en `\\10.88.88.150\SolidoCS_Ambientes`, accesible únicamente con VPN activa. El backend corre en un contenedor Docker dentro de WSL2 (Windows 11), así que antes de escribir el script de importación hay que resolver cómo el contenedor accede a esa ruta. Opciones a evaluar y elegir la más simple y confiable:

- **Montar el recurso SMB dentro de WSL2** (`mount -t drvfs` o vía `cifs-utils`/`mount.cifs` con credenciales) como una ruta local de WSL2, y de ahí montarla como volumen de Docker (`docker-compose.dev.yml`) hacia el contenedor del backend, solo para la duración de la importación (no dejarlo montado permanentemente si no hace falta).
- Alternativa más simple: correr el script de importación **fuera del contenedor**, directamente en Windows/WSL2 con acceso normal a la unidad de red ya mapeada (si el usuario ya la usa como unidad `Z:` o similar en Windows), y que ese script hable directo con la API de SolidOps (subida vía HTTP) en vez de necesitar acceso de bajo nivel a la base de datos/MinIO desde adentro del contenedor.
- Confirmado con el usuario: la VPN está siempre activa, no es una preocupación de estabilidad para este caso. Aun así, mantener el script idempotente (si un archivo ya se subió, no volver a subirlo si se corre de nuevo) como buena práctica general ante cualquier corte de red imprevisto, sin necesidad de lógica de reintento compleja.

Documentar claramente qué opción se eligió y por qué, con los pasos exactos para que el usuario pueda reproducirlo (ej. cómo montar el SMB en WSL2 paso a paso, con capturas o comandos concretos) — esto no es algo que el usuario vaya a recordar de memoria en el futuro.

- Armar un script de importación que lea la estructura de carpetas de red (`\\10.88.88.150\SolidoCS_Ambientes`) y migre preservando:
  - La carpeta de cada cliente → asociada al `Customer` correspondiente en SolidOps (buscar coincidencia por nombre; si no hay match exacto, dejar una lista de "sin asociar" para que el usuario los vincule manualmente, no adivinar).
  - Las subcarpetas dentro de cada cliente → como categoría/etiqueta del documento (ej. "Manuales", "Diagramas", "Credenciales"), no perder esa organización.
- Antes de migrar todo de una, correr el script primero en modo "solo reportar" (dry-run): cuántos archivos, cuántos clientes matcheados vs. sin matchear, tamaño total — para que el usuario lo revise antes de confirmar la migración real.
- Los archivos que caigan en carpetas que sugieran contenido de credenciales (por nombre de subcarpeta, ej. "Credenciales", "Accesos", "Passwords") marcarlos automáticamente como `sensitive`/`credenciales` en la migración — y darle al usuario la lista para que revise y corrija los que se hayan categorizado mal, no confiar ciegamente en la detección automática.

## Parte 3 — Búsqueda y navegación

- Búsqueda por contenido usando PostgreSQL Full Text Search (ya definido en el stack, evitar sumar Elasticsearch).
- Los documentos `sensitive`/`credenciales` **sí aparecen en resultados de búsqueda para todos los roles** (decisión confirmada: acceso amplio, sin restricción por permiso) — la única protección es la auditoría de acceso de la Parte 1, no el ocultamiento.
- Navegación por árbol de cliente → categoría, además de la búsqueda libre.

## Parte 4 — Edición y versionado

- Flujo: el usuario descarga el documento, lo edita localmente (Word, Excel, lo que sea), y lo vuelve a subir — la subida nueva queda como una versión nueva del mismo documento, no un archivo suelto sin relación con el anterior.
- Mantener historial de versiones visible y descargable (por si hace falta volver a una versión anterior).
- No implementar edición en línea dentro del navegador en este prompt — fuera de alcance por ahora.

## Parte 5 — Prueba en vivo

0. Confirmar primero que el contenedor/script puede leer efectivamente la carpeta de red con la VPN activa, antes de intentar nada de migración — probar con un `ls`/listado simple del contenido de `\\10.88.88.150\SolidoCS_Ambientes` desde donde vaya a correr el script.
1. Correr el dry-run de importación sobre una carpeta de prueba con al menos 2 clientes y subcarpetas mixtas (manuales + una carpeta de credenciales) y confirmar el reporte.
2. Migrar de verdad esa carpeta de prueba y confirmar que los documentos aparecen bien asociados al cliente y categoría correcta.
3. Confirmar que un documento de credenciales aparece con normalidad en la búsqueda para cualquier rol, y que verlo/descargarlo queda registrado en el log de auditoría con usuario y fecha.
4. Subir una nueva versión de un documento ya migrado y confirmar que queda el historial, no que se pisó el archivo anterior.
5. Confirmar en el log de auditoría que quedó registrado quién vio/descargó un documento de credenciales — este es el único control de trazabilidad dado el acceso amplio, así que probarlo con cuidado.

## Entregable esperado
- Confirmación de si se extendió el módulo documental existente o se hizo aparte (con justificación).
- Resultado del dry-run y de la migración de prueba.
- Confirmación de las 5 pruebas en vivo de la Parte 5.
- Lista de clientes "sin asociar" si los hubo, para que el usuario los vincule a mano.
- Documentación del modelo de acceso: todos los roles pueden ver documentación (incluida la de credenciales), con auditoría de acceso como único control de trazabilidad — decisión confirmada por el usuario.
