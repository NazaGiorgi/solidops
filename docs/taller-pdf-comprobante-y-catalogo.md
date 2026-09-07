# Taller: arreglar PDF del comprobante + visibilidad del Catálogo de precios

## Problema 1 — PDF del comprobante vacío
Al abrir el comprobante de recepción (`/taller/[id]` → "Comprobante PDF") el navegador
mostraba "Se ha producido un error al cargar el documento PDF".

### Diagnóstico (evidencia)
- `GET /api/workshop/equipments/<id>/reception.pdf` devolvía `200 OK`,
  `Content-Type: application/pdf`, pero **`Content-Length: 0`** y cuerpo vacío (0 bytes,
  sin magic `%PDF`). El visor recibe un PDF vacío → error del navegador.
- Logs del backend: sin errores (la petición terminaba "bien", solo que vacía).

### Causa raíz
`pdf.util.ts` generaba el PDF con **pdfkit** usando el patrón:
```
const chunks: Buffer[] = [];
doc.on('data', c => chunks.push(c));
// ... dibujar ...
doc.end();
return Buffer.concat(chunks);   // ← se ejecuta ANTES de que lleguen los data events
```
pdfkit emite los eventos `data` **asíncronamente** (en el siguiente tick) tras `end()`.
Por eso `chunks` seguía vacío al hacer `Buffer.concat` → **buffer de 0 bytes**.

### Corrección
- `buildReceptionPdf` y `buildQuotePdf` ahora devuelven `Promise<Buffer>`: se construye
  el buffer dentro de `new Promise`, resolviendo en el evento `end` de la stream.
- `receptionPdf` y `quotePdf` en `workshop.service.ts` ahora hacen `await buildXxxPdf(...)`.
- Afectaba a **ambos** PDFs (comprobante y presupuesto), no solo al comprobante.

### Bug adicional encontrado y corregido (bloqueaba crear presupuestos)
`quoteNumber()` usaba `EXTRACT(YEAR FROM q."createdAt")` en SQL crudo. La columna real en
Postgres es `created_at` (TypeORM mapea pero **no traduce SQL crudo**). Al crear un
presupuesto daba `column q.createdAt does not exist` (500). Se corrigió a `q."created_at"`.
Este bug impedía generar cualquier presupuesto (y por tanto su PDF).

## Problema 2 — Poca visibilidad del Catálogo de precios
El enlace a `/taller/catalogo` era un `btn-sm btn-ghost` suelto en un `<div>` aparte, debajo
del encabezado, separado del botón "+ recibir equipo" (que sí está en el `action` del header).

### Corrección
Se movió "Catálogo de precios" al **mismo `action` del `PageHeader`**, junto a
"+ recibir equipo", como un `btn` (mismo lenguaje visual que el resto de controles).
Queda igual de visible que recibir equipo.

## Pruebas realizadas (automáticas)
- Comprobante: `200 OK`, `Content-Type: application/pdf`, `Content-Length: 2371`, magic `%PDF-`.
- Presupuesto (creado uno de prueba): `200 OK`, `Content-Length: 2399`, magic `%PDF-`.
- Creación de presupuesto: `WK-2026-00001` creado OK (antes 500 por el bug de `createdAt`).
- Rutas 200: `/taller`, `/taller/catalogo`, `/tickets`, `/taller/<id>`.
- Typecheck frontend: sin errores nuevos (taller/page limpio).

## Registro de prueba
Se dejó un presupuesto de prueba (`WK-2026-00001`) en el equipo "juan perez prueba /
PC clon" para que sirva en la verificación en vivo del PDF de presupuesto.

## Pendiente (prueba en vivo con navegador autenticado)
1. Abrir comprobante del equipo de prueba → se ve el PDF con cliente, equipo, falla,
   fecha, número de orden (`E-64065933`) y cabecera SolidoCS.
2. Probar con otro equipo (o crear uno) → el fix no es un caso aislado.
3. Comprobante de presupuesto → sigue funcionando (usa la misma corrección).
4. En `/taller`, "Catálogo de precios" ahora se ve como botón junto a "+ recibir equipo".
5. Resto de la pantalla de Taller sin cambios.

## Para aplicar
```
docker restart ops-backend
docker restart ops-frontend
```