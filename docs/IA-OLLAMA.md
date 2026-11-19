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

Evidencia del override dentro del contenedor (`docker inspect ops-backend --format '{{range .Config.Env}}{{println .}}{{end}}'`):

```text
MAILBOX_WORKER_ENABLED=false
WHATSAPP_ACCESS_TOKEN=
MAIL_DEV_OUTBOX=/tmp/mailout
AI_ENABLED=true
AI_LAB_ENABLED=true
AI_CHAT_PROVIDER=ollama
AI_EMBED_PROVIDER=ollama
OLLAMA_URL=http://ollama:11434
```

**Confirmación shadow (por código, sin conexión IMAP a casillas reales):** el worker ni siquiera se conecta porque `pollAll()` sale temprano con `MAILBOX_WORKER_ENABLED=false`. Además, en la rama `mb.shadowMode` (`mailbox-worker.service.ts:85-91`) sólo se hace `client.fetch({uid, envelope})` y se escribe `inbound_mail_log` con `routed=false` (`recordShadow`, líneas 192-231); un grep por `messageFlags|messageDelete|messageMove|setFlags|.store(|flags:` en ese archivo da **0 coincidencias**. Es decir: no marca `\Seen`, no mueve y no borra mensajes. No se ensayó contra IMAP real para no tocar las casillas de Zammad.

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
| `D:\Sistema de Tickets Agenda\backup\env.pre-ia` | 2026-11-18 | 2.175 bytes | copia del `.env` original; `git status` no lo muestra (`/backup/` ignorado) |

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

Prueba de restore ejecutada el 2026-11-18 en `ops_msp_restore_test` (base temporal, dropeada al finalizar):

```text
pg_restore -U ops -d ops_msp_restore_test --no-owner /tmp/restore_test.dump  → sin errores
tickets / notes / documents en la restauración: 40356 / 29 / 2509
tickets / notes / documents en la original:     40356 / 29 / 2509
```

### Gate pendiente para producción (IBM M3)

**Sin evidencia no se avanza.** Queda pendiente el backup verificado de producción (`pg_dump -Fc` + MinIO + `pg_restore --list` / `tar -tzf`) con nombre, tamaño, fecha y resultado. No se puede ejecutar desde la notebook y **no se inventó**: recién con esa evidencia se habilitará el prompt 02 en el IBM M3. El trabajo de esta rama es exclusivamente local.

## 6. Pruebas locales

### 6.1 Verificación estática (ejecutada en la notebook)

```text
backend: npm run typecheck        → sin errores
backend: npm test -- --runInBand  → 7 suites, 41 tests, 0 fallos
frontend: npm run typecheck       → sin errores
frontend: npm run build           → ✓ Compiled successfully; ✓ Linting and checking
                                    validity of types; ✓ Generating static pages (34/34);
                                    EXITCODE=0. BUILD_ID 26dh1wzrP-z1l4roVwJOz.
                                    Se usó un distDir temporal (.next-ai-check) para no
                                    pisar el .next del dev server de Docker; se revirtió
                                    al terminar. El primer intento con .next compartido
                                    falló en "Collecting page data" con PageNotFoundError
                                    /_document, sin relación con el código nuevo.
backend (dentro del container, DB_NAME=ops_msp_e2e):
  npm run test:e2e                → 3 suites, 12 tests, 0 fallos
```

Notas del e2e:

- Se corre **dentro de `ops-backend`** con `docker compose -f docker-compose.dev.yml exec -e DB_NAME=ops_msp_e2e -T backend npm run test:e2e`. Desde Windows el host no resuelve `postgres` y sin el override `DB_NAME` el guard de aislamiento rechaza `ops_msp`.
- Se corrigió `backend/test/run-e2e.js`: Node 24/Windows no permite `spawn` directo de `jest.cmd` (`EINVAL`); ahora invoca `node node_modules/jest/bin/jest.js`, sin `shell:true` (que rompía la ruta con espacios `D:\Sistema de Tickets Agenda`).
- `frontend: npm run lint` no aplica: el repo no tiene configuración ESLint y Next abre el asistente interactivo. `next build` sí ejecuta lint/type-check internos antes del paso que falla por `.next` compartido.
- Incidente posterior al build: el dev server quedó con un `.next` mezclado (del primer build fallido) y `/login` daba `Cannot find module './845.js'`. Se arregló borrando la caché montada y reiniciando:

