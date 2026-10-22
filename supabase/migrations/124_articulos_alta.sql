-- 124: artículos nuevos dados de alta desde Gypi (Stock, ítem 40; diseño en
-- notes/diseno-articulos-nuevos.md)
--
-- CONTEXTO: si un artículo no estaba en la hoja ARTICULOS del libro MRP, no
-- se podía pedir, comprar ni retirar desde Gypi. Ahora los dueños y
-- administradores lo cargan con un formulario (los mismos campos que
-- ARTICULOS), se puede usar en el momento y el script "Gypi" de la planilla
-- lo anota al final de ARTICULOS en su próxima vuelta, antes de los
-- consumos e ingresos. La planilla sigue mandando: el SKU, el número y el
-- nombre normalizado los arma su fórmula; si le dio otro SKU que el
-- provisorio de Gypi, la app lo cambia en todos lados.
--
-- Esta migración:
--   1. articulos_alta: un renglón por artículo cargado en Gypi (quién,
--      cuándo, todos los campos de ARTICULOS) y cuándo llegó a la planilla.
--   2. articulos_stock.pack (Pack/Bulto) y articulos_stock.origen
--      ('planilla' o 'gypi'): los de Gypi que la planilla todavía no trae no
--      se apagan al sincronizar.
--   3. RLS: misma regla por empresa que el resto (089); la app escribe la
--      tabla solo por /api/stock/articulos y /api/stock/planilla.
--
-- Sin la migración, Sincronizar avisa "migración 124".
--
-- ORDEN: correr ANTES de unir el PR que la usa. Necesita la 106. Es
-- idempotente. Va en un solo bloque (do $mig$ ... $mig$) por el editor SQL
-- de Supabase.

do $mig$
begin
  create table if not exists public.articulos_alta (
    id                  bigserial primary key,
    empresa_id          uuid not null references public.empresa(id) on delete cascade,
    sku                 text not null check (char_length(sku) between 1 and 60),
    numero              integer not null check (numero > 0),
    id_planilla         text not null check (char_length(id_planilla) between 1 and 20),
    nombre              text not null check (char_length(nombre) between 1 and 200),
    nombre_articulo     text not null check (char_length(nombre_articulo) between 1 and 150),
    division            text not null check (char_length(division) between 1 and 60),
    familia             text not null check (char_length(familia) between 1 and 80),
    tipo                text not null check (char_length(tipo) between 1 and 60),
    marca               text not null check (char_length(marca) between 1 and 80),
    color               text not null check (char_length(color) between 1 and 80),
    unidad              text not null check (char_length(unidad) between 1 and 20),
    pack                text not null check (char_length(pack) between 1 and 40),
    categoria           text not null default 'C' check (categoria in ('A', 'B', 'C')),
    stock_seguridad     numeric(14, 3) check (stock_seguridad is null or stock_seguridad >= 0),
    factor_tiempo       integer check (factor_tiempo is null or factor_tiempo between 0 and 3650),
    proveedor_principal text check (proveedor_principal is null or char_length(proveedor_principal) <= 120),
    lote_minimo         numeric(14, 3) check (lote_minimo is null or lote_minimo > 0),
    empleado_id         uuid references public.empleados(id) on delete set null,
    empleado_nombre     text check (empleado_nombre is null or char_length(empleado_nombre) <= 120),
    created_at          timestamptz not null default now(),
    en_planilla_at      timestamptz,
    sku_planilla        text check (sku_planilla is null or char_length(sku_planilla) <= 60),
    aviso_planilla      text check (aviso_planilla is null or char_length(aviso_planilla) <= 300),
    unique (empresa_id, sku)
  );
  create index if not exists articulos_alta_pendientes on public.articulos_alta (empresa_id, id) where en_planilla_at is null;

  alter table public.articulos_stock add column if not exists pack text;
  alter table public.articulos_stock drop constraint if exists articulos_stock_pack_check;
  alter table public.articulos_stock add constraint articulos_stock_pack_check
    check (pack is null or char_length(pack) <= 40);
  alter table public.articulos_stock add column if not exists origen text not null default 'planilla';
  alter table public.articulos_stock drop constraint if exists articulos_stock_origen_check;
  alter table public.articulos_stock add constraint articulos_stock_origen_check
    check (origen in ('planilla', 'gypi'));

  alter table public.articulos_alta enable row level security;
  drop policy if exists tenant_isolation_auth_articulos_alta on public.articulos_alta;
  create policy tenant_isolation_auth_articulos_alta on public.articulos_alta for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  grant select, insert, update on public.articulos_alta to authenticated;
  grant usage, select on sequence public.articulos_alta_id_seq to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relrowsecurity from pg_class where relname = 'articulos_alta';  -- t
--   select column_name from information_schema.columns
--    where table_name = 'articulos_stock' and column_name in ('pack', 'origen');  -- 2 filas
