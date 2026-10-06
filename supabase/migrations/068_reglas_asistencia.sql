-- 068: Reglas de asistencia por empresa (decisión D5)
--
-- La tolerancia, el bloqueo por llegar muy tarde y el bloqueo por cantidad
-- de tardanzas en el mes eran valores fijos del código (5 / 30 min / 3ra
-- tardanza). Son reglas de cada fábrica, no del producto: ahora cada empresa
-- las define en Configuración → Reglas. Por defecto solo hay 5 minutos de
-- tolerancia y no se bloquea a nadie.
--
-- ORDEN: correr ESTA migración ANTES de aprobar el PR (la app lee la columna).

begin;

alter table public.empresa
  add column if not exists reglas_asistencia jsonb not null
  default '{"tolerancia_min": 5, "bloqueo_min": null, "bloqueo_tardanzas_mes": null}'::jsonb;

-- Reglas de la fábrica piloto (empresa "gypi"): 15 min máximo y bloqueo en
-- la 3ra tardanza del mes. Se pueden cambiar después desde la app.
update public.empresa
set reglas_asistencia = '{"tolerancia_min": 5, "bloqueo_min": 15, "bloqueo_tardanzas_mes": 3}'::jsonb
where slug = 'gypi';

commit;

-- ─── VERIFICACIÓN ───────────────────────────────────────────────────────────
--   select slug, reglas_asistencia from public.empresa order by slug;
--   (gypi con bloqueo_min 15; el resto con bloqueo_min null)
--
-- ─── REVERSIÓN (antes revertir el PR) ───────────────────────────────────────
--   alter table public.empresa drop column if exists reglas_asistencia;