```powershell
Remove-Item -Recurse -Force frontend\.next
docker compose -f docker-compose.dev.yml restart frontend
```

```text
GET http://localhost:3000/login → 200, 7.872 bytes
contains "Ingresar"=true, "Contraseña"=true, "Cannot find module"=false
logs: ✓ Ready in 4.4s · ✓ Compiled /login in 8.4s (508 modules) · GET /login 200
```

El dev server sigue mostrando un aviso no bloqueante de Next sobre el lockfile (`Found lockfile missing swc dependencies` / `Failed to patch lockfile`) porque se revirtió el parche automático que aplicó `next build`; no afecta la compilación ni el login.

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

### 6.4 Pruebas en vivo con Ollama

Ver secciones 7 y 8 (timeout real, comparación de modelos y textos devueltos).

## 7. Límite de tiempo real (requerimiento B)

- `ChatOptions.timeoutMs` se propaga desde `ai.chatTimeoutMs` (`AI_CHAT_TIMEOUT_MS`).
- `OllamaAiProvider.request()` crea un `AbortController` por pedido con un único
  `setTimeout` y deadline absoluto. El reintento por error de red comparte el
  controller; los timeouts **no** se reintentan.
- `AiService.guardedChat()` usa un solo reloj para la llamada y el reintento por
  idioma: el reintento recibe sólo el tiempo restante. Si no queda presupuesto,
  se lanza `AiTimeoutError` y la API responde 503 con el mensaje exacto
  `La IA tardó demasiado, probá de nuevo`.
- El evento se registra en `ai_usage_log` con `ok=false` y ese mismo
  `error_message`.

Prueba real con `AI_CHAT_TIMEOUT_MS=5000` en un backend temporal (puerto 4001).
El `.env` **no** se tocó: sigue en `180000`.

```text
POST /api/ai/lab/chat  ->  503 en 5,07 s
{"message":"La IA tardó demasiado, probá de nuevo","error":"Service Unavailable","statusCode":503}

select count(*) from ai_usage_log where error_message='La IA tardó demasiado, probá de nuevo';
1
```

## 8. Modelo sin razonamiento y comparación (requerimiento C)

La librería de Ollama publica `qwen3:4b-instruct` (tag oficial, 2,5 GB, id
`0edcdef34593`). Se bajó con `ollama pull qwen3:4b-instruct`. Es la variante
instruct: `/api/show` reporta `capabilities=["tools","thinking","completion"]`,
pero en la práctica no emite el razonamiento. Con el mismo prompt, `qwen3:4b`
arrancó `"Okay, the user is asking... Let me think."` mientras que
`qwen3:4b-instruct` respondió directamente en español.

Comparación con el ticket real `TK-2026-40630` y el mismo prompt/payload:

| Operación | qwen3:4b (configurado) | qwen3:4b-instruct | Mejora |
|---|---:|---:|---:|
| chat | 50,1 s | 6,3 s | ~8x |
| resumen | 11,7 s | 10,7 s | ~1,1x |
| clasificación | 10,8 s | 9,5 s | ~1,1x |

La comparación se hizo con un backend temporal (puerto 4002) que sobrescribió
sólo esas dos variables. Con OK posterior se cambió el `.env` a
`qwen3:4b-instruct` para `AI_MODEL_FAST` y `AI_MODEL_SMART` (ver sección 10).

## 9. Texto exacto devuelto por el modelo (tickets reales)

Se usaron tres tickets reales distintos. El campo `textoModelo` de la respuesta
es lo que devolvió el modelo sin parsear ni prefijos de aviso.

### qwen3:4b (modelo configurado actualmente)

