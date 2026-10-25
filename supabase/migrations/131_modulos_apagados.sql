-- 131_modulos_apagados.sql — La empresa prende o apaga sus módulos (Más → Módulos).
--
-- 1. empresa_modulos.apagado: la empresa apagó un módulo que contrató. No se ve
--    en la app (ni con candado) y el servidor lo bloquea. Es distinto de
--    activo = false (un módulo que se le saca a mano, que se ve con candado).
--    Al volver a prenderlo aparece todo como estaba: no se borra ningún dato.
-- 2. Catálogo: Stock, Compras y Flota pasan a ser módulos propios (vienen con
--    Órdenes de trabajo y se apagan por separado); "Tareas" pasa a llamarse
--    "Avance de producción", que es lo que incluye hoy (escaneo, carga, actas).
-- Sin filas con apagado = true, cada empresa ve exactamente lo mismo que antes.

alter table public.empresa_modulos add column if not exists apagado boolean not null default false;
-- activo pasa a poder quedar vacío: una fila creada al apagar un módulo del plan
-- (activo vacío) no cuenta como "dado a mano". Si después cambia el plan y el
-- módulo ya no está, la empresa no se lo queda. true y false valen como antes.
alter table public.empresa_modulos alter column activo drop not null;
alter table public.empresa_modulos alter column activo drop default;

insert into public.modulos (id, nombre, descripcion, disponible, orden) values
  ('actividad', 'Avance de producción', 'Escaneo de piezas, avance por etapa, carga, actas, instalaciones y reportes de producción.', true, 50),
  ('stock',     'Stock',                'Artículos, etiquetas QR, retiros de material y movimientos.',                              true, 62),
  ('compras',   'Compras',              'Pedidos de material, órdenes de compra, recepción y facturas.',                            true, 64),
  ('flota',     'Flota',                'Vehículos, papeles, checklist, alertas y arreglos.',                                       true, 66)
on conflict (id) do update
  set nombre = excluded.nombre, descripcion = excluded.descripcion,
      disponible = excluded.disponible, orden = excluded.orden;

-- ─── VERIFICACIÓN ───────────────────────────────────────────────────────────
--   select count(*) from public.modulos where disponible;               -- 10
--   select column_name from information_schema.columns
--    where table_name = 'empresa_modulos' and column_name = 'apagado';  -- 1 fila
