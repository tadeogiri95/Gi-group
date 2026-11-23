'use client';
// app/components/FinanzasExportar.jsx — los botones 📄 PDF y 📊 Excel de cada
// informe de Finanzas (pedido de Tadeo del 19/11: cada informe por separado).
// Reglas en app/lib/finanzasInformes.js.
import { useState } from "react";
import { descargarInforme } from "../lib/finanzasInformes";

/**
 * @param {{ informe: () => object|null, disabled?: boolean, nombre?: string }} props
 *   informe: arma { titulo, html, hojas } en el momento de apretar.
 */
export default function BotonesExportar({ informe, disabled = false, nombre = "el informe" }) {
  const [bajando, setBajando] = useState(null);
  const [error, setError] = useState(null);
  async function bajar(formato) {
    setError(null);
    setBajando(formato);
    try {
      const inf = informe();
      if (!inf) throw new Error("Todavía no hay datos para bajar");
      await descargarInforme(inf, formato);
    } catch (e) {
      setError(e.message || "No se pudo armar el archivo");
    }
    setBajando(null);
  }
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Bajar ${nombre}`}>
      <button type="button" className="g-btn g-btn-secondary" disabled={disabled || !!bajando} onClick={() => bajar("pdf")}>
        {bajando === "pdf" ? "Armando…" : "📄 PDF"}
      </button>
      <button type="button" className="g-btn g-btn-secondary" disabled={disabled || !!bajando} onClick={() => bajar("xlsx")}>
        {bajando === "xlsx" ? "Armando…" : "📊 Excel"}
      </button>
      {error && <span role="alert" className="text-[12px] text-gypi-red">⚠ {error}</span>}
    </div>
  );
}