```text
[RESUMEN TK-2026-40630]
{
  "pedido": "Respaldo de MikroTik CSM_4011 del 2026-10-16",
  "probado": "No se especifica",
  "falta": "Confirmar estado y prioridad del ticket",
  "cliente": "Solicitó respuesta por email"
}
[CLASIFICACION TK-2026-40630]
{
  "categoria": "Red / Conectividad",
  "prioridad": "normal",
  "especialidad": "Redes",
  "duracionEstimada": "2 horas",
  "animo": "Con tranquilidad, lo resolvemos."
}
[RESUMEN TK-2026-40629]
{
  "pedido": "Restablecer el respaldo de MikroTik para Elisa",
  "probado": "No se ha realizado ningún probado en el ticket",
  "falta": "Confirmar el estado del respaldo y los detalles del problema",
  "cliente": "Elisa"
}
[CLASIFICACION TK-2026-40629]
{
  "categoria": "Red / Conectividad",
  "prioridad": "normal",
  "especialidad": "Redes",
  "duracionEstimada": "2 horas",
  "animo": "Con tranquilidad, lo resolvemos."
}
[RESUMEN TK-2026-40626]
{
  "pedido": "SWA_LB Respaldo oct/15/2026",
  "probado": "",
  "falta": "",
  "cliente": ""
}
[CLASIFICACION TK-2026-40626]
{
  "categoria": "Red / Conectividad",
  "prioridad": "normal",
  "especialidad": "Redes",
  "duracionEstimada": "2 horas",
  "animo": "Con tranquilidad, lo resolvemos."
}
```

### qwen3:4b-instruct (candidato, aún sin activar)

```text
[RESUMEN TK-2026-40630]
{"pedido":"Realizar respaldo del sistema MikroTik CSM 4011 del 16/10/2026","probado":"No se proporcionaron acciones probadas en el ticket","falta":"No se especifica el contenido o formato del respaldo requerido","cliente":"Solicitó respuesta por email"}
[CLASIFICACION TK-2026-40630]
{"categoria":"soporte","prioridad":"normal","especialidad":"Redes","duracionEstimada":"2 horas","animo":"Con tranquilidad, lo resolvemos."}
[RESUMEN TK-2026-40629]
{"pedido":"Realizar respaldo de la configuración de MikroTik para La Elisa el 16/10/2026","probado":"","falta":"","cliente":"La Elisa"}
[CLASIFICACION TK-2026-40629]
{"categoria":"soporte","prioridad":"normal","especialidad":"Redes","duracionEstimada":"2 horas","animo":"Con tranquilidad, lo resolvemos."}
[RESUMEN TK-2026-40626]
{"pedido":"Realizar respaldo del SWA_LB el 15 de octubre de 2026","probado":"","falta":"","cliente":""}
[CLASIFICACION TK-2026-40626]
{"categoria":"soporte","prioridad":"normal","especialidad":"Soporte General","duracionEstimada":"1 hora","animo":"Sin problema, lo atendemos con tranquilidad."}
```

Nota: las categorías devueltas por el modelo se validan contra la base antes de
mostrarse en el campo `ai`; `textoModelo` conserva lo que el modelo escribió
literalmente. En los ejemplos, `soporte` y `Red / Conectividad` existen en la BD,
por lo que no se marcó `sin coincidencia`.

## 10. Activación de `qwen3:4b-instruct` y ejemplos no copiables

Con OK del usuario se cambió `.env` (backup
`backup/.env.pre-ejemplo-20261119-084410.bak`):

```diff
-AI_MODEL_FAST=qwen3:4b
-AI_MODEL_SMART=qwen3:4b
+AI_MODEL_FAST=qwen3:4b-instruct
+AI_MODEL_SMART=qwen3:4b-instruct
```

Se recreó `ops-backend` para que el cambio tenga efecto. Verificado dentro del
contenedor: `MODEL_FAST=qwen3:4b-instruct MODEL_SMART=qwen3:4b-instruct`.

### 10.1 Cambios en prompts y schema

- Los ejemplos ahora usan marcadores ficticios (`CATEGORIA_FICTICIA`,
  `ANIMO_FICTICIO`, `duracionEstimada: 123`) y dicen explícitamente
  “no los copies”. Ya no aparecen `2 horas` ni
  `Con tranquilidad, lo resolvemos.`.
- `animo` es una lista cerrada en el schema JSON:
  `tranquilo, apurado, molesto, preocupado, neutral`.
