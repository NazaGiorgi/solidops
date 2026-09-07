# PROMPT PARA OPENCODE — MÓDULO DE GESTIÓN DOCUMENTAL + KNOWLEDGE BASE

Este módulo se integra a una plataforma de operaciones IT que ya está en desarrollo (login, clientes, técnicos, tickets, agenda — ver contexto en sección 0). Este prompt es autocontenido para que puedas trabajarlo como una instancia separada, pero **todo lo que construyas acá tiene que enganchar con las entidades `Customer`, `Site`, `Asset` y `Ticket` que ya existen en el proyecto principal** — no las recrees desde cero, extendelas.

---

## 0. Contexto del proyecto principal (para que entiendas dónde encaja esto)

Plataforma self-hosted en Docker (desarrollo local en Windows con Docker Desktop/WSL2, migración a VPS después), stack: NestJS + TypeORM + PostgreSQL + Redis + MinIO + Next.js. Modelo de negocio: un MSP (una sola empresa) que da soporte a una cartera de clientes pyme (sin límite fijo — se suman clientes activos e inactivos con el tiempo) con un equipo pequeño de técnicos — no es multi-tenant SaaS, es control de acceso por `customer_id`.

Este módulo agrega: gestión documental, base de conocimiento y (a futuro) un asistente de IA que responde preguntas usando esa documentación como fuente.

---

## 1. Regla obligatoria antes de tocar código: discovery primero

**No asumas la estructura de "Ambientes" (el sistema actual de carpetas compartidas del cliente).** Antes de diseñar la importación, necesitás que el usuario te dé o vos releves:

- Cómo se accede hoy a Ambientes (¿carpeta de red SMB, NAS, servidor de archivos, algo más?).
- Estructura real de carpetas — pedile al usuario 2-3 ejemplos reales de rutas (ej. `/Clientes/EmpresaABC/Redes/...`) para inferir el patrón, no lo inventes.
- Volumen aproximado: cuántos clientes tienen carpeta, cuántos archivos en total, tamaño total aproximado.
- Tipos de archivo predominantes.
- Si hay convención de nombres o es todo libre/inconsistente.

Si no tenés esta información, tu primera entrega no es código — es una lista de preguntas concretas para el usuario. No arranques la importación sin esto.

**Durante toda la primera etapa, Ambientes es la fuente de verdad y la importación es de solo lectura.** No modifiques ni borres nada ahí. Si un archivo desaparece de Ambientes en una sincronización futura, marcalo como `source_deleted = true` en la plataforma, nunca lo borres directamente.

---

## 2. Decisión de arquitectura: motor de búsqueda (ya resuelta, no la reabras salvo el volumen cambie mucho)

La cartera de clientes no tiene límite (se pueden sumar clientes activos e inactivos sin restricción) — pero eso no significa que haya que arrancar con infraestructura de búsqueda pensada para escala masiva. La decisión se toma en base al **volumen real de documentos y consultas**, no a la cantidad de clientes:

- **Full-text search: PostgreSQL Full Text Search nativo** (columnas `tsvector` + índices GIN) sobre el contenido extraído de los documentos. Alcanza de sobra hasta varios miles de documentos con la carga de consultas típica de un equipo de soporte interno (no es un buscador público de alto tráfico).
- **Búsqueda semántica (fase posterior, no MVP): `pgvector`**, ya disponible en la base de datos del proyecto principal — evita sumar una base de datos vectorial separada.
- **No uses Elasticsearch ni OpenSearch en el arranque** — consumen bastante más RAM que el VPS de referencia tiene disponible, y son overkill para el volumen de documentos de un equipo de soporte de este tamaño.

**Diseñá la capa de acceso a búsqueda detrás de una interfaz propia (ej. un `SearchService` con una sola implementación Postgres al inicio)**, no llames a `tsvector`/SQL directamente desde los controladores. Así, si en el futuro el volumen de documentos crece mucho (decenas de miles de archivos, múltiples idiomas, necesidad de ranking más sofisticado), migrar a un motor dedicado es cambiar la implementación detrás de esa interfaz, no reescribir el módulo. La señal para reevaluar es el volumen real de documentos indexados y la latencia de búsqueda observada — no un número de clientes.

---

## 3. Almacenamiento de archivos

Los binarios (PDF, imágenes, DOCX, etc.) van a **MinIO**, el mismo que ya usa el proyecto principal para adjuntos de tickets — no levantes otro object storage. La base de datos solo guarda metadata + texto extraído para búsqueda, nunca el archivo binario completo.

---

## 4. Modelo de datos de este módulo

