# Prompt para OpenCode — Módulo de gestión documental (migración de carpetas locales de clientes)

## Contexto para OpenCode

Ya existe un diseño previo para un módulo de gestión documental (`prompt-opencode-modulo-documental.md`), pensado originalmente para organizar los tickets de "ruido" que la migración de Zammad va a enrutar como `document`. **Antes de escribir código, revisar ese diseño existente** y confirmar si este nuevo requerimiento se puede resolver extendiéndolo, o si hace falta un módulo separado — no duplicar diseño de cero.

**Nuevo requerimiento:** hoy el equipo guarda documentación de clientes (manuales, diagramas de red, **credenciales de acceso**) en carpetas locales con subcarpetas por cliente, en la PC/entorno de trabajo. Se decidió migrar todo esto a SolidOps: de acá en más se sube, se edita y se descarga desde el sistema — deja de usarse la carpeta local como fuente de verdad.

**Punto crítico de seguridad:** parte de este contenido son credenciales de acceso reales (contraseñas de routers, accesos VPN, etc.). No pueden tratarse igual que un manual o diagrama de red genérico.

Seguir la metodología habitual: explicar → implementar → probar en vivo → verificar que no rompe nada existente → documentar → entregar env vars/compose.

---

## Parte 1 — Modelo de datos

- Entidad `Document` (o extender la ya diseñada si el módulo previo la contempla): archivo en MinIO, nombre, categoría/carpeta de origen, `customer_id` **nullable** (un documento puede no estar asociado a ningún cliente — ver sección de contenido general más abajo; mismo patrón de permisos por fila que el resto del sistema cuando sí tiene cliente), usuario que subió, fecha, y **versión** (no sobreescribir un archivo al editarlo — cada subida nueva de un documento existente genera una versión, con historial accesible).
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

### Estructura real confirmada (con capturas del usuario)

El usuario compartió capturas reales de la carpeta. Confirmado:

- El nivel superior de `SolidoCS_Ambientes` tiene ~116 carpetas. **No todas son clientes reales.** Detectado en las capturas: `Diagramas` (parece carpeta general, no de un cliente puntual) y `Correo Argentino` (nombre ambiguo, podría ser proveedor/servicio, no necesariamente cliente).
- **Decisión confirmada por el usuario: se migra absolutamente todo, sin excepción — nada queda afuera del sistema.** Las carpetas que no matcheen razonablemente contra un `Customer` existente **no se descartan ni quedan solo en una lista de pendientes** — se migran igual, pero como contenido **sin cliente asociado** (`customer_id = null`), agrupado en un apartado separado tipo "Recursos generales" / "Sin cliente asociado" dentro de la navegación del módulo documental. El usuario puede después, con calma, reasociar manualmente algún documento puntual a un cliente si corresponde, pero el contenido ya está en el sistema y es buscable desde el primer momento — no depende de esa revisión para existir ahí.
- Igual se debe seguir generando la lista de "carpetas que no matchearon a ningún cliente" como parte del reporte del dry-run — no para excluirlas, sino para que el usuario tenga visibilidad de cuáles fueron a parar a "Recursos generales" y pueda revisar con calma si alguna en realidad correspondía a un cliente con nombre distinto al de la carpeta.
- `Clientes ya no abonados` es una **carpeta contenedora especial**: adentro tiene más carpetas, cada una a su vez una empresa cliente — pero son clientes **inactivos/dados de baja**, no activos. El importador debe:
  - Detectar este caso especial por nombre (o preguntarle al usuario si hay otras carpetas contenedoras similares que no se vieron en las capturas).
  - Tratar cada subcarpeta adentro como un cliente aparte, igual que los del nivel raíz, pero marcando esos documentos con alguna referencia a que el cliente está inactivo (coordinar con el estado `activo/inactivo` que se definió para el CRUD de Clientes pendiente, si ya existe ese campo en `Customer` al momento de implementar esto; si no existe todavía, dejarlo documentado como dependencia cruzada con ese otro trabajo pendiente).
- Dentro de la carpeta de un cliente (ej. `Calandri e Hijos S.A`, visto en captura), hay:
  - **Subcarpetas por área** (`Dominio`, `Gestión de backups`, `Hosting y web`, `Infraestructura de red`, `Infraestructura de usuario final`, `Instructivos`, `Proveedores de sistemas`, `Seguridad informática`, `Servicios de internet`, `Servidores`, `SLA`, `Software y sistemas`, y hasta carpetas con nombres más libres como `relevamiento enero 2024`) — como ya estaba contemplado, sin asumir un set fijo de nombres de área, cada cliente puede tener sus propias carpetas.
  - **Archivos sueltos directamente en la raíz del cliente**, fuera de cualquier subcarpeta de área (ej. `Creacion de ambiente.docx`, `Planilla Relevamientos 6-6-23.xlsx`, `Planilla Relevamientos en blanco.xlsx`). Estos deben migrarse igual, asociados al cliente con una categoría genérica tipo "General" (sin área específica), no descartarse ni forzarlos dentro de una carpeta de área que no les corresponde.
