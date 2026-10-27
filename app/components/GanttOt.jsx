'use client';
// app/components/GanttOt.jsx — 📅 Gantt de OT (Proyectos → OT). Muestra el
// plan de producción confirmado en Proyectos → Planificación (migración 138),
// pensado para verse en un televisor. Cada OT tiene 4 renglones, uno por
// proceso (Corte, Canteado, Mecanizado, Armado), cada uno con su color fijo:
// azul, naranja, violeta y marrón claro. En la OT un proceso arranca cuando
// termina el anterior, y por cada proceso pasa una sola OT a la vez, con las
// horas de la grilla de horarios del personal operativo (procesosPlan). Al
// lado de cada barra van sus horas y al lado de la OT las horas totales (la
// suma de sus procesos).
// Un proceso con poco margen lleva un contorno amarillo y uno atrasado (pasó
// su último día y no está completo por el escaneo de piezas) contorno rojo y
// ⚠; el color del proceso se sigue viendo. Uno completo queda más claro.
// Se ve por días, semanas o mes; la fila de las fechas queda fija arriba al
// bajar y "Pantalla completa" lo abre en toda la pantalla.
import { useEffect, useMemo, useRef, useState } from "react";
import { Chip } from "./ui";
import { useEscape } from "../hooks/useEscape";
import { nombreDivisionOt } from "../lib/avance";
import { escalaGantt, diasDesde } from "../lib/gantt";
import { itemsVigentes, procesosPlan, etapasDelPlan, leerPlanesConfirmados, horasSemanaDeGrilla } from "../lib/ganttPlan";
import { ETAPAS_PLAN, normalizarParametros } from "../lib/planificacion";
import { MODO_POR_DEFECTO } from "../lib/semanaObjetivo";
import { hoyArg } from "../lib/dates";
import { fechaCorta } from "../lib/ot";
import { fmtH } from "../lib/cargaPlanta";

const PX_DIA = { dias: 44, semanas: 14, mes: 5 }; // ancho de un día según cómo se ve
const FILA = 34; // alto del renglón de cada proceso
const BARRA = { y: 6, alto: 22 };
const CAB = 44; // alto de la fila de las fechas
const COLOR = { corte: "fill-proc-corte", canteado: "fill-proc-canteado", mecanizado: "fill-proc-mecanizado", armado: "fill-proc-armado" };
const MUESTRA = { corte: "bg-proc-corte", canteado: "bg-proc-canteado", mecanizado: "bg-proc-mecanizado", armado: "bg-proc-armado" };
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const SIN_EMPLEADOS = [];
const DIA_MS = 86400000;
const sumarDias = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
const diaSemana = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

/** Pantalla completa y apaisada (televisor o celular; si no se puede, igual ocupa toda la pantalla). */
async function pedirPantallaCompleta() {
  try { await document.documentElement.requestFullscreen?.(); } catch { /* el navegador no deja */ }
  try { await globalThis.screen?.orientation?.lock?.("landscape"); } catch { /* se gira a mano */ }
}
function salirPantallaCompleta() {
  try { globalThis.screen?.orientation?.unlock?.(); } catch { /* nada */ }
  try { if (document.fullscreenElement) document.exitFullscreen?.(); } catch { /* nada */ }
}

const diaMes = (iso) => { const [, m, d] = String(iso).split("-"); return `${Number(d)}/${Number(m)}`; };
const estadoDe = (q) => (q.atrasado ? "atrasado" : q.margen ? "margen" : q.completo ? "completo" : "pendiente");
const CONTORNO = { atrasado: "stroke-gypi-red", margen: "stroke-proc-margen" };

/**
 * @param {object} props
 * @param {object[]} [props.planes]  planes confirmados con sus días; si no viene, se leen
 * @param {object} [props.cfgValor]  parámetros de la planificación (qué etapa es cada proceso)
 * @param {object[]} [props.empleados]  personal operativo con su grilla de horarios (junto con planes)
 */
