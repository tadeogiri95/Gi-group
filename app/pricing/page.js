import Link from "next/link";
import { fH, fB } from "../lib/theme";
import { PLANES, LINEAS, ADDONS, TRAMOS } from "../lib/plans";
import PricingCards from "./PricingCards";

const AMBER = "var(--color-empresa-primary, #F97316)";
const AMBER_TEXT = "#000";
const VIOLET = "var(--color-empresa-secondary, #7C3AED)";
const GREEN = "#16A34A";
const MUTE = "var(--color-text-muted)";
const DIM = "var(--color-text-dim)";
const TEXT = "var(--color-text)";
const BG = "var(--color-bg)";
const SURFACE = "var(--color-surface)";
const SURF_HI = "var(--color-surf-hi)";
const BORDER = "var(--color-border)";

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://gypi.app";
const TITLE = "Precios — Gypi";
const DESCRIPTION = "Asistencia y Planta por tramos de operarios activos, con add-ons. Precios en dólares cobrados en pesos. 30 días de prueba gratis, sin tarjeta.";

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

// Comparador: el tramo de 40 de cada línea (las capacidades no cambian con el tramo)
const PLAN_IDS = ["asistencia_40", "planta_40"];
const NOMBRE = { asistencia_40: LINEAS.asistencia.nombre, planta_40: LINEAS.planta.nombre };

const FILAS = [
  { label: "Operarios activos", get: () => `Hasta ${TRAMOS.join(" / ")}` },
  { label: "Fichaje (botón, QR, PIN, kiosco)", get: () => true },
  { label: "Geolocalización", get: (p) => p.geolocalizacion },
  { label: "Solicitudes, horarios y turnos", get: (p) => p.calendario },
  { label: "Liquidación de horas", get: (p) => p.modulos?.includes("reportes") },
  { label: "Resumen semanal por email", get: () => true },
  { label: "Órdenes de trabajo y etapas", get: (p) => p.modulos?.includes("proyectos") },
  { label: "Tareas con tiempo improductivo y causa", get: (p) => p.modulos?.includes("actividad") },
  { label: "Reportes por OT y avanzados", get: (p) => p.reportes_avanzados },
  { label: "Exportar CSV y PDF", get: (p) => p.exportar_csv && p.exportar_pdf },
  { label: "Asistente IA", get: (p) => `${p.ia_consultas_mes} consultas/mes (más con el add-on)` },
  { label: ADDONS.campo.nombre, get: () => "Add-on" },
  { label: "Soporte", get: (p) => (p.soporte === "prioritario" ? "Prioritario" : "Email") },
];

function Celda({ value }) {
  if (typeof value === "string") return <span style={{ fontSize: 13, color: TEXT }}>{value}</span>;
  return value
    ? <span style={{ color: GREEN, fontSize: 16 }}>✓</span>
    : <span style={{ color: MUTE, fontSize: 16 }}>–</span>;
}

export default function PricingPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Gypi",
    description: DESCRIPTION,
    offers: Object.values(LINEAS).map((l) => ({
      "@type": "Offer",
      name: l.nombre,
      price: l.usd[TRAMOS[0]],
      priceCurrency: "USD",
      url: `${SITE_URL}/pricing`,
    })),
  };

  return (
    <div style={{ background: BG, color: TEXT, minHeight: "100dvh", fontFamily: fB }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <header style={{ padding: "24px 24px 0", maxWidth: 1100, margin: "0 auto" }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: `linear-gradient(135deg,${AMBER},${VIOLET})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontFamily: fH, fontSize: 12, fontWeight: 800, color: "#000" }}>G</span>
          </div>
          <span style={{ fontFamily: fH, fontSize: 15, fontWeight: 700, color: TEXT }}>Gypi</span>
        </Link>
      </header>

      <section style={{ padding: "48px 24px 16px", maxWidth: 1100, margin: "0 auto", textAlign: "center" }}>
        <h1 style={{ fontFamily: fH, fontSize: 32, fontWeight: 800, margin: "0 0 8px" }}>Planes simples, sin sorpresas</h1>
        <p style={{ fontSize: 15, color: DIM, maxWidth: 520, margin: "0 auto" }}>
          Pagás según cuánta gente tenés y qué querés controlar. 30 días de prueba gratis, con todo incluido y sin tarjeta.
        </p>
      </section>

      <section style={{ padding: "16px 24px 48px", maxWidth: 1100, margin: "0 auto" }}>
        <PricingCards />
      </section>

      {/* ─── Comparador completo ─── */}
      <section style={{ padding: "0 24px 64px", maxWidth: 1100, margin: "0 auto", overflowX: "auto" }}>
        <h2 style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, textAlign: "center", margin: "0 0 24px" }}>Comparar planes en detalle</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "10px 12px", fontSize: 12, color: DIM, fontWeight: 600, borderBottom: `1px solid ${BORDER}` }}>Característica</th>
              {PLAN_IDS.map((id) => (
                <th key={id} style={{ textAlign: "center", padding: "10px 12px", fontSize: 13, color: TEXT, fontWeight: 700, borderBottom: `1px solid ${BORDER}` }}>
                  {NOMBRE[id]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FILAS.map((fila) => (
              <tr key={fila.label}>
                <td style={{ padding: "10px 12px", fontSize: 13, color: DIM, borderBottom: `1px solid ${BORDER}` }}>{fila.label}</td>
                {PLAN_IDS.map((id) => (
                  <td key={id} style={{ textAlign: "center", padding: "10px 12px", borderBottom: `1px solid ${BORDER}` }}>
                    <Celda value={fila.get(PLANES[id])} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ padding: "0 24px 80px", textAlign: "center" }}>
        <div style={{ maxWidth: 600, margin: "0 auto", padding: 48, background: `linear-gradient(160deg, ${SURFACE}, ${SURF_HI})`, borderRadius: 28, border: `1px solid ${BORDER}` }}>
          <h2 style={{ fontFamily: fH, fontSize: 24, fontWeight: 800, margin: "0 0 12px" }}>¿Listo para transformar tu gestión?</h2>
          <p style={{ fontSize: 15, color: DIM, lineHeight: 1.6, margin: "0 0 28px" }}>
            Unite a las empresas que ya gestionan su equipo con Gypi. 30 días de prueba gratis, sin tarjeta.
          </p>
          <Link href="/" style={{ display: "inline-block", padding: "16px 40px", borderRadius: 14, background: AMBER, color: AMBER_TEXT, textDecoration: "none", fontSize: 17, fontWeight: 700, fontFamily: fH }}>
            Crear mi empresa gratis
          </Link>
        </div>
      </section>

      <footer style={{ padding: "24px", borderTop: `1px solid ${BORDER}`, textAlign: "center", fontSize: 12, color: DIM }}>
        <Link href="/" style={{ color: DIM, textDecoration: "none" }}>Gypi</Link> · <Link href="/nosotros" style={{ color: DIM, textDecoration: "none" }}>Nosotros</Link> · <Link href="/contacto" style={{ color: DIM, textDecoration: "none" }}>Contacto</Link> · <Link href="/privacy" style={{ color: DIM, textDecoration: "none" }}>Privacidad</Link> · <Link href="/terms" style={{ color: DIM, textDecoration: "none" }}>Términos</Link>
      </footer>
    </div>
  );
}
