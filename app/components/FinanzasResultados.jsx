'use client';
// app/components/FinanzasResultados.jsx — Finanzas → 📊 Resultados (parte
// F6a; migración 179; /api/finanzas/resultados; reglas en
// app/lib/finanzasResultados.js).
//
// El estado de resultados devengado de 12 meses, ordenado según NIIF (gastos
// por función): ingresos por entregas, costo de ventas, ganancia bruta,
// comercialización, administración, otros, resultado operativo, financieros,
// impuesto a las ganancias y resultado del período. Cada sección se abre y se
// cierra; el costo de materiales se estima con un % de las entregas mientras
// no haya costo real. Con el ponderador (⚙ Compartidos) se ve cada división:
// lo suyo entero y su % de lo compartido.
// Solo el rol Dueño (la pantalla ni aparece para los demás).
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyAr } from "../lib/finanzasOperaciones";
import { nombreMes } from "../lib/finanzasResultados";
import { Chip, Modal, Spinner } from "./ui";
import { useToast } from "./ui/Toast";

const miles = (n) => (n == null ? "" : Math.round(Number(n) || 0).toLocaleString("es-AR"));
const pct = (n) => (n == null ? "" : `${String(n).replace(".", ",")} %`);

function ConfigMateriales({ valor, real: realGuardado = false, onCerrar, onGuardado }) {
  const toast = useToast();
  const [v, setV] = useState(String(valor ?? 40).replace(".", ","));
  const [real, setReal] = useState(!!realGuardado);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const res = await apiFetch("/api/finanzas/resultados", { method: "POST", body: JSON.stringify({ accion: "config", materiales_pct: v, materiales_real: real }) });
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
        <label className="flex items-start gap-2 text-[13px]">
          <input type="checkbox" className="mt-1" checked={real} onChange={(e) => setReal(e.target.checked)} />
          <span><span className="font-semibold">Usar el costo real de cada OT entregada</span><br /><span className="text-gypi-dim">Lo del MRP, lo retirado de más y las compras sin stock de cada OT (💲 Costo por OT). Las entregas de OT sin materiales en Gypi siguen con el %.</span></span>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold">
          {real ? "% de las entregas sin costo en Gypi" : "% de las entregas"}
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

function ConfigPonderador({ divisiones, valor, onCerrar, onGuardado }) {
  const toast = useToast();
  const [v, setV] = useState(() => Object.fromEntries(divisiones.map((d) => [d, valor?.[d] != null ? String(valor[d]).replace(".", ",") : ""])));
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const suma = Object.values(v).reduce((s, x) => s + (Number(String(x).replace(",", ".")) || 0), 0);
  async function guardar(ponderador) {
    setGuardando(true);
    setError(null);
    try {
      const res = await apiFetch("/api/finanzas/resultados", { method: "POST", body: JSON.stringify({ accion: "config", ponderador }) });
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
    <Modal open onClose={onCerrar} title="Gastos compartidos" maxWidth={440}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px] text-gypi-dim">
          Lo que no es de una división (no tiene OT ni centro de costo de esa división) se reparte con estos %. Tienen que sumar 100.
        </p>
        {divisiones.length === 0 && <p className="m-0 text-[13px] text-gypi-amber-ink">⚠ Las OT no tienen división cargada.</p>}
        {divisiones.map((d) => (
          <label key={d} className="flex items-center justify-between gap-2 text-[13px] font-semibold">
            {d}
            <span className="flex items-center gap-1">
              <input className="g-input w-[90px] text-right" inputMode="decimal" aria-label={`Porcentaje de ${d}`} value={v[d]} onChange={(e) => setV((x) => ({ ...x, [d]: e.target.value }))} />
              %
            </span>
          </label>
        ))}
        <p className={`m-0 text-[13px] font-semibold ${Math.abs(suma - 100) > 0.05 ? "text-gypi-amber-ink" : "text-gypi-text"}`}>Suman {pct(Math.round(suma * 10) / 10)}</p>
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {Object.keys(valor || {}).length > 0 && <button type="button" className="g-btn g-btn-secondary" disabled={guardando} onClick={() => guardar({})}>Sacar el reparto</button>}
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={guardando || !divisiones.length} onClick={() => guardar(v)}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>
    </Modal>
  );
}

function PorDivision({ filas }) {
  return (
    <section aria-label="Por división" className="mb-3">
      <h3 className="m-0 mb-1 text-[14px] font-bold text-gypi-text">Por división, 12 meses (con su parte de lo compartido)</h3>
      <div className="overflow-x-auto border border-gypi-border rounded-lg">
        <table className="w-full border-collapse text-[13px]" aria-label="Resumen por división">
          <thead>
            <tr className="bg-gypi-surface">
              {["División", "Compartidos", "Ingresos", "Costo de ventas", "Gastos", "Resultado neto", "% sobre ingresos"].map((t, i) => <th key={t} className={`${i ? "text-right" : "text-left"} px-2 py-1.5 whitespace-nowrap`}>{t}</th>)}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.division || "todo"} className={`border-t border-gypi-border text-gypi-text ${f.division ? "" : "font-bold bg-gypi-surface"}`}>
                <td className="px-2 py-1">{f.division || "Toda la empresa"}</td>
                <td className="px-2 py-1 text-right font-mono">{f.division ? pct(f.pct) : ""}</td>
                <td className="px-2 py-1 text-right font-mono whitespace-nowrap">{miles(f.ingresos)}</td>
                <td className="px-2 py-1 text-right font-mono whitespace-nowrap">{miles(f.cmv)}</td>
                <td className="px-2 py-1 text-right font-mono whitespace-nowrap">{miles(f.gastos + f.financiero + f.impuestos)}</td>
                <td className={`px-2 py-1 text-right font-mono whitespace-nowrap ${f.resultado < 0 ? "text-gypi-red" : ""}`}>{miles(f.resultado)}</td>
                <td className="px-2 py-1 text-right font-mono">{Math.abs(f.ingresos) >= 0.01 ? pct(Math.round((f.resultado / f.ingresos) * 1000) / 10) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
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
  const [reparto, setReparto] = useState(false);
  const [division, setDivision] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await apiFetch(`/api/finanzas/resultados?hasta=${hasta}${division ? `&division=${encodeURIComponent(division)}` : ""}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo armar el estado de resultados");
      setDatos(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [hasta, division]);
  useEffect(() => { cargar(); }, [cargar]);

  const abrirCerrar = (id) => setCerradas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (error) return <p role="alert" className="m-[18px] text-[14px] text-gypi-red">⚠ {error}</p>;
  if (!datos) return <div className="flex-1 flex items-center justify-center py-10"><Spinner /></div>;
  const repartidas = Object.keys(datos.config?.ponderador || {});
  const visibles = datos.filas.filter((f) => f.tipo === "seccion" || f.tipo === "resultado" || f.tipo === "pct" || !cerradas.has(f.seccion));

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      <div className="flex flex-wrap items-end gap-2 mb-2">
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">
          Hasta el mes
          <input type="month" className="g-input" aria-label="Hasta el mes" value={hasta} onChange={(e) => e.target.value && setHasta(e.target.value)} />
        </label>
        <p className="m-0 text-[13px] text-gypi-dim flex-1 min-w-[200px]">Devengado, 12 meses, en pesos y sin IVA, ordenado según NIIF (gastos por función). Ingresos = entregas de las OT (precio del Plan, el mes en que se finaliza la OT): se compara lo producido contra los costos. Tocá una sección para abrirla o cerrarla.</p>
        <button type="button" className="g-btn g-btn-secondary" onClick={() => setConfig(true)}>⚙ Materiales ({datos.config?.materiales_real ? "costo real" : pct(datos.config?.materiales_pct)})</button>
        <button type="button" className="g-btn g-btn-secondary" onClick={() => setReparto(true)}>⚙ Compartidos</button>
        {cargando && <Spinner size={16} />}
      </div>

      {repartidas.length > 0 && (
        <>
          <PorDivision filas={datos.por_division || []} />
          <div className="flex flex-wrap items-center gap-2 mb-2" role="group" aria-label="Ver división">
            <Chip active={!datos.division} onClick={() => setDivision("")}>Toda la empresa</Chip>
            {repartidas.map((d) => <Chip key={d} active={datos.division === d} onClick={() => setDivision(d)}>{d}</Chip>)}
          </div>
          {datos.division && <p className="m-0 mb-2 text-[13px] text-gypi-dim">{datos.division}: lo suyo entero (por la OT o el centro de costo) más el {pct(datos.config.ponderador[datos.division])} de lo compartido.</p>}
        </>
      )}

      {!datos.clasificado && (
        <p className="m-0 mb-2 text-[13px] text-gypi-amber-ink">
          ⚠ Ninguna cuenta tiene su renglón del estado de resultados. Andá a Finanzas → Configuración → 📥 Copiar desde el libro y copiá de nuevo el plan de cuentas: así se trae la columna clasificacion_eerr.
        </p>
      )}
      {datos.hay_entregas === false && <p className="m-0 mb-2 text-[13px] text-gypi-amber-ink">⚠ No hay entregas en estos meses. Las entregas se anotan solas al finalizar cada OT si está prendido Finanzas → 👥 Clientes → 🧾 Ventas de las OT.</p>}
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
              const aparte = datos.filas.find((x) => x.tipo === "seccion" && x.id === (f.tipo === "seccion" ? f.id : f.seccion))?.aparte;
              const sangria = f.tipo === "linea" ? "pl-6" : f.tipo === "grupo" ? "pl-4" : "pl-2";
              const valor = f.tipo === "pct" ? pct : miles;
              const negativo = (n) => (f.tipo !== "pct" && n < 0 ? "text-gypi-red" : "");
              return (
                <tr key={f.id} className={`border-t border-gypi-border ${ESTILO[f.tipo]} ${aparte ? "italic opacity-80" : ""}`} onClick={f.tipo === "seccion" ? () => abrirCerrar(f.id) : undefined}>
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
      {reparto && <ConfigPonderador divisiones={datos.divisiones || []} valor={datos.config?.ponderador} onCerrar={() => setReparto(false)} onGuardado={() => { setReparto(false); setDivision(""); cargar(); }} />}
      {config && <ConfigMateriales valor={datos.config?.materiales_pct} real={datos.config?.materiales_real} onCerrar={() => setConfig(false)} onGuardado={() => { setConfig(false); cargar(); }} />}
    </div>
  );
}
