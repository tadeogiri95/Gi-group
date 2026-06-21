-- 028: Agregar columna geo_config a empleados para configuración de geolocalización por empleado
ALTER TABLE empleados
ADD COLUMN IF NOT EXISTS geo_config jsonb DEFAULT '{"activo": false, "ubicacion_id": null, "radio": 150}';
