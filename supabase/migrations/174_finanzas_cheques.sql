-- 174: Finanzas, cheques (parte F2b, 1; reemplaza R-CHEQUES y PREVISIÓN
-- CHEQUES del libro)
--
-- CONTEXTO: los cheques viven en la hoja R-CHEQUES, sin vínculo con la
-- operación que los generó. En Gypi cada cheque tiene su estado y cada cambio
-- de estado genera su operación en Finanzas (fin_operaciones, 171):
--   - Propios (e-cheq o cheque de la empresa): pendiente → debitado (baja el
--     banco) o anulado.
--   - De terceros (recibidos): en cartera → depositado (sube el banco),
--     entregado a un proveedor (baja su deuda) o rechazado.
-- Los vivos del libro (ACTIVO y ENTREGADO) se copian una vez, sin generar
-- operaciones (ya están en el libro).
--
-- Esta migración:
--   1. fin_cheques, con las operaciones que generó (alta y cierre).
--   2. RLS: por empresa y solo el rol gerencial, como el resto de Finanzas.
--      Sin delete: un cheque mal cargado se anula.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.fin_cheques (
    id                     bigserial primary key,
    empresa_id             uuid not null references public.empresa(id) on delete cascade,
    clase                  text not null check (clase in ('propio', 'tercero')),
    tipo                   text not null check (tipo in ('echeq_diferido', 'echeq_comun', 'cheque_diferido', 'cheque_fisico')),
    banco                  text check (banco is null or char_length(banco) <= 60),
    numero                 text check (numero is null or char_length(numero) <= 40),
    librador               text check (librador is null or char_length(librador) <= 120),
    beneficiario           text check (beneficiario is null or char_length(beneficiario) <= 120),
    -- Propio: a qué proveedor se le dio. De terceros: a quién se entregó
    proveedor_id           bigint references public.proveedores(id) on delete set null,
    -- De terceros: de quién se recibió (cliente, escrito)
    recibido_de            text check (recibido_de is null or char_length(recibido_de) <= 120),
    fecha_emision          date,
    fecha_pago             date not null,
    importe                numeric(16, 2) not null check (importe > 0),
    -- Propio: el banco que lo debita. De terceros: el banco donde se depositó
    cuenta_banco           text check (cuenta_banco is null or char_length(cuenta_banco) <= 40),
    estado                 text not null check (estado in ('pendiente', 'debitado', 'en_cartera', 'depositado', 'entregado', 'rechazado', 'anulado')),
    estado_fecha           date,
    entregado_a            text check (entregado_a is null or char_length(entregado_a) <= 120),
    notas                  text check (notas is null or char_length(notas) <= 300),
    origen                 text not null default 'manual' check (origen in ('manual', 'libro', 'pago')),
    referencia             text check (referencia is null or char_length(referencia) <= 60),
    op_alta_id             bigint references public.fin_operaciones(id) on delete set null,
    op_cierre_id           bigint references public.fin_operaciones(id) on delete set null,
    avisado_para           date,
    cargado_por_nombre     text check (cargado_por_nombre is null or char_length(cargado_por_nombre) <= 120),
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now()
  );
  create index if not exists fin_cheques_pago on public.fin_cheques (empresa_id, fecha_pago);
  create index if not exists fin_cheques_estado on public.fin_cheques (empresa_id, estado);
  create unique index if not exists fin_cheques_libro on public.fin_cheques (empresa_id, referencia) where origen = 'libro';

  alter table public.fin_cheques enable row level security;
  drop policy if exists tenant_isolation_auth_fin_cheques on public.fin_cheques;
  create policy tenant_isolation_auth_fin_cheques on public.fin_cheques for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
           and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial')
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
           and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial');
  -- Sin delete: un cheque mal cargado se anula
  grant select, insert, update on public.fin_cheques to authenticated;
  grant usage, select on sequence public.fin_cheques_id_seq to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname = 'fin_cheques';  -- t
