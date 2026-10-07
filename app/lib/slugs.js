// app/lib/slugs.js — Direcciones de empresa (gypi.app/<slug>) (H15, ítem 33).

// Rutas de la propia app y la marca: ninguna empresa puede tomarlas como slug
export const SLUGS_RESERVADOS = new Set([
  "gypi", "api", "app", "www", "admin", "superadmin", "pricing", "precios", "terms", "privacy",
  "nosotros", "contacto", "docs", "reactivar", "monitoring", "demo", "login", "registro",
  "kiosco", "unirse", "offline", "manifest", "icons", "static", "_next",
]);

// Empresas que cambiaron de dirección: la vieja lleva a la nueva cuando ya no
// existe en la base (así funciona en cualquier orden: antes o después del cambio).
export const SLUGS_RENOMBRADOS = {
  gypi: "gi-group", // piloto: el slug "gypi" es la marca (H15)
};

export function slugReservado(slug) {
  return SLUGS_RESERVADOS.has(String(slug || "").toLowerCase());
}

/** Nueva dirección de una empresa renombrada (o null). */
export function slugNuevo(slugViejo) {
  return SLUGS_RENOMBRADOS[String(slugViejo || "").toLowerCase()] || null;
}

/** Misma ruta con el slug reemplazado: "/gypi/kiosco?x=1" → "/gi-group/kiosco?x=1". */
export function rutaRenombrada(pathname, search = "") {
  const partes = String(pathname || "/").split("/");
  const nuevo = slugNuevo(partes[1]);
  if (!nuevo) return null;
  partes[1] = nuevo;
  return partes.join("/") + (search || "");
}