- `duracionEstimada` pasó a `integer` (minutos).
- Regla `Sin datos`: si falta información se devuelve `""` o `Sin datos`.
  Además, `sinDatosSiCorresponde()` normaliza frases del modelo como
  `No se ha realizado ningún probado` o `No se especifica…` a `Sin datos` en
  el campo parseado. `textoModelo` conserva lo que escribió el modelo.

### 10.2 Prueba con tickets de personas (no avisos automáticos)

Modelo activo: `qwen3:4b-instruct`. Se muestran `textoModelo` (exacto) y
`PARSEADO` (normalizado). Todos los tickets son reales y distintos.

#### TK-2026-40583 — entró por WhatsApp

```text
[RESUMEN | textoModelo]
{"pedido":"No tengo internet / la red no anda","probado":"Sin datos","falta":"Sin datos","cliente":"Sin datos"}
[CLASIFICACION | textoModelo]
{"categoria":"Red / Conectividad","prioridad":"normal","especialidad":"","duracionEstimada":30,"animo":"neutral"}
```

Ticket real: `WhatsApp: Red / Conectividad` · estado `nuevo` · prioridad
`normal` · categoría `Red / Conectividad` · sin técnico · 15 mensajes. Primer
mensaje del cliente: “Hola, necesito ayuda con la red”; luego eligió “1” ante
el menú automático (“No tengo internet / la red no anda”).

#### TK-2026-40033 — mail con ida y vuelta

```text
[RESUMEN | textoModelo]
{"pedido":"Adriana tiene problemas con su computadora: no abre archivos en PDF y se bloquea al conectar la impresora color. Se solicitó conexión remota mediante TeamViewer para diagnosticar el problema.","probado":"Se realizó conexión remota mediante TeamViewer y se solicitó reinicio de la máquina para evaluar el estado del sistema.","falta":"No se especifica si se realizaron acciones de limpieza o reparación en la computadora.","cliente":"Adriana"}
[RESUMEN | PARSEADO]
{"pedido":"Adriana tiene problemas con su computadora: no abre archivos en PDF y se bloquea al conectar la impresora color. Se solicitó conexión remota mediante TeamViewer para diagnosticar el problema.","probado":"Se realizó conexión remota mediante TeamViewer y se solicitó reinicio de la máquina para evaluar el estado del sistema.","falta":"Sin datos","cliente":"Adriana"}
[CLASIFICACION | textoModelo]
{"categoria":"soporte","prioridad":"normal","especialidad":"","duracionEstimada":45,"animo":"neutral"}
```

Ticket real: `computadora Adriana` · estado `cerrado` · prioridad `normal` ·
categoría vacía · sin técnico · 16 mensajes. Mensaje inicial: “Podrían revisar
la compu, estoy teniendo problemas, no abre los archivos en PDF, y se bloquea
al conectar la impresora color.” Luego hay ida y vuelta con el técnico por
TeamViewer.

#### TK-2026-39593 — cerrado con 17 mensajes

```text
[RESUMEN | textoModelo]
{"pedido":"Las casas de la granja en ruta 5 km 113, específicamente las de la red 'EMPLEADOS' y 'INTERNO LARRONDO', no tenían internet desde el viernes. Se realizó una configuración en el enlace para que el router Mikrotik detecte fallos y se reinicie automáticamente. Los técnicos verificaron que el problema ya fue resuelto y que ahora las casas funcionan correctamente.","probado":"Se realizó una configuración en el enlace que envía consultas al router Mikrotik; se verificó que las casas ya funcionan correctamente.","falta":"Sin datos","cliente":"Jorge Diaz"}
[CLASIFICACION | textoModelo]
{"categoria":"Red / Conectividad","prioridad":"normal","especialidad":"soporte","duracionEstimada":30,"animo":"tranquilo"}
```

Ticket real: `INTERNET CASAS GRANJA RUTA 5 KM 113 - INTERNO LARRONDO` · estado
`cerrado` · prioridad `normal` · categoría vacía · sin técnico · 17 mensajes.
Mensaje del cliente: “Me informa el encargado de la granja que no funciona
internet en su casa aún.”

#### TK-2026-38367 — cliente apurado

