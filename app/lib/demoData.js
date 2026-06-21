import { hoyArg, lunesDeLaSemana } from "./dates";

const hoy = () => hoyArg();

const fechaRel = (dias) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return hoyArg(d);
};

const isoRel = (dias, h = 8, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const DIAGRAMA_FULL = {
  lun: { in: "07:00", out: "16:00" },
  mar: { in: "07:00", out: "16:00" },
  mie: { in: "07:00", out: "16:00" },
  jue: { in: "07:00", out: "16:00" },
  vie: { in: "07:00", out: "15:00" },
};

const DIAGRAMA_ADMIN = {
  lun: { in: "08:00", out: "17:00" },
  mar: { in: "08:00", out: "17:00" },
  mie: { in: "08:00", out: "17:00" },
  jue: { in: "08:00", out: "17:00" },
  vie: { in: "08:00", out: "16:00" },
};

const DIAGRAMA_TURNO_B = {
  lun: { in: "14:00", out: "22:00" },
  mar: { in: "14:00", out: "22:00" },
  mie: { in: "14:00", out: "22:00" },
  jue: { in: "14:00", out: "22:00" },
  vie: { in: "14:00", out: "22:00" },
  sab: { in: "08:00", out: "13:00" },
};

const EMPLEADOS = [
  { id: 1, legajo: 100001, nombre: "Carlos Méndez", apodo: "Méndez", email: "cmendez@demo.com", rol: "gerencial", area: "produccion", division: "metalurgica", diagrama: DIAGRAMA_ADMIN, activo: true, debe_cambiar_password: false, estado_activacion: "activo", created_at: "2025-01-15T10:00:00Z" },
  { id: 2, legajo: 100002, nombre: "Roberto Gutiérrez", apodo: "Roberto", email: "rgutierrez@demo.com", rol: "operativo", area: "produccion", division: "metalurgica", diagrama: DIAGRAMA_FULL, activo: true, debe_cambiar_password: false, estado_activacion: "activo", created_at: "2025-02-01T10:00:00Z" },
  { id: 3, legajo: 100003, nombre: "Juan Pérez", apodo: "Juancho", email: "jperez@demo.com", rol: "operativo", area: "produccion", division: "metalurgica", diagrama: DIAGRAMA_FULL, activo: true, debe_cambiar_password: false, estado_activacion: "activo", created_at: "2025-02-01T10:00:00Z" },
  { id: 4, legajo: 100004, nombre: "Martín López", apodo: "Martín", email: "mlopez@demo.com", rol: "operativo", area: "produccion", division: "instalaciones", diagrama: DIAGRAMA_FULL, activo: true, debe_cambiar_password: false, estado_activacion: "activo", created_at: "2025-03-01T10:00:00Z" },
  { id: 5, legajo: 100005, nombre: "Diego Fernández", apodo: "Diego", email: "dfernandez@demo.com", rol: "operativo", area: "produccion", division: "instalaciones", diagrama: DIAGRAMA_FULL, activo: true, debe_cambiar_password: false, estado_activacion: "activo", created_at: "2025-03-10T10:00:00Z" },
  { id: 6, legajo: 100006, nombre: "Lucas Ramírez", apodo: "Lucas", email: "lramirez@demo.com", rol: "operativo", area: "produccion", division: "metalurgica", diagrama: DIAGRAMA_TURNO_B, activo: true, debe_cambiar_password: false, estado_activacion: "activo", created_at: "2025-04-01T10:00:00Z" },
  { id: 7, legajo: 100007, nombre: "Facundo Torres", apodo: "Facu", email: "ftorres@demo.com", rol: "operativo", area: "produccion", division: "instalaciones", diagrama: DIAGRAMA_FULL, activo: true, debe_cambiar_password: false, estado_activacion: "activo", created_at: "2025-04-15T10:00:00Z" },
  { id: 8, legajo: 100008, nombre: "Nicolás Morales", apodo: "Nico", email: "nmorales@demo.com", rol: "operativo", area: "produccion", division: "metalurgica", diagrama: DIAGRAMA_FULL, activo: true, debe_cambiar_password: false, estado_activacion: "activo", created_at: "2025-05-01T10:00:00Z" },
  { id: 9, legajo: 100009, nombre: "Alejandro Ruiz", apodo: "Ale", email: "aruiz@demo.com", rol: "operativo", area: "logistica", division: "logistica", diagrama: DIAGRAMA_FULL, activo: true, debe_cambiar_password: false, estado_activacion: "activo", created_at: "2025-05-10T10:00:00Z" },
  { id: 10, legajo: 100010, nombre: "Sebastián Herrera", apodo: "Seba", email: "sherrera@demo.com", rol: "administrativo", area: "administracion", division: "admin", diagrama: DIAGRAMA_ADMIN, activo: true, debe_cambiar_password: false, estado_activacion: "activo", created_at: "2025-01-20T10:00:00Z" },
  { id: 11, legajo: 100011, nombre: "Pablo Acosta", apodo: "Pablo", email: "pacosta@demo.com", rol: "operativo", area: "produccion", division: "metalurgica", diagrama: DIAGRAMA_FULL, activo: true, debe_cambiar_password: false, estado_activacion: "activo", created_at: "2025-06-01T10:00:00Z" },
  { id: 12, legajo: 100012, nombre: "Emiliano Vega", apodo: "Emi", email: "evega@demo.com", rol: "operativo", area: "produccion", division: "instalaciones", diagrama: DIAGRAMA_FULL, activo: true, debe_cambiar_password: false, estado_activacion: "activo", created_at: "2025-06-01T10:00:00Z" },
];

function generarFichadasHoy() {
  const t = hoy();
  return [
    { legajo: 100002, ingreso: "06:58", egreso: "15:55", horas_trabajadas: "8.9", llegada_tarde: false, minutos_tarde: 0, nombre: "Roberto Gutiérrez", division: "metalurgica" },
    { legajo: 100003, ingreso: "07:12", egreso: null, horas_trabajadas: null, llegada_tarde: true, minutos_tarde: 12, nombre: "Juan Pérez", division: "metalurgica" },
    { legajo: 100004, ingreso: "06:55", egreso: null, horas_trabajadas: null, llegada_tarde: false, minutos_tarde: 0, nombre: "Martín López", division: "instalaciones" },
    { legajo: 100005, ingreso: "07:03", egreso: null, horas_trabajadas: null, llegada_tarde: false, minutos_tarde: 0, nombre: "Diego Fernández", division: "instalaciones" },
    { legajo: 100008, ingreso: "07:01", egreso: null, horas_trabajadas: null, llegada_tarde: false, minutos_tarde: 0, nombre: "Nicolás Morales", division: "metalurgica" },
    { legajo: 100009, ingreso: "07:08", egreso: null, horas_trabajadas: null, llegada_tarde: false, minutos_tarde: 0, nombre: "Alejandro Ruiz", division: "logistica" },
    { legajo: 100010, ingreso: "08:02", egreso: null, horas_trabajadas: null, llegada_tarde: false, minutos_tarde: 0, nombre: "Sebastián Herrera", division: "admin" },
    { legajo: 100011, ingreso: "07:00", egreso: null, horas_trabajadas: null, llegada_tarde: false, minutos_tarde: 0, nombre: "Pablo Acosta", division: "metalurgica" },
    { legajo: 100007, ingreso: "07:22", egreso: null, horas_trabajadas: null, llegada_tarde: true, minutos_tarde: 22, nombre: "Facundo Torres", division: "instalaciones" },
    { legajo: 100012, ingreso: "06:50", egreso: null, horas_trabajadas: null, llegada_tarde: false, minutos_tarde: 0, nombre: "Emiliano Vega", division: "instalaciones" },
    { legajo: 100001, ingreso: "07:55", egreso: null, horas_trabajadas: null, llegada_tarde: false, minutos_tarde: 0, nombre: "Carlos Méndez", division: "metalurgica" },
  ];
}

function generarFichadasSemanaUsuario(legajo) {
  const dias = [];
  const now = new Date();
  const monday = new Date(lunesDeLaSemana(0) + "T12:00:00");

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    if (d > now) break;
    const dStr = hoyArg(d);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;

    const tarde = Math.random() < 0.15;
    const minTarde = tarde ? Math.floor(Math.random() * 25) + 5 : 0;
    const hBase = 7 + (tarde ? Math.floor(minTarde / 60) : 0);
    const mBase = tarde ? minTarde % 60 : Math.floor(Math.random() * 5);
    const ingreso = `${String(hBase).padStart(2, "0")}:${String(mBase).padStart(2, "0")}`;

    const esHoy = dStr === hoy();
    const egreso = esHoy ? null : `${dow === 5 ? "15" : "16"}:${String(Math.floor(Math.random() * 15)).padStart(2, "0")}`;
    const horas = esHoy ? null : (dow === 5 ? 7.5 + Math.random() * 1 : 8.5 + Math.random() * 1).toFixed(1);

    dias.push({
      fecha: dStr,
      ingreso,
      egreso,
      horas_trabajadas: horas,
      llegada_tarde: tarde,
      minutos_tarde: minTarde,
    });
  }
  return dias;
}

