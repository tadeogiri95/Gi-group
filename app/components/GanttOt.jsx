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
// Gerencia puede reordenar las OT en "Procesos por OT" arrastrándolas desde ⠿
// o con ▲▼ (Tadeo, 29/10): al soltar, el plan se vuelve a armar en el momento
// (vista previa, reordenarPlan.js) y con "✅ Confirmar nuevo orden" se guarda
// como el plan confirmado (Planificación toma ese orden, sin poner números); "↩ Deshacer"
// vuelve al plan confirmado. En "OT por proceso" se reordena cada proceso por
// separado (Tadeo, 29/10): por ejemplo, cortar primero una OT y cantear
// primero otra. Ese orden queda solo en el plan confirmado; si después se
// reordena por OT o se confirma desde Planificación, todos los procesos
// vuelven al orden de la OT.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chip } from "./ui";
import { useEscape } from "../hooks/useEscape";
import { nombreDivisionOt } from "../lib/avance";
import { escalaGantt, diasDesde, nombreProyecto, ventanaGantt, enVentana, escalaAncho, HORIZONTES_GANTT } from "../lib/gantt";
import { itemsVigentes, diasExtraVigentes, procesosPlan, etapasDelPlan, leerPlanesConfirmados, horasSemanaDeGrilla, personalGantt, planVigente } from "../lib/ganttPlan";
import { ETAPAS_PLAN, normalizarParametros, divisionPlan } from "../lib/planificacion";
import { MODO_POR_DEFECTO, normalizarModo } from "../lib/semanaObjetivo";
import { planReordenado, baseGuardada, mover } from "../lib/reordenarPlan";
import { modulosPorOt } from "../lib/cargaPlanta";
import { sbGetAll, apiFetch } from "../lib/supabase";
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
export default function GanttOt({ proyectos = [], etapas = [], divisiones = [], avanceHoras = null, modo = MODO_POR_DEFECTO, planes: planesProp, cfgValor: cfgProp, empleados: empleadosProp = SIN_EMPLEADOS, onVerDetalle, empresaId = null, puedeReordenar = false }) {
  const hoy = hoyArg();
  const [leido, setLeido] = useState(null);
  useEffect(() => {
    if (planesProp !== undefined) return;
    let vivo = true;
    leerPlanesConfirmados().then((d) => { if (vivo) setLeido(d); });
    return () => { vivo = false; };
  }, [planesProp]);
  // El plan que se acaba de confirmar desde acá reemplaza al leído
  const [confirmadoAca, setConfirmadoAca] = useState(null);
  const planesLeidos = planesProp !== undefined ? planesProp : leido?.planes;
  const cfgValor = planesProp !== undefined ? cfgProp : leido?.cfgValor;
  const empleados = planesProp !== undefined ? empleadosProp : leido?.empleados;

  // Reordenar (gerencia): la división de la planificación y su plan confirmado
  const params = useMemo(() => normalizarParametros(cfgValor), [cfgValor]);
  const division = divisionPlan(divisiones, params.division_id);
  const divId = division?.id || null;
  const planesConfirmados = useMemo(() => (planesLeidos && confirmadoAca
    ? [...planesLeidos.filter((p) => (p.division_id || null) !== (confirmadoAca.division_id || null)), confirmadoAca]
    : planesLeidos), [planesLeidos, confirmadoAca]);
  // Vista previa: { ots: OT en el orden nuevo, etapas: orden propio de cada proceso (o null = el de las OT) }
  const [cambio, setCambio] = useState(null);
  const [modulos, setModulos] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [confirmando, setConfirmando] = useState(false);
  useEffect(() => {
    if (!puedeReordenar) return;
    let vivo = true;
    sbGetAll(`piezas_ot?${empresaId ? `empresa_id=eq.${empresaId}&` : ""}modulo=not.is.null&select=ot,modulo`, { maxFilas: 50000 })
      .then((r) => { if (vivo) setModulos(modulosPorOt(r.data)); })
      .catch(() => { if (vivo) setModulos(new Map()); });
    return () => { vivo = false; };
  }, [puedeReordenar, empresaId]);
  const abiertasPorOt = useMemo(() => new Map(proyectos.filter((p) => p.estado !== "cerrado").map((p) => [String(p.ot), p])), [proyectos]);
  const previa = useMemo(() => {
    if (!cambio || !modulos) return null;
    return planReordenado({
      orden: cambio.ots.map((ot) => abiertasPorOt.get(ot)).filter(Boolean), ordenEtapa: cambio.etapas,
      params, empleados: empleados || [], divisiones, division, avance: avanceHoras?.avance || [], piezas: avanceHoras?.piezas || [],
      modulos, hoy, base: baseGuardada(empresaId, divId), modo: normalizarModo(modo) === "semana_domingo" ? "semana_domingo" : "semana_lunes",
    });
  }, [cambio, modulos, abiertasPorOt, params, empleados, divisiones, division, avanceHoras, hoy, empresaId, divId, modo]);
  const planes = useMemo(() => (previa && planesConfirmados
    ? [...planesConfirmados.filter((p) => (p.division_id || null) !== divId), { division_id: divId, confirmado_at: "9999", desde: previa.desde, items: previa.items, dias_extra: previa.dias_extra }]
    : planesConfirmados), [previa, planesConfirmados, divId]);
  // Las OT que se pueden mover: las del plan confirmado de la división
  const delPlan = useMemo(() => new Set((planVigente(planesConfirmados, divId)?.items || []).map((i) => String(i.ot))), [planesConfirmados, divId]);

  const { renglones, escala, grupos, atrasados, pocoMargen } = useMemo(() => {
    if (!planes) return { renglones: null };
    const abiertas = new Map(proyectos.filter((p) => p.estado !== "cerrado").map((p) => [String(p.ot), p]));
    const procesos = procesosPlan(itemsVigentes(planes), {
      etapasCodigo: etapasDelPlan(cfgValor, etapas, divisiones),
      avance: avanceHoras?.avance || [], piezas: avanceHoras?.piezas || [],
      terminadas: new Set(proyectos.filter((p) => p.terminado_planilla).map((p) => String(p.ot))), hoy,
      params, horasSemana: horasSemanaDeGrilla(empleados, divisiones, cfgValor),
      personal: personalGantt(empleados, divisiones, cfgValor), diasExtra: diasExtraVigentes(planes),
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
  }, [planes, cfgValor, params, empleados, proyectos, etapas, divisiones, avanceHoras, hoy, modo]);

  // Orden de las OT que se pueden mover, como se ven ahora
  const ordenVisto = useMemo(() => (renglones || []).filter((r) => delPlan.has(r.ot)).map((r) => r.ot), [renglones, delPlan]);
  // Orden en que pasan por cada proceso, como se ven ahora
  const ordenVistoEtapa = useMemo(() => Object.fromEntries(ETAPAS_PLAN.map(({ id }) => [id, (renglones || [])
    .filter((r) => delPlan.has(r.ot)).map((r) => ({ ot: r.ot, q: r.procesos.find((z) => z.etapa === id) })).filter((x) => x.q)
    .sort((a, b) => a.q.t0 - b.q.t0).map((x) => x.ot)])), [renglones, delPlan]);
  const reordenar = puedeReordenar && ordenVisto.length > 1;
  const ordenOts = cambio?.ots || ordenVisto;
  const ordenDe = (etapa) => (etapa ? (cambio?.etapas || ordenVistoEtapa)[etapa] || [] : ordenOts);
  // Mover por OT pone todos los procesos en ese orden; mover en un proceso cambia solo ese
  const moverA = (ot, destino, etapa = null) => {
    const base = ordenDe(etapa);
    const i = base.indexOf(ot);
    if (i < 0 || destino < 0 || destino >= base.length || destino === i) return;
    setAviso(null);
    setCambio(etapa
      ? { ots: ordenOts, etapas: { ...(cambio?.etapas || ordenVistoEtapa), [etapa]: mover(base, i, destino) } }
      : { ots: mover(base, i, destino), etapas: null });
  };
  const [arrastre, setArrastre] = useState(null); // { ot, sobre, etapa }
  const empezarArrastre = (e, ot, etapa = null) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setArrastre({ ot, sobre: ot, etapa });
  };
  const moverArrastre = (e) => {
    if (!arrastre || typeof document === "undefined" || !document.elementFromPoint) return;
    const fila = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-reordenable]");
    if ((fila?.getAttribute("data-etapa") || null) !== arrastre.etapa) return; // solo dentro del mismo proceso
    const ot = fila?.getAttribute("data-ot");
    if (ot && ot !== arrastre.sobre) setArrastre({ ...arrastre, sobre: ot });
  };
  const soltarArrastre = () => {
    if (!arrastre) return;
    const { ot, sobre, etapa } = arrastre;
    setArrastre(null);
    if (sobre !== ot) moverA(ot, ordenDe(etapa).indexOf(sobre), etapa);
  };
  const deshacer = () => { setCambio(null); setAviso(null); };
  // ▲ ⠿ ▼ de una OT (en un proceso, si viene `etapa`)
  const controles = (ot, etapa = null) => {
    const lista = ordenDe(etapa);
    const lugar = lista.indexOf(ot);
    const de = etapa ? ` en ${ETAPAS_PLAN.find((e) => e.id === etapa)?.nombre}` : "";
    const boton = "bg-transparent border-none text-gypi-dim cursor-pointer disabled:opacity-30";
    return (
      <>
        <button type="button" aria-label={`Subir OT ${ot}${de}`} disabled={lugar <= 0 || confirmando} onClick={() => moverA(ot, lugar - 1, etapa)}
          className={`${boton} ${etapa ? "min-w-[28px] h-full" : "w-full min-h-[30px]"}`}>▲</button>
        <button type="button" aria-label={`Arrastrar OT ${ot}${de}`} disabled={confirmando}
          onPointerDown={(e) => empezarArrastre(e, ot, etapa)} onPointerMove={moverArrastre} onPointerUp={soltarArrastre} onPointerCancel={() => setArrastre(null)}
          className={`touch-none select-none bg-transparent border-none text-xl text-gypi-dim cursor-grab ${etapa ? "min-w-[28px] h-full" : "w-full min-h-[36px]"}`}>⠿</button>
        <button type="button" aria-label={`Bajar OT ${ot}${de}`} disabled={lugar < 0 || lugar >= lista.length - 1 || confirmando} onClick={() => moverA(ot, lugar + 1, etapa)}
          className={`${boton} ${etapa ? "min-w-[28px] h-full" : "w-full min-h-[30px]"}`}>▼</button>
      </>
    );
  };
  const confirmarOrden = async () => {
    if (!previa || confirmando) return;
    setConfirmando(true);
    setAviso(null);
    try {
      const r = await apiFetch("/api/planificacion", { method: "POST", body: JSON.stringify(previa) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo confirmar el plan.");
      // Sin números de prioridad (Tadeo, 29/10): Planificación toma el orden del plan confirmado
      setConfirmadoAca({ ...(d.plan || {}), items: d.plan?.items || previa.items, dias_extra: d.plan?.dias_extra || previa.dias_extra });
      setCambio(null);
      setAviso("✅ Plan confirmado con el orden nuevo. La planta ya lo ve.");
    } catch (e) {
      setAviso(e.message);
    } finally {
      setConfirmando(false);
    }
  };

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
      {reordenar && (cambio ? (
        <div role="status" aria-label="Orden nuevo sin confirmar" className="mb-2 rounded-xl border-2 border-gypi-amber bg-gypi-amber/10 p-3 shrink-0">
          <div className="text-[15px] font-bold text-gypi-text mb-1">Vista previa del orden nuevo</div>
          <div className="text-[14px] text-gypi-dim mb-2">
            {!modulos ? "Calculando…" : previa ? "Así quedaría el plan, con el mismo cálculo de Planificación. La planta sigue viendo el plan confirmado hasta que confirmes." : "Con este orden no queda nada para planificar (no hay horas pendientes o nadie en la grilla de horarios)."}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={confirmarOrden} disabled={!previa || confirmando} className="g-btn g-btn-primary">{confirmando ? "Confirmando…" : "✅ Confirmar nuevo orden"}</button>
            <button type="button" onClick={deshacer} disabled={confirmando} className="g-btn g-btn-secondary">↩ Deshacer</button>
          </div>
        </div>
      ) : (
        <div className="text-[14px] text-gypi-dim mb-2">
          {forma === "procesos"
            ? "Para cambiar el orden, arrastrá una OT desde ⠿ o usá ▲▼ (todos los procesos quedan en ese orden): antes de confirmar ves cómo queda."
            : "Para cambiar el orden de un solo proceso, arrastrá una OT desde ⠿ o usá ▲▼ dentro de ese proceso: antes de confirmar ves cómo queda."}
        </div>
      ))}
      {aviso && <div role="status" className="text-[14px] font-bold text-gypi-text mb-2">{aviso}</div>}
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
                    const movible = reordenar && delPlan.has(r.ot);
                    const sobre = arrastre && arrastre.etapa === e.id && arrastre.sobre === r.ot && arrastre.ot !== r.ot;
                    return (
                      <div key={p.id ?? p.ot} className={`flex border-t ${sobre ? "border-t-2 border-gypi-amber" : "border-gypi-border"} ${arrastre?.etapa === e.id && arrastre.ot === r.ot ? "opacity-60" : ""}`}
                        data-ot={p.ot} {...(movible ? { "data-reordenable": "", "data-etapa": e.id } : {})}>
                        {movible && (
                          <div className="sticky left-0 z-20 w-[84px] h-[34px] shrink-0 bg-gypi-bg flex items-stretch border-r border-gypi-border">
                            {controles(r.ot, e.id)}
                          </div>
                        )}
                        <button type="button" onClick={() => verDetalle(p)}
                          aria-label={`OT ${p.ot}, ${e.nombre}: ${fmtH(q.horas)}, del ${fechaCorta(q.desde)} al ${fechaCorta(q.hasta)}${q.atrasado ? `, atrasado ${q.diasAtraso} ${q.diasAtraso === 1 ? "día" : "días"}` : q.margen ? ", poco margen" : q.completo ? ", completo" : ""}. Ver detalle`}
                          className={`sticky ${movible ? "left-[84px] w-[176px]" : "left-0 w-[260px]"} z-10 shrink-0 bg-gypi-bg px-2 text-left border-0 border-r border-gypi-border cursor-pointer h-[34px] flex flex-col justify-center`}>
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
                const movible = reordenar && delPlan.has(r.ot);
                const sobre = arrastre && !arrastre.etapa && arrastre.sobre === r.ot && arrastre.ot !== r.ot;
                return (
                  <div key={p.id ?? p.ot} className={`flex border-t-2 ${sobre ? "border-gypi-amber" : "border-gypi-border"} ${!arrastre?.etapa && arrastre?.ot === r.ot ? "opacity-60" : ""}`} data-ot={p.ot} {...(movible ? { "data-reordenable": "" } : {})}>
                    {movible && (
                      <div className="sticky left-0 z-20 w-[28px] shrink-0 bg-gypi-bg flex flex-col items-center justify-between border-r border-gypi-border">
                        {controles(r.ot)}
                      </div>
                    )}
                    <button type="button" onClick={() => verDetalle(p)} aria-label={`OT ${p.ot}: ${texto}. Ver detalle`}
                      className={`sticky ${movible ? "left-[28px] w-[122px]" : "left-0 w-[150px]"} z-10 shrink-0 bg-gypi-bg px-2 py-1 text-left border-0 border-r border-gypi-border cursor-pointer flex flex-col justify-center`}>
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
