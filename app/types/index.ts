// Tipos de dominio compartidos — fuente de verdad para toda la app

export interface Empresa {
  id: string;
  nombre: string;
  nombre_corto: string;
  slug: string;
  admin_email?: string;
  plan_activo?: string;
  plan?: string;
  activa: boolean;
  color_primario: string;
  color_secundario: string;
  color_fondo?: string;
  color_texto?: string;
  theme_preset?: string;
  typography?: string;
  logo_url?: string | null;
  rubro?: string;
  onboarding_completado?: boolean;
  timezone?: string;
  created_at?: string;
}

export interface Empleado {
  id: string;
  empresa_id: string;
  legajo: number;
  nombre: string;
  apodo?: string;
  email?: string;
  rol: "empleado" | "gerencial" | "administrativo";
  area?: string;
  division?: string;
  activo: boolean;
  debe_cambiar_password?: boolean;
  diagrama?: Record<string, { in?: string; out?: string }>;
  created_at?: string;
}

export interface Fichada {
  id: string;
  empresa_id: string;
  empleado_id: string;
  legajo: number;
  fecha: string;
  ingreso?: string | null;
  egreso?: string | null;
  horas_trabajadas?: number | null;
  llegada_tarde?: boolean;
  minutos_tarde?: number;
}

export interface Solicitud {
  id: string;
  empresa_id: string;
  legajo: number;
  tipo: string;
  estado: "pendiente" | "aprobada" | "rechazada";
  descripcion?: string;
  fecha_inicio?: string;
  fecha_fin?: string;
  created_at: string;
}

export interface Notificacion {
  id: string;
  empresa_id: string;
  destinatario_rol?: string;
  titulo: string;
  cuerpo?: string;
  leida?: boolean;
  created_at: string;
}

// Payload decodificado del JWT de sesión
export interface SesionJWT {
  empleado_id: string;
  empresa_id: string;
  legajo: number;
  rol: string;
  jti?: string;
  imp?: boolean;
  _auth_method?: "jwt" | "legacy_rpc";
}

export interface AuditEntry {
  empresa_id?: string;
  actor_id?: string;
  actor_legajo?: number;
  actor_rol?: string;
  accion: string;
  entidad?: string;
  entidad_id?: string;
  datos_antes?: Record<string, unknown>;
  datos_despues?: Record<string, unknown>;
  ip?: string;
}

export interface ValidacionPassword {
  valido: boolean;
  error?: string;
}

export interface TokenResult {
  token: string;
  jti: string;
}
