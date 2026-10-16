-- 112: el escaneo por pieza usa las etapas de cada empresa (Órdenes de
-- Producción, partes 17 y 18)
--
-- CONTEXTO: hasta ahora las piezas se escaneaban en 4 tipos fijos (corte,
-- canto, cnc y corte especial), pensados para una fábrica de muebles. Ahora
-- cada empresa marca en Configuración → Etapas cuáles se escanean por pieza
-- y, si no pasan todas, en qué columnas de la planilla técnica se fija Gypi.
--
-- Esta migración:
--   1. etapas.por_pieza (se escanea por pieza) y etapas.columna_pieza
--      (nombres de columnas separados por coma; vacío = pasan todas).
--   2. Pasa los 4 tipos a las etapas de cada empresa: la que se eligió en
--      "Se escanea por pieza como" (111) o, si no se eligió ninguna, la que
--      se reconoce por el nombre (solo en empresas que ya cargaron piezas).
--   3. piezas_ot.etapas y pasos_pieza.etapa pasan a guardar el código de la
--      etapa de la empresa (como avance_etapas).
--   4. Saca etapas.tipo_pieza (111), que ya no se usa.
--
-- ORDEN: correr ANTES de unir el PR que la usa (mientras tanto el escaneo de
-- piezas no anda). Se puede correr aunque no se haya corrido la 111. Es
-- idempotente.

begin;

alter table public.etapas add column if not exists por_pieza boolean not null default false;
alter table public.etapas add column if not exists columna_pieza text;
alter table public.etapas drop constraint if exists etapas_columna_pieza_check;
alter table public.etapas add constraint etapas_columna_pieza_check
  check (columna_pieza is null or char_length(columna_pieza) <= 300);

-- Por si no se corrió la 111
alter table public.etapas add column if not exists tipo_pieza text;

-- Tipo viejo → etapa de cada empresa. Tabla común (no temporal): el editor
-- SQL de Supabase no siempre conserva las temporales entre sentencias.
drop table if exists public.mapa_pieza_112;
create table public.mapa_pieza_112 as
with base as (
  select e.empresa_id, e.codigo, e.orden, e.tipo_pieza is not null as elegido,
    coalesce(e.tipo_pieza, case
      when e.n ~ '(especial|diagonal|45)' then 'especial'
      when e.n ~ '(canto|cante)' then 'canto'
      when e.n ~ '(cnc|proceso|perfor|mecaniz|router|ranur|calad)' then 'cnc'
      when e.n ~ '(corte|seccion|escuadr)' then 'corte'
    end) as tipo
  from (
    select x.*, translate(lower(x.nombre), 'áéíóúü', 'aeiouu') as n
    from public.etapas x
    where coalesce(x.activa, true) and x.codigo > 0
  ) e
)
select distinct on (b.empresa_id, b.tipo) b.empresa_id, b.tipo, b.codigo, b.orden
from base b
where b.tipo is not null
  and (b.elegido or not exists (
    select 1 from public.etapas t where t.empresa_id = b.empresa_id and t.tipo_pieza is not null))
  and (b.elegido or exists (select 1 from public.piezas_ot p where p.empresa_id = b.empresa_id))
order by b.empresa_id, b.tipo, b.elegido desc, b.orden, b.codigo;

update public.etapas e
set por_pieza = true,
    columna_pieza = case m.tipo
      when 'canto' then 'Canto, L1A, L1B, L2A, L2B'
      when 'cnc' then 'FF, RAN, Ranurado, CAL, Calado, CNC, Perforado, Perforacion'
      when 'especial' then 'Corte 45, 45, Diagonal, Diag, Corte especial'
      else null
    end
from public.mapa_pieza_112 m
where e.empresa_id = m.empresa_id and e.codigo = m.codigo and not e.por_pieza;

do $$
begin
  -- piezas_ot.etapas: text[] de tipos → integer[] de códigos de etapa
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'piezas_ot'
               and column_name = 'etapas' and udt_name = '_text') then
    alter table public.piezas_ot add column ruta integer[];
    update public.piezas_ot p set ruta = coalesce((
      select array_agg(m.codigo order by m.orden, m.codigo)
      from public.mapa_pieza_112 m where m.empresa_id = p.empresa_id and m.tipo = any (p.etapas)
    ), '{}');
    alter table public.piezas_ot drop column etapas;
    alter table public.piezas_ot rename column ruta to etapas;
    alter table public.piezas_ot alter column etapas set default '{}';
    alter table public.piezas_ot alter column etapas set not null;
  end if;

  -- pasos_pieza.etapa: tipo → código de etapa
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'pasos_pieza'
               and column_name = 'etapa' and data_type = 'text') then
    alter table public.pasos_pieza add column etapa_cod integer;
    update public.pasos_pieza s set etapa_cod = m.codigo
      from public.mapa_pieza_112 m where m.empresa_id = s.empresa_id and m.tipo = s.etapa;
    delete from public.pasos_pieza where etapa_cod is null;
    alter table public.pasos_pieza drop column etapa;
    alter table public.pasos_pieza rename column etapa_cod to etapa;
    alter table public.pasos_pieza alter column etapa set not null;
    alter table public.pasos_pieza add constraint pasos_pieza_pieza_id_etapa_key unique (pieza_id, etapa);
  end if;
end $$;

create index if not exists pasos_pieza_empresa_ot on public.pasos_pieza (empresa_id, ot, etapa);

drop index if exists public.etapas_empresa_tipo_pieza_uniq;
alter table public.etapas drop column if exists tipo_pieza;

drop table if exists public.mapa_pieza_112;

commit;
