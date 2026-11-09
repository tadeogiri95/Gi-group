'use client';
// app/components/FinanzasResultados.jsx — Finanzas → 📊 Resultados (parte
// F6a; migración 179; /api/finanzas/resultados; reglas en
// app/lib/finanzasResultados.js).
//
// El estado de resultados devengado de 12 meses, como la hoja EERR del libro:
// ingresos, costo de ventas, utilidad bruta, gastos operativos, EBIT,
// resultado financiero, impuestos y resultado neto. Cada sección se abre y se
// cierra; el costo de materiales se estima con un % de las entregas mientras
// no haya costo real.
// Solo el rol Dueño (la pantalla ni aparece para los demás).
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyAr } from "../lib/finanzasOperaciones";
import { nombreMes } from "../lib/finanzasResultados";
import { Modal, Spinner } from "./ui";
import { useToast } from "./ui/Toast";

const miles = (n) => (n == null ? "" : Math.round(Number(n) || 0).toLocaleString("es-AR"));
const pct = (n) => (n == null ? "" : `${String(n).replace(".", ",")} %`);

function ConfigMateriales({ valor, onCerrar, onGuardado }) {
  const toast = useToast();
  const [v, setV] = useState(String(valor ?? 40).replace(".", ","));
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const res = await apiFetch("/api/finanzas/resultados", { method: "POST", body: JSON.stringify({ accion: "config", materiales_pct: v }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo guardar");
      toast.success("Guardado");
      onGuardado();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onCerrar} title="Costo de materiales" maxWidth={420}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px] text-gypi-dim">
          Mientras no haya cuentas de materiales (CMV_MAT) con movimientos, se estima como un % de las entregas, igual que el libro. Con 0 no se estima.
        </p>
        <label className="flex flex-col gap-1 text-[13px] font-semibold">
          % de las entregas
          <input className="g-input w-[120px] text-right" inputMode="decimal" aria-label="Porcentaje de materiales" value={v} onChange={(e) => setV(e.target.value)} />
        </label>
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>
    </Modal>
  );
}

const ESTILO = {
  seccion: "bg-gypi-surface font-bold text-gypi-text cursor-pointer",
  grupo: "font-semibold text-gypi-text",
  linea: "text-gypi-text",
  resultado: "bg-gypi-surface font-bold text-gypi-text border-t-2 border-gypi-border",
  pct: "text-gypi-dim text-[12px]",
};

