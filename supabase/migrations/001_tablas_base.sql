-- ═══════════════════════════════════════════════════════════════════════════
-- 001_tablas_base.sql — DDL de referencia del schema Gypi
--
-- ⚠️ NO EJECUTAR. La base ya está en producción.
-- Este archivo documenta el estado actual del schema para nuevos developers
-- y para poder reconstruir el entorno desde cero en otra instalación.
--
-- Los `-- VERIFICAR` marcan campos inferidos del código de la app cuyos
-- tipos exactos conviene confirmar contra Supabase Studio.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── EXTENSIONES ───
CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";   -- VERIFICAR (usa uuid o bigserial?)


-- ═══════════════════════════════════════════════════════════════════════════
-- empresa — tenant raíz. Cada fila es una empresa cliente.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS empresa (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre                  text NOT NULL,
  nombre_corto            text,
  slug                    text UNIQUE NOT NULL,         -- subdominio: gypi.app/[slug]
  rubro                   text DEFAULT 'general',       -- industria, construccion, gastronomia, otro...
  color_primario          text DEFAULT '#F97316',
  color_secundario        text DEFAULT '#8B5CF6',
  color_fondo             text,                         -- VERIFICAR
  color_texto             text,                         -- VERIFICAR
  tema_fondo              text,                         -- oscuro / carbon / azul_noche / claro / crema / custom
  logo_url                text,
  admin_email             text,
  admin_password          text,                         -- bcrypt hash
  plan_activo             text DEFAULT 'free',          -- free, starter, pro, enterprise
  trial_usado             boolean DEFAULT false,
  max_empleados           integer DEFAULT 10,
  activa                  boolean DEFAULT true,
  onboarding_completado   boolean DEFAULT false,
  prompt_ia_obra          text,                         -- prompt custom para reportes de obra
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);


-- ═══════════════════════════════════════════════════════════════════════════
-- empleados — usuarios de la app. Multi-tenant por empresa_id.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS empleados (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  legajo                  integer NOT NULL,             -- entero, NO string
  nombre                  text NOT NULL,
  apodo                   text,
  email                   text,
  password                text,                         -- bcrypt hash
  area                    text DEFAULT 'produccion',
  division                text,                         -- ID o clave de división
  rol                     text DEFAULT 'operativo',     -- operativo, gerencial, administrativo
  cc                      text,                         -- centro de costo
  activo                  boolean DEFAULT true,
  diagrama                jsonb,                        -- { lun: {in:"08:00",out:"17:00"}, ... }
  ubicacion_fichaje       jsonb,                        -- { activa, tipo, nombre, lat, lng, radio }
  horas_semanales         numeric DEFAULT 41,
  debe_cambiar_password   boolean DEFAULT true,
  estado_activacion       text DEFAULT 'activo',        -- activo, pendiente_activacion
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now(),
  UNIQUE (empresa_id, legajo)
);


-- ═══════════════════════════════════════════════════════════════════════════
-- sesiones — tokens de login validados por validar_sesion()
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sesiones (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token                   text UNIQUE NOT NULL,
  empleado_id             uuid NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  ip                      text,
  user_agent              text,
  expira_en               timestamptz NOT NULL,
  created_at              timestamptz DEFAULT now()
);


-- ═══════════════════════════════════════════════════════════════════════════
-- fichadas — clock-in / clock-out diario
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS fichadas (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  empleado_id             uuid NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  legajo                  integer NOT NULL,
  fecha                   date NOT NULL,
  ingreso                 time,                         -- 'HH:MM' (sin segundos en validación)
  egreso                  time,
  horas_trabajadas        numeric,                      -- VERIFICAR (calculado o stored?)
  llegada_tarde           boolean DEFAULT false,
  minutos_tarde           integer DEFAULT 0,
  created_at              timestamptz DEFAULT now(),
  UNIQUE (empresa_id, empleado_id, fecha)
);


