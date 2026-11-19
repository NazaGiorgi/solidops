# IA local con Ollama — base y Laboratorio de IA

> Este prompt se aplica **sólo en la notebook Windows con Docker Desktop**. Producción (IBM M3) se hace después con el prompt 02.
> `docs/OLLAMA-PROXMOX.md` queda como referencia de producción; **no se usa en esta prueba**.

## 1. Topología

```
Notebook (Windows + Docker Desktop)
├── msp_net (bridge, red interna)
│   ├── backend  →  http://ollama:11434
│   ├── ollama   ← servicio con perfil "ai" (NO expuesto al host ni a internet)
│   ├── postgres (pgvector/pgvector:pg16)
│   ├── redis
│   └── minio
└── frontend :3000  →  /api/ai/health y /api/ai/lab/* (sólo Administrador)
```

Sin IA: `docker compose -f docker-compose.dev.yml up -d` **no levanta Ollama** (perfil `ai`). El backend arranca igual y `/api/ai/health` da 404.

### Recursos medidos en esta notebook

| Dato | Valor |
|---|---|
| RAM Windows | 15,7 GB |
| Memoria asignada a Docker (`docker info` → MemTotal) | 8.157.556.736 bytes (~7,6 GB) |
| GPU | NVIDIA GeForce RTX 3060 Laptop, 6144 MiB (detector; **no usada**, CPU por default) |
| Modelo de chat elegido | **`qwen3:4b`** (el prompt pide 8b sólo con ≥12 GB en Docker; acá hay 7,6 GB) |
| Modelo de embeddings | `bge-m3` (1024 dimensiones) |
| Imagen Ollama | `ollama/ollama:0.40.16` (tag fijado, no `latest`) |

> Para subir la memoria de Docker: editar `%UserProfile%\.wslconfig` con `[wsl2] memory=12GB` y reiniciar WSL (`wsl --shutdown`). **No se cambió sin autorización.**

## 2. Variables

| Env | Descripción | Default |
|---|---|---|
| `AI_ENABLED` | Activa el módulo. Con `false`, los endpoints dan 503 y el resto sigue igual | `false` |
| `AI_LAB_ENABLED` | Expone `/api/ai/health` y `/api/ai/lab/*` sólo a Administrador; si no, 404 | `false` |
| `AI_CHAT_PROVIDER` | `ollama` \| `mock` | `ollama` |
| `AI_EMBED_PROVIDER` | `ollama` \| `mock` | `ollama` |
| `OLLAMA_URL` | URL interna del servicio del perfil `ai` | `http://ollama:11434` |
| `AI_MODEL_FAST` | Modelo de chat rápido | `qwen3:4b` |
| `AI_MODEL_SMART` | Modelo de chat para resumen/clasificación | `qwen3:4b` |
| `AI_EMBED_MODEL` | Modelo de embeddings | `bge-m3` |
| `AI_EMBED_DIM` | Dimensión esperada; si no coincide, error claro | `1024` |
| `AI_OLLAMA_NUM_CTX` | `options.num_ctx` (el default de Ollama es chico) | `8192` |
| `AI_CHAT_TIMEOUT_MS` | Timeout y 1 reintento ante error de red | `180000` |

En esta notebook quedaron en `.env`: `AI_ENABLED=true`, `AI_LAB_ENABLED=true`, proveedores `ollama`, `OLLAMA_URL=http://ollama:11434`, modelos `qwen3:4b` / `bge-m3`, dim 1024, ctx 8192, timeout 180000.

### Seguridad local reforzada

`docker-compose.dev.yml` hace override de `.env` dentro del contenedor `backend`:

```yaml
WHATSAPP_ACCESS_TOKEN: ""      # ningún WhatsApp sale desde local
WHATSAPP_PHONE_NUMBER_ID: ""
MAILBOX_WORKER_ENABLED: "false"  # worker IMAP congelado sin tocar la BD
```

`MAIL_DEV_OUTBOX` ya estaba definido, así que los mails vuelcan a JSON en vez de SMTP. Las casillas de la BD siguen como estaban (4 activas, `shadow_mode=false`): se frenó el worker, **no se modificaron datos**.

## 3. Levantar / bajar Ollama

```bash
# Levantar todo incluido Ollama
docker compose -f docker-compose.dev.yml --profile ai up -d

# Descargar modelos (la primera vez tarda bastante en CPU)
docker compose -f docker-compose.dev.yml exec ollama ollama pull qwen3:4b
docker compose -f docker-compose.dev.yml exec ollama ollama pull bge-m3
docker compose -f docker-compose.dev.yml exec ollama ollama list

# Verificación desde el backend
docker compose -f docker-compose.dev.yml exec backend curl -s http://ollama:11434/api/tags

# Bajar sólo Ollama (el resto sigue andando)
docker compose -f docker-compose.dev.yml stop ollama
docker compose -f docker-compose.dev.yml start ollama

# Apagar IA por completo
AI_ENABLED=false / AI_LAB_ENABLED=false en .env
docker compose -f docker-compose.dev.yml up -d backend
docker compose -f docker-compose.dev.yml stop ollama
```

