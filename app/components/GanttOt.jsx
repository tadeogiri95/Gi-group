'use client';
// app/components/GanttOt.jsx — 📅 Gantt de OT (Proyectos → OT; migración 135;
// diseño en notes/diseno-gantt-ot.md). Un renglón por OT abierta, sin
// TERMINADO y con semana objetivo, agrupadas por división. La barra va desde
// que la OT arrancó hasta el fin de su semana, rellena con el % de avance:
// roja si la semana ya pasó, amarilla si vence esta semana, verde a tiempo.
// El dibujo es SVG: así cada barra se ubica sin estilos sueltos.
// Se ve por días (con la semana arriba) o por semanas; la fila de las fechas
// queda fija arriba al bajar, y "Pantalla completa" lo abre en toda la
// pantalla para girar el celular.
import { useEffect, useMemo, useRef, useState } from "react";
import { Chip } from "./ui";
import { useEscape } from "../hooks/useEscape";
import { filasTablero, nombreDivisionOt } from "../lib/avance";
import { avancePorOt } from "../lib/piezas";
import { filasGantt, escalaGantt, primerEscaneoPorOt, diasDesde } from "../lib/gantt";
import { textoObjetivo, MODO_POR_DEFECTO } from "../lib/semanaObjetivo";
import { hoyArg } from "../lib/dates";

const PX_DIA = { dias: 22, semanas: 40 / 7 }; // ancho de un día según cómo se ve
const ALTO = 44;
const COLOR = { atrasada: "fill-gypi-red", esta_semana: "fill-gypi-amber", a_tiempo: "fill-gypi-green" };
const NOMBRE = { atrasada: "atrasada", esta_semana: "vence esta semana", a_tiempo: "a tiempo" };

const DIA_MS = 86400000;
const sumarDias = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
const diaSemana = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

