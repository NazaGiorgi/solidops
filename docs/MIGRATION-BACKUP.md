# Backup fresco de `ops_msp` previo a la migración documental completa

Respaldo de la base `ops_msp` generado **antes** de correr la migración real de
documentos (~2500 archivos, 104 carpetas contra `\\10.88.88.150\SolidoCS_Ambientes`).
Refleja el estado actual (416 clientes, resets de contraseña, permisos, tickets),
a diferencia del backup más viejo.

## Archivo

- **Nombre**: `ops_msp_pre_migracion_completa_20260831-191141.dump`
- **Ruta**: `D:\Sistema de Tickets Agenda\backup\ops_msp_pre_migracion_completa_20260831-191141.dump`
- **Tamaño**: ~343 KB (formato CUSTOM comprimido gzip, `-Fc -Z9`)
- **Fecha**: 2026-08-31 19:11 UTC
- **Génesis**: `pg_dump` de Postgres 16 (contenedor `ops-postgres` / imagen
  `pgvector/pgvector:pg16`).
- **Contenido verificado**: extensión `uuid-ossp`, 23 tablas (`customers`, `users`,
  `documents`, `document_versions`, `tickets`, `roles`, `audit_logs`, `contacts`,
  `appointments`, `assets`, `sites`, `mailbox_rules`, …), 153 TOC entries.

## Comando usado

```bash
# 1) Dump dentro del contenedor (el `-T` + redirección de PowerShell fallaba,
#    así que se genera adentro y luego se copia al host con `docker cp`).
docker exec ops-postgres sh -c \
  "pg_dump -U ops -Fc -Z9 ops_msp > /tmp/backup.dump"

# 2) Copiar al host a `backup/` (carpeta del proyecto).
docker cp ops-postgres:/tmp/backup.dump \
  "D:\Sistema de Tickets Agenda\backup\ops_msp_pre_migracion_completa_20260831-191141.dump"
```

> Alternativa (equivalente, sin archivo intermedio) usando `docker compose`:
> ```bash
> docker compose -f docker-compose.dev.yml exec -T postgres \
>   pg_dump -U ops -Fc -Z9 ops_msp > backup/ops_msp_pre_migracion_completa_20260831-191141.dump
> ```
> (En un shell Unix `-T` funciona; en PowerShell de Windows conviene el `docker cp`.)

## Cómo RESTAURAR SolidOps si la migración sale mal

```bash
# 1) Detené el backend para evitar escrituras concurrentes.
docker compose -f docker-compose.dev.yml stop backend

# 2) Tirá la base actual y restaurá el dump.
docker compose -f docker-compose.dev.yml exec -T postgres \
  dropdb -U ops ops_msp --if-exists
docker compose -f docker-compose.dev.yml exec -T postgres \
  createdb -U ops ops_msp
docker compose -f docker-compose.dev.yml exec -T postgres \
  pg_restore -U ops -d ops_msp --clean --if-exists < backup/ops_msp_pre_migracion_completa_20260831-191141.dump

# 3) Reiniciá el backend.
docker compose -f docker-compose.dev.yml up -d backend
```

> Si `dropdb`/`createdb` fallan por permisos, usá el usuario superusuario
> (`-U ops` es el default de este stack; el nombre real está en `POSTGRES_USER`).
> El dump se restaura con `--clean --if-exists` para no errorar por objetos que ya
> existen.

## Nota

El tamaño comprimido (~343 KB) es menor al backup anterior
(`ops_msp_pre_documentos_20260831-134916.dump`, 568 KB) solo porque gzip comprime
distinto: lo que importa es que el nuevo refleja **el estado actual** (416 clientes,
23 tablas) y es restaurable (verificado con `pg_restore -l`).
