-- 156: varias fotos por vehículo y la póliza del seguro en PDF (Tadeo, 03/11;
-- app/lib/polizaTexto.js, /api/flota/poliza)
--
-- CONTEXTO: al dar de alta un vehículo en Mantenimiento → Flota se cargan
-- varias fotos (hasta 6; la primera sigue en foto_url para la lista) y se
-- puede adjuntar la póliza del seguro en PDF. Gypi lee el texto del PDF (sin
-- IA) y completa los datos del vehículo y del seguro para que el usuario los
-- revise. El PDF queda guardado con el papel del seguro y se descarga desde
-- la ficha.
--
--   1. vehiculos.fotos: lista de URLs (como las fotos de los papeles).
--   2. vehiculo_papeles.archivo_path / archivo_nombre: el PDF del papel, en
--      el bucket privado flota-documentos (se ve con un link firmado que
--      genera /api/flota, igual que documentos-empleado).
--   3. Bucket flota-documentos: privado, solo PDF, hasta 5 MB.
--
-- ORDEN: correr ANTES de unir el PR. Sin esta migración, guardar un vehículo
-- avisa que falta la 156. Es idempotente. Va en un solo bloque
-- (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  alter table public.vehiculos add column if not exists fotos jsonb not null default '[]'::jsonb;
  alter table public.vehiculos drop constraint if exists vehiculos_fotos_check;
  alter table public.vehiculos add constraint vehiculos_fotos_check check (jsonb_typeof(fotos) = 'array' and jsonb_array_length(fotos) <= 6);
  -- Los que ya tenían una foto la conservan como primera de la lista
  update public.vehiculos set fotos = jsonb_build_array(foto_url) where foto_url is not null and fotos = '[]'::jsonb;

  alter table public.vehiculo_papeles add column if not exists archivo_path text check (archivo_path is null or char_length(archivo_path) <= 300);
  alter table public.vehiculo_papeles add column if not exists archivo_nombre text check (archivo_nombre is null or char_length(archivo_nombre) <= 200);

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('flota-documentos', 'flota-documentos', false, 5242880, array['application/pdf'])
  on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['application/pdf'];
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Debería mostrar fotos, archivo_path y archivo_nombre:
--   select table_name, column_name from information_schema.columns
--   where (table_name = 'vehiculos' and column_name = 'fotos')
--      or (table_name = 'vehiculo_papeles' and column_name in ('archivo_path', 'archivo_nombre'));
-- Y el bucket privado (public = f):
--   select id, public, file_size_limit from storage.buckets where id = 'flota-documentos';