/** Pantalla completa y apaisada en el celular (donde se puede; si no, igual ocupa toda la pantalla). */
async function pedirPantallaCompleta() {
  try { await document.documentElement.requestFullscreen?.(); } catch { /* el navegador no deja */ }
  try { await globalThis.screen?.orientation?.lock?.("landscape"); } catch { /* se gira a mano */ }
}
function salirPantallaCompleta() {
  try { globalThis.screen?.orientation?.unlock?.(); } catch { /* nada */ }
  try { if (document.fullscreenElement) document.exitFullscreen?.(); } catch { /* nada */ }
}

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

  const [vista, setVista] = useState("dias");
  const [grande, setGrande] = useState(false);
  const cerrarGrande = () => { setGrande(false); salirPantallaCompleta(); };
  useEscape(cerrarGrande, grande);
  useEffect(() => () => { salirPantallaCompleta(); }, []);

  const px = PX_DIA[vista];
  const COL = 7 * px; // ancho de una semana
  const cuenta = (e) => renglones.filter((r) => r.estado === e).length;
  const ancho = escala.semanas.length * COL + 64; // lugar para el % de la última barra
  const x = (fecha) => Math.max(0, diasDesde(escala.desde, fecha) * px);
  const xHoy = x(hoy);
  // Se abre mostrando la semana actual (con dos semanas antes), no la más vieja
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, xHoy - 2 * COL);
  }, [xHoy, COL, grande]);
  const separadores = escala.semanas.map((s, i) => <rect key={s.inicio} x={i * COL} y={0} width={1} height={ALTO} className="fill-gypi-border" />);

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

  const cabeceraSemanas = escala.semanas.map((s, i) => (
    <g key={s.inicio}>
      {s.actual && <rect x={i * COL} y={0} width={COL} height={36} className="fill-gypi-amber" fillOpacity={0.15} />}
      <text x={i * COL + COL / 2} y={15} textAnchor="middle" className={`text-[12px] font-bold ${s.actual ? "fill-gypi-text" : "fill-gypi-dim"}`}>{s.numero != null ? `S${s.numero}` : diaMes(s.inicio)}</text>
      {s.numero != null && <text x={i * COL + COL / 2} y={31} textAnchor="middle" className="text-[12px] fill-gypi-mute">{diaMes(s.inicio)}</text>}
    </g>
  ));
  // Por días: arriba la semana, abajo el número de cada día (sábado y domingo más claros)
  const cabeceraDias = escala.semanas.map((s, i) => (
    <g key={s.inicio}>
      {s.actual && <rect x={i * COL} y={0} width={COL} height={18} className="fill-gypi-amber" fillOpacity={0.15} />}
      <rect x={i * COL} y={0} width={1} height={36} className="fill-gypi-border" />
      <text x={i * COL + 4} y={14} className={`text-[12px] font-bold ${s.actual ? "fill-gypi-text" : "fill-gypi-dim"}`}>
        {s.numero != null ? `S${s.numero} · ${diaMes(s.inicio)}` : diaMes(s.inicio)}
      </text>
      {Array.from({ length: 7 }, (_, d) => {
        const dia = sumarDias(s.inicio, d);
        const finde = [0, 6].includes(diaSemana(dia));
        return (
          <g key={dia}>
            {dia === hoy && <rect x={i * COL + d * px} y={18} width={px} height={18} className="fill-gypi-amber" fillOpacity={0.35} />}
            <text x={i * COL + d * px + px / 2} y={32} textAnchor="middle" className={`text-[12px] ${finde ? "fill-gypi-mute" : "fill-gypi-text"}`}>{Number(dia.slice(8))}</text>
          </g>
        );
      })}
    </g>
  ));

  return (
    <div className={grande ? "fixed inset-0 z-[300] bg-gypi-bg p-3 flex flex-col" : ""} role={grande ? "dialog" : undefined} aria-label={grande ? "Gantt de OT en pantalla completa" : undefined}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="flex gap-1.5" role="group" aria-label="Escala del Gantt">
          <Chip active={vista === "dias"} onClick={() => setVista("dias")}>Días</Chip>
          <Chip active={vista === "semanas"} onClick={() => setVista("semanas")}>Semanas</Chip>
        </div>
        <button type="button" onClick={grande ? cerrarGrande : () => { setGrande(true); pedirPantallaCompleta(); }}
          className="ml-auto min-h-11 px-3 rounded-xl border border-gypi-border bg-gypi-surface text-gypi-text text-[13px] font-bold cursor-pointer">
          {grande ? "✕ Salir" : "⛶ Pantalla completa"}
        </button>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-gypi-dim mb-2">
        <span>🔴 Atrasadas {cuenta("atrasada")}</span>
        <span>🟡 Vencen esta semana {cuenta("esta_semana")}</span>
        <span>🟢 A tiempo {cuenta("a_tiempo")}</span>
      </div>
      {/* Con scroll propio para que la fila de las fechas quede fija arriba al bajar */}
      <div ref={scrollRef} className={`overflow-auto rounded-xl border border-gypi-border ${grande ? "flex-1 min-h-0" : "max-h-[70vh]"}`}>
        <div className="min-w-max">
          <div className="flex border-b border-gypi-border sticky top-0 z-20 bg-gypi-bg">
            <div className="sticky left-0 z-30 w-[136px] shrink-0 bg-gypi-bg px-2 flex items-end pb-1 text-[12px] font-bold text-gypi-dim">OT</div>
            <svg width={ancho} height={36} aria-hidden="true" className="block">
              {vista === "dias" ? cabeceraDias : cabeceraSemanas}
            </svg>
          </div>
          {grupos.map(([division, filas]) => (
            <div key={division}>
              <div className="sticky left-0 w-[136px] px-2 pt-2 pb-1 text-[12px] font-bold text-gypi-text bg-gypi-bg">{division} · {filas.length}</div>
              {filas.map((r) => {
                const desde = x(r.inicio);
                const largo = Math.max(6, x(r.fin) + px - desde);
                const hecho = r.porcentaje != null ? (largo * Math.min(100, r.porcentaje)) / 100 : 0;
                const p = r.proyecto;
                return (
                  <div key={p.id ?? p.ot} className="flex border-t border-gypi-border">
                    <button type="button" onClick={() => { if (grande) cerrarGrande(); onVerDetalle?.(p); }}
                      aria-label={`OT ${p.ot}, ${textoObjetivo(p, modo)}, ${NOMBRE[r.estado]}${r.porcentaje != null ? `, ${r.porcentaje}% hecho` : ""}. Ver detalle`}
                      className="sticky left-0 z-10 w-[136px] shrink-0 bg-gypi-bg px-2 py-1 text-left border-0 border-r border-gypi-border cursor-pointer min-h-11">
                      <div className="font-mono text-[13px] font-bold text-gypi-text truncate">{p.ot}</div>
                      <div className="text-[12px] text-gypi-dim truncate">{p.cliente || p.obra || p.proyecto || "—"}</div>
                    </button>
                    <svg width={ancho} height={ALTO} aria-hidden="true" className="block">
                      {separadores}
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
      <p className="text-[12px] text-gypi-mute mt-2 mb-0">La barra empieza cuando la OT se liberó o se escaneó la primera pieza, y termina el último día de su semana objetivo. Tocá una OT para ver su detalle.</p>
    </div>
  );
}
