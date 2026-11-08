-- 168: facturas sueltas y artículos "Sin asociar" (costo de OT, parte D;
-- diseño en notes/diseno-costo-ot.md; app/lib/facturasSueltas.js)
--
-- CONTEXTO: Tadeo pidió (08/11) poder cargar facturas que no pasaron por una
-- orden de compra (a mano, o subiendo un PDF o una foto que lee la IA) para
-- que sus precios entren a la lista de precios de cada artículo. Cada
-- renglón se reconoce con un artículo del MRP; lo que no se reconoce queda
-- "Sin asociar" hasta que alguien lo elige, y Gypi lo recuerda para la
-- próxima factura de ese proveedor. La factura suelta solo suma precio: no
-- mueve stock.
--
-- Esta migración:
--   1. facturas_sueltas: cabecera (proveedor, número, fecha, moneda, tipo de
--      cambio, quién la cargó y cómo). Se anula, no se borra.
--   2. facturas_sueltas_renglones: descripción, código, cantidad, precio
--      unitario sin IVA y el artículo asociado (null = Sin asociar).
--   3. asociaciones_articulos: lo que Gypi recuerda (proveedor + texto o
--      código → artículo).
--   4. RLS: Dueño y Administración ven con su pase; la app escribe por
--      /api/facturas-sueltas con la clave del servidor.
-- El precio de cada renglón asociado entra a precios_articulos (164) con
-- origen 'factura' y referencia 'FS-<renglón>'.
--
-- ORDEN: correr ANTES de unir el PR que la usa (después de la 164). Es
-- idempotente. Va en un solo bloque (do $mig$ ... $mig$) por el editor SQL de
-- Supabase.

do $mig$
begin
  create table if not exists public.facturas_sueltas (
    id                  bigserial primary key,
    empresa_id          uuid not null references public.empresa(id) on delete cascade,
    proveedor           text not null check (char_length(proveedor) between 1 and 120),
    numero              text check (numero is null or char_length(numero) <= 60),
    fecha               date not null,
    moneda              text not null default 'ARS' check (moneda in ('ARS', 'USD')),
    tipo_cambio         numeric(14, 4) check (tipo_cambio is null or tipo_cambio > 0),
    observacion         text check (observacion is null or char_length(observacion) <= 500),
    carga               text not null default 'manual' check (carga in ('manual', 'ia')),
    cargada_por_nombre  text check (cargada_por_nombre is null or char_length(cargada_por_nombre) <= 120),
    anulada_at          timestamptz,
    anulada_por_nombre  text check (anulada_por_nombre is null or char_length(anulada_por_nombre) <= 120),
    created_at          timestamptz not null default now(),
    check (moneda = 'ARS' or tipo_cambio is not null)
  );
  create index if not exists facturas_sueltas_empresa on public.facturas_sueltas (empresa_id, created_at desc);

  create table if not exists public.facturas_sueltas_renglones (
    id                   bigserial primary key,
    empresa_id           uuid not null references public.empresa(id) on delete cascade,
    factura_id           bigint not null references public.facturas_sueltas(id) on delete cascade,
    orden                integer not null default 0,
    descripcion          text not null check (char_length(descripcion) between 1 and 200),
    codigo               text check (codigo is null or char_length(codigo) <= 60),
    cantidad             numeric(14, 3) not null check (cantidad > 0),
    precio               numeric(16, 4) not null check (precio >= 0 and precio < 10000000000),
    sku                  text check (sku is null or char_length(sku) between 1 and 60),
    asociado_como        text check (asociado_como is null or asociado_como in ('memoria', 'codigo', 'sku', 'nombre', 'manual')),
    asociado_por_nombre  text check (asociado_por_nombre is null or char_length(asociado_por_nombre) <= 120),
    asociado_at          timestamptz,
    created_at           timestamptz not null default now()
  );
  create index if not exists facturas_sueltas_renglones_factura on public.facturas_sueltas_renglones (factura_id, orden);
  create index if not exists facturas_sueltas_renglones_sin on public.facturas_sueltas_renglones (empresa_id) where sku is null;

  create table if not exists public.asociaciones_articulos (
    empresa_id         uuid not null references public.empresa(id) on delete cascade,
    proveedor_clave    text not null check (char_length(proveedor_clave) between 1 and 120),
    tipo               text not null check (tipo in ('texto', 'codigo')),
    clave              text not null check (char_length(clave) between 1 and 200),
    sku                text not null check (char_length(sku) between 1 and 60),
    creado_por_nombre  text check (creado_por_nombre is null or char_length(creado_por_nombre) <= 120),
    updated_at         timestamptz not null default now(),
    primary key (empresa_id, proveedor_clave, tipo, clave)
  );

  alter table public.facturas_sueltas enable row level security;
  alter table public.facturas_sueltas_renglones enable row level security;
  alter table public.asociaciones_articulos enable row level security;

  drop policy if exists facturas_sueltas_gestion on public.facturas_sueltas;
  create policy facturas_sueltas_gestion on public.facturas_sueltas for select to authenticated
    using (
      empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
      and (current_setting('request.jwt.claims', true)::json->>'rol') in ('gerencial', 'administrativo')
    );
  drop policy if exists facturas_sueltas_renglones_gestion on public.facturas_sueltas_renglones;
  create policy facturas_sueltas_renglones_gestion on public.facturas_sueltas_renglones for select to authenticated
    using (
      empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
      and (current_setting('request.jwt.claims', true)::json->>'rol') in ('gerencial', 'administrativo')
    );
  drop policy if exists asociaciones_articulos_gestion on public.asociaciones_articulos;
  create policy asociaciones_articulos_gestion on public.asociaciones_articulos for select to authenticated
    using (
      empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
      and (current_setting('request.jwt.claims', true)::json->>'rol') in ('gerencial', 'administrativo')
    );

  grant select on public.facturas_sueltas, public.facturas_sueltas_renglones, public.asociaciones_articulos to authenticated;
  grant select, insert, update, delete on public.facturas_sueltas, public.facturas_sueltas_renglones, public.asociaciones_articulos to service_role;
  grant usage, select on sequence public.facturas_sueltas_id_seq, public.facturas_sueltas_renglones_id_seq to service_role;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Después de cargar una factura suelta:
--   select f.proveedor, f.numero, f.fecha, count(r.*) renglones, count(r.sku) asociados
--     from public.facturas_sueltas f join public.facturas_sueltas_renglones r on r.factura_id = f.id
--    group by f.id order by f.created_at desc limit 5;
--   select sku, fecha, precio_ars, proveedor from public.precios_articulos where origen = 'factura' order by created_at desc limit 10;
