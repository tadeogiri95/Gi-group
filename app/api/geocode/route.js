import { NextResponse } from "next/server";

export async function GET(req) {
  const q = req.nextUrl.searchParams.get("q");
  if (!q || q.trim().length < 2) {
    return NextResponse.json([]);
  }
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&accept-language=es`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Gypi-App/1.0 (server-side proxy)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return NextResponse.json([]);
    const data = await res.json();
    const results = data.map((r) => ({
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
      label: r.display_name,
    }));
    return NextResponse.json(results);
  } catch (e) {
    console.error("Geocode proxy error:", e.message);
    return NextResponse.json({ error: "geocode_failed" }, { status: 502 });
  }
}
