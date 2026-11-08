-- 165: precio fijo de cada artículo en cada OT (costo de materiales por OT,
-- parte B; diseño en notes/diseno-costo-ot.md; app/lib/costoMateriales.js)
--
-- CONTEXTO: el costo de materiales de una OT es la suma de cantidad necesaria
-- (hoja de necesidades del MRP) × precio. El precio de cada artículo es el de
-- fecha más cercana al día en que la OT entró a Gypi sin pasarse (si no hay,
-- el primero después). Tadeo pidió (08/11) que ese precio quede FIJO en la
-- OT: la primera vez que un artículo consigue precio se guarda acá y las
-- compras más nuevas no lo cambian. Solo se vuelve a buscar con el botón
-- "Volver a buscar precio", y queda anotado quién lo hizo y el precio de antes.
--
-- Esta migración:
--   1. precios_fijos_ot: un renglón por OT y artículo, con el precio elegido
--      (sin IVA, en su moneda y en pesos), su fecha, origen y comprobante.
--   2. RLS: solo el Dueño con su pase; la app la lee y escribe por
--      /api/costo-ot (Dueño y Supervisor), con la clave del servidor después
--      de verificar el permiso y filtrando por la empresa.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un solo
-- bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.precios_fijos_ot (
    empresa_id          uuid not null references public.empresa(id) on delete cascade,
    ot                  text not null check (char_length(ot) between 1 and 40),
    sku                 text not null check (char_length(sku) between 1 and 60),
    fecha               date not null,
    precio              numeric(16, 4) not null check (precio >= 0),
    moneda              text not null default 'ARS' check (moneda in ('ARS', 'USD')),
    tipo_cambio         numeric(14, 4) check (tipo_cambio is null or tipo_cambio > 0),
    precio_ars          numeric(16, 4) not null check (precio_ars >= 0),
    origen              text not null check (origen in ('mrp', 'oc', 'factura')),
    referencia          text check (referencia is null or char_length(referencia) <= 200),
    proveedor           text check (proveedor is null or char_length(proveedor) <= 120),
    comprobante         text check (comprobante is null or char_length(comprobante) <= 60),
    fijado_at           timestamptz not null default now(),
    -- "Volver a buscar precio": quién, cuándo y el precio que había antes
    cambiado_at         timestamptz,
    cambiado_por_nombre text check (cambiado_por_nombre is null or char_length(cambiado_por_nombre) <= 120),
    anterior            jsonb,
    primary key (empresa_id, ot, sku)
  );

  alter table public.precios_fijos_ot enable row level security;
  drop policy if exists precios_fijos_ot_dueno on public.precios_fijos_ot;
  create policy precios_fijos_ot_dueno on public.precios_fijos_ot for select to authenticated
    using (
      empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
      and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial'
    );
  grant select on public.precios_fijos_ot to authenticated;
  grant select, insert, update, delete on public.precios_fijos_ot to service_role;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Después de abrir el detalle de una OT con material:
--   select ot, count(*), sum(precio_ars) from public.precios_fijos_ot group by ot order by ot desc limit 10;