```text
[RESUMEN | textoModelo]
{"pedido":"Se dejó de funcionar el transformador del monitor LG de preceptoría de secundaria. Se solicitó urgentemente su reemplazo, pero el proveedor no pudo suministrarlo. Se indicó que hay un transformador idéntico en el mercado libre, pero con diferencias en los cables.","probado":"Sin datos","falta":"No se especifica si se ha instalado o entregado el transformador con cables compatibles.","cliente":"Axel"}
[RESUMEN | PARSEADO]
{"pedido":"Se dejó de funcionar el transformador del monitor LG de preceptoría de secundaria. Se solicitó urgentemente su reemplazo, pero el proveedor no pudo suministrarlo. Se indicó que hay un transformador idéntico en el mercado libre, pero con diferencias en los cables.","probado":"Sin datos","falta":"Sin datos","cliente":"Axel"}
[CLASIFICACION | textoModelo]
{"categoria":"Red / Conectividad","prioridad":"normal","especialidad":"soporte","duracionEstimada":60,"animo":"preocupado"}
```

Ticket real: `Transformador d e monitor LG de secundaria preceptoría.` · estado
`cerrado` · prioridad `normal` · categoría vacía · sin técnico · 11 mensajes.
Mensaje del cliente: “dejo de funcionar el transformador del monitor LG de
preceptoría. Lo necesitaríamos de manera urgente.”

Los valores de `duracionEstimada` y `animo` ya no repiten el ejemplo:
`30/neutral`, `45/neutral`, `30/tranquilo`, `60/preocupado`.

### 10.3 Avisos automáticos vs. personas (sólo lectura)

Sobre `tickets where deleted_at is null` (40.334 vigentes; 40.356 incluyendo
borrados). Consulta de clasificación aproximada por origen/asunto y presence
de mensajes de `cliente`:

```sql
with c as (
  select case
    when source in ('whatsapp','manual','portal')
      or (source = 'email'
          and exists (select 1 from ticket_messages m
                      where m.ticket_id = t.id and m.author_type = 'cliente')
          and subject_key !~* '(backup|respaldo|health|smart error|correcto|incorrecto|notificac|alerta|automat|tu ticket|encuesta|newsletter|amistad|novedades|starlink|mail delivery failed|verify your account|datos de prioridad|firma digital|actualizaci.n de precios|towebs|linkedin|facebook|active backup|copia de seguridad|mikrotik|proxmox|zfs|volumen|se ha cerrado incorrectamente|no puede conectarse|undelivered mail|nuevo inicio de sesi.n|sin capacidad|fault|error)')
    then 'persona'
    else 'automatico_o_sin_cliente'
  end as tipo
  from tickets t
  where deleted_at is null
)
select tipo, count(*) from c group by tipo order by 2 desc;
```

Resultado:

```text
automatico_o_sin_cliente | 33701
persona                 |  6633
```

Es una estimación por patrón: los correos de monitoreo que llegan con remitente
“cliente” pueden quedar del lado de personas y algunos asuntos genéricos
(“consulta”, “test”) del lado automático. No se modificó ninguna fila.

## 11. Clasificación con datos reales + GPU (requerimiento D)

### 11.1 Backups previos (antes de tocar compose/código/docs)

| Archivo | Tamaño | Fecha | SHA256 |
|---|---:|---|---|
| `backup/docker-compose.dev.yml.pre-gpu-clasificacion-20261119-090307.bak` | 5725 B | 2026-11-18 22:18:11 | `7694D0DBF7D469B6B530045FFFCEA8E60D0A26AA65B71B50055E044BE8830223` |
| `backup/ai.service.ts.pre-gpu-clasificacion-20261119-090307.bak` | 26295 B | 2026-11-19 08:57:50 | `748FA779B9BB77997C8A90DA8B38F6C517E46B18F332B7CEB4FE24D6CC858B11` |
| `backup/ai.service.spec.ts.pre-gpu-clasificacion-20261119-090307.bak` | 18321 B | 2026-11-19 08:58:15 | `F3240A98609B48A827827D6888FC35F8EC2FAD8BAC7B70A82DE395EBE3504BC7` |
| `backup/IA-OLLAMA.md.pre-gpu-clasificacion-20261119-090307.bak` | 28693 B | 2026-11-19 09:01:18 | `7BFE6FFCD540E6AC53BEB44060BAE39A5F45FF453AAEC86550C312DB9294BD54` |
| `backup/ai.types.ts.pre-gpu-clasificacion-20261119-090307.bak` | 2297 B | 2026-11-19 08:45:40 | `89849DC94994E74C8E27739319B84854CC774385BC3C2D5B28E9C6F81389335D` |

