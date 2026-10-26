'use client';
// app/components/GanttOt.jsx — 📅 Gantt de OT (Proyectos → OT; migración 135;
// diseño en notes/diseno-gantt-ot.md). Un renglón por OT abierta, sin
// TERMINADO y con semana objetivo, agrupadas por división. La barra va desde
// que la OT arrancó hasta el fin de su semana, rellena con el % de avance:
// roja si la semana ya pasó, amarilla si vence esta semana, verde a tiempo.
// El dibujo es SVG: así cada barra se ubica sin estilos sueltos.
import { useEffect, useMemo, useRef } from "react";
import { filasTablero, nombreDivisionOt } from "../lib/avance";
import { avancePorOt } from "../lib/piezas";
import { filasGantt, escalaGantt, primerEscaneoPorOt, diasDesde } from "../lib/gantt";
import { textoObjetivo, MODO_POR_DEFECTO } from "../lib/semanaObjetivo";
import { hoyArg } from "../lib/dates";

const COL = 40; // ancho de una semana
const ALTO = 44;
const COLOR = { atrasada: "fill-gypi-red", esta_semana: "fill-gypi-amber", a_tiempo: "fill-gypi-green" };
const NOMBRE = { atrasada: "atrasada", esta_semana: "vence esta semana", a_tiempo: "a tiempo" };

const diaMes = (iso) => { const [, m, d] = String(iso).split("-"); return `${Number(d)}/${Number(m)}`; };

