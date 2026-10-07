# Línea base del esquema

- `esquema-base.sql`: estructura completa de producción (sin datos) con las migraciones **001–072** aplicadas. Crea una base nueva idéntica a producción. Lo aplica el workflow **"Preparar base de staging"**.
- `prod-inventario.sql`: extensiones, carpetas de Storage y versión de Postgres de producción, a la fecha de la exportación (informativo).

## Reglas desde ahora
1. Toda migración nueva va en `supabase/migrations/` con el número siguiente (073, 074, …).
2. Se prueba primero en **staging** y recién después en producción.
3. Cada tanto, el workflow **"Exportar esquema de producción"** deja en la rama `chore/esquema-prod` la estructura real de producción: si difiere de esta línea base + las migraciones nuevas, hay *drift* (algo se cambió a mano) y hay que versionarlo.

## Diferencias detectadas al armar la línea base (2026-10-07)
- La migración **070** quedó aplicada solo en `documentos-empleado`: `logos` y `reportes-obra` siguen **sin límites** de tamaño ni de tipo en producción.
- Índices duplicados en `proyectos` (`uq_proyectos` y `uq_proyectos_emp_ot`, mismas columnas): limpieza pendiente (F3-09).
