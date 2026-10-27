'use client';
// app/components/GanttOt.jsx — 📅 Gantt de OT (Proyectos → OT). Muestra el
// plan de producción confirmado en Proyectos → Planificación (migración 138):
// un renglón por OT planificada y, adentro, una línea por proceso (Corte,
// Canteado, Mecanizado, Armado), cada uno con su color, desde el primer hasta
// el último día que el plan le asigna. Un proceso cuya fecha límite ya pasó y
// no está completo (por el escaneo de piezas, o la etapa terminada) se pinta
// de rojo con ⚠ y va en la lista de atrasados debajo del Gantt; uno en fecha
// pero con poco margen (va justo, o el proceso anterior viene atrasado: van
// uno detrás del otro) se pinta de amarillo con 🟡; uno completo queda más
// claro. Cada proceso tiene su color fijo: Corte azul, Canteado naranja,
// Mecanizado violeta y Armado marrón claro. El dibujo es SVG: así cada barra se ubica sin estilos sueltos.
// Se ve por días (con la semana arriba) o por semanas; la fila de las fechas
// queda fija arriba al bajar, y "Pantalla completa" lo abre en toda la
// pantalla para girar el celular.
import { useEffect, useMemo, useRef, useState } from "react";
import { Chip } from "./ui";
import { useEscape } from "../hooks/useEscape";
import { nombreDivisionOt } from "../lib/avance";
import { escalaGantt, diasDesde } from "../lib/gantt";
import { itemsVigentes, procesosPlan, etapasDelPlan, leerPlanesConfirmados } from "../lib/ganttPlan";
import { ETAPAS_PLAN } from "../lib/planificacion";
import { MODO_POR_DEFECTO } from "../lib/semanaObjetivo";
import { hoyArg } from "../lib/dates";
import { fechaCorta } from "../lib/ot";

const PX_DIA = { dias: 22, semanas: 40 / 7 }; // ancho de un día según cómo se ve
const ALTO = 44;
const CARRIL = 9; // alto de la línea de cada proceso dentro del renglón
const COLOR = { corte: "fill-proc-corte", canteado: "fill-proc-canteado", mecanizado: "fill-proc-mecanizado", armado: "fill-proc-armado" };
const MUESTRA = { corte: "bg-proc-corte", canteado: "bg-proc-canteado", mecanizado: "bg-proc-mecanizado", armado: "bg-proc-armado" };

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

/**
 * @param {object} props
 * @param {object[]} [props.planes]  planes confirmados con sus días; si no viene, se leen
 * @param {object} [props.cfgValor]  parámetros de la planificación (qué etapa es cada proceso)
 */
