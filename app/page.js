"use client";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DIAS_TRIAL } from "./lib/plans";
import TablaPrecios from "./components/TablaPrecios";
import GoogleIcon from "./components/GoogleIcon";
import { getOauthErrorMessage } from "./lib/oauthErrorMessages";
import { ultimaEmpresa, destinoAppInstalada } from "./lib/ultimaEmpresa";
import { marcarSiEsAppAndroid, esAppAndroid } from "./lib/appAndroid";
import IngresoApp from "./components/IngresoApp";

// R11: todo con clases y tokens; el color de Gypi sale de las variables por defecto.
const CAMPO = "w-full min-h-12 px-3.5 py-3 rounded-xl bg-gypi-surface border border-gypi-border text-gypi-text text-[16px] font-body outline-none box-border focus:border-gypi-amber";
const BOTON_PRINCIPAL = "inline-flex items-center justify-center min-h-12 px-8 py-3.5 rounded-xl bg-gypi-amber text-gypi-on-amber border-none text-[16px] font-bold font-heading cursor-pointer no-underline disabled:opacity-60";
const BOTON_SECUNDARIO = "inline-flex items-center justify-center min-h-12 px-8 py-3.5 rounded-xl bg-gypi-surface text-gypi-text border border-gypi-border text-[16px] font-semibold font-body cursor-pointer no-underline";
const Logo = ({ chico = false }) => (
  <span className={`${chico ? "w-8 h-8 rounded-lg" : "w-9 h-9 rounded-[10px]"} bg-linear-135 from-gypi-amber to-gypi-violet flex items-center justify-center`} aria-hidden="true">
    <span className={`font-heading font-extrabold text-black ${chico ? "text-xs" : "text-sm"}`}>G</span>
  </span>
);
/** Separador "— o … —" entre Google y el formulario. */
const Separador = ({ children }) => (
  <div className="flex items-center gap-3 my-5">
    <div className="flex-1 h-px bg-gypi-border" />
    <span className="text-[12px] text-gypi-dim font-bold uppercase tracking-[0.06em]">{children}</span>
    <div className="flex-1 h-px bg-gypi-border" />
  </div>
);

/* ═══════════════════════════════════════════════════
   SVG Icons (inline para zero deps)
   ═══════════════════════════════════════════════════ */
const Icon = ({ d, size = 22, className = "text-gypi-amber-ink" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
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
  "fichar desde el celular",
  "pedir permisos sin papeles",
  "cargar sus tareas en 2 toques",
  "saber quién vino hoy",
  "pasarle las horas al contador",
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
    <span className={`inline-block transition-all duration-400 text-gypi-amber-ink ${fade ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}`}>
      {TAGLINES[idx]}
    </span>
  );
}


