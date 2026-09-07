-- REFERENCIA: datos baseline con los que `RUN_SEED=true` (o `npm run seed`)
-- crea la plataforma al primer arranque. No se ejecuta como script; es solo
-- documentación de QUÉ espera el sistema en una instancia nueva con seed.
--
-- En una instalación nueva (VPS) con `RUN_SEED=false`, este contenido NO se
-- agrega automáticamente: se restaura desde el `backup.sql` que exportás en
-- local (ver docs/MIGRATION-RUNBOOK.md).

-- roles ---------------------------------------------------------------------
-- Administrador | Supervisor | Coordinador | Técnico | Consulta
-- (con sus permisos por módulo definidos en backend/src/common/auth/permissions.ts)

-- usuarios por defecto (password: demo1234) ---------------------------------
--   ana@msp.local    (Supervisor)  -> ve dashboard general
--   lucas@msp.local  (Coordinador)
--   maria@msp.local  (Técnico, senior, redes/servidores/email) -> ve Mi día
--   pedro@msp.local  (Técnico, mid, soporte-apps/impresoras)

-- cliente demo --------------------------------------------------------------
--   Panadería Don Pedro
--     contacto: Pedró Pérez <pedro.panaderia@example.com> / +54 11 1234 5678
--     sitio: Local central (Av. Siempre Viva 123, Buenos Aires)
--     contrato: "Básico"
--       sla_first_response_minutes = 60
--       sla_resolution_hours = 8
--       business_hours = lun-vie 09:00-18:00
--       priority_tier: critica -> 15 min / 1 h ; alta -> 30 min / 4 h
