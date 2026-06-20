-- ═══════════════════════════════════════════════════════════════════════════
-- SCHEMA_REFERENCIA.sql — Schema canónico consolidado de Gypi
--
-- ⚠️ NO EJECUTAR. Documentación de referencia, no una migración.
--
-- Resultado de aplicar, en orden, supabase/migrations/001 a 053. Para el
-- detalle de POR QUÉ cada columna/función/índice existe (qué bug arregló,
-- qué endpoint la usa), ver el archivo de migración correspondiente — este
-- archivo solo consolida el ESTADO FINAL en un solo lugar, para no tener
-- que reconstruirlo mentalmente leyendo 53 diffs en orden.
--
-- Generado en la auditoría DB del 2026-06-20. Si agregás una migración
-- nueva, actualizá este archivo en el mismo PR (no hay sync automático).
--
-- NOTA: `empresa.suscripcion_activa_id` referencia a `suscripciones`, que
-- está definida más abajo en este archivo (igual que en la base real: la
-- columna se agregó en (006), después de que ambas tablas ya existían).
-- Por ser un documento NO EJECUTAR, esta referencia hacia adelante no es
-- un problema — si algún día se usa este archivo para crear una instancia
-- nueva desde cero, mover esa columna a un ALTER TABLE al final.
--
-- Convenciones:
--   -- DEPRECATED: columna renombrada con prefijo _deprecated_, no la lee
--                  ningún código vivo. Candidata a DROP en una futura
--                  migración, pendiente de confirmación explícita.
--   -- (NNN)      : número de migración donde se agregó/modificó.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ═══════════════════════════════════════════════════════════════════════════
-- TABLAS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS empresa (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre                  text NOT NULL,
  nombre_corto            text,
  slug                    text UNIQUE NOT NULL,
  rubro                   text DEFAULT 'general',
  color_primario          text DEFAULT '#F97316',
  color_secundario        text DEFAULT '#8B5CF6',
  color_fondo             text,
  color_texto             text,
  tema_fondo              text,                                    -- sin uso conocido en el código actual
  logo_url                text,
  admin_email             text,
  admin_password          text,                                    -- bcrypt — excluido de /api/data (CAMPOS_EXCLUIDOS)
  plan_activo             text DEFAULT 'free',
  trial_usado             boolean DEFAULT false,
  max_empleados           integer DEFAULT 10,
  activa                  boolean DEFAULT true,
  onboarding_completado   boolean DEFAULT false,
  prompt_ia_obra          text,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now(),
  suscripcion_activa_id   bigint REFERENCES suscripciones(id) ON DELETE SET NULL,  -- (006)
  timezone                text DEFAULT 'America/Argentina/Buenos_Aires',           -- (008)
  email_verificado        boolean DEFAULT true,                                    -- (012)
  email_verify_token      text,                                                    -- (012) excluido de /api/data
  theme_preset            text DEFAULT 'default'                                   -- (025)
    CHECK (theme_preset IN ('default','crema','hielo','menta','oscuro','carbon','medianoche','industrial','custom')), -- (007)
  typography              text DEFAULT 'system',                                   -- (025)
  prompt_ia_chat          text,                                                    -- (043)
  email_verify_expires    timestamptz,                                            -- (043) excluido de /api/data
  plan_vence              timestamptz,                                            -- (049) grace period de downgrade
  plan_override_manual    boolean NOT NULL DEFAULT false                           -- (049) webhook no pisa el plan si está en true
);

CREATE TABLE IF NOT EXISTS empleados (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  legajo                  integer NOT NULL,
  nombre                  text NOT NULL,
  apodo                   text,
  email                   text,
  password                text,                                    -- bcrypt — excluido de /api/data
  area                    text DEFAULT 'produccion',
  division                text,
  rol                     text DEFAULT 'operativo',                -- operativo | gerencial | administrativo
  cc                      text,
  activo                  boolean DEFAULT true,
  diagrama                jsonb,
  _deprecated_ubicacion_fichaje jsonb,                              -- DEPRECATED (044) — usar geo_config + geo_zonas
  horas_semanales         numeric DEFAULT 41,
  debe_cambiar_password   boolean DEFAULT true,
  estado_activacion       text DEFAULT 'activo',
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now(),
  geo_config              jsonb DEFAULT '{"activo": false, "ubicacion_id": null, "radio": 150}',  -- (028)
  pre_cargado             boolean DEFAULT false,                                                   -- (029)
  password_reset_jti      text DEFAULT NULL,                                                       -- (018) token de un solo uso
  UNIQUE (empresa_id, legajo)
);