- **Duplicados de formato**: mismo documento en `.docx` y `.pdf` con el mismo nombre (ej. dentro de `Hosting y web`: `HOSTING Y WEB.docx` + `HOSTING Y WEB.pdf`), muy probablemente el PDF es una exportación del Word para lectura, no un documento distinto. Esto es un patrón frecuente en toda la carpeta, no un caso aislado — se ve tanto en la raíz del cliente (`Creacion de ambiente.docx`/`.pdf`) como dentro de las áreas.
  - **No migrar ambos como documentos separados** — esto duplicaría cada resultado de búsqueda y confundiría el versionado.
  - Estrategia: detectar pares de archivos con el mismo nombre base y extensiones `.docx`/`.pdf` (o `.xlsx`/`.pdf`, etc.) dentro de la misma carpeta. Migrar el **`.docx`/`.xlsx` como el documento editable principal** (ya que el objetivo es poder editar y volver a subir desde SolidOps) y desestimar el `.pdf` duplicado, o guardarlo como adjunto secundario de referencia dentro del mismo registro de documento — no como una entrada nueva y separada. Confirmar con el usuario cuál de las dos variantes prefiere antes de aplicar esta regla en la migración real (puede probarse primero en el dry-run y mostrarle cuántos pares de duplicados detectó, para que apruebe el criterio).

### Backup obligatorio antes de la migración real

- **Antes de correr la migración real** (no antes del dry-run, que es de solo lectura y no hace falta), hacer un backup completo de la base de datos de SolidOps (`pg_dump` de `ops_msp`, mismo mecanismo ya documentado en `docs/ZAMMAD-MIGRATION.md` para el caso de Zammad) y, si es viable, un snapshot o respaldo del estado actual de MinIO (los archivos que ya pueda haber subidos de pruebas anteriores).
- Guardar el backup con fecha/hora en el nombre y confirmarle al usuario dónde quedó guardado (ruta exacta) antes de avanzar con la migración real.
- Si la migración real sale mal a mitad de camino (ej. se cortó, o el usuario revisa el resultado y ve que hay clientes mal asociados en volumen), el plan de reversión debe ser: restaurar ese backup de `ops_msp`, sin necesidad de deshacer registro por registro. Documentar el comando exacto de restauración (`pg_restore` o equivalente) junto con el backup, no solo mencionarlo.
- Confirmar con el usuario antes de avanzar con la migración real que el backup se generó correctamente (tamaño razonable, no vacío) — no asumir que el comando de backup funcionó solo porque no tiró error.

### Migración con estas reglas

- Armar un script de importación que lea la estructura de carpetas de red (`\\10.88.88.150\SolidoCS_Ambientes`) y migre preservando:
  - La carpeta de cada cliente → asociada al `Customer` correspondiente en SolidOps (buscar coincidencia por nombre). **Prestar especial cuidado en no mezclar clientes con nombres parecidos** (ej. varios "Colegio X", varios "Estudio X" vistos en la captura del nivel raíz) — el match debe ser lo más preciso posible. Si hay ambigüedad real entre dos clientes candidatos, **migrar igual el contenido** (no descartarlo) pero dejarlo con `customer_id = null` en "Recursos generales", con una nota/sugerencia de a qué cliente podría corresponder, para que el usuario lo reasocie con confianza en vez de que el sistema adivine mal.
  - **Estructura de más de un nivel dentro de cada cliente**: recorrer la jerarquía completa de subcarpetas por área y preservarla como ruta de categoría (ej. `document.category_path = "Hosting y web"`), sin aplanar todo a una sola etiqueta. Los archivos sueltos en la raíz del cliente van con categoría "General".
  - El modelo de datos de `Document` debe soportar esta jerarquía (campo tipo `category_path` como string con separador, o una tabla de categorías con relación padre-hijo — evaluar cuál es más simple de mantener y de navegar después en la UI).
  - Aplicar la deduplicación docx/pdf descrita arriba.
- Antes de migrar todo de una, correr el script primero en modo "solo reportar" (dry-run): cuántos archivos, cuántos clientes matcheados vs. sin matchear, cuántos pares duplicados docx/pdf detectados, cuántas carpetas de nivel superior no matchearon con ningún cliente (mostrar la lista completa, ej. `Diagramas`, `Correo Argentino`, y cualquier otra), tamaño total — para que el usuario lo revise antes de confirmar la migración real.
- Los archivos que caigan en carpetas que sugieran contenido de credenciales (por nombre de subcarpeta, ej. "Credenciales", "Accesos", "Passwords", "Seguridad informática") marcarlos automáticamente como `sensitive`/`credenciales` en la migración — y darle al usuario la lista para que revise y corrija los que se hayan categorizado mal, no confiar ciegamente en la detección automática.

### "Box" por cliente en la UI

