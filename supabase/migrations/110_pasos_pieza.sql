-- 110: escaneo de cada pieza en cada etapa (Órdenes de Producción, parte 18;
-- diseño en notes/diseno-qr-piezas.md)
--
-- CONTEXTO: con la parte 17 cada pieza de la OT tiene su etiqueta con QR
-- (piezas_ot, migración 109). Ahora el operario la escanea en Corte, Canto,
-- CNC y Corte especial, y queda anotado que la pieza pasó por esa etapa.
-- Cuando pasan todas las piezas que llevan esa etapa, Gypi marca la etapa de
-- la OT como terminada (avance_etapas, migración 100); la firma la sigue
-- poniendo el responsable.
--
-- Esta migración:
--   1. pasos_pieza: una fila por pieza y etapa (quién y cuándo). Una pieza no
--      pasa dos veces por la misma etapa (unique). Si la pieza se borra
--      (se volvió a pegar la planilla sin ella), se borran sus pasos.
--      requerida: si la etapa le tocaba a la pieza al escanearla (una pieza
--      escaneada en una etapa que no le toca queda anotada, pero no cuenta
--      para terminar la etapa).
--   2. RLS: misma regla por empresa que el resto (089); la app escribe
--      pasos_pieza solo por /api/piezas/paso.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Necesita la 109. Es
-- idempotente y va en una sola transacción.

begin;

create table if not exists public.pasos_pieza (
  id           bigserial primary key,
  empresa_id   uuid not null references public.empresa(id) on delete cascade,
  ot           text not null,
  pieza_id     bigint not null references public.piezas_ot(id) on delete cascade,
  etapa        text not null check (etapa in ('corte', 'canto', 'cnc', 'especial')),
  requerida    boolean not null default true,
  empleado_id  uuid references public.empleados(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (pieza_id, etapa)
);
create index if not exists pasos_pieza_empresa_ot on public.pasos_pieza (empresa_id, ot, etapa);

alter table public.pasos_pieza enable row level security;
drop policy if exists tenant_isolation_auth_pasos_pieza on public.pasos_pieza;
create policy tenant_isolation_auth_pasos_pieza on public.pasos_pieza for all to authenticated
  using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
  with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
grant select, insert, update, delete on public.pasos_pieza to authenticated;
grant usage, select on sequence public.pasos_pieza_id_seq to authenticated;

commit;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relrowsecurity from pg_class where relname = 'pasos_pieza';  -- t
