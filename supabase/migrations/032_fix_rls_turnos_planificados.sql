-- 032: Corregir RLS de turnos_planificados
-- La policy original (030) usaba USING(true) WITH CHECK(true) sin
-- restringir el rol, quedando abierta a anon/authenticated además de
-- service_role. Se reemplaza por el mismo patrón que el resto de las
-- tablas multi-tenant (004_rls.sql): solo service_role bypassea.

DROP POLICY IF EXISTS turnos_plan_all ON turnos_planificados;

CREATE POLICY "service_role_all_turnos_planificados"
  ON turnos_planificados FOR ALL TO service_role
  USING (true) WITH CHECK (true);
