# Dedupe por dominio al crear contacto desde el panel

Sugerencia de unificación automática (con confirmación del técnico) al crear un
contacto manualmente: si el email tiene un dominio que ya existe en otro cliente,
se sugiere asociarlo ahí en vez de dejarlo suelto / crear empresa duplicada.

## Dominios excluidos (proveedores de correo personales/gratuitos)
`backend/src/common/utils/email-domain.ts`:
- `PERSONAL_EMAIL_DOMAINS` (Set): gmail.com, gmail.com.ar, googlemail.com,
  hotmail.com, hotmail.com.ar, hotmail.es, outlook.com, outlook.com.ar,
  outlook.es, live.com, live.com.ar, msn.com, yahoo.com, yahoo.com.ar,
  yahoo.com.mx, icloud.com, me.com, mac.com, aol.com, protonmail.com,
  proton.me, zoho.com, yopmail.com, fibertel.com.ar, speedy.com.ar,
  telecentro.com.ar, arnet.com.ar, ciudad.com.ar.
- Helpers: `extractEmailDomain(email)` y `isPersonalEmailDomain(domain)`.

**Decisión sobre datos reales**: la consulta a la BD mostró `gmail.com`
(9 clientes, 83 contactos), `hotmail.com` (4, 37) y `yahoo.com.ar` (3, 6) como
los dominios genéricos repetidos entre distintos clientes → todos excluidos.
`solidocs.com.ar` también aparece en 3 clientes (es el dominio propio del MSP,
no un proveedor personal) → **no** se excluye porque es un dominio legítimo de
empresa y está fuera del alcance pedido (solo proveedores personales/gratuitos).

## Backend
- **`suggestByDomain(email, excludeCustomerId?)`** en `customers.service.ts`:
  - Extrae el dominio; si es personal → `{ excluded: true, candidates: [] }`.
  - Si no, busca contactos con ese dominio agrupados por `customer_id`,
    excluyendo el `excludeCustomerId` (el cliente actual, para no sugerirse a
    sí mismo), ordenando por cantidad de coincidencias. Devuelve
    `{ excluded: false, domain, candidates: [{ customerId, customerName, contactCount }] }`.
  - IMPORTANTE: la ruta `GET /customers/suggest-by-domain` está declarada
    **ANTES** de `GET /customers/:id` en el controller, para que no la tome
    como un id UUID.
  - Permiso: `CUSTOMERS_CREATE`.

## Frontend (`clientes/[id]/page.tsx` → `AddContact`)
- Al escribir el email (debounced 400ms), llama a
  `GET /customers/suggest-by-domain?email=...&excludeCustomerId=<cliente actual>`.
- Si hay coincidencia con otro cliente, muestra aviso:
  *"Ya existe N contacto(s) con el dominio @... en el cliente 'X'. ¿Asociar este
  contacto ahí en vez de al cliente actual?"*
- Botones:
  - **"Asociar a X"** → crea el contacto en el cliente sugerido (POST a
    `customers/<sugerido>/contacts`), sin crear cliente nuevo.
  - **"No, mantener en <actual>"** → oculta la sugerencia y crea el contacto en
    el cliente actual (el técnico decide, por si es un falso positivo).
- No es automático ni silencioso: el técnico siempre ve y confirma.

## Verificación en vivo (API real)
1. `nuevo.empleado@melacrom.com.ar` → `excluded:false`, candidatos ordenados
   (top = "Melacrom", 17 contactos). ✓
2. `fulano@gmail.com` → `excluded:true`, sin candidatos. ✓
3. `x@empresanueva123xyz.com.ar` → `excluded:false`, sin candidatos (nuevo). ✓
4. `excludeCustomerId` elimina al cliente actual de los candidatos. ✓
E2E (flujo de aceptar sugerencia): desde la página de "Mauricio Maldonado",
aceptar → contacto creado en **Melacrom**, **417 clientes antes = 417 después**
(sin duplicado), visible en la lista de contactos de Melacrom. Contacto de
prueba eliminado luego.

## No-regresión
`/`, `/clientes`, detalle de cliente, `/tickets`, detalle de ticket, `/agenda`,
`/documentos`, `/notas`, `/dashboard`, `/usuarios` → 200. `tsc` 0 errores
(backend y frontend).

## Backups / rollback
`backup\domain-dedupe\` → `email-domain.ts`, `customers.service.ts`,
`customers.controller.ts`, `clientes-id-page.tsx`.
