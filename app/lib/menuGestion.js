// app/lib/menuGestion.js — Menú "Más" de gestión (reforma UX R5).
//
// Como máximo dos niveles: la lista y la pantalla. Lo de todos los días va
// arriba y lo que se configura una vez, abajo. Cada sección aparece una sola
// vez; lo que la empresa no contrató se ve con 🔒, lo que apagó en Módulos
// no se ve y lo que el rol no puede usar no se muestra (Facturación es solo
// del dueño).
import { seccionBloqueada, seccionApagada, tieneModulo, moduloApagado, conRegistroTareas } from "./modulos";
import { puedeConfigurar, esTitular } from "./accesos";

// Botones de la barra de gestión que agrupan pantallas en pestañas (menú
// nuevo, parte 32): Proyectos (OT y reportes de producción), Inventario
// (Stock y Compras) y Mantenimiento (Flota vehicular y Maquinaria, parte 33).
// Reemplazan a "Planta".
// Cada pestaña es de un módulo: lo apagado no se ve y lo no contratado va con
// 🔒. "En vivo" sale del registro de tareas y no se muestra sin él (2026-10).
export const BOTONES_GESTION = {
  // Auditoría 01/11 (PR 3): "Proyectos" pasa a llamarse "Producción" e
  // "Inventario", "Materiales"; los ids quedan igual (enlaces y avisos viejos).
  proyectos: {
    label: "Producción",
    detalle: "Órdenes de trabajo, planificación y reportes",
    opciones: [
      // 23/11 (Tadeo): orden y nombres de las pestañas de Producción:
      // Órdenes de trabajo, Panel de control, Planificación, Reportes, Minuta
      { id: "ot", label: "Órdenes de trabajo", modulo: "proyectos" },
      // Panel de control de la producción (Tadeo, 23/11): indicadores con
      // semáforo, la semana contra las 4 anteriores. Dueño y supervisores
      { id: "panel", label: "Panel de control", modulo: "proyectos", soloGerencia: true },
      // Planificación de la producción (parte 38): la arman el Dueño y los supervisores
      { id: "planificacion", label: "Planificación", modulo: "proyectos", soloGerencia: true },
      { id: "reportes", label: "Reportes", modulo: "actividad" },
      // Minuta de la reunión de Buenos Días (Minuta, parte M1, 150): Dueño y supervisores
      { id: "minuta", label: "Minuta", modulo: "minutas", soloGerencia: true },
      // 23/11 (Tadeo): sin pestaña "Instalaciones"; solo abría el Gantt de
      // instalación, que sigue en OT → 📅 Gantt → 🔧 Instalación
      // En vivo solo aparece si la empresa registra tareas ("Iniciar Tarea")
      { id: "vivo", label: "En vivo", modulo: "actividad", conTareas: true },
    ],
  },
  inventario: {
    label: "Materiales",
    detalle: "Stock y compras",
    opciones: [
      { id: "stock", label: "Stock", modulo: "stock" },
      // 17/11 (pedido de Tadeo): inventario valorizado a una fecha (solo la
      // oficina, muestra precios) y Movimientos con lugar propio
      { id: "inventario-valorizado", label: "Inventario valorizado", modulo: "stock", soloOficina: true },
      { id: "movimientos", label: "Movimientos", modulo: "stock" },
      { id: "compras", label: "Compras", modulo: "compras" },
    ],
  },
  mantenimiento: {
    label: "Mantenimiento",
    detalle: "Flota vehicular y maquinaria",
    opciones: [
      { id: "flota", label: "Flota vehicular", modulo: "flota" },
      { id: "maquinaria", label: "Maquinaria", modulo: "maquinaria" },
    ],
  },
  // Logística (pedido de Tadeo, 23/11; 203): parte 1 = lugares y la
  // dirección de la obra de las OT. Los viajes y Mis viajes vienen después.
  logistica: {
    label: "Logística",
    detalle: "Viajes, remitos, recorridos y lugares",
    opciones: [
      { id: "log-lugares", label: "Lugares y obras", modulo: "logistica" },
    ],
  },
  // Finanzas (F1, 171): solo el rol Dueño, ni el Supervisor (pedido 09/11).
  // Desde el 10/11 va en la barra de abajo del celular como un módulo más.
  finanzas: {
    label: "Finanzas",
    detalle: "Cuentas, cajas, bancos y movimientos",
    opciones: [
      // Parte 10 del 11/11: Inicio primero y el resto por tema (finanzasInicio.js).
      // 19/11 (punto 17): por lo que se hace — Pagar y cobrar, Saldos,
      // Informes, Cierre y ajustes — en el orden de GRUPOS_FINANZAS.
      { id: "fin-inicio", label: "Inicio", modulo: "finanzas", soloDueno: true },
      // Pagar y cobrar
      { id: "fin-pagos", label: "Órdenes de pago", modulo: "finanzas", soloDueno: true },
      { id: "fin-cheques", label: "Cheques", modulo: "finanzas", soloDueno: true },
      { id: "fin-sueldos", label: "Sueldos", modulo: "finanzas", soloDueno: true },
      // Saldos: 13/11 (parte 3 del plan de Tesorería) Movimientos y Cajas y bancos en una sola
      { id: "fin-tesoreria", label: "Cajas y bancos", modulo: "finanzas", soloDueno: true },
      { id: "fin-cuentas", label: "Cuentas corrientes", modulo: "finanzas", soloDueno: true },
      { id: "fin-inversiones", label: "Inversiones", modulo: "finanzas", soloDueno: true },
      { id: "fin-personas", label: "Agenda", modulo: "finanzas", soloDueno: true },
      // Informes (14/11, etapa 6: situación patrimonial; 13/11: el mayor de cada cuenta)
      { id: "fin-resultados", label: "Resultados", modulo: "finanzas", soloDueno: true },
      { id: "fin-patrimonio", label: "Situación patrimonial", modulo: "finanzas", soloDueno: true },
      { id: "fin-flujo", label: "Flujo de caja", modulo: "finanzas", soloDueno: true },
      { id: "fin-cxp", label: "Cuentas a cobrar y pagar", modulo: "finanzas", soloDueno: true },
      { id: "fin-reporte", label: "Reporte financiero", modulo: "finanzas", soloDueno: true },
      // 19/11: fondos, inversiones, calce de cheques y plazos fijos, cheques a cobrar
      { id: "fin-informe-tesoreria", label: "Informe de tesorería", modulo: "finanzas", soloDueno: true },
      { id: "fin-mayor", label: "Mayor de cuentas", modulo: "finanzas", soloDueno: true },
      // Cierre y ajustes (14/11, etapa 7: Gypi es el libro oficial; lo cargado a mano en el libro de Google)
      { id: "fin-devengamiento", label: "Devengamiento", modulo: "finanzas", soloDueno: true },
      { id: "fin-cierre", label: "Cierre de mes", modulo: "finanzas", soloDueno: true },
      { id: "fin-libro", label: "Libro de Google", modulo: "finanzas", soloDueno: true },
      { id: "fin-sos", label: "Importar S.O.S", modulo: "finanzas", soloDueno: true },
      { id: "fin-config", label: "Configuración", modulo: "finanzas", soloDueno: true },
      // Sin renglón en el menú (19/11): se abren desde Clientes (📋 Cuenta por
      // OT) y desde Agenda, Clientes o Proveedores (🔗 Cliente y proveedor).
      // Siguen acá para los enlaces y los avisos que llevan a ellas.
      { id: "fin-cuenta-ot", label: "Cuenta por OT", modulo: "finanzas", soloDueno: true, enMenu: false },
      { id: "fin-unificados", label: "Cliente y proveedor", modulo: "finanzas", soloDueno: true, enMenu: false },
    ],
  },
};