-- ═══════════════════════════════════════════════════════════════════════════
-- solicitudes — permisos, vacaciones, justificaciones, tardanzas
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS solicitudes (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  empleado_id             uuid REFERENCES empleados(id) ON DELETE SET NULL,
  legajo                  integer NOT NULL,
  nombre_empleado         text,
  tipo                    text NOT NULL,                -- permiso, vacaciones, justificacion, tardanza, ausencia, cambio_horario, otro
  motivo                  text,
  fecha                   text,                         -- VERIFICAR (a veces 'hoy', a veces date string)
  desde                   text,
  hasta                   text,
  estado                  text DEFAULT 'pendiente',     -- pendiente, aprobado, rechazado, registrado
  aprobador               text,
  created_at              timestamptz DEFAULT now()
);


-- ═══════════════════════════════════════════════════════════════════════════
-- notificaciones — buzón de avisos para roles o legajos específicos
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS notificaciones (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  destinatario_rol        text NOT NULL,                -- 'gerencial' o legajo en texto
  tipo                    text NOT NULL,                -- solicitud, alerta, info
  asunto                  text NOT NULL,
  detalle                 text,
  urgencia                text DEFAULT 'normal',        -- alta, normal, baja
  solicitud_id            bigint REFERENCES solicitudes(id) ON DELETE SET NULL,
  leida                   boolean DEFAULT false,        -- VERIFICAR
  created_at              timestamptz DEFAULT now()
);


-- ═══════════════════════════════════════════════════════════════════════════
-- registro_actividades — tareas por etapa que ejecutan los operarios
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS registro_actividades (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  empleado_id             uuid NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  legajo                  integer NOT NULL,
  fecha                   date NOT NULL,
  hora_inicio             timestamptz NOT NULL,
  hora_fin                timestamptz,
  codigo_proyecto         text,                         -- TEXT (OT con guiones tipo 7408-10)
  etapa                   integer NOT NULL,             -- 0 = en espera, >0 = etapa productiva
  tipo                    text DEFAULT 'N',             -- N normal, R retrabajo, E error, C cambio
  causa                   text,                         -- M material, H herramienta, I indicación, O otro
  division                text,
  observaciones           text,
  duracion_min            numeric                       -- VERIFICAR (calculada al cerrar?)
);


-- ═══════════════════════════════════════════════════════════════════════════
-- reportes_obra — reportes estructurados por IA desde texto/voz
-- ═══════════════════════════════════════════════════════════════════════════
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
  fotos                   jsonb,                        -- VERIFICAR (array de URLs)
  created_at              timestamptz DEFAULT now()
);


-- ═══════════════════════════════════════════════════════════════════════════
-- proyectos — catálogo de OTs / proyectos activos
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS proyectos (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  codigo                  text NOT NULL,                -- TEXT (admite "7408-10")
  nombre                  text,
  estado                  text DEFAULT 'activo',        -- activo, finalizado, pausado
  created_at              timestamptz DEFAULT now()
);


-- ═══════════════════════════════════════════════════════════════════════════
-- etapas — catálogo de etapas productivas por división
-- ═══════════════════════════════════════════════════════════════════════════
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


-- ═══════════════════════════════════════════════════════════════════════════
-- divisiones — talleres / áreas productivas configurables por empresa
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS divisiones (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  clave                   text NOT NULL,
  label                   text NOT NULL,
  icon                    text,
  color                   text,
  orden                   integer DEFAULT 0,            -- VERIFICAR
  activa                  boolean DEFAULT true          -- VERIFICAR
);


-- ═══════════════════════════════════════════════════════════════════════════
-- geo_zonas — ubicaciones permitidas para fichar
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS geo_zonas (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  label                   text NOT NULL,               -- VERIFICAR (label o nombre)
  lat                     numeric NOT NULL,
  lng                     numeric NOT NULL,
  radio                   integer DEFAULT 150,
  created_at              timestamptz DEFAULT now()
);


-- ═══════════════════════════════════════════════════════════════════════════
-- geo_registros — log de fichajes con coordenadas para auditoría
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS geo_registros (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  empleado_id             uuid REFERENCES empleados(id) ON DELETE SET NULL,
  fichada_id              uuid REFERENCES fichadas(id) ON DELETE SET NULL,
  lat                     numeric,
  lng                     numeric,
  distancia               numeric,                      -- metros al punto esperado
  accion                  text,                         -- ingreso / egreso  -- VERIFICAR
  created_at              timestamptz DEFAULT now()
);


