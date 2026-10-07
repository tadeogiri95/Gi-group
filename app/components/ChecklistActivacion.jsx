"use client";
// Checklist de activación (ítem 24, F4-14): los primeros 14 días después del
// alta, el dueño ve qué le falta para que Gypi funcione en su planta.
import { useEffect, useState } from "react";
import { sb } from "../lib/supabase";
import { pasosActivacion, mostrarChecklist, diasRestantes } from "../lib/onboarding";

const claveCerrado = (empresaId) => `gypi_checklist_cerrado_${empresaId}`;

/** Consulta qué hay cargado en la empresa (cada consulta trae a lo sumo una fila). */
export async function estadoActivacion(get = sb.get) {
  const hay = async (path) => {
    try { return ((await get(path)) || []).length > 0; } catch { return false; }
  };
  const [ubicacion, equipo, horario, equipoActivo, ot, fichada, tarea] = await Promise.all([
    hay("geo_zonas?select=id&limit=1"),
    hay("empleados?rol=eq.operativo&activo=eq.true&select=id&limit=1"),
    hay("empleados?rol=eq.operativo&activo=eq.true&diagrama=not.is.null&select=id&limit=1"),
    hay("empleados?rol=eq.operativo&activo=eq.true&estado_activacion=eq.activo&select=id&limit=1"),
    hay("proyectos?select=id&limit=1"),
    hay("fichadas?select=id&limit=1"),
    hay("registro_actividades?select=id&limit=1"),
  ]);
  return { ubicacion, equipo, horario, equipoActivo, ot, fichada, tarea };
}

export default function ChecklistActivacion({ empresa, goto, cargar = estadoActivacion }) {
  const [pasos, setPasos] = useState(null);
  const [cerrado, setCerrado] = useState(() => {
    try { return localStorage.getItem(claveCerrado(empresa?.id)) === "1"; } catch { return false; }
  });
  const enPeriodo = mostrarChecklist({ creadaEl: empresa?.created_at, cerrado, pasos: [{ hecho: false }] });

  useEffect(() => {
    if (!enPeriodo) return;
    let vivo = true;
    cargar().then((hay) => { if (vivo) setPasos(pasosActivacion(hay)); });
    return () => { vivo = false; };
  }, [enPeriodo, cargar]);

  if (!pasos || !mostrarChecklist({ creadaEl: empresa?.created_at, cerrado, pasos })) return null;

  const hechos = pasos.filter((p) => p.hecho).length;
  const cerrar = () => {
    try { localStorage.setItem(claveCerrado(empresa?.id), "1"); } catch { /* sin almacenamiento */ }
    setCerrado(true);
  };

  return (
    <section aria-label="Primeros pasos" className="g-card mx-[18px] mb-3">
      <div className="flex justify-between items-start gap-2 mb-2">
        <div>
          <div className="text-sm font-bold text-gypi-text">Primeros pasos · {hechos} de {pasos.length}</div>
          <div className="text-[11px] text-gypi-dim">Te quedan {diasRestantes(empresa?.created_at)} días de puesta en marcha.</div>
        </div>
        <button onClick={cerrar} aria-label="Ocultar primeros pasos" className="min-w-[36px] min-h-[36px] rounded-lg border-none bg-transparent text-gypi-dim cursor-pointer">✕</button>
      </div>
      <div className="h-1.5 rounded bg-gypi-surf-hi mb-2 overflow-hidden">
        <div className="h-full bg-gypi-green" style={{ width: `${Math.round((hechos / pasos.length) * 100)}%` }} />
      </div>
      <ul className="list-none m-0 p-0">
        {pasos.map((p) => (
          <li key={p.id} className="flex items-center gap-2 py-1.5 border-b border-gypi-border last:border-0">
            <span aria-hidden="true" className="w-5 text-center">{p.hecho ? "✅" : "⬜"}</span>
            <div className="flex-1">
              <div className={`text-[13px] ${p.hecho ? "text-gypi-dim line-through" : "text-gypi-text font-semibold"}`}>{p.titulo}</div>
              {!p.hecho && <div className="text-[11px] text-gypi-dim">{p.detalle}</div>}
            </div>
            {!p.hecho && p.ir && goto && (
              <button onClick={() => goto(p.ir)} className="min-h-[36px] px-3 rounded-lg border border-gypi-border bg-transparent text-gypi-text text-xs font-bold cursor-pointer">Ir</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
