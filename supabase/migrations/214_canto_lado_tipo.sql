-- 214: Qué lado y qué canto se pegó en cada escaneo (pedido de Tadeo, 27/11)
--
-- CONTEXTO: en la etapa de canto cada escaneo es un lado (209). Pero una
-- pieza puede llevar cantos distintos: 2 lados con canto de 2 mm y 1 con
-- 0,45. Si se pegó solo el de 2 mm en 5 piezas (10 escaneos), Gypi tiene que
-- ver 5 piezas a medio pegar, no 3 completas y 1 empezada, y descontar los
-- metros del canto de 2 mm.
--
-- El operario elige en Escanear piezas el canto que tiene en la máquina, y
-- cada escaneo queda anotado con el lado de la pieza (l1a, l1b, l2a, l2b) y
-- el tipo de canto (espesor|color, por ejemplo "2|GRAFITO").
--
-- Esta migración agrega a lados_pieza:
--   lado  : el lado de la pieza que se pegó (null en los escaneos viejos,
--           que se siguen contando en el orden de la planilla).
--   canto : el tipo de canto ("2|GRAFITO").
--
-- ORDEN: necesita la 209. Correrla ANTES de unir el PR que la usa (sin ella
-- la app sigue como hoy). Es idempotente y va en un solo bloque.
do $mig$
begin
  alter table public.lados_pieza add column if not exists lado text;
  alter table public.lados_pieza add column if not exists canto text;
  alter table public.lados_pieza drop constraint if exists lados_pieza_lado_check;
  alter table public.lados_pieza add constraint lados_pieza_lado_check
    check (lado is null or lado in ('l1a', 'l1b', 'l2a', 'l2b'));
  alter table public.lados_pieza drop constraint if exists lados_pieza_canto_check;
  alter table public.lados_pieza add constraint lados_pieza_canto_check
    check (canto is null or char_length(canto) <= 80);
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select lado, canto, count(*) from public.lados_pieza group by 1, 2;
