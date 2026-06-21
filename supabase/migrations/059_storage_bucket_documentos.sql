-- 059: Bucket privado para documentación de empleados (DNI, antecedentes, etc.)
--
-- A diferencia de `logos` y `reportes-obra` (públicos), este bucket es PRIVADO:
-- contiene PII sensible. El acceso de lectura se hace exclusivamente vía URLs
-- firmadas generadas server-side (app/api/documentos/sign-url/route.js), que
-- valida ownership (empleado dueño o gerencia de la misma empresa) antes de
-- firmar. Igual que el resto de Storage en este proyecto, no hay policies de
-- RLS en storage.objects — todo el acceso pasa por SUPABASE_SERVICE_KEY desde
-- rutas API, y el control real está en el código de esas rutas.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documentos-empleado',
  'documentos-empleado',
  false,
  5242880, -- 5 MB
  ARRAY[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO NOTHING;
