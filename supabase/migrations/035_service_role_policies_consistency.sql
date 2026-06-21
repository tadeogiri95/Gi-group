-- 035: Completar policies explícitas de service_role
--
-- 004_rls.sql habilitó RLS en 23 tablas pero solo documentó la policy
-- explícita "service_role_all_X" para 8 de ellas (el resto quedó con el
-- comentario "repetir patrón análogo para el resto de tablas", nunca hecho).
--
-- Esto NO es una falla de seguridad: service_role bypassea RLS en Supabase
-- sin importar si hay policies (a diferencia de turnos_planificados en 030,
-- que sí tenía un bug real — corregido en 032). Es una falta de consistencia
-- y documentación. Se agrega la policy explícita para las tablas que faltan,
-- siguiendo el mismo patrón que 004_rls.sql.
--
-- catalogo_etapas y push_subscriptions quedan afuera: se eliminan en 033.
--
-- DEFENSIVO: se detectó que geo_registros (definida en 001_tablas_base.sql,
-- usada por app/api/fichar/route.js para el log de geolocalización) nunca
-- llegó a crearse en esta base — el schema real tiene drift respecto a los
-- archivos de migración. Por eso cada policy se crea solo si la tabla existe
-- (to_regclass) y además se auto-repara geo_registros si falta, en vez de
-- asumir que el resto de las 001_tablas_base.sql sí están aplicadas.

-- ── Auto-reparar geo_registros si no existe ──
CREATE TABLE IF NOT EXISTS geo_registros (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  empleado_id             uuid REFERENCES empleados(id) ON DELETE SET NULL,
  fichada_id              uuid REFERENCES fichadas(id) ON DELETE SET NULL,
  lat                     numeric,
  lng                     numeric,
  distancia               numeric,
  accion                  text,
  created_at              timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_geo_registros_empleado
  ON geo_registros (empleado_id, created_at DESC);

ALTER TABLE geo_registros ENABLE ROW LEVEL SECURITY;

-- ── Policies — solo si la tabla existe; idempotente (seguro re-ejecutar) ──
DO $$
DECLARE
  tabla text;
  tablas text[] := ARRAY[
    'proyectos', 'etapas', 'divisiones', 'geo_zonas', 'geo_registros',
    'push_tokens', 'reglas_bot', 'notas_calendario', 'mensajes_chat',
    'config_sistema', 'invitaciones_empresa', 'suscripciones', 'pagos'
  ];
BEGIN
  FOREACH tabla IN ARRAY tablas LOOP
    IF to_regclass('public.' || tabla) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'service_role_all_' || tabla, tabla);
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        'service_role_all_' || tabla, tabla
      );
    ELSE
      RAISE NOTICE 'Tabla % no existe — se omite su policy', tabla;
    END IF;
  END LOOP;
END $$;
