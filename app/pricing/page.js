import Link from "next/link";
import { PLANES, LINEAS, ADDONS, TRAMOS, DIAS_TRIAL } from "../lib/plans";
import PricingCards from "./PricingCards";

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://gypi.app";
const TITLE = "Precios — Gypi";
const DESCRIPTION = `Asistencia y Planta por tramos de operarios activos, con add-ons. Precios en dólares cobrados en pesos. ${DIAS_TRIAL} días de prueba gratis, sin tarjeta.`;

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
  if (typeof value === "string") return <span className="text-[14px] text-gypi-text">{value}</span>;
  return value
    ? <span className="text-gypi-green-ink text-base" aria-label="Incluido">✓</span>
    : <span className="text-gypi-mute text-base" aria-label="No incluido">–</span>;
}

// Logo chico: la G con los colores de Gypi
const Logo = () => (
  <span className="w-8 h-8 rounded-lg bg-linear-135 from-gypi-amber to-gypi-violet flex items-center justify-center" aria-hidden="true">
    <span className="font-heading text-xs font-extrabold text-black">G</span>
  </span>
);

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
    <div className="bg-gypi-bg text-gypi-text min-h-dvh font-body">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <header className="px-6 pt-6 max-w-[1100px] mx-auto">
        <Link href="/" className="inline-flex items-center gap-2.5 no-underline">
          <Logo />
          <span className="font-heading text-[15px] font-bold text-gypi-text">Gypi</span>
        </Link>
      </header>

      <section className="px-6 pt-12 pb-4 max-w-[1100px] mx-auto text-center">
        <h1 className="font-heading text-[32px] font-extrabold m-0 mb-2">Planes simples, sin sorpresas</h1>
        <p className="text-[15px] text-gypi-dim max-w-[520px] mx-auto">
          Pagás según cuánta gente tenés y qué querés controlar. {DIAS_TRIAL} días de prueba gratis, con todo incluido y sin tarjeta.
        </p>
      </section>

      <section className="px-6 pt-4 pb-12 max-w-[1100px] mx-auto">
        <PricingCards />
      </section>

      {/* ─── Comparador completo ─── */}
      <section className="px-6 pb-16 max-w-[1100px] mx-auto overflow-x-auto">
        <h2 className="font-heading text-[22px] font-bold text-center m-0 mb-6">Comparar planes en detalle</h2>
        <table className="w-full border-collapse min-w-[640px]">
          <thead>
            <tr>
              <th className="text-left px-3 py-2.5 text-[13px] text-gypi-dim font-semibold border-b border-gypi-border">Qué incluye</th>
              {PLAN_IDS.map((id) => (
                <th key={id} className="text-center px-3 py-2.5 text-[14px] text-gypi-text font-bold border-b border-gypi-border">{NOMBRE[id]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FILAS.map((fila) => (
              <tr key={fila.label}>
                <td className="px-3 py-2.5 text-[14px] text-gypi-dim border-b border-gypi-border">{fila.label}</td>
                {PLAN_IDS.map((id) => (
                  <td key={id} className="text-center px-3 py-2.5 border-b border-gypi-border">
                    <Celda value={fila.get(PLANES[id])} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="px-6 pb-20 text-center">
        <div className="max-w-[600px] mx-auto p-12 bg-linear-160 from-gypi-surface to-gypi-surf-hi rounded-[28px] border border-gypi-border">
          <h2 className="font-heading text-[24px] font-extrabold m-0 mb-3">Probalo con tu equipo</h2>
          <p className="text-[15px] text-gypi-dim leading-relaxed m-0 mb-7">
            {DIAS_TRIAL} días de prueba gratis, con todas las funciones y sin tarjeta.
          </p>
          <Link href="/?registro=1" className="inline-block px-10 py-4 rounded-[14px] bg-gypi-amber text-gypi-on-amber no-underline text-[17px] font-bold font-heading">
            Crear mi empresa gratis
          </Link>
        </div>
      </section>

      <footer className="p-6 border-t border-gypi-border text-center text-[13px] text-gypi-dim">
        <Link href="/" className="text-gypi-dim no-underline">Gypi</Link> · <Link href="/nosotros" className="text-gypi-dim no-underline">Nosotros</Link> · <Link href="/contacto" className="text-gypi-dim no-underline">Contacto</Link> · <Link href="/privacy" className="text-gypi-dim no-underline">Privacidad</Link> · <Link href="/terms" className="text-gypi-dim no-underline">Términos</Link>
      </footer>
    </div>
  );
}
