-- ═══════════════════════════════════════════════════════════════════════════
-- 004_rls.sql — Políticas Row Level Security
--
-- ⚠️ NO EJECUTAR. Documentación del estado actual.
--
-- IMPORTANTE: la app NO usa la JS client de Supabase con la anon key.
-- Toda la comunicación pasa por API Routes de Next.js que:
--   1. Validan el token de sesión vía RPC `validar_sesion`
--   2. Inyectan `empresa_id` desde el token, no desde el cliente
--   3. Usan SUPABASE_SERVICE_KEY (bypassea RLS)
--
-- Por lo tanto, las RLS de la base son una segunda línea de defensa por
-- si alguna ruta llegara a usar la anon key, o por si el día de mañana
-- se expone la API REST directamente al frontend. El aislamiento real
-- multi-tenant lo garantiza /api/data, NO la RLS.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- Habilitar RLS en todas las tablas multi-tenant
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE empresa                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE empleados               ENABLE ROW LEVEL SECURITY;
ALTER TABLE sesiones                ENABLE ROW LEVEL SECURITY;
ALTER TABLE fichadas                ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitudes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificaciones          ENABLE ROW LEVEL SECURITY;
ALTER TABLE registro_actividades    ENABLE ROW LEVEL SECURITY;
ALTER TABLE reportes_obra           ENABLE ROW LEVEL SECURITY;
ALTER TABLE proyectos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE etapas                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE divisiones              ENABLE ROW LEVEL SECURITY;
ALTER TABLE geo_zonas               ENABLE ROW LEVEL SECURITY;
ALTER TABLE geo_registros           ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_tokens             ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE reglas_bot              ENABLE ROW LEVEL SECURITY;
ALTER TABLE notas_calendario        ENABLE ROW LEVEL SECURITY;
ALTER TABLE mensajes_chat           ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_sistema          ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitaciones_empresa    ENABLE ROW LEVEL SECURITY;
ALTER TABLE suscripciones           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos                   ENABLE ROW LEVEL SECURITY;


-- ═══════════════════════════════════════════════════════════════════════════
-- Service role: bypass total (la app usa esta key vía API routes)
-- Esta política no es estrictamente necesaria porque el rol `service_role`
-- ya bypassea RLS por diseño en Supabase, pero la dejamos explícita por
-- claridad.
-- ═══════════════════════════════════════════════════════════════════════════

-- Patrón aplicado a TODAS las tablas multi-tenant:
--   - SELECT/INSERT/UPDATE/DELETE permitido si auth.role() = 'service_role'
--   - Negado por defecto al anon y authenticated (sin política = sin acceso)

CREATE POLICY "service_role_all_empresa"
  ON empresa FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_empleados"
  ON empleados FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_sesiones"
  ON sesiones FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_fichadas"
  ON fichadas FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_solicitudes"
  ON solicitudes FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_notificaciones"
  ON notificaciones FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_registro_actividades"
  ON registro_actividades FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_reportes_obra"
  ON reportes_obra FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ... (repetir patrón análogo para el resto de tablas)


-- ═══════════════════════════════════════════════════════════════════════════
-- Lectura pública limitada de `empresa` por slug (pre-login)
--
-- /api/empresa?slug=xxx la consulta sin token para mostrar branding en la
-- pantalla de login. Sólo se exponen campos públicos (color, logo, nombre).
-- En la práctica esto pasa también por service_role, así que esta policy
-- es defensiva por si alguna vez el endpoint usa anon key.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE POLICY "empresa_publica_por_slug"
  ON empresa FOR SELECT TO anon
  USING (activa = true);
-- VERIFICAR si esta policy existe en producción. La app actualmente NO
-- depende de ella, pero conviene mantenerla para futuros endpoints
-- públicos.


-- ═══════════════════════════════════════════════════════════════════════════
-- NOTA SOBRE AUTH NATIVO DE SUPABASE
--
-- Gypi NO usa auth.users de Supabase. Implementa su propio sistema de
-- login con bcrypt + tabla `sesiones`. Por eso no hay policies del tipo
-- `auth.uid() = empleado_id` ni JWT claims con empresa_id.
--
-- Si en el futuro se migrara a Supabase Auth, el patrón típico sería:
--
--   CREATE POLICY "tenant_isolation" ON fichadas
--     FOR ALL TO authenticated
--     USING (empresa_id = (auth.jwt() ->> 'empresa_id')::uuid)
--     WITH CHECK (empresa_id = (auth.jwt() ->> 'empresa_id')::uuid);
-- ═══════════════════════════════════════════════════════════════════════════
