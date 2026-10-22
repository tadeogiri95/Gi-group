'use client';
// app/components/PlantillaChecklist.jsx — Planta → Flota → ⚙ Checklist
// (Mantenimiento, parte 29; migración 127). Gerencia y Administración
// cambian las secciones y los puntos del checklist de vehículos: agregar,
// sacar, cambiar el nombre y decidir qué puntos piden un valor (mm, psi) y
// con qué mínimo. Los checklists ya hechos no cambian.
import { useEffect, useState } from "react";
import { sb, apiFetch } from "../lib/supabase";
import { faltaTabla } from "../lib/compras";
import { PLANTILLA_FABRICA, idNuevo, plantillaDe } from "../lib/checklistVehiculo";

const copia = (x) => JSON.parse(JSON.stringify(x));

export default function PlantillaChecklist() {
  const [secciones, setSecciones] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    sb.get("flota_config?select=checklist")
      .then((filas) => setSecciones(copia(plantillaDe(filas?.[0]))))
      .catch((e) => {
        setSecciones([]);
        setError(faltaTabla(e, "flota_config") ? "Para el checklist de vehículos falta correr la migración 127 en Supabase." : "No se pudo leer el checklist");
      });
  }, []);

  const cambiarSeccion = (i, cambios) => setSecciones((ss) => ss.map((s, j) => (j === i ? { ...s, ...cambios } : s)));
  const cambiarPunto = (i, k, cambios) => setSecciones((ss) => ss.map((s, j) => (j === i ? { ...s, puntos: s.puntos.map((p, m) => (m === k ? { ...p, ...cambios } : p)) } : s)));
  const sacarPunto = (i, k) => setSecciones((ss) => ss.map((s, j) => (j === i ? { ...s, puntos: s.puntos.filter((_, m) => m !== k) } : s)));
  const agregarPunto = (i) => setSecciones((ss) => ss.map((s, j) => (j === i ? { ...s, puntos: [...s.puntos, { id: idNuevo("punto", s.puntos.map((p) => p.id)), nombre: "", valor: null, minimo: null }] } : s)));
  const agregarSeccion = () => setSecciones((ss) => [...ss, { id: idNuevo("seccion", ss.map((s) => s.id)), nombre: "", emoji: "📋", puntos: [{ id: "punto", nombre: "", valor: null, minimo: null }] }]);

  const guardar = async (checklist) => {
    setError(null);
    setAviso(null);
    if (checklist) {
      const vacio = checklist.find((s) => !s.nombre.trim() || !s.puntos.length || s.puntos.some((p) => !p.nombre.trim()));
      if (vacio) { setError(`Completá los nombres de "${vacio.nombre || "la sección nueva"}" (cada sección necesita al menos un punto)`); return; }
    }
    setEnviando(true);
    try {
      const limpio = checklist && checklist.map((s) => ({
        id: s.id, nombre: s.nombre.trim(), emoji: s.emoji || null,
        puntos: s.puntos.map((p) => ({ id: p.id, nombre: p.nombre.trim(), valor: p.valor || null, minimo: p.minimo === "" || p.minimo == null ? null : Number(String(p.minimo).replace(",", ".")) })),
      }));
      const res = await apiFetch("/api/flota", { method: "POST", body: JSON.stringify({ accion: "checklist_plantilla_guardar", checklist: limpio }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo guardar");
      if (!checklist) setSecciones(copia(PLANTILLA_FABRICA));
      setAviso(checklist ? "Checklist guardado. Los próximos checklists usan estos puntos." : "Volvió el checklist de fábrica.");
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  if (secciones === null) return <div className="text-[14px] text-gypi-dim" role="status">Cargando el checklist…</div>;
  if (error && !secciones.length) return <div role="alert" className="text-[13px] text-gypi-red">{error}</div>;

  return (
    <div>
      <div className="text-[13px] text-gypi-dim mb-3">Las secciones y los puntos que se revisan en cada vehículo. Si un punto pide un valor (por ejemplo mm del dibujo), con mínimo se marca Mal solo cuando queda debajo.</div>
      {secciones.map((s, i) => (
        <section key={s.id} aria-label={s.nombre || "Sección nueva"} className="p-2.5 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
          <div className="flex gap-2 mb-2">
            <input className="g-input w-[56px] text-center" maxLength={8} aria-label="Ícono de la sección" value={s.emoji ?? ""} onChange={(e) => cambiarSeccion(i, { emoji: e.target.value })} />
            <input className="g-input flex-1 min-w-0 font-bold" maxLength={60} aria-label="Nombre de la sección" value={s.nombre} onChange={(e) => cambiarSeccion(i, { nombre: e.target.value })} placeholder="Nombre de la sección" />
            <button onClick={() => setSecciones((ss) => ss.filter((_, j) => j !== i))} aria-label={`Sacar la sección ${s.nombre}`} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] text-gypi-dim cursor-pointer">Sacar</button>
          </div>
          <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
            {s.puntos.map((p, k) => (
              <li key={p.id} className="flex gap-1.5 items-center flex-wrap">
                <input className="g-input flex-1 min-w-[160px]" maxLength={120} aria-label={`Punto ${k + 1} de ${s.nombre}`} value={p.nombre} onChange={(e) => cambiarPunto(i, k, { nombre: e.target.value })} placeholder="Qué se revisa" />
                <input className="g-input w-[70px]" maxLength={10} aria-label={`Unidad de ${p.nombre || "el punto"}`} value={p.valor ?? ""} onChange={(e) => cambiarPunto(i, k, { valor: e.target.value })} placeholder="Unidad" />
                <input className="g-input w-[70px]" inputMode="decimal" aria-label={`Mínimo de ${p.nombre || "el punto"}`} value={p.minimo ?? ""} onChange={(e) => cambiarPunto(i, k, { minimo: e.target.value })} placeholder="Mín." disabled={!p.valor} />
                <button onClick={() => sacarPunto(i, k)} aria-label={`Sacar ${p.nombre || "el punto"}`} className="min-h-[44px] min-w-[44px] bg-transparent border-none text-gypi-dim cursor-pointer">✕</button>
              </li>
            ))}
          </ul>
          <button onClick={() => agregarPunto(i)} className="min-h-[44px] bg-transparent border-none p-0 text-[13px] font-semibold text-gypi-dim cursor-pointer font-body">＋ Punto</button>
        </section>
      ))}
      <button onClick={agregarSeccion} className="g-btn g-btn-secondary w-full mb-3">＋ Sección</button>
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      {aviso && <div role="status" className="text-[13px] mb-2">✅ {aviso}</div>}
      <div className="flex gap-2">
        <button onClick={() => guardar(null)} disabled={enviando} className="g-btn g-btn-secondary flex-1">Volver al de fábrica</button>
        <button onClick={() => guardar(secciones)} disabled={enviando || !secciones.length} className="g-btn g-btn-primary flex-1">{enviando ? "Guardando…" : "Guardar"}</button>
      </div>
    </div>
  );
}
