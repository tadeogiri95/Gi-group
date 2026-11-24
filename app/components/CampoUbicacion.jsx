'use client';
// app/components/CampoUbicacion.jsx — Dirección y pin en el mapa (Logística,
// parte 1; 203). Se escribe la dirección y se busca (también acepta un link
// de Google Maps, coordenadas o un Plus Code), o se usa el GPS del celular, o
// se toca el mapa para mover el pin. "Abrir en Google Maps" muestra cómo
// quedó. Controlado: value = { direccion, lat, lng }.
import { useState } from "react";
import dynamic from "next/dynamic";
import { apiFetch } from "../lib/supabase";
import { coordsValidas, decodePlusCode, linkGoogleMaps, parseMapsInput } from "../lib/ubicacion";

const LeafletMap = dynamic(() => import("./LeafletMap"), {
  ssr: false,
  loading: () => <div className="h-full flex items-center justify-center text-gypi-dim text-[13px]">Cargando mapa…</div>,
});

// Sin pin todavía, el mapa arranca en Buenos Aires
const CENTRO = { lat: -34.6037, lng: -58.3816 };
const redondear = (n) => Number(Number(n).toFixed(6));

export default function CampoUbicacion({ id = "ubicacion", value, onChange }) {
  const { direccion = "", lat = null, lng = null } = value || {};
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const conPin = coordsValidas(lat, lng);
  const link = linkGoogleMaps({ lat, lng, direccion });
  const poner = (cambios) => onChange({ direccion, lat, lng, ...cambios });
  const ponerPin = (a, o) => { poner({ lat: redondear(a), lng: redondear(o) }); setAviso(null); };

  const buscar = async () => {
    const q = String(direccion || "").trim();
    if (q.length < 3) { setAviso("Escribí la dirección (calle, número y localidad)."); return; }
    setAviso(null);
    setResultados([]);
    // Un link de Google Maps, coordenadas o un Plus Code: el pin sale de ahí
    const punto = parseMapsInput(q) || (q.includes("+") ? decodePlusCode(q.split(/\s+/).find((p) => p.includes("+")) || q) : null);
    if (punto) { onChange({ direccion: /^https?:/i.test(q) ? "" : direccion, lat: punto.lat, lng: punto.lng }); return; }
    setBuscando(true);
    try {
      const res = await apiFetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      const data = await res.json().catch(() => []);
      if (!res.ok || !Array.isArray(data)) { setAviso(data?.error || "No se pudo buscar la dirección. Probá de nuevo."); return; }
      if (!data.length) { setAviso("No encontré esa dirección. Probá con calle, número y localidad, o tocá el mapa."); return; }
      if (data.length === 1) ponerPin(data[0].lat, data[0].lng);
      else setResultados(data);
    } catch {
      setAviso("No se pudo buscar la dirección. Revisá la conexión.");
    } finally {
      setBuscando(false);
    }
  };

  const usarGps = () => {
    if (!navigator?.geolocation) { setAviso("Este celular no deja usar la ubicación."); return; }
    setAviso(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => ponerPin(pos.coords.latitude, pos.coords.longitude),
      () => setAviso("No se pudo tomar la ubicación. Revisá que Gypi tenga permiso."),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  return (
    <div className="mb-2">
      <label className="g-label" htmlFor={`${id}-dir`}>Dirección</label>
      <div className="flex gap-2 mb-1.5">
        <input id={`${id}-dir`} className="g-input flex-1 min-w-0" value={direccion || ""} maxLength={300}
          onChange={(e) => poner({ direccion: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscar(); } }}
          placeholder="Calle 123, Localidad (o pegá un link de Maps)" />
        <button type="button" className="g-btn g-btn-secondary whitespace-nowrap" onClick={buscar} disabled={buscando}>
          {buscando ? "Buscando…" : "🔍 Buscar"}
        </button>
      </div>
      {aviso && <div role="alert" className="text-[13px] text-gypi-red mb-1.5">{aviso}</div>}
      {resultados.length > 0 && (
        <ul aria-label="Direcciones encontradas" className="list-none m-0 p-0 mb-1.5 flex flex-col gap-1">
          {resultados.map((r, i) => (
            <li key={`${r.lat},${r.lng},${i}`}>
              <button type="button" onClick={() => { ponerPin(r.lat, r.lng); setResultados([]); }}
                className="w-full text-left p-2 min-h-[44px] rounded-lg border border-gypi-border bg-gypi-bg text-[13px] text-gypi-text cursor-pointer">
                📍 {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="h-[220px] rounded-xl overflow-hidden border border-gypi-border mb-1.5">
        <LeafletMap lat={conPin ? Number(lat) : CENTRO.lat} lng={conPin ? Number(lng) : CENTRO.lng} zoom={conPin ? 16 : 11} radio={0} onMapClick={ponerPin} />
      </div>
      <div className="text-[12px] text-gypi-dim mb-1.5">
        {conPin ? "Tocá el mapa para mover el pin a la puerta exacta." : "Sin pin todavía: buscá la dirección o tocá el mapa donde queda."}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="g-btn g-btn-secondary" onClick={usarGps}>📡 Estoy acá</button>
        {conPin && <button type="button" className="g-btn g-btn-secondary" onClick={() => poner({ lat: null, lng: null })}>Sacar el pin</button>}
        {link && <a className="g-btn g-btn-secondary no-underline" href={link} target="_blank" rel="noopener noreferrer">🗺️ Abrir en Google Maps</a>}
      </div>
    </div>
  );
}