/* ═══════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════ */
// useSearchParams() obliga a Next a bailar a CSR en esta parte del árbol —
// aislado en su propio componente (que no renderiza nada visible) para que
// el resto de la landing siga pre-renderizándose estática por completo.
// Sin este aislamiento, /page.js entero pierde el prerender (pantalla en
// blanco hasta hidratar + contenido invisible para crawlers).
function OauthErrorBridge({ onError, onRegistro }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const oauthError = searchParams.get("oauth_error");
  // "Crear mi empresa gratis" en /pricing abre el registro directo (antes caía en el inicio)
  const registro = searchParams.get("registro") === "1";

  useEffect(() => {
    if (registro) onRegistro?.();
    if (!oauthError) return;
    onError(getOauthErrorMessage(oauthError));
    router.replace("/", { scroll: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauthError, registro]);

  return null;
}

export default function Landing() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [showRegistro, setShowRegistro] = useState(false);
  const [form, setForm] = useState({ nombre_empresa: "", nombre_admin: "", email: "", password: "", rubro: "general" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [scrolled, setScrolled] = useState(false);

  // Si vino de /api/auth/google/callback con un error, abre el wizard para
  // mostrarlo en contexto.
  const handleOauthError = (mensaje) => {
    setShowRegistro(true);
    setError(mensaje);
  };

  // La app instalada abre en "/" (start_url): la mandamos directo a su empresa
  // en vez de mostrarle la página comercial (F1-03). Antes buscaba una sesión en
  // localStorage que nunca se guardaba, así que no redirigía nunca.
  // En la app de Google Play (ítem 34) no se muestra la página comercial: tiene precios
  const [appAndroid, setAppAndroid] = useState(false);
  useEffect(() => {
    marcarSiEsAppAndroid(window.location.search, document.referrer);
    const destino = destinoAppInstalada(window.location.search, window.matchMedia?.("(display-mode: standalone)")?.matches, ultimaEmpresa());
    if (destino) router.replace(destino);
    else if (esAppAndroid()) setAppAndroid(true);
  }, [router]);

  const continuarConGoogle = () => {
    window.location.href = "/api/auth/google/start?intent=registro";
  };

  const iniciarSesionConGoogle = () => {
    window.location.href = "/api/auth/google/start?intent=login";
  };

  // Lo que se desplaza es la caja de la página, no la ventana: antes el menú de
  // arriba quedaba siempre transparente y se encimaba con el texto.
  const alDesplazar = (e) => setScrolled(e.currentTarget.scrollTop > 20);

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

  if (appAndroid) return <IngresoApp />;

  /* ─── Registro Wizard (pantalla completa) ─── */
  if (showRegistro) {
    const CAMPOS = [
      { k: "nombre_empresa", l: "Nombre de tu empresa", p: "Ej: Metalúrgica García", ac: "organization" },
      { k: "nombre_admin", l: "Tu nombre completo", p: "Ej: Juan García", ac: "name" },
      { k: "email", l: "Email", p: "admin@tuempresa.com", type: "email", ac: "email" },
      { k: "password", l: "Contraseña", p: "Mínimo 6 caracteres", type: "password", ac: "new-password" },
    ];
    return (
      <div className="max-w-[480px] mx-auto min-h-dvh px-7 py-10 text-gypi-text font-body overflow-y-auto">
        <Suspense fallback={null}><OauthErrorBridge onError={handleOauthError} onRegistro={() => setShowRegistro(true)} /></Suspense>
        <button onClick={() => setShowRegistro(false)} className="bg-transparent border-none text-gypi-text cursor-pointer text-[15px] font-semibold py-2 mb-2 min-h-11">← Volver</button>
        <h1 className="m-0 font-heading text-[26px] font-bold">Registrar empresa</h1>
        <div className="text-[14px] text-gypi-dim mt-1.5 mb-6">Creá tu cuenta para empezar a usar Gypi. {DIAS_TRIAL} días gratis, sin tarjeta.</div>

        {error && <div role="alert" className="p-3 bg-gypi-red/10 text-gypi-red-ink rounded-[10px] text-[13px] mb-4">{error}</div>}

        <button onClick={continuarConGoogle} className={`${BOTON_SECUNDARIO} w-full gap-2.5 text-[15px]`}>
          <GoogleIcon size={18} /> Continuar con Google
        </button>

        <Separador>o completá los datos</Separador>

        {CAMPOS.map(f => (
          <div key={f.k} className="mb-3">
            <label htmlFor={`registro-${f.k}`} className="g-label">{f.l}</label>
            <input id={`registro-${f.k}`} type={f.type || "text"} autoComplete={f.ac} value={form[f.k]} onChange={e => setForm({ ...form, [f.k]: e.target.value })} placeholder={f.p} className={CAMPO} />
          </div>
        ))}
        <div className="mb-5">
          <div className="g-label" id="registro-rubro">Rubro</div>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="registro-rubro">
            {["general", "industria", "construcción", "servicios", "comercio", "tecnología"].map(r => (
              <button key={r} onClick={() => setForm({ ...form, rubro: r })} role="radio" aria-checked={form.rubro === r}
                className={`px-3.5 py-2 min-h-11 rounded-full border text-[13px] font-semibold cursor-pointer capitalize ${form.rubro === r ? "border-gypi-amber bg-gypi-amber/10 text-gypi-amber-ink" : "border-gypi-border bg-transparent text-gypi-dim"}`}>{r}</button>
            ))}
          </div>
        </div>
        <button onClick={registrar} disabled={loading} className={`${BOTON_PRINCIPAL} w-full`}>
          {loading ? "Creando empresa..." : "Crear empresa gratis"}
        </button>
      </div>
    );
  }

  /* ─── Secciones ─── */

  // Lo que la app hace de verdad, con las palabras que usa la app
  const FEATURES = [
    { icon: icons.clock,  title: "Fichaje con el celular", desc: "Un botón grande para la entrada y la salida, con la ubicación. También con PIN o en un kiosco." },
    { icon: icons.users,  title: "Pedidos sin papeles",    desc: "Permisos, vacaciones y horas extra: el operario los pide desde el celular y vos los respondés en un toque." },
    { icon: icons.zap,    title: "Tareas y órdenes de trabajo", desc: "Cada operario carga en qué OT y etapa está; ves en vivo quién trabaja y quién está parado." },
    { icon: icons.chart,  title: "Reportes y liquidación", desc: "Asistencia, tardanzas y horas por persona, listas para pasarle al contador en Excel." },
    { icon: icons.chat,   title: "Asistente",              desc: "El equipo le escribe para fichar, pedir un permiso o consultar sus horas." },
    { icon: icons.map,    title: "Trabajo en campo",        desc: "Reportes de obra con fotos, faltantes y desvíos, desde donde estén." },
  ];

  const PASOS = [
    { num: "1", title: "Registrá tu empresa", desc: "Creá tu cuenta en un minuto. Sin tarjeta de crédito." },
    { num: "2", title: "Sumá a tu equipo",    desc: "Les mandás un link y entran con un PIN desde el celular." },
    { num: "3", title: "Mirá tu tablero",      desc: "Quién vino, quién falta, quién está parado y qué pedidos esperan respuesta." },
  ];

  // Datos ciertos (antes decía "14 días" de prueba y un "99%" sin respaldo)
  const KPIS = [
    { valor: `${DIAS_TRIAL} días`, label: "de prueba gratis, con todo incluido" },
    { valor: "1 minuto", label: "para registrar tu empresa" },
    { valor: "$0", label: "para empezar: sin tarjeta" },
    { valor: "Celular", label: "Android, iPhone o computadora, sin descargar nada" },
  ];

  const RUBROS = [
    { icon: "🏭", label: "Industria" },
    { icon: "🏗️", label: "Construcción" },
    { icon: "🛠️", label: "Servicios" },
    { icon: "🛒", label: "Comercio" },
    { icon: "💻", label: "Tecnología" },
    { icon: "🏥", label: "Salud" },
    { icon: "🚚", label: "Logística" },
    { icon: "🍴", label: "Gastronomía" },
  ];

  const CONFIANZA = [
    { icon: "🇦🇷", label: "Datos hospedados con cumplimiento de la Ley 25.326" },
    { icon: "🔒", label: "Conexión cifrada de punta a punta" },
    { icon: "💬", label: "Soporte en español" },
    { icon: "🚫", label: "Sin tarjeta de crédito para empezar" },
  ];

  const SECCION = "px-6 py-20 max-w-[1100px] mx-auto";
  const TITULO = "font-heading text-[28px] font-bold text-gypi-text text-center m-0 mb-2";
  const BAJADA = "font-body text-[15px] text-gypi-dim text-center m-0 mb-12 max-w-[520px] mx-auto";

  return (
    <div className="bg-gypi-bg text-gypi-text font-body h-dvh overflow-y-auto" onScroll={alDesplazar}>
      <Suspense fallback={null}><OauthErrorBridge onError={handleOauthError} onRegistro={() => setShowRegistro(true)} /></Suspense>

      {/* ═══ NAV FIJA ═══ */}
      <nav className={`fixed top-0 inset-x-0 z-[100] px-6 py-3.5 flex items-center justify-between max-w-[1200px] mx-auto transition-all duration-300 border-b ${scrolled ? "bg-gypi-bg/85 backdrop-blur-lg border-gypi-border" : "bg-transparent border-transparent"}`}>
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="font-heading text-[18px] font-bold">Gypi</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => scrollTo("features")} className="bg-transparent border-none text-gypi-dim cursor-pointer text-[14px] font-body px-2.5 min-h-11">Qué hace</button>
          <button onClick={() => scrollTo("pricing")} className="bg-transparent border-none text-gypi-dim cursor-pointer text-[14px] font-body px-2.5 min-h-11">Precios</button>
          <button onClick={() => scrollTo("login")} className="bg-transparent border-none text-gypi-amber-ink cursor-pointer text-[14px] font-bold font-body px-2.5 min-h-11">Ingresar</button>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section className="px-6 pt-[140px] pb-20 text-center max-w-[800px] mx-auto">
        <div className="inline-block px-4 py-1.5 rounded-full bg-gypi-amber/10 text-gypi-amber-ink text-[12px] font-bold mb-6 tracking-[0.04em] uppercase">
          Para equipos de planta, taller y obra
        </div>
        <h1 className="font-heading text-[clamp(32px,6vw,52px)] font-extrabold leading-[1.1] m-0 mb-4 tracking-[-0.03em]">
          Tu equipo va a poder<br /><AnimatedTagline />
        </h1>
        <p className="text-[17px] text-gypi-dim leading-relaxed max-w-[540px] mx-auto mb-9">
          Gypi es la app para el fichaje, los pedidos y las tareas de tu equipo operativo. Ellos la usan desde el celular; vos ves todo en un tablero.
        </p>
        <div className="flex gap-3 justify-center flex-wrap">
          <button onClick={() => setShowRegistro(true)} className={BOTON_PRINCIPAL}>Empezar gratis</button>
          <a href="/demo?demo=true" className={BOTON_SECUNDARIO}>Ver cómo funciona</a>
        </div>
      </section>

      {/* ═══ 4 DATOS ═══ */}
      <section className="px-6 pb-20 max-w-[900px] mx-auto">
        <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
          {KPIS.map((k) => (
            <div key={k.label} className="text-center px-4 py-7 bg-gypi-surface rounded-2xl border border-gypi-border">
              <div className="font-heading text-[28px] font-extrabold text-gypi-amber-ink">{k.valor}</div>
              <div className="text-[14px] text-gypi-dim mt-1.5">{k.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ RUBROS + CONFIANZA (social proof honesto) ═══ */}
      <section className="px-6 pb-20 max-w-[1000px] mx-auto">
        <p className="text-center text-[12px] text-gypi-dim font-bold uppercase tracking-[0.08em] mb-5">
          Pensado para equipos operativos de todos los rubros
        </p>
        <div className="flex flex-wrap justify-center gap-2.5 mb-10">
          {RUBROS.map((r) => (
            <span key={r.label} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-gypi-surface border border-gypi-border text-[14px] text-gypi-text">
              <span aria-hidden="true">{r.icon}</span> {r.label}
            </span>
          ))}
        </div>
        <div className="grid gap-3.5 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
          {CONFIANZA.map((c) => (
            <div key={c.label} className="flex items-center gap-2.5 px-4 py-3.5 bg-gypi-surface rounded-xl border border-gypi-border">
              <span aria-hidden="true" className="text-[18px]">{c.icon}</span>
              <span className="text-[14px] text-gypi-dim leading-snug">{c.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ QUÉ HACE ═══ */}
      <section id="features" className={SECCION}>
        <h2 className={TITULO}>Qué hace Gypi</h2>
        <p className={BAJADA}>Pensado para gente que trabaja con las manos: botones grandes, pocas pantallas y palabras simples.</p>
        <div className="grid gap-5 grid-cols-[repeat(auto-fit,minmax(300px,1fr))]">
          {FEATURES.map((f) => (
            <div key={f.title} className="p-7 bg-gypi-surface rounded-2xl border border-gypi-border transition-[border-color,transform] duration-200 hover:border-gypi-amber hover:-translate-y-0.5">
              <div className="w-11 h-11 rounded-xl bg-gypi-amber/10 flex items-center justify-center mb-4">
                <Icon d={f.icon} size={22} />
              </div>
              <h3 className="font-heading text-[17px] font-bold m-0 mb-2">{f.title}</h3>
              <p className="text-[15px] text-gypi-dim leading-normal m-0">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ CÓMO FUNCIONA — 3 PASOS ═══ */}
      <section className={SECCION}>
        <h2 className={TITULO}>Empezá en 3 pasos</h2>
        <p className={BAJADA}>Sin configuración complicada: tu equipo puede fichar hoy mismo.</p>
        <div className="grid gap-6 grid-cols-[repeat(auto-fit,minmax(260px,1fr))]">
          {PASOS.map((p) => (
            <div key={p.num} className="text-center p-8">
              <div className="w-14 h-14 rounded-full bg-linear-135 from-gypi-amber to-gypi-violet flex items-center justify-center mx-auto mb-5 text-[22px] font-extrabold font-heading text-black" aria-hidden="true">
                {p.num}
              </div>
              <h3 className="font-heading text-[18px] font-bold m-0 mb-2">{p.title}</h3>
              <p className="text-[15px] text-gypi-dim leading-normal m-0">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ EN EL CELULAR ═══ */}
      <section className="px-6 py-[60px] max-w-[800px] mx-auto text-center">
        <div className="p-10 bg-linear-135 from-gypi-amber/10 to-gypi-violet/10 rounded-3xl border border-gypi-border">
          <div className="w-16 h-16 rounded-2xl bg-gypi-amber flex items-center justify-center mx-auto mb-5">
            <Icon d={icons.download} size={28} className="text-gypi-on-amber" />
          </div>
          <h2 className="font-heading text-[24px] font-bold m-0 mb-3">Se usa desde el celular, sin descargar nada</h2>
          <p className="text-[15px] text-gypi-dim leading-relaxed max-w-[500px] mx-auto mb-6">
            Se abre en el navegador y se puede agregar a la pantalla de inicio como cualquier app. Si se corta la señal, la entrada o la salida quedan guardadas y se envían solas cuando vuelve.
          </p>
          <div className="flex gap-6 justify-center flex-wrap text-[14px] text-gypi-text">
            <span>✓ Sin pasar por la tienda de apps</span>
            <span>✓ Funciona con poca señal</span>
            <span>✓ Avisos en el celular</span>
            <span>✓ Android, iPhone y computadora</span>
          </div>
        </div>
      </section>

      {/* ═══ PRECIOS ═══ */}
      <section id="pricing" className={SECCION}>
        <h2 className={TITULO}>Planes simples, sin sorpresas</h2>
        <p className={BAJADA}>Pagás según cuánta gente tenés y qué querés controlar. Empezá con {DIAS_TRIAL} días de prueba gratis, con todo incluido.</p>
        <div className="max-w-[1000px] mx-auto">
          <TablaPrecios onEmpezar={() => setShowRegistro(true)} />
        </div>
      </section>

      {/* ═══ CTA FINAL ═══ */}
      <section className="px-6 py-20 text-center">
        <div className="max-w-[600px] mx-auto p-12 bg-linear-160 from-gypi-surface to-gypi-surf-hi rounded-[28px] border border-gypi-border">
          <h2 className="font-heading text-[28px] font-extrabold m-0 mb-3">Probalo con tu equipo</h2>
          <p className="text-[15px] text-gypi-dim leading-relaxed m-0 mb-7">
            {DIAS_TRIAL} días de prueba gratis, con todas las funciones y sin tarjeta.
          </p>
          <button onClick={() => setShowRegistro(true)} className={`${BOTON_PRINCIPAL} px-10 text-[17px]`}>
            Crear mi empresa gratis
          </button>
        </div>
      </section>

      {/* ═══ INGRESAR ═══ */}
      <section id="login" className="px-6 pt-[60px] pb-10 max-w-[420px] mx-auto">
        <h2 className="font-heading text-[22px] font-bold text-center m-0 mb-5">¿Ya tenés cuenta?</h2>

        <button onClick={iniciarSesionConGoogle} className={`${BOTON_SECUNDARIO} w-full gap-2.5 text-[15px] mb-2`}>
          <GoogleIcon size={18} /> Iniciar sesión con Google
        </button>

        <Separador>o escribí el nombre de tu empresa</Separador>

        <label htmlFor="ingresar-empresa" className="sr-only">Dirección de tu empresa</label>
        <div className="flex items-center bg-gypi-surface border border-gypi-border rounded-xl px-3.5 mb-2 focus-within:border-gypi-amber">
          <span className="text-gypi-mute text-[15px]">gypi.app/</span>
          <input id="ingresar-empresa" value={slug} onChange={e => setSlug(e.target.value)} onKeyDown={e => e.key === "Enter" && entrar()} placeholder="mi-empresa" autoCapitalize="none" autoCorrect="off"
            className="flex-1 px-1 py-3.5 border-none bg-transparent text-gypi-text text-[16px] outline-none font-body" />
        </div>
        <button onClick={entrar} disabled={!slug.trim()} className={`${BOTON_PRINCIPAL} w-full ${slug.trim() ? "" : "bg-gypi-surface! text-gypi-mute! cursor-default!"}`}>
          Ir a mi empresa
        </button>
        <p className="text-center text-[13px] text-gypi-dim mt-3 mb-0">¿No sabés la dirección? Pedísela a quien te dio de alta, o buscá el link que te mandaron.</p>
      </section>

      {/* ═══ PIE ═══ */}
      <footer className="px-6 py-10 border-t border-gypi-border max-w-[1100px] mx-auto">
        <div className="flex justify-between items-center flex-wrap gap-4">
          <div className="flex items-center gap-2.5">
            <Logo chico />
            <span className="font-heading text-[15px] font-bold">Gypi</span>
          </div>
          <div className="flex gap-6 text-[14px] text-gypi-dim">
            <a href="#features" className="text-gypi-dim no-underline">Qué hace</a>
            <a href="/pricing" className="text-gypi-dim no-underline">Precios</a>
            <a href="#login" className="text-gypi-dim no-underline">Ingresar</a>
          </div>
        </div>
        <div className="flex justify-center gap-6 mt-6 pt-5 border-t border-gypi-border flex-wrap text-[13px]">
          <a href="/nosotros" className="text-gypi-dim no-underline">Nosotros</a>
          <a href="/docs" className="text-gypi-dim no-underline">Documentación</a>
          <a href="/terms" className="text-gypi-dim no-underline">Términos</a>
          <a href="/privacy" className="text-gypi-dim no-underline">Privacidad</a>
          <a href="/contacto" className="text-gypi-dim no-underline">Contacto</a>
        </div>
        <div className="text-center text-[13px] text-gypi-mute mt-3">
          © {new Date().getFullYear()} Gypi · Gestión y productividad industrial · Todos los derechos reservados
        </div>
      </footer>
    </div>
  );
}
