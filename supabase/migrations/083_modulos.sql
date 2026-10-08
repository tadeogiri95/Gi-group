-- 083_modulos.sql — Núcleo modular, parte 1: módulos en la base (ítem 36, D1).
--
-- 1. modulos: el catálogo (mismos ids que app/lib/modulos.js; un test controla
--    que coincidan). Los que tienen disponible = false todavía no existen en la
--    app y no se pueden activar.
-- 2. empresa_modulos: ajustes propios de cada empresa sobre lo que trae su plan
--    y sus add-ons: un módulo dado a mano (activo = true), uno del plan que la
--    empresa no quiere usar (activo = false) y su configuración (config).
--    Sin filas acá, la empresa tiene exactamente lo de su plan: nadie pierde nada.
-- Solo las usa el servidor con la service key (RLS activado, sin políticas).

create table if not exists public.modulos (
  id          text primary key,
  nombre      text not null,
  descripcion text,
  disponible  boolean not null default true,
  orden       int not null default 0
);

insert into public.modulos (id, nombre, descripcion, disponible, orden) values
  ('fichaje',       'Fichaje',                'Entrada y salida con botón, QR, PIN, kiosco y GPS.',       true,  10),
  ('chat',          'Asistente',              'Chat con el asistente para consultas, solicitudes y avisos.', true, 20),
  ('reportes',      'Reportes y liquidación', 'Horas trabajadas, llegadas tarde, ausencias y liquidación.', true, 30),
  ('calendario',    'Horarios y calendario',  'Turnos planificados y notas en el calendario.',            true,  40),
  ('actividad',     'Tareas',                 'Tareas sobre OT con tiempo improductivo y su causa.',      true,  50),
  ('proyectos',     'Órdenes de trabajo',     'OT con sus etapas, clientes y obras.',                     true,  60),
  ('obra',          'Trabajo en campo',       'Reportes de obra desde el celular.',                       true,  70),
  ('produccion',    'Órdenes de producción',  'Rutas, partes de trabajo, avance y costeo.',               false, 80),
  ('stock',         'Stock',                  'Artículos, depósitos y movimientos.',                      false, 90),
  ('compras',       'Compras',                'Proveedores, órdenes de compra y recepción.',              false, 100),
  ('calidad',       'Calidad',                'Inspecciones y no conformidades.',                         false, 110),
  ('mantenimiento', 'Mantenimiento',          'Activos, preventivo, correctivo y paradas.',               false, 120)
on conflict (id) do update
  set nombre = excluded.nombre, descripcion = excluded.descripcion,
      disponible = excluded.disponible, orden = excluded.orden;

create table if not exists public.empresa_modulos (
  empresa_id     uuid not null references public.empresa(id) on delete cascade,
  modulo         text not null references public.modulos(id),
  activo         boolean not null default true,
  config         jsonb not null default '{}'::jsonb,
  motivo         text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  primary key (empresa_id, modulo)
);

alter table public.modulos enable row level security;
alter table public.empresa_modulos enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.modulos from anon, authenticated;
    revoke all on public.empresa_modulos from anon, authenticated;
  end if;
end $$;

-- ─── VERIFICACIÓN ───────────────────────────────────────────────────────────
--   select count(*) from public.modulos;                          -- 12
--   select count(*) from public.modulos where disponible;         -- 7
--   select count(*) from public.empresa_modulos;                  -- 0 (nadie tiene ajustes todavía)
