export default function robots() {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/_next/', '/superadmin'],
      },
    ],
    sitemap: `${process.env.NEXT_PUBLIC_APP_URL || 'https://gypi.app'}/sitemap.xml`,
  };
}
