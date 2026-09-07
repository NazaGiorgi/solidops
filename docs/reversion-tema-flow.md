# Reversión: sistema de temas "SolidOps Flow" — eliminado por completo

## Decisión
Se abandona el experimento del tema visual "SolidOps Flow". Se revirtió todo el
código y se volvió al estado anterior, donde **solo existe el diseño "Classic"** de
siempre, sin ningún sistema de temas ni toggle.

## Alcance de la reversión (fecha: 2026-09-03)

### Archivos restaurados a su estado original (pre-experimento)
| Archivo | Qué se quitó |
|---|---|
| `frontend/app/layout.tsx` (raíz) | Componente `<ThemeHydrator/>`, import, `suppressHydrationWarning`, `<head/>`. |
| `frontend/app/(app)/layout.tsx` | `<ThemeToggle/>` en el sidebar, import de `useTheme`/`THEME_OPTIONS`, y la definición `ThemeToggle`. |
| `frontend/app/(app)/tickets/page.tsx` | Wrapper `<div className="flow-tickets">` alrededor de `TicketList`. |
| `frontend/components/ticket-list.tsx` | Variante Flow (filas `flow-row`, `flow-dot`, metadata, status a la derecha). Restaurada la versión Classic-only original (`ticket-row-link`, pills). |
| `frontend/app/globals.css` | Todo el bloque CSS del tema Flow (`html[data-theme='flow'] ...flow-*`) y los estilos `.theme-toggle`. |

### Archivos nuevos eliminados (creados solo para el tema)
- `frontend/lib/theme.ts`
- `frontend/components/theme-hydrator.tsx`
- `docs/temas.md`

## Nota sobre los backups
El enunciado mencionaba archivos `.bak` generados durante la implementación. **No
existían**: durante el desarrollo del tema NO se generaron copias `.bak` (el backup
real usado fue la base de datos: `backup/ops_msp_pre_theme_20260903-123822.dump`,
que no se ve afectada por un cambio visual). La reversión se hizo reconstruyendo
exactamente los archivos originales (cuyo contenido se conocía por haberse leído
antes de cada edición).

## Verificación realizada
- **Fuente limpia**: `grep` sobre `.ts`/`.tsx`/`.css` (sin `.next`/`node_modules`)
  con los términos `data-theme`, `sopss_theme`, `ThemeToggle`, `ThemeHydrator`,
  `useTheme`, `lib/theme`, `theme-hydrator`, `SolidOps Flow`, `SolidOps Classic`,
  `flow-tickets`, `flow-row`, `flow-dot`, `theme-toggle` → **0 coincidencias**.
- **Typecheck** (`tsc --noEmit` en el contenedor): solo los errores preexistentes de
  siempre (`casillas`, `tickets/[id]`, `.next/types`); ninguno relacionado con el tema.
- **Rebuild limpio**: se borró `/app/.next` dentro del contenedor y se reinició
  `ops-frontend` (el watcher dev no siempre detecta cambios, ver nota del entorno).
- **Bundle servido limpio**: los chunks servidos ya NO contienen `data-theme`,
  `theme-toggle`, `flow-row`, `sopss_theme`, `ThemeHydrator`, `SolidOps Classic/Flow`;
  `ticket-row-link` (Classic) vuelve a estar presente.
- **Rutas**: 18 rutas principales responden 200.
- **Logs**: sin errores de tema/localStorage/module en el dev server.

## Nota del entorno (importante para quien siga trabajando)
El contenedor dev de Next no siempre propaga cambios de archivos vía bind-mount de
Windows/Docker. Tras cambios en `frontend/`, si no se ven en el navegador, reiniciar:
```
docker restart ops-frontend
```
(Verificación rápida del bundle servido: buscar el nuevo identificador en el chunk,
p. ej. `grep "ticket-row-link"` en el CSS/JS servido.)