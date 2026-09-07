# Prompt para OpenCode — Nuevo módulo: Recepción de equipos para reparación (Taller), vinculado a Tickets, con comprobante PDF

## Contexto para OpenCode

Nuevo módulo para SolidOps: un sistema para registrar equipos que ingresan a reparación en el taller. Decisiones ya confirmadas por el usuario:

- **Cada equipo genera/se vincula a un Ticket normal** (no es un registro aparte) — esto conecta con el grupo "Taller" ya existente en el sistema de tickets.
- **Genera un comprobante PDF** para entregarle al cliente al recibir el equipo, como constancia.
- **Estados del equipo**: Recibido → En diagnóstico → Diagnosticado → En reparación → Listo para retirar → Entregado.
- **Debe poder vincularse a una empresa/cliente existente** (el `Customer` ya existente en el sistema).

Antes de implementar, investigar el grupo "Taller" ya existente en `legacy_group` y cómo se relacionan hoy esos tickets, para no duplicar conceptos ni romper esa vista ya existente.

Seguir la metodología habitual: explicar → investigar qué ya existe → presentar el diseño propuesto al usuario para confirmar → implementar → probar en vivo → verificar que no rompe nada existente → documentar.

---

## Parte 0 — Investigar y presentar el diseño antes de implementar

- Confirmar cómo funciona hoy el grupo "Taller" en tickets (`legacy_group = 'Taller'`, 95 tickets migrados) — si tiene algún campo o estructura ya relacionada a equipos, o es solo texto libre en el ticket.
- Confirmar cómo distingue hoy el sistema entre clientes empresa y clientes particulares/finales (ya se vio en el sistema la categoría "Clientes particulares" en tickets existentes) — el módulo de equipos debe poder asociarse a **cualquiera de los dos tipos** sin asumir que siempre hay una empresa detrás, ya que SolidoCS también atiende consumidores finales directamente para este servicio de taller.
- Presentar al usuario el modelo de datos propuesto (Parte 1) antes de implementar.

## Parte 1 — Modelo de datos

- Nueva entidad `RepairEquipment` (o nombre similar, consistente con el proyecto), vinculada 1-a-1 (o 1 ticket puede tener varios equipos, confirmar con el usuario si aplica) a un `Ticket`:
  - **Datos del cliente**: se toman del `Customer`/`Contact` ya vinculado al ticket (reusar lo existente, no duplicar campos de cliente en esta entidad — pero confirmar explícitamente que el ticket tiene un contacto con teléfono, email y dirección disponibles; si no, permitir cargarlos directamente en este módulo como excepción). **El cliente asociado puede ser una empresa O un cliente particular/final** — el buscador de cliente al registrar el equipo debe permitir buscar y elegir entre ambos tipos sin distinción forzada, ya que SolidoCS ofrece este servicio a los dos.
  - **Datos del equipo**: tipo de equipo (PC, notebook, impresora, router, otro — como selector, con "otro" + texto libre), marca, modelo, número de serie (opcional), accesorios que se reciben junto al equipo (cargador, mouse, funda, etc. — texto libre o checklist simple), estado físico/observaciones visuales al recibir (texto libre, ej. rayones, golpes).
  - **Falla reportada por el cliente**: texto libre, obligatorio.
  - **Diagnóstico**: sección separada (texto libre), completada por el técnico después de revisar el equipo — puede estar vacía al recibir el equipo, se completa en la etapa "Diagnosticado".
  - **Estado**: enum con las 6 etapas acordadas (Recibido → En diagnóstico → Diagnosticado → En reparación → Listo para retirar → Entregado).
  - Fecha de ingreso, fecha de entrega (se completa al pasar a "Entregado").

## Parte 2 — Backend

- CRUD de `RepairEquipment`, vinculado siempre a un `Ticket` (crear el equipo debe crear o vincularse a un ticket existente del grupo/categoría correspondiente).
- Endpoint para generar el comprobante PDF (ver Parte 3).
- Transición de estados con validación básica (no saltar de "Recibido" directo a "Entregado" sin pasar por las etapas intermedias, salvo que el usuario prefiera permitir saltos libres — confirmar).

## Parte 3 — Comprobante PDF

- Al registrar el ingreso de un equipo, generar un PDF descargable/imprimible con: datos del cliente (nombre, teléfono, email), datos del equipo (tipo, marca, modelo, número de serie, accesorios), falla reportada, fecha de ingreso, número de ticket/comprobante, y branding de SolidoCS (usar el logo ya cargado en el proyecto, `frontend/public/logo.svg`).
- Investigar si el proyecto ya tiene algún generador de PDF instalado (para reusar) o si hace falta agregar una librería nueva — preferir reusar si existe algo similar en el proyecto (ej. algo usado para reportes).

## Parte 4 — Frontend

- Nueva sección o flujo de "Recepción de equipo" — puede vivir dentro de la creación de un ticket (cuando el ticket es de tipo Taller) o como un flujo dedicado, a definir en la Parte 0 con el usuario.
- Formulario de carga: buscador/selector de cliente existente (autocomplete, reusando componentes ya existentes en el proyecto), datos del equipo, falla reportada.
- Vista de detalle del equipo con el estado actual, historial de cambios de estado, y sección de diagnóstico editable.
- Botón para generar/descargar el comprobante PDF.
- El equipo/ticket de Taller debe aparecer correctamente en las bandejas y vistas de Tickets ya existentes.

## Parte 5 — Prueba en vivo

1. Registrar el ingreso de un equipo nuevo, vinculado a un cliente existente, con todos los datos.
2. Confirmar que se generó el ticket correspondiente en el grupo/categoría de Taller.
3. Generar y descargar el comprobante PDF, confirmar que tiene todos los datos correctos y el logo de SolidoCS.
4. Avanzar el equipo por los 6 estados (Recibido → ... → Entregado) y confirmar que cada transición se guarda correctamente.
5. Completar el diagnóstico en la etapa correspondiente y confirmar que se guarda y se puede ver después.
6. Confirmar que el ticket vinculado sigue siendo visible y consistente en las vistas normales de Tickets.

## Entregable esperado
- Diseño presentado y confirmado por el usuario antes de implementar (Parte 0).
- Módulo completo funcionando: registro de equipo, estados, diagnóstico, comprobante PDF, vínculo a cliente y ticket.
- Confirmación de las 6 pruebas en vivo.
- Documentación del nuevo módulo.