- El pedido explícito del usuario es que la migración resulte en **un contenedor visual por cliente** ("box") que agrupe toda su documentación migrada — esto se alinea directamente con la Ficha 360 del cliente ya implementada (sección "Documentos" de esa ficha). Confirmar en este prompt que, una vez migrados los documentos, aparecen agrupados correctamente bajo el cliente correspondiente en esa misma ficha, sin necesidad de una pantalla nueva aparte.

## Parte 3 — Búsqueda y navegación

- Búsqueda por contenido usando PostgreSQL Full Text Search (ya definido en el stack, evitar sumar Elasticsearch).
- Los documentos `sensitive`/`credenciales` **sí aparecen en resultados de búsqueda para todos los roles** (decisión confirmada: acceso amplio, sin restricción por permiso) — la única protección es la auditoría de acceso de la Parte 1, no el ocultamiento.
- Navegación por árbol de **cliente → área → subcategoría** (tantos niveles como existan realmente en la carpeta de origen), más un apartado separado y siempre visible tipo **"Recursos generales" / "Sin cliente asociado"** para el contenido que no matcheó ningún cliente — no escondido ni requiere activar un filtro especial para verlo, debe ser tan accesible como la sección de cualquier cliente. Además de la búsqueda libre, que debe cubrir también este contenido general (no excluirlo de los resultados).

## Parte 4 — Edición y versionado

- Flujo: el usuario descarga el documento, lo edita localmente (Word, Excel, lo que sea), y lo vuelve a subir — la subida nueva queda como una versión nueva del mismo documento, no un archivo suelto sin relación con el anterior.
- Mantener historial de versiones visible y descargable (por si hace falta volver a una versión anterior).
- No implementar edición en línea dentro del navegador en este prompt — fuera de alcance por ahora.

## Parte 5 — Prueba en vivo

0. Confirmar primero que el contenedor/script puede leer efectivamente la carpeta de red con la VPN activa, antes de intentar nada de migración — probar con un `ls`/listado simple del contenido de `\\10.88.88.150\SolidoCS_Ambientes` desde donde vaya a correr el script.
1. Correr el dry-run de importación sobre la carpeta real (o un subconjunto representativo si se prefiere no listar las 116 carpetas de una) y confirmar que el reporte distingue: clientes matcheados, contenido destinado a "Recursos generales" (mostrando `Diagramas`/`Correo Argentino` si aparecen ahí, con conteo total), contenido de `Clientes ya no abonados` tratado como clientes inactivos, jerarquía de áreas completa, archivos sueltos en raíz de cliente, y pares duplicados docx/pdf detectados.
1.5. Antes de la migración real (no antes del dry-run), generar el backup de `ops_msp` y confirmar que se creó correctamente (tamaño, ubicación) antes de seguir.
2. Migrar de verdad un subconjunto de prueba (2-3 clientes reales, incluyendo al menos uno con archivos sueltos en la raíz y al menos un par duplicado docx/pdf, más al menos una carpeta de nivel superior que no matchee ningún cliente) y confirmar que: los documentos de cliente aparecen bien asociados con la ruta de categoría completa preservada, sin duplicados de formato, navegable en el árbol de la UI; y que el contenido sin cliente aparece correctamente en "Recursos generales", buscable, sin quedar oculto ni perdido.
3. Confirmar que un documento de credenciales aparece con normalidad en la búsqueda para cualquier rol, y que verlo/descargarlo queda registrado en el log de auditoría con usuario y fecha.
4. Subir una nueva versión de un documento ya migrado y confirmar que queda el historial, no que se pisó el archivo anterior.
5. Confirmar en el log de auditoría que quedó registrado quién vio/descargó un documento de credenciales — este es el único control de trazabilidad dado el acceso amplio, así que probarlo con cuidado.
6. Confirmar que la Ficha 360 del cliente migrado muestra correctamente el "box" de documentos agrupados, incluyendo la jerarquía de áreas.

## Entregable esperado
- Confirmación de si se extendió el módulo documental existente o se hizo aparte (con justificación).
- **Confirmación del backup de `ops_msp` generado antes de la migración real**, con ruta/nombre de archivo y comando de restauración documentado.
- Resultado del dry-run: totales, lista de carpetas de nivel superior que van a "Recursos generales" (con `Diagramas`/`Correo Argentino` explícitamente incluidos), y conteo de pares duplicados detectados.
- Resultado de la migración de prueba de la Parte 5.
- Confirmación de las 6 pruebas en vivo de la Parte 5.
- Confirmación de que **el 100% del contenido de la carpeta se migra**, sin exclusiones — lo que no tiene cliente asociado queda accesible en "Recursos generales", no descartado.
- Documentación del modelo de acceso: todos los roles pueden ver documentación (incluida la de credenciales), con auditoría de acceso como único control de trazabilidad — decisión confirmada por el usuario.
- Documentación de la regla de deduplicación docx/pdf aplicada, y de cómo se trató la carpeta especial `Clientes ya no abonados`.
