'use client';
// app/components/LogisticaRecorrido.jsx — Botones con el recorrido de un viaje
// en Google Maps (Logística, partes 2 y 3). Los usan la ficha del viaje del
// Dueño y Mis viajes del chofer.
import { linksRecorrido } from "../lib/logistica";

/** Botones con el recorrido en Google Maps (uno por tramo). */
export default function BotonesRecorrido({ origen, paradas, vuelve }) {
  const { tramos, sinUbicar } = linksRecorrido({ origen, paradas, vuelve });
  if (!tramos.length) {
    return <div className="text-[13px] text-gypi-dim mb-2">Para ver el recorrido, las paradas tienen que tener dirección o pin.</div>;
  }
  return (
    <div className="mb-2">
      <div className="flex flex-wrap gap-2">
        {tramos.map((t, i) => (
          <a key={t.url} href={t.url} target="_blank" rel="noopener noreferrer" className="g-btn g-btn-secondary no-underline">
            🗺️ {tramos.length > 1 ? `Recorrido, tramo ${i + 1} (paradas ${t.desde} a ${t.hasta})` : "Ver recorrido en Google Maps"}
          </a>
        ))}
      </div>
      {tramos.length > 1 && <div className="text-[12px] text-gypi-dim mt-1">Google Maps acepta hasta 9 paradas por link: el recorrido va en {tramos.length} tramos.</div>}
      {sinUbicar > 0 && <div className="text-[13px] mt-1">⚠️ {sinUbicar === 1 ? "Una parada no tiene" : `${sinUbicar} paradas no tienen`} dirección: no {sinUbicar === 1 ? "entra" : "entran"} en el recorrido.</div>}
    </div>
  );
}
