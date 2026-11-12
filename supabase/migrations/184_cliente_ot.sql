-- 184_cliente_ot.sql — Cada OT unida a su cliente de Finanzas (auditoría del
-- 12/11, parte 6).
--
-- CONTEXTO: la OT trae el cliente como texto del Plan de trabajo, y cada
-- pantalla de Finanzas lo buscaba por nombre a su manera (la venta, la cuenta
-- por OT, el cobro). Si el nombre cambiaba o se escribía distinto, la OT
-- quedaba en un cliente y sus cobros en otro.
--
-- Esta migración:
--   proyectos.cliente_id: el cliente de Finanzas de la OT. Lo pone Gypi en
--   cada sincronización del Plan de trabajo con el nombre de la OT (manda el
--   de la OT); la venta, la entrega y los cobros de la OT lo siguen.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente: se puede
-- correr más de una vez.

begin;

alter table public.proyectos add column if not exists cliente_id bigint references public.fin_clientes(id) on delete set null;
create index if not exists proyectos_cliente_id_idx on public.proyectos (empresa_id, cliente_id) where cliente_id is not null;

-- Que PostgREST vea la columna nueva sin esperar
notify pgrst, 'reload schema';

commit;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select column_name from information_schema.columns
--    where table_name = 'proyectos' and column_name = 'cliente_id';  -- 1 fila
