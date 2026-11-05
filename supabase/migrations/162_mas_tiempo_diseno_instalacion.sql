-- 162: "⏱ Necesita más tiempo" también en Diseño, Técnica e Instalación
-- (Tadeo, 05/11; app/lib/ajustesTiempo.js)
--
-- CONTEXTO: en el Gantt de Producción gerencia, supervisores y administración
-- cargan "⏱ Faltan X h" en un proceso, con su motivo (migración 145, tabla
-- ajustes_tiempo_ot). Ahora se puede hacer lo mismo:
--   - en el Gantt 📐: Diseño (en días hábiles) y Técnica (en horas);
--   - en el Gantt 🔧 de Instalación: cada OT de una obra (en días de obra).
-- El valor va en la columna horas aunque sea en días. Esas áreas tienen sus
-- propios motivos: cambios del cliente, espera de aprobación o respuesta del
-- cliente, falta información o medidas, la obra no estaba lista y clima
-- (además de los de antes). Solo se carga 'faltan' (no 'corrimiento').
-- Esta migración solo amplía los controles de etapa y motivo.
--
-- ORDEN: se puede correr antes o después de unir el PR (mientras no se corra,
-- guardar avisa que falta la migración). Es idempotente. Va en un solo bloque
-- (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
declare
  c record;
begin
  -- Saca los controles viejos de etapa y motivo, tengan el nombre que tengan
  for c in
    select conname from pg_constraint
    where conrelid = 'public.ajustes_tiempo_ot'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) ilike '%etapa%' or (pg_get_constraintdef(oid) ilike '%motivo%' and pg_get_constraintdef(oid) not ilike '%detalle%'))
  loop
    execute format('alter table public.ajustes_tiempo_ot drop constraint %I', c.conname);
  end loop;

  alter table public.ajustes_tiempo_ot add constraint ajustes_tiempo_ot_etapa_check
    check (etapa in ('corte', 'canteado', 'mecanizado', 'armado', 'diseno', 'tecnica', 'instalacion'));
  alter table public.ajustes_tiempo_ot add constraint ajustes_tiempo_ot_motivo_check
    check (motivo in ('falta_material', 'falla_maquina', 'corte_electricidad', 'planificacion_subestimada', 'interrupcion', 'otros',
                      'cambios_cliente', 'espera_cliente', 'falta_informacion', 'obra_no_lista', 'clima'));
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Debería mostrar los dos controles nuevos (y el de "otros" con detalle):
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.ajustes_tiempo_ot'::regclass and contype = 'c';
