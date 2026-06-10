"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { C, fH, fB, fM } from "./lib/theme";
import { PLANES } from "./lib/plans";

/* ═══════════════════════════════════════════════════
   SVG Icons (inline para zero deps)
   ═══════════════════════════════════════════════════ */
const Icon = ({ d, size = 22, color = C.amber }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const icons = {
  clock:    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2",
  users:    "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  chat:     "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  chart:    "M18 20V10M12 20V4M6 20v-6",
  shield:   "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  zap:      "M13 2L3 14h9l-1 10 10-12h-9l1-10z",
  globe:    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2z",
  map:      "M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z",
  check:    "M20 6L9 17l-5-5",
  phone:    "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  star:     "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
};

/* ═══════════════════════════════════════════════════
   Taglines animados
   ═══════════════════════════════════════════════════ */
const TAGLINES = [
  "Fichaje inteligente",
  "Chat operativo",
  "Reportes en tiempo real",
  "Gestión de obras",
  "Control de asistencia",
];

function AnimatedTagline() {
  const [idx, setIdx] = useState(0);
  const [fade, setFade] = useState(true);
  useEffect(() => {
    const t = setInterval(() => {
      setFade(false);
      setTimeout(() => { setIdx(i => (i + 1) % TAGLINES.length); setFade(true); }, 400);
    }, 3000);
    return () => clearInterval(t);
  }, []);
  return (
    <span style={{ display: "inline-block", transition: "opacity 0.4s, transform 0.4s", opacity: fade ? 1 : 0, transform: fade ? "translateY(0)" : "translateY(8px)", color: C.amber }}>
      {TAGLINES[idx]}
    </span>
  );
}

/* ═══════════════════════════════════════════════════
   Pricing helpers
   ═══════════════════════════════════════════════════ */
const FEATURES_CHECK = [
  { key: "fichaje",     label: "Fichaje de asistencia" },
  { key: "chat",        label: "Chat operativo" },
  { key: "geolocalizacion", label: "Geolocalización" },
  { key: "exportar_csv", label: "Exportar CSV" },
  { key: "exportar_pdf", label: "Exportar PDF" },
  { key: "calendario",  label: "Calendario" },
  { key: "reglas_bot",  label: "Reglas automáticas (bot)" },
  { key: "reportes_avanzados", label: "Reportes avanzados" },
  { key: "soporte",     label: "Soporte dedicado" },
  { key: "api_access",  label: "Acceso API" },
];

function precioAnual(precio) {
  if (!precio) return null;
  return Math.round(precio * 0.8);
}

function formatPrecio(n) {
  if (n == null) return "A medida";
  return "$" + n.toLocaleString("es-AR");
}

/* ═══════════════════════════════════════════════════
   KPI counter animation
   ═══════════════════════════════════════════════════ */
function AnimatedNumber({ target, suffix = "" }) {
  const [val, setVal] = useState(0);
  const ref = useRef(null);
  const started = useRef(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !started.current) {
        started.current = true;
        let start = 0;
        const step = Math.ceil(target / 40);
        const t = setInterval(() => {
          start += step;
          if (start >= target) { setVal(target); clearInterval(t); }
          else setVal(start);
        }, 30);
      }
    }, { threshold: 0.3 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [target]);
  return <span ref={ref}>{val.toLocaleString("es-AR")}{suffix}</span>;
}

