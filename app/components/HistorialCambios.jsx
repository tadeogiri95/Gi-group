'use client';
// app/components/HistorialCambios.jsx — 🕓 Historial de una operación o un
// movimiento: cuándo se cargó, cada corrección (qué cambió y quién) y la
// anulación (punto 12 del plan del 19/11; reglas en app/lib/historialCambios.js).
import { cuandoCambio, textoCambio } from "../lib/historialCambios";

const ACCION = { cargada: "Cargada", corregida: "Corregida", anulada: "Anulada" };

/**
 * @param {{ entradas: object[], etiquetas?: object, formato?: object }} props
 */
export default function HistorialCambios({ entradas = [], etiquetas = {}, formato = {} }) {
  // Solo con algo más que la carga vale la pena mostrarlo
  if (!entradas.some((h) => h.accion !== "cargada")) return null;
  return (
    <section aria-label="Historial de cambios" className="rounded-lg border border-gypi-border bg-gypi-surface p-3 flex flex-col gap-2">
      <p className="m-0 text-[13px] font-semibold text-gypi-text">🕓 Historial</p>
      <ol className="m-0 p-0 list-none flex flex-col gap-2">
        {entradas.map((h, i) => (
          <li key={`${h.at}-${i}`} className="text-[13px] text-gypi-text">
            <span className={h.accion === "anulada" ? "font-semibold text-gypi-red" : "font-semibold"}>{ACCION[h.accion] || h.accion}</span>
            {h.por ? ` por ${h.por}` : ""}
            <span className="text-gypi-dim"> · {cuandoCambio(h.at)}</span>
            {h.nota && <span className="block text-[12px] text-gypi-dim">{h.nota}</span>}
            {Array.isArray(h.cambios) && h.cambios.length > 0 && (
              <ul className="m-0 mt-1 pl-4 text-[12px] text-gypi-dim">
                {h.cambios.map((c, j) => <li key={`${c.campo}-${j}`}>{textoCambio(c, { etiquetas, formato })}</li>)}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
