'use client';
// app/components/GanttPlan.jsx — Gantt de planificación (Proyectos →
// Planificación → 📊 Carga → Ordenar automáticamente; parte 40). Una fila por
// OT y una columna por día: en cada día, un bloque de color por etapa que se
// trabaja. Arriba, las horas que se usan cada día; los días de horas extra
// van marcados con ⏱. Sin estilos sueltos: anchos fijos con clases.
import { ETAPAS_PLAN } from "../lib/planificacion";
import { celdasGantt } from "../lib/planAutomatico";
import { fmtH } from "../lib/cargaPlanta";

export const COLOR_ETAPA = { corte: "bg-proc-corte", canteado: "bg-proc-canteado", mecanizado: "bg-proc-mecanizado", armado: "bg-proc-armado" };
const INICIAL = ["D", "L", "M", "M", "J", "V", "S"];
const diaSemana = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const diaMes = (iso) => Number(String(iso).slice(8, 10));
const corto = (iso) => { const [, m, d] = String(iso).split("-"); return `${Number(d)}/${Number(m)}`; };
const nombreEtapa = Object.fromEntries(ETAPAS_PLAN.map((e) => [e.id, e.nombre]));

export default function GanttPlan({ plan, ots, hoy }) {
  const celdas = celdasGantt(plan.segmentos);
  const filas = ots.filter((p) => celdas.has(p.id));
  const dias = plan.porDia;

  return (
    <div aria-label="Gantt de planificación">
      <div className="flex gap-3 flex-wrap text-xs text-gypi-dim mb-2">
        {ETAPAS_PLAN.map((e) => (
          <span key={e.id} className="flex items-center gap-1"><span className={`inline-block w-3 h-3 rounded-sm ${COLOR_ETAPA[e.id]}`} />{e.nombre}</span>
        ))}
        <span>⏱ = día de horas extra</span>
      </div>
      <div className="overflow-x-auto border border-gypi-border rounded-xl">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-gypi-surface min-w-[110px] text-left px-2 py-1 font-normal text-gypi-dim">OT</th>
              {dias.map((d) => (
                <th key={d.fecha} className={`w-[32px] min-w-[32px] px-0 py-1 font-normal ${d.extra ? "bg-gypi-red/15 text-gypi-red-ink" : d.fecha === hoy ? "bg-gypi-amber/20" : "text-gypi-dim"}`}>
                  <div>{INICIAL[diaSemana(d.fecha)]}</div>
                  <div className="font-bold">{diaMes(d.fecha)}</div>
                  {d.extra && <div aria-label={`Horas extra el ${corto(d.fecha)}`}>⏱</div>}
                </th>
              ))}
            </tr>
            <tr>
              <th className="sticky left-0 z-10 bg-gypi-surface text-left px-2 py-1 font-normal text-gypi-dim">Horas del día</th>
              {dias.map((d) => (
                <td key={d.fecha} className={`text-center py-1 ${d.usadas > 0 ? (d.extra ? "text-gypi-red-ink font-bold" : "font-bold") : "text-gypi-mute"}`}
                  title={`${corto(d.fecha)}: ${fmtH(d.usadas)} de ${fmtH(d.disponibles)}`}>
                  {d.usadas > 0 ? Math.round(d.usadas) : d.disponibles > 0 ? "·" : ""}
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((p) => {
              const porDia = celdas.get(p.id);
              return (
                <tr key={p.id} className="border-t border-gypi-border">
                  <th scope="row" className="sticky left-0 z-10 bg-gypi-surface text-left px-2 py-1 font-normal max-w-[110px]">
                    <div className="font-bold truncate">{p.prioridad ? `${p.prioridad}. ` : ""}{p.ot}</div>
                    <div className="text-gypi-dim truncate">{p.cliente || p.proyecto || ""}</div>
                  </th>
                  {dias.map((d) => {
                    const c = porDia.get(d.fecha);
                    const texto = c ? ETAPAS_PLAN.filter((e) => c[e.id]).map((e) => `${e.nombre} ${fmtH(c[e.id])}`).join(", ") : "";
                    return (
                      <td key={d.fecha} className={`p-[2px] h-[34px] ${d.extra ? "bg-gypi-red/5" : ""}`}
                        aria-label={c ? `OT ${p.ot}, ${corto(d.fecha)}: ${texto}` : undefined} title={texto || undefined}>
                        {c && (
                          <div className="flex flex-col gap-[1px] h-full">
                            {ETAPAS_PLAN.filter((e) => c[e.id]).map((e) => <div key={e.id} className={`flex-1 rounded-sm ${COLOR_ETAPA[e.id]}`} />)}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!filas.length && <div className="text-sm text-gypi-dim py-3 text-center">Ninguna OT elegida tiene horas para planificar.</div>}
      {filas.length > 0 && <div className="text-xs text-gypi-dim mt-1">Tocá o pasá el mouse por un día para ver las horas de cada etapa. Las etapas van en orden: {ETAPAS_PLAN.map((e) => nombreEtapa[e.id]).join(", ")}.</div>}
    </div>
  );
}
