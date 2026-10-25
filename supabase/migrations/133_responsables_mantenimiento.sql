-- 133: responsables de mantenimiento (Mantenimiento, parte 34; ítem 43;
-- diseño en notes/diseno-menu-y-mantenimiento.md)
--
-- CONTEXTO: algunos operarios son responsables de mantenimiento. Cada vehículo
-- y cada máquina tiene su responsable y un suplente (opcional), que ven en su
-- Inicio "🔧 Mi mantenimiento" con lo que les toca y hacen el checklist desde
-- el celular. El checklist de los vehículos pasa a ser solo de ellos (Tadeo,
-- 25/10); el "responsable" que ya tenía cada vehículo queda como chofer
-- habitual, para el aviso de su licencia.
--
-- Esta migración:
--   1. empleados.es_mantenimiento: la casilla "Responsable de mantenimiento"
--      (Equipo → editar empleado).
--   2. vehiculos.mant_responsable_id y mant_suplente_id.
--   3. maquinas.responsable_id y suplente_id, y aviso_firma / aviso_at para
--      el aviso diario al celular sin repetir (como la flota, 128).
--
-- Sin la migración nada cambia: el chofer sigue haciendo el checklist de su
-- vehículo y no aparece "Mi mantenimiento".
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  alter table public.empleados
    add column if not exists es_mantenimiento boolean not null default false;
  comment on column public.empleados.es_mantenimiento is
    'Responsable de mantenimiento: ve "Mi mantenimiento" en su Inicio con los vehículos y máquinas que tiene a cargo.';

  alter table public.vehiculos
    add column if not exists mant_responsable_id uuid references public.empleados(id) on delete set null,
    add column if not exists mant_suplente_id    uuid references public.empleados(id) on delete set null;
  create index if not exists vehiculos_mant_responsable on public.vehiculos (empresa_id, mant_responsable_id);
  create index if not exists vehiculos_mant_suplente on public.vehiculos (empresa_id, mant_suplente_id);

  alter table public.maquinas
    add column if not exists responsable_id uuid references public.empleados(id) on delete set null,
    add column if not exists suplente_id    uuid references public.empleados(id) on delete set null,
    add column if not exists aviso_firma    text,
    add column if not exists aviso_at       timestamptz;
  create index if not exists maquinas_responsable on public.maquinas (empresa_id, responsable_id);
  create index if not exists maquinas_suplente on public.maquinas (empresa_id, suplente_id);
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select column_name from information_schema.columns
--    where table_schema = 'public'
--      and ((table_name = 'empleados' and column_name = 'es_mantenimiento')
--        or (table_name = 'vehiculos' and column_name in ('mant_responsable_id', 'mant_suplente_id'))
--        or (table_name = 'maquinas' and column_name in ('responsable_id', 'suplente_id', 'aviso_firma', 'aviso_at')));  -- 7 filas
