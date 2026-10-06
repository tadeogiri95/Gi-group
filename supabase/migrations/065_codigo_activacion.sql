-- 065: Código de activación de un solo uso (auditoría F2-03, F4-01, F4-02)
--
-- PROBLEMA: /api/unirse activaba una cuenta "pendiente" con solo el slug de la
-- empresa (público) y el legajo (número chico y secuencial): cualquiera podía
-- adelantarse al empleado y definir su contraseña. Además, los empleados dados
-- de alta sin email quedaban sin forma de entrar.
--
-- CAMBIO: cada empleado pendiente tiene un código aleatorio que se guarda solo
-- como hash SHA-256, vence a los 14 días y se borra al usarse.
--
-- ORDEN: correr ESTA migración ANTES de aprobar el PR (el código nuevo usa
-- estas columnas). Es aditiva: no cambia ni borra datos.

begin;

alter table public.empleados
  add column if not exists activacion_codigo_hash text,
  add column if not exists activacion_expira      timestamptz;

create index if not exists empleados_activacion_codigo_idx
  on public.empleados (empresa_id, activacion_codigo_hash)
  where activacion_codigo_hash is not null;

commit;

-- ─── VERIFICACIÓN (debe devolver 2 filas) ───────────────────────────────────
--   select column_name, data_type from information_schema.columns
--   where table_schema = 'public' and table_name = 'empleados'
--     and column_name in ('activacion_codigo_hash', 'activacion_expira');
--
-- ─── REVERSIÓN (solo si hiciera falta; antes revertir el PR) ───────────────
--   begin;
--   drop index if exists public.empleados_activacion_codigo_idx;
--   alter table public.empleados drop column if exists activacion_codigo_hash,
--                                drop column if exists activacion_expira;
--   commit;
