# Prompt para OpenCode — Vista de Documentos tipo "Explorador de Windows" + vista previa en el navegador (sin descargar)

## Contexto para OpenCode

Dos pedidos del usuario sobre el módulo documental ya implementado:

1. **Navegación tipo carpetas de Windows**: hoy existe la página `/documentos` en el NAV con árbol cliente→área, pero el usuario la vio como una lista plana dentro de la ficha del cliente (con rutas completas en el título, ej. "Informes/Informes por empresa/CALCIMER/.../Estado del ZFS..."). Quiere poder **navegar carpeta por carpeta**, como el Explorador de Windows: entrar a "Empresas", ver sus subcarpetas (`Procesos`, `Plantillas`, `Informes`, etc.) como carpetas clickeables, entrar a una, ver su contenido, con breadcrumb para volver atrás — no una lista larga con rutas completas en cada nombre.

2. **Vista previa sin descargar**: al hacer clic en un documento, quiere verlo directamente en el navegador (como un PDF que abre Chrome, o Google Docs mostrando un Word sin bajarlo) — no forzar la descarga como única opción.

**Limitación técnica importante a tener en cuenta**: el sistema corre en red local/VPN, sin acceso público a internet — **no se puede usar Office Online Viewer ni Google Docs Viewer** (ambos requieren que el archivo sea accesible desde una URL pública en internet, lo cual no aplica acá). La vista previa de Word/Excel/PowerPoint requiere conversión del lado del servidor.

**Regla dura, confirmada por el usuario: todo debe leerse desde el almacenamiento propio del sistema (MinIO), nunca desde la carpeta de red montada (`\\10.88.88.150\SolidoCS_Ambientes`).** La carpeta de red solo se usó como origen puntual durante la migración — una vez migrado un archivo, el sistema no debe volver a esa carpeta para nada (ni para navegar, ni para previsualizar, ni para descargar). El campo `source_path` que se guarda en `Document` es solo un dato de referencia histórica (para idempotencia de la migración), no una ruta activa que el sistema consulte en tiempo real. Tanto la navegación tipo carpetas (Parte 1) como la vista previa (Parte 2) deben operar exclusivamente sobre los documentos y versiones ya subidos a MinIO — confirmar esto explícitamente en la implementación y en las pruebas, ya que un error acá dejaría el sistema dependiendo de que la carpeta de red y la VPN estén siempre disponibles, que es justo lo que se quiere evitar.

Seguir la metodología habitual: explicar → implementar → probar en vivo → verificar que no rompe nada existente → documentar → entregar env vars/compose.

---

## Parte 1 — Navegación tipo Explorador de Windows

- Rediseñar la vista `/documentos` (y la sección de documentos dentro de la Ficha 360 del cliente, para que sean consistentes entre sí) como navegación por carpetas:
  - Vista inicial: lista de clientes (o accesos directos a "Recursos generales" y a la ficha de cada cliente).
  - Al entrar a un cliente: ver sus carpetas de primer nivel como íconos/filas de carpeta (ej. `Procesos`, `Plantillas`, `Informes`), no los archivos sueltos todavía.
  - Al hacer clic en una carpeta: entrar a su contenido — puede haber más subcarpetas (ej. `Informes` → `Informes por empresa` → `CALCIMER` → ...) o ya los archivos finales.
  - Breadcrumb visible arriba (ej. `Empresas / Informes / Informes por empresa / CALCIMER`) con cada nivel clickeable para volver directo a esa profundidad, igual que el Explorador de Windows o cualquier gestor de archivos.
  - Los archivos, cuando se llega al nivel final, se muestran con su nombre simple (sin la ruta completa repetida en el título, ya que el breadcrumb ya da ese contexto).
- Usar el campo `category_path` ya existente (jerarquía guardada en la migración) para construir esta navegación — no hace falta un modelo de datos nuevo, es una forma distinta de mostrar lo que ya está guardado.

## Parte 1.5 — Subir documentos nuevos dentro de la navegación por carpetas

- Desde cualquier punto de la navegación (ej. parado dentro de `Empresas / Informes`), debe poder subirse un documento nuevo (creado externamente en Word/Excel/etc.) que quede guardado en esa misma carpeta/categoría — no un botón de "subir" genérico y desconectado de dónde está parado el usuario.
- Al subir, el `category_path` del documento nuevo se arma automáticamente según la carpeta donde el usuario está navegando en ese momento (mismo mecanismo ya usado por la migración, ahora disparado desde la UI en vez del script).
- Debe poder **crear una carpeta nueva** dentro de la navegación (ej. una subcategoría que no existía en la migración original) para organizar documentos nuevos que no encajen en ninguna existente — no debe ser obligatorio subir todo a una carpeta ya migrada.
- Esto ya usa el mismo endpoint `POST /documents/upload` existente (con permiso `documents:write`, ya habilitado para los 5 roles) — el trabajo acá es de UI/UX (contexto de carpeta actual), no de crear lógica de backend nueva salvo que haga falta soporte explícito para "crear carpeta vacía" (una carpeta sin documentos todavía, solo para reservar el lugar) si el modelo actual no lo contempla.

