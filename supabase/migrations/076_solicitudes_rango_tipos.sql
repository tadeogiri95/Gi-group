-- 076: Solicitudes con rango de fechas y tipos por empresa (F4-12, F1-21, H9, ítem 23)
--
-- - solicitudes.fecha_hasta: último día (inclusive) de una solicitud de varios
--   días, p. ej. vacaciones del 3 al 10. `fecha` sigue siendo el primer día.
--   Antes solo había un día por solicitud y la liquidación contaba 1 día.
-- - solicitudes.etiqueta: el nombre del tipo que eligió la empresa (p. ej.
--   "Examen"), cuando no es uno de los tipos de siempre.
-- - empresa.tipos_solicitud: los tipos que ofrece cada empresa en el
--   formulario. null = la lista de siempre.
--
-- Hay que correrla ANTES de aprobar el PR: la liquidación y el formulario usan
-- estas columnas. Es idempotente.

alter table public.solicitudes
  add column if not exists fecha_hasta date,
  add column if not exists etiqueta text;

alter table public.empresa
  add column if not exists tipos_solicitud jsonb;

comment on column public.solicitudes.fecha_hasta is 'Último día (inclusive) si la solicitud abarca varios días (F1-21).';
comment on column public.solicitudes.etiqueta is 'Nombre del tipo de solicitud configurado por la empresa (H9).';
comment on column public.empresa.tipos_solicitud is 'Tipos de solicitud que ofrece la empresa; null = los de siempre (H9).';
