-- 050: Defense-in-depth RLS policies for tenant isolation
--
-- The app uses SUPABASE_SERVICE_KEY (bypasses RLS) for all API routes,
-- so tenant isolation is enforced at the application layer by /api/data.
-- These policies are a SECOND line of defense: if any code path ever
-- uses the anon or authenticated role, rows are still scoped by empresa_id.
--
-- No existing functionality changes: service_role continues to bypass all RLS.
-- The empresa table gets a read-only policy for authenticated (own empresa only).
-- Pre-login public access to empresa uses the empresa_publica() function (038).

DO $$
DECLARE
  tabla text;
  tablas_con_empresa text[] := ARRAY[
    'empleados', 'fichadas', 'solicitudes', 'notificaciones',
    'registro_actividades', 'reportes_obra', 'push_tokens',
    'config_sistema', 'notas_calendario', 'mensajes_chat', 'turnos_planificados',
    'etapas', 'divisiones', 'geo_zonas', 'geo_registros',
    'reglas_bot', 'proyectos', 'invitaciones_empresa',
    'suscripciones', 'pagos'
  ];
BEGIN
  FOREACH tabla IN ARRAY tablas_con_empresa LOOP
    IF to_regclass('public.' || tabla) IS NOT NULL THEN
      -- Drop if exists (idempotent)
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I',
        'tenant_isolation_anon_' || tabla, tabla);
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I',
        'tenant_isolation_auth_' || tabla, tabla);

      -- Anon: deny all (no policy = no access, but explicit deny is clearer)
      -- We don't create an anon policy — absence of policy means zero access.

      -- Authenticated: scope to empresa_id from JWT claim (future-proofing).
      -- Currently the app doesn't use authenticated role, but if it ever does,
      -- this ensures tenant isolation at the DB level.
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL TO authenticated '
        || 'USING (empresa_id = (current_setting(''request.jwt.claims'', true)::json->>''eid'')::uuid) '
        || 'WITH CHECK (empresa_id = (current_setting(''request.jwt.claims'', true)::json->>''eid'')::uuid)',
        'tenant_isolation_auth_' || tabla, tabla
      );

      RAISE NOTICE 'Created tenant isolation policy for %', tabla;
    ELSE
      RAISE NOTICE 'Table % does not exist — skipped', tabla;
    END IF;
  END LOOP;

  -- empresa table: authenticated can only read their own empresa
  IF to_regclass('public.empresa') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_auth_empresa ON empresa';
    EXECUTE '
      CREATE POLICY tenant_isolation_auth_empresa ON empresa
        FOR SELECT TO authenticated
        USING (id = (current_setting(''request.jwt.claims'', true)::json->>''eid'')::uuid)
    ';
    RAISE NOTICE 'Created tenant isolation policy for empresa (SELECT only)';
  END IF;

  -- sesiones table: authenticated can only see their own sessions
  IF to_regclass('public.sesiones') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_auth_sesiones ON sesiones';
    EXECUTE '
      CREATE POLICY tenant_isolation_auth_sesiones ON sesiones
        FOR SELECT TO authenticated
        USING (empresa_id = (current_setting(''request.jwt.claims'', true)::json->>''eid'')::uuid)
    ';
    RAISE NOTICE 'Created tenant isolation policy for sesiones (SELECT only)';
  END IF;
END $$;

COMMENT ON POLICY tenant_isolation_auth_empleados ON empleados IS
  'Defense-in-depth: scope authenticated role to empresa_id from JWT. App uses service_role, this is a safety net.';
