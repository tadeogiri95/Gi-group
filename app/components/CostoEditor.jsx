'use client';
// app/components/CostoEditor.jsx — Costo de la hora de mano de obra
// (Órdenes de Producción, parte 8; ítem 39). Un solo valor para toda la
// fábrica. Solo lo ve y lo cambia el dueño. Desde la auditoría del 12/11
// (parte 10) se carga en tres partes: Mano de obra, Costo Burden y GAC.
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { fmtPesos } from "../lib/costo";
import { PARTES_HORA, desgloseParaEditar, totalDesglose } from "../lib/costoHoraDesglose";

/** "12.500" → 12500; "12500,50" → 12500.5; "$ 9.000" → 9000. null si no es un número. */
export function leerPesos(texto) {
  let s = String(texto ?? "").replace(/[$\s]/g, "").slice(0, 20);
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else {
    // "12.500" es doce mil quinientos (punto de miles), no doce coma cinco
    const partes = s.split(".");
    if (partes.length > 1 && partes[0].length <= 3 && partes.slice(1).every((p) => p.length === 3)) s = partes.join("");
  }
  if (!/^[\d.]+$/.test(s) || s.split(".").length > 2 || s.startsWith(".") || s.endsWith(".")) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const aTexto = (n) => (n ? String(n).replace(".", ",") : "");

export default function CostoEditor({ avisar = () => {} }) {
  const [guardado, setGuardado] = useState(undefined);
  const [desgloseGuardado, setDesgloseGuardado] = useState(null);
  const [textos, setTextos] = useState({ mano_obra: "", burden: "", gac: "" });
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState(null);

  useEffect(() => {
    let vivo = true;
    apiFetch("/api/costo-hora")
      .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }))
      .then(({ ok, data }) => {
        if (!vivo) return;
        if (!ok) { setAviso(data.error || "No se pudo leer el costo de la hora."); setGuardado(null); return; }
        if (data.falta_migracion) setAviso("Para cargar el costo de la hora falta correr la migración 102 en Supabase.");
        setGuardado(data.costo_hora ?? null);
        setDesgloseGuardado(data.desglose || null);
        const d = desgloseParaEditar(data.desglose, data.costo_hora);
        setTextos({ mano_obra: aTexto(d.mano_obra), burden: aTexto(d.burden), gac: aTexto(d.gac) });
      })
      .catch(() => { if (vivo) { setAviso("No se pudo leer el costo de la hora."); setGuardado(null); } });
    return () => { vivo = false; };
  }, []);

  // Una caja vacía cuenta como cero; lo que no es número, no
  const valores = Object.fromEntries(PARTES_HORA.map((p) => [p.id, textos[p.id].trim() ? leerPesos(textos[p.id]) : 0]));
  const malas = PARTES_HORA.filter((p) => valores[p.id] == null || valores[p.id] < 0 || valores[p.id] > 99999999);
  const total = malas.length ? null : totalDesglose(valores);
  const valido = total != null && total > 0 && total <= 99999999;
  const igual = valido && guardado === total && desgloseGuardado && PARTES_HORA.every((p) => desgloseGuardado[p.id] === valores[p.id]);

  const guardar = async () => {
    if (!valido) return;
    setGuardando(true);
    try {
      const r = await apiFetch("/api/costo-hora", { method: "POST", body: JSON.stringify({ desglose: valores }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "No se pudo guardar el costo de la hora");
      setGuardado(data.costo_hora);
      setDesgloseGuardado(data.desglose || null);
      setAviso(null);
      avisar("Costo de la hora guardado");
    } catch (err) {
      avisar(err.message, "error");
    } finally {
      setGuardando(false);
    }
  };

  if (guardado === undefined) return <div className="gypi-dots py-6" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>;

  return (
    <div className="g-card mb-3.5">
      <div className="text-[13px] text-gypi-dim mb-3 leading-normal">
        Cuánto cuesta una hora de trabajo, una sola tasa para toda la empresa, en sus tres partes. Gypi usa la suma para la mano de obra de cada OT (planta, retrabajo e instalación) y la muestra repartida en el costo de la OT. Solo lo ven el dueño y los supervisores.
      </div>
      {aviso && <div role="alert" className="text-[12px] text-gypi-red mb-2.5">{aviso}</div>}
      <div className="flex flex-col gap-2.5 mb-3" role="group" aria-label="Partes de la hora">
        {PARTES_HORA.map((p) => (
          <div key={p.id}>
            <label htmlFor={`hora-${p.id}`} className="g-label mb-1 block">{p.nombre} ($ por hora)</label>
            <input id={`hora-${p.id}`} className={`g-input w-full ${valores[p.id] == null ? "border-gypi-red" : ""}`} inputMode="decimal" value={textos[p.id]}
              onChange={(e) => setTextos((t) => ({ ...t, [p.id]: e.target.value }))} placeholder="0" aria-describedby={`ayuda-${p.id}`} />
            <div id={`ayuda-${p.id}`} className="text-[12px] text-gypi-dim mt-0.5">{p.ayuda}</div>
          </div>
        ))}
      </div>
      <div className="flex items-baseline justify-between gap-2 p-2.5 rounded-[10px] bg-gypi-bg border border-gypi-border mb-1.5" aria-live="polite">
        <span className="text-[14px] font-semibold">Hora completa</span>
        <span className="text-[18px] font-bold font-mono">{total != null ? fmtPesos(total) : "—"}</span>
      </div>
      <div className="text-xs text-gypi-dim mb-3.5">
        {malas.length ? <span className="text-gypi-red">Escribí solo el número en {malas.map((p) => p.nombre).join(", ")}, por ejemplo 9.500.</span>
          : guardado != null ? `Guardada: ${fmtPesos(guardado)} por hora.${desgloseGuardado ? "" : " Todavía sin desglose: completá las tres partes y guardá."}` : "Todavía no la cargaste."}
      </div>
      <div className="text-xs text-gypi-dim mb-3.5">
        Las horas de instalación salen de la etapa que se llama &quot;Instalación&quot; (Más → Producción → Etapas).
      </div>
      <button onClick={guardar} disabled={guardando || !valido || igual} className="g-btn g-btn-primary w-full">
        {guardando ? "Guardando…" : "Guardar costo de la hora"}
      </button>
    </div>
  );
}