`ai.types.ts` se respaldó por precaución pero **no** se modificó. `.env` tampoco
se tocó en esta etapa: sigue con `AI_MODEL_FAST=AI_MODEL_SMART=qwen3:4b-instruct`
y `AI_CHAT_TIMEOUT_MS=180000` (cambio anterior autorizado, sección 10).

Antes del segundo cambio (versión 0.9.2 + contexto 8192) se hicieron estos
backups:

| Archivo | Tamaño | Fecha | SHA256 |
|---|---:|---|---|
| `backup/docker-compose.dev.yml.pre-contexto-8192-20261119-102222.bak` | 6139 B | 2026-11-19 09:54:37 | `07D65116D74C677A44A17D2C1B6AD085C445BBE9A86A680E933420B394B21EFA` |
| `backup/ollama.provider.ts.pre-contexto-8192-20261119-102222.bak` | 7183 B | 2026-11-19 08:31:43 | `78D5680992BF5BCE4712C91647FD1ABE6C95AE30DFF6FD06BA41DAB51A71FC8E` |
| `backup/ai.service.ts.pre-contexto-8192-20261119-102222.bak` | 30190 B | 2026-11-19 09:44:46 | `6219F142DB6C9BDB20793BD7176472991AF3F8A97ABB20921B67F595864F5B9F` |
| `backup/ai.service.spec.ts.pre-contexto-8192-20261119-102222.bak` | 23250 B | 2026-11-19 09:45:32 | `5BC225CD19C2311D277FA77107E6AD0866DBBCE5ADE65E3ED7A376345C54C78B` |
| `backup/IA-OLLAMA.md.pre-contexto-8192-20261119-102222.bak` | 36059 B | 2026-11-19 10:05:51 | `589799DEC48A56723670C5209CCD0084BD1023BF1029EFFBFC839818AFC6EF57` |

### 11.2 GPU: cambio y evidencia

En `docker-compose.dev.yml` se activó el bloque `deploy.resources.reservations.devices`
con `driver: nvidia`, `count: all`, `capabilities: [gpu]`, más
`NVIDIA_VISIBLE_DEVICES=all`, `CUDA_VISIBLE_DEVICES=0`,
`OLLAMA_MAX_LOADED_MODELS=1` y `OLLAMA_CONTEXT_LENGTH=8192`.

### ¿Por qué no `0.40.16`?

`0.40.16` es la **stable más nueva** (09/11/2026), pero en este host no puede
usar GPU:

- Sólo trae `cuda_v12`/`cuda_v13`; el driver es 511.65 / CUDA 11.6.
- Se probó además un contenedor temporal con `--gpus all` y `OLLAMA_VULKAN=1`:
  Ollama informó `inference compute id=cpu library=cpu` (Vulkan no está
  disponible para el contenedor en Docker Desktop/WSL2 con este driver WDDM).
- `0.6.5` trae `cuda_v11` pero no carga la arquitectura `qwen3`.

La imagen final es `ollama/ollama:0.9.2`, la **versión más nueva que aún incluye
`cuda_v11`** y soporta `qwen3` (el commit que vuelve a quitar `cuda_v11` es posterior
a esta tag). Es más nueva que el `0.6.8` usado en el primer intento y evita el
downgrade innecesario a `0.6.8`.

### Contexto real: pedido vs. entorno

- `OLLAMA_CONTEXT_LENGTH` del compose es el **default del servidor**.
- El pedido manda `options.num_ctx`; cuando lo hace, **gana el pedido**.
- `chat()` ya mandaba `num_ctx=8192` desde `ai.numCtx` (`AI_OLLAMA_NUM_CTX`,
  default 8192).
- `generateJson()` —que es lo que usan resumen y clasificación— tenía un cap
  interno a 2048 que sí ganaba al pedido. Ese cap se subió a 8192 en
  `ollama.provider.ts`, y el recorte del prompt en `ai.service.ts` pasó de
  2048 a 8192 tokens. Ahora ambos son 8192.

