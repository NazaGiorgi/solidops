# Prompt para OpenCode — El `Shell` se remonta en loop constante (evidencia real de consola), reseteando el estado del acordeón de Tickets

## Contexto crítico para OpenCode

Con la consola del navegador abierta, se ve este patrón repitiéndose sin parar, varias veces por segundo:

```
[shell] rendering, calling useAgendaReminders
[reminders] MOUNTED {hasToken: true, dismissedCount: 1}
[reminders] fetching {from: '...', to: '...', count: 0}
[shell] rendering, calling useAgendaReminders
[reminders] MOUNTED {hasToken: true, dismissedCount: 1}
...
```

Esto indica que el componente `Shell` (el layout que envuelve sidebar + contenido, usado en toda la app) se está **remontando en loop constantemente**, no solo renderizando de más. Esta es la causa real de que el acordeón de "TICKETS" parezca no responder al clic: el estado `ticketsExpanded` cambia por un instante al hacer clic, pero el remount inmediato del `Shell` lo resetea a su valor inicial antes de que el usuario note el cambio.

Esto es una causa distinta (y probablemente más de fondo) que el problema de `next/font/google` corregido en el prompt anterior — puede que ese fix haya sido necesario pero no suficiente, o puede que haya sido una pista falsa y el remount loop sea la causa real desde el principio.

Seguir la metodología habitual: explicar → investigar con evidencia real (esta vez con la consola real, no solo compilación) → corregir → probar en vivo → verificar que no rompe nada existente → documentar.

---

## Parte 1 — Diagnosticar por qué el Shell se remonta en loop

- Revisar `useAgendaReminders` (o el hook detrás de `[reminders] fetching`/`MOUNTED`): ¿tiene un `useEffect` con dependencias mal declaradas que se disparan en cada render (ej. un objeto o función nueva en cada render dentro del array de dependencias, en vez de un valor primitivo estable)?
- Revisar si el `Shell` en sí tiene alguna `key` que cambie en cada render (una `key={Date.now()}` o similar sería una causa clásica de remount forzado), o si algún componente padre está recreando el `Shell` con nuevas props/referencias en cada ciclo.
- Confirmar con evidencia real (agregar logs temporales si hace falta, con timestamp) cada cuánto se repite el ciclo completo — si es cada 1 segundo, cada 100ms, etc., para entender la magnitud del problema.
- Revisar también si hay un `setInterval`/`setTimeout` de polling relacionado a los recordatorios de agenda que esté disparando un re-render/remount del árbol completo en vez de solo actualizar su propio estado local aislado.

## Parte 2 — Corregir el loop

- Corregir la causa raíz encontrada — el objetivo es que `Shell` (y por lo tanto el sidebar y su estado de acordeón) se monte **una sola vez** por navegación de página, no en loop.
- Si el polling de recordatorios de agenda es legítimo y necesario (revisar recordatorios periódicamente), debe hacerse sin causar remount del árbol completo — normalmente actualizando estado local dentro del propio hook/componente de recordatorios, sin afectar a los componentes padres/hermanos como el sidebar.

## Parte 3 — Prueba en vivo (con consola abierta, evidencia real)

1. Abrir `/tickets` con la consola del navegador abierta y confirmar que el patrón `[shell] rendering` / `[reminders] MOUNTED` YA NO se repite en loop — debe aparecer una sola vez al cargar la página, no continuamente.
2. Con eso confirmado, hacer clic en "TICKETS" y confirmar que la lista se oculta, y que el log `TICKETS CLICK` aparece una sola vez por clic (no en loop).
3. Hacer clic de nuevo y confirmar que la lista reaparece.
4. Confirmar que los recordatorios de agenda (el propósito original de `useAgendaReminders`) siguen funcionando con normalidad después del fix — no romper esa funcionalidad al corregir el remount.
5. Dejar la página abierta unos 30 segundos sin interactuar y confirmar que no vuelve a aparecer el patrón de remount en loop de forma espontánea.

## Entregable esperado
- Causa raíz del remount loop confirmada con evidencia real de consola (no solo lógica/compilación).
- Fix aplicado.
- Confirmación de las 5 pruebas en vivo, con capturas o transcripción de la consola mostrando que el loop ya no ocurre.
- Confirmación de que los recordatorios de agenda siguen funcionando.
- Quitar los logs de diagnóstico temporales (`TICKETS CLICK`, `MOUNT`/`UNMOUNT`) una vez confirmado el fix, a menos que el usuario prefiera dejarlos.