El volumen `ollama_models` guarda los modelos. Para ver cuánto ocupan:

```bash
docker system df -v | Select-String ollama_models
```

Para borrarlos (vuelven a bajarse con `ollama pull`):

```bash
docker compose -f docker-compose.dev.yml --profile ai down
docker volume rm ops-msp_ollama_models
```

> El puerto 11434 **no está publicado**. Si se necesita probar desde Windows, descomentar sólo `127.0.0.1:11434:11434` en el compose. Nunca ponerlo en `0.0.0.0` ni en el router.

## 4. Diagnóstico

- Pantalla: **Administración → Laboratorio de IA** (sólo aparece con `AI_LAB_ENABLED=true` y rol Administrador).
- `GET /api/ai/features` → flags y proveedores (para que el menú se oculte sin tocar Ollama).
- `GET /api/ai/health` → alcanzable, versión, modelos disponibles y cargados (`/api/ps`), latencia. Si Ollama no responde, devuelve **503** con el mensaje de error; la pantalla lo muestra en el aviso rojo.
- `POST /api/ai/lab/chat`, `/embed`, `/similarity`, `/ticket/:id/summarize`, `/ticket/:id/classify`, `/benchmark`.
- Cada pedido escribe **una fila** en `ai_usage_log` con métricas; **nunca** prompt ni respuesta.

### ¿Qué pasa si Ollama se cae?

- `/api/ai/health` y los endpoints `/lab/*` devuelven **503** con un mensaje claro (`Ollama no disponible: …`) y la tarjeta pasa a “sin datos” con el aviso rojo.
- Tickets, agenda, notas, documentos y el resto del sistema funcionan exactamente igual: ningún módulo existente depende de `AiModule`.
- Al volver a encender Ollama, se recupera solo (no hace falta reiniciar backend).

### synchronize: true y pgvector

`database.config.ts` mantiene `synchronize: true`. No hay **ninguna** columna `vector` mapeada en entidades TypeORM. La extensión se crea con SQL crudo y idempotente en `AiService.onModuleInit()` y en la migración `20261118220000-CreateAiVectorExtension.ts`. `ai_usage_log` sí es entidad normal.

## 5. Local: volver atrás

### Rápido (sin tocar código ni datos)

```powershell
# .env: dejar AI_ENABLED=false y AI_LAB_ENABLED=false
docker compose -f docker-compose.dev.yml up -d backend
docker compose -f docker-compose.dev.yml stop ollama
```

### Código

Commit anterior anotado: `ced8c8e98334d30ab94ec3766254f3055396135f`

```powershell
git checkout ced8c8e98334d30ab94ec3766254f3055396135f
docker compose -f docker-compose.dev.yml up -d --build
```

### Base de datos y MinIO

Backups del Paso 0 (verificados):

| Archivo | Fecha | Tamaño | Verificación |
|---|---|---|---|
| `D:\Sistema de Tickets Agenda\backup\ops_msp_pre_ia_20261118-221335.dump` | 2026-11-18 22:13:39 | 20.688.577 bytes | `pg_restore --list`: 245 entradas, sin errores |
| `D:\Sistema de Tickets Agenda\backup\minio_pre_ia.tar.gz` | 2026-11-18 22:25:54 | 3.911.142.537 bytes | `tar -tzf`: 15 primeras entradas válidas (`./`, `.minio.sys/`, `ops-msp/documents/`, `ops-msp/tickets/…`) |
| `D:\Sistema de Tickets Agenda\.env.pre-ia` | 2026-11-18 | — | copia del `.env` original |

```powershell
# Restaurar DB (procedimiento de docs/MIGRATION-BACKUP.md)
docker compose -f docker-compose.dev.yml stop backend
docker exec ops-postgres sh -c "dropdb -U ops ops_msp --if-exists"
docker exec ops-postgres sh -c "createdb -U ops ops_msp"
docker cp "D:\Sistema de Tickets Agenda\backup\ops_msp_pre_ia_20261118-221335.dump" ops-postgres:/tmp/restore.dump
docker exec ops-postgres pg_restore -U ops -d ops_msp --clean --if-exists /tmp/restore.dump
docker compose -f docker-compose.dev.yml up -d backend

# Restaurar MinIO (con el compose stop/start para no escribir mientras copiamos)
tar -xzf "D:\Sistema de Tickets Agenda\backup\minio_pre_ia.tar.gz" -C "D:\Sistema de Tickets Agenda\backup"
docker compose -f docker-compose.dev.yml stop minio
docker cp "D:\Sistema de Tickets Agenda\backup\minio-data-pre-ia\." ops-minio:/data
docker compose -f docker-compose.dev.yml start minio
```

### Probar la vuelta atrás en una base temporal

