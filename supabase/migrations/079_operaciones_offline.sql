-- 079_operaciones_offline.sql — Fichar y cargar tareas sin conexión (F4-05, ítem 21).
--
-- 1. operaciones_offline: lo que el celular guardó sin señal y mandó después.
--    Cada operación trae un id generado en el teléfono (op_id); si llega dos
--    veces (se cortó la señal justo después de guardarse), el servidor
--    devuelve el mismo resultado en vez de registrarla de nuevo. Solo la usa
--    el servidor con la service key (RLS activado, sin políticas).
-- 2. registro_actividades.chk_division: limitaba la división a las tres de la
--    empresa piloto (herreria, muebles, aberturas). Con divisiones por empresa,
--    una empresa nueva no podía registrar tareas. Se quita.

create table if not exists public.operaciones_offline (
  op_id       uuid primary key,
  empresa_id  uuid not null,
  empleado_id uuid,
  tipo        text not null,
  resultado   jsonb,
  creado_en   timestamptz not null default now()
);

create index if not exists idx_operaciones_offline_creado
  on public.operaciones_offline (creado_en);

alter table public.operaciones_offline enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.operaciones_offline from anon, authenticated;
  end if;
end $$;

alter table public.registro_actividades drop constraint if exists chk_division;

-- ─── VERIFICACIÓN ───────────────────────────────────────────────────────────
--   select count(*) from public.operaciones_offline;          -- 0 (la tabla existe)
--   select conname from pg_constraint
--    where conrelid = 'public.registro_actividades'::regclass and conname = 'chk_division';  -- sin filas
