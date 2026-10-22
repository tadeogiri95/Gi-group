'use client';
// app/components/ChecklistsVehiculo.jsx — Los checklists hechos (Planta →
// Flota y ficha de cada vehículo; Mantenimiento, parte 29): la lista con su
// resultado y el detalle de uno, con lo que no está bien arriba y el PDF.
import { useState } from "react";
import { ESTADOS_PUNTO, imprimirChecklist, resumenChecklist } from "../lib/checklistVehiculo";

const ORDEN = { mal: 0, revisar: 1, bien: 2, na: 3 };
const ESTADO = Object.fromEntries(ESTADOS_PUNTO.map((e) => [e.id, e]));

export function fechaHoraCorta(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function ListaChecklists({ checklists, vehiculos = [], conPatente = true, onVer }) {
  const porId = new Map(vehiculos.map((v) => [v.id, v]));
  if (!checklists.length) return <div className="text-[14px] text-gypi-dim">Todavía no hay checklists.</div>;
  return (
    <ul aria-label="Checklists" className="list-none m-0 p-0 flex flex-col gap-1.5">
      {checklists.map((c) => (
        <li key={c.id}>
          <button onClick={() => onVer(c)} className="w-full p-2.5 min-h-[44px] rounded-[10px] border border-gypi-border bg-gypi-surface text-left cursor-pointer font-body text-gypi-text">
            <span className="block text-[14px] font-semibold">
              {conPatente ? `${porId.get(c.vehiculo_id)?.patente || "Vehículo"} · ` : ""}{fechaHoraCorta(c.created_at)}
            </span>
            <span className="block text-[12px] text-gypi-dim">
              {[resumenChecklist(c), c.empleado_nombre, c.km != null ? `${Number(c.km).toLocaleString("es-AR")} km` : null].filter(Boolean).join(" · ")}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function VerChecklist({ checklist, vehiculo, empresaNombre = "", onVolver }) {
  const [error, setError] = useState(null);
  const items = [...(checklist.items || [])].sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado]);
  const secciones = [...new Set((checklist.items || []).map((i) => i.seccion_nombre))];
  return (
    <div>
      <button onClick={onVolver} className="min-h-[44px] bg-transparent border-none p-0 text-[14px] font-semibold text-gypi-dim cursor-pointer font-body">← Volver</button>
      <div className="text-[18px] font-bold">Checklist · {vehiculo?.patente}</div>
      <div className="text-[13px] text-gypi-dim mb-1">
        {[fechaHoraCorta(checklist.created_at), checklist.empleado_nombre, checklist.km != null ? `${Number(checklist.km).toLocaleString("es-AR")} km` : null, checklist.combustible ? `Combustible ${checklist.combustible}` : null].filter(Boolean).join(" · ")}
      </div>
      <div className="text-[13px] text-gypi-dim mb-2">Revisó: {secciones.join(", ")}</div>
      <div className="text-[15px] font-semibold mb-2">{resumenChecklist(checklist)}</div>
      <ul aria-label="Puntos" className="list-none m-0 p-0 flex flex-col gap-1 mb-3">
        {items.map((i) => (
          <li key={`${i.seccion}.${i.punto}`} className={`text-[13px] ${i.estado === "bien" || i.estado === "na" ? "text-gypi-dim" : ""}`}>
            <span>{ESTADO[i.estado]?.emoji} {i.seccion_nombre}: {i.nombre}</span>
            {i.valor && <span> · {i.valor}{i.unidad ? ` ${i.unidad}` : ""}</span>}
            {i.nota && <span className="font-semibold"> · {i.nota}</span>}
            {i.foto && <a href={i.foto} target="_blank" rel="noopener noreferrer" className="ml-1">📷</a>}
          </li>
        ))}
      </ul>
      {checklist.observaciones && <div className="text-[14px] mb-3"><span className="font-semibold">Observaciones:</span> {checklist.observaciones}</div>}
      {checklist.fotos?.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mb-3">
          {checklist.fotos.map((u, n) => <a key={u} href={u} target="_blank" rel="noopener noreferrer"><img src={u} alt={`Foto del vehículo ${n + 1}`} className="h-14 w-20 object-cover rounded-[6px]" /></a>)}
        </div>
      )}
      <button onClick={() => { try { imprimirChecklist({ empresa: empresaNombre, vehiculo, checklist }); } catch (e) { setError(e.message); } }} className="g-btn g-btn-secondary w-full">📄 PDF</button>
      {error && <div role="alert" className="text-[13px] text-gypi-red mt-2">{error}</div>}
    </div>
  );
}