function generarFichadasSemanaGlobal() {
  const result = [];
  const now = new Date();
  const monday = new Date(lunesDeLaSemana(0) + "T12:00:00");

  for (const emp of EMPLEADOS) {
    if (emp.rol === "gerencial" || emp.rol === "administrativo") continue;
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      if (d > now) break;
      const dStr = hoyArg(d);
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue;
      if (Math.random() < 0.05) continue;

      const tarde = Math.random() < 0.12;
      const minTarde = tarde ? Math.floor(Math.random() * 30) + 3 : 0;
      const ingreso = `07:${String(Math.floor(Math.random() * (tarde ? 25 : 8))).padStart(2, "0")}`;
      const esHoy = dStr === hoy();
      const egreso = esHoy ? null : `${dow === 5 ? "15" : "16"}:${String(Math.floor(Math.random() * 20)).padStart(2, "0")}`;
      const horas = esHoy ? null : (dow === 5 ? 7 + Math.random() * 1.5 : 8 + Math.random() * 1.5).toFixed(1);

      result.push({
        legajo: emp.legajo,
        fecha: dStr,
        ingreso,
        egreso,
        horas_trabajadas: horas,
        llegada_tarde: tarde,
        minutos_tarde: minTarde,
        empleados: { nombre: emp.nombre, division: emp.division },
      });
    }
  }
  return result;
}