/** El ícono de cada opción (menú de la izquierda y tarjetas del Inicio de Finanzas). */
export const ICONO_GESTION = {
  vivo: "🟢", ot: "📋", reportes: "📊", panel: "📈", planificacion: "📅", minuta: "📝",
  stock: "📦", "inventario-valorizado": "💲", movimientos: "📥", compras: "🛒", flota: "🚚", maquinaria: "⚙️", "log-lugares": "📍", "fin-inicio": "🏠", "fin-movimientos": "📒", "fin-tesoreria": "💰", "fin-cuentas": "📒", "fin-sueldos": "👷", "fin-personas": "📇", "fin-pagos": "💸", "fin-cheques": "🏦", "fin-mayor": "📚", "fin-devengamiento": "📆", "fin-resultados": "📊", "fin-patrimonio": "⚖️", "fin-flujo": "💵", "fin-cxp": "🗂", "fin-reporte": "📑", "fin-informe-tesoreria": "🏧", "fin-cierre": "🔍", "fin-libro": "📗", "fin-config": "🧾", "fin-inversiones": "📈", "fin-cuenta-ot": "📋", "fin-unificados": "🔗", "fin-sos": "📄",
};

/** Pestañas de un botón para esta empresa: sin lo apagado, lo que pide el
 *  registro de tareas ni lo que es solo de gerencia (si no lo es el usuario). */