export default function GanttOt({ proyectos = [], etapas = [], divisiones = [], avanceHoras = null, modo = MODO_POR_DEFECTO, planes: planesProp, cfgValor: cfgProp, empleados: empleadosProp = SIN_EMPLEADOS, onVerDetalle }) {
  const hoy = hoyArg();
  const [leido, setLeido] = useState(null);
  useEffect(() => {
    if (planesProp !== undefined) return;
    let vivo = true;
    leerPlanesConfirmados().then((d) => { if (vivo) setLeido(d); });
    return () => { vivo = false; };
  }, [planesProp]);
  const planes = planesProp !== undefined ? planesProp : leido?.planes;
  const cfgValor = planesProp !== undefined ? cfgProp : leido?.cfgValor;
  const empleados = planesProp !== undefined ? empleadosProp : leido?.empleados;

  const { renglones, escala, grupos, atrasados, pocoMargen } = useMemo(() => {
    if (!planes) return { renglones: null };
    const abiertas = new Map(proyectos.filter((p) => p.estado !== "cerrado").map((p) => [String(p.ot), p]));
    const procesos = procesosPlan(itemsVigentes(planes), {
      etapasCodigo: etapasDelPlan(cfgValor, etapas, divisiones),
      avance: avanceHoras?.avance || [], piezas: avanceHoras?.piezas || [],
      terminadas: new Set(proyectos.filter((p) => p.terminado_planilla).map((p) => String(p.ot))), hoy,
      params: normalizarParametros(cfgValor), horasSemana: horasSemanaDeGrilla(empleados, divisiones, cfgValor),
    });
    // En el orden del plan: la que arranca primero arriba
    const renglones = [...procesos.values()].filter((r) => abiertas.has(r.ot)).map((r) => ({ ...r, proyecto: abiertas.get(r.ot) }));
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
      atrasados: renglones.flatMap((r) => r.atrasados.map((p) => ({ ...p, ot: r.ot, proyecto: r.proyecto })))
        .sort((a, b) => b.diasAtraso - a.diasAtraso),
      pocoMargen: renglones.flatMap((r) => r.pocoMargen),
    };
  }, [planes, cfgValor, empleados, proyectos, etapas, divisiones, avanceHoras, hoy, modo]);

  const [vista, setVista] = useState("dias");
  const [grande, setGrande] = useState(false);
  const [verAtrasados, setVerAtrasados] = useState(true);
  const cerrarGrande = () => { setGrande(false); salirPantallaCompleta(); };
  useEscape(cerrarGrande, grande);
  useEffect(() => () => { salirPantallaCompleta(); }, []);

  const px = PX_DIA[vista];
  const COL = 7 * px; // ancho de una semana
  const semanas = escala?.semanas || [];
  const ancho = semanas.length * COL + 120; // lugar para las horas de la última barra
  const desde = escala?.desde || hoy;
  const x = (fecha) => Math.max(0, diasDesde(desde, fecha) * px);
  const xHoy = x(hoy);
  // Se abre mostrando la semana actual (con una semana antes), no la más vieja
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, xHoy - COL);
  }, [xHoy, COL, grande]);

  if (!renglones) return <div className="gypi-dots py-6" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>;
  if (!renglones.length) {
    return (
      <div className="g-card py-8 px-6 text-center">
        <div className="text-[28px] mb-2">📅</div>
        <div className="text-sm font-bold text-gypi-text mb-1">No hay OT planificadas</div>
        <div className="text-xs text-gypi-dim">Acá se ve el plan confirmado en Proyectos → Planificación: armalo en 📊 Carga con &quot;Ordenar automáticamente&quot; y tocá &quot;Confirmar plan&quot;.</div>
      </div>
    );
  }

  const totalDias = semanas.length * 7;
  // Fondo de cada renglón: fines de semana más oscuros (por días), separadores de semana y la línea de hoy
  const fondo = (
    <g>
      {vista === "dias" && Array.from({ length: totalDias }, (_, d) => sumarDias(desde, d)).filter((f) => [0, 6].includes(diaSemana(f)))
        .map((f) => <rect key={f} x={x(f)} y={0} width={px} height={FILA} className="fill-gypi-surf-hi" />)}
      {vista !== "mes" && semanas.map((s, i) => <rect key={s.inicio} x={i * COL} y={0} width={1} height={FILA} className="fill-gypi-border" />)}
      {vista === "mes" && Array.from({ length: totalDias }, (_, d) => sumarDias(desde, d)).filter((f) => f.endsWith("-01"))
        .map((f) => <rect key={f} x={x(f)} y={0} width={1} height={FILA} className="fill-gypi-border" />)}
      <rect x={xHoy} y={0} width={2} height={FILA} className="fill-gypi-amber" fillOpacity={0.7} />
    </g>
  );

  const cabeceraSemanas = semanas.map((s, i) => (
    <g key={s.inicio}>
      {s.actual && <rect x={i * COL} y={0} width={COL} height={CAB} className="fill-gypi-amber" fillOpacity={0.15} />}
      <rect x={i * COL} y={0} width={1} height={CAB} className="fill-gypi-border" />
      <text x={i * COL + COL / 2} y={19} textAnchor="middle" className={`text-[14px] font-bold ${s.actual ? "fill-gypi-text" : "fill-gypi-dim"}`}>{s.numero != null ? `S${s.numero}` : diaMes(s.inicio)}</text>
      {s.numero != null && <text x={i * COL + COL / 2} y={37} textAnchor="middle" className="text-[13px] fill-gypi-mute">{diaMes(s.inicio)}</text>}
    </g>
  ));
  // Por días: arriba la semana, abajo el número de cada día (sábado y domingo más claros)
  const cabeceraDias = semanas.map((s, i) => (
    <g key={s.inicio}>
      {s.actual && <rect x={i * COL} y={0} width={COL} height={20} className="fill-gypi-amber" fillOpacity={0.15} />}
      <rect x={i * COL} y={0} width={1} height={CAB} className="fill-gypi-border" />
      <text x={i * COL + 6} y={16} className={`text-[14px] font-bold ${s.actual ? "fill-gypi-text" : "fill-gypi-dim"}`}>
        {s.numero != null ? `S${s.numero} · ${diaMes(s.inicio)}` : diaMes(s.inicio)}
      </text>
      {Array.from({ length: 7 }, (_, d) => {
        const dia = sumarDias(s.inicio, d);
        const finde = [0, 6].includes(diaSemana(dia));
        return (
          <g key={dia}>
            {dia === hoy && <rect x={i * COL + d * px} y={21} width={px} height={CAB - 21} className="fill-gypi-amber" fillOpacity={0.35} />}
            <text x={i * COL + d * px + px / 2} y={39} textAnchor="middle" className={`text-[14px] ${finde ? "fill-gypi-mute" : "fill-gypi-text font-bold"}`}>{Number(dia.slice(8))}</text>
          </g>
        );
      })}
    </g>
  ));
  // Por mes: el nombre de cada mes y, abajo, el número de semana
  const meses = [];
  for (let d = 0; d < totalDias; d++) {
    const f = sumarDias(desde, d);
    if (d === 0 || f.endsWith("-01")) meses.push({ f, x: d * px });
  }
  const cabeceraMes = (
    <g>
      {meses.map((m, i) => {
        const fin = meses[i + 1]?.x ?? totalDias * px;
        const actual = hoy.slice(0, 7) === m.f.slice(0, 7);
        return (
          <g key={m.f}>
            {actual && <rect x={m.x} y={0} width={fin - m.x} height={20} className="fill-gypi-amber" fillOpacity={0.15} />}
            <rect x={m.x} y={0} width={1} height={CAB} className="fill-gypi-border" />
            <text x={m.x + 6} y={16} className={`text-[14px] font-bold ${actual ? "fill-gypi-text" : "fill-gypi-dim"}`}>{fin - m.x > 60 ? `${MESES[Number(m.f.slice(5, 7)) - 1]} ${m.f.slice(0, 4)}` : ""}</text>
          </g>
        );
      })}
      {semanas.map((s, i) => s.numero != null && <text key={s.inicio} x={i * COL + COL / 2} y={38} textAnchor="middle" className="text-[13px] fill-gypi-mute">S{s.numero}</text>)}
    </g>
  );

  const verDetalle = (p) => { if (grande) cerrarGrande(); onVerDetalle?.(p); };

  return (
    <div className={grande ? "fixed inset-0 z-[300] bg-gypi-bg p-3 flex flex-col" : ""} role={grande ? "dialog" : undefined} aria-label={grande ? "Gantt de OT en pantalla completa" : undefined}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="flex gap-1.5" role="group" aria-label="Escala del Gantt">
          <Chip active={vista === "dias"} onClick={() => setVista("dias")}>Días</Chip>
          <Chip active={vista === "semanas"} onClick={() => setVista("semanas")}>Semanas</Chip>
          <Chip active={vista === "mes"} onClick={() => setVista("mes")}>Mes</Chip>
        </div>
        <button type="button" onClick={grande ? cerrarGrande : () => { setGrande(true); pedirPantallaCompleta(); }}
          className="ml-auto min-h-11 px-3 rounded-xl border border-gypi-border bg-gypi-surface text-gypi-text text-[14px] font-bold cursor-pointer">
          {grande ? "✕ Salir" : "⛶ Pantalla completa"}
        </button>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[15px] text-gypi-text mb-2" aria-label="Colores del Gantt">
        {ETAPAS_PLAN.map((e) => (
          <span key={e.id} className="flex items-center gap-1.5"><span aria-hidden="true" className={`inline-block w-4 h-4 rounded-sm ${MUESTRA[e.id]}`} />{e.nombre}</span>
        ))}
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-4 h-4 rounded-sm border-[3px] border-proc-margen" />Poco margen {pocoMargen.length}</span>
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-4 h-4 rounded-sm border-[3px] border-gypi-red" /><span className={atrasados.length ? "text-gypi-red font-bold" : ""}>⚠ Atrasados {atrasados.length}</span></span>
      </div>
      {/* Con scroll propio para que la fila de las fechas quede fija arriba al bajar */}
      <div ref={scrollRef} className={`overflow-auto rounded-xl border border-gypi-border ${grande ? "flex-1 min-h-0" : "max-h-[75vh]"}`}>
        <div className="min-w-max">
          <div className="flex border-b border-gypi-border sticky top-0 z-20 bg-gypi-bg">
            <div className="sticky left-0 z-30 w-[260px] shrink-0 bg-gypi-bg px-2 flex items-end pb-1 text-[14px] font-bold text-gypi-dim">OT · horas planificadas</div>
            <svg width={ancho} height={CAB} aria-hidden="true" className="block">
              {vista === "dias" ? cabeceraDias : vista === "semanas" ? cabeceraSemanas : cabeceraMes}
            </svg>
          </div>
          {grupos.map(([division, filas]) => (
            <div key={division}>
              <div className="sticky left-0 w-[260px] px-2 pt-2 pb-1 text-[15px] font-bold text-gypi-text bg-gypi-bg">{division} · {filas.length}</div>
              {filas.map((r) => {
                const p = r.proyecto;
                const texto = `${fmtH(r.horas)} en total; ` + r.procesos.map((q) => `${q.nombre} ${fmtH(q.horas)}, del ${fechaCorta(q.desde)} al ${fechaCorta(q.hasta)}${q.atrasado ? `, atrasado ${q.diasAtraso} ${q.diasAtraso === 1 ? "día" : "días"}` : q.margen ? ", poco margen" : q.completo ? ", completo" : ""}`).join("; ");
                return (
                  <div key={p.id ?? p.ot} className="flex border-t-2 border-gypi-border" data-ot={p.ot}>
                    <button type="button" onClick={() => verDetalle(p)} aria-label={`OT ${p.ot}: ${texto}. Ver detalle`}
                      className="sticky left-0 z-10 w-[150px] shrink-0 bg-gypi-bg px-2 py-1 text-left border-0 border-r border-gypi-border cursor-pointer flex flex-col justify-center">
                      <div className={`font-mono text-[18px] font-bold leading-tight ${r.atrasados.length ? "text-gypi-red" : "text-gypi-text"}`}>
                        {r.atrasados.length ? "⚠ " : ""}{p.ot} <span className="text-[16px]">· {fmtH(r.horas)}</span>
                      </div>
                      <div className="text-[14px] text-gypi-dim truncate">{p.cliente || p.obra || p.proyecto || "—"}</div>
                    </button>
                    <div className="sticky left-[150px] z-10 w-[110px] shrink-0 bg-gypi-bg border-r border-gypi-border">
                      {ETAPAS_PLAN.map((e) => (
                        <div key={e.id} className="h-[34px] px-2 flex items-center gap-1.5 text-[14px] text-gypi-text">
                          <span aria-hidden="true" className={`inline-block w-3 h-3 rounded-sm shrink-0 ${MUESTRA[e.id]}`} />{e.nombre}
                        </div>
                      ))}
                    </div>
                    <div>
                      {ETAPAS_PLAN.map((e) => {
                        const q = r.procesos.find((z) => z.etapa === e.id);
                        const x0 = q ? x(q.desde) + q.ini * px : 0;
                        const x1 = q ? x(q.hasta) + q.fin * px : 0;
                        const estado = q ? estadoDe(q) : null;
                        return (
                          <svg key={e.id} width={ancho} height={FILA} aria-hidden="true" className="block">
                            {fondo}
                            {q && (
                              <>
                                <rect data-proceso={e.id} data-estado={estado} x={x0} y={BARRA.y} width={Math.max(3, x1 - x0)} height={BARRA.alto} rx={3}
                                  className={`${COLOR[e.id]} ${CONTORNO[estado] || ""}`} strokeWidth={CONTORNO[estado] ? 3 : 0} fillOpacity={q.completo ? 0.35 : 1} />
                                <text x={Math.max(x0, x1) + 6} y={23} className={`text-[15px] font-bold ${q.atrasado ? "fill-gypi-red" : "fill-gypi-text"}`}>
                                  {fmtH(q.horas)}{q.atrasado ? " ⚠" : ""}
                                </text>
                              </>
                            )}
                          </svg>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {atrasados.length > 0 && (
        <section aria-label="Procesos atrasados" className="mt-3 rounded-xl border border-gypi-red/40 bg-gypi-red/5 p-3 shrink-0">
          {/* Se puede minimizar para ver el Gantt entero (en el celular, en pantalla completa) */}
          <button type="button" onClick={() => setVerAtrasados((v) => !v)} aria-expanded={verAtrasados}
            className="w-full flex items-center gap-2 bg-transparent border-0 p-0 min-h-11 cursor-pointer text-left text-[15px] font-bold text-gypi-red">
            <span className="flex-1">⚠ Procesos atrasados ({atrasados.length})</span>
            <span className="text-[14px] text-gypi-dim">{verAtrasados ? "▾ Minimizar" : "▸ Ver detalle"}</span>
          </button>
          {verAtrasados && (
            <ul className={`list-none m-0 p-0 flex flex-col gap-1 overflow-auto ${grande ? "max-h-[30vh]" : ""}`}>
              {atrasados.map((q) => (
                <li key={`${q.ot}-${q.etapa}`}>
                  <button type="button" onClick={() => verDetalle(q.proyecto)}
                    className="w-full text-left bg-transparent border-0 p-0 min-h-11 cursor-pointer text-[15px] text-gypi-text">
                    <span className="font-mono font-bold">{q.ot}</span> · {q.nombre}: tenía que terminar el {fechaCorta(q.hasta)} ({q.diasAtraso} {q.diasAtraso === 1 ? "día" : "días"} de atraso) · {q.hecho}% hecho
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {!grande && <p className="text-[13px] text-gypi-mute mt-2 mb-0">Plan confirmado con las horas de la grilla de horarios del personal operativo (los días sin nadie puesto no se trabajan): en cada OT un proceso arranca cuando termina el anterior y por cada proceso pasa una OT a la vez. Tocá una OT para ver su detalle.</p>}
    </div>
  );
}
