-- 111: cada etapa dice como qué etapa de pieza se escanea (Órdenes de
-- Producción, parte 18 bis)
--
-- CONTEXTO: el escaneo de piezas tiene 4 tipos fijos (corte, canto, cnc y
-- corte especial) porque la planilla técnica dice por cuáles pasa cada pieza.
-- Hasta ahora Gypi adivinaba cuál etapa de la empresa era cada tipo por el
-- nombre ("Canteado" no lo reconocía). Con esta columna se elige en
-- Configuración → Etapas → "Se escanea por pieza como"; el escaneo muestra
-- los nombres de la empresa y termina esa etapa.
--
-- Sin nada elegido en ninguna etapa, Gypi sigue adivinando por el nombre.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente.

begin;

alter table public.etapas add column if not exists tipo_pieza text;

alter table public.etapas drop constraint if exists etapas_tipo_pieza_check;
alter table public.etapas add constraint etapas_tipo_pieza_check
  check (tipo_pieza is null or tipo_pieza in ('corte', 'canto', 'cnc', 'especial'));

-- Una sola etapa por tipo en cada empresa
create unique index if not exists etapas_empresa_tipo_pieza_uniq
  on public.etapas (empresa_id, tipo_pieza) where tipo_pieza is not null;

commit;