function generarFichadasMes() {
  const result = [];
  const now = new Date();
  const [_y, _m] = hoyArg().split("-").map(Number);
  const mesInicio = new Date(_y, _m - 1, 1);

  for (const emp of EMPLEADOS) {
    if (emp.rol === "gerencial" || emp.rol === "administrativo") continue;
    const d = new Date(mesInicio);
    while (d <= now) {
      const dow = d.getDay();
      const dStr = hoyArg(d);
      if (dow !== 0 && dow !== 6 && Math.random() > 0.06) {
        const tarde = Math.random() < 0.1;
        result.push({
          empleado_id: emp.id,
          legajo: emp.legajo,
          fecha: dStr,
          horas_trabajadas: (dow === 5 ? 7 + Math.random() * 1.5 : 8 + Math.random() * 1.5).toFixed(1),
          llegada_tarde: tarde,
          minutos_tarde: tarde ? Math.floor(Math.random() * 35) + 3 : 0,
        });
      }
      d.setDate(d.getDate() + 1);
    }
  }
  return result;
}

function generarResumenProd() {
  const operativos = EMPLEADOS.filter(e => e.rol === "operativo");
  return operativos.map(emp => {
    const minProd = Math.floor(Math.random() * 200) + 180;
    const minEspera = Math.floor(Math.random() * 60) + 10;
    const etapas = [null, 0, 1, 2, 3, 4, 5];
    const etapa = etapas[Math.floor(Math.random() * etapas.length)];
    return {
      legajo: emp.legajo,
      nombre: emp.nombre,
      division: emp.division,
      fecha: hoy(),
      etapa_actual: etapa,
      minutos_productivos: minProd.toString(),
      minutos_espera: minEspera.toString(),
      pct_productivo: Math.round(minProd * 100 / (minProd + minEspera)).toString(),
    };
  });
}

