-- 118: % de avance de producción por escaneo (seguimiento de OT por escaneo,
-- parte 25).
--
-- v_avance_piezas: una fila por OT y etapa con cuántas piezas llevan esa
-- etapa (total) y cuántas ya se escanearon en ella (pasaron), más el primer y
-- el último escaneo. Solo cuentan los escaneos de piezas que llevan la etapa
-- (los de una etapa que no le toca a la pieza no suman). Así el Tablero, la
-- lista de OT y el Panel de control leen unas pocas filas en vez de todas las
-- piezas.
--
-- security_invoker: la vista aplica la RLS de piezas_ot y pasos_pieza con el
-- pase de quien consulta (solo ve su empresa).
--
-- ORDEN: correr ANTES de unir el PR que la usa. Sin la vista la app sigue
-- andando, solo que no muestra el %. Es idempotente.

begin;

create or replace view public.v_avance_piezas
  with (security_invoker = true) as
select p.empresa_id,
       p.ot,
       e.etapa,
       count(*)::int          as total,
       count(s.id)::int       as pasaron,
       min(s.created_at)      as primer_paso,
       max(s.created_at)      as ultimo_paso
  from public.piezas_ot p
  cross join lateral unnest(p.etapas) as e(etapa)
  left join public.pasos_pieza s on s.pieza_id = p.id and s.etapa = e.etapa
 group by p.empresa_id, p.ot, e.etapa;

comment on view public.v_avance_piezas is
  'Avance por escaneo: por OT y etapa, piezas que la llevan (total) y escaneadas (pasaron). Parte 25.';

revoke all on public.v_avance_piezas from anon;
grant select on public.v_avance_piezas to authenticated;

commit;
