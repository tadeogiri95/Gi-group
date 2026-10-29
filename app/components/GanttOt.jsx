'use client';
// app/components/GanttOt.jsx — 📅 Gantt de OT (Proyectos → OT). Muestra el
// plan de producción confirmado en Proyectos → Planificación (migración 138),
// pensado para verse en un televisor. Cada OT tiene 4 renglones, uno por
// proceso (Corte, Canteado, Mecanizado, Armado), cada uno con su color fijo:
// azul, naranja, violeta y marrón claro. En la OT un proceso arranca cuando
// termina el anterior, y por cada proceso pasa una sola OT a la vez, con las
// horas de la grilla de horarios del personal operativo (procesosPlan). Al
// lado de cada barra van sus horas y al lado de la OT las horas totales (la
// suma de sus procesos); en Armado, cuántos armadores trabajan en la OT.
// Un proceso con poco margen lleva un contorno amarillo y uno atrasado (pasó
// su último día y no está completo por el escaneo de piezas) contorno rojo y
// ⚠; el color del proceso se sigue viendo. Uno completo queda más claro.
// La escala se estira para que lo elegido ocupe todo el ancho; la fila de las fechas queda fija arriba al
// bajar y "Pantalla completa" lo abre en toda la pantalla.
// Dos formas de verlo (Tadeo, 27/10): "Procesos por OT" (4 renglones por OT)
// u "OT por proceso": un bloque por proceso con un renglón por OT, en el
// orden en que pasan por esa máquina (una barra termina y abajo empieza la
// siguiente). La elección queda guardada en el navegador.
// Se puede elegir ver 1, 2 o 3 días, 1 o 2 semanas o 1 mes desde hoy, o todo
// el plan (Tadeo, 29/10): solo se muestran las OT y los procesos que caen ahí,
// y lo elegido ocupa todo el ancho de la pantalla (los rótulos de arriba pasan
// solos de días a semanas o meses según lo que entre). Filas bajas para que
// entren más OT.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chip } from "./ui";
import { useEscape } from "../hooks/useEscape";
import { nombreDivisionOt } from "../lib/avance";
import { escalaGantt, diasDesde, nombreProyecto, ventanaGantt, enVentana, escalaAncho, HORIZONTES_GANTT } from "../lib/gantt";
import { itemsVigentes, procesosPlan, etapasDelPlan, leerPlanesConfirmados, horasSemanaDeGrilla, personalGantt } from "../lib/ganttPlan";
import { ETAPAS_PLAN, normalizarParametros } from "../lib/planificacion";
import { MODO_POR_DEFECTO } from "../lib/semanaObjetivo";
import { hoyArg } from "../lib/dates";
import { fechaCorta } from "../lib/ot";
import { fmtH } from "../lib/cargaPlanta";

