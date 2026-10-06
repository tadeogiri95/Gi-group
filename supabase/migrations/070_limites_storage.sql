-- 070: Límites de tamaño y tipo por bucket de Storage (F2-09)
--
-- Hasta ahora los buckets no tenían límites: todo el control estaba en el
-- código. Con esto, aunque alguien llegara a subir directo a Storage, la base
-- rechaza archivos grandes o de tipos no permitidos (incluido SVG, que puede
-- llevar scripts y se servía desde buckets públicos).
--
-- Los límites coinciden con los del código:
--   reportes-obra        → 5 MB, PNG/JPG/WebP/GIF       (/api/upload)
--   logos                → 2 MB, PNG/JPG/WebP           (/api/upload-logo)
--   documentos-empleado  → 5 MB, PDF/PNG/JPG/WebP/Word  (/api/documentos/upload)
--
-- No borra archivos existentes. Se puede correr antes o después de aprobar el PR.

update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
where id = 'reportes-obra';

update storage.buckets
set file_size_limit = 2097152,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
where id = 'logos';

update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array[
      'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
where id = 'documentos-empleado';

-- ─── VERIFICACIÓN ───────────────────────────────────────────────────────────
--   select id, public, file_size_limit, allowed_mime_types
--   from storage.buckets order by id;
--   (los tres buckets tienen que mostrar su límite y su lista de tipos)
--
--   ¿Quedaron SVG subidos antes? (solo lectura)
--   select bucket_id, name, created_at from storage.objects
--   where name ilike '%.svg' or metadata->>'mimetype' = 'image/svg+xml';
--
-- ─── REVERTIR ───────────────────────────────────────────────────────────────
--   update storage.buckets set file_size_limit = null, allowed_mime_types = null
--   where id in ('reportes-obra', 'logos', 'documentos-empleado');
