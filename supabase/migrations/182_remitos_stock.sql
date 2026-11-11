-- 182: Ingreso al stock por foto del remito (pedido de Tadeo del 11/11,
-- parte 7 del plan Finanzas e Inventario)
--
-- CONTEXTO: hoy un ingreso al stock sin orden de compra se carga a mano, de a
-- un artículo. Tadeo pidió poder sacarle una foto al remito: la IA de Gypi lee
-- el proveedor, el número y los renglones, y lo deja "para revisar" (como Mi
-- caja). La oficina lo revisa y lo confirma; recién ahí entra al stock.
--
-- Esta migración:
--   1. remitos_stock: un remito (o ticket de materiales) leído por foto, con
--      sus renglones (descripción, código, cantidad y el artículo elegido) en
--      un jsonb, el estado (para_revisar, confirmado, descartado), quién lo
--      cargó y quién lo revisó. Al confirmarlo se crean los ingresos en
--      movimientos_stock (marcados "Remito por foto N° <id>").
--   2. RLS prendida y sin permisos para la app: la tabla solo la usa el
--      servidor (/api/stock/remitos) con la service key y filtro de empresa.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.remitos_stock (
    id                   bigserial primary key,
    empresa_id           uuid not null references public.empresa(id) on delete cascade,
    origen               text not null default 'remito' check (origen in ('remito', 'ticket')),
    proveedor            text check (proveedor is null or char_length(proveedor) <= 120),
    numero               text check (numero is null or char_length(numero) <= 60),
    fecha                date,
    foto_url             text check (foto_url is null or (char_length(foto_url) <= 500 and foto_url like 'https://%')),
    renglones            jsonb not null default '[]'::jsonb
                           check (jsonb_typeof(renglones) = 'array' and jsonb_array_length(renglones) <= 200),
    notas                text check (notas is null or char_length(notas) <= 300),
    estado               text not null default 'para_revisar' check (estado in ('para_revisar', 'confirmado', 'descartado')),
    cargado_por          uuid references public.empleados(id) on delete set null,
    cargado_por_nombre   text check (cargado_por_nombre is null or char_length(cargado_por_nombre) <= 120),
    revisado_por_nombre  text check (revisado_por_nombre is null or char_length(revisado_por_nombre) <= 120),
    revisado_at          timestamptz,
    created_at           timestamptz not null default now()
  );
  create index if not exists remitos_stock_empresa on public.remitos_stock (empresa_id, estado, created_at desc);

  alter table public.remitos_stock enable row level security;
  revoke all on public.remitos_stock from anon, authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname = 'remitos_stock';  -- t
--   select estado, count(*) from public.remitos_stock group by estado;
