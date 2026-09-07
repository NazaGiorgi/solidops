# Módulo documental — migración de carpetas locales de clientes

## Decisión: extender el diseño previo (no módulo aparte)

Se **extendió** el diseño de `prompt-opencode-modulo-documental.md` (que ya definía
`Document`, `DocumentVersion`, `Category`, FTS con Postgres, permisos, Ficha 360).
El diseño actual ya contemplaba todo esto; se implementó la parte de gestión
documental de los puntos pedidos. No se creó un módulo paralelo: se usa la entidad
`Document` existente, ampliada, y el `document_versions`.

---

## Acceso a la carpeta (decisión confirmada)

La carpeta es SMB `\\10.88.88.150\SolidoCS_Ambientes` (VPN activa). El backend corre
en Docker/WSL2, así que **NO** se monta dentro del contenedor. Se eligió:

**Script externo + API HTTP** (corré en Windows/WSL2 con la unidad Z: mapeada).
- Ventaja: no requiere tocar docker-compose, montar SMB en WSL2, ni exponer
  credenciales de red al contenedor.
- El script `scripts/migrar-documentos.js` lee la carpeta y sube por HTTP a la
  API de SolidOps (`POST /api/documents/upload`).
- Idempotente: si un archivo ya se subió (mismo hash/título+carpeta), no se re-subie.

### Cómo acceder al recurso desde WSL2 (pasos, para reproducir)

1. Con la VPN activa, montá la unidad compartida en Windows: `net use Z: \\10.88.88.150\SolidoCS_Ambientes` (o desde el Explorador → Mapear unidad de red → `Z:`).
2. Desde WSL2 esa unidad aparece como `/mnt/z/`. El script puede correr con
   `--root "/mnt/z"` o con la ruta `Z:\\SolidoCS_Ambientes` si corrés con `cmd.exe`.
3. Verificá que el script puede leerla: `node scripts/migrar-documentos.js --dry-run --root "Z:\SolidoCS_Ambientes"`.

---

## Reglas de migración implementadas

### ⚠️ Fix del matching (causa raíz del 0%)
El bug original daba **0 de 2515 archivos matcheados** porque:
1. El script en `--dry-run` **no pasaba `--token`** (solo lo validaba en `--run`), así que
   `GET /api/customers` devolvía **401** y el `catch` lo **tragaba** en dry-run
   (`if (!DRY) throw e`) → `customers = []` → **ningún match**.
2. La comparación era **normalización simple + exigencias de igualdad** que no toleraban
   diferencias de tildes/espacios/sufijos legales ni duplicados en la BD.

**Fix aplicado**:
- Se exige `--token` **siempre** (también en dry-run) para consultar clientes; si la
  consulta falla, el script **aborta** con error claro (no traga).
- Matching **tolerante**: normaliza sin tildes/puntuación/símbolos, quita sufijos
  legales (SA/SRL/…) y usa similitud por tokens (Dice) + contención, con umbral.
- **Duplicados de la BD** (ej. `Solidocs`/`SolidoCS`, `Internegocios Sa`/`S.A.`): si
  dos candidatos tienen el **mismo nombre normalizado**, se elige el mejor (no es
  ambigüedad real).
- **Antifalsos positivos**: nombres de 1-2 letras ("Am", "Mc") se descartan salvo
  coincidencia exacta; si hay dos candidatos con nombres **distintos** muy cercanos
  (ambigüedad genuina), **no se fuerza** — queda en "Recursos generales" con la
  sugerencia de candidatos.
- **Regla dura**: el script **nunca crea un Customer ni fusiona carpetas**. Solo
  asigna a clientes ya existentes con certeza razonable; ante duda → Recursos generales.

Resultado del dry-run (estructura de prueba): `Internegocios→Sa`, `SolidoCS→Solidocs`,
`Metalúrgica Mercedinina→Metalúrgica Mercedes`; ambigüedad señalada para
`Calandri e Hijos S.A`, `Frigorífico El Mercedino`, `Metalúrgica Mercedes - copia`.

### Cómo correrlo
```bash
# 1) Generá un token (se pide la contraseña OCULTA — no queda en el historial)
node scripts/generar-token.js --api http://localhost:4000 --email info@solidocs.com.ar

# 2) Usar el token en el script de migración
# SIEMPRE con --token (incluso dry-run)
node scripts/migrar-documentos.js --root "Z:\SolidoCS_Ambientes" \
  --api http://localhost:4000 --token <JWT> --dry-run        # reporte
node scripts/migrar-documentos.js --root "Z:\SolidoCS_Ambientes" \
  --api http://localhost:4000 --token <JWT> --run            # subir
```

### Fixes aplicados tras la prueba real de 2 clientes (bugs encontrados)

**1. Mojibake en nombres con tildes/ñ (crítico)** — `gestión` se guardaba como
`gestiÃ³n`, `información` como `informaciÃ³n`. **Causa**: multer decodifica los
nombres de archivo del multipart como **latin1**, rompiendo UTF-8. **Fix** en el
backend: `DocumentsService.fixName()` re-decodifica `latin1→utf8` solo cuando el
nombre contiene caracteres latin1-high (evita corromper nombres ya correctos).
Verificado: `POLÍTICA DE RESGUARDO DE INFORMACIÓN.docx`, `gestión sincronización.xlsx`
se guardan con tildes correctas.