```powershell
docker cp "D:\Sistema de Tickets Agenda\backup\ops_msp_pre_ia_20261118-221335.dump" ops-postgres:/tmp/restore_test.dump
docker exec ops-postgres sh -c "createdb -U ops ops_msp_restore_test"
docker exec ops-postgres pg_restore -U ops -d ops_msp_restore_test --clean --if-exists /tmp/restore_test.dump
docker exec ops-postgres psql -U ops -d ops_msp_restore_test -tAc "select count(*) from tickets; select count(*) from notes; select count(*) from documents;"
docker exec ops-postgres psql -U ops -d ops_msp -tAc "select count(*) from tickets; select count(*) from notes; select count(*) from documents;"
docker exec ops-postgres sh -c "dropdb -U ops ops_msp_restore_test"
```

Conteos reales de la base original antes del cambio: **40356 tickets, 29 notas, 2509 documentos**.

## 6. Pruebas locales

### 6.1 Verificación estática (ejecutada en la notebook)

```text
backend: npm run typecheck        → sin errores
backend: npm test -- --runInBand  → 7 suites, 41 tests, 0 fallos
frontend: npm run typecheck       → sin errores
frontend: npm run build           → "✓ Compiled successfully"; falla después en
                                    "Collecting page data" con PageNotFoundError /_document
                                    porque el dev server comparte .next con el build.
                                    No es un error de TypeScript ni de la página nueva.
backend (dentro del container, DB_NAME=ops_msp_e2e):
  npm run test:e2e                → 3 suites, 12 tests, 0 fallos
```

Notas del e2e:

- Se corre **dentro de `ops-backend`** con `docker compose -f docker-compose.dev.yml exec -e DB_NAME=ops_msp_e2e -T backend npm run test:e2e`. Desde Windows el host no resuelve `postgres` y sin el override `DB_NAME` el guard de aislamiento rechaza `ops_msp`.
- Se corrigió `backend/test/run-e2e.js`: Node 24/Windows no permite `spawn` directo de `jest.cmd` (`EINVAL`); ahora invoca `node node_modules/jest/bin/jest.js`, sin `shell:true` (que rompía la ruta con espacios `D:\Sistema de Tickets Agenda`).
- `frontend: npm run lint` no aplica: el repo no tiene configuración ESLint y Next abre el asistente interactivo. `next build` sí ejecuta lint/type-check internos antes del paso que falla por `.next` compartido.

### 6.2 Gating y arranque con Ollama apagado (evidencia real)

Con `AI_ENABLED=true`, `AI_LAB_ENABLED=true` y el contenedor `ops-ollama` **detenido**, se recreó el backend y se llamó a la API con un JWT de Administrador:

```text
/ai/features  200  {"aiEnabled":true,"aiLabEnabled":true,"chatProvider":"ollama","embedProvider":"ollama"}
/ai/health    503  {"message":"Ollama no disponible: fetch failed","error":"Service Unavailable","statusCode":503}
/ai/lab/chat  503  {"message":"Ollama no disponible: fetch failed","error":"Service Unavailable","statusCode":503}
```

El backend arrancó normalmente, el resto de los módulos siguen respondiendo y `pgvector` quedó habilitado:

```text
select extname, extversion from pg_extension where extname='vector';
vector | 0.8.6

select feature, provider, model, ok, left(error_message,40) from ai_usage_log ...
lab_chat | ollama | qwen3:4b | f | fetch failed
```

No se guardó ningún prompt ni respuesta: la tabla `ai_usage_log` sólo tiene columnas de métricas y fecha/usuario.

### 6.3 Smoke HTTP con proveedor `mock` (cables verificados)

Se cambiaron transitoriamente `AI_CHAT_PROVIDER` y `AI_EMBED_PROVIDER` a `mock` en `.env`, se recreó el backend, se corrieron los endpoints y se restauró `ollama`. El ticket usado es real (`TK-2026-40630`, id `ea24ea5b-…`), pero la respuesta es armada por el mock, no un modelo.

```text
/ai/features                                    200  chatProvider=mock, embedProvider=mock
/ai/health                                      200  reachable=true, version="mock (sin red)"
/ai/lab/chat                                    201  "Un switch de red conecta dispositivos y reenvía tramas entre ellos."
                                                     tokens 9/17 · 0.01 s · 3400 tok/s
/ai/lab/embed                                   201  dimension=1024 · first5=[0.01963,0.050771,-0.004934,0.016097,-0.023677]
/ai/lab/similarity                              201  similarity=0.395 (39.5%) · dim=1024
/ai/lab/ticket/ea24…/summarize                  201  ticket real=TK-2026-40630, estado=nuevo, prioridad=normal, 1 mensaje
                                                     summary (mock, sin JSON)= "Pedido: se informa una falla. …"
/ai/lab/ticket/ea24…/classify                   201  ai={"categoria":"Redes","prioridad":"Media","especialidad":"Redes",
                                                     "duracionEstimada":"1 a 2 horas","animo":"Neutro"}
/ai/lab/benchmark                               201  chat promedio 0.01 s / 3080 tok/s · embeddings promedio 0 s
```

Con Ollama apagado los mismos endpoints dieron 503 (sección 6.2), así que el cableado de flags, guards, métricas y base de datos está verificado de punta a punta.

### 6.4 Pruebas en vivo con Ollama (completar al terminar la descarga de modelos)

(completar)