-- ═══════════════════════════════════════════════════════════════════════════
-- push_tokens — tokens FCM por dispositivo
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS push_tokens (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid REFERENCES empresa(id) ON DELETE CASCADE,
  legajo                  integer NOT NULL,
  token                   text NOT NULL,
  updated_at              timestamptz DEFAULT now(),
  created_at              timestamptz DEFAULT now(),
  UNIQUE (legajo, token)
);


-- ═══════════════════════════════════════════════════════════════════════════
-- push_subscriptions — VERIFICAR si todavía se usa (parece legacy Web Push)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid REFERENCES empresa(id) ON DELETE CASCADE,
  legajo                  integer,
  endpoint                text,                         -- VERIFICAR
  p256dh                  text,
  auth                    text,
  created_at              timestamptz DEFAULT now()
);


-- ═══════════════════════════════════════════════════════════════════════════
-- reglas_bot — reglas obligatorias que el bot HR debe respetar
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS reglas_bot (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  regla                   text NOT NULL,
  orden                   integer DEFAULT 0,
  activa                  boolean DEFAULT true,
  created_at              timestamptz DEFAULT now()
);


-- ═══════════════════════════════════════════════════════════════════════════
-- notas_calendario — notas asociadas a fechas del calendario
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS notas_calendario (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  empleado_id             uuid REFERENCES empleados(id) ON DELETE SET NULL,
  fecha                   date NOT NULL,
  texto                   text NOT NULL,
  created_at              timestamptz DEFAULT now()
);


-- ═══════════════════════════════════════════════════════════════════════════
-- mensajes_chat — historial de chat del bot HR
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS mensajes_chat (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  empleado_id             uuid REFERENCES empleados(id) ON DELETE CASCADE,
  role                    text NOT NULL,                -- user / assistant
  content                 text NOT NULL,
  created_at              timestamptz DEFAULT now()
);


-- ═══════════════════════════════════════════════════════════════════════════
-- config_sistema — clave/valor por empresa (settings varios)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS config_sistema (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  clave                   text NOT NULL,
  valor                   jsonb,
  updated_at              timestamptz DEFAULT now(),
  UNIQUE (empresa_id, clave)
);


-- ═══════════════════════════════════════════════════════════════════════════
-- catalogo_etapas — VERIFICAR si está obsoleta (parece reemplazada por `etapas`)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS catalogo_etapas (
  id                      bigserial PRIMARY KEY,
  codigo                  integer,
  nombre                  text,
  division                text
);


-- ═══════════════════════════════════════════════════════════════════════════
-- invitaciones_empresa — códigos de invitación para sumar empleados
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS invitaciones_empresa (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  codigo                  text UNIQUE NOT NULL,
  rol                     text DEFAULT 'operativo',
  email                   text,                         -- VERIFICAR
  expira_en               timestamptz,
  usada                   boolean DEFAULT false,
  created_at              timestamptz DEFAULT now()
);


-- ═══════════════════════════════════════════════════════════════════════════
-- suscripciones — plan + estado de billing por empresa
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS suscripciones (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  plan                    text NOT NULL,                -- free, starter, pro, enterprise
  estado                  text DEFAULT 'activa',        -- trial, activa, cancelada, vencida
  precio                  numeric,
  moneda                  text DEFAULT 'ARS',
  gateway                 text,                         -- mercadopago, stripe
  gateway_id              text,                         -- VERIFICAR (preapproval_id de MP)
  trial_inicio            timestamptz,
  trial_fin               timestamptz,
  periodo_inicio          timestamptz,
  periodo_fin             timestamptz,
  created_at              timestamptz DEFAULT now()
);


-- ═══════════════════════════════════════════════════════════════════════════
-- pagos — log de pagos individuales recibidos
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pagos (
  id                      bigserial PRIMARY KEY,
  empresa_id              uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  suscripcion_id          bigint REFERENCES suscripciones(id) ON DELETE SET NULL,
  monto                   numeric NOT NULL,
  moneda                  text DEFAULT 'ARS',
  gateway                 text,
  gateway_payment_id      text,                         -- VERIFICAR
  estado                  text,                         -- aprobado, pendiente, rechazado
  created_at              timestamptz DEFAULT now()
);
