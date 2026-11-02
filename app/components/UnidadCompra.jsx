'use client';
// app/components/UnidadCompra.jsx — Cambiar la unidad de compra de un renglón
// (Compras; migración 152). Al proveedor se le puede pedir en cajas, rollos o
// metros aunque el stock lleve otra unidad: se pone la unidad de compra y
// cuántas unidades del stock trae cada una. Lo usan "A comprar" y la OC en
// borrador; quien lo usa convierte la cantidad y el precio.
import { useState } from "react";
import { leerCantidadMovimiento } from "../lib/movimientosStock";

const numTexto = (n) => (n === null || n === undefined ? "" : String(n).replace(".", ","));

/**
 * @param {{ id: string, descripcion: string, unidadBase: string|null, unidad: string|null, factor: number, onCambiar: (c: { unidad: string|null, factor: number }) => void }} props
 */
export default function UnidadCompra({ id, descripcion, unidadBase, unidad, factor, onCambiar }) {
  const [abierto, setAbierto] = useState(false);
  const [nueva, setNueva] = useState("");
  const [cuantas, setCuantas] = useState("");
  const [error, setError] = useState(null);
  const base = unidadBase || "unidades";
  const otra = factor !== 1 || (unidadBase && unidad && unidad !== unidadBase);

  const abrir = () => {
    setNueva(otra ? unidad || "" : "");
    setCuantas(otra ? numTexto(factor) : "");
    setError(null);
    setAbierto(true);
  };
  const aplicar = () => {
    const u = nueva.trim();
    const f = leerCantidadMovimiento(cuantas);
    if (!u) { setError("Poné la unidad de compra (ej: caja)"); return; }
    if (!f || f > 1e6) { setError(`Poné cuántas ${base} trae cada ${u}`); return; }
    onCambiar({ unidad: u.slice(0, 20), factor: f });
    setAbierto(false);
  };
  const volver = () => {
    onCambiar({ unidad: unidadBase || null, factor: 1 });
    setAbierto(false);
  };

  if (!abierto) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-gypi-dim w-full">
        <span className="flex-1 min-w-0">
          {otra ? `📏 Se compra por ${unidad || "unidad"}: 1 ${unidad || "unidad"} = ${numTexto(factor)} ${base}` : `📏 Se compra en ${base}`}
        </span>
        <button type="button" onClick={abrir} aria-label={`Cambiar unidad de ${descripcion}`}
          className="min-h-[36px] px-2 bg-transparent border-none text-[12px] font-semibold text-gypi-amber-ink cursor-pointer shrink-0">Cambiar unidad</button>
      </div>
    );
  }
  return (
    <div className="w-full p-2 rounded-[10px] border border-gypi-border" role="group" aria-label={`Unidad de compra de ${descripcion}`}>
      <div className="flex gap-2">
        <div className="flex-1 min-w-0">
          <label className="g-label" htmlFor={`${id}-unidad`}>Unidad de compra</label>
          <input id={`${id}-unidad`} className="g-input" maxLength={20} value={nueva} onChange={(e) => setNueva(e.target.value)} placeholder="Ej: caja, rollo, m" />
        </div>
        <div className="flex-1 min-w-0">
          <label className="g-label" htmlFor={`${id}-factor`}>¿Cuántas {base} trae cada una?</label>
          <input id={`${id}-factor`} className="g-input" inputMode="decimal" value={cuantas} onChange={(e) => setCuantas(e.target.value)} placeholder="Ej: 50" />
        </div>
      </div>
      {error && <div role="alert" className="text-[12px] text-gypi-red mt-1">{error}</div>}
      <div className="flex gap-2 mt-2">
        <button type="button" onClick={aplicar} className="g-btn g-btn-primary flex-1">Usar esta unidad</button>
        {otra && <button type="button" onClick={volver} className="g-btn g-btn-secondary flex-1">Volver a {base}</button>}
        <button type="button" onClick={() => setAbierto(false)} className="g-btn g-btn-secondary">Cancelar</button>
      </div>
    </div>
  );
}
