-- 141: checkeo manual de OT (planificación de la producción;
-- app/lib/avanceManual.js)
--
-- CONTEXTO: lo que manda para saber cuánto va cada proceso de una OT es el
-- escaneo de piezas. Cuando no hay escaneo, gestión activa el "Checkeo manual
-- de OT" y carga el % de cada proceso a mano. Se guarda en la misma OT:
--   { "activo": true, "etapas": { "1": 100, "2": 40 }, "por": "Tadeo", "at": "…" }
-- Un proceso con alguna pieza escaneada sigue el escaneo.
--
-- ORDEN: se puede correr antes o después de unir el PR (mientras no se corra,
-- el checkeo manual avisa que falta la migración). Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  alter table public.proyectos add column if not exists avance_manual jsonb;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Debería devolver una fila:
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'proyectos' and column_name = 'avance_manual';