export function opcionesBoton(boton, empresa, usuario = null) {
  return (BOTONES_GESTION[boton]?.opciones || [])
    .filter((o) => (!o.conTareas || conRegistroTareas(empresa)) && !moduloApagado(empresa, o.modulo))
    .filter((o) => !o.soloGerencia || comoDueno(usuario))
    .filter((o) => !o.soloOficina || usuario?.rol === "gerencial" || usuario?.rol === "administrativo")
    .filter((o) => !o.soloDueno || usuario?.rol === "gerencial");
}

/** ¿Va el botón en la barra? Solo si la empresa tiene alguno de sus módulos
 *  (y, para los que son solo del Dueño, si el usuario es el Dueño). */
export function conBoton(boton, empresa, usuario = null) {
  return opcionesBoton(boton, empresa, usuario).some((o) => tieneModulo(empresa, o.modulo));
}

// Los enlaces viejos a "Planta" (?screen=planta, "planta:compras") van al botón nuevo
const PLANTA_A_BOTON = { vivo: "proyectos", ot: "proyectos", reportes: "proyectos", panel: "proyectos", instalaciones: "proyectos", minuta: "proyectos", stock: "inventario", movimientos: "inventario", compras: "inventario", flota: "mantenimiento", maquinaria: "mantenimiento" };

export function esSupervisor(usuario) {
  return usuario?.rol === "administrativo" && !!usuario?.solo_su_division;
}

/** Desde el 05/11 el Supervisor puede lo mismo que el Dueño (menos pagar el
 *  plan y nombrar Dueños o Supervisores). */
export function comoDueno(usuario) {
  return usuario?.rol === "gerencial" || esSupervisor(usuario);
}

