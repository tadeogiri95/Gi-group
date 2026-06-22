// Tipos de dominio compartidos — fuente de verdad para toda la app

export interface Empresa {
  id: string;
  nombre: string;
  nombre_corto: string;
  slug: string;
  admin_email?: string;
  plan_activo?: string;
  plan_vence?: string | null;
  plan_override_manual?: boolean;
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
  updated_at?: string;
  trial_usado?: boolean;
  max_empleados?: number;
  email_verificado?: boolean;
  prompt_ia_obra?: string;
  prompt_ia_chat?: string;
  suscripcion_activa_id?: number | null;
}

export interface Empleado {
  id: string;
  empresa_id: string;
  legajo: number;
  nombre: string;
  apodo?: string;
  email?: string;
  rol: "operativo" | "gerencial" | "administrativo";
  area?: string;
  division?: string;
  activo: boolean;
  debe_cambiar_password?: boolean;
  diagrama?: Record<string, { in?: string; out?: string }>;
  created_at?: string;
  updated_at?: string;
  geo_config?: { activo: boolean; ubicacion_id: string | null; radio: number };
  pre_cargado?: boolean;
  estado_activacion?: string;
  horas_semanales?: number;
  cc?: string;
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
  horas_extra?: number;
  created_at?: string;
}

export interface Solicitud {
  id: string;
  empresa_id: string;
  empleado_id?: string;
  legajo: number;
  nombre_empleado?: string;
  tipo: string;
  motivo?: string;
  fecha?: string;
  desde?: string;
  hasta?: string;
  estado: "pendiente" | "aprobado" | "rechazado" | "registrado";
  aprobador?: string;
  resuelto_at?: string;
  created_at: string;
}

export interface Notificacion {
  id: string;
  empresa_id: string;
  destinatario_rol: string;
  tipo: string;
  asunto: string;
  detalle?: string;
  urgencia?: "alta" | "normal" | "baja";
  solicitud_id?: number | null;
  leida?: boolean;
  created_at: string;
}

export interface Sesion {
  id: string;
  empleado_id: string;
  empresa_id: string;
  legajo?: number;
  token?: string;
  token_hash?: string;
  jti?: string;
  refresh_jti?: string;
  expires_at?: string;
  expira_en?: string;
  revocada?: boolean;
  device_info?: string;
  ip?: string;
  user_agent?: string;
  created_at?: string;
}

export interface TurnoPlanificado {
  id: string;
  empresa_id: string;
  empleado_id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  proyecto_id?: number | null;
  nota?: string;
  created_at?: string;
}

export interface EmailEvento {
  id: number;
  resend_email_id?: string | null;
  tipo_email?: string | null;
  evento: string;
  empresa_id?: string | null;
  destinatario?: string | null;
  link?: string | null;
  meta?: Record<string, unknown>;
  created_at: string;
}

// Shapes de retorno de RPCs de growth/superadmin (055) — no son tablas,
// las devuelve sbRpc() tal cual declara el RETURNS TABLE de cada función.
export interface HealthScoreEmpresa {
  empresa_id: string;
  nombre: string;
  plan_activo: string;
  onboarding_completado: boolean;
  empleados_activos: number;
  empleados_fichando_7d: number;
  dias_desde_ultimo_fichaje: number | null;
  eventos_30d: number;
  health_score: number;
  riesgo: "alto" | "medio" | "bajo";
}

export interface EmailEngagement {
  tipo_email: string;
  enviados: number;
  entregados: number;
  abiertos: number;
  clickeados: number;
  rebotados: number;
  tasa_apertura: number;
  tasa_click: number;
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