**2. Archivos temporales/basura de sistema** — `~$Gestion_...xlsx` (bloqueo de
Office, 0 KB), `Thumbs.db`, `desktop.ini`, `.DS_Store`, `.tmp` se filtraron del
listado a migrar. La carpeta `#recycle` (papelera del NAS) se **excluye por completo**
del recorrido (no va a "Recursos generales").

**3. Deduplicación ampliada con tolerancia** — la original era solo para pares
`docx/pdf`; ahora también unifica dos **editables** con basename normalizado
(ignora espacios extra y mayúsculas): `...18012024.docx` + `...18012024 .xlsx` se
migran como una sola entrada (la de mayor prioridad `docx>xlsx>pptx`). Un `.pdf`
**sin par editable** ya no se descarta: se conserva como documento standalone.

**4. Clientes procesados visibles** — el reporte ahora muestra "Clientes procesados"
(cliente × archivos) y loguea cada carpeta (`[procesado]`). Si `--limit-clientes N`
corta antes de un cliente, se ve claramente (el cliente 2 puede quedar sin procesar
si el 1º ya alcanzó el límite).

**Prueba registrada** (`--run --limit-clientes 2`, estructura de prueba): cliente
"Empresas" recibió 3 documentos **con tildes correctas y sin basura**, `Control...
.xlsx` deduplicado (una entrada), y el reporte muestra el desglose. La limpieza
borra los documentos de prueba y su auditoría para dejar la base migrando limpia.

`scripts/generar-token.js` es un helper puntual que llama al **mismo** endpoint de
login del sistema (`POST /api/auth/login`), confirma que el rol es Admin/Supervisor
(por convención de scripts administrativos) e imprime el JWT listo para pegar.
Valida rol y credenciales (si son incorrectas o el rol no es permitido, aborta).
El token generado es un JWT normal de sesión (sirve para cualquier endpoint
autenticado, ej. probado con `GET /api/customers` → 200).

### Aviso "posibles variantes"
El reporte (dry-run) agrupa carpetas con nombres parecidos entre sí (duplicados,
errores de tipeo, sufijos `- copia`) en la sección "Posibles variantes del mismo
nombre" — **solo informativo; no se unen ni se descartan automáticamente**. El
usuario decide manualmente si reasociar alguna a mano.

**Nota sobre nombres ambiguos (opción complementaria a futuro)**: el guard
automático de `bestMatch` (ver "Guard antifalso-positivo") ya frena el patrón
cliente-corto + palabra común. Como **capa opcional adicional**, se puede mantener
una lista de nombres ambiguos conocidos (ciudades/palabras genéricas: "Mercedes",
"Empresas", "Sindicato", "Laboratorio"…) para que **nunca** se acepten como match
automático y siempre requieran confirmación humana o vayan a Recursos generales.
Hoy no es necesario: el guard por cobertura cubre el caso de forma genérica.

### Estructura (confirmada en capturas)
- **~116 carpetas nivel superior** en `SolidoCS_Ambientes`. No todas son clientes:
  `Diagramas` y `Correo Argentino` son ambiguas → van a **Recursos generales** así
  como cualquier carpeta sin match.
- **`Clientes ya no abonados`** es contenedora: cada subcarpeta adentro es un
  cliente **inactivo**. Cada subcarpeta se trata como cliente aparte (marcado como
  inactivo si existe el campo `Customer.active`).
- **Subcarpetas por área** dentro de cada cliente (ej. `Hosting y web`,
  `Infraestructura de red`, `Seguridad informática`, …) se preservan como
  `document.category_path` (ruta jerárquica con `/`).
- **Archivos sueltos en la raíz del cliente** (fuera de área) van con
  `category_path = null` (categoría "General").
- **Deduplicación docx/pdf**: pares `Nombre.docx` + `Nombre.pdf` en la misma carpeta
  = mismo documento; el `.docx`/`.xlsx` es el documento **principal**, el `.pdf` se
  guarda como adjunto de referencia del mismo registro (no entrada separada).

### Credenciales (sensitive)
- Carpetas cuyo nombre sugiere credenciales ("Credenciales", "Accesos",
  "Seguridad informática", "VPN", …) → doc `sensitive=true` / `documentType='credenciales'`.
- Se genera una lista para que el usuario revise y corrija la clasificación automática.

### Clientes sin match → "Recursos generales"
- **Nada se descarta.** Lo que no matchea contra un `Customer` va con
  `customer_id = null`, agrupado en **"Recursos generales"**, siempre visible y
  buscable. El usuario puede reasociar manualmente después.

### Verificación del dry-run completo (3 anomalías, resueltas)

