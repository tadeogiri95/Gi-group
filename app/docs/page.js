"use client";
import { useState } from "react";
import { PLANES } from "../lib/plans";

const S = {
  wrap: { maxWidth: 760, margin: "0 auto", padding: "40px 20px 80px", fontFamily: "'Geist', system-ui", color: "#F5F0E8", background: "#0C0A09", minHeight: "100vh", lineHeight: 1.7 },
  header: { marginBottom: 48 },
  logo: { fontSize: 22, fontWeight: 800, color: "#F97316", fontFamily: "'Bricolage Grotesque', system-ui", marginBottom: 8 },
  headline: { fontSize: 32, fontWeight: 800, fontFamily: "'Bricolage Grotesque', system-ui", lineHeight: 1.2, marginBottom: 12 },
  sub: { fontSize: 16, color: "#8A7F75", maxWidth: 520 },
  nav: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 48 },
  navBtn: (active) => ({
    padding: "8px 16px", borderRadius: 10, border: "1px solid",
    borderColor: active ? "#F97316" : "#2A2520",
    background: active ? "rgba(249,115,22,0.1)" : "transparent",
    color: active ? "#F97316" : "#8A7F75",
    fontSize: 13, fontWeight: 600, cursor: "pointer",
  }),
  section: { marginBottom: 56 },
  h2: { fontSize: 22, fontWeight: 700, marginBottom: 16, fontFamily: "'Bricolage Grotesque', system-ui", display: "flex", alignItems: "center", gap: 10 },
  h3: { fontSize: 16, fontWeight: 700, marginBottom: 8, color: "#F5F0E8" },
  p: { fontSize: 14, color: "#8A7F75", marginBottom: 14, lineHeight: 1.7 },
  step: { display: "flex", gap: 16, marginBottom: 20, alignItems: "flex-start" },
  stepNum: { minWidth: 32, height: 32, borderRadius: 8, background: "rgba(249,115,22,0.15)", color: "#F97316", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" },
  card: { background: "#131110", border: "1px solid #2A2520", borderRadius: 14, padding: "20px 24px", marginBottom: 14 },
  badge: (color) => ({ display: "inline-block", padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, background: `${color}22`, color }),
  code: { fontFamily: "monospace", fontSize: 13, background: "#1E1A16", border: "1px solid #2A2520", borderRadius: 6, padding: "2px 8px", color: "#F97316" },
  codeBlock: { fontFamily: "monospace", fontSize: 13, background: "#1E1A16", border: "1px solid #2A2520", borderRadius: 10, padding: "16px 20px", color: "#A39A8E", marginBottom: 14, overflowX: "auto", lineHeight: 1.6 },
  faq: { borderBottom: "1px solid #1E1A16", paddingBottom: 16, marginBottom: 16 },
  faqQ: { fontSize: 15, fontWeight: 600, color: "#F5F0E8", marginBottom: 6, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" },
  faqA: { fontSize: 14, color: "#8A7F75", lineHeight: 1.7 },
  backLink: { fontSize: 13, color: "#F97316", textDecoration: "none", display: "inline-block", marginBottom: 32 },
  planTag: (p) => {
    const map = { free: "#8A7F75", starter: "#3B82F6", pro: "#F97316", enterprise: "#8B5CF6" };
    return { display: "inline-block", padding: "2px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: `${map[p]}22`, color: map[p], marginLeft: 6 };
  },
  table: { width: "100%", borderCollapse: "collapse", marginTop: 4 },
  th: { fontSize: 13, fontWeight: 700, color: "#F5F0E8", textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #2A2520" },
  td: { fontSize: 14, color: "#8A7F75", padding: "10px 14px", borderBottom: "1px solid #2A2520", lineHeight: 1.7 },
};

const SECTIONS = ["Inicio rápido", "Fichaje", "Actividades", "Gestión", "FAQs", "Planes"];

const PLAN_IDS = ["free", "starter", "pro", "enterprise"];

const PLAN_META = {
  free: { color: "#8A7F75", desc: "Para equipos pequeños que están empezando." },
  starter: { color: "#3B82F6", desc: "Para empresas en crecimiento." },
  pro: { color: "#F97316", desc: "Para operaciones industriales completas." },
  enterprise: { color: "#8B5CF6", desc: "Para grupos con múltiples empresas." },
};

const MODULO_LABELS = {
  fichaje: "Fichaje de asistencia",
  chat: "Chat interno",
  actividad: "Registro de actividades",
  proyectos: "Proyectos y etapas",
  reportes: "Reportes",
  obra: "Reportes de obra",
  calendario: "Calendario de turnos",
};

function formatPrecioPlan(p) {
  if (p.precio == null) return "A consultar";
  if (p.precio === 0) return "Sin costo";
  return "$" + p.precio.toLocaleString("es-AR") + " / mes";
}

function featuresDePlan(p) {
  const f = [p.max_empleados >= 99999 ? "Empleados ilimitados" : `Hasta ${p.max_empleados} empleados`];
  p.modulos.forEach((m) => { if (MODULO_LABELS[m]) f.push(MODULO_LABELS[m]); });
  if (p.geolocalizacion) f.push("Geolocalización y geofence");
  if (p.exportar_csv) f.push("Exportación CSV");
  if (p.exportar_pdf) f.push("Exportación PDF");
  if (p.reportes_avanzados) f.push("Reportes avanzados");
  if (p.reglas_bot) f.push("Reglas personalizadas del bot");
  if (p.api_access) f.push("Acceso a API");
  if (p.soporte === "sla") f.push("Soporte con SLA");
  else if (p.soporte === "prioritario") f.push("Soporte prioritario");
  else if (p.soporte === "email") f.push("Soporte por email");
  return f;
}

const FAQS = [
  {
    q: "¿Cómo registro una empresa nueva?",
    a: "Desde la landing de gypi.app, hacé clic en «Probar gratis». Completá el nombre, slug y email del administrador. Recibirás un email de bienvenida con el link de acceso.",
  },
  {
    q: "¿Cómo invito empleados?",
    a: "Desde Gestión → Personal → Agregar empleado. Definí legajo, nombre y contraseña inicial. El empleado ingresa con su legajo y contraseña desde gypi.app/[slug-empresa].",
  },
  {
    q: "¿Puedo cambiar el slug de mi empresa?",
    a: "El slug es permanente una vez creado. Si necesitás cambiarlo, contactá a soporte. Todos los links compartidos dejarán de funcionar.",
  },
  {
    q: "¿Los datos se pueden exportar?",
    a: "Sí. En planes Pro y Enterprise podés exportar fichadas y actividades en CSV desde la sección Reportes. También podés solicitar exportación completa a contacto@gypi.app.",
  },
  {
    q: "¿Qué pasa si cancelo mi suscripción?",
    a: "Tu cuenta pasa al plan Free automáticamente. Los datos se conservan por 30 días adicionales, durante los cuales podés solicitar exportación completa. Luego se eliminan.",
  },
  {
    q: "¿La app funciona sin conexión?",
    a: "Parcialmente. Como PWA, podés instalarla en el dispositivo. Algunas pantallas cachean datos recientes. El fichaje y envío de reportes requieren conexión en el momento.",
  },
  {
    q: "¿Cómo funciona el fichaje por geolocalización?",
    a: "En Configuración → Empleados, activá «Geofence» para el empleado y definí la zona (radio en metros alrededor de una dirección). Al fichar, la app verifica que el GPS esté dentro del área.",
  },
  {
    q: "¿Puedo integrar Gypi con mi sistema de RRHH?",
    a: "Actualmente no hay integración nativa. El plan Enterprise incluye soporte prioritario para discutir integraciones a medida. Consultá en contacto@gypi.app.",
  },
];

function FAQ({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={S.faq}>
      <div style={S.faqQ} onClick={() => setOpen(!open)}>
        <span>{q}</span>
        <span style={{ color: "#F97316", fontSize: 18 }}>{open ? "−" : "+"}</span>
      </div>
      {open && <div style={S.faqA}>{a}</div>}
    </div>
  );
}

export default function DocsPage() {
  const [tab, setTab] = useState("Inicio rápido");

  return (
    <div style={S.wrap}>
      <a href="/" style={S.backLink}>← Volver a Gypi</a>

      <div style={S.header}>
        <div style={S.logo}>Gypi</div>
        <h1 style={S.headline}>Documentación</h1>
        <p style={S.sub}>Guías, configuración y preguntas frecuentes para equipos industriales.</p>
      </div>

      <nav style={S.nav}>
        {SECTIONS.map(s => (
          <button key={s} style={S.navBtn(tab === s)} onClick={() => setTab(s)}>{s}</button>
        ))}
      </nav>

      {/* ─── INICIO RÁPIDO ─── */}
      {tab === "Inicio rápido" && (
        <div style={S.section}>
          <h2 style={S.h2}>🚀 Inicio rápido</h2>
          <p style={S.p}>Desde que te registrás hasta que tu equipo empieza a fichar: menos de 10 minutos.</p>

          {[
            { n: 1, title: "Registrá tu empresa", body: <>Entrá a <a href="/" style={{ color: "#F97316" }}>gypi.app</a>, hacé clic en <strong>Probar gratis</strong> y completá el formulario. Elegí un slug único (ej: <span style={S.code}>mi-empresa</span>) — será la URL de acceso de tus empleados.</> },
            { n: 2, title: "Completá el onboarding", body: "Al entrar por primera vez como gerente verás el asistente de configuración. En 3 pasos: definí divisiones de trabajo, etapas de producción y el horario de tu equipo." },
            { n: 3, title: "Agregá empleados", body: <>Desde <strong>Gestión → Personal → + Empleado</strong>. Necesitás: legajo (número único), nombre y contraseña inicial. Podés cargar decenas a la vez desde el panel.</> },
            { n: 4, title: "Compartí la URL", body: <>Informale a tu equipo la URL de acceso: <span style={S.code}>gypi.app/[tu-slug]</span>. Ingresan con legajo y contraseña desde cualquier celular, sin instalar nada.</> },
            { n: 5, title: "¡Listo!", body: "Tu equipo ya puede fichar, registrar actividades y enviarte reportes en tiempo real. Vos los ves en el Dashboard de gerencia." },
          ].map(({ n, title, body }) => (
            <div key={n} style={S.step}>
              <div style={S.stepNum}>{n}</div>
              <div>
                <div style={S.h3}>{title}</div>
                <div style={{ ...S.p, marginBottom: 0 }}>{body}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── FICHAJE ─── */}
      {tab === "Fichaje" && (
        <div style={S.section}>
          <h2 style={S.h2}>🕐 Fichaje de asistencia</h2>

          <div style={S.card}>
            <div style={S.h3}>Fichaje básico</div>
            <p style={S.p}>El empleado entra a la app, toca <strong>Fichar</strong> y confirma. El sistema registra la hora de ingreso. Al salir, toca nuevamente para marcar el egreso y calcula las horas trabajadas automáticamente.</p>
          </div>

          <div style={S.card}>
            <div style={S.h3}>Fichaje por geolocalización <span style={S.planTag("pro")}>Pro</span></div>
            <p style={S.p}>Activá el geofence por empleado en <strong>Gestión → Empleado → Configurar ubicación</strong>. Definí la dirección y el radio permitido (50–500 m). Si el empleado intenta fichar fuera del área, recibe un aviso pero puede igualmente fichar (queda registrado el desvío).</p>
          </div>

          <div style={S.card}>
            <div style={S.h3}>Fichaje automático</div>
            <p style={S.p}>El sistema lanza un cron diario a las 3 AM (UTC) que verifica empleados con horario configurado y que aún no ficharon. Se registra una entrada automática según el diagrama semanal del empleado.</p>
          </div>

          <div style={S.card}>
            <div style={S.h3}>Dashboard de asistencia</div>
            <p style={S.p}>El gerente ve en tiempo real quién está fichado, llegadas tarde, horas de la semana y puede revisar el historial completo por empleado filtrando por fecha.</p>
          </div>
        </div>
      )}

      {/* ─── ACTIVIDADES ─── */}
      {tab === "Actividades" && (
        <div style={S.section}>
          <h2 style={S.h2}>⚡ Registro de actividades</h2>
          <p style={S.p}>El módulo de actividades permite que cada operario registre en qué tarea estuvo trabajando y cuánto tiempo le dedicó.</p>

          <div style={S.card}>
            <div style={S.h3}>Cómo usar el módulo</div>
            {[
              "El operario abre la pantalla «Mi jornada».",
              "Selecciona el proyecto y la etapa de producción.",
              "Toca «Iniciar» — comienza el cronómetro.",
              "Al finalizar, toca «Finalizar» — queda registrado el tiempo.",
              "Puede agregar una nota o foto al registro.",
            ].map((t, i) => (
              <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "flex-start" }}>
                <div style={{ ...S.stepNum, minWidth: 24, height: 24, fontSize: 12 }}>{i + 1}</div>
                <span style={{ fontSize: 14, color: "#8A7F75" }}>{t}</span>
              </div>
            ))}
          </div>

          <div style={S.card}>
            <div style={S.h3}>Proyectos y etapas</div>
            <p style={S.p}>Desde <strong>Gestión → Configuración</strong> definís los proyectos activos y sus etapas (ej: "Proyecto Edificio Norte" con etapas "Estructuras", "Instalaciones", "Terminaciones"). Los operarios solo ven los proyectos activos.</p>
          </div>

          <div style={S.card}>
            <div style={S.h3}>Vista gerencial en tiempo real <span style={S.planTag("pro")}>Pro</span></div>
            <p style={S.p}>El gerente ve en <strong>Producción en vivo</strong> qué está haciendo cada operario en este momento, con el tiempo transcurrido y el proyecto. Ideal para supervisión sin interrumpir el trabajo.</p>
          </div>
        </div>
      )}

      {/* ─── GESTIÓN ─── */}
      {tab === "Gestión" && (
        <div style={S.section}>
          <h2 style={S.h2}>👥 Gestión de personal</h2>

          <div style={S.card}>
            <div style={S.h3}>Roles de usuario</div>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Rol</th>
                  <th style={S.th}>Puede hacer</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Operativo", "Fichar, registrar actividades, ver su propio historial, enviar solicitudes"],
                  ["Administrativo", "Todo lo del operativo + gestión de personal y aprobación de solicitudes"],
                  ["Gerencial", "Acceso completo: dashboard, reportes, configuración, impersonación"],
                ].map(([rol, desc]) => (
                  <tr key={rol}>
                    <td style={S.td}>{rol}</td>
                    <td style={S.td}>{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={S.card}>
            <div style={S.h3}>Solicitudes y ausencias</div>
            <p style={S.p}>Los empleados pueden enviar solicitudes de permiso, vacaciones, justificación o tardanza desde la pantalla «Solicitudes». El gerente las recibe en el Inbox y puede aprobarlas o rechazarlas con comentario.</p>
          </div>

          <div style={S.card}>
            <div style={S.h3}>Chat IA y reportes gerenciales</div>
            <p style={S.p}>El chat con asistente IA está disponible para los empleados operativos: les permite fichar, registrar actividades y pedir permisos u horas extra escribiendo en lenguaje natural. Gerencia no tiene ese chat — ve la información de su equipo en reportes estructurados (resumen del día, asistencia, producción y solicitudes) desde el Dashboard.</p>
          </div>

          <div style={S.card}>
            <div style={S.h3}>Notificaciones push</div>
            <p style={S.p}>Instalá la app como PWA (Agregar a pantalla de inicio) para recibir notificaciones push cuando lleguen solicitudes, mensajes del chat operativo o alertas de asistencia.</p>
          </div>
        </div>
      )}

      {/* ─── FAQs ─── */}
      {tab === "FAQs" && (
        <div style={S.section}>
          <h2 style={S.h2}>❓ Preguntas frecuentes</h2>
          {FAQS.map((f, i) => <FAQ key={i} {...f} />)}
          <p style={{ ...S.p, marginTop: 24 }}>¿No encontrás tu respuesta? Escribinos a <a href="mailto:contacto@gypi.app" style={{ color: "#F97316" }}>contacto@gypi.app</a></p>
        </div>
      )}

      {/* ─── PLANES ─── */}
      {tab === "Planes" && (
        <div style={S.section}>
          <h2 style={S.h2}>💳 Planes disponibles</h2>
          <p style={S.p}>Todos los planes incluyen acceso para empleados y administradores. El precio varía según la cantidad de empleados y funciones habilitadas.</p>

          {PLAN_IDS.map((id) => {
            const p = PLANES[id];
            const meta = PLAN_META[id];
            return (
              <div key={id} style={{ ...S.card, borderColor: `${meta.color}44`, marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: meta.color, fontFamily: "'Bricolage Grotesque', system-ui" }}>{p.nombre}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#F5F0E8" }}>{formatPrecioPlan(p)}</div>
                </div>
                <div style={{ ...S.p, marginBottom: 12 }}>{meta.desc}</div>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {featuresDePlan(p).map((f, i) => (
                    <li key={i} style={{ fontSize: 13, color: "#8A7F75", marginBottom: 6, display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ color: meta.color }}>✓</span> {f}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

          <p style={{ ...S.p, marginTop: 24 }}>Para contratar o consultar precios actualizados: <a href="mailto:contacto@gypi.app" style={{ color: "#F97316" }}>contacto@gypi.app</a> o desde la pantalla de Configuración dentro de la app.</p>
        </div>
      )}
    </div>
  );
}
