# SETUP — Arranque en local (Windows + Docker Desktop/WSL2)

Esta guía te lleva de cero a una instancia funcionando en **tu computadora**, sin
TLS, accediendo por `localhost`. Es el entorno de desarrollo diario durante
toda la Fase 1. **No** se configura Certificados/Let's Encrypt acá (eso es para
el VPS, ver `MIGRATION-RUNBOOK.md`).

---

## 1. Prerrequisitos (tu máquina)

- **Windows 10/11** con **Docker Desktop instalado**.
- Docker Desktop con el **backend de WSL2** activado
  (Settings → General → *Use the WSL 2 based engine*).
- En *Settings → Resources*, asigná al menos:
  - **4 CPU**
  - **8 GB de RAM**
  - **50 GB de disco** (dejá espacio para imágenes + volúmenes).
  > Sin esto, Postgres + Redis + MinIO + backend + frontend juntos van lentos
  > o se caen por falta de memoria.
- Verificá desde PowerShell:

  ```powershell
  docker --version
  docker compose version
  ```

---

## 2. Preparar el proyecto

1. Copiá el repo a una carpeta, p. ej. `C:\sistemas\ops-msp`.
2. Creá el archivo de entorno copiando la plantilla:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Abrí `.env` y ajustá, **si lo necesitás**:
   - `JWT_SECRET` y `JWT_REFRESH_SECRET`: usá cualquier cadena larga para dev.
   - Los puertos si te chocan con otros servicios.
   - Dejá `RUN_SEED=true` la primera vez (siembra roles y usuarios demo).

---

## 3. Levantar el stack

```powershell
docker compose -f docker-compose.dev.yml up --build
```

Primera vez tarda (descarga imágenes + `npm install`). Cuando las líneas de
log dejen de avanzar, revisá:

```powershell
docker compose -f docker-compose.dev.yml ps
```

Todos los servicios deberían aparecer como `running`.

### Ventanas de log (opcional)

```powershell
docker compose -f docker-compose.dev.yml logs -f backend
docker compose -f docker-compose.dev.yml logs -f frontend
```

---

## 4. Probar que funciona

1. Abrí <http://localhost:3000> → página de login.
2. Ingresá con un usuario demo (ver README):
   - `maria@msp.local` / `demo1234` → ve "Mi día".
   - `ana@msp.local` / `demo1234` → ve el dashboard general.
3. API alive: <http://localhost:4000/api/health> → `{"status":"ok",...}`.
4. Consola MinIO: <http://localhost:9001> (usuario `minioadmin`,
   contraseña `minioadmin_dev`).

---

## 5. Crear un ticket y ver el SLA

1. Entrá como supervisor (`ana@msp.local`), andá a **Tickets → nuevo ticket**.
2. Elegí el cliente demo *Panadería Don Pedro* (tiene contrato con SLA).
3. Guardá. En el detalle aparecen **primera respuesta** y **resolución**
   calculadas con el horario 9–18 del contrato, y el semáforo de SLA.

### Probar la ingesta de email (webhook interno)

Sin un MTA real todavía, simulá un email entrante. El endpoint exige el
secreto compartido `INBOUND_EMAIL_SECRET` (header `X-Inbound-Secret`);
sin él devuelve `401`. El valor está en `.env`:

```powershell
curl -X POST http://localhost:4000/api/email/inbound `
  -H "Content-Type: application/json" `
  -H "X-Inbound-Secret: $INBOUND_EMAIL_SECRET" `
  -d '{"fromEmail":"pedro.panaderia@example.com","subject":"Impresora no anda","body":"No imprime desde ayer"}'
```

> Nota: el worker IMAP ingiere los emails reales **en proceso**
> (`EmailService.ingest()`), sin pasar por esta ruta HTTP — la protección
> de `X-Inbound-Secret` solo aplica a este endpoint de pruebas.

Eso crea (o actualiza) un ticket asociado a ese contacto.

---

## 6. Solución de problemas comunes

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| `backend` se reinicia en loop | Falló la conexión a Postgres/Redis | Esperá a que `postgres` esté healthy (logs) |
| Rollo de errores de `supertest`/migración | Volumen de base viejo sin esquema nuevo | `docker compose -f docker-compose.dev.yml down -v` y volvé a `up` |
| No entra a la app | Docker Desktop sin RAM | Subí recursos en Settings → Resources |
| Adjuntos/avatar suben pero no se ven | MinIO bucket sin crear o URL pública con `localhost:9000` | Revisá `MINIO_*` en `.env` |
| Puerto en uso | Otro proceso ocupa 3000/4000 | Cambiá la variable de puerto correspondiente en `.env` |

---

## 7. Reiniciar / limpiar

```powershell
# Detener todo
docker compose -f docker-compose.dev.yml down

# Detener + borrar volúmenes (¡borra datos locales!)
docker compose -f docker-compose.dev.yml down -v
```

> **No** uses `down -v` en algo con datos que te importen.