## Parte 2 — Vista previa en el navegador sin descargar

### PDFs e imágenes (fácil, sin nueva infraestructura)
- Servir estos archivos con el header `Content-Disposition: inline` (no `attachment`) en un endpoint de preview, para que el navegador los muestre directamente en una nueva pestaña o en un modal/panel dentro de la misma página, en vez de forzar la descarga.

### Word / Excel / PowerPoint (requiere conversión en el backend)
- Agregar **LibreOffice en modo headless** al contenedor del backend (o evaluar un contenedor/servicio aparte solo para conversión, si eso mantiene la imagen del backend más liviana — decidir cuál conviene y justificar la elección).
- Al pedir la vista previa de un documento Office, convertirlo a PDF on-demand (`soffice --headless --convert-to pdf`) y servir ese PDF con `inline`.
- **Cachear el PDF convertido** (guardarlo en MinIO junto al documento original, asociado a esa versión específica) para no repetir la conversión cada vez que alguien lo vuelve a abrir — la conversión es costosa en tiempo/CPU. Si se sube una nueva versión del documento, se debe generar un nuevo PDF de preview para esa versión (no reusar el de una versión vieja).
- Si la conversión falla (formato corrupto, archivo dañado, etc.), no debe romper la pantalla — mostrar un mensaje claro y ofrecer la descarga como alternativa en ese caso puntual.

### Otros formatos (ej. `.eddx`, `.zip`, imágenes de diagrama no estándar)
- Para formatos que no se puedan previsualizar razonablemente (ej. `.zip`, `.eddx` si no hay conversor disponible), no forzar nada — mostrar claramente que ese archivo no tiene vista previa disponible y ofrecer la descarga como única opción para esos casos, sin que parezca un error.

## Parte 3 — Prueba en vivo

1. Navegar como Explorador de Windows: entrar al cliente "Empresas", bajar varios niveles de carpetas (`Informes` → `Informes por empresa` → `CALCIMER`) usando el breadcrumb, y volver a un nivel intermedio haciendo clic en el breadcrumb.
2. Abrir un PDF real (ej. `Diagrama de flujo - backup estandar.pdf`) y confirmar que se ve en el navegador sin descargar.
3. Abrir un Word real (ej. `Proceso de backup estantandarizado (FINALIZADO).docx`) y confirmar que se convierte y se ve como PDF en el navegador, sin descargar.
4. Volver a abrir el mismo Word una segunda vez y confirmar (por tiempo de respuesta o logs) que se usó el PDF cacheado, no que se convirtió de nuevo.
5. Subir una nueva versión de ese mismo Word y confirmar que la vista previa ahora refleja el contenido nuevo, no el PDF cacheado viejo.
6. Probar con un archivo `.zip` o `.eddx` y confirmar que se informa claramente que no hay vista previa, ofreciendo la descarga.
7. Con la VPN desconectada (o simulando que la carpeta de red no está disponible), confirmar que navegar y previsualizar documentos ya migrados sigue funcionando sin ningún error — prueba clave para confirmar que no hay dependencia oculta de la carpeta de red.
8. Parado dentro de una carpeta específica (ej. `Empresas / Plantillas`), subir un documento Word nuevo desde la PC del usuario y confirmar que queda guardado en esa misma carpeta, visible ahí sin recargar manualmente ninguna ruta.
9. Crear una carpeta nueva vacía dentro de la navegación y confirmar que aparece disponible para subir documentos ahí, incluso antes de tener contenido.

## Entregable esperado
- Navegación por carpetas tipo Explorador de Windows implementada, con breadcrumb funcional.
- Vista previa en navegador para PDF/imágenes sin descarga.
- Conversión y vista previa de Word/Excel/PowerPoint funcionando, con cacheo por versión.
- Manejo claro de formatos sin vista previa disponible.
- **Confirmación explícita de que ninguna parte de la navegación ni de la vista previa depende de la carpeta de red / VPN** — todo se sirve desde MinIO.
- Env vars/compose actualizados si se agregó LibreOffice u otro servicio nuevo al stack — documentar el tamaño de imagen resultante si creció significativamente, ya que puede afectar tiempos de build/deploy.
- Confirmación de las 6 pruebas en vivo.