CREATE TABLE IF NOT EXISTS sesiones (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token                   text,                                    -- (037) nullable: drift histórico, ver migración
  empleado_id             uuid NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  ip                      text,
  user_agent              text,
  expira_en               timestamptz NOT NULL DEFAULT (now() + interval '30 days'),  -- (016)
  created_at              timestamptz DEFAULT now(),
  jti                     text,                                    -- (010) id del access token
  refresh_jti             text,                                    -- (010) id del refresh token
  token_hash              text,                                    -- (042)
  expires_at              timestamptz,                             -- (042)
  revocada                boolean DEFAULT false,                   -- (042)
  device_info             text,                                    -- (042)
  legajo                  integer                                  -- (042)
);

CREATE TABLE IF NOT EXISTS fichadas (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  empleado_id             uuid NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  legajo                  integer NOT NULL,
  fecha                   date NOT NULL,
  ingreso                 time,
  egreso                  time,
  horas_trabajadas        numeric,
  llegada_tarde           boolean DEFAULT false,
  minutos_tarde           integer DEFAULT 0,
  created_at              timestamptz DEFAULT now(),
  horas_extra             numeric DEFAULT 0,                       -- (031)
  UNIQUE (empresa_id, empleado_id, fecha)
);

CREATE TABLE IF NOT EXISTS solicitudes (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  empleado_id             uuid REFERENCES empleados(id) ON DELETE SET NULL,
  legajo                  integer NOT NULL,
  nombre_empleado         text,
  tipo                    text NOT NULL,                           -- permiso, vacaciones, justificacion, tardanza, ausencia, cambio_horario, hora_extra, otro
  motivo                  text,
  fecha                   date,                                    -- (034) era text, normalizado y convertido
  desde                   text,                                    -- hora "HH:MM" o "—", NO fecha — no convertir a DATE
  hasta                   text,
  estado                  text DEFAULT 'pendiente',                -- pendiente | aprobado | rechazado | registrado
  aprobador               text,
  created_at              timestamptz DEFAULT now(),
  resuelto_at             timestamptz                              -- (051)
);

