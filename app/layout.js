import './globals.css';

/* ═══════════════════════════════════════════════════════
   ROOT LAYOUT — SEO + Open Graph + Structured Data
   ═══════════════════════════════════════════════════════ */

const SITE_URL = 'https://gypi.app';
const SITE_NAME = 'Gypi';
const TITLE = 'Gypi — Gestión y productividad industrial';
const DESCRIPTION = 'Fichaje digital, seguimiento de obra y reportes en tiempo real. Todo desde el celular, sin instalar nada. Probá gratis.';

export const metadata = {
  metadataBase: new URL(SITE_URL),

  title: {
    default: TITLE,
    template: '%s | Gypi',
  },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  manifest: '/manifest.json',
  keywords: [
    'gestión industrial', 'fichaje digital', 'control de asistencia',
    'productividad', 'obra', 'reportes', 'PWA', 'geolocalización',
    'control de personal', 'sistema de fichaje', 'Argentina',
  ],
  authors: [{ name: 'Gypi', url: SITE_URL }],
  creator: 'Gypi',
  publisher: 'Gypi',

  /* ── Open Graph ── */
  openGraph: {
    type: 'website',
    locale: 'es_AR',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: '/api/og',
        width: 1200,
        height: 630,
        alt: 'Gypi — Gestión y productividad industrial',
        type: 'image/png',
      },
    ],
  },

  /* ── Twitter Card ── */
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/api/og'],
  },

  /* ── Robots ── */
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },

  /* ── Misc ── */
  category: 'technology',
  alternates: {
    canonical: SITE_URL,
  },
  icons: {
    icon: '/favicon.svg',
    apple: '/icons/icon-192.png',
  },
};

export const viewport = {
  themeColor: '#F97316',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  /* JSON-LD Structured Data */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    description: DESCRIPTION,
    url: SITE_URL,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'ARS',
      description: 'Plan Free — hasta 5 empleados',
    },
    featureList: [
      'Fichaje digital desde el celular',
      'Geolocalización de fichadas',
      'Reportes de cumplimiento y horas',
      'Seguimiento de actividad en obra',
      'Reportes de instalación con IA',
      'Multi-empresa con divisiones y roles',
    ],
  };

  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;600;700;800&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
