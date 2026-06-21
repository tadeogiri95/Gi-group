-- 058: Documentación de empleados — requisitos documentales configurables por empresa.
--
-- tipos_documento_requerido: catálogo por empresa (gerencia define qué documentos exige).
-- documentos_exigidos_empleado: asignación tipo↔empleado (masiva o selectiva).
-- documentos_empleado: archivos efectivamente subidos (Supabase Storage).

CREATE TABLE IF NOT EXISTS tipos_documento_requerido (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  nombre              text NOT NULL,
  formatos_aceptados  text[] NOT NULL DEFAULT ARRAY['pdf','image'],
  admite_multiples    boolean NOT NULL DEFAULT false,
  tipo_carga          text NOT NULL DEFAULT 'puntual' CHECK (tipo_carga IN ('puntual','recurrente')),
  activo              boolean NOT NULL DEFAULT true,
  orden               integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documentos_exigidos_empleado (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  empleado_id         uuid NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  tipo_documento_id   uuid NOT NULL REFERENCES tipos_documento_requerido(id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empleado_id, tipo_documento_id)
);

CREATE TABLE IF NOT EXISTS documentos_empleado (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  empleado_id         uuid NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  tipo_documento_id   uuid NOT NULL REFERENCES tipos_documento_requerido(id) ON DELETE CASCADE,
  storage_path        text NOT NULL,
  nombre_archivo       text,
  mime_type            text,
  tamano_bytes         integer,
  estado               text NOT NULL DEFAULT 'cargado' CHECK (estado IN ('cargado','rechazado','vencido')),
  fecha_carga          timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tipos_doc_empresa        ON tipos_documento_requerido (empresa_id, activo);
CREATE INDEX IF NOT EXISTS idx_doc_exigidos_empresa      ON documentos_exigidos_empleado (empresa_id);
CREATE INDEX IF NOT EXISTS idx_doc_exigidos_empleado     ON documentos_exigidos_empleado (empleado_id);
CREATE INDEX IF NOT EXISTS idx_doc_empleado_empresa       ON documentos_empleado (empresa_id);
CREATE INDEX IF NOT EXISTS idx_doc_empleado_empleado      ON documentos_empleado (empleado_id, tipo_documento_id);

ALTER TABLE tipos_documento_requerido    ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos_exigidos_empleado ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos_empleado          ENABLE ROW LEVEL SECURITY;

-- Defense-in-depth (mismo patrón que la 050): la app usa SUPABASE_SERVICE_KEY
-- para todo, service_role bypassea RLS. Estas policies solo importan si algún
-- código futuro usa el rol `authenticated`.
DO $$
DECLARE
  tabla text;
  tablas text[] := ARRAY[
    'tipos_documento_requerido', 'documentos_exigidos_empleado', 'documentos_empleado'
  ];
BEGIN
  FOREACH tabla IN ARRAY tablas LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'tenant_isolation_auth_' || tabla, tabla);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO authenticated '
      || 'USING (empresa_id = (current_setting(''request.jwt.claims'', true)::json->>''eid'')::uuid) '
      || 'WITH CHECK (empresa_id = (current_setting(''request.jwt.claims'', true)::json->>''eid'')::uuid)',
      'tenant_isolation_auth_' || tabla, tabla
    );
  END LOOP;
END $$;