export default function GanttOt({ proyectos = [], etapas = [], divisiones = [], avanceHoras = null, modo = MODO_POR_DEFECTO, onVerDetalle }) {
  const hoy = hoyArg();
  const { renglones, escala, grupos, faltaMigracion } = useMemo(() => {
    const abiertas = proyectos.filter((p) => p.estado !== "cerrado");
    const filas = filasTablero(abiertas, { etapas, divisiones, avance: avanceHoras?.avance || [], horas: avanceHoras?.horas || new Set(), hoy });
    const piezas = avanceHoras?.piezas || [];
    const renglones = filasGantt(filas, { porEscaneo: avancePorOt(piezas), primerEscaneo: primerEscaneoPorOt(piezas), hoy, modo });
    const grupos = new Map();
    for (const r of renglones) {
      const n = nombreDivisionOt(divisiones, r.proyecto.division);
      if (!grupos.has(n)) grupos.set(n, []);
      grupos.get(n).push(r);
    }
    return {
      renglones,
      escala: escalaGantt(renglones, { hoy, modo }),
      grupos: [...grupos].sort((a, b) => a[0].localeCompare(b[0], "es")),
      faltaMigracion: abiertas.length > 0 && abiertas.every((p) => !("fecha_objetivo" in p)),
    };
  }, [proyectos, etapas, divisiones, avanceHoras, hoy, modo]);

  const cuenta = (e) => renglones.filter((r) => r.estado === e).length;
  const ancho = escala.semanas.length * COL + 64; // lugar para el % de la última barra
  const x = (fecha) => Math.max(0, (diasDesde(escala.desde, fecha) / 7) * COL);
  const xHoy = x(hoy);
  // En el celular se abre mostrando la semana actual (con dos semanas antes), no la más vieja
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, xHoy - 2 * COL);
  }, [xHoy]);

  if (faltaMigracion) {
    return <div className="g-card text-[13px] text-gypi-dim">Para ver el Gantt falta correr la migración 135 en Supabase y después apretar Sincronizar.</div>;
  }
  if (!renglones.length) {
    return (
      <div className="g-card py-8 px-6 text-center">
        <div className="text-[28px] mb-2">📅</div>
        <div className="text-sm font-bold text-gypi-text mb-1">No hay OT para mostrar</div>
        <div className="text-xs text-gypi-dim">Se ven las OT sin terminar que tienen cargada la semana en la planilla. Si la cargaste recién, apretá Sincronizar.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-gypi-dim mb-2">
        <span>🔴 Atrasadas {cuenta("atrasada")}</span>
        <span>🟡 Vencen esta semana {cuenta("esta_semana")}</span>
        <span>🟢 A tiempo {cuenta("a_tiempo")}</span>
      </div>
      <div ref={scrollRef} className="overflow-x-auto rounded-xl border border-gypi-border">
        <div className="min-w-max">
          <div className="flex border-b border-gypi-border">
            <div className="sticky left-0 z-10 w-[136px] shrink-0 bg-gypi-bg px-2 flex items-end pb-1 text-[12px] font-bold text-gypi-dim">OT</div>
            <svg width={ancho} height={36} aria-hidden="true" className="block">
              {escala.semanas.map((s, i) => (
                <g key={s.inicio}>
                  {s.actual && <rect x={i * COL} y={0} width={COL} height={36} className="fill-gypi-amber" fillOpacity={0.15} />}
                  <text x={i * COL + COL / 2} y={15} textAnchor="middle" className={`text-[12px] font-bold ${s.actual ? "fill-gypi-text" : "fill-gypi-dim"}`}>{s.numero != null ? `S${s.numero}` : diaMes(s.inicio)}</text>
                  {s.numero != null && <text x={i * COL + COL / 2} y={31} textAnchor="middle" className="text-[12px] fill-gypi-mute">{diaMes(s.inicio)}</text>}
                </g>
              ))}
            </svg>
          </div>
          {grupos.map(([division, filas]) => (
            <div key={division}>
              <div className="sticky left-0 w-[136px] px-2 pt-2 pb-1 text-[12px] font-bold text-gypi-text bg-gypi-bg">{division} · {filas.length}</div>
              {filas.map((r) => {
                const desde = x(r.inicio);
                const largo = Math.max(6, x(r.fin) + COL / 7 - desde);
                const hecho = r.porcentaje != null ? (largo * Math.min(100, r.porcentaje)) / 100 : 0;
                const p = r.proyecto;
                return (
                  <div key={p.id ?? p.ot} className="flex border-t border-gypi-border">
                    <button type="button" onClick={() => onVerDetalle?.(p)}
                      aria-label={`OT ${p.ot}, ${textoObjetivo(p, modo)}, ${NOMBRE[r.estado]}${r.porcentaje != null ? `, ${r.porcentaje}% hecho` : ""}. Ver detalle`}
                      className="sticky left-0 z-10 w-[136px] shrink-0 bg-gypi-bg px-2 py-1 text-left border-0 border-r border-gypi-border cursor-pointer min-h-11">
                      <div className="font-mono text-[13px] font-bold text-gypi-text truncate">{p.ot}</div>
                      <div className="text-[12px] text-gypi-dim truncate">{p.cliente || p.obra || p.proyecto || "—"}</div>
                    </button>
                    <svg width={ancho} height={ALTO} aria-hidden="true" className="block">
                      <rect x={xHoy} y={0} width={2} height={ALTO} className="fill-gypi-amber" fillOpacity={0.6} />
                      <rect x={desde} y={12} width={largo} height={20} rx={5} className={COLOR[r.estado]} fillOpacity={0.25} />
                      {hecho > 0 && <rect x={desde} y={12} width={hecho} height={20} rx={5} className={COLOR[r.estado]} />}
                      <text x={desde + largo + 4} y={26} className="text-[12px] font-bold fill-gypi-text">
                        {r.porcentaje != null ? `${r.porcentaje}%` : ""}{p.semana_objetivo && modo !== "entrega" ? ` S${p.semana_objetivo}` : ""}
                      </text>
                    </svg>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="text-[12px] text-gypi-mute mt-2 mb-0">La barra empieza cuando la OT se liberó o se escaneó la primera pieza, y termina el último día de su semana. Tocá una OT para ver su detalle.</p>
    </div>
  );
}
