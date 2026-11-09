-- 175: Finanzas, órdenes de pago (parte F2b, 2)
--
-- CONTEXTO: los pagos a proveedores se cargaban a mano en el libro, uno por
-- forma de pago. En Gypi el dueño arma una Orden de Pago desde la ficha del
-- proveedor: qué facturas paga y con qué (efectivo, transferencia, e-cheq
-- Credicoop o cheques de terceros de la cartera). La manda por WhatsApp al
-- que firma y libera los pagos (el CFO), que la abre con un link (sin usuario
-- de Gypi) y la aprueba o la rechaza. Cuando el dueño la marca pagada se
-- generan las operaciones (fin_operaciones, 171) y los cheques (fin_cheques,
-- 174) solos.
--
-- Esta migración:
--   1. fin_ordenes_pago: la orden, con sus formas de pago, el link del CFO
--      (token), su decisión y las operaciones que generó.
--   2. RLS: por empresa y solo el rol gerencial, como el resto de Finanzas.
--      La página del CFO lee y decide por el servidor, solo con el token.
--      Sin delete: una orden mal cargada se anula.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.fin_ordenes_pago (
    id                     bigserial primary key,
    empresa_id             uuid not null references public.empresa(id) on delete cascade,
    numero                 integer not null check (numero > 0),
    proveedor_id           bigint references public.proveedores(id) on delete set null,
    proveedor_nombre       text not null check (char_length(proveedor_nombre) between 1 and 120),
    fecha                  date not null,
    estado                 text not null default 'borrador' check (estado in ('borrador', 'para_aprobar', 'aprobada', 'rechazada', 'pagada', 'anulada')),
    -- Qué se paga: [{ op_id, fecha, detalle, importe }] (las compras elegidas)
    facturas               jsonb not null default '[]'::jsonb,
    -- Con qué: [{ forma, importe, cuenta?, fecha_pago?, numero?, cheque_id? }]
    formas                 jsonb not null default '[]'::jsonb,
    total                  numeric(16, 2) not null check (total > 0),
    notas                  text check (notas is null or char_length(notas) <= 500),
    token                  text unique check (token is null or char_length(token) between 20 and 80),
    enviada_at             timestamptz,
    decidida_at            timestamptz,
    decidida_por_nombre    text check (decidida_por_nombre is null or char_length(decidida_por_nombre) <= 120),
    decision_nota          text check (decision_nota is null or char_length(decision_nota) <= 500),
    pagada_at              timestamptz,
    pagada_fecha           date,
    pagada_por_nombre      text check (pagada_por_nombre is null or char_length(pagada_por_nombre) <= 120),
    -- Lo que generó el pago: { operaciones: [id], cheques_emitidos: [id], cheques_entregados: [id] }
    generado               jsonb,
    anulada_at             timestamptz,
    anulada_por_nombre     text check (anulada_por_nombre is null or char_length(anulada_por_nombre) <= 120),
    cargada_por_nombre     text check (cargada_por_nombre is null or char_length(cargada_por_nombre) <= 120),
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now()
  );
  create unique index if not exists fin_ordenes_pago_numero on public.fin_ordenes_pago (empresa_id, numero);
  create index if not exists fin_ordenes_pago_estado on public.fin_ordenes_pago (empresa_id, estado);

  alter table public.fin_ordenes_pago enable row level security;
  drop policy if exists tenant_isolation_auth_fin_ordenes_pago on public.fin_ordenes_pago;
  create policy tenant_isolation_auth_fin_ordenes_pago on public.fin_ordenes_pago for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
           and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial')
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
           and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial');
  -- Sin delete: una orden mal cargada se anula
  grant select, insert, update on public.fin_ordenes_pago to authenticated;
  grant usage, select on sequence public.fin_ordenes_pago_id_seq to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname = 'fin_ordenes_pago';  -- t
