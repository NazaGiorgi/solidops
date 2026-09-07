# Extraer el logo de la empresa desde Zammad (SolidoCS)

El logo ya está cargado en la configuración visual de Zammad (se ve en el login).
Estos pasos lo extraen **sin modificar nada en Zammad** (script de solo lectura).
Hay que ejecutarlo en la VM de Zammad vía SSH.

> Nota: OpenCode no tiene acceso a la VM. Los pasos 1-3 los ejecutás vos en tu
> terminal (Windows PowerShell) o directamente en la VM por SSH.

## Paso 1 — Subir el script de extracción a la VM

En tu PC, desde la carpeta raíz del proyecto:

```powershell
scp import/export_logo.rb administrador@10.88.88.40:/tmp/export_logo.rb
```

(Si el usuario de SSH es `root` u otro, ajustá `administrador@10.88.88.40`.)

## Paso 2 — Correr el script en la VM (solo lectura)

```bash
ssh administrador@10.88.88.40
sudo su - zammad -s /bin/bash -c "mkdir -p /tmp/zammad && zammad run rails runner /tmp/export_logo.rb"
```

El script:
- Lista los `Setting` cuyo nombre contenga `logo`/`brand`/`firm`/`header`.
- Decodifica el logo (base64) si está en el setting, AND detecta la extensión real
  por los primeros bytes (magic: PNG/JPG/GIF/SVG/WEBP/ICO), NO por el nombre.
- Como fallback, busca en `Store` (adjuntos de imagen de Zammad).
- Escribe el/los archivos en `/tmp/zammad/`.

Al final del output verás algo como:
```
GUARDADO /tmp/zammad/logo-product_logo-<ts>.svg (xx bytes, svg)
```

Anotá el nombre del archivo que genera (puede ser `logo-...png`, `logo-...svg`, o
`store-<id>-<nombre>`).

## Paso 3 — Traer el logo a tu PC

```powershell
scp administrador@10.88.88.40:/tmp/zammad/logo-*.png ./frontend/public/logo.png
```

> Si el archivo es SVG, usá `logo-*.svg` y renombralo: el branding del frontend
> acepta `/logo.png`, `/logo.svg` o `/logo.jpg` (en ese orden de preferencia).
> Ajustá el comando según la extensión real que apareció en el Paso 2.
> Por ejemplo (SVG):
> ```powershell
> scp administrador@10.88.88.40:/tmp/zammad/store-123-product_logo ./frontend/public/logo.svg
> ```

## Paso 4 — Verificar que el logo es válido

En tu PC:

```powershell
# Windows: mostra los primeros bytes / tamaño
Get-Item .\frontend\public\logo.png | Select-Object Name, Length
```

El archivo debe tener tamaño > 0 y terminar en `.png`/`.svg`/`.jpg`.

## Paso 5 — Confirmar visualmente

Recargá (Ctrl+F5) la app e ingresá a:
- `/portal/login` — login del portal de clientes → debe verse el logo.
- `/login` — login del panel interno → debe verse el logo.
- Sidebar (tras iniciar sesión) → logo pequeño arriba.

Si el logo aparece pero muy grande/chico, se puede ajustar el tamaño en
`frontend/components/brand-logo.tsx` (`size`). Proporciones mantenidas
(`objectFit: contain`, sin distorsión).

## Qué hace el componente de branding
- `BrandLogo` (`frontend/components/brand-logo.tsx`): intenta cargar
  `/logo.png`, `/logo.svg`, `/logo.jpg` (en ese orden). Si ninguno existe aún,
  muestra el nombre de la empresa como texto (fallback, no rompe el login).
- Se usa en el login del portal, el login del panel interno y el sidebar.

## Rollback
- Si el logo se ve mal, borrá `frontend/public/logo.png` (y `.svg`/`.jpg`) y el
  `BrandLogo` volverá al fallback de texto. No se toca nada de Zammad.
