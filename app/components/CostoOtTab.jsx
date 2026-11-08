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
        OT que entraron a Gypi en {labelPeriodo || "el período"}. Las cerradas muestran su costo final (la constancia del cierre); las demás, el de hoy, provisorio. Sin IVA.
      </div>
      {filas.length === 0 ? (
        <div className="bg-gypi-surface rounded-2xl p-6 text-center border border-gypi-border text-[13px] text-gypi-dim">No entraron OT en este período.</div>
      ) : (
        <>
          <section aria-label="Totales" className="grid grid-cols-2 gap-2 mb-3">
            <Stat value={pesos(t.total)} label={`Costo total de ${t.ots} OT`} />
            <Stat value={pesos(t.materiales)} label={t.sin_precio ? `Materiales (${t.sin_precio} sin precio)` : "Materiales"} tone={t.sin_precio ? "atencion" : "normal"} />
            <Stat value={pesos(t.mano_obra)} label="Mano de obra" />
            <Stat value={`${textoHoras(t.horas_reales)} / ${textoHoras(t.horas_presupuestadas)}`} label={t.pct != null ? `Horas reales / presupuestadas (${t.pct} %)` : "Horas reales / presupuestadas"} tone={t.pct == null ? "normal" : t.pct <= 100 ? "bien" : "mal"} />
          </section>
          <button type="button" onClick={exportar} className="g-btn g-btn-secondary mb-3">⬇ Exportar a Excel</button>
          {datos.truncado && <div className="text-xs text-gypi-red mb-2">Se muestran las primeras 200 OT del período: elegí un período más corto para ver todas.</div>}
          <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
            {filas.map((f) => (
              <li key={f.ot} className="p-2.5 rounded-xl border border-gypi-border bg-gypi-surface">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0 text-[13px] font-semibold"><NombreOt proyecto={f} /></div>
                  <div className="text-right">
                    <div className="text-[15px] font-bold">{pesos(f.total)}</div>
                    <div className={`text-xs font-semibold ${f.costo === "final" ? "text-gypi-green" : "text-gypi-amber-ink"}`}>{f.costo === "final" ? "Final" : "Provisorio"}</div>
                  </div>
                </div>
                <div className="text-xs text-gypi-dim mt-0.5">
                  {nombreDivision(f.division)}{f.division ? " · " : ""}entró el {fechaCorta(f.fecha_ot)}
                </div>
                <div className="text-xs text-gypi-dim flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                  <span>Materiales {pesos(f.materiales)}{f.sin_precio ? <span className="text-gypi-red"> ({f.sin_precio} sin precio)</span> : null}</span>
                  <span>Mano de obra {pesos(f.mano_obra)}</span>
                  <span>Horas {textoHoras(f.horas_reales)} de {textoHoras(f.horas_presupuestadas)} <Diferencia f={f} /></span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