const FILA = 26; // alto del renglón de cada proceso
const FILA_OT = 34; // alto del renglón de cada OT en "OT por proceso"
const CLAVE_FORMA = "gypi_gantt_forma";
const ETIQUETAS = 260; // ancho de las columnas fijas de la izquierda
const MARGEN_FIN = 56; // lugar para las horas de la última barra
const CLAVE_HORIZONTE = "gypi_gantt_horizonte";
const BARRA = { y: 4, alto: 18 };
const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
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
      personal: personalGantt(empleados, divisiones, cfgValor),
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

  // Ancho visible del Gantt, para estirar las semanas elegidas a toda la pantalla
  const [anchoVisible, setAnchoVisible] = useState(0);
  const scrollRef = useRef(null);
  const observador = useRef(null);
  const medir = useCallback((el) => {
    scrollRef.current = el;
    observador.current?.disconnect();
    observador.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    observador.current = new ResizeObserver(() => setAnchoVisible(el.clientWidth));
    observador.current.observe(el);
  }, []);
  // "procesos" = procesos por OT; "ots" = OT por proceso
  const [forma, setForma] = useState(() => { try { return localStorage.getItem(CLAVE_FORMA) === "ots" ? "ots" : "procesos"; } catch { return "procesos"; } });
  const cambiarForma = (f) => { setForma(f); try { localStorage.setItem(CLAVE_FORMA, f); } catch { /* sin almacenamiento */ } };
  const [horizonte, setHorizonte] = useState(() => { try { const h = localStorage.getItem(CLAVE_HORIZONTE); return HORIZONTES_GANTT.some((x) => x.id === h) ? h : "todo"; } catch { return "todo"; } });
  const cambiarHorizonte = (h) => { setHorizonte(h); try { localStorage.setItem(CLAVE_HORIZONTE, h); } catch { /* sin almacenamiento */ } };
  const recortado = horizonte !== "todo";
  const [grande, setGrande] = useState(false);
  const [verAtrasados, setVerAtrasados] = useState(true);
  const cerrarGrande = () => { setGrande(false); salirPantallaCompleta(); };
  useEscape(cerrarGrande, grande);
  useEffect(() => () => { salirPantallaCompleta(); }, []);

  const ventana = ventanaGantt(escala, horizonte, hoy);
  const semanas = ventana.semanas;
  const totalDias = ventana.dias;
  const { px, vista } = escalaAncho(anchoVisible - ETIQUETAS - MARGEN_FIN - 2, totalDias);
  const ancho = totalDias * px + MARGEN_FIN;
  const desde = ventana.desde || hoy;
  const finVentana = recortado ? totalDias * px : Infinity; // con horizonte, las barras se cortan al final
  const x = (fecha) => Math.min(finVentana, Math.max(0, diasDesde(desde, fecha) * px));
  const xHoy = x(hoy);
  const xSem = (s) => x(s.desde);
  const anchoSem = (s) => diasDesde(s.desde, s.hasta) * px;
  // Se abre mostrando la semana actual (con una semana antes), no la más vieja
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, xHoy - 7 * px);
  }, [xHoy, px, grande]);

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

  // Fondo de cada renglón: fines de semana más oscuros (por días), separadores de semana y la línea de hoy
  const fondoDe = (alto) => (
    <g>
      {vista === "dias" && Array.from({ length: totalDias }, (_, d) => sumarDias(desde, d)).filter((f) => [0, 6].includes(diaSemana(f)))
        .map((f) => <rect key={f} x={x(f)} y={0} width={px} height={alto} className="fill-gypi-surf-hi" />)}
      {vista !== "mes" && semanas.map((s) => <rect key={s.inicio} x={xSem(s)} y={0} width={1} height={alto} className="fill-gypi-border" />)}
      {vista === "mes" && Array.from({ length: totalDias }, (_, d) => sumarDias(desde, d)).filter((f) => f.endsWith("-01"))
        .map((f) => <rect key={f} x={x(f)} y={0} width={1} height={alto} className="fill-gypi-border" />)}
      <rect x={xHoy} y={0} width={2} height={alto} className="fill-gypi-amber" fillOpacity={0.7} />
    </g>
  );
  const fondo = fondoDe(FILA);
  const fondoOt = fondoDe(FILA_OT);
  // Barra de un proceso con sus horas al lado (la misma en las dos formas)
  const barra = (q, etapa, dy = 0) => {
    const x0 = q.desde < desde ? 0 : Math.min(finVentana, x(q.desde) + q.ini * px);
    const x1 = Math.min(finVentana, x(q.hasta) + q.fin * px);
    const estado = estadoDe(q);
    return (
      <>
        <rect data-proceso={etapa} data-estado={estado} x={x0} y={BARRA.y + dy} width={Math.max(3, x1 - x0)} height={BARRA.alto} rx={3}
          className={`${COLOR[etapa]} ${CONTORNO[estado] || ""}`} strokeWidth={CONTORNO[estado] ? 3 : 0} fillOpacity={q.completo ? 0.35 : 1} />
        <text x={Math.max(x0, x1) + 6} y={18 + dy} className={`text-[13px] font-bold ${q.atrasado ? "fill-gypi-red" : "fill-gypi-text"}`}>
          {fmtH(q.horas)}{q.personas ? ` · 👷 ${q.personas}` : ""}{q.atrasado ? " ⚠" : ""}
        </text>
      </>
    );
  };
  // OT por proceso: en cada proceso, las OT en el orden en que pasan por la máquina
  const porProceso = (filas) => ETAPAS_PLAN.map((e) => ({
    etapa: e,
    filas: filas.map((r) => ({ r, q: r.procesos.find((z) => z.etapa === e.id) })).filter((f) => f.q && (!recortado || enVentana(f.q, ventana)))
      .sort((a, b) => a.q.desde.localeCompare(b.q.desde) || a.q.ini - b.q.ini),
  })).filter((g) => g.filas.length);

  const cabeceraSemanas = semanas.map((s) => (
    <g key={s.inicio}>
      {s.actual && <rect x={xSem(s)} y={0} width={anchoSem(s)} height={CAB} className="fill-gypi-amber" fillOpacity={0.15} />}
      <rect x={xSem(s)} y={0} width={1} height={CAB} className="fill-gypi-border" />
      <text x={xSem(s) + anchoSem(s) / 2} y={19} textAnchor="middle" className={`text-[14px] font-bold ${s.actual ? "fill-gypi-text" : "fill-gypi-dim"}`}>{s.numero != null ? `S${s.numero}` : diaMes(s.inicio)}</text>
      {s.numero != null && <text x={xSem(s) + anchoSem(s) / 2} y={37} textAnchor="middle" className="text-[13px] fill-gypi-mute">{diaMes(s.inicio)}</text>}
    </g>
  ));
  // Por días: arriba la semana, abajo cada día (sábado y domingo más claros;
  // con lugar, el nombre del día y la fecha)
  const conNombre = px >= 80;
  const cabeceraDias = semanas.map((s) => (
    <g key={s.inicio}>
      {s.actual && <rect x={xSem(s)} y={0} width={anchoSem(s)} height={20} className="fill-gypi-amber" fillOpacity={0.15} />}
      <rect x={xSem(s)} y={0} width={1} height={CAB} className="fill-gypi-border" />
      <text x={xSem(s) + 6} y={16} className={`text-[14px] font-bold ${s.actual ? "fill-gypi-text" : "fill-gypi-dim"}`}>
        {s.numero != null ? `S${s.numero} · ${diaMes(s.inicio)}` : diaMes(s.inicio)}
      </text>
      {Array.from({ length: diasDesde(s.desde, s.hasta) }, (_, d) => {
        const dia = sumarDias(s.desde, d);
        const finde = [0, 6].includes(diaSemana(dia));
        return (
          <g key={dia}>
            {dia === hoy && <rect x={x(dia)} y={21} width={px} height={CAB - 21} className="fill-gypi-amber" fillOpacity={0.35} />}
            {conNombre && d > 0 && <rect x={x(dia)} y={21} width={1} height={CAB - 21} className="fill-gypi-border" />}
            <text x={x(dia) + px / 2} y={39} textAnchor="middle" className={`text-[14px] ${finde ? "fill-gypi-mute" : "fill-gypi-text font-bold"}`}>
              {conNombre ? `${DIAS[diaSemana(dia)]} ${diaMes(dia)}` : Number(dia.slice(8))}
            </text>
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
      {semanas.map((s) => s.numero != null && <text key={s.inicio} x={xSem(s) + anchoSem(s) / 2} y={38} textAnchor="middle" className="text-[13px] fill-gypi-mute">S{s.numero}</text>)}
    </g>
  );

  const verDetalle = (p) => { if (grande) cerrarGrande(); onVerDetalle?.(p); };
  // Con un horizonte elegido, solo las OT con algún proceso en esas semanas
  const gruposVistos = grupos
    .map(([division, filas]) => [division, recortado ? filas.filter((r) => r.procesos.some((q) => enVentana(q, ventana))) : filas])
    .filter(([, filas]) => filas.length);

  return (
    <div className={grande ? "fixed inset-0 z-[300] bg-gypi-bg p-3 flex flex-col" : ""} role={grande ? "dialog" : undefined} aria-label={grande ? "Gantt de OT en pantalla completa" : undefined}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="flex gap-1.5" role="group" aria-label="Forma del Gantt">
          <Chip active={forma === "procesos"} onClick={() => cambiarForma("procesos")}>Procesos por OT</Chip>
          <Chip active={forma === "ots"} onClick={() => cambiarForma("ots")}>OT por proceso</Chip>
        </div>
        <div className="flex flex-wrap gap-1.5 items-center" role="group" aria-label="Qué se ve">
          <span className="text-[14px] text-gypi-dim">Ver:</span>
          {HORIZONTES_GANTT.map((h) => (
            <Chip key={h.id} active={horizonte === h.id} onClick={() => cambiarHorizonte(h.id)}>{h.label}</Chip>
          ))}
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
      <div ref={medir} className={`overflow-auto rounded-xl border border-gypi-border ${grande ? "flex-1 min-h-0" : "max-h-[75vh]"}`}>
        <div className="min-w-max">
          <div className="flex border-b border-gypi-border sticky top-0 z-20 bg-gypi-bg">
            <div className="sticky left-0 z-30 w-[260px] shrink-0 bg-gypi-bg px-2 flex items-end pb-1 text-[14px] font-bold text-gypi-dim">OT · horas planificadas</div>
            <svg width={ancho} height={CAB} aria-hidden="true" className="block">
              {vista === "dias" ? cabeceraDias : vista === "semanas" ? cabeceraSemanas : cabeceraMes}
            </svg>
          </div>
          {!gruposVistos.length && <div className="px-3 py-6 text-[15px] text-gypi-dim">No hay procesos planificados {horizonte === "1d" ? "para hoy" : `en lo elegido (${HORIZONTES_GANTT.find((h) => h.id === horizonte)?.label} desde hoy)`}.</div>}
          {gruposVistos.map(([division, filas]) => (
            <div key={division}>
              <div className="sticky left-0 w-[260px] px-2 pt-2 pb-1 text-[15px] font-bold text-gypi-text bg-gypi-bg">{division} · {filas.length}</div>
              {forma === "ots" && porProceso(filas).map(({ etapa: e, filas: enProceso }) => (
                <section key={e.id} aria-label={`${e.nombre}: ${enProceso.length} OT`} data-bloque={e.id}>
                  <div className="sticky left-0 w-[260px] px-2 pt-2 pb-1 flex items-center gap-1.5 text-[15px] font-bold text-gypi-text bg-gypi-bg">
                    <span aria-hidden="true" className={`inline-block w-4 h-4 rounded-sm shrink-0 ${MUESTRA[e.id]}`} />{e.nombre} · {enProceso.length} OT
                  </div>
                  {enProceso.map(({ r, q }) => {
                    const p = r.proyecto;
                    return (
                      <div key={p.id ?? p.ot} className="flex border-t border-gypi-border" data-ot={p.ot}>
                        <button type="button" onClick={() => verDetalle(p)}
                          aria-label={`OT ${p.ot}, ${e.nombre}: ${fmtH(q.horas)}, del ${fechaCorta(q.desde)} al ${fechaCorta(q.hasta)}${q.atrasado ? `, atrasado ${q.diasAtraso} ${q.diasAtraso === 1 ? "día" : "días"}` : q.margen ? ", poco margen" : q.completo ? ", completo" : ""}. Ver detalle`}
                          className="sticky left-0 z-10 w-[260px] shrink-0 bg-gypi-bg px-2 text-left border-0 border-r border-gypi-border cursor-pointer h-[34px] flex flex-col justify-center">
                          <div className={`text-[14px] font-bold leading-tight truncate ${q.atrasado ? "text-gypi-red" : "text-gypi-text"}`}>
                            <span className="font-mono">{q.atrasado ? "⚠ " : ""}{p.ot}</span> · <span className="font-normal" data-cliente>{p.cliente || "—"}</span>
                          </div>
                          <div className="text-[12px] text-gypi-dim leading-tight truncate">
                            {[p.obra, nombreProyecto(p)].filter(Boolean).join(" · ")}
                          </div>
                        </button>
                        <svg width={ancho} height={FILA_OT} aria-hidden="true" className="block">
                          {fondoOt}
                          {barra(q, e.id, (FILA_OT - FILA) / 2)}
                        </svg>
                      </div>
                    );
                  })}
                </section>
              ))}
              {forma === "procesos" && filas.map((r) => {
                const p = r.proyecto;
                const texto = `${fmtH(r.horas)} en total; ` + r.procesos.map((q) => `${q.nombre} ${fmtH(q.horas)}${q.personas ? ` con ${q.personas} ${q.personas === 1 ? "armador" : "armadores"}` : ""}, del ${fechaCorta(q.desde)} al ${fechaCorta(q.hasta)}${q.atrasado ? `, atrasado ${q.diasAtraso} ${q.diasAtraso === 1 ? "día" : "días"}` : q.margen ? ", poco margen" : q.completo ? ", completo" : ""}`).join("; ");
                return (
                  <div key={p.id ?? p.ot} className="flex border-t-2 border-gypi-border" data-ot={p.ot}>
                    <button type="button" onClick={() => verDetalle(p)} aria-label={`OT ${p.ot}: ${texto}. Ver detalle`}
                      className="sticky left-0 z-10 w-[150px] shrink-0 bg-gypi-bg px-2 py-1 text-left border-0 border-r border-gypi-border cursor-pointer flex flex-col justify-center">
                      <div className={`font-mono text-[16px] font-bold leading-tight ${r.atrasados.length ? "text-gypi-red" : "text-gypi-text"}`}>
                        {r.atrasados.length ? "⚠ " : ""}{p.ot} <span className="text-[14px]">· {fmtH(r.horas)}</span>
                      </div>
                      {/* Columnas A, D, E y F del Plan de trabajo: OT, cliente, obra y descripción (Tadeo, 27/10) */}
                      <div className="text-[13px] leading-tight text-gypi-dim truncate" data-cliente>{p.cliente || "—"}</div>
                      {p.obra && <div className="text-[13px] leading-tight text-gypi-dim truncate" data-obra>{p.obra}</div>}
                      {nombreProyecto(p) && <div className="text-[13px] text-gypi-text font-bold leading-tight line-clamp-2" data-proyecto title={nombreProyecto(p)}>{nombreProyecto(p)}</div>}
                    </button>
                    <div className="sticky left-[150px] z-10 w-[110px] shrink-0 bg-gypi-bg border-r border-gypi-border">
                      {ETAPAS_PLAN.map((e) => (
                        <div key={e.id} className="h-[26px] px-2 flex items-center gap-1.5 text-[13px] text-gypi-text">
                          <span aria-hidden="true" className={`inline-block w-3 h-3 rounded-sm shrink-0 ${MUESTRA[e.id]}`} />{e.nombre}
                        </div>
                      ))}
                    </div>
                    <div>
                      {ETAPAS_PLAN.map((e) => {
                        const q = r.procesos.find((z) => z.etapa === e.id);
                        return (
                          <svg key={e.id} width={ancho} height={FILA} aria-hidden="true" className="block">
                            {fondo}
                            {q && barra(q, e.id)}
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
      {!grande && <p className="text-[13px] text-gypi-mute mt-2 mb-0">Plan confirmado con las horas de la grilla de horarios del personal operativo (los días sin nadie puesto no se trabajan): en cada OT un proceso arranca cuando termina el anterior, por cada máquina pasa una OT a la vez y en Armado trabajan hasta el máximo de armadores por OT (los que sobran arman otra en paralelo). Tocá una OT para ver su detalle.</p>}
    </div>
  );
}
