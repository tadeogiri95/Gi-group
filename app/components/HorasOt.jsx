'use client';
// app/components/HorasOt.jsx — ⏱ Horas-persona presupuestadas contra reales
// en el detalle de la OT (costo de OT, parte E; /api/horas-ot). Dueño y
// Administración. Cada número es 🤖 automático o ✏ a mano; tocándolo se
// escribe otro, y ↺ vuelve al automático.
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { textoHoras } from "../lib/horasOt";
import { leerNumero } from "../lib/planificacion";
import { useToast } from "./ui/Toast";

function Numero({ lado, etiqueta, onGuardar }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState("");
  const abrir = () => { setTexto(lado.valor != null ? String(lado.valor).replace(".", ",") : ""); setEditando(true); };
  const guardar = async () => {
    const t = texto.trim();
    const v = t === "" ? null : leerNumero(t);
    if (t !== "" && (v == null || v < 0)) return;
    setEditando(false);
    await onGuardar(v);
  };
  if (editando) {
    return (
      <span className="inline-flex items-center gap-1">
        <input aria-label={etiqueta} value={texto} onChange={(e) => setTexto(e.target.value)} inputMode="decimal" autoFocus
          onKeyDown={(e) => { if (e.key === "Enter") guardar(); if (e.key === "Escape") setEditando(false); }}
          className="g-input w-[72px] text-[13px] text-right" />
        <button onClick={guardar} aria-label="Guardar" className="min-w-[36px] min-h-[36px] rounded-lg border border-gypi-border bg-transparent cursor-pointer text-gypi-text">✓</button>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <button onClick={abrir} aria-label={`Cambiar ${etiqueta}`} title={lado.aMano ? `A mano (automático: ${textoHoras(lado.auto)})` : "Automático"}
        className="min-h-[36px] px-1.5 rounded-lg border border-transparent hover:border-gypi-border bg-transparent cursor-pointer text-[13px] font-semibold text-gypi-text">
        {lado.aMano ? "✏" : "🤖"} {textoHoras(lado.valor)}
      </button>
      {lado.aMano && (
        <button onClick={() => onGuardar(null)} aria-label={`Volver al automático: ${etiqueta}`} title="Volver al automático"
          className="min-w-[32px] min-h-[36px] rounded-lg bg-transparent border-none cursor-pointer text-gypi-dim">↺</button>
      )}
    </span>
  );
}

function Fila({ f, guardar, total = false }) {
  const colorPct = f.pct == null ? "text-gypi-dim" : f.pct <= 100 ? "text-gypi-green" : "text-gypi-red";
  return (
    <li className={`p-2.5 rounded-xl border ${total ? "border-gypi-border bg-gypi-surf-hi" : "border-gypi-border bg-gypi-surface"}`}>
      <div className="flex items-center gap-2">
        <span className={`flex-1 text-[13px] ${total ? "font-bold" : "font-semibold"}`}>{f.nombre}</span>
        {f.pct != null && <span className={`text-[13px] font-bold ${colorPct}`}>{f.pct} %</span>}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gypi-dim">
        <span>Presupuestadas <Numero lado={f.presupuestadas} etiqueta={`horas presupuestadas de ${f.nombre}`} onGuardar={(v) => guardar(f.etapa, "presupuestadas", v)} /></span>
        <span>Reales <Numero lado={f.reales} etiqueta={`horas reales de ${f.nombre}`} onGuardar={(v) => guardar(f.etapa, "reales", v)} /></span>
        {f.diferencia != null && <span className={f.diferencia > 0 ? "text-gypi-red" : "text-gypi-green"}>{f.diferencia > 0 ? "+" : ""}{textoHoras(f.diferencia)}</span>}
      </div>
      {f.detalle && !f.reales.aMano && f.detalle.horas != null && (
        <div className="text-xs text-gypi-dim">
          {textoHoras(f.detalle.horas)} de proceso{f.detalle.terminado ? "" : " (sigue)"} × {f.detalle.personas === 1 ? "1 persona" : `${f.detalle.personas} personas`}{f.detalle.tareas ? ` + ${textoHoras(f.detalle.tareas)} de tareas` : ""}
        </div>
      )}
      {f.cambiadoPor && (f.presupuestadas.aMano || f.reales.aMano) && <div className="text-xs text-gypi-dim">✏ por {f.cambiadoPor}</div>}
    </li>
  );
}

export default function HorasOt({ ot }) {
  const toast = useToast();
  const [datos, setDatos] = useState(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!ot) return;
    let vivo = true;
    apiFetch(`/api/horas-ot?ot=${encodeURIComponent(ot)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => { if (vivo) setDatos(d); })
      .catch(() => { if (vivo) setDatos(null); });
    return () => { vivo = false; };
  }, [ot, version]);

  const guardar = async (etapa, campo, valor) => {
    try {
      const res = await apiFetch("/api/horas-ot", { method: "POST", body: JSON.stringify({ ot, etapa, campo, valor }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) throw new Error(d.error || "No se pudieron guardar las horas");
      setVersion((v) => v + 1);
    } catch (e) {
      toast.error(e.message);
    }
  };

  if (datos?.falta_migracion) {
    return (
      <section aria-label="Horas presupuestadas" className="mb-4">
        <div className="g-label mb-1">⏱ Horas-persona</div>
        <div className="text-xs text-gypi-dim">{datos.falta_migracion}</div>
      </section>
    );
  }
  if (!datos?.ok) return null;

  return (
    <section aria-label="Horas presupuestadas" className="mb-4">
      <div className="g-label mb-1">⏱ Horas-persona: presupuestadas contra reales</div>
      <div className="text-xs text-gypi-dim mb-1.5">
        🤖 automático (presupuesto del Gantt; reales de los escaneos sin las pausas, por la cantidad de operarios) · ✏ a mano. Tocá un número para cambiarlo.
        {datos.sinGantt ? " Esta OT no tiene placas, cantos ni mecanizados en el Plan de trabajo: el presupuesto va a mano." : ""}
      </div>
      <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
        {datos.filas.map((f) => <Fila key={f.etapa} f={f} guardar={guardar} />)}
        <Fila f={datos.total} guardar={guardar} total />
      </ul>
    </section>
  );
}
