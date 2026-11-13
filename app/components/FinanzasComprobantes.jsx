'use client';
// app/components/FinanzasComprobantes.jsx — Finanzas (13/11, parte 4 del
// plan de Tesorería; migración 187): adjuntar uno o varios comprobantes (PDF
// o fotos) a un movimiento, al cargarlo o después desde su detalle.
// Reglas en app/lib/finanzasAdjuntos.js.
import { useState } from "react";
import { subirComprobante } from "../lib/foto";
import { MAX_COMPROBANTES } from "../lib/finanzasAdjuntos";

/**
 * @param {{ lista: { url: string, nombre: string, tipo: string }[], onCambio: (lista: object[]) => void, disabled?: boolean, titulo?: string }} props
 */
export default function Comprobantes({ lista = [], onCambio, disabled = false, titulo = "Comprobantes" }) {
  const [subiendo, setSubiendo] = useState(0);
  const [error, setError] = useState(null);
  const lleno = lista.length >= MAX_COMPROBANTES;

  async function elegir(files) {
    const nuevos = [...(files || [])].slice(0, MAX_COMPROBANTES - lista.length);
    if (!nuevos.length) return;
    setError(null);
    setSubiendo(nuevos.length);
    const subidos = [];
    for (const file of nuevos) {
      try {
        subidos.push(await subirComprobante(file));
      } catch (e) {
        setError(`${file.name || "Un archivo"}: ${e.message}`);
      }
    }
    setSubiendo(0);
    if (subidos.length) onCambio([...lista, ...subidos]);
  }

  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label={titulo}>
      <span className="text-[13px] font-semibold text-gypi-text">📎 {titulo}{lista.length ? ` (${lista.length})` : ""}</span>
      {lista.length > 0 && (
        <ul className="list-none m-0 p-0 flex flex-col gap-1">
          {lista.map((c, i) => (
            <li key={c.url} className="flex items-center gap-2 rounded-lg border border-gypi-border bg-gypi-surface px-2 py-1.5 text-[13px]">
              <span aria-hidden="true">{c.tipo === "pdf" ? "📄" : "🖼"}</span>
              <a href={c.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 truncate text-gypi-cyan underline">{c.nombre || `Comprobante ${i + 1}`}</a>
              {!disabled && (
                <button type="button" className="min-h-[36px] px-2 rounded border border-gypi-border bg-transparent text-gypi-dim cursor-pointer text-[12px]"
                  aria-label={`Quitar ${c.nombre || `comprobante ${i + 1}`}`} onClick={() => onCambio(lista.filter((x) => x.url !== c.url))}>✕ Quitar</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && !lleno && (
        <label className={`g-btn g-btn-secondary self-start cursor-pointer ${subiendo ? "opacity-60" : ""}`}>
          {subiendo ? `Subiendo ${subiendo === 1 ? "1 archivo" : `${subiendo} archivos`}…` : lista.length ? "📎 Adjuntar otro" : "📎 Adjuntar PDF o foto"}
          <input type="file" accept="image/*,application/pdf" multiple className="sr-only" aria-label="Adjuntar comprobante" disabled={!!subiendo}
            onChange={(e) => { elegir(e.target.files); e.target.value = ""; }} />
        </label>
      )}
      {lleno && !disabled && <span className="text-[12px] text-gypi-dim">Hasta {MAX_COMPROBANTES} por movimiento.</span>}
      {error && <span role="alert" className="text-[12px] text-gypi-red">⚠ {error}</span>}
    </div>
  );
}