export default function FinanzasResultados() {
  const [hasta, setHasta] = useState(hoyAr().slice(0, 7));
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [cerradas, setCerradas] = useState(() => new Set());
  const [config, setConfig] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await apiFetch(`/api/finanzas/resultados?hasta=${hasta}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo armar el estado de resultados");
      setDatos(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [hasta]);
  useEffect(() => { cargar(); }, [cargar]);

  const abrirCerrar = (id) => setCerradas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (error) return <p role="alert" className="m-[18px] text-[14px] text-gypi-red">⚠ {error}</p>;
  if (!datos) return <div className="flex-1 flex items-center justify-center py-10"><Spinner /></div>;
  const visibles = datos.filas.filter((f) => f.tipo === "seccion" || f.tipo === "resultado" || f.tipo === "pct" || !cerradas.has(f.seccion));

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      <div className="flex flex-wrap items-end gap-2 mb-2">
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">
          Hasta el mes
          <input type="month" className="g-input" aria-label="Hasta el mes" value={hasta} onChange={(e) => e.target.value && setHasta(e.target.value)} />
        </label>
        <p className="m-0 text-[13px] text-gypi-dim flex-1 min-w-[200px]">Devengado, 12 meses, en pesos y sin IVA. Tocá una sección para abrirla o cerrarla.</p>
        <button type="button" className="g-btn g-btn-secondary" onClick={() => setConfig(true)}>⚙ Materiales ({pct(datos.config?.materiales_pct)})</button>
        {cargando && <Spinner size={16} />}
      </div>

      {!datos.clasificado && (
        <p className="m-0 mb-2 text-[13px] text-gypi-amber-ink">
          ⚠ Ninguna cuenta tiene su renglón del estado de resultados. Andá a Finanzas → Configuración → 📥 Copiar desde el libro y copiá de nuevo el plan de cuentas: así se trae la columna clasificacion_eerr.
        </p>
      )}
      {datos.para_revisar > 0 && <p className="m-0 mb-2 text-[13px] text-gypi-amber-ink">⚠ Hay {datos.para_revisar} operaciones para revisar en estos meses que todavía no cuentan. Confirmalas en Movimientos.</p>}

      <div className="overflow-x-auto border border-gypi-border rounded-lg">
        <table className="w-full border-collapse text-[13px]" aria-label="Estado de resultados">
          <thead>
            <tr className="bg-gypi-surface">
              <th className="text-left px-2 py-1.5 sticky left-0 bg-gypi-surface min-w-[220px]">Concepto</th>
              {datos.meses.map((m) => <th key={m} className="text-right px-2 py-1.5 whitespace-nowrap">{nombreMes(m)}</th>)}
              <th className="text-right px-2 py-1.5 whitespace-nowrap">Total</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((f) => {
              const fondo = f.tipo === "seccion" || f.tipo === "resultado" ? "bg-gypi-surface" : "bg-gypi-bg";
              const sangria = f.tipo === "linea" ? "pl-6" : f.tipo === "grupo" ? "pl-4" : "pl-2";
              const valor = f.tipo === "pct" ? pct : miles;
              const negativo = (n) => (f.tipo !== "pct" && n < 0 ? "text-gypi-red" : "");
              return (
                <tr key={f.id} className={`border-t border-gypi-border ${ESTILO[f.tipo]}`} onClick={f.tipo === "seccion" ? () => abrirCerrar(f.id) : undefined}>
                  <td className={`pr-2 py-1 sticky left-0 ${fondo} ${sangria}`}>
                    {f.tipo === "seccion" && <span aria-hidden="true">{cerradas.has(f.id) ? "▸ " : "▾ "}</span>}
                    {f.tipo === "seccion" ? <button type="button" className="bg-transparent border-none p-0 font-bold text-gypi-text cursor-pointer" aria-expanded={!cerradas.has(f.id)}>{f.nombre}</button> : f.nombre}
                    {f.estimado && <span className="text-gypi-dim"> *</span>}
                  </td>
                  {f.valores.map((v, i) => <td key={i} className={`px-2 py-1 text-right font-mono whitespace-nowrap ${negativo(v)}`}>{valor(v)}</td>)}
                  <td className={`px-2 py-1 text-right font-mono whitespace-nowrap font-semibold ${negativo(f.total)}`}>{valor(f.total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {datos.materiales_estimados && <p className="m-0 mt-1 text-[12px] text-gypi-dim">* Estimado: no hay costo real de materiales cargado.</p>}

      {datos.sin_linea.length > 0 && (
        <details className="mt-3 text-[13px] text-gypi-text">
          <summary className="cursor-pointer font-semibold">⚠ {datos.sin_linea.length} cuentas de resultado con movimientos que no tienen renglón (no entran)</summary>
          <p className="m-0 my-1 text-[12px] text-gypi-dim">Ponéles la clasificacion_eerr en dim_plan_cuentas del libro y volvé a copiar el plan de cuentas.</p>
          <ul className="list-none m-0 p-0 flex flex-col gap-0.5">
            {datos.sin_linea.map((s) => (
              <li key={s.codigo} className="flex gap-2"><span className="font-mono text-[12px] text-gypi-dim">{s.codigo}</span><span className="flex-1">{s.nombre}</span><span className="font-mono">{miles(s.total)}</span></li>
            ))}
          </ul>
        </details>
      )}
      {config && <ConfigMateriales valor={datos.config?.materiales_pct} onCerrar={() => setConfig(false)} onGuardado={() => { setConfig(false); cargar(); }} />}
    </div>
  );
}
