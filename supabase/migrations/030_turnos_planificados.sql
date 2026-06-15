-- 030: turnos_planificados — asignaciones de turno por día
-- Usado por calendario_screen.jsx para planificación de personal.

CREATE TABLE IF NOT EXISTS turnos_planificados (
  id              bigserial PRIMARY KEY,
  empresa_id      uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  empleado_id     uuid NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  fecha           date NOT NULL,
  hora_inicio     time NOT NULL,
  hora_fin        time NOT NULL,
  proyecto_id     bigint REFERENCES proyectos(id) ON DELETE SET NULL,
  nota            text DEFAULT '',
  created_at      timestamptz DEFAULT now(),
  UNIQUE(empresa_id, empleado_id, fecha)
);

CREATE INDEX idx_turnos_plan_empresa_fecha ON turnos_planificados(empresa_id, fecha);
CREATE INDEX idx_turnos_plan_empleado ON turnos_planificados(empleado_id, fecha);

-- RLS
ALTER TABLE turnos_planificados ENABLE ROW LEVEL SECURITY;
CREATE POLICY turnos_plan_all ON turnos_planificados FOR ALL USING (true) WITH CHECK (true);