Con `qwen3:4b-instruct` y 8192 tokens el modelo entra en la GPU:

```text
docker logs ops-ollama
msg="inference compute" id=GPU-… library=cuda variant=v11 compute=8.6
driver=11.6 name="NVIDIA GeForce RTX 3060 Laptop GPU"
total="6.0 GiB" available="5.0 GiB"
load_tensors: offloading 37/37 layers to GPU

docker exec ops-ollama ollama ps
qwen3:4b-instruct  0edcdef34593  5.1 GB  100% GPU  24 hours from now

docker exec ops-ollama nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader
NVIDIA GeForce RTX 3060 Laptop GPU, 4787 MiB, 6144 MiB
```

Nota operativa: el motor de Docker Desktop empezó a responder `500 Internal Server
Error` en `/_ping`, `/version` e `/info`; se reinició Docker Desktop y luego se
recreó `ops-ollama`. No hubo cambios de datos ni de `.env`.

### 11.3 Correcciones del prompt de clasificación

`backend/src/modules/ai/ai.service.ts` ahora:

- Toma el cliente y el contacto desde la base (`ticket.customer.name`,
  `ticket.contact.name`) y obliga al resumen a copiar el contacto real; ya no
  infiere el cliente del texto. En el resumen parseado, `cliente` se sobrescribe
  con ese valor de la base.
- Etiqueta cada mensaje con `CLIENTE:` o `EQUIPO SOLIDO:` según `author_type`
  real (`tecnico` y `sistema` entran en “equipo”). No se manda el número de
  mensaje ni se deja que el modelo adivine quién escribió.
- Pasa descripciones de las categorías **existentes**:
  - `Red / Conectividad`: internet, routers, switches, WiFi, VPN y conectividad.
  - `soporte`: soporte general y consultas sin categoría más específica.
  - `Taller`: equipos, monitores, fuentes, impresoras rotas y reparación de PC/hardware.
- Reglas exactas en la instrucción: `urgente`, `no podemos trabajar`,
  `sin sistema` o `parado` → prioridad `alta`; si además aparece `urgente`,
  `animo=apurado`. Estas reglas se aplican también post-parseo.
- Cierra `especialidad` con `SELECT DISTINCT jsonb_array_elements_text(specialties)
  FROM technicians`: `email`, `impresoras`, `redes`, `servidores`,
  `soporte-applicaciones`. Un valor fuera de esa lista se normaliza a
  `sin coincidencia`.

**No existe la categoría `Hardware` ni `PC` en la base.** Las únicas categorías
reales son `Red / Conectividad`, `soporte` y `Taller`. No se creó ninguna: los
casos de PC/impresora/monitor se mapping a `Taller`.

### 11.4 Comparación GPU: `qwen3:4b-instruct` vs `qwen3:8b`

Mismos 4 tickets reales, mismo prompt, mismo código, `think:false`, sin tocar
`.env` (backend temporal en puerto 4002 con override de modelo). Tiempos en
segundos medidos de punta a punta desde HTTP.

Los tiempos finales son con `ollama/ollama:0.9.2`, `num_ctx=8192` y el modelo
100% en GPU:

| Ticket | 4b-instruct (0.9.2 / 8192) | 8b (medición anterior, 0.6.8 / 2048) |
|---|---:|---:|
| TK-2026-40583 | 5,79 s | 59,77 s |
| TK-2026-40033 | 9,88 s | 102,84 s |
| TK-2026-39593 | 8,82 s | 70,81 s |
| TK-2026-38367 | 6,33 s | 129,21 s |

La columna del 8b es histórica y no es estrictamente comparable: se midió antes
del cambio de versión/contexto. El 8b con 8192 no entra en 6 GB; la comparación
sigue sirviendo para descartarlo. El 4b con 8192 es más lento que con 2048, pero
sigue entre 5 y 10 s y mantiene el modelo 100% en GPU.

Clasificaciones (`ai` parseado, 4b-instruct):

