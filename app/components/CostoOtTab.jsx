'use client';
// app/components/CostoOtTab.jsx — Reportes → 💲 Costo por OT (costo de OT,
// parte F; /api/costo-reporte). Solo Dueño y Supervisor. OT que entraron a
// Gypi en el período (y de la división elegida): materiales, horas-persona
// presupuestadas y reales, mano de obra y costo final (de la constancia si la
// OT está cerrada; si no, provisorio). Totales abajo y exportar a Excel.
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { fmtPesos } from "../lib/costo";
import { textoHoras } from "../lib/horasOt";
import { buscarDivision } from "../lib/rutas";
import { exportCSV } from "../lib/exportarReporte";
import { planillaReporte, totalesReporte } from "../lib/costoReporte";
import { margenPor, minimoValido, textoPct } from "../lib/margenOt";
import { Chip } from "./ui";
import NombreOt from "./NombreOt";
import Stat from "./ui/Stat";
import { useToast } from "./ui/Toast";

const pesos = (v) => (v == null ? "—" : fmtPesos(v));
const fechaCorta = (f) => (f ? f.split("-").reverse().join("/") : "");

function Diferencia({ f }) {
  if (f.diferencia == null) return null;
  return <span className={f.diferencia > 0 ? "text-gypi-red" : "text-gypi-green"}>{f.diferencia > 0 ? "+" : ""}{textoHoras(f.diferencia)}{f.pct != null ? ` (${f.pct} %)` : ""}</span>;
}

