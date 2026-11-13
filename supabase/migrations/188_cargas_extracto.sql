-- 188: Finanzas, registro de cada carga del extracto del banco (13/11, parte 5
-- del plan de Tesorería y Devengamiento)
--
-- CONTEXTO: el extracto del banco se sube, se revisa y se cargan los
-- movimientos que faltan. Hasta ahora no quedaba registro de cada carga: si
-- se subía mal (otro banco, otro mes) había que anular uno por uno.
--
-- Esta migración:
--   1. fin_cargas_banco: cada carga del extracto (cuenta, archivo, período,
--      quién, cuántos movimientos leyó y cuántos cargó) con la lista de las
--      operaciones que generó (op_ids).
--   2. Deshacer: la carga entera o solo algunos renglones. Las operaciones se
--      anulan (no se borran) y la carga queda marcada como deshecha.
--   3. RLS: por empresa y solo el rol gerencial, como el resto de Finanzas.
--      Sin delete: una carga se deshace.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.fin_cargas_banco (
    id                     bigserial primary key,
    empresa_id             uuid not null references public.empresa(id) on delete cascade,
    cuenta                 text not null check (char_length(cuenta) between 1 and 40),
    archivo                text check (archivo is null or char_length(archivo) <= 200),
    desde                  date,
    hasta                  date,
    movimientos            integer not null default 0 check (movimientos >= 0),
    cargadas               integer not null default 0 check (cargadas >= 0),
    op_ids                 jsonb not null default '[]'::jsonb check (jsonb_typeof(op_ids) = 'array' and jsonb_array_length(op_ids) <= 2000),
    cargada_por_nombre     text check (cargada_por_nombre is null or char_length(cargada_por_nombre) <= 120),
    deshecha_at            timestamptz,
    deshecha_por_nombre    text check (deshecha_por_nombre is null or char_length(deshecha_por_nombre) <= 120),
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now()
  );
  create index if not exists fin_cargas_banco_cuenta on public.fin_cargas_banco (empresa_id, cuenta, created_at desc);

  alter table public.fin_cargas_banco enable row level security;
  drop policy if exists tenant_isolation_auth_fin_cargas_banco on public.fin_cargas_banco;
  create policy tenant_isolation_auth_fin_cargas_banco on public.fin_cargas_banco for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
           and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial')
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
           and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial');
  -- Sin delete: una carga se deshace
  grant select, insert, update on public.fin_cargas_banco to authenticated;
  grant usage, select on sequence public.fin_cargas_banco_id_seq to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname = 'fin_cargas_banco';  -- t