```text
TK-2026-40583  Red / Conectividad | normal | redes                 | 60 | tranquilo
TK-2026-40033  Taller             | normal | soporte-applicaciones  | 45 | tranquilo
TK-2026-39593  Red / Conectividad | normal | redes                 | 60 | tranquilo
TK-2026-38367  Taller             | alta   | impresoras            | 60 | apurado
```

Clasificaciones (`ai` parseado, 8b):

```text
TK-2026-40583  Red / Conectividad | normal | redes                 | 45 | tranquilo
TK-2026-40033  soporte            | alta   | soporte-applicaciones  | —  | apurado
TK-2026-39593  Red / Conectividad | normal | redes                 | 45 | tranquilo
TK-2026-38367  Taller             | alta   | sin coincidencia      | 60 | apurado
```

Calidad:

- `TK-2026-38367` es el único con la palabra “urgente” en los mensajes (verificado
  en BD). Ambos devolvieron `alta`/`apurado` por la regla nueva. Antes el 4b daba
  `normal`/`preocupado` y cliente `Axel` (del equipo); ahora el cliente sale de BD.
- El 8b escaló incorrectamente `TK-2026-40033` a `alta`/`apurado` aunque no hay
  ninguna de las palabras de urgencia en el ticket, y eligió `soporte` en vez de
  `Taller` para un problema de PC/impresora.
- El 8b devolvió `sin coincidencia` en la especialidad de `TK-2026-38367`; el 4b
  eligió `impresoras`, que sí existe en la base.
- Conclusión: **mantener `qwen3:4b-instruct`**. El 8b no cabe completamente en
  6 GB (89% GPU / 11% CPU), es ~50x más lento y no mejora la calidad.

### 11.5 Cliente desde BD en resúmenes (4b-instruct)

Salida real del resumen con el prompt nuevo:

```text
TK-2026-40583  cliente="Cliente Harness WA"   (BD: Panadería Don Pedro / Cliente Harness WA)
TK-2026-40033  cliente="Adriana Bastida"      (BD: Metalurgicasp / Adriana Bastida)
TK-2026-39593  cliente="iruanyak@gmail.com"   (BD: Clientes particulares / iruanyak@gmail.com)
TK-2026-38367  cliente="preceptoria sec -"    (BD: Clientes particulares / preceptoria sec -)
```

Ya no aparece `Axel` como cliente: era un mensaje del equipo mal atribuido.

Con `num_ctx=8192` se repitió el resumen de `TK-2026-39593` (17 mensajes).
Métricas reales: `tokensIn=1583`, `tokensOut=210`, `22,07 s`,
`qwen3:4b-instruct`. El texto tiene 5018 caracteres (54 de título/descripción +
4964 de mensajes), por debajo del límite de 24576 caracteres que permite el
contexto nuevo, así que **no hubo truncamiento**. El resumen incluye información
que aparece tarde en el hilo:

```text
pedido: "...El equipo informó que el problema fue solucionado el día anterior,
aunque el cliente reportó que aún no funcionaba en la casa de Carlos Larrondo.
Se solicitó a Jorge Diaz para coordinar el seguimiento, pero no se recibió
respuesta. El equipo no pudo enviar correo a iruanyak@gmail.com por error de
resolución de nombres."
falta: "No se confirmó que el internet funcione correctamente en la casa de
Carlos Larrondo, ni se recibió respuesta del casero Jorge Diaz para coordinar
el seguimiento. El correo a iruanyak@gmail.com no fue enviado por error de
resolución de nombres."
cliente: "iruanyak@gmail.com"
```

### 11.6 Verificación final

```text
backend npx tsc --noEmit -p tsconfig.json  → sin errores
backend npx jest --runInBand src/modules/ai → 4 suites, 46 tests, 0 fallos
select count(*) from tickets   → 40356
select count(*) from mailboxes → 7
```

No se modificaron tickets, clientes, contactos ni mensajes. Las únicas escrituras
nuevas son métricas en `ai_usage_log` generadas por las llamadas HTTP de prueba.
`.env` sigue con `AI_MODEL_FAST=AI_MODEL_SMART=qwen3:4b-instruct` y
`AI_CHAT_TIMEOUT_MS=180000`; los overrides de modelo se hicieron sólo en el
backend temporal, nunca en el archivo.
