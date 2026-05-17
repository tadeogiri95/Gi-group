import './globals.css';

export const metadata = {
  title: 'GI Group RRHH',
  description: 'Sistema de gestión de RRHH de GI Amoblamientos SRL',
  manifest: '/manifest.json',}

export const viewport = {themeColor: '#F97316',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'GI Group',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;600;700;800&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body>{children}</body>
    </html>
  );
}
