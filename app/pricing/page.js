import Link from "next/link";
import { fH, fB } from "../lib/theme";
import { PLANES } from "../lib/plans";

const V = {
  amber: "var(--color-empresa-primary, #F97316)",
  amberText: "#000",
  violet: "var(--color-empresa-secondary, #7C3AED)",
  green: "#16A34A",
  mute: "var(--color-text-muted)",
  dim: "var(--color-text-dim)",
  text: "var(--color-text)",
  bg: "var(--color-bg)",
  surface: "var(--color-surface)",
  surfHi: "var(--color-surface-hi)",
  border: "var(--color-border)",
};

const SITE_URL = "https://gypi.app";
const TITLE = "Precios — Gypi";
const DESCRIPTION = "Planes simples para fichaje digital, seguimiento de obra y reportes en tiempo real. Empezá gratis con hasta 5 empleados, sin tarjeta de crédito.";

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/pricing` },
  openGraph: {
    type: "website",
    locale: "es_AR",
    url: `${SITE_URL}/pricing`,
    siteName: "Gypi",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/api/og", width: 1200, height: 630, alt: TITLE, type: "image/png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/api/og"],
  },
};

const PLAN_IDS = ["free", "starter", "pro", "enterprise"];

function formatPrecio(n) {
  if (n == null) return "A medida";
  if (n === 0) return "Gratis";
  return "$" + n.toLocaleString("es-AR") + "/mes";
}

const FILAS = [
  { label: "Empleados", get: (p) => (p.max_empleados >= 99999 ? "Ilimitados" : `Hasta ${p.max_empleados}`) },
  { label: "Proyectos", get: (p) => (p.max_proyectos >= 9999 ? "Ilimitados" : `Hasta ${p.max_proyectos}`) },
  { label: "Ubicaciones (geofencing)", get: (p) => (p.max_ubicaciones === 0 ? "—" : p.max_ubicaciones >= 999 ? "Ilimitadas" : `Hasta ${p.max_ubicaciones}`) },
  { label: "Fichaje digital", get: () => true },
  { label: "Chat operativo (bot IA)", get: (p) => p.modulos?.includes("chat") },
  { label: "Reportes de obra", get: (p) => p.modulos?.includes("reportes") },
  { label: "Geolocalización", get: (p) => p.geolocalizacion },
  { label: "Calendario y turnos", get: (p) => p.calendario },
  { label: "Reglas automáticas del bot", get: (p) => p.reglas_bot },
  { label: "Reportes avanzados", get: (p) => p.reportes_avanzados },
  { label: "Exportar CSV", get: (p) => p.exportar_csv },
  { label: "Exportar PDF", get: (p) => p.exportar_pdf },
  { label: "Acceso API", get: (p) => p.api_access },
  { label: "Soporte", get: (p) => (p.soporte === "sla" ? "SLA dedicado" : p.soporte === "prioritario" ? "Prioritario" : p.soporte === "email" ? "Email" : "Comunidad") },
];

function Celda({ value }) {
  if (typeof value === "string") return <span style={{ fontSize: 13, color: V.text }}>{value}</span>;
  return value
    ? <span style={{ color: V.green, fontSize: 16 }}>✓</span>
    : <span style={{ color: V.mute, fontSize: 16 }}>–</span>;
}

export default function PricingPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Gypi",
    description: DESCRIPTION,
    offers: PLAN_IDS.map((id) => ({
      "@type": "Offer",
      name: PLANES[id].nombre,
      price: PLANES[id].precio ?? 0,
      priceCurrency: "ARS",
      url: `${SITE_URL}/pricing`,
    })),
  };

  return (
    <div style={{ background: V.bg, color: V.text, minHeight: "100dvh", fontFamily: fB }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <header style={{ padding: "24px 24px 0", maxWidth: 1100, margin: "0 auto" }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: `linear-gradient(135deg,${V.amber},${V.violet})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontFamily: fH, fontSize: 12, fontWeight: 800, color: "#000" }}>G</span>
          </div>
          <span style={{ fontFamily: fH, fontSize: 15, fontWeight: 700, color: V.text }}>Gypi</span>
        </Link>
      </header>

      <section style={{ padding: "48px 24px 16px", maxWidth: 1100, margin: "0 auto", textAlign: "center" }}>
        <h1 style={{ fontFamily: fH, fontSize: 32, fontWeight: 800, margin: "0 0 8px" }}>Planes simples, sin sorpresas</h1>
        <p style={{ fontSize: 15, color: V.dim, maxWidth: 520, margin: "0 auto" }}>
          Empezá gratis y escalá cuando lo necesites. Todos los planes pagos incluyen soporte.
        </p>
      </section>

      <section style={{ padding: "16px 24px 48px", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
          {PLAN_IDS.map((id) => {
            const p = PLANES[id];
            const isPopular = id === "pro";
            return (
              <div key={id} style={{
                padding: 28, borderRadius: 20,
                background: isPopular ? `linear-gradient(160deg, ${V.surface}, ${V.surfHi})` : V.surface,
                border: isPopular ? `2px solid ${V.amber}` : `1px solid ${V.border}`,
                position: "relative",
              }}>
                {isPopular && (
                  <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", padding: "4px 16px", borderRadius: 20, background: V.amber, color: V.amberText, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em" }}>
                    POPULAR
                  </div>
                )}
                <h2 style={{ fontFamily: fH, fontSize: 20, fontWeight: 700, margin: isPopular ? "8px 0 4px" : "0 0 4px" }}>{p.nombre}</h2>
                <div style={{ fontSize: 13, color: V.dim, marginBottom: 16 }}>
                  Hasta {p.max_empleados >= 99999 ? "ilimitados" : p.max_empleados} empleados
                </div>
                <div style={{ marginBottom: 20 }}>
                  <span style={{ fontFamily: fH, fontSize: 32, fontWeight: 800, color: isPopular ? V.amber : V.text }}>
                    {formatPrecio(p.precio)}
                  </span>
                </div>
                <Link href="/" style={{
                  display: "block", textAlign: "center", width: "100%", padding: 12, borderRadius: 12,
                  textDecoration: "none", fontSize: 14, fontWeight: 700, fontFamily: fH,
                  background: isPopular ? V.amber : V.surfHi,
                  color: isPopular ? "#000" : V.text,
                }}>
                  {id === "free" ? "Empezar gratis" : id === "enterprise" ? "Contactanos" : "Elegir plan"}
                </Link>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── Comparador completo ─── */}
      <section style={{ padding: "0 24px 64px", maxWidth: 1100, margin: "0 auto", overflowX: "auto" }}>
        <h2 style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, textAlign: "center", margin: "0 0 24px" }}>Comparar planes en detalle</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: 12, color: V.dim, fontWeight: 600, borderBottom: `1px solid ${V.border}` }}>Característica</th>
              {PLAN_IDS.map((id) => (
                <th key={id} style={{ textAlign: "center", padding: "10px 12px", fontSize: 13, color: V.text, fontWeight: 700, borderBottom: `1px solid ${V.border}` }}>
                  {PLANES[id].nombre}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FILAS.map((fila) => (
              <tr key={fila.label}>
                <td style={{ padding: "10px 12px", fontSize: 13, color: V.dim, borderBottom: `1px solid ${V.border}` }}>{fila.label}</td>
                {PLAN_IDS.map((id) => (
                  <td key={id} style={{ textAlign: "center", padding: "10px 12px", borderBottom: `1px solid ${V.border}` }}>
                    <Celda value={fila.get(PLANES[id])} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ padding: "0 24px 80px", textAlign: "center" }}>
        <div style={{ maxWidth: 600, margin: "0 auto", padding: 48, background: `linear-gradient(160deg, ${V.surface}, ${V.surfHi})`, borderRadius: 28, border: `1px solid ${V.border}` }}>
          <h2 style={{ fontFamily: fH, fontSize: 24, fontWeight: 800, margin: "0 0 12px" }}>¿Listo para transformar tu gestión?</h2>
          <p style={{ fontSize: 15, color: V.dim, lineHeight: 1.6, margin: "0 0 28px" }}>
            Unite a las empresas que ya gestionan su equipo con Gypi. Plan Free sin límite de tiempo.
          </p>
          <Link href="/" style={{ display: "inline-block", padding: "16px 40px", borderRadius: 14, background: V.amber, color: V.amberText, textDecoration: "none", fontSize: 17, fontWeight: 700, fontFamily: fH }}>
            Crear mi empresa gratis
          </Link>
        </div>
      </section>

      <footer style={{ padding: "24px", borderTop: `1px solid ${V.border}`, textAlign: "center", fontSize: 12, color: V.dim }}>
        <Link href="/" style={{ color: V.dim, textDecoration: "none" }}>Gypi</Link> · <Link href="/privacy" style={{ color: V.dim, textDecoration: "none" }}>Privacidad</Link> · <Link href="/terms" style={{ color: V.dim, textDecoration: "none" }}>Términos</Link>
      </footer>
    </div>
  );
}
