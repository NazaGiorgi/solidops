# Runbook de migración — de tu equipo (local) al VPS

Este procedimiento se ejecuta **una sola vez**, al final de la Fase 1, cuando la
plataforma ya está validada localmente. A partir de entonces, el VPS es el único
ambiente real y el local queda como entorno de desarrollo/pruebas.

> Lo hacés siguiendo estos pasos **en orden**. No asumás que hay pasos ocultos.

---

## 0. Pre-condiciones (las hacés vos, no el agente)

- VPS con **Docker** y **Docker Compose** instalados (y el usuario puede ejecutar
  `sudo docker`).
- Un **dominio** (ej. `msp.mipymes.com`) cuyo registro **A** apunta a la IP
  pública del VPS, y que tiene propagado el DNS (podés checkear con
  `nslookup msp.mipymes.com`).
- Puertos **80 y 443** del VPS abiertos en el firewall/seguridad del proveedor.
- Tamaño del VPS: al menos **4 vCPU / 8 GB RAM / 100-160 GB SSD** (el disco lo
  usan los volúmenes; no escatimes).

---

## 1. Exportar datos desde local

En tu máquina local, con el stack dev **encendido**:

```powershell
# Dump de Postgres (la base de la plataforma)
docker compose -f docker-compose.dev.yml exec -T postgres `
  pg_dump -U <POSTGRES_USER> -d <POSTGRES_DB> --clean --if-exists > backup.sql

# Copia de los objetos (adjuntos, fotos) desde el volumen de MinIO
docker cp ops-minio:/data ./minio-backup
```

- `<POSTGRES_USER>` y `<POSTGRES_DB>` son los de tu `.env`.
- Comprobá que `backup.sql` no esté vacío y que `minio-backup` tenga contenido.

---

## 2. Preparar el `.env.prod` (en tu máquina, no en el repo)

Creá un archivo `.env.prod` (NO lo subas al repo). Valores **nuevos**, no
los de dev:

```ini
DOMAIN=msp.mipymes.com
EMAIL=tu-correo@mipymes.com        # para avisos de expiración de certificado

POSTGRES_USER=msp
POSTGRES_PASSWORD=<una-password-fuerte-nueva>
POSTGRES_DB=ops_msp
MINIO_ROOT_USER=msp
MINIO_ROOT_PASSWORD=<otra-password-fuerte-nueva>

JWT_SECRET=<cadena-larga-aleatoria-nueva>
JWT_REFRESH_SECRET=<otra-cadena-larga-aleatoria-nueva>

RUN_SEED=false
```

> **No reutilices contraseñas ni secretos de desarrollo.**

---

## 3. Copiar el proyecto al VPS

```bash
# Desde tu máquina (adaptá usuario/IP):
scp -r ./ops-msp/ usuario@IP_DEL_VPS:/home/usuario/ops-msp

# En el VPS, entrá a la carpeta:
cd ~/ops-msp
```

`ops-msp` debe contener: `backend/`, `frontend/`, `caddy/`,
`docker-compose.prod.yml`, `.env.prod`.

Subí también el `.env.prod` (por separado, si no lo incluiste):

```bash
scp .env.prod usuario@IP_DEL_VPS:/home/usuario/ops-msp/.env.prod
```

---

## 4. Restaurar datos en el VPS

Primero **levantá solo la base** para poder importar (el resto arranca después):

```bash
docker compose -f docker-compose.prod.yml up -d postgres redis minio
docker compose -f docker-compose.prod.yml ps
# esperá a que postgres esté "healthy"
```

Importá el dump:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U msp -d ops_msp < backup.sql
```

Copiá los archivos de MinIO:

```bash
# Detené minio, copiá el contenido al volumen, y volvé a levantarlo
docker compose -f docker-compose.prod.yml stop minio
docker cp ./minio-backup/. $(docker compose -f docker-compose.prod.yml ps -q minio):/data
docker compose -f docker-compose.prod.yml start minio
```

---

## 5. Levantar con el compose de producción

```bash
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

Revisá los logs de Caddy para confirmar que emitió el certificado:

```bash
docker compose -f docker-compose.prod.yml logs -f caddy
```

Deberías ver una línea del tipo *certificate obtained successfully*. Si Caddy
no obtiene el certificado, casi siempre es DNS (dominio no apuntando todavía) o
puertos 80/443 no abiertos.

---

## 6. Checklist de paridad (en el navegador, con el dominio real)

- [ ] `https://msp.mipymes.com` carga y no da advertencia de certificado.
- [ ] El login funciona con un usuario existente.
- [ ] Jugá a crear/ver un ticket: carga la agenda, las notificaciones llegan.
- [ ] MinIO (si lo necesitás) accesible bajo `/minio-console`.
- [ ] Los datos restaurados (clientes, contratos, tickets) están visibles.

Solo cuando todo esto pase, el VPS pasa a ser la fuente de verdad.

---

## 7. Después de migrar

- El entorno **local queda como ambiente de desarrollo/pruebas** para la
  Fase 2 en adelante.
- **No** borres el `backup.sql` ni el VPS local hasta estar seguro.
- Reverificá de vez en cuando que Docker no se quede sin disco
  (`docker system df`, `df -h`).

---

## Referencia rápida de comandos en el VPS

| Comando | Acción |
| --- | --- |
| `docker compose -f docker-compose.prod.yml logs -f backend` | ver logs del API |
| `docker compose -f docker-compose.prod.yml restart backend` | reiniciar API |
| `docker compose -f docker-compose.prod.yml down` | detener todo |
| `docker compose -f docker-compose.prod.yml up -d` | (re)levantar todo |