CREATE TABLE IF NOT EXISTS notificaciones (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  destinatario_rol        text NOT NULL,                           -- 'gerencial' o legajo como texto
  tipo                    text NOT NULL,
  asunto                  text NOT NULL,
  detalle                 text,
  urgencia                text DEFAULT 'normal',                   -- alta | normal | baja
  solicitud_id            bigint REFERENCES solicitudes(id) ON DELETE SET NULL,
  leida                   boolean DEFAULT false,
  created_at              timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS registro_actividades (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  empleado_id             uuid NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  legajo                  integer NOT NULL,
  fecha                   date NOT NULL,
  hora_inicio             timestamptz NOT NULL,
  hora_fin                timestamptz,
  codigo_proyecto         text,
  etapa                   integer NOT NULL,                        -- 0 = en espera, >0 = etapa productiva
  tipo                    text DEFAULT 'N',                        -- N normal, R retrabajo, E error, C cambio
  causa                   text,                                    -- M material, H herramienta, I indicación, O otro
  division                text,
  observaciones           text,
  duracion_min            numeric
);

CREATE TABLE IF NOT EXISTS reportes_obra (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  usuario_id              uuid REFERENCES empleados(id) ON DELETE SET NULL,
  nombre                  text,
  legajo                  integer,
  fecha                   date NOT NULL,
  texto_original          text,
  progreso                jsonb,
  faltantes               jsonb,
  desvios                 jsonb,
  fotos                   jsonb,
  created_at              timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proyectos (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  codigo                  text NOT NULL,
  nombre                  text,
  estado                  text DEFAULT 'activo',                   -- activo | finalizado | pausado
  created_at              timestamptz DEFAULT now(),
  ot                      text,                                    -- (021) usado por el form real y el import CSV
  cliente                 text,                                    -- (021)
  obra                    text,                                    -- (021)
  proyecto                text,                                    -- (021)
  division                text,                                    -- (021)
  UNIQUE (empresa_id, ot)                                          -- (021) uq_proyectos
);

CREATE TABLE IF NOT EXISTS etapas (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  codigo                  integer NOT NULL,
  nombre                  text NOT NULL,
  icon                    text,
  color                   text,
  division                text,
  orden                   integer DEFAULT 0,
  activa                  boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS divisiones (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  clave                   text NOT NULL,
  label                   text NOT NULL,
  icon                    text,
  color                   text,
  orden                   integer DEFAULT 0,
  activa                  boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS geo_zonas (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  nombre                  text NOT NULL,                           -- (023) renombrada desde `label`
  lat                     numeric NOT NULL,
  lng                     numeric NOT NULL,
  radio                   integer DEFAULT 150,
  created_at              timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS geo_registros (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  empleado_id             uuid REFERENCES empleados(id) ON DELETE SET NULL,
  fichada_id              uuid REFERENCES fichadas(id) ON DELETE SET NULL,
  lat                     numeric,
  lng                     numeric,
  distancia               numeric,
  accion                  text,                                    -- ingreso | egreso
  created_at              timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS push_tokens (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid REFERENCES empresa(id) ON DELETE CASCADE,
  legajo                  integer NOT NULL,                        -- sin FK real a empleados.id, ver migración 053
  token                   text NOT NULL,
  updated_at              timestamptz DEFAULT now(),
  created_at              timestamptz DEFAULT now(),
  UNIQUE (legajo, token)
);

-- push_subscriptions: DROPPED (033) — legacy Web Push, reemplazada por push_tokens/FCM.

CREATE TABLE IF NOT EXISTS reglas_bot (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  regla                   text NOT NULL,
  orden                   integer DEFAULT 0,
  activa                  boolean DEFAULT true,
  created_at              timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notas_calendario (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  empleado_id             uuid REFERENCES empleados(id) ON DELETE SET NULL,
  fecha                   date NOT NULL,
  texto                   text NOT NULL,
  created_at              timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mensajes_chat (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  empleado_id             uuid REFERENCES empleados(id) ON DELETE CASCADE,
  role                    text NOT NULL,                           -- user | assistant
  content                 text NOT NULL,
  created_at              timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS config_sistema (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  clave                   text NOT NULL,
  valor                   jsonb,
  updated_at              timestamptz DEFAULT now(),
  UNIQUE (empresa_id, clave)
);

-- catalogo_etapas: DROPPED (033) — reemplazada por `etapas`.

CREATE TABLE IF NOT EXISTS invitaciones_empresa (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  codigo                  text UNIQUE NOT NULL,
  rol                     text DEFAULT 'operativo',
  email                   text,
  expira_en               timestamptz,
  usada                   boolean DEFAULT false,
  created_at              timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suscripciones (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  plan                    text NOT NULL,                           -- free | starter | pro | enterprise
  estado                  text DEFAULT 'activa',                   -- trial | activa | cancelada | vencida
  precio                  numeric,
  moneda                  text DEFAULT 'ARS',
  gateway                 text,
  _deprecated_gateway_id  text,                                    -- DEPRECATED (044) — usar gateway_subscription_id
  trial_inicio            timestamptz,
  trial_fin               timestamptz,
  periodo_inicio          timestamptz,
  periodo_fin             timestamptz,
  created_at              timestamptz DEFAULT now(),
  gateway_subscription_id text,                                    -- (006) preapproval_id de MercadoPago
  periodo                 text NOT NULL DEFAULT 'mensual'          -- (041)
    CHECK (periodo IN ('mensual', 'anual')),
  gateway_customer_id     text                                     -- (043)
);

CREATE TABLE IF NOT EXISTS pagos (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  suscripcion_id          bigint REFERENCES suscripciones(id) ON DELETE SET NULL,
  monto                   numeric NOT NULL,
  moneda                  text DEFAULT 'ARS',
  gateway                 text,
  gateway_payment_id      text UNIQUE,                             -- (017) idempotencia del webhook MP
  estado                  text,                                    -- aprobado | pendiente | rechazado
  created_at              timestamptz DEFAULT now(),
  fecha_pago              timestamptz                              -- (006)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid REFERENCES empresa(id) ON DELETE CASCADE,
  actor_id                uuid,                                    -- sin FK: el actor puede ser borrado y el log debe sobrevivir
  actor_legajo            integer,
  actor_rol               text,
  accion                  text NOT NULL,
  entidad                 text,
  entidad_id              text,
  datos_antes             jsonb,
  datos_despues           jsonb,
  ip                      text,
  created_at              timestamptz DEFAULT now()
);                                                                  -- (008)

CREATE TABLE IF NOT EXISTS rate_limits (
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  ventana                 text NOT NULL,                           -- YYYY-MM-DDTHH:MM
  count                   integer NOT NULL DEFAULT 1,
  created_at              timestamptz DEFAULT now(),
  PRIMARY KEY (empresa_id, ventana)
);                                                                  -- (011)

CREATE TABLE IF NOT EXISTS login_attempts (
  ip                      text NOT NULL,
  ventana                 text NOT NULL,
  count                   integer NOT NULL DEFAULT 1,
  PRIMARY KEY (ip, ventana)
);                                                                  -- (013)

CREATE TABLE IF NOT EXISTS turnos_planificados (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  empleado_id             uuid NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  fecha                   date NOT NULL,
  hora_inicio             time NOT NULL,
  hora_fin                time NOT NULL,
  proyecto_id             bigint REFERENCES proyectos(id) ON DELETE SET NULL,
  nota                    text DEFAULT '',
  created_at              timestamptz DEFAULT now(),
  UNIQUE (empresa_id, empleado_id, fecha)
);                                                                  -- (030)

CREATE TABLE IF NOT EXISTS metricas_eventos (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  evento                  text NOT NULL,
  empresa_id              uuid REFERENCES empresa(id) ON DELETE SET NULL,
  empleado_id             uuid REFERENCES empleados(id) ON DELETE SET NULL,
  plan                    text,
  meta                    jsonb DEFAULT '{}',
  created_at              timestamptz NOT NULL DEFAULT now()
);                                                                  -- (047)


-- ═══════════════════════════════════════════════════════════════════════════
-- VISTAS
-- ═══════════════════════════════════════════════════════════════════════════

-- v_resumen_diario (003) — VIEW normal, dashboard de gerencia (actividad del día).
-- v_scores_empleados (026 → MATERIALIZED VIEW desde 040) — rankings mensuales.
--   Refresh: refresh_scores_empleados(), llamado por /api/cron/refresh-scores
--   cada 4h desde (vercel.json). Antes de esa migración 040 + cron, la vista
--   quedaba congelada con los datos del momento en que se materializó.


-- ═══════════════════════════════════════════════════════════════════════════
-- FUNCIONES / RPCs (versión final tras los reemplazos posteriores)
-- ═══════════════════════════════════════════════════════════════════════════

-- validar_sesion(p_token)                              (002)
-- crear_sesion(p_empleado_id, p_empresa_id, ip, ua)     (002)
-- limpiar_sesiones_expiradas()                          (002)
-- auto_fichar_egresos()                                 (002 → 009 → 024, vigente: 024 — usa timezone por empresa)
-- iniciar_trial_pro(p_empresa_id)                       (002)
-- rpc_check_rate_limit(empresa_id, ventana, limite)     (011)
-- rpc_login_attempt(ip, ventana)                        (013)
-- vencer_trial_atomico(suscripcion_id, empresa_id)      (019) — 1 sola fila
-- vencer_trials_batch()                                (036) — todas las vencidas en una TX
-- rpc_crear_empresa_con_admin(...)                      (027) — registro atómico
-- refresh_scores_empleados()                            (040)
-- empresa_publica(p_slug)                               (038) — único acceso público seguro a `empresa`
-- rpc_superadmin_empresas(limit, offset, search)        (046) — paginado, reemplaza full scan
-- rpc_superadmin_stats()                                (046)
-- rpc_mrr_trending()                                    (048)
-- rpc_conversion_cohortes()                             (048)
-- rpc_churn_mensual()                                   (048 → 052, vigente: 052 — fix de cross join sin condición)
-- rpc_revenue_por_plan()                                (048)
-- rpc_funnel_activacion()                               (048)
-- limpiar_push_tokens_huerfanos()                       (053) — llamada desde /api/cron/limpiar-tokens


-- ═══════════════════════════════════════════════════════════════════════════
-- ÍNDICES — ver migraciones 005, 010, 011, 013, 014, 015(dropeado en 042),
-- 017, 020, 039, 040, 042, 045, 052 para el detalle de cada uno y qué query
-- cubre. No se repiten acá para no duplicar mantenimiento — son ~35 índices.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- RLS — capa defensiva, no la usa la app (service_role bypassea RLS siempre).
-- Tres familias de policies, ver 004/035/038/050 para el detalle:
--   1. service_role_all_<tabla>   — bypass explícito (redundante pero documentado)
--   2. tenant_isolation_auth_<tabla> (050) — futuro-proofing si algún día se
--      usa el rol `authenticated` con JWT claims de Supabase Auth (hoy no se usa)
--   3. empresa_publica() (038) — única vía pública real, filtra columnas a mano
-- ═══════════════════════════════════════════════════════════════════════════