```
Document (id, customer_id, site_id, asset_id, category_id, title, filename, mime_type,
          storage_path (MinIO), size_bytes, hash_sha256,
          source_system: 'ambientes'|'upload', source_path (ruta original en Ambientes),
          access_level: interno|soporte|infraestructura|administracion|confidencial,
          status: vigente|obsoleto|sin_clasificar, extracted_text (para FTS),
          created_at, modified_at, imported_at, deleted_at)

DocumentVersion (id, document_id, version_number, storage_path, hash_sha256, created_at, author)

Category (id, name, parent_id) — jerárquico: Infraestructura > Redes > Firewall, etc.
Tag (id, name)
DocumentTag (document_id, tag_id)

DocumentLink (id, document_id, entity_type: ticket|incident|asset|maintenance|project, entity_id)
— relación polimórfica: un documento puede asociarse a más de una entidad del sistema principal.

KnowledgeArticle (id, title, body, source_document_id (opcional), status: borrador|publicado,
                  visibility: interno|portal_cliente, customer_id (opcional, si es específico de un cliente))

AIQueryLog (id, user_id, question, documents_consulted[], answer, confidence: alta|media|baja,
            created_at) — auditoría obligatoria de toda consulta al asistente de IA cuando exista.
```

Usá `hash_sha256` para detección de duplicados (mismo hash = mismo contenido, aunque el nombre difiera) y para detectar cambios durante sincronizaciones futuras.

---

## 5. Permisos

Los documentos respetan `access_level` cruzado con el rol del usuario (definido en el proyecto principal). Regla explícita: **si un usuario no tiene permiso para ver un documento, el asistente de IA tampoco puede usarlo para responderle** — esto se valida en la capa de retrieval, no solo en la UI.

---

## 6. Vista "Customer 360"

En la ficha de cada `Customer` (ya existente en el proyecto principal), agregá una sección de documentación que muestre: documentos recientes, documentos marcados como importantes, conteo por categoría, y documentos sin clasificar de ese cliente. Esto es lo que convierte la ficha de cliente en un panorama completo, no solo datos de contacto.

---

## 7. Fases de este módulo (dentro del roadmap general, no bloquean el resto de la plataforma)

**MVP de este módulo:**
- Discovery de Ambientes (sección 1) + diseño de importación read-only.
- Importación inicial (scanner → extracción de metadata → carga a MinIO + Postgres).
- Estructura de categorías y tags.
- Relación documento ↔ cliente/sitio/activo.
- Upload manual + drag & drop desde la plataforma.
- Búsqueda básica (nombre + metadata + full text search sobre contenido extraído).
- Previsualización de PDF/imagen/texto.
- Permisos por nivel de acceso.
- Auditoría de acceso (quién vio/descargó/subió/modificó).
- Bandeja de "documentos sin clasificar" para revisión manual.

**Fase 2 (después del MVP de este módulo):**
OCR para escaneados/imágenes, versionado completo, detección de duplicados por hash, sincronización incremental con Ambientes (watcher de cambios, no solo importación de una vez).

**Fase 3:**
Búsqueda semántica con `pgvector`, resúmenes de documentos vía IA (siempre con link a la fuente), clasificación automática sugerida al importar (nunca automática sin confirmación si hay ambigüedad).

**Fase 4:**
Asistente de IA conversacional con fuentes citadas y nivel de confianza, integración con el chatbot de cara al cliente (con la regla estricta de que el chatbot externo nunca accede a documentación interna, solo a la marcada como `visibility: portal_cliente`), documentos sugeridos automáticamente en el contexto de un ticket abierto.

**Regla de oro para todas las fases de IA:** la IA nunca inventa. Si no encuentra evidencia suficiente, responde "no encontré información suficiente en la documentación disponible" en vez de adivinar. Si encuentra información contradictoria entre dos documentos, muestra ambas fuentes y lo aclara — nunca elige una arbitrariamente. Toda respuesta de IA debe indicar de qué documento salió (y página, si aplica).

---

## 8. Metodología de trabajo (igual que en el resto del proyecto)

Para cada módulo/etapa: explicá qué vas a hacer → implementalo → probalo → verificá que no rompiste nada existente (especialmente las entidades `Customer`/`Ticket` del proyecto principal) → documentá → entregá el fragmento de compose y variables de entorno nuevas → recién ahí segui.

No implementes las fases 3 y 4 (IA/RAG) sin que el usuario haya validado y esté conforme con el MVP y la Fase 2 primero — son las partes más costosas y las que más fácil se hacen mal si la base documental no está bien clasificada primero.