export default function CostoOtTab({ fechaDesde, fechaHasta, labelPeriodo = "", divisiones = [], division = "todas" }) {
  const toast = useToast();
  const [datos, setDatos] = useState(null);
  const [vista, setVista] = useState("ot");
  const [soloBajas, setSoloBajas] = useState(false);
  const [minimoTxt, setMinimoTxt] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!fechaDesde || !fechaHasta) return;
    let vivo = true;
    apiFetch(`/api/costo-reporte?desde=${fechaDesde}&hasta=${fechaHasta}`)
      .then((r) => r.json().catch(() => null))
      .then((d) => { if (vivo) setDatos({ ...(d || { error: "No se pudo armar el reporte" }), clave: `${fechaDesde}|${fechaHasta}` }); })
      .catch(() => { if (vivo) setDatos({ error: "No se pudo armar el reporte. Revisá la conexión.", clave: `${fechaDesde}|${fechaHasta}` }); });
    return () => { vivo = false; };
  }, [fechaDesde, fechaHasta]);

  const nombreDivision = (d) => buscarDivision(divisiones, d)?.label || d || "";
  const filas = useMemo(() => {
    const div = division === "todas" ? null : buscarDivision(divisiones, division);
    const todas = datos?.filas || [];
    return div ? todas.filter((f) => buscarDivision(divisiones, f.division)?.id === div.id) : todas;
  }, [datos, divisiones, division]);
  const t = useMemo(() => totalesReporte(filas), [filas]);
  const minimo = datos?.margen_minimo ?? 10;
  const grupos = vista === "cliente" ? margenPor(filas, (f) => f.cliente, minimo) : vista === "division" ? margenPor(filas, (f) => nombreDivision(f.division), minimo) : [];
  const visibles = soloBajas ? filas.filter((f) => f.margen_bajo) : filas;

  const guardarMinimo = async () => {
    const v = Number(String(minimoTxt).replace(",", "."));
    if (!minimoValido(v)) { toast.error("El margen mínimo va de 0 a 100 %"); return; }
    setGuardando(true);
    try {
      const res = await apiFetch("/api/costo-reporte", { method: "POST", body: JSON.stringify({ accion: "margen_minimo", minimo: v }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || "No se pudo guardar");
      // El aviso de cada OT se recalcula con el mínimo nuevo
      setDatos((x) => ({ ...x, margen_minimo: d.margen_minimo, filas: x.filas.map((f) => ({ ...f, margen_bajo: f.margen != null && f.margen < d.margen_minimo })) }));
      setMinimoTxt(null);
      toast.success(`✅ Margen mínimo: ${textoPct(d.margen_minimo)}`);
    } catch (e) {
      toast.error(e.message);
    }
    setGuardando(false);
  };

  const exportar = () => {
    exportCSV(planillaReporte(filas, { nombreDivision }), `Costo_por_OT_${fechaDesde}_a_${fechaHasta}.csv`);
    toast.success("Listo: la planilla quedó en tus descargas (se abre con Excel).");
  };

  const cargando = !datos || datos.clave !== `${fechaDesde}|${fechaHasta}`;
  if (cargando) return <div className="text-[13px] text-gypi-dim" role="status">Calculando el costo de cada OT…</div>;
  if (datos.falta_migracion) return <div role="alert" className="text-[13px] text-gypi-dim">{datos.falta_migracion}</div>;
  if (datos.error) return <div role="alert" className="text-[13px] text-gypi-red">{datos.error}</div>;

  return (
    <section aria-label="Costo por OT">
      <div className="text-xs text-gypi-dim mb-2">
        OT que entraron a Gypi en {labelPeriodo || "el período"}. Costo real (MRP, retirado de más, compras sin stock, horas, retrabajo, instalación y gastos de Finanzas) al lado del previsto. Las cerradas muestran su constancia; las demás, el de hoy, provisorio. Sin IVA.
      </div>
      {filas.length === 0 ? (
        <div className="bg-gypi-surface rounded-2xl p-6 text-center border border-gypi-border text-[13px] text-gypi-dim">No entraron OT en este período.</div>
      ) : (
        <>
          <section aria-label="Totales" className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
            {t.margen != null && (
              <Stat value={textoPct(t.margen)} label={`Margen de ${t.con_precio} OT con precio (ganancia ${pesos(t.ganancia)})`} tone={t.margen < minimo ? "mal" : "bien"} />
            )}
            <Stat value={pesos(t.total)} label={`Costo total de ${t.ots} OT`} />
            <Stat value={pesos(t.materiales)} label={t.sin_precio ? `Materiales (${t.sin_precio} sin precio)` : "Materiales"} tone={t.sin_precio ? "atencion" : "normal"} />
            <Stat value={pesos(t.mano_obra)} label="Mano de obra" />
            {t.previsto != null && (
              <Stat value={t.desvio_pct != null ? `${t.desvio_pct} %` : "—"} label={`Real ${pesos(t.real_comparado)} contra previsto ${pesos(t.previsto)}`} tone={t.desvio_pct == null ? "normal" : t.desvio_pct <= 100 ? "bien" : "mal"} />
            )}
            <Stat value={`${textoHoras(t.horas_reales)} / ${textoHoras(t.horas_presupuestadas)}`} label={t.pct != null ? `Horas reales / presupuestadas (${t.pct} %)` : "Horas reales / presupuestadas"} tone={t.pct == null ? "normal" : t.pct <= 100 ? "bien" : "mal"} />
          </section>
          {t.margen_bajo > 0 && (
            <div role="alert" className="mb-2 p-2.5 rounded-xl border border-gypi-red bg-gypi-red/10 text-[13px] font-semibold text-gypi-red">
              ⚠ {t.margen_bajo === 1 ? "1 OT tiene" : `${t.margen_bajo} OT tienen`} el margen por debajo del mínimo de {textoPct(minimo)}.
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Chip active={vista === "ot"} onClick={() => setVista("ot")}>Por OT</Chip>
            <Chip active={vista === "cliente"} onClick={() => setVista("cliente")}>Por cliente</Chip>
            <Chip active={vista === "division"} onClick={() => setVista("division")}>Por división</Chip>
            {vista === "ot" && t.margen_bajo > 0 && <Chip active={soloBajas} onClick={() => setSoloBajas((x) => !x)}>Solo bajo el mínimo</Chip>}
            <span className="flex-1" />
            <label className="text-xs text-gypi-dim flex items-center gap-1.5">
              Margen mínimo
              <input aria-label="Margen mínimo" inputMode="decimal" className="g-input !w-[70px] !min-h-[36px] text-right" value={minimoTxt ?? String(minimo).replace(".", ",")} onChange={(e) => setMinimoTxt(e.target.value)} />
              %
            </label>
            {minimoTxt != null && <button type="button" onClick={guardarMinimo} disabled={guardando} className="g-btn g-btn-primary !min-h-[36px]">{guardando ? "Guardando…" : "Guardar"}</button>}
          </div>
          <button type="button" onClick={exportar} className="g-btn g-btn-secondary mb-3">⬇ Exportar a Excel</button>
          {vista !== "ot" && (
            grupos.length === 0 ? (
              <div className="text-[13px] text-gypi-dim">Ninguna OT del período tiene PRECIO en el Plan de trabajo.</div>
            ) : (
              <ul aria-label={vista === "cliente" ? "Margen por cliente" : "Margen por división"} className="list-none m-0 p-0 flex flex-col gap-1.5">
                {grupos.map((g) => (
                  <li key={g.clave} className={`p-2.5 rounded-xl border bg-gypi-surface ${g.bajo ? "border-gypi-red" : "border-gypi-border"}`}>
                    <div className="flex items-baseline gap-2">
                      <span className="flex-1 min-w-0 text-[13px] font-semibold">{g.clave}</span>
                      <span className={`text-[15px] font-bold ${g.bajo ? "text-gypi-red" : "text-gypi-green"}`}>{textoPct(g.pct)}</span>
                    </div>
                    <div className="text-xs text-gypi-dim flex flex-wrap gap-x-3">
                      <span>{g.ots === 1 ? "1 OT" : `${g.ots} OT`}{g.bajas ? <span className="text-gypi-red"> ({g.bajas} bajo el mínimo)</span> : null}</span>
                      <span>Precio {pesos(g.precio)}</span>
                      <span>Costo {pesos(g.costo)}</span>
                      <span>Ganancia {pesos(g.ganancia)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )
          )}
          {datos.truncado && <div className="text-xs text-gypi-red mb-2">Se muestran las primeras 200 OT del período: elegí un período más corto para ver todas.</div>}
          {vista === "ot" && <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
            {visibles.map((f) => (
              <li key={f.ot} className={`p-2.5 rounded-xl border bg-gypi-surface ${f.margen_bajo ? "border-gypi-red" : "border-gypi-border"}`}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0 text-[13px] font-semibold"><NombreOt proyecto={f} /></div>
                  <div className="text-right">
                    <div className="text-[15px] font-bold">{pesos(f.total)}</div>
                    <div className={`text-xs font-semibold ${f.costo === "final" ? "text-gypi-green" : "text-gypi-amber-ink"}`}>{f.costo === "final" ? "Final" : "Provisorio"}</div>
                  </div>
                </div>
                {f.margen != null ? (
                  <div className={`text-[13px] font-semibold mt-0.5 ${f.margen_bajo ? "text-gypi-red" : "text-gypi-green"}`}>
                    {f.margen_bajo ? "⚠ " : ""}Margen {textoPct(f.margen)} · ganancia {pesos(f.ganancia)} de {pesos(f.precio)}
                  </div>
                ) : (
                  <div className="text-xs text-gypi-dim mt-0.5">Sin PRECIO en el Plan: sin margen</div>
                )}
                <div className="text-xs text-gypi-dim mt-0.5">
                  {nombreDivision(f.division)}{f.division ? " · " : ""}entró el {fechaCorta(f.fecha_ot)}
                </div>
                <div className="text-xs text-gypi-dim flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                  <span>Materiales {pesos(f.materiales)}{f.sin_precio ? <span className="text-gypi-red"> ({f.sin_precio} sin precio)</span> : null}</span>
                  <span>Mano de obra {pesos(f.mano_obra)}</span>
                  {f.gastos ? <span>Gastos {pesos(f.gastos)}</span> : null}
                  {f.previsto != null && <span>Previsto {pesos(f.previsto)}{f.desvio ? <span className={f.desvio > 0 ? "text-gypi-red" : "text-gypi-green"}> ({f.desvio > 0 ? "+" : ""}{pesos(f.desvio)})</span> : null}</span>}
                  <span>Horas {textoHoras(f.horas_reales)} de {textoHoras(f.horas_presupuestadas)} <Diferencia f={f} /></span>
                </div>
              </li>
            ))}
          </ul>}
        </>
      )}
    </section>
  );
}
