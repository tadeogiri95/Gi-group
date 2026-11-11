'use client';
// app/components/FinanzasReporte.jsx — Finanzas → 📑 Reporte financiero
// (mejoras del 09/11, parte E; /api/finanzas/reporte; reglas en
// app/lib/finanzasReporte.js).
//
// Semanal, mensual o entre dos fechas (parte 11 del 11/11): el Dueño elige
// el período (con ◀ ▶ para pasar al anterior o al siguiente) y aprieta
// "Generar". Se ve a color y con gráficos en la pantalla, se baja en PDF a
// color con un botón o se imprime.
import { useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyAr } from "../lib/finanzasOperaciones";
import { TIPOS_REPORTE, descargarPdfReporte, errorPeriodo, htmlReporte, imprimirReporte, periodoReporte } from "../lib/finanzasReporte";
import { Chip, Spinner } from "./ui";

const correr = (fecha, tipo, n) => {
  const d = new Date(`${fecha}T12:00:00Z`);
  if (tipo === "semana") d.setUTCDate(d.getUTCDate() + 7 * n);
  else { d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); }
  return d.toISOString().slice(0, 10);
};

export default function FinanzasReporte() {
  const hoy = hoyAr();
  const [tipo, setTipo] = useState("mes");
  const [fecha, setFecha] = useState(hoy);
  const [desde, setDesde] = useState(`${hoy.slice(0, 7)}-01`);
  const [hasta, setHasta] = useState(hoy);
  const [reporte, setReporte] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [bajando, setBajando] = useState(false);
  const [error, setError] = useState(null);
  const rango = tipo === "rango";
  const periodo = rango ? periodoReporte("rango", desde, hasta) : periodoReporte(tipo, fecha);
  const problema = rango && !periodo ? errorPeriodo(desde, hasta) : "";
  const cambiar = (fn) => (e) => { if (e.target.value) { fn(e.target.value); setReporte(null); } };

  async function generar() {
    setCargando(true);
    setError(null);
    try {
      const q = rango ? `tipo=rango&fecha=${desde}&hasta=${hasta}` : `tipo=${tipo}&fecha=${fecha}`;
      const res = await apiFetch(`/api/finanzas/reporte?${q}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo armar el reporte");
      setReporte(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }

  async function pdf() {
    setError(null);
    setBajando(true);
    try { await descargarPdfReporte(reporte, { empresa: reporte.empresa }); } catch (e) { setError(e.message || "No se pudo armar el PDF"); }
    setBajando(false);
  }

  function imprimir() {
    setError(null);
    try { imprimirReporte(reporte, { empresa: reporte.empresa }); } catch (e) { setError(e.message); }
  }

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6 flex flex-col gap-3">
      <p className="m-0 text-[13px] text-gypi-dim">
        Resultados, flujo de caja, posición de fondos, valores a cobrar y a pagar, y cuentas a cobrar y a pagar del período, con gráficos. Se arma en el momento con lo cargado en Finanzas.
      </p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tipo de período">
        {Object.entries(TIPOS_REPORTE).map(([k, v]) => <Chip key={k} active={tipo === k} onClick={() => { setTipo(k); setReporte(null); }}>{v}</Chip>)}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {rango ? (
          <>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">
              Desde
              <input type="date" className="g-input" aria-label="Desde" value={desde} onChange={cambiar(setDesde)} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">
              Hasta
              <input type="date" className="g-input" aria-label="Hasta" value={hasta} onChange={cambiar(setHasta)} />
            </label>
          </>
        ) : (
          <>
            <button type="button" className="g-btn g-btn-secondary" aria-label={tipo === "semana" ? "Semana anterior" : "Mes anterior"} onClick={() => { setFecha(correr(fecha, tipo, -1)); setReporte(null); }}>◀</button>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">
              {tipo === "semana" ? "Un día de la semana" : "Un día del mes"}
              <input type="date" className="g-input" aria-label="Fecha del período" value={fecha} onChange={cambiar(setFecha)} />
            </label>
            <button type="button" className="g-btn g-btn-secondary" aria-label={tipo === "semana" ? "Semana siguiente" : "Mes siguiente"} onClick={() => { setFecha(correr(fecha, tipo, 1)); setReporte(null); }}>▶</button>
          </>
        )}
        <button type="button" className="g-btn g-btn-primary" disabled={cargando || !periodo} onClick={generar}>{cargando ? "Armando…" : "📑 Generar reporte"}</button>
        {cargando && <Spinner size={16} />}
      </div>
      {periodo && <p className="m-0 text-[13px] text-gypi-text">Período: <b>{periodo.titulo}</b></p>}
      {problema && <p className="m-0 text-[13px] text-gypi-amber-ink">⚠ {problema}</p>}
      {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
      {reporte && (
        <>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="g-btn g-btn-primary" disabled={bajando} onClick={pdf}>{bajando ? "Armando el PDF…" : "📄 Descargar PDF a color"}</button>
            <button type="button" className="g-btn g-btn-secondary" onClick={imprimir}>🖨 Imprimir</button>
          </div>
          <iframe title="Reporte financiero" srcDoc={htmlReporte(reporte, { empresa: reporte.empresa })} className="w-full min-h-[75vh] border border-gypi-border rounded-lg bg-white" />
        </>
      )}
    </div>
  );
}