// "Más" agrupado por tema (auditoría 01/11, PR 3): Personas, Cómo trabaja la
// planta (toda la configuración de producción en un solo lugar), Empresa y Tu
// cuenta. Permisos y Equipo abren su propia pantalla (pantalla). Sin el botón
// Producción, las OT quedan acá.
// conProyectos: solo si la empresa tiene las OT; soloGerencia: Dueño y
// supervisores; soloDueno: solo el dueño (el pago del plan).
// Accesos por persona (181): config = es configuración (quien no puede
// configurar la ve en solo lectura); soloConfigura: solo quien configura;
// soloTitular: solo el titular de la cuenta.
const SECCIONES = [
  { id: "equipo", pantalla: "equipo", grupo: "personas", icono: "👥", label: "Equipo y horarios", detalle: "Personas, turnos, calendario, reportes y documentos" },
  { id: "permisos", pantalla: "solicitudes", grupo: "personas", icono: "📨", label: "Permisos", detalle: "Vacaciones, faltas y avisos del personal", conPendientes: true },
  { id: "asistencia", grupo: "personas", icono: "⏱️", label: "Reglas de asistencia y permisos", detalle: "Tolerancia, bloqueos y tipos de permiso", config: true },
  { id: "proyectos", grupo: "planta", icono: "📋", label: "OT", detalle: "Órdenes de trabajo", soloSinProyectos: true },
  { id: "produccion", grupo: "planta", icono: "🏭", label: "Producción", detalle: "Divisiones, etapas, rutas, paradas, liberación, carga, defectos", config: true },
  { id: "planificacion", grupo: "planta", icono: "📅", label: "Planificación", detalle: "Tiempos, máquinas, feriados y capacidad", conProyectos: true, soloGerencia: true, config: true },
  { id: "planillas", grupo: "planta", icono: "🔗", label: "Planillas conectadas", detalle: "Plan de trabajo, MRP y scripts, todo en un lugar", conProyectos: true, config: true },
  { id: "admin", grupo: "empresa", icono: "🏢", label: "Datos y apariencia", detalle: "Nombre, logo, colores y resumen semanal", config: true },
  { id: "ubicaciones", grupo: "empresa", icono: "📍", label: "Ubicaciones y plantas", detalle: "Dónde se puede fichar", config: true },
  { id: "reglas", grupo: "empresa", icono: "💬", label: "Asistente", detalle: "Cómo responde el asistente al equipo", config: true },
  { id: "modulos", grupo: "empresa", icono: "🧩", label: "Módulos", detalle: "Prendé o apagá lo que usa la empresa", soloConfigura: true },
  // Accesos por persona (181): solo el titular de la cuenta
  { id: "accesos", grupo: "empresa", icono: "🔐", label: "Accesos", detalle: "Qué módulos ve cada persona y quién configura", soloTitular: true },
  // Finanzas salió de acá el 10/11: tiene su botón en la barra de abajo
  { id: "facturacion", grupo: "empresa", icono: "💳", label: "Plan y facturación", detalle: "Tu plan, pagos y comprobantes", soloDueno: true },
  { id: "privacidad", grupo: "cuenta", icono: "👤", label: "Mi cuenta y privacidad", detalle: "Tus datos y cerrar sesión" },
];

export const GRUPOS = [
  { id: "personas", titulo: "Personas" },
  { id: "planta", titulo: "Cómo trabaja la planta" },
  { id: "empresa", titulo: "Empresa" },
  { id: "cuenta", titulo: "Tu cuenta" },
];

/** Secciones visibles para esta empresa y este usuario, con su candado. */
export function seccionesMas({ empresa, usuario } = {}) {
  const proyectos = conBoton("proyectos", empresa);
  const configura = puedeConfigurar(empresa, usuario);
  return SECCIONES
    .filter((s) => !(s.soloSinProyectos && proyectos))
    .filter((s) => !(s.conProyectos && !proyectos))
    .filter((s) => !(s.soloGerencia && !comoDueno(usuario)))
    .filter((s) => !(s.soloDueno && usuario?.rol !== "gerencial"))
    .filter((s) => !(s.soloConfigura && !configura))
    .filter((s) => !(s.soloTitular && !esTitular(empresa)))
    .filter((s) => !seccionApagada(s.id, empresa))
    .map((s) => ({ ...s, bloqueado: seccionBloqueada(s.id, empresa), soloLectura: !!s.config && !configura }));
}

export function seccionPorId(id, opciones) {
  return seccionesMas(opciones).find((s) => s.id === id) || null;
}

/**
 * Destino de navegación "pantalla" o "pantalla:sección" (p. ej. "config:ubicaciones",
 * que usa la lista de primeros pasos para abrir la sección justa).
 */
export function partirDestino(destino) {
  const [pantalla, seccion = null] = String(destino || "home").split(":");
  if (pantalla === "planta") return { pantalla: PLANTA_A_BOTON[seccion] || "proyectos", seccion };
  return { pantalla, seccion };
}