Dry-run real sobre la carpeta (`--root` vía UNC `\\10.88.88.150\SolidoCS_Ambientes`
— `Z:\` no mapeada, el script acepta la UNC):
**2509 archivos · 2365 con cliente · 144 → Recursos generales · 45 carpetas sin match.**

1. **"Mercedes" (3 entradas en el reporte)** → **NO es un falso positivo**. Hay un
   `Customer` real llamado exactamente "Mercedes" (`c0ad6874`, contacto Esteban
   Basualdo, `ebasualdo@mercedes.gob.ar`). Las 3 entradas son las carpetas
   `Elec-Tra Mercedes` y `Rodamientos Mercedes` (activas e inactivas) cuyo nombre
   **no tiene su propio `Customer` cargado** (no existe "Elec-Tra" ni "Rodamientos"),
   así que caen al paraguas "Mercedes" (score 0.500 / 0.667 ≥ umbral 0.5). El
   `similarity` usa la cobertura del **nombre más corto**, por lo que un cliente
   genérico de 1 palabra gana sobre carpetas compuestas que no tienen dueño. Esto
   es **deseado**: esos documentos NO se pierden, se asocian al cliente Mercedes.
   El nombre mostrado en el reporte es el real (no es truncado).

2. **"Hierros Mercedes" con 925 archivos** → **legítimo**. La carpeta técnica
   `Hierros Mercedes\HIERROS` concentra **886 archivos (1.86 GB, 653 PDFs de
   equipos/facturas)**; el resto son subcarpetas de área (Dominio, Hosting,
   Infraestructura, etc.). El desglose del reporte es coherente: todos los archivos
   pertenecen a ese cliente, **no se absorbió contenido ajeno**. La recursión
   (`walk`) está bien delimitada por carpeta de cliente.

3. **"Pares docx/pdf: 0"** → **bug del contador, la deduplicación sí funciona**.
   - En `dedupe()` un `.pdf` con par editable homónimo se descarta con `continue`
     **sin marcar nada**, y los editables duplicados solo se marcan con
     `duplicatePdf: false` (nunca `true`). Por eso el loop contador
     `if (f.duplicatePdf) dupPairs++` **siempre** quedaba en 0.
   - **Fix**: `dedupe()` ahora cuenta los `.pdf` descartados por tener par editable
     (`kept.duplicatePdfs`) y `processCustomerFolder` lo suma a `dupPairs`.
   - Resultado corregido: **`Pares docx/pdf: 400`** (verificado con fichero
     independiente que recorre el corpus con la misma `baseOf`: 402 pares
     reales; el reporte cuenta los .pdf descartados, la diferencia es por
     normalización de espacios en nombres borde). El conteo de **archivos totales
     no cambió** (2509) — solo se arregló el número documentado de pares.

### Guard antifalso-positivo: clientes cortos con palabra común (ciudad/nombre genérico)

**Problema confirmado**: el `Customer` "Mercedes" (contacto
`ebasualdo@mercedes.gob.ar`) es el **Municipio de Mercedes**. Las carpetas
`Elec-Tra Mercedes` y `Rodamientos Mercedes` matcheaban contra él (score 0.5/0.667)
solo porque "Mercedes" es el **nombre de la ciudad**, no el cliente — son negocios
privados sin relación con el municipio. Es el mismo patrón que "Empresas"/"backups":
una palabra muy frecuente en los nombres de carpeta generando un match sin
identidad real.

**Causa raíz**: la cobertura existente mide cuánto del nombre **más corto** (el del
cliente) está en la carpeta — que es 100% por construcción cuando el cliente es de
1 palabra. Se agregó la métrica inversa: qué proporción del nombre de la **carpeta**
está cubierta por el cliente.

**Fix (en `bestMatch`)**:
- `folderCoveredByCustomer(folder, cliente)`: proporción de tokens de la **carpeta**
  (sin ruido) coincidentes con el cliente.
- `isSuspiciousShortMatch`: si el cliente es de **1 token significativo** y esa
  proporción es `<= 0.5` (la palabra del cliente es minoría en la carpeta) → el
  match se rechaza y la carpeta va a **Recursos generales**.
- `cleanTokens`: elimina tokens residuales de duplicado/copia (`copia`, `backup`,
  `nuevo`, `original`, `final`, `antiguo`…) para que `Zurich - copia` siga siendo
  la misma empresa que `Zurich` y no se rompa el match legítimo.
- El reporte marca estos casos como `(sospecha falso-positivo: <cliente>)`.

**Resultado del nuevo dry-run (256 archivos relevantes)**:
- `Elec-Tra Mercedes` y `Rodamientos Mercedes` (activas e inactivas) → **Recursos
  generales** (ya no a "Mercedes"). ✓
- También se frena el patrón genérico: `Laboratorio Repetto` ya no va a "Laboratorio"
  (paraguas), `Sindicato Argentino de Televisión` ya no va a "sindicato", `Metalúrgica
  Mercedina`/`Mercedinina` sin match → Recursos generales. ✓
- **No se rompieron los legítimos**: `Calcimer`, `Intermer`, `Melacrom`, `Orella`,
  `OVODEC SA`, `Prodelimp`, `Sansur`, `SolidoCS`, `TMC`, `Zurich` (+`Zurich - copia`),
  `Hierros Mercedes` (925), `Metalúrgica Mercedes` (+`- copia`), `Imprenta Mercedes`,
  `Cimes Mercedes`, `Colegio de Asistentes Sociales de Mercedes` → siguen matcheando. ✓
- Conteo nuevo: **`Con cliente: 2262 · Sin cliente → Recursos generales: 247`**
  (antes 2365/144). Es el efecto esperado: las carpetas con solo coincidencia de
  ciudad/palabra común ahora van a Recursos generales en vez de mezclarse en la
  ficha de un cliente no correspondiente.

---

## Modelo de datos

`Document` (extendida): `customer_id` (nullable), `asset_id`, `site_id`, `title`,
`category_path`, `storage_path` (MinIO), `raw_filename`, `mime_type`, `size_bytes`,
`hash_sha256`, `source` (`email|upload|migracion`), `source_path`, `status`,
`sensitive`, `document_type` (`manual|diagrama|credenciales|otro`), `extracted_text`,
`search_vector` (FTS tsvector + GIN).

`DocumentVersion`: `document_id`, `version_number`, `storage_path`, `raw_filename`,
`mime_type`, `size_bytes`, `hash_sha256`, `note`, `created_by_user_id`.

**FTS**: PostgreSQL Full Text Search (tsvector `spanish` + índice GIN + trigger
`tsvector_update_trigger` sobre `title`+`extracted_text`). Creado en
`DocumentsService.onModuleInit` (synchronize no lo emite).

---

## Permisos / acceso

Todos los roles (Administrador, Supervisor, Coordinador, Técnico, Consulta) tienen
`documents:read` **y** `documents:write` — decisión confirmada: todos pueden crear,
editar y subir nuevas versiones de documentos, tanto como verlos (incluidos los de
credenciales). La auditoría de vista/descarga/sube de documentos sensibles es el
único control de trazabilidad (el `AuditInterceptor` global registra accesos).

## UI

- **Página `/documentos`** — vista **tipo Explorador de Windows**: lista de clientes
  → carpetas clickeables (navegación carpeta por carpeta) → breadcrumb para volver,
  y al nivel final los archivos con su nombre simple. Se construye desde el campo
  `category_path` (jerarquía guardada en la migración; el último segmento es el
  archivo, los anteriores son carpetas). No requiere modelo de datos nuevo.
- **Vista previa sin descargar**: al hacer clic en un documento se abre un modal con
  el contenido renderizado en el navegador. PDFs/imágenes se sirven `inline`; Word/
  Excel/PowerPoint se **convierten a PDF on-demand** (servicio `lo-converter`) con
  **caché por versión en MinIO** (una nueva versión genera su propio preview, no
  reusa el de una versión vieja). Formatos sin vista previa (`.zip`, `.eddx`, …)
  muestran un mensaje claro y ofrecen descarga.
- **Ficha 360 del cliente**: sección "Documentos" con el box del cliente + enlace
  "abrir explorador de Documentos →" (enlaza a `/documentos?cliente=<uuid>`, que
  abre el explorador directo en la ficha de ese cliente).
- **Subida contextual**: desde cualquier punto de la navegación, el botón "+ subir
  documento" arma el `category_path` con la carpeta actual **+ el nombre del
  archivo** (último tramo = archivo), igual que la migración. Así un archivo nuevo
  queda dentro de la carpeta donde está parado el usuario (antes era solo la carpeta,
  y el archivo quedaba mal clasificado como ruta intermedia).
- **Crear carpeta nueva**: input "+ carpeta" que crea una categoría vacía
  (documento `documentType='carpeta'`) reservando el lugar en el navegador, sin
  subir archivos. Endpoint `POST /api/documents/folder`. El `explorerTree` trata
  estas como carpetas (no archivos) y las muestra aunque estén vacías.

### Shape del endpoint y manejo defensivo del explorador

- `GET /api/documents/explorer/tree` devuelve un **array** de grupos
  `[{ id, name, children: [{ folder, list }] }]` (clientes + "Recursos generales"
  con `id: null`), NO un objeto `{ customers: [...] }`.
- **Bug detectado**: el frontend esperaba `{ customers: [...] }` y hacía
  `tree.customers.find(...)`. Con la BD vacía el backend devuelve `[]` (array
  vacío, "truthy" → pasa el chequeo `if (!tree) return null`), así que
  `tree.customers` es `undefined` → `Cannot read properties of undefined
  (reading 'find')`. **Causa raíz**: desajuste entre el shape del backend (array)
  y el contrato del frontend (objeto `{ customers }`).
- **Fix**: el frontend tipa `tree` como `TreeGroup[]`, valida `Array.isArray(tree)`
  y usa `tree.find(...)` (sin `customers`). Además añade validación de
  `group.children` como array. Soporte de deep-link opcional
  `/documentos?cliente=<uuid>` (valida el formato UUID; si falta o no es válido, se
  mantiene en "Recursos generales" en vez de romper). El preview libera los blobs
  con `useRef` en vez de una variable global `window.__previewUrl`.

## Regla de acceso a datos

**Nada depende de la carpeta de red `\\10.88.88.150\SolidoCS_Ambientes`.**
- La navegación (explorerTree), la vista previa (getPreview) y la descarga operan
  **exclusivamente sobre MinIO** (`storage.getObject`).
- `source_path` en `Document` es solo un **dato de referencia histórica** (idempotencia
  de la migración); **nunca se lee** en tiempo real.
- Verificado: 0 referencias a la ruta SMB en el backend; con la VPN/carpeta fuera de
  alcance, navegar y previsualizar sigue funcionando.
- **Descarga por el backend (no presigned al host interno)**: el presigned de MinIO
  generaba URLs `http://minio:9000/...` (host interno de Docker), **inaccesibles
  desde el navegador** — por eso el botón "descargar" no hacía nada. La descarga
  ahora se sirve **por el backend** (`GET /documents/:id/download` → sprint con
  `Content-Disposition: attachment`), que lee de MinIO y entrega el archivo al
  navegador. Funciona igual desde el explorador y desde la Ficha 360.

---

## Vistas del explorador (inicial y por cliente)

- **`/documentos`** (sin parámetro) → **vista inicial: lista de clientes con
  documentos** (grilla), más "Recursos generales". Al hacer clic en un cliente se
  entra a su árbol de carpetas; "Recursos generales" entra a su bandeja propia.
- **`/documentos?cliente=<uuid>`** → abre directo el explorador de ese cliente
  (usado por la Ficha 360 y el deep-link).
- **Navegación**: carpetas clickeables → subcarpetas → archivos con nombre simple;
  breadcrumb con cada nivel clickeable para volver. Se construye de `category_path`
  (último tramo = archivo; anteriores = carpetas).
- **Ficha 360**: la sección "Documentos" mantiene la lista compacta pero cada fila
  tiene "ver" (lleva al explorador del cliente) + "descargar" (por backend).
- **Subida contextual**: "+ subir documento" arma `category_path` = carpeta actual +
  nombre del archivo (último tramo = archivo). "+ carpeta" crea una categoría vacía.

### Fix: "Failed to execute 'json' on 'Response'" al abrir un Word

**Síntoma**: al previsualizar un Word (ej. `CONTACTOS.docx`) el modal mostraba el
error técnico `Failed to execute 'json' on 'Response': Unexpected end of JSON input`.

**Causa raíz (NO era la conversión)**: el cliente HTTP del frontend
(`lib/api.ts` → `api.request`) hacía `return await res.json()` para **cualquier**
respuesta 2xx, incluso las de **cuerpo vacío**. El `POST /documents/:id/view`
(auditoría de acceso) devuelve `201` con **0 bytes** → `res.json()` sobre `''`
lanzaba el error. `openPreview` lo capturaba y lo mostraba como mensaje del modal
(por eso el modal abría con el título y "descargar" pero el cuerpo mostraba el
error crudo).

**Fix** (`lib/api.ts`): `api.request` ahora lee `res.text()`; si el cuerpo está
vacío devuelve `undefined` (sin intentar `.json()`), y si no, parsea JSON
resguardado. Esto arregla el bug para TODOS los endpoints que responden con body
vacío. Además, `fetchPreviewBlob` del explorador maneja mejor el cuerpo de error
(lee `text`, ¿extrae `message`; si no es JSON, mensaje genérico).

**Falló de conversión puntual (422)**: algunos `.docx` de gran tamaño (105 MB)
fallan la conversión → el backend devuelve `422` con el mensaje JSON
`"No se pudo previsualizar este archivo"`. El frontend corregido muestra ese
mensaje (no el error crudo) y ofrece la descarga. La conversión de Words normales
funciona (200, `application/pdf`).

### Fix: PDF nativo — descarga `preview.htm` + área en negro

**Síntoma**: al abrir un PDF nativo (ej. `SLA "LAB PACHIANI - VALLE" v2022 Sin
Valorizar.pdf`) el navegador avisaba `descarga de preview.htm` y el modal se veía
en **negro/vacío**.

**Causa raíz 1 — `preview.htm`**: el botón "descargar" del modal apuntaba a
`GET /api/documents/:id/preview` (el endpoint de vista previa) en lugar de al
endpoint de descarga. Con el atributo `download`, el navegador intentaba descargar
el recurso de esa URL (que responde `Content-Disposition: inline` con el nombre en
`encodeURIComponent`, sin extensión clara al forzar descarga) → el navegador
inventaba un nombre `preview.htm`. **Fix**: el botón ahora usa
`GET /api/documents/:id/download` (que responde `Content-Disposition: attachment`
con el `filename.pdf` real) — la descarga funciona y ya no aparece `preview.htm`.

**Causa raíz 2 — área en negro**: el modal inyectaba un `<iframe src="blob:...">`
para el PDF. Chrome a veces no renderiza PDFs dentro de `<iframe>` con un Blob
(deja el área en negro). **Fix**: se usa `<object data="{blobUrl}"
type="application/pdf">` que Chrome sí renderiza de forma fiable. El `type` del
`<object>` se deduce del `blob.type` (PDF o imagen).

**Camino separado**: los PDFs nativos siguen sirviéndose directo (`inline`,
`application/pdf`, sin pasar por `lo-converter`); los Office se convierten on-demand
con caché. Solo cambió cómo el frontend lo renderiza (<object> en vez de <iframe>).

### Fix: contenido binario crudo en vista previa (documento que cuelga la conversión)

**Síntoma**: al abrir "INFRAESTRUCTURA DE RED.docx" el modal mostraba el contenido
binario del archivo (caracteres ilegibles) en vez del PDF o el mensaje de error.

**Causa raíz** (dos partes):
1. **lo-converter sin timeout**: la conversión de ese `.docx` cuelga a LibreOffice
   (contenido que no puede procesar o muy complejo) y `convertToPdf` hacía
   `fetch(...)` **sin timeout** → el request del preview quedaba esperando para
   siempre (más de 60-90s) en vez de fallar.
2. El frontend, ante ese timeout/hang, terminaba recibiendo un estado inconsistente
   y mostraba el binario.

**Fix**:
- Backend (`documents.service.ts` → `convertToPdf`): la llamada a `lo-converter`
  ahora usa un `AbortController` con **timeout** (`LO_CONVERTER_TIMEOUT_MS`,
  default 60000ms). Si LibreOffice no responde, se aborta → `null` →
  `getPreview` lanza `CONVERT_FAILED` (422) → el frontend muestra el mensaje claro.
- Frontend (`documentos/page.tsx` → `fetchPreviewBlob`): **blindaje** — verifica que
  el blob devuelto sea `application/pdf` o imagen; si es cualquier otro tipo (ej.
  el binario de un docx sin convertir), lanza error → muestra "No se pudo
  previsualizar este archivo" en vez de renderizar binario como texto.

**Resultado**: cualquier fallo de conversión (documento que cuelga, archivo muy
grande, corrupto) termina **siempre** en el mensaje claro `"No se pudo
previsualizar este archivo"` con opción de descarga, nunca en binario crudo.



## Env vars / compose

- **Servicio `lo-converter`** (conversión Office→PDF con LibreOffice headless) agregado
  al `docker-compose.dev.yml` como servicio aparte (mantiene la imagen del backend
  liviana). Imagen resultante: **~1.06GB** (compressed 299MB) — solo este servicio
  pesa, no el backend ni el frontend.
- **Env nueva**: `LO_CONVERTER_URL` (default `http://lo-converter:8000`) — URL interna
  del servicio de conversión que usa el backend para la vista previa de Office.
- **Token de scripts**: `JWT_ADMIN_EXPIRES_IN` (default `7200` = 2h), ver sección
  "Operación: migración real".
- El módulo usa MinIO ya configurado (`MINIO_*`). `ENCRYPTION_SECRET` preexistente.

---

## Operación: migración real

### Token administrativo extendido (JWT de 2h)
El JWT normal de sesión dura 15 min (`JWT_EXPIRES_IN`), insuficiente para una
migración de ~2500+ archivos. Para scripts administrativos se genera un accessToken
con duración extendida, **sin alterar la sesión del navegador**:
- El backend acepta `purpose: "admin"` en el login (`POST /api/auth/login`). Solo si
  el usuario es **Administrador**, firma el accessToken con `JWT_ADMIN_EXPIRES_IN`
  (default 2h). Un no-admin que pida `purpose:"admin"` sigue con 15 min.
- `scripts/generar-token.js --admin` solicita este token extendido. Sigue siendo
  `type:"access"` (lo valida el `JwtStrategy`) — no es indefinido.
- Verificado: token normal = 15 min; token con `--admin` = 120 min.

### Timeout + reintentos + feedback (script)
- Cada llamada HTTP usa `fetchWithTimeout` con `--timeout` (segundos, default 60). Si
  se agota, el archivo se loguea como fallido y se **continúa con el siguiente**.
- `--retries` (default 3): reintenta un archivo ante fallo transitorio.
- Feedback continuo: cada `--progress-every` (default 10) subidas loguea
  `[N] ok=N fallos=K (cliente)`. Al final, el reporte lista `== ARCHIVOS FALLIDOS ==`.

### Resultado (migración 2026-08-31)
- **4302 documentos** subidos + versión; sin procesos colgados; idempotente.
- **2 archivos gigantes** fallaron por lectura de Node sobre el share SMB
  (`UNKNOWN: unknown error, read`) — `PADRON.DBF` (365 MB) y `HIERROS.rar` (491 MB).
  No es la subida ni MinIO: es `fs.readFileSync` de Node leyendo >300 MB sobre la UNC.
  Se subieron por `curl` (el backend los acepta, el límite es la lectura del cliente).
  El backend NO tiene límite de multer bloqueante para estos tamaños (383 y 491 MB →
  HTTP 201).

---

## Pruebas en vivo (registradas)

Backend (scripts temporales vía `DocumentsService`):
- Upload normal (`sensitive=false`), credenciales → `sensitive=true`.
- List por cliente, **versionado** (V2 → `versions=2`), download presigned (auditado).
- **Audit** con usuario real (`create` + `download` con `meta:{sensitive:true}`).
- **FTS**: `search "manual"` → 1, `search "credenciales"` → 1.

Vista previa / navegación:
- **Vista Explorer**: `explorer/tree` devuelve cliente "Empresas" con carpetas
  `Control diario 2024`, `Gestion antigua`, `Informes`, `Plantillas`, `Procesos` y
  subniveles (`Informes/Informes por empresa/CALCIMER/...`). ✓
- **PDF inline**: `GET /documents/:id/preview` → 200, `Content-Type: application/pdf`,
  `Content-Disposition: inline`, bytes reales. ✓
- **PNG inline**: 200, `image/png`. ✓
- **Word→PDF (conversión)**: DOCX real → 200 `application/pdf`, 172KB, ~4.2s (1ra vez). ✓
- **Caché por versión**: 2da llamada al mismo DOCX → 0.09s; lo-converter solo 1 conversión;
  PDF cacheado en MinIO (`*.preview.pdf`). ✓
- **Nueva versión → nuevo preview**: subida V2 → preview reconvierte (no reusa el cache
  viejo), se crea un 2º `*.preview.pdf`. ✓
- **Sin vista previa**: `.zip`/`.eddx` → 422 `"Este archivo no tiene vista previa disponible"`. ✓
- **Sin dependencia de red**: 0 referencias a la ruta SMB; todo desde MinIO. ✓

Pendiente de ejecución por el usuario (requiere VPN + unidad Z:):
- `node scripts/migrar-documentos.js --dry-run --root "Z:\SolidoCS_Ambientes"` → reporte.
- Revisar el reporte y confirmar el backup antes de la migración real.

---

## Ejecución completada (2026-08-31)

La migración real se ejecutó con éxito:

```bash
node scripts/migrar-documentos.js --root "\\10.88.88.150\SolidoCS_Ambientes" \
  --api http://localhost:4000 --token <JWT-admin-2h> --run --timeout 60 --retries 3
```

- **4302 documentos** subidos con su versión (el `--run` es idempotente: `Ya existían`
  saltó los ya migrados).
- Feedback continuo `[N] ok=N fallos=K (cliente)` y `[procesado] "cliente" (N archivos)`.
- Solo 2 archivos gigantes (`PADRON.DBF` 365 MB en `Hierros Mercedes/HIERROS`,
  `HIERROS.rar` 491 MB) no pudieron leerse con `fs.readFileSync` de Node sobre el
  share SMB (`UNKNOWN: unknown error, read`) y se subieron con `curl`:
  ```bash
  curl.exe -X POST "http://localhost:4000/api/documents/upload" \
    -H "Authorization: Bearer <jwt>" \
    -F "file=@\\10.88.88.150\SolidoCS_Ambientes\Hierros Mercedes\HIERROS\PADRON.DBF" \
    -F "title=PADRON" -F "customerId=2d535bb2-7d63-4cec-a393-8fb9a685d2a6" \
    -F "categoryPath=HIERROS" -F "source=migracion" -F "sourcePath=Hierros Mercedes/HIERROS/PADRON.DBF"
  ```
  (idem para `HIERROS.rar`). Ambos dieron HTTP 201.

### Exclusión posterior: "Hierros Mercedes" (a pedido del usuario)

**Decisión del usuario**: todo el contenido migrado de **"Hierros Mercedes"**
(`customer_id` `2d535bb2-7d63-4cec-a393-8fb9a685d2a6`) era material legacy sin valor
(bases de datos dBase `*.DBF`, `PADRON.DBF`, `HIERROS.rar`, `.sql`, etc.), por lo que
se borró **a propósito** (2026-08-31). El cliente como tal se conserva (la Ficha 360
queda sin documentos), solo se eliminaron sus documentos/objetos.

- **BD**: `DELETE` de `document_versions` y `documents` por `customer_id` exacto
  (1809 docs + 1809 versiones). **No** se borraron los `audit_logs` (quedan como
  rastro histórico de que existieron y se borraron a propósito — mismo criterio
  que el caso "Empresas").
- **MinIO**: se liberaron los **1809 objetos** huérfanos (≈**4.4 GB**, incluye
  `PADRON.DBF` 365 MB y `HIERROS.rar` 491 MB). Se aislaron por comparación: se
  mantuvieron los objetos que aún están referenciados en la BD (docs de otros
  clientes) y se borraron los que no.
- **Verificado**:
  - docs de "Hierros Mercedes" = 0 (BD y API `?customerId=`).
  - explorer tree: "Hierros Mercedes" ya no aparece.
  - Ficha 360: renderiza 200, sección Documentos vacía.
  - **Otros clientes con "Mercedes" intactos** (`Cimes Mercedes` 288,
    `Metalúrgica Mercedes` 77, `Imprenta Mercedes` 10) — el filtro fue por
    `customer_id` exacto, sin coincidencia por nombre.
  - MinIO consistente con BD (2493 objetos = 2493 docs).

---

## Fix: descarga del PDF nativo bajaba "preview.htm" (no el .pdf)

### Síntoma
Al clicar "descargar" en el modal de vista previa de un PDF nativo, el navegador
bajaba un archivo llamado **`preview.htm`** en vez del `.pdf` real. Persistía tras
`Ctrl+F5`, aunque el código fuente del modal ya apuntaba a `/download`.

### Investigación con evidencia real (bundle servido por el navegador)
Se inspeccionó el chunk **servido por `localhost:3000`**
(`apps/(app)/documentos/page.js`) y se confirmó que el **bundle ya tenía el código
correcto**: `function API_DOWNLOAD(id){ return "/api/documents/".concat(id,"/download"); }`
y el botón del modal usaba `href: API_DOWNLOAD(preview.id)`. Es decir, el fix NO
estaba en que el código fuera viejo — el navegador cargaba el bundle nuevo.

### Causa raíz
El botón era un `<a href="/api/documents/:id/download" target="_blank" download>`.
Un `<a href>` plano **no envía el header `Authorization: Bearer <token>`**, y el
endpoint `/download` está protegido → devuelve **401 Unauthorized**. El navegador,
al hacer clic, recibe esa respuesta 401 (contenido HTML/JSON de error) y, al tener
el atributo `download` sin un filename con extensión conocida, **guarda esa
respuesta como `preview.htm`**. Verificado: `GET /api/documents/:id/download` sin
token → **401**; con token → **200** `Content-Disposition: attachment; filename="SLA....pdf"`.

### Fix aplicado (frontend `documentos/page.tsx`)
Se reemplazó el `<a href>` plano por un `<button onClick={() => downloadDoc(id)}>`
con una función `downloadDoc` que:
1. Hace `fetch` al endpoint `/download` **con el `Bearer` token** (igual que el
   `fetchPreviewBlob`).
2. Lee el **`Content-Disposition`** de la respuesta y usa su `filename` real
   (decodificado con `decodeURIComponent`) para `a.download` — ej. `"SLA....pdf"`.
3. Crea un `<a download>` a partir de un `ObjectURL` del blob y dispara el clic.

Resultado: la descarga va con token (ya no 401), y el archivo conserva su nombre
real `.pdf` — **nunca `preview.htm`**.

### Fix: el nombre de descarga venía sin extensión (.pdf/.docx)

**Síntoma**: la descarga traía el contenido correcto, pero el diálogo de guardado
proponía el nombre **sin la extensión** (usuario tenía que agregar `.pdf`/`.docx`
a mano para que abriera bien).

**Causa raíz**: el frontend lee el `filename` de
`res.headers.get("content-disposition")`. Pero el fetch es **cross-origin**
(frontend `:3000` → backend `:4000`), y en una respuesta cross-origin el header
`Content-Disposition` **no se expone al JS** a menos que el backend mande
`Access-Control-Expose-Headers: Content-Disposition`. Como no estaba, el JS recibía
`cd = ""`, el regex no matcheaba y `filename = "documento"` (sin extensión). El
contenido del blob sí llegaba (por eso el archivo abría bien al agregar extensión).

**Fix (backend `main.ts`)**: se agregó al `enableCors` →
`exposedHeaders: ['Content-Disposition']`, para que el header llegue al JS y el
`downloadDoc` pueda armar el nombre con extensión real.

**Verificado** (fetch cross-origin con `Origin: http://localhost:3000`):
- `Access-Control-Expose-Headers: Content-Disposition` presente ✓
- `filename extraido: SLA "LAB PACHIANI - VALLE" v2022 Sin Valorizar.pdf` — **con
  `.pdf`** ✓ (antes: `"documento"` sin extensión)

Ahora el diálogo de guardado propone el nombre completo con extensión.

---

## Fix: race condition en la vista previa (PDF intermitente / binario crudo)

### Síntoma
Para el MISMO documento (ej. `CONTACTOS.docx`), a veces la vista previa se veía
como PDF correcto (930 kB) y a veces como **binario ilegible**, aunque la pestaña
Network mostrara siempre **200, 930 kB, bytes correctos**. El backend, MinIO,
lo-converter y CORS quedaron descartados con evidencia (los datos llegan bien
siempre). El patrón era intermitente y dependía de la velocidad de la respuesta
(13-16s conversión nueva = OK; ~23ms cacheada = binario) → **race condition** en el
frontend, no del dato sino de cómo se renderiza.

### Causas de la race (frontend `documentos/page.tsx`)
1. **`previewHtml` como string inyectado con `dangerouslySetInnerHTML`**: el
   `<object data="blob:...">` se inyectaba como HTML crudo. Al actualizar el estado
   hermano (`setPreview(...)`), React re-renderizaba y **recreaba el elemento
   `<object>`**, re-cargando el blob URL → comportamiento dependiente del timing
   (a veces binario, a veces PDF).
2. **Sin token de generación**: dos `openPreview` superpuestos (abrir A y enseguida
   B, o re-click) podían entrelazarse. Una respuesta rápida (cacheada) podía
   sobrescribir el modal después de una más lenta → contenido mezclado o binario de
   una operación anterior.
3. **`previewUrlRef.current` se asignaba después de `setPreviewHtml`**, y no se
   revocaba el blob anterior antes de exponer el nuevo (URLs vivas en paralelo).

### Fix aplicado (documentos/page.tsx)
- **Render con `<object>` real (React), no `dangerouslySetInnerHTML`**: se guarda
  `previewSrc = { url, type }` en estado y el modal renderiza
  `<object data={previewSrc.url} type={previewSrc.type} />`. React maneja el
  elemento una sola vez; no se recrea en re-renders (fuente del reload según timing).
- **Token de generación (`previewReqRef`)**: cada `openPreview` asigna un id; se
  verifica `req === previewReqRef.current` después de cada `await` — los resultados
  obsoletos se descartan (solo se aplica la apertura más reciente). Evita mezcla de
  contenido entre aperturas superpuestas.
- **Revocación del blob**: se libera `URL.revokeObjectURL` del blob anterior ANTES
  de exponer el nuevo, y en `closePreview()` (que ahora también resetea `previewSrc`
  y `previewMsg`). Los handlers de navegación (`openFolder`/`goPath`/`backTo*`) ahora
  llaman a `closePreview()` en vez de solo `setPreview(null)`, para no dejar URLs
  vivas.
- El blindaje de tipo (`fetchPreviewBlob`) se mantiene (solo acepta PDF/imagen), y
  NO lee la respuesta dos veces (texto y blob son ramas excluyentes, no un solo
  `Response` releído).

### Verificación
- Fuente sin `previewHtml`/`dangerouslySetInnerHTML` (solo en comentario) y sin
  `window.location.search` en render.
- Bundle servido: `previewSrc`, `previewReqRef`, `revokeObjectURL`, `<object>` real.
- Páginas 200: `/`, `/documentos`, ficha cliente, `/clientes`, `/tickets`,
  `/tickets?tray=Users`, `/dashboard`, `/mi-dia`. Backend 200. Typecheck 0 errores.

> **Nota**: requiere que el usuario confirme visualmente (no hay navegador en el
> entorno del agente): abrir `CONTACTOS.docx` y `USUARIOS DE DOMINIO.docx` varias
> veces seguidas, y probar abrir/cerrar rápido con documentos distintos, para
> confirmar que ya no sale binario intermitente.

### Backup / rollback
`backup\preview-race-fix\documentos-page.tsx.bak`.


