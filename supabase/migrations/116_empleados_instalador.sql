-- 116: marcar a los instaladores (seguimiento de OT por escaneo, parte 24;
-- diseño en notes/diseno-avance-escaneo.md)
--
-- CONTEXTO: los operarios dejan de cargar tareas con "Iniciar Tarea". La
-- instalación, en vez de tiempos, va a dejar un reporte diario desde una
-- pestaña "Instalaciones" que ven solo los instaladores. Hasta ahora Gypi no
-- tenía forma de saber quién es instalador: esta casilla se marca en Equipo →
-- editar empleado → "Es instalador".
--
-- Sin la migración la casilla no aparece y nada cambia.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente.

alter table public.empleados
  add column if not exists es_instalador boolean not null default false;

comment on column public.empleados.es_instalador is
  'Instalador: ve la pestaña Instalaciones y carga el reporte diario de instalación.';
