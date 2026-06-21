-- 034: Convertir solicitudes.fecha de TEXT a DATE
--
-- IMPORTANTE — alcance reducido respecto al hallazgo original:
-- `desde` y `hasta` NO se tocan en esta migración. A pesar del nombre,
-- en el flujo de "permiso de ingreso" (ChatScreen.jsx) esas columnas
-- guardan HORAS ("14:35") o el placeholder "—", no fechas. Convertirlas
-- a DATE rompería ese flujo. Quedan como TEXT a propósito.
--
-- `fecha` sí es consistentemente una fecha en todo el código, pero algunos
-- paths viejos escribían el literal "hoy" en vez de resolver la fecha real
-- (corregido en ChatScreen.jsx). Esta migración normaliza esos valores
-- históricos antes de convertir el tipo de columna.

-- 1) Normalizar filas con valores no parseables como fecha (NULL, "hoy",
--    vacío, etc.) usando la fecha de creación del registro como mejor
--    aproximación disponible.
UPDATE solicitudes
  SET fecha = created_at::date::text
  WHERE fecha IS NULL OR fecha !~ '^\d{4}-\d{2}-\d{2}$';

-- 2) Convertir el tipo de columna.
ALTER TABLE solicitudes
  ALTER COLUMN fecha TYPE date USING fecha::date;