/* ═══════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════ */
export default function Landing() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [showRegistro, setShowRegistro] = useState(false);
  const [form, setForm] = useState({ nombre_empresa: "", nombre_admin: "", email: "", password: "", rubro: "general" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [anual, setAnual] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    try {
      const s = localStorage.getItem("gi-session");
      if (s) {
        const u = JSON.parse(s);
        if (u?.empresa?.slug) router.replace("/" + u.empresa.slug);
      }
    } catch {}
  }, [router]);

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);

  const entrar = () => {
    const s = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!s) return;
    router.push("/" + s);
  };

  const registrar = async () => {
    if (!form.nombre_empresa || !form.nombre_admin || !form.email || !form.password) {
      setError("Completá todos los campos"); return;
    }
    if (form.password.length < 6) { setError("La contraseña debe tener al menos 6 caracteres"); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/registro-empresa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setError(data.error || "Error"); setLoading(false); return; }
      router.push("/" + data.empresa.slug);
    } catch (err) { setError(err.message); setLoading(false); }
  };

  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  /* ─── Registro Wizard (pantalla completa) ─── */
  if (showRegistro) {
    return (
      <div style={{ maxWidth: 480, margin: "0 auto", minHeight: "100dvh", padding: "40px 28px", color: C.text, fontFamily: fB, overflowY: "auto" }}>
        <button onClick={() => setShowRegistro(false)} style={{ background: "none", border: "none", color: C.amber, cursor: "pointer", fontSize: 13, padding: "8px 0", marginBottom: 8 }}>← Volver</button>
        <h1 style={{ margin: 0, fontFamily: fH, fontSize: 26, fontWeight: 700 }}>Registrar empresa</h1>
        <div style={{ fontSize: 13, color: C.dim, marginTop: 6, marginBottom: 24 }}>Creá tu cuenta para empezar a usar Gypi</div>
        {[
          { k: "nombre_empresa", l: "Nombre de tu empresa", p: "Ej: Metalúrgica García" },
          { k: "nombre_admin", l: "Tu nombre completo", p: "Ej: Juan García" },
          { k: "email", l: "Email", p: "admin@tuempresa.com", type: "email" },
          { k: "password", l: "Contraseña", p: "Mínimo 6 caracteres", type: "password" },
        ].map(f => (
          <div key={f.k} style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{f.l}</label>
            <input type={f.type || "text"} value={form[f.k]} onChange={e => setForm({ ...form, [f.k]: e.target.value })} placeholder={f.p}
              style={{ width: "100%", padding: "12px 14px", borderRadius: 12, background: C.surface, border: `1px solid ${C.border}`, color: C.text, fontSize: 14, fontFamily: fB, outline: "none", boxSizing: "border-box" }} />
          </div>
        ))}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Rubro</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {["general", "industria", "construcción", "servicios", "comercio", "tecnología"].map(r => (
              <button key={r} onClick={() => setForm({ ...form, rubro: r })}
                style={{ padding: "6px 12px", borderRadius: 20, border: `1px solid ${form.rubro === r ? C.amber : C.border}`, background: form.rubro === r ? `${C.amber}22` : "transparent", color: form.rubro === r ? C.amber : C.dim, fontSize: 12, fontWeight: 600, cursor: "pointer", textTransform: "capitalize" }}>{r}</button>
            ))}
          </div>
        </div>
        <button onClick={registrar} disabled={loading}
          style={{ width: "100%", padding: 14, borderRadius: 12, background: C.amber, color: "#000", border: "none", fontSize: 15, fontWeight: 700, cursor: "pointer", opacity: loading ? 0.6 : 1 }}>
          {loading ? "Creando empresa..." : "Crear empresa gratis"}
        </button>
        {error && <div style={{ padding: 12, background: C.redS, color: C.red, borderRadius: 10, fontSize: 12, marginTop: 12 }}>{error}</div>}
      </div>
    );
  }

  /* ─── Secciones ─── */
  const plans = ["free", "starter", "pro", "enterprise"];

  const FEATURES = [
    { icon: icons.clock,  title: "Fichaje inteligente",   desc: "Control de asistencia con geolocalización, fotos y validación automática." },
    { icon: icons.chat,   title: "Chat operativo",        desc: "Comunicación directa entre equipos con canales por área y notificaciones push." },
    { icon: icons.chart,  title: "Reportes en tiempo real", desc: "Dashboards con métricas de productividad, ausentismo y horas trabajadas." },
    { icon: icons.map,    title: "Gestión de obras",      desc: "Seguimiento de ubicaciones, tareas por obra y estado de instalaciones." },
    { icon: icons.shield, title: "Reglas automáticas",    desc: "Bot configurable que aplica políticas de fichaje, alertas y recordatorios." },
    { icon: icons.globe,  title: "PWA multiplataforma",   desc: "Funciona en cualquier dispositivo sin instalar nada. Offline-ready." },
  ];

  const PASOS = [
    { num: "1", title: "Registrá tu empresa", desc: "Creá tu cuenta en 30 segundos. Sin tarjeta de crédito." },
    { num: "2", title: "Sumá a tu equipo",    desc: "Invitá empleados con un link. Ellos fichan desde el celular." },
    { num: "3", title: "Controlá todo",        desc: "Visualizá asistencia, productividad y comunicación en un solo lugar." },
  ];

  const KPIS = [
    { value: 500, suffix: "+", label: "Empresas activas" },
    { value: 12000, suffix: "+", label: "Fichajes diarios" },
    { value: 99, suffix: "%", label: "Uptime garantizado" },
    { value: 4, suffix: ".8★", label: "Satisfacción" },
  ];

  const sectionPad = { padding: "80px 24px", maxWidth: 1100, margin: "0 auto" };
  const sectionTitle = { fontFamily: fH, fontSize: 28, fontWeight: 700, color: C.text, textAlign: "center", margin: "0 0 8px" };
  const sectionSub = { fontFamily: fB, fontSize: 15, color: C.dim, textAlign: "center", margin: "0 0 48px", maxWidth: 520, marginLeft: "auto", marginRight: "auto" };

  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: fB, minHeight: "100dvh" }}>

      {/* ═══ NAV STICKY ═══ */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        padding: "14px 24px",
        background: scrolled ? "rgba(12,10,9,0.85)" : "transparent",
        backdropFilter: scrolled ? "blur(16px)" : "none",
        WebkitBackdropFilter: scrolled ? "blur(16px)" : "none",
        borderBottom: scrolled ? `1px solid ${C.border}` : "1px solid transparent",
        transition: "all 0.3s ease",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        maxWidth: 1200, margin: "0 auto",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg,${C.amber},${C.violet})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontFamily: fH, fontSize: 14, fontWeight: 800, color: "#000" }}>G</span>
          </div>
          <span style={{ fontFamily: fH, fontSize: 18, fontWeight: 700 }}>Gypi</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <button onClick={() => scrollTo("features")} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 13, fontFamily: fB }}>Features</button>
          <button onClick={() => scrollTo("pricing")} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 13, fontFamily: fB }}>Precios</button>
          <button onClick={() => scrollTo("login")} style={{ background: "none", border: "none", color: C.amber, cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: fB }}>Ingresar</button>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section style={{ padding: "140px 24px 80px", textAlign: "center", maxWidth: 800, margin: "0 auto" }}>
        <div style={{ display: "inline-block", padding: "6px 16px", borderRadius: 20, background: C.amberS, color: C.amber, fontSize: 12, fontWeight: 700, marginBottom: 24, letterSpacing: "0.04em" }}>
          GESTIÓN DE PERSONAL INTELIGENTE
        </div>
        <h1 style={{ fontFamily: fH, fontSize: "clamp(32px, 6vw, 52px)", fontWeight: 800, lineHeight: 1.1, margin: "0 0 16px", letterSpacing: "-0.03em" }}>
          Tu equipo necesita<br /><AnimatedTagline />
        </h1>
        <p style={{ fontSize: 17, color: C.dim, lineHeight: 1.6, maxWidth: 540, margin: "0 auto 36px" }}>
          Gypi es la plataforma todo-en-uno para gestionar fichaje, comunicación y productividad de tu equipo operativo. Sin instalaciones, desde cualquier dispositivo.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <button onClick={() => setShowRegistro(true)}
            style={{ padding: "14px 32px", borderRadius: 12, background: C.amber, color: "#000", border: "none", fontSize: 16, fontWeight: 700, fontFamily: fH, cursor: "pointer" }}>
            Empezar gratis
          </button>
          <button onClick={() => scrollTo("features")}
            style={{ padding: "14px 32px", borderRadius: 12, background: C.surface, color: C.text, border: `1px solid ${C.border}`, fontSize: 16, fontWeight: 600, fontFamily: fB, cursor: "pointer" }}>
            Ver features
          </button>
        </div>
      </section>

      {/* ═══ 4 KPIs ═══ */}
      <section style={{ padding: "0 24px 80px", maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
          {KPIS.map((k, i) => (
            <div key={i} style={{ textAlign: "center", padding: "28px 16px", background: C.surface, borderRadius: 16, border: `1px solid ${C.border}` }}>
              <div style={{ fontFamily: fH, fontSize: 32, fontWeight: 800, color: C.amber }}>
                <AnimatedNumber target={k.value} suffix={k.suffix} />
              </div>
              <div style={{ fontSize: 13, color: C.dim, marginTop: 6 }}>{k.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ 6 FEATURE CARDS ═══ */}
      <section id="features" style={sectionPad}>
        <h2 style={sectionTitle}>Todo lo que tu empresa necesita</h2>
        <p style={sectionSub}>Herramientas diseñadas para equipos operativos que necesitan simplicidad y control.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20 }}>
          {FEATURES.map((f, i) => (
            <div key={i} style={{ padding: 28, background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`, transition: "border-color 0.2s, transform 0.2s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.amber; e.currentTarget.style.transform = "translateY(-2px)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.transform = "translateY(0)"; }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: C.amberS, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                <Icon d={f.icon} size={22} color={C.amber} />
              </div>
              <h3 style={{ fontFamily: fH, fontSize: 17, fontWeight: 700, margin: "0 0 8px" }}>{f.title}</h3>
              <p style={{ fontSize: 14, color: C.dim, lineHeight: 1.5, margin: 0 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ CÓMO FUNCIONA — 3 PASOS ═══ */}
      <section style={sectionPad}>
        <h2 style={sectionTitle}>Empezá en 3 pasos</h2>
        <p style={sectionSub}>Sin configuración compleja. Tu equipo operativo ficha hoy mismo.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 24 }}>
          {PASOS.map((p, i) => (
            <div key={i} style={{ textAlign: "center", padding: 32 }}>
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: `linear-gradient(135deg,${C.amber},${C.violet})`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: 22, fontWeight: 800, fontFamily: fH, color: "#000" }}>
                {p.num}
              </div>
              <h3 style={{ fontFamily: fH, fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>{p.title}</h3>
              <p style={{ fontSize: 14, color: C.dim, lineHeight: 1.5, margin: 0 }}>{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ HIGHLIGHT PWA ═══ */}
      <section style={{ padding: "60px 24px", maxWidth: 800, margin: "0 auto", textAlign: "center" }}>
        <div style={{ padding: 40, background: `linear-gradient(135deg, ${C.amberS}, ${C.violetS})`, borderRadius: 24, border: `1px solid ${C.border}` }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: C.amber, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
            <Icon d={icons.download} size={28} color="#000" />
          </div>
          <h2 style={{ fontFamily: fH, fontSize: 24, fontWeight: 700, margin: "0 0 12px" }}>App progresiva (PWA)</h2>
          <p style={{ fontSize: 15, color: C.dim, lineHeight: 1.6, maxWidth: 500, margin: "0 auto 24px" }}>
            Gypi se instala como una app nativa desde el navegador. Sin App Store, sin actualizaciones manuales. Funciona offline y envía notificaciones push.
          </p>
          <div style={{ display: "flex", gap: 24, justifyContent: "center", flexWrap: "wrap", fontSize: 13, color: C.text }}>
            <span>✓ Sin descarga</span>
            <span>✓ Funciona offline</span>
            <span>✓ Push notifications</span>
            <span>✓ Android + iOS + Desktop</span>
          </div>
        </div>
      </section>

      {/* ═══ PRICING ═══ */}
      <section id="pricing" style={sectionPad}>
        <h2 style={sectionTitle}>Planes simples, sin sorpresas</h2>
        <p style={sectionSub}>Empezá gratis y escalá cuando lo necesites. Todos los planes incluyen soporte.</p>

        {/* Toggle mensual / anual */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 40 }}>
          <span style={{ fontSize: 14, color: anual ? C.dim : C.text, fontWeight: anual ? 400 : 700 }}>Mensual</span>
          <button onClick={() => setAnual(!anual)}
            style={{ width: 52, height: 28, borderRadius: 14, background: anual ? C.amber : C.surface, border: `1px solid ${anual ? C.amber : C.border}`, cursor: "pointer", position: "relative", transition: "all 0.3s" }}>
            <div style={{ width: 22, height: 22, borderRadius: 11, background: anual ? "#000" : C.dim, position: "absolute", top: 2, left: anual ? 27 : 3, transition: "left 0.3s" }} />
          </button>
          <span style={{ fontSize: 14, color: anual ? C.text : C.dim, fontWeight: anual ? 700 : 400 }}>
            Anual <span style={{ fontSize: 11, color: C.green, fontWeight: 700 }}>-20%</span>
          </span>
        </div>

        {/* 4 Plan cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, maxWidth: 1000, margin: "0 auto" }}>
          {plans.map(pid => {
            const p = PLANES[pid];
            const isPopular = pid === "pro";
            const precio = p.precio;
            const precioShow = anual ? precioAnual(precio) : precio;

            return (
              <div key={pid} style={{
                padding: 28, borderRadius: 20,
                background: isPopular ? `linear-gradient(160deg, ${C.surface}, ${C.surfHi})` : C.surface,
                border: isPopular ? `2px solid ${C.amber}` : `1px solid ${C.border}`,
                position: "relative",
                transition: "transform 0.2s, box-shadow 0.2s",
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = `0 8px 32px ${C.amberS}`; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}>

                {/* Badge POPULAR */}
                {isPopular && (
                  <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", padding: "4px 16px", borderRadius: 20, background: C.amber, color: "#000", fontSize: 11, fontWeight: 800, letterSpacing: "0.08em" }}>
                    POPULAR
                  </div>
                )}

                <h3 style={{ fontFamily: fH, fontSize: 20, fontWeight: 700, margin: isPopular ? "8px 0 4px" : "0 0 4px" }}>{p.nombre}</h3>
                <div style={{ fontSize: 13, color: C.dim, marginBottom: 16 }}>
                  Hasta {p.max_empleados >= 99999 ? "ilimitados" : p.max_empleados} empleados
                </div>

                <div style={{ marginBottom: 20 }}>
                  <span style={{ fontFamily: fH, fontSize: 36, fontWeight: 800, color: isPopular ? C.amber : C.text }}>
                    {formatPrecio(precioShow)}
                  </span>
                  {precio != null && precio > 0 && (
                    <span style={{ fontSize: 13, color: C.dim }}>/{anual ? "mes" : "mes"}</span>
                  )}
                  {precio === 0 && <span style={{ fontSize: 13, color: C.dim }}> forever</span>}
                </div>

                {/* Feature checklist */}
                <div style={{ marginBottom: 24 }}>
                  {FEATURES_CHECK.map(f => {
                    const has = p[f.key] === true || (typeof p[f.key] === "string") || (f.key === "fichaje" && p.modulos?.includes("fichaje")) || (f.key === "chat" && p.modulos?.includes("chat"));
                    return (
                      <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 13, color: has ? C.text : C.mute }}>
                        <span style={{ color: has ? C.green : C.mute, fontSize: 14 }}>{has ? "✓" : "–"}</span>
                        <span style={{ textDecoration: has ? "none" : "line-through" }}>{f.label}</span>
                      </div>
                    );
                  })}
                </div>

                <button onClick={() => pid === "enterprise" ? scrollTo("login") : setShowRegistro(true)}
                  style={{
                    width: "100%", padding: 12, borderRadius: 12, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, fontFamily: fH,
                    background: isPopular ? C.amber : C.surfHi,
                    color: isPopular ? "#000" : C.text,
                  }}>
                  {pid === "free" ? "Empezar gratis" : pid === "enterprise" ? "Contactanos" : "Elegir plan"}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* ═══ CTA FINAL ═══ */}
      <section style={{ padding: "80px 24px", textAlign: "center" }}>
        <div style={{ maxWidth: 600, margin: "0 auto", padding: 48, background: `linear-gradient(160deg, ${C.surface}, ${C.surfHi})`, borderRadius: 28, border: `1px solid ${C.border}` }}>
          <h2 style={{ fontFamily: fH, fontSize: 28, fontWeight: 800, margin: "0 0 12px" }}>¿Listo para transformar tu gestión?</h2>
          <p style={{ fontSize: 15, color: C.dim, lineHeight: 1.6, margin: "0 0 28px" }}>
            Unite a las empresas que ya gestionan su equipo con Gypi. Plan Free sin límite de tiempo.
          </p>
          <button onClick={() => setShowRegistro(true)}
            style={{ padding: "16px 40px", borderRadius: 14, background: C.amber, color: "#000", border: "none", fontSize: 17, fontWeight: 700, fontFamily: fH, cursor: "pointer" }}>
            Crear mi empresa gratis
          </button>
        </div>
      </section>

      {/* ═══ LOGIN / INGRESAR ═══ */}
      <section id="login" style={{ padding: "60px 24px 40px", maxWidth: 420, margin: "0 auto" }}>
        <h2 style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, textAlign: "center", margin: "0 0 20px" }}>¿Ya tenés cuenta?</h2>
        <div style={{ display: "flex", alignItems: "center", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "0 14px", marginBottom: 8 }}>
          <span style={{ color: C.mute, fontSize: 14 }}>gypi.app/</span>
          <input value={slug} onChange={e => setSlug(e.target.value)} onKeyDown={e => e.key === "Enter" && entrar()} placeholder="mi-empresa"
            style={{ flex: 1, padding: "14px 4px", border: "none", background: "transparent", color: C.text, fontSize: 15, outline: "none", fontFamily: fB }} />
        </div>
        <button onClick={entrar} disabled={!slug.trim()}
          style={{ width: "100%", padding: 14, borderRadius: 12, background: slug.trim() ? C.amber : C.surface, color: slug.trim() ? "#000" : C.mute, border: "none", fontSize: 15, fontWeight: 700, cursor: slug.trim() ? "pointer" : "default", fontFamily: fH }}>
          Ir a mi empresa
        </button>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer style={{ padding: "40px 24px", borderTop: `1px solid ${C.border}`, maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: `linear-gradient(135deg,${C.amber},${C.violet})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontFamily: fH, fontSize: 12, fontWeight: 800, color: "#000" }}>G</span>
            </div>
            <span style={{ fontFamily: fH, fontSize: 15, fontWeight: 700 }}>Gypi</span>
          </div>
          <div style={{ display: "flex", gap: 24, fontSize: 13, color: C.dim }}>
            <button onClick={() => scrollTo("features")} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 13 }}>Features</button>
            <button onClick={() => scrollTo("pricing")} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 13 }}>Precios</button>
            <button onClick={() => scrollTo("login")} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 13 }}>Ingresar</button>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 24, marginTop: 24, paddingTop: 20, borderTop: `1px solid ${C.border}`, flexWrap: "wrap" }}>
          <a href="/docs" style={{ fontSize: 12, color: C.dim, textDecoration: "none" }}>Documentación</a>
          <a href="/terms" style={{ fontSize: 12, color: C.dim, textDecoration: "none" }}>Términos</a>
          <a href="/privacy" style={{ fontSize: 12, color: C.dim, textDecoration: "none" }}>Privacidad</a>
          <a href="mailto:contacto@gypi.app" style={{ fontSize: 12, color: C.dim, textDecoration: "none" }}>Contacto</a>
        </div>
        <div style={{ textAlign: "center", fontSize: 12, color: C.mute, marginTop: 12 }}>
          © {new Date().getFullYear()} Gypi · Gestión y productividad industrial · Todos los derechos reservados
        </div>
      </footer>
    </div>
  );
}
