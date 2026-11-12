-- 186: Finanzas, resumen de órdenes de pago para el CFO (12/11)
--
-- CONTEXTO: cada orden de pago (175) se mandaba sola al CFO. Ahora el dueño
-- junta varias órdenes en un Resumen de órdenes de pago: fecha, proveedor,
-- medio de pago, importe y el comprobante (opcional) de cada una, con la
-- suma de lo que se paga en forma inmediata (efectivo y transferencia) y la
-- suma de lo que se paga con cheques. El CFO lo ve con un link (sin usuario
-- de Gypi) y aprueba las órdenes de a una o todas juntas; también sale en
-- PDF.
--
-- Esta migración:
--   1. fin_resumenes_pago: el resumen (número, fecha, nota y el link del CFO).
--   2. fin_ordenes_pago.resumen_id: en qué resumen está cada orden (una orden
--      va en un solo resumen vivo; al anular el resumen queda libre).
--   3. fin_ordenes_pago.comprobante_url: la foto del comprobante (opcional).
--   4. RLS: por empresa y solo el rol gerencial, como el resto de Finanzas.
--      Sin delete: un resumen mal armado se anula.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.fin_resumenes_pago (
    id                     bigserial primary key,
    empresa_id             uuid not null references public.empresa(id) on delete cascade,
    numero                 integer not null check (numero > 0),
    fecha                  date not null,
    notas                  text check (notas is null or char_length(notas) <= 500),
    estado                 text not null default 'armado' check (estado in ('armado', 'enviado', 'anulado')),
    token                  text unique check (token is null or char_length(token) between 20 and 80),
    enviado_at             timestamptz,
    anulado_at             timestamptz,
    anulado_por_nombre     text check (anulado_por_nombre is null or char_length(anulado_por_nombre) <= 120),
    cargado_por_nombre     text check (cargado_por_nombre is null or char_length(cargado_por_nombre) <= 120),
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now()
  );
  create unique index if not exists fin_resumenes_pago_numero on public.fin_resumenes_pago (empresa_id, numero);

  alter table public.fin_ordenes_pago add column if not exists resumen_id bigint references public.fin_resumenes_pago(id) on delete set null;
  alter table public.fin_ordenes_pago add column if not exists comprobante_url text;
  begin
    alter table public.fin_ordenes_pago add constraint fin_ordenes_pago_comprobante_largo check (comprobante_url is null or char_length(comprobante_url) <= 500);
  exception when duplicate_object then null;
  end;
  create index if not exists fin_ordenes_pago_resumen on public.fin_ordenes_pago (resumen_id) where resumen_id is not null;

  alter table public.fin_resumenes_pago enable row level security;
  drop policy if exists tenant_isolation_auth_fin_resumenes_pago on public.fin_resumenes_pago;
  create policy tenant_isolation_auth_fin_resumenes_pago on public.fin_resumenes_pago for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
           and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial')
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
           and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial');
  -- Sin delete: un resumen mal armado se anula
  grant select, insert, update on public.fin_resumenes_pago to authenticated;
  grant usage, select on sequence public.fin_resumenes_pago_id_seq to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname = 'fin_resumenes_pago';  -- t
--   select column_name from information_schema.columns
--    where table_name = 'fin_ordenes_pago' and column_name in ('resumen_id', 'comprobante_url');  -- 2 filas
