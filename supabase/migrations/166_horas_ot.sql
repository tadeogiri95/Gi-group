-- 166: horas-persona presupuestadas y reales de cada OT cargadas a mano
-- (costo de OT, parte E; diseño en notes/diseno-costo-ot.md; app/lib/horasOt.js)
--
-- CONTEXTO: en el detalle de cada OT se comparan las horas-persona
-- presupuestadas contra las reales, por proceso (Corte, Canteado, Mecanizado,
-- Armado) o en total. Cada número sale solo:
--   - presupuestadas: la estimación que usa el Gantt (placas, cantos,
--     mecanizados, gabinetes y los ⚙ Parámetros de tiempos);
--   - reales: horas de trabajo desde el primer escaneo del proceso hasta el
--     100 %, sin los tramos en pausa, × los operarios distintos que
--     escanearon, más las tareas viejas de "Iniciar Tarea".
-- Tadeo pidió (08/11) poder escribir cualquiera de los dos a mano encima.
-- Esta tabla guarda solo lo escrito a mano; null = automático.
--
-- Esta migración:
--   1. horas_ot: un renglón por OT y proceso ('corte', 'canteado',
--      'mecanizado', 'armado' o 'total'), con las horas presupuestadas y/o
--      reales a mano y quién las cambió.
--   2. RLS: por empresa para leer; la app escribe solo por /api/horas-ot
--      (Dueño y Administración) con la clave del servidor.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un solo
-- bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.horas_ot (
    empresa_id          uuid not null references public.empresa(id) on delete cascade,
    ot                  text not null check (char_length(ot) between 1 and 40),
    etapa               text not null check (etapa in ('corte', 'canteado', 'mecanizado', 'armado', 'total')),
    presupuestadas      numeric(10, 1) check (presupuestadas is null or (presupuestadas >= 0 and presupuestadas < 100000)),
    reales              numeric(10, 1) check (reales is null or (reales >= 0 and reales < 100000)),
    cambiado_por_nombre text check (cambiado_por_nombre is null or char_length(cambiado_por_nombre) <= 120),
    updated_at          timestamptz not null default now(),
    primary key (empresa_id, ot, etapa)
  );

  alter table public.horas_ot enable row level security;
  drop policy if exists tenant_isolation_auth_horas_ot on public.horas_ot;
  create policy tenant_isolation_auth_horas_ot on public.horas_ot for select to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  grant select on public.horas_ot to authenticated;
  grant select, insert, update, delete on public.horas_ot to service_role;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select ot, etapa, presupuestadas, reales, cambiado_por_nombre from public.horas_ot order by updated_at desc limit 10;
