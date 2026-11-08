'use client';
// app/components/CostoFinalOt.jsx — 🧾 Costo final de la OT en su detalle
// (costo de OT, parte C; /api/costo-final). Solo Dueño y Supervisor.
// Costo final = materiales + costo de la hora × horas-persona, calculado al
// cerrarse la OT, con su constancia (se imprime o guarda como PDF). Si la OT
// se reabre, la constancia queda anulada en el historial.
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { fmtPesos } from "../lib/costo";
import { textoHoras } from "../lib/horasOt";
import { textoOt } from "../lib/nombreOt";
import { MOTIVOS_COSTO, imprimirConstancia } from "../lib/costoFinal";
import { useToast } from "./ui/Toast";

const fechaHora = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

const boton = "min-h-[40px] px-3 rounded-lg border border-gypi-border bg-transparent text-[13px] font-semibold text-gypi-text cursor-pointer disabled:opacity-50";

export default function CostoFinalOt({ proyecto }) {
  const toast = useToast();
  const ot = proyecto?.ot;
  const estado = proyecto?.estado;
  const [datos, setDatos] = useState(null);
  const [version, setVersion] = useState(0);
  const [trabajando, setTrabajando] = useState(false);
  const [verHistorial, setVerHistorial] = useState(false);

  useEffect(() => {
    if (!ot) return;
    let vivo = true;
    apiFetch(`/api/costo-final?ot=${encodeURIComponent(ot)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => { if (vivo) setDatos(d); })
      .catch(() => { if (vivo) setDatos(null); });
    return () => { vivo = false; };
  }, [ot, estado, version]);

  const calcular = async (accion) => {
    if (accion === "recalcular" && !window.confirm("¿Volver a calcular el costo final con los precios y horas de ahora? El de antes queda en el historial.")) return;
    setTrabajando(true);
    try {
      const res = await apiFetch("/api/costo-final", { method: "POST", body: JSON.stringify({ accion, ot }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) throw new Error(d.error || "No se pudo calcular el costo final");
      toast.success("✅ Costo final calculado");
      setVersion((v) => v + 1);
    } catch (e) {
      toast.error(e.message);
    }
    setTrabajando(false);
  };

  const imprimir = () => {
    try { imprimirConstancia({ costo: datos.vigente, otTexto: textoOt(proyecto) || ot }); } catch (e) { toast.error(e.message); }
  };

  if (datos?.falta_migracion) {
    return (
      <section aria-label="Costo final" className="mb-4">
        <div className="g-label mb-1">🧾 Costo final</div>
        <div className="text-xs text-gypi-dim">{datos.falta_migracion}</div>
      </section>
    );
  }
  if (!datos?.ok) return null;
  const v = datos.vigente;
  const avisos = v?.detalle?.avisos || [];

  return (
    <section aria-label="Costo final" className="mb-4">
      <div className="g-label mb-1">🧾 Costo final (materiales + mano de obra)</div>
      {v ? (
        <div className="bg-gypi-surface rounded-xl p-3 border border-gypi-border">
          <div className="flex items-baseline gap-2">
            <span className="flex-1 text-[14px] font-bold">Costo final sin IVA</span>
            <span className="text-[18px] font-bold">{fmtPesos(v.total)}</span>
          </div>
          <div className="text-xs text-gypi-dim mt-1 flex flex-col gap-0.5">
            <span>Materiales: {fmtPesos(v.materiales)}</span>
            <span>Mano de obra: {textoHoras(v.horas_persona)} × {v.costo_hora != null ? fmtPesos(v.costo_hora) : "—"} la hora = {v.mano_obra != null ? fmtPesos(v.mano_obra) : "—"}</span>
            <span>{MOTIVOS_COSTO[v.motivo] || ""} · cerrada el {fechaHora(v.cerrada_at)} · calculado el {fechaHora(v.calculado_at)}{v.calculado_por_nombre ? ` (${v.calculado_por_nombre})` : ""}</span>
          </div>
          {avisos.length > 0 && <div className="text-xs font-semibold text-gypi-red mt-1">⚠ {avisos.join(" · ")}</div>}
          <div className="text-xs text-gypi-dim mt-1">La constancia guarda los precios y horas de ese momento: no cambia aunque después cambien.</div>
          <div className="flex flex-wrap gap-2 mt-2">
            <button onClick={imprimir} className={boton}>🖨 Constancia (imprimir o PDF)</button>
            {datos.cerrada && <button onClick={() => calcular("recalcular")} disabled={trabajando} className={boton}>{trabajando ? "Calculando…" : "🔄 Volver a calcular"}</button>}
          </div>
        </div>
      ) : datos.cerrada ? (
        <div className="bg-gypi-surface rounded-xl p-3 border border-gypi-border">
          <div className="text-xs text-gypi-dim mb-2">Esta OT ya estaba cerrada antes de que Gypi calculara el costo final.</div>
          <button onClick={() => calcular("calcular")} disabled={trabajando} className={boton}>{trabajando ? "Calculando…" : "🧾 Calcular costo final"}</button>
        </div>
      ) : (
        <div className="text-xs text-gypi-dim">Se calcula solo cuando se cierre la OT, y queda la constancia de todo lo usado.</div>
      )}
      {datos.historial?.length > 0 && (
        <div className="mt-1.5">
          <button onClick={() => setVerHistorial((x) => !x)} className="min-h-[36px] bg-transparent border-none cursor-pointer text-xs text-gypi-dim underline p-0">
            {verHistorial ? "Ocultar" : "Ver"} historial ({datos.historial.length})
          </button>
          {verHistorial && (
            <ul className="list-none m-0 p-0 flex flex-col gap-1 mt-1">
              {datos.historial.map((h) => (
                <li key={h.id} className="text-xs text-gypi-dim p-2 rounded-lg border border-gypi-border">
                  <span className="line-through">{h.total != null ? fmtPesos(h.total) : "Sin calcular"}</span> · cerrada el {fechaHora(h.cerrada_at)} · anulado el {fechaHora(h.anulado_at)}{h.anulado_motivo ? `: ${h.anulado_motivo}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
