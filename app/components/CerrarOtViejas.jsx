"use client";
// app/components/CerrarOtViejas.jsx — 🧹 Cerrar OT viejas en lote (auditoría
// 01/11, PR 6): las OT activas que hace rato no se mueven, con vista previa.
// Se elige desde cuántos días sin movimiento, se destildan las que siguen
// vivas y se cierran todas juntas. Solo cambia el estado en Gypi: la planilla
// del Plan de trabajo no se toca y una OT cerrada se puede reactivar.
import { useMemo, useState } from "react";
import { Modal } from "./ui";
import { OPCIONES_DIAS, otSinMovimiento } from "../lib/otOrdenar";

export default function CerrarOtViejas({ abierto, proyectos, piezas, hoy, onCerrar, onClose }) {
  const [dias, setDias] = useState(60);
  const [fuera, setFuera] = useState(() => new Set());
  const [cerrando, setCerrando] = useState(false);
  const lista = useMemo(() => otSinMovimiento(proyectos, piezas, { hoy, dias }), [proyectos, piezas, hoy, dias]);
  const elegidas = lista.filter((x) => !fuera.has(x.p.id));
  const cambiar = (id) => setFuera((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function cerrar() {
    setCerrando(true);
    try { await onCerrar(elegidas.map((x) => x.p.id)); } finally { setCerrando(false); }
  }

  return (
    <Modal open={abierto} onClose={onClose} title="🧹 Cerrar OT viejas">
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] text-gypi-dim">
          OT activas sin piezas escaneadas desde hace un tiempo (si nunca se escanearon, desde que se dieron de alta).
          Destildá las que siguen vivas. Cerrar no toca la planilla y se puede reactivar.
        </p>
        <label className="flex items-center gap-2 text-[14px]">
          Sin movimiento hace más de
          <select className="g-input !w-auto" aria-label="Días sin movimiento" value={dias} onChange={(e) => { setDias(Number(e.target.value)); setFuera(new Set()); }}>
            {OPCIONES_DIAS.map((d) => <option key={d} value={d}>{d} días</option>)}
          </select>
        </label>
        {lista.length === 0 ? (
          <p className="m-0 text-[14px] text-gypi-dim">✅ No hay OT activas sin movimiento en ese plazo.</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 text-[13px]">
              <span className="font-semibold">{elegidas.length} de {lista.length} elegidas</span>
              <span className="flex gap-2">
                <button type="button" className="min-h-[36px] px-2 bg-transparent border-none cursor-pointer text-gypi-amber-ink font-semibold" onClick={() => setFuera(new Set())}>Todas</button>
                <button type="button" className="min-h-[36px] px-2 bg-transparent border-none cursor-pointer text-gypi-dim font-semibold" onClick={() => setFuera(new Set(lista.map((x) => x.p.id)))}>Ninguna</button>
              </span>
            </div>
            <ul className="list-none m-0 p-0 max-h-[50vh] overflow-y-auto border border-gypi-border rounded-xl" aria-label="OT sin movimiento">
              {lista.map((x) => (
                <li key={x.p.id} className="border-b border-gypi-border last:border-b-0">
                  <label className="flex items-start gap-2.5 p-2.5 cursor-pointer">
                    <input type="checkbox" className="mt-1" checked={!fuera.has(x.p.id)} onChange={() => cambiar(x.p.id)} aria-label={`Cerrar la OT ${x.p.ot}`} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[14px] font-semibold truncate"><span className="font-mono">{x.p.ot}</span> · {x.p.cliente || x.p.proyecto || "—"}</span>
                      <span className="block text-[12px] text-gypi-dim">{x.dias} días quieta · {x.motivo}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <button type="button" className="g-btn g-btn-primary min-h-[48px]" disabled={!elegidas.length || cerrando} onClick={cerrar}>
              {cerrando ? "Cerrando…" : `Cerrar ${elegidas.length} OT`}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
