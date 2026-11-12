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
      { id: "vivo", label: "En vivo", modulo: "actividad", conTareas: true },
      { id: "ot", label: "OT", modulo: "proyectos" },
      { id: "reportes", label: "Reportes", modulo: "actividad" },
      // Auditoría 12/11 (parte 13): las instalaciones con lugar propio, abre
      // directo el 🔧 Gantt de instalación (antes estaba escondido dentro de OT)
      { id: "instalaciones", label: "Instalaciones", modulo: "proyectos" },
      // Planificación de la producción (parte 38): la arman el Dueño y los supervisores
      { id: "planificacion", label: "Planificación", modulo: "proyectos", soloGerencia: true },
      // Minuta de la reunión de Buenos Días (Minuta, parte M1, 150): Dueño y supervisores
      { id: "minuta", label: "Minuta", modulo: "minutas", soloGerencia: true },
    ],
  },
  inventario: {
    label: "Materiales",
    detalle: "Stock y compras",
    opciones: [
      { id: "stock", label: "Stock", modulo: "stock" },
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
  // Finanzas (F1, 171): solo el rol Dueño, ni el Supervisor (pedido 09/11).
  // Desde el 10/11 va en la barra de abajo del celular como un módulo más.
  finanzas: {
    label: "Finanzas",
    detalle: "Cuentas, cajas, bancos y movimientos",
    opciones: [
      // Parte 10 del 11/11: Inicio primero y el resto por tema (finanzasInicio.js)
      { id: "fin-inicio", label: "Inicio", modulo: "finanzas", soloDueno: true },
      { id: "fin-movimientos", label: "Movimientos", modulo: "finanzas", soloDueno: true },
      { id: "fin-tesoreria", label: "Cajas y bancos", modulo: "finanzas", soloDueno: true },
      { id: "fin-pagos", label: "Pagos", modulo: "finanzas", soloDueno: true },
      { id: "fin-cheques", label: "Cheques", modulo: "finanzas", soloDueno: true },
      { id: "fin-proveedores", label: "Proveedores", modulo: "finanzas", soloDueno: true },
      { id: "fin-clientes", label: "Clientes", modulo: "finanzas", soloDueno: true },
      { id: "fin-sueldos", label: "Sueldos", modulo: "finanzas", soloDueno: true },
      { id: "fin-personas", label: "Personas", modulo: "finanzas", soloDueno: true },
      { id: "fin-resultados", label: "Resultados", modulo: "finanzas", soloDueno: true },
      { id: "fin-flujo", label: "Flujo de caja", modulo: "finanzas", soloDueno: true },
      { id: "fin-reporte", label: "Reporte financiero", modulo: "finanzas", soloDueno: true },
      { id: "fin-cierre", label: "Cierre", modulo: "finanzas", soloDueno: true },
      { id: "fin-config", label: "Configuración", modulo: "finanzas", soloDueno: true },
    ],
  },
};

/** El ícono de cada opción (menú de la izquierda y tarjetas del Inicio de Finanzas). */
export const ICONO_GESTION = {
  vivo: "🟢", ot: "📋", reportes: "📊", instalaciones: "🔧", planificacion: "📅", minuta: "📝",
  stock: "📦", compras: "🛒", flota: "🚚", maquinaria: "⚙️", "fin-inicio": "🏠", "fin-movimientos": "📒", "fin-tesoreria": "💰", "fin-clientes": "👥", "fin-sueldos": "👷", "fin-proveedores": "🏭", "fin-personas": "📇", "fin-pagos": "💸", "fin-cheques": "🏦", "fin-resultados": "📊", "fin-flujo": "💵", "fin-reporte": "📑", "fin-cierre": "🔍", "fin-config": "🧾",
};

/** Pestañas de un botón para esta empresa: sin lo apagado, lo que pide el
 *  registro de tareas ni lo que es solo de gerencia (si no lo es el usuario). */
export function opcionesBoton(boton, empresa, usuario = null) {
  return (BOTONES_GESTION[boton]?.opciones || [])
    .filter((o) => (!o.conTareas || conRegistroTareas(empresa)) && !moduloApagado(empresa, o.modulo))
    .filter((o) => !o.soloGerencia || comoDueno(usuario))
    .filter((o) => !o.soloDueno || usuario?.rol === "gerencial");
}

/** ¿Va el botón en la barra? Solo si la empresa tiene alguno de sus módulos
 *  (y, para los que son solo del Dueño, si el usuario es el Dueño). */
export function conBoton(boton, empresa, usuario = null) {
  return opcionesBoton(boton, empresa, usuario).some((o) => tieneModulo(empresa, o.modulo));
}

// Los enlaces viejos a "Planta" (?screen=planta, "planta:compras") van al botón nuevo
const PLANTA_A_BOTON = { vivo: "proyectos", ot: "proyectos", reportes: "proyectos", instalaciones: "proyectos", minuta: "proyectos", stock: "inventario", compras: "inventario", flota: "mantenimiento", maquinaria: "mantenimiento" };

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
