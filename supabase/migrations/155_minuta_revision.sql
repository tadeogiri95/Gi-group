-- 155: revisión del día anterior en la minuta (Tadeo, 02/11; app/lib/minutasRevision.js)
--
-- CONTEXTO: al empezar la minuta de Buenos Días, Gypi trae lo que hay que
-- revisar de la minuta anterior: las alertas amarillas y rojas (¿se
-- mitigaron?), las fechas objetivo que vencían (¿se cumplieron?) y las
-- compras a disparar (¿se hizo el pedido?). Cada respuesta se guarda como un
-- renglón más de la minuta, en la sección nueva 'revision'.
--
-- Esta migración solo suma 'revision' a las secciones permitidas de
-- minuta_items (150). No crea tablas ni columnas.
--
-- ORDEN: correr ANTES de unir el PR. Si no se corre, la minuta se guarda igual
-- pero sin la revisión, y Gypi avisa que falta esta migración. Es
-- idempotente. Va en un solo bloque (do $mig$ ... $mig$) por el editor SQL de
-- Supabase.

do $mig$
begin
  alter table public.minuta_items drop constraint if exists minuta_items_seccion_check;
  alter table public.minuta_items add constraint minuta_items_seccion_check check (seccion in (
    'foco', 'prod_terminada', 'prod_en_curso', 'prod_a_iniciar',
    'inst_terminada', 'inst_en_curso', 'inst_pendiente', 'postventa',
    'dyt', 'feedback', 'compra', 'movimiento', 'estacionamiento', 'revision'));
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Debería mostrar la restricción con 'revision' al final:
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'minuta_items_seccion_check';