export default function GanttOt({ proyectos = [], etapas = [], divisiones = [], avanceHoras = null, modo = MODO_POR_DEFECTO, planes: planesProp, cfgValor: cfgProp, onVerDetalle }) {
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

  const { renglones, escala, grupos, atrasados, pocoMargen } = useMemo(() => {
    if (!planes) return { renglones: null };
    const abiertas = new Map(proyectos.filter((p) => p.estado !== "cerrado").map((p) => [String(p.ot), p]));
    const procesos = procesosPlan(itemsVigentes(planes), {
      etapasCodigo: etapasDelPlan(cfgValor, etapas, divisiones),
      avance: avanceHoras?.avance || [], piezas: avanceHoras?.piezas || [],
      terminadas: new Set(proyectos.filter((p) => p.terminado_planilla).map((p) => String(p.ot))), hoy,
    });
    const renglones = [...procesos.values()].filter((r) => abiertas.has(r.ot))
      .map((r) => ({ ...r, proyecto: abiertas.get(r.ot) }))
      .sort((a, b) => a.inicio.localeCompare(b.inicio) || a.ot.localeCompare(b.ot, "es", { numeric: true }));
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
      pocoMargen: renglones.flatMap((r) => r.pocoMargen.map((p) => ({ ...p, ot: r.ot, proyecto: r.proyecto })))
        .sort((a, b) => a.hasta.localeCompare(b.hasta) || a.ot.localeCompare(b.ot, "es", { numeric: true })),
    };
  }, [planes, cfgValor, proyectos, etapas, divisiones, avanceHoras, hoy, modo]);

  const [vista, setVista] = useState("dias");
  const [grande, setGrande] = useState(false);
  const cerrarGrande = () => { setGrande(false); salirPantallaCompleta(); };
  useEscape(cerrarGrande, grande);
  useEffect(() => () => { salirPantallaCompleta(); }, []);

  const px = PX_DIA[vista];
  const COL = 7 * px; // ancho de una semana
  const semanas = escala?.semanas || [];
  const ancho = semanas.length * COL + 64; // lugar para el ⚠ de la última barra
  const x = (fecha) => Math.max(0, diasDesde(escala?.desde || hoy, fecha) * px);
  const xHoy = x(hoy);
  // Se abre mostrando la semana actual (con dos semanas antes), no la más vieja
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, xHoy - 2 * COL);
  }, [xHoy, COL, grande]);
  const separadores = semanas.map((s, i) => <rect key={s.inicio} x={i * COL} y={0} width={1} height={ALTO} className="fill-gypi-border" />);

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

  const cabeceraSemanas = semanas.map((s, i) => (
    <g key={s.inicio}>
      {s.actual && <rect x={i * COL} y={0} width={COL} height={36} className="fill-gypi-amber" fillOpacity={0.15} />}
      <text x={i * COL + COL / 2} y={15} textAnchor="middle" className={`text-[12px] font-bold ${s.actual ? "fill-gypi-text" : "fill-gypi-dim"}`}>{s.numero != null ? `S${s.numero}` : diaMes(s.inicio)}</text>
      {s.numero != null && <text x={i * COL + COL / 2} y={31} textAnchor="middle" className="text-[12px] fill-gypi-mute">{diaMes(s.inicio)}</text>}
    </g>
  ));
  // Por días: arriba la semana, abajo el número de cada día (sábado y domingo más claros)
  const cabeceraDias = semanas.map((s, i) => (
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
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-gypi-dim mb-2" aria-label="Colores del Gantt">
        {ETAPAS_PLAN.map((e) => (
          <span key={e.id} className="flex items-center gap-1"><span aria-hidden="true" className={`inline-block w-3 h-3 rounded-sm ${MUESTRA[e.id]}`} />{e.nombre}</span>
        ))}
        <span className="flex items-center gap-1"><span aria-hidden="true" className="inline-block w-3 h-3 rounded-sm bg-proc-margen" />🟡 Poco margen {pocoMargen.length}</span>
        <span className="flex items-center gap-1"><span aria-hidden="true" className="inline-block w-3 h-3 rounded-sm bg-gypi-red" /><span className={atrasados.length ? "text-gypi-red font-bold" : ""}>⚠ Atrasados {atrasados.length}</span></span>
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
                const p = r.proyecto;
                const finX = x(r.fin) + px;
                const texto = r.procesos.map((q) => `${q.nombre} del ${fechaCorta(q.desde)} al ${fechaCorta(q.hasta)}${q.atrasado ? `, atrasado ${q.diasAtraso} ${q.diasAtraso === 1 ? "día" : "días"}` : q.margen ? ", poco margen" : q.completo ? ", completo" : ""}`).join("; ");
                return (
                  <div key={p.id ?? p.ot} className="flex border-t border-gypi-border">
                    <button type="button" onClick={() => { if (grande) cerrarGrande(); onVerDetalle?.(p); }}
                      aria-label={`OT ${p.ot}: ${texto}. Ver detalle`}
                      className="sticky left-0 z-10 w-[136px] shrink-0 bg-gypi-bg px-2 py-1 text-left border-0 border-r border-gypi-border cursor-pointer min-h-11">
                      <div className={`font-mono text-[13px] font-bold truncate ${r.atrasados.length ? "text-gypi-red" : "text-gypi-text"}`}>{r.atrasados.length ? "⚠ " : r.pocoMargen.length ? "🟡 " : ""}{p.ot}</div>
                      <div className="text-[12px] text-gypi-dim truncate">{p.cliente || p.obra || p.proyecto || "—"}</div>
                    </button>
                    <svg width={ancho} height={ALTO} aria-hidden="true" className="block">
                      {separadores}
                      <rect x={xHoy} y={0} width={2} height={ALTO} className="fill-gypi-amber" fillOpacity={0.6} />
                      {ETAPAS_PLAN.map((e, i) => {
                        const q = r.procesos.find((z) => z.etapa === e.id);
                        if (!q) return null;
                        const desde = x(q.desde);
                        return (
                          <rect key={e.id} data-proceso={e.id} data-estado={q.atrasado ? "atrasado" : q.margen ? "margen" : q.completo ? "completo" : "pendiente"}
                            x={desde} y={4 + i * CARRIL} width={Math.max(4, x(q.hasta) + px - desde)} height={CARRIL - 2} rx={2}
                            className={q.atrasado ? "fill-gypi-red" : q.margen ? "fill-proc-margen" : COLOR[e.id]} fillOpacity={q.completo ? 0.35 : 1} />
                        );
                      })}
                      {r.atrasados.length > 0 ? <text x={finX + 4} y={27} className="text-[12px] font-bold fill-gypi-red">⚠</text>
                        : r.pocoMargen.length > 0 && <text x={finX + 4} y={27} className="text-[12px]">🟡</text>}
                    </svg>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {atrasados.length > 0 && (
        <section aria-label="Procesos atrasados" className="mt-3 rounded-xl border border-gypi-red/40 bg-gypi-red/5 p-3">
          <div className="text-[13px] font-bold text-gypi-red mb-1">⚠ Procesos atrasados ({atrasados.length})</div>
          <ul className="list-none m-0 p-0 flex flex-col gap-1">
            {atrasados.map((q) => (
              <li key={`${q.ot}-${q.etapa}`}>
                <button type="button" onClick={() => { if (grande) cerrarGrande(); onVerDetalle?.(q.proyecto); }}
                  className="w-full text-left bg-transparent border-0 p-0 min-h-11 cursor-pointer text-[13px] text-gypi-text">
                  <span className="font-mono font-bold">{q.ot}</span> · {q.nombre}: tenía que terminar el {fechaCorta(q.hasta)} ({q.diasAtraso} {q.diasAtraso === 1 ? "día" : "días"} de atraso) · {q.hecho}% hecho
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {pocoMargen.length > 0 && (
        <section aria-label="Procesos con poco margen" className="mt-3 rounded-xl border border-proc-margen/60 bg-proc-margen/10 p-3">
          <div className="text-[13px] font-bold text-gypi-text mb-1">🟡 Poco margen ({pocoMargen.length})</div>
          <ul className="list-none m-0 p-0 flex flex-col gap-1">
            {pocoMargen.map((q) => (
              <li key={`${q.ot}-${q.etapa}`}>
                <button type="button" onClick={() => { if (grande) cerrarGrande(); onVerDetalle?.(q.proyecto); }}
                  className="w-full text-left bg-transparent border-0 p-0 min-h-11 cursor-pointer text-[13px] text-gypi-text">
                  <span className="font-mono font-bold">{q.ot}</span> · {q.nombre} (hasta el {fechaCorta(q.hasta)}): {q.motivoMargen}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-[12px] text-gypi-mute mt-2 mb-0">Cada línea es un proceso del plan confirmado, del primer al último día que le toca: Corte azul, Canteado naranja, Mecanizado violeta y Armado marrón claro. Más clara = completa (todas las piezas escaneadas o la etapa terminada); amarilla = en fecha pero con poco margen (va justo o el proceso anterior viene atrasado); roja = pasó su último día y no está completa. Tocá una OT para ver su detalle.</p>
    </div>
  );
}