function generarSolicitudes() {
  const tipos = ["permiso", "vacaciones", "ausencia", "horas_extra", "cambio_turno"];
  const estados = ["pendiente", "aprobado", "rechazado"];
  const motivos = {
    permiso: ["Turno médico", "Trámite personal", "Mudanza", "Acompañar familiar al médico", "Reunión escolar del hijo"],
    vacaciones: ["Vacaciones de invierno — 5 días", "Vacaciones pendientes — 3 días", "Día de descanso compensatorio"],
    ausencia: ["Enfermedad — certificado médico", "Problema familiar", "Duelo familiar — 2 días"],
    horas_extra: ["Entrega urgente OT-2847", "Cierre de obra Parque Industrial", "Producción extra por pedido cliente"],
    cambio_turno: ["Cambio de turno con López por tema personal", "Solicito pasar a turno mañana"],
  };

  const sols = [];
  const empOps = EMPLEADOS.filter(e => e.rol === "operativo");

  for (let i = 0; i < 12; i++) {
    const emp = empOps[Math.floor(Math.random() * empOps.length)];
    const tipo = tipos[Math.floor(Math.random() * tipos.length)];
    const estado = i < 3 ? "pendiente" : estados[Math.floor(Math.random() * 3)];
    const diasAtras = Math.floor(Math.random() * 14);

    sols.push({
      id: 1000 + i,
      tipo,
      estado,
      motivo: motivos[tipo][Math.floor(Math.random() * motivos[tipo].length)],
      legajo: emp.legajo,
      empleado_id: emp.id,
      nombre_empleado: emp.nombre,
      apodo_empleado: emp.apodo,
      division: emp.division,
      created_at: isoRel(-diasAtras, 8 + Math.floor(Math.random() * 8), Math.floor(Math.random() * 60)),
      fecha_desde: fechaRel(-diasAtras + 1),
      fecha_hasta: fechaRel(-diasAtras + 1 + Math.floor(Math.random() * 3)),
      respuesta: estado === "aprobado" ? "Aprobado por gerencia" : estado === "rechazado" ? "No corresponde en esta fecha" : null,
    });
  }

  return sols.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function generarSolsAprobadas() {
  const result = [];
  const empOps = EMPLEADOS.filter(e => e.rol === "operativo");

  for (let i = 0; i < 8; i++) {
    const emp = empOps[Math.floor(Math.random() * empOps.length)];
    const tipos = ["permiso", "vacaciones", "ausencia"];
    result.push({
      empleado_id: emp.id,
      legajo: emp.legajo,
      tipo: tipos[Math.floor(Math.random() * tipos.length)],
      estado: "aprobado",
      created_at: isoRel(-Math.floor(Math.random() * 12), 9, 0),
    });
  }
  return result;
}

function generarReportesObra() {
  const instaladores = EMPLEADOS.filter(e => e.division === "instalaciones");
  return instaladores.slice(0, 3).map((emp, i) => ({
    id: 2000 + i,
    legajo: emp.legajo,
    nombre: emp.nombre,
    fecha: hoy(),
    progreso: [
      "Instalación de 4 módulos de rack completos en nave B. Se avanzó con cableado eléctrico del sector norte.",
      "Montaje de estructura metálica en planta alta finalizado. Se realizaron las soldaduras perimetrales.",
      "Armado de tablero eléctrico principal y tendido de bandejas porta-cables. Falta conexión final.",
    ][i],
    faltantes: i === 0 ? ["Tornillos M12x50 (24u)", "Grampas de cable tipo U"] : i === 2 ? ["Termomagnética 32A"] : [],
    desvios: i === 1 ? ["Columna C4 desplomada 3cm — requiere calce"] : [],
    fotos_urls: [],
    fotos: i === 0 ? 3 : i === 1 ? 2 : 1,
    created_at: isoRel(0, 10 + i * 2, 30),
  }));
}

function generarNotificaciones() {
  return [
    { id: 5001, tipo: "alerta", asunto: "Torres BLOQUEADO — sin fichaje", detalle: "Facundo Torres lleva 22 min de tardanza sin fichar ingreso.", urgencia: "alta", created_at: isoRel(0, 7, 25), destinatario_rol: "gerencial", solicitud_id: null },
    { id: 5002, tipo: "solicitud", asunto: "Nueva solicitud de permiso", detalle: "Juan Pérez solicita permiso para el día de mañana por turno médico.", urgencia: "normal", created_at: isoRel(0, 8, 10), destinatario_rol: "gerencial", solicitud_id: 1000 },
    { id: 5003, tipo: "produccion", asunto: "Lucas Ramírez en espera >30min", detalle: "El operario lleva 35 minutos sin registrar tarea productiva.", urgencia: "media", created_at: isoRel(0, 10, 45), destinatario_rol: "gerencial", solicitud_id: null },
    { id: 5004, tipo: "reporte", asunto: "Reporte de obra — faltante de material", detalle: "Martín López reportó faltantes en la obra de Parque Industrial.", urgencia: "normal", created_at: isoRel(0, 11, 0), destinatario_rol: "gerencial", solicitud_id: null },
    { id: 5005, tipo: "aprobacion", asunto: "Permiso APROBADO", detalle: "Tu solicitud de permiso para el viernes fue aprobada por gerencia.", urgencia: "normal", created_at: isoRel(0, 9, 0), destinatario_rol: "100003" },
  ];
}

function generarActividadesHoy() {
  const ahora = new Date();
  const base = new Date(ahora);
  base.setHours(7, 0, 0, 0);

  return [
    { id: 3001, etapa: 1, duracion_min: 45, hora_inicio: new Date(base.getTime()).toISOString(), codigo_proyecto: "OT-2841" },
    { id: 3002, etapa: 0, duracion_min: 15, hora_inicio: new Date(base.getTime() + 45 * 60000).toISOString(), codigo_proyecto: null },
    { id: 3003, etapa: 2, duracion_min: 90, hora_inicio: new Date(base.getTime() + 60 * 60000).toISOString(), codigo_proyecto: "OT-2841" },
    { id: 3004, etapa: 0, duracion_min: 10, hora_inicio: new Date(base.getTime() + 150 * 60000).toISOString(), codigo_proyecto: null },
    { id: 3005, etapa: 3, duracion_min: 120, hora_inicio: new Date(base.getTime() + 160 * 60000).toISOString(), codigo_proyecto: "OT-2847" },
    { id: 3006, etapa: 1, duracion_min: 60, hora_inicio: new Date(base.getTime() + 280 * 60000).toISOString(), codigo_proyecto: "OT-2850" },
  ];
}

function generarHistorialFichajes(legajo) {
  const result = [];
  const now = new Date();
  const [y, mIdx1, diaHoy] = hoyArg().split("-").map(Number);
  const m = mIdx1 - 1;

  for (let day = 1; day <= diaHoy; day++) {
    const d = new Date(y, m, day);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    if (Math.random() < 0.05) continue;

    const dStr = hoyArg(d);
    const tarde = Math.random() < 0.12;
    const minTarde = tarde ? Math.floor(Math.random() * 35) + 3 : 0;
    const esHoy = day === diaHoy;

    result.push({
      id: 4000 + day,
      legajo,
      fecha: dStr,
      ingreso: `07:${String(tarde ? minTarde : Math.floor(Math.random() * 5)).padStart(2, "0")}`,
      egreso: esHoy ? null : `${dow === 5 ? "15" : "16"}:${String(Math.floor(Math.random() * 15)).padStart(2, "0")}`,
      horas_trabajadas: esHoy ? null : (dow === 5 ? 7 + Math.random() * 1.5 : 8 + Math.random() * 1.5).toFixed(1),
      llegada_tarde: tarde,
      minutos_tarde: minTarde,
    });
  }
  return result.sort((a, b) => b.fecha.localeCompare(a.fecha));
}

export function getDemoCtx(usuario) {
  const solicitudes = generarSolicitudes();
  const misSolicitudes = solicitudes.filter(s => s.legajo === usuario.legajo).slice(0, 4);

  if (misSolicitudes.length === 0) {
    misSolicitudes.push({
      id: 1099, tipo: "permiso", estado: "aprobado",
      motivo: "Turno médico — otorrinolaringólogo",
      legajo: usuario.legajo, empleado_id: usuario.id,
      nombre_empleado: usuario.nombre, apodo_empleado: usuario.apodo,
      division: usuario.division,
      created_at: isoRel(-3, 8, 15),
      fecha_desde: fechaRel(-2), fecha_hasta: fechaRel(-2),
      respuesta: "Aprobado — presentar certificado",
    });
  }

  const notificaciones = generarNotificaciones().filter(n => {
    if (usuario.rol === "gerencial" || usuario.rol === "administrativo") return n.destinatario_rol === "gerencial";
    return n.destinatario_rol === String(usuario.legajo);
  });

  return {
    empleados: EMPLEADOS,
    fichadasHoy: generarFichadasHoy(),
    fichadaHoy: { ingreso: "07:02", egreso: null, horas_trabajadas: null, llegada_tarde: false, minutos_tarde: 0, fecha: hoy() },
    fichadasSemana: generarFichadasSemanaUsuario(usuario.legajo),
    solicitudes,
    misSolicitudes,
    reglas: [
      "El horario de ingreso tiene tolerancia de 5 minutos. A partir del minuto 6, se registra tardanza.",
      "Tres tardanzas en el mes implican descuento de presentismo.",
      "Los permisos deben solicitarse con 24hs de anticipación salvo urgencia.",
      "Las horas extra deben ser autorizadas previamente por gerencia.",
      "El fichaje de egreso debe realizarse antes de retirarse del establecimiento.",
    ],
    reglasRaw: [
      { id: 1, regla: "El horario de ingreso tiene tolerancia de 5 minutos." },
      { id: 2, regla: "Tres tardanzas en el mes implican descuento de presentismo." },
    ],
    notificaciones,
  };
}

export function getDemoDashboardData() {
  return {
    resumenProd: generarResumenProd(),
    fichadasSemana: generarFichadasSemanaGlobal(),
    fichadasMes: generarFichadasMes(),
    solsAprobadas: generarSolsAprobadas(),
    reportesObra: generarReportesObra(),
  };
}

export function getDemoActividades() {
  return {
    actividadesHoy: generarActividadesHoy(),
    tareaActiva: {
      etapa: 1,
      hora_inicio: new Date(new Date().setHours(new Date().getHours() - 1, 0, 0)).toISOString(),
      codigo_proyecto: "OT-2850",
    },
  };
}

export function getDemoHistorialFichajes(legajo) {
  return generarHistorialFichajes(legajo);
}

export const DEMO_USUARIO_GER = EMPLEADOS[0];
export const DEMO_USUARIO_OP = EMPLEADOS[2];
export const DEMO_ETAPAS = [
  { id: 1, nombre: "Corte y preparación", icon: "✂️", codigo: 1, color: "#4f8cff" },
  { id: 2, nombre: "Soldadura", icon: "🔥", codigo: 2, color: "#F59E0B" },
  { id: 3, nombre: "Montaje", icon: "🔧", codigo: 3, color: "#10B981" },
  { id: 4, nombre: "Pintura", icon: "🎨", codigo: 4, color: "#8B5CF6" },
  { id: 5, nombre: "Control de calidad", icon: "✅", codigo: 5, color: "#06B6D4" },
];
