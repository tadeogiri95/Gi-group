-- 173: otras facturas de una orden de compra, de otro proveedor (Finanzas,
-- parte F2a, 3)
--
-- CONTEXTO: una orden de compra puede ser facturada en partes por distintos
-- proveedores. La factura de siempre (la de la OC, 122) queda para el
-- proveedor de la orden; lo que facturó otro va en "＋ Otra factura": su
-- proveedor, número, fecha, tipo de cambio si la orden es en dólares, otros
-- impuestos y los renglones de la orden que factura (cantidad, precio sin IVA
-- e IVA %). Cada una es su propia compra en Finanzas, en la cuenta corriente
-- de ese proveedor. Nada se borra: una factura mal cargada se anula.
--
-- Esta migración:
--   1. ordenes_compra_facturas, con los renglones en jsonb
--      ([{ item_id, descripcion, cantidad, precio, iva }]).
--   2. RLS: misma regla por empresa que el resto (089); la app escribe solo
--      por /api/compras.
--
-- Sin la migración el botón "＋ Otra factura" avisa "migración 173"; lo demás
-- de Compras sigue igual.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.ordenes_compra_facturas (
    id                  bigserial primary key,
    empresa_id          uuid not null references public.empresa(id) on delete cascade,
    orden_id            bigint not null references public.ordenes_compra(id) on delete cascade,
    proveedor_id        bigint references public.proveedores(id) on delete set null,
    proveedor_nombre    text not null check (char_length(proveedor_nombre) between 1 and 120),
    numero              text check (numero is null or char_length(numero) <= 60),
    fecha               date not null,
    -- En la moneda de la orden; si es en dólares, pesos por dólar
    tipo_cambio         numeric(14, 4) check (tipo_cambio is null or tipo_cambio > 0),
    otros_impuestos     numeric(16, 2) not null default 0 check (otros_impuestos >= 0),
    renglones           jsonb not null default '[]'::jsonb check (jsonb_typeof(renglones) = 'array'),
    cargada_por         uuid references public.empleados(id) on delete set null,
    cargada_por_nombre  text check (cargada_por_nombre is null or char_length(cargada_por_nombre) <= 120),
    anulada_at          timestamptz,
    anulada_por_nombre  text check (anulada_por_nombre is null or char_length(anulada_por_nombre) <= 120),
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
  );
  create index if not exists ordenes_compra_facturas_orden on public.ordenes_compra_facturas (empresa_id, orden_id);

  alter table public.ordenes_compra_facturas enable row level security;
  drop policy if exists tenant_isolation_auth_ordenes_compra_facturas on public.ordenes_compra_facturas;
  create policy tenant_isolation_auth_ordenes_compra_facturas on public.ordenes_compra_facturas for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  -- Sin delete: una factura mal cargada se anula
  grant select, insert, update on public.ordenes_compra_facturas to authenticated;
  grant usage, select on sequence public.ordenes_compra_facturas_id_seq to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname = 'ordenes_compra_facturas';  -- t
