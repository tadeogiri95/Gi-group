-- 057: Revertir intento anterior (este mismo archivo, versión previa).
--
-- proyectos.codigo NO existe en el esquema real — a diferencia de lo que
-- describía 001_tablas_base.sql, esta empresa nunca tuvo esa columna en
-- producción (drift documentación↔realidad). El modelo real usa `ot` como
-- único identificador; no hace falta ningún trigger de sincronización.
--
-- El intento anterior de esta migración llegó a crear la función y el
-- trigger antes de fallar en el UPDATE final (column "codigo" does not
-- exist). Esto los limpia si quedaron creados.

DROP TRIGGER IF EXISTS trg_proyectos_codigo_sync ON proyectos;
DROP FUNCTION IF EXISTS sync_proyectos_codigo();
