// app/lib/pushData.js — Saneo del payload `data` de /api/send-push (F2-08).
// Separado de la ruta porque Next.js no permite exports extra en route.js.

// Ruta interna segura: "/algo", nunca "//otro-sitio", "/\otro" ni "https://…".
export function esRutaInterna(v) {
  return typeof v === "string" && v.startsWith("/") && !v.startsWith("//") && !v.includes("\\");
}

// Datos que viajan con la notificación. `url` solo se acepta si es una ruta
// interna ("/algo", nunca "//otro-sitio" ni "https://…"); el service worker
// vuelve a validarlo. Los operarios solo pueden mandar `tag`.
export function sanitizarDataPush(data = {}, esGestion = false) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (k === "url") {
      if (esGestion && esRutaInterna(v)) out.url = v;
    } else if (k === "tag" || esGestion) {
      out[k] = v;
    }
  }
  return out;
}

