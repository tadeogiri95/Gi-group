// GET /api/geocode?q=… — Proxy a Nominatim (OpenStreetMap) para buscar
// direcciones al configurar las zonas de fichaje.
//
// F2-16: antes era público. La política de uso de Nominatim exige identificarse
// y prohíbe el uso masivo, así que ahora: (1) exige sesión, (2) cachea las
// respuestas y (3) limita los pedidos por empresa.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { limiteExcedido } from "../../lib/rateLimit";

const MAX_POR_EMPRESA = 60; // por ventana de 15 minutos
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map(); // query normalizada → { ts, results }

function leerCache(clave) {
  const hit = cache.get(clave);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    cache.delete(clave);
    return null;
  }
  return hit.results;
}

function guardarCache(clave, results) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(clave, { ts: Date.now(), results });
}

export async function GET(req) {
  const sesion = await validarToken(req);
  if (!sesion) return respuestaNoAutorizado();

  const q = req.nextUrl.searchParams.get("q");
  if (!q || q.trim().length < 2) {
    return NextResponse.json([]);
  }
  const consulta = q.trim().slice(0, 200);
  const clave = consulta.toLowerCase();

  const enCache = leerCache(clave);
  if (enCache) return NextResponse.json(enCache);

  if (await limiteExcedido(`geocode:${sesion.empresa_id}`, MAX_POR_EMPRESA)) {
    return NextResponse.json({ error: "Demasiadas búsquedas. Probá de nuevo en unos minutos." }, { status: 429 });
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(consulta)}&format=json&limit=5&accept-language=es`;
    const res = await fetch(url, {
      headers: { "User-Agent": `Gypi/1.0 (+${process.env.NEXT_PUBLIC_APP_URL || "https://gypi.app"})` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return NextResponse.json([]);
    const data = await res.json();
    const results = data.map((r) => ({
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
      label: r.display_name,
    }));
    guardarCache(clave, results);
    return NextResponse.json(results);
  } catch (e) {
    console.error("Geocode proxy error:", e.message);
    return NextResponse.json({ error: "geocode_failed" }, { status: 502 });
  }
}
