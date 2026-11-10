'use client';
// app/components/FinanzasReporte.jsx — Finanzas → 📑 Reporte financiero
// (mejoras del 09/11, parte E; /api/finanzas/reporte; reglas en
// app/lib/finanzasReporte.js).
//
// Semanal o mensual: el Dueño elige el período y aprieta "Generar". Se ve en
// la pantalla y se imprime o se guarda en PDF con un botón.
import { useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyAr } from "../lib/finanzasOperaciones";
import { TIPOS_REPORTE, htmlReporte, imprimirReporte, periodoReporte } from "../lib/finanzasReporte";
import { Chip, Spinner } from "./ui";

export default function FinanzasReporte() {
  const [tipo, setTipo] = useState("mes");
  const [fecha, setFecha] = useState(hoyAr());
  const [reporte, setReporte] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const periodo = periodoReporte(tipo, fecha);

  async function generar() {
    setCargando(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/finanzas/reporte?tipo=${tipo}&fecha=${fecha}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo armar el reporte");
      setReporte(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }

  function imprimir() {
    setError(null);
    try { imprimirReporte(reporte, { empresa: reporte.empresa }); } catch (e) { setError(e.message); }
  }

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6 flex flex-col gap-3">
      <p className="m-0 text-[13px] text-gypi-dim">
        Resultados, flujo de caja, posición de fondos, valores a cobrar y a pagar, y cuentas a cobrar y a pagar del período. Se arma en el momento con lo cargado en Finanzas.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        {Object.entries(TIPOS_REPORTE).map(([k, v]) => <Chip key={k} active={tipo === k} onClick={() => { setTipo(k); setReporte(null); }}>{v}</Chip>)}
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">
          {tipo === "semana" ? "Un día de la semana" : "Un día del mes"}
          <input type="date" className="g-input" aria-label="Fecha del período" value={fecha} onChange={(e) => { if (e.target.value) { setFecha(e.target.value); setReporte(null); } }} />
        </label>
        <button type="button" className="g-btn g-btn-primary" disabled={cargando || !periodo} onClick={generar}>{cargando ? "Armando…" : "📑 Generar reporte"}</button>
        {reporte && <button type="button" className="g-btn g-btn-secondary" onClick={imprimir}>🖨 Imprimir o guardar PDF</button>}
        {cargando && <Spinner size={16} />}
      </div>
      {periodo && <p className="m-0 text-[13px] text-gypi-text">Período: <b>{periodo.titulo}</b></p>}
      {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
      {reporte && (
        <iframe title="Reporte financiero" srcDoc={htmlReporte(reporte, { empresa: reporte.empresa })} className="w-full min-h-[75vh] border border-gypi-border rounded-lg bg-white" />
      )}
    </div>
  );
}
