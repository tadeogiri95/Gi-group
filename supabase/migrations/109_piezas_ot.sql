-- 109: piezas de cada OT con su etiqueta QR (Órdenes de Producción, parte 17;
-- diseño en notes/diseno-qr-piezas.md)
--
-- CONTEXTO: Tadeo pidió que cada pieza de la planilla técnica de una OT tenga
-- su QR y que en cada etapa (Corte, Canto, CNC, Corte especial) se escanee la
-- pieza. Técnica pega la planilla en Gypi y se arma una fila por pieza física:
-- un renglón con CANT 4 son 4 piezas ("1 de 4" … "4 de 4"), cada una con su
-- etiqueta. El escaneo por etapa es la parte 18 (otra migración).
--
-- Esta migración:
--   1. piezas_ot: una fila por pieza física (nombre del panel, módulo,
--      material, medidas, unidad "n de N" y las etapas que le tocan). El QR
--      lleva el id de la fila: "OT M-7495 - PIEZA - 1234".
--      Al volver a pegar la planilla, las piezas con el mismo nombre y número
--      se actualizan (conservan su id, así la etiqueta impresa sigue valiendo)
--      y las que ya no están se borran (cargada_at queda viejo).
--   2. RLS: misma regla por empresa que el resto (089); la app escribe
--      piezas_ot solo por /api/piezas.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente y va en una
-- sola transacción.

begin;

create table if not exists public.piezas_ot (
  id           bigserial primary key,
  empresa_id   uuid not null references public.empresa(id) on delete cascade,
  ot           text not null,
  renglon      integer not null default 0,
  nombre       text not null check (char_length(nombre) between 1 and 80),
  modulo       text check (modulo is null or char_length(modulo) <= 40),
  material     text check (material is null or char_length(material) <= 120),
  l1           numeric(8, 1) check (l1 is null or l1 > 0),
  l2           numeric(8, 1) check (l2 is null or l2 > 0),
  unidad       integer not null check (unidad between 1 and 500),
  de           integer not null check (de between 1 and 500),
  etapas       text[] not null default array['corte']
               check (etapas <@ array['corte', 'canto', 'cnc', 'especial']::text[]),
  cargada_at   timestamptz not null default now(),
  creado_por   uuid references public.empleados(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint chk_piezas_ot_unidad check (unidad <= de),
  unique (empresa_id, ot, nombre, unidad)
);
create index if not exists piezas_ot_empresa_ot on public.piezas_ot (empresa_id, ot, renglon, unidad);

alter table public.piezas_ot enable row level security;
drop policy if exists tenant_isolation_auth_piezas_ot on public.piezas_ot;
create policy tenant_isolation_auth_piezas_ot on public.piezas_ot for all to authenticated
  using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
  with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
grant select, insert, update, delete on public.piezas_ot to authenticated;
grant usage, select on sequence public.piezas_ot_id_seq to authenticated;

commit;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relrowsecurity from pg_class where relname = 'piezas_ot';  -- t
