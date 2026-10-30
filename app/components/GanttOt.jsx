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
// Plan vivo (Tadeo, 29/10, planVivo): el plan confirmado fija el orden y las
// fechas se arman de nuevo cada vez desde hoy, con lo que falta de cada
// proceso y los parámetros de ahora; lo no terminado pasa al día siguiente y
// todo se corre. Cada barra va desde que el proceso arrancó (más clara hasta
// hoy) hasta que termina. Dos alertas: contorno rojo y ⚠ si termina después
// de su semana; contorno amarillo cortado y ↪ si se corrió del plan
// confirmado. Uno completo queda más claro.
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
// Retrabajo (Tadeo, 30/10; migración 147): las horas de retrabajo sin
// terminar se suman al final del proceso y esa parte de la barra va en rojo;
// se cargan y se marcan terminadas tocando la barra (también en un proceso
// completo).
// "🔄 Refrescar" (Tadeo, 30/10) vuelve a leer las OT, el avance, el plan y los
// ajustes sin salir de la pantalla completa.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chip } from "./ui";
import { useEscape } from "../hooks/useEscape";
import { nombreDivisionOt } from "../lib/avance";
import { escalaGantt, diasDesde, nombreProyecto, ventanaGantt, enVentana, escalaAncho, HORIZONTES_GANTT } from "../lib/gantt";
import { itemsVigentes, diasExtraVigentes, planVivo, etapasDelPlan, leerPlanesConfirmados, horasSemanaDeGrilla, personalGantt, planVigente, ultimaConfirmacion } from "../lib/ganttPlan";
import { ETAPAS_PLAN, normalizarParametros, divisionPlan } from "../lib/planificacion";
import { MODO_POR_DEFECTO, normalizarModo } from "../lib/semanaObjetivo";
import { planReordenado, baseGuardada, mover } from "../lib/reordenarPlan";
import { modulosPorOt } from "../lib/cargaPlanta";
import { sbGetAll, apiFetch } from "../lib/supabase";
import { hoyArg } from "../lib/dates";
import { fechaCorta } from "../lib/ot";
import { fmtH } from "../lib/cargaPlanta";
import { faltanManual, atrasosSinMotivo } from "../lib/ajustesTiempo";
import { retrabajoPendiente, pendientesDe } from "../lib/retrabajo";
import AjusteTiempo from "./AjusteTiempo";

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
const estadoDe = (q) => (q.tarde ? "tarde" : q.corrido ? "corrido" : q.completo ? "completo" : "pendiente");
const CONTORNO = { tarde: "stroke-gypi-red", corrido: "stroke-proc-margen" };
const SIN_MODULOS = new Map();
const dias = (n) => `${n} ${n === 1 ? "día" : "días"}`;
/** Las alertas de un proceso, para leer en voz alta. */
const alertasTexto = (q) => [q.tarde ? `termina ${dias(q.diasTarde)} después de su semana` : "", q.corrido ? `se corrió ${dias(q.diasCorrido)} del plan confirmado` : "", q.completo ? "completo" : ""].filter(Boolean).join(", ");

/**
 * @param {object} props
 * @param {object[]} [props.planes]  planes confirmados con sus días; si no viene, se leen
 * @param {object} [props.cfgValor]  parámetros de la planificación (qué etapa es cada proceso)
 * @param {object[]} [props.empleados]  personal operativo con su grilla de horarios (junto con planes)
 */
export default function GanttOt({ proyectos = [], etapas = [], divisiones = [], avanceHoras = null, modo = MODO_POR_DEFECTO, planes: planesProp, cfgValor: cfgProp, empleados: empleadosProp = SIN_EMPLEADOS, onVerDetalle, empresaId = null, puedeReordenar = false, puedeAjustar = false, usuarioNombre = null, onRefrescar = null }) {
  const hoy = hoyArg();
  // Cada "🔄 Refrescar" suma una vuelta y se vuelve a leer todo
  const [vuelta, setVuelta] = useState(0);
  const [refrescando, setRefrescando] = useState(false);
  const refrescar = async () => {
    setRefrescando(true);
    try { await onRefrescar?.(); } catch { /* queda lo que había */ }
    setVuelta((v) => v + 1);
    setRefrescando(false);
  };
  const [leido, setLeido] = useState(null);
  useEffect(() => {
    if (planesProp !== undefined) return;
    let vivo = true;
    leerPlanesConfirmados().then((d) => { if (vivo) setLeido(d); });
    return () => { vivo = false; };
  }, [planesProp, vuelta]);
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
  // Las etiquetas de módulo cuentan en las horas de Armado (plan vivo y reordenar)
  useEffect(() => {
    let vivo = true;
    sbGetAll(`piezas_ot?${empresaId ? `empresa_id=eq.${empresaId}&` : ""}modulo=not.is.null&select=ot,modulo`, { maxFilas: 50000 })
      .then((r) => { if (vivo) setModulos(modulosPorOt(r.data)); })
      .catch(() => { if (vivo) setModulos(new Map()); });
    return () => { vivo = false; };
  }, [empresaId, vuelta]);
  // "⏱ Faltan X h" y motivos de los corrimientos (145): gerencia, supervisores y administración
  const [ajustes, setAjustes] = useState(null);
  useEffect(() => {
    if (!puedeAjustar) return;
    let vivo = true;
    sbGetAll("ajustes_tiempo_ot?select=ot,etapa,tipo,horas,pendiente,dias,motivo,detalle,created_at&order=created_at.asc", { maxFilas: 20000 })
      .then((r) => { if (vivo) setAjustes(r.data); })
      .catch(() => { if (vivo) setAjustes([]); }); // sin la migración 145, como si no hubiera
    return () => { vivo = false; };
  }, [puedeAjustar, vuelta]);
  const manual = useMemo(() => faltanManual(ajustes || []), [ajustes]);
  // Retrabajo (147): sin la migración, como si no hubiera
  const [retrabajos, setRetrabajos] = useState([]);
  useEffect(() => {
    let vivo = true;
    sbGetAll("retrabajos_ot?select=id,ot,etapa,horas,motivo,detalle,creado_nombre,created_at,terminado_at&order=created_at.asc", { maxFilas: 20000 })
      .then((r) => { if (vivo) setRetrabajos(r.data || []); })
      .catch(() => { if (vivo) setRetrabajos([]); });
    return () => { vivo = false; };
  }, [vuelta]);
  const retrabajo = useMemo(() => retrabajoPendiente(retrabajos), [retrabajos]);
  const [editar, setEditar] = useState(null);
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

  // Lo que necesita el plan vivo (también para ver cuánto se corre con un "Faltan X h" nuevo)
  const vivoCon = useMemo(() => {
    if (!planes) return null;
    const items = itemsVigentes(planes);
    const opciones = {
      proyectos: abiertasPorOt, modulos: modulos || SIN_MODULOS,
      etapasCodigo: etapasDelPlan(cfgValor, etapas, divisiones),
      avance: avanceHoras?.avance || [], piezas: avanceHoras?.piezas || [],
      terminadas: new Set(proyectos.filter((p) => p.terminado_planilla).map((p) => String(p.ot))), hoy,
      params, horasSemana: horasSemanaDeGrilla(empleados, divisiones, cfgValor),
      personal: personalGantt(empleados, divisiones, cfgValor), diasExtra: diasExtraVigentes(planes),
    };
    return (m) => planVivo(items, { ...opciones, manual: m, retrabajo });
  }, [planes, abiertasPorOt, modulos, cfgValor, params, empleados, proyectos, etapas, divisiones, avanceHoras, hoy, retrabajo]);

  const { renglones, escala, grupos, tardes, corridas, sinMotivo } = useMemo(() => {
    if (!vivoCon) return { renglones: null };
    const abiertas = abiertasPorOt;
    const procesos = vivoCon(manual);
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
      tardes: renglones.filter((r) => r.tarde).sort((a, b) => b.diasTarde - a.diasTarde),
      corridas: renglones.filter((r) => r.diasCorrido > 0).sort((a, b) => b.diasCorrido - a.diasCorrido),
      // Corridos solos por el plan vivo sin motivo anotado desde que se confirmó el plan
      sinMotivo: puedeAjustar && ajustes ? atrasosSinMotivo(new Map(renglones.map((r) => [r.ot, r])), ajustes, ultimaConfirmacion(planes)) : [],
    };
  }, [vivoCon, manual, abiertasPorOt, divisiones, hoy, modo, puedeAjustar, ajustes, planes]);
  const abrirAjuste = (r, q, soloMotivo = false) => {
    if (!puedeAjustar || !q) return;
    if (grande) cerrarGrande();
    // Un proceso completo solo puede tener retrabajo
    setEditar({ ot: r.ot, etapa: q.etapa, nombre: q.nombre, horas: q.horas, pendiente: q.pendiente ?? null, diasCorrido: q.diasCorrido || 0, soloMotivo,
      completo: !!q.completo || (q.pendiente ?? 1) <= 0, retrabajos: pendientesDe(retrabajos, r.ot, q.etapa) });
  };
  // Cuántos días queda corrido el proceso con esas horas
  const diasCon = (ot, etapa) => (horas) => {
    const m = new Map(manual);
    m.set(`${ot}|${etapa}`, { horas, pendiente: null });
    return vivoCon(m).get(ot)?.procesos.find((q) => q.etapa === etapa)?.diasCorrido || 0;
  };

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
  const cambiarHorizonte = (h) => { setHorizonte(h); setCorrimiento(0); try { localStorage.setItem(CLAVE_HORIZONTE, h); } catch { /* sin almacenamiento */ } };
  const recortado = horizonte !== "todo";
  // Navegar (Tadeo, 29/10): con lo elegido, ◀ ▶ corren la ventana; con Todo, mueven la barra de desplazamiento
  const [corrimiento, setCorrimiento] = useState(0);
  const [grande, setGrande] = useState(false);
  const [verAtrasados, setVerAtrasados] = useState(true);
  const cerrarGrande = () => { setGrande(false); salirPantallaCompleta(); };
  useEscape(cerrarGrande, grande);
  useEffect(() => () => { salirPantallaCompleta(); }, []);

  const ventana = ventanaGantt(escala, horizonte, hoy, corrimiento);
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
  const [scroll, setScroll] = useState({ x: 0, max: 0 });
  const leerScroll = () => {
    const el = scrollRef.current;
    if (el) setScroll({ x: el.scrollLeft, max: Math.max(0, el.scrollWidth - el.clientWidth) });
  };
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, xHoy - 7 * px);
    leerScroll();
  }, [xHoy, px, grande]);
  const desplazar = (x) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, x);
    leerScroll();
  };
  const navegar = (paso) => {
    if (recortado) { setCorrimiento((c) => c + paso); return; }
    desplazar((scrollRef.current?.scrollLeft || 0) + paso * 7 * px);
  };
  const irAHoy = () => (recortado ? setCorrimiento(0) : desplazar(xHoy - 7 * px));

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
    if (q.hasta < desde) return null; // queda antes de lo que se ve
    const x0 = q.desde < desde ? 0 : Math.min(finVentana, x(q.desde) + q.ini * px);
    const x1 = Math.min(finVentana, x(q.hasta) + q.fin * px);
    const estado = estadoDe(q);
    // Lo ya pasado (desde que arrancó hasta hoy) más claro; lo que falta, lleno
    const corte = q.completo ? x1 : Math.min(Math.max(x0, xHoy), x1);
    return (
      <>
        {corte > x0 && <rect data-pasado={etapa} x={x0} y={BARRA.y + dy} width={corte - x0} height={BARRA.alto} rx={3} className={COLOR[etapa]} fillOpacity={0.4} />}
        {x1 > corte && <rect x={corte} y={BARRA.y + dy} width={Math.max(3, x1 - corte)} height={BARRA.alto} rx={3} className={COLOR[etapa]} />}
        {q.retrabajo > 0 && q.retrabajoDesde && (() => {
          // Retrabajo (147): la parte final de la barra, en rojo
          const xr = q.retrabajoDesde < desde ? 0 : Math.min(finVentana, x(q.retrabajoDesde) + (q.retrabajoIni || 0) * px);
          return x1 > xr ? <rect data-retrabajo={etapa} x={xr} y={BARRA.y + dy} width={Math.max(3, x1 - xr)} height={BARRA.alto} rx={3} className="fill-gypi-red" /> : null;
        })()}
        <rect data-proceso={etapa} data-estado={estado} x={x0} y={BARRA.y + dy} width={Math.max(3, x1 - x0)} height={BARRA.alto} rx={3}
          className={CONTORNO[estado] || undefined} fill="transparent" strokeWidth={CONTORNO[estado] ? 3 : 0} strokeDasharray={estado === "corrido" ? "6 3" : undefined} />
        <text x={Math.max(x0, x1) + 6} y={18 + dy} className={`text-[13px] font-bold ${q.tarde ? "fill-gypi-red" : "fill-gypi-text"}`}>
          {q.completo ? "✓" : fmtH(q.horas)}{q.personas && !q.completo ? ` · 👷 ${q.personas}` : ""}{q.manual && !q.completo ? " ⏱" : ""}{q.retrabajo > 0 ? ` 🔁 ${fmtH(q.retrabajo)}` : ""}{q.tarde ? " ⚠" : q.corrido ? " ↪" : ""}
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
        <button type="button" onClick={refrescar} disabled={refrescando}
          className="ml-auto min-h-11 px-3 rounded-xl border border-gypi-border bg-gypi-surface text-gypi-text text-[14px] font-bold cursor-pointer disabled:opacity-60">
          {refrescando ? "Refrescando…" : "🔄 Refrescar"}
        </button>
        <button type="button" onClick={grande ? cerrarGrande : () => { setGrande(true); pedirPantallaCompleta(); }}
          className="min-h-11 px-3 rounded-xl border border-gypi-border bg-gypi-surface text-gypi-text text-[14px] font-bold cursor-pointer">
          {grande ? "✕ Salir" : "⛶ Pantalla completa"}
        </button>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[15px] text-gypi-text mb-2" aria-label="Colores del Gantt">
        {ETAPAS_PLAN.map((e) => (
          <span key={e.id} className="flex items-center gap-1.5"><span aria-hidden="true" className={`inline-block w-4 h-4 rounded-sm ${MUESTRA[e.id]}`} />{e.nombre}</span>
        ))}
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-4 h-4 rounded-sm border-[3px] border-gypi-red" /><span className={tardes.length ? "text-gypi-red font-bold" : ""}>⚠ Termina después de su semana {tardes.length}</span></span>
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-4 h-4 rounded-sm border-[3px] border-dashed border-proc-margen" /><span className={corridas.length ? "font-bold" : ""}>↪ Se corrió del plan {corridas.length}</span></span>
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-4 h-4 rounded-sm bg-gypi-red" />🔁 Retrabajo</span>
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
      <div className="flex items-center gap-2 mb-2" role="group" aria-label="Moverse en el Gantt">
        <button type="button" onClick={() => navegar(-1)} aria-label={recortado ? "Ver antes" : "Una semana para atrás"} className="g-btn g-btn-secondary min-w-11">◀</button>
        <button type="button" onClick={irAHoy} className="g-btn g-btn-secondary">Hoy</button>
        <button type="button" onClick={() => navegar(1)} aria-label={recortado ? "Ver después" : "Una semana para adelante"} className="g-btn g-btn-secondary min-w-11">▶</button>
        {!recortado && scroll.max > 0 && (
          <input type="range" min={0} max={Math.round(scroll.max)} value={Math.round(scroll.x)} onChange={(e) => desplazar(Number(e.target.value))}
            aria-label="Desplazar el Gantt hacia atrás o adelante" className="flex-1 min-w-0 accent-gypi-amber" />
        )}
        {recortado && <span className="text-[14px] text-gypi-dim">{corrimiento === 0 ? "Desde hoy" : `Del ${fechaCorta(ventana.desde)} al ${fechaCorta(sumarDias(ventana.hasta, -1))}`}</span>}
      </div>
      {/* Con scroll propio para que la fila de las fechas quede fija arriba al bajar */}
      <div ref={medir} onScroll={leerScroll} className={`overflow-auto rounded-xl border border-gypi-border ${grande ? "flex-1 min-h-0" : "max-h-[75vh]"}`}>
        <div className="min-w-max">
          <div className="flex border-b border-gypi-border sticky top-0 z-20 bg-gypi-bg">
            <div className="sticky left-0 z-30 w-[260px] shrink-0 bg-gypi-bg px-2 flex items-end pb-1 text-[14px] font-bold text-gypi-dim">OT · horas que faltan</div>
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
                          aria-label={`OT ${p.ot}, ${e.nombre}: ${q.completo ? "" : `${fmtH(q.horas)}, `}del ${fechaCorta(q.desde)} al ${fechaCorta(q.hasta)}${alertasTexto(q) ? `, ${alertasTexto(q)}` : ""}. Ver detalle`}
                          className={`sticky ${movible ? "left-[84px] w-[176px]" : "left-0 w-[260px]"} z-10 shrink-0 bg-gypi-bg px-2 text-left border-0 border-r border-gypi-border cursor-pointer h-[34px] flex flex-col justify-center`}>
                          <div className={`text-[14px] font-bold leading-tight truncate ${q.tarde ? "text-gypi-red" : "text-gypi-text"}`}>
                            <span className="font-mono">{q.tarde ? "⚠ " : q.corrido ? "↪ " : ""}{p.ot}</span> · <span className="font-normal" data-cliente>{p.cliente || "—"}</span>
                          </div>
                          <div className="text-[12px] text-gypi-dim leading-tight truncate">
                            {[p.obra, nombreProyecto(p)].filter(Boolean).join(" · ")}
                          </div>
                        </button>
                        <svg width={ancho} height={FILA_OT} aria-hidden="true" className={`block ${puedeAjustar ? "cursor-pointer" : ""}`} onClick={() => abrirAjuste(r, q)}>
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
                const texto = `faltan ${fmtH(r.horas)}${r.tarde ? `, termina ${dias(r.diasTarde)} después de su semana` : ""}${r.diasCorrido > 0 ? `, se corrió ${dias(r.diasCorrido)} del plan confirmado` : ""}; `
                  + r.procesos.map((q) => `${q.nombre}${q.completo ? "" : ` ${fmtH(q.horas)}`}${q.personas && !q.completo ? ` con ${q.personas} ${q.personas === 1 ? "armador" : "armadores"}` : ""}, del ${fechaCorta(q.desde)} al ${fechaCorta(q.hasta)}${alertasTexto(q) ? `, ${alertasTexto(q)}` : ""}`).join("; ");
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
                      <div className={`font-mono text-[16px] font-bold leading-tight ${r.tarde ? "text-gypi-red" : "text-gypi-text"}`}>
                        {r.tarde ? "⚠ " : ""}{p.ot} <span className="text-[14px]">· {fmtH(r.horas)}</span>
                      </div>
                      {/* Las dos alertas, cada una con su marca (Tadeo, 29/10) */}
                      {(r.tarde || r.diasCorrido > 0) && (
                        <div className="text-[12px] font-bold leading-tight" data-alertas>
                          {r.tarde && <span className="text-gypi-red">⚠ +{r.diasTarde} d de su semana</span>}
                          {r.tarde && r.diasCorrido > 0 && " · "}
                          {r.diasCorrido > 0 && <span className="text-gypi-amber-ink">↪ +{r.diasCorrido} d del plan</span>}
                        </div>
                      )}
                      {/* Columnas A, D, E y F del Plan de trabajo: OT, cliente, obra y descripción (Tadeo, 27/10) */}
                      <div className="text-[13px] leading-tight text-gypi-dim truncate" data-cliente>{p.cliente || "—"}</div>
                      {p.obra && <div className="text-[13px] leading-tight text-gypi-dim truncate" data-obra>{p.obra}</div>}
                      {nombreProyecto(p) && <div className="text-[13px] text-gypi-text font-bold leading-tight line-clamp-2" data-proyecto title={nombreProyecto(p)}>{nombreProyecto(p)}</div>}
                    </button>
                    <div className="sticky left-[150px] z-10 w-[110px] shrink-0 bg-gypi-bg border-r border-gypi-border">
                      {ETAPAS_PLAN.map((e) => {
                        const q = r.procesos.find((z) => z.etapa === e.id);
                        const nombre = <><span aria-hidden="true" className={`inline-block w-3 h-3 rounded-sm shrink-0 ${MUESTRA[e.id]}`} />{e.nombre}</>;
                        // ⏱ Faltan X h o 🔁 retrabajo: se toca el proceso (o su barra), también si está completo
                        return puedeAjustar && q ? (
                          <button key={e.id} type="button" onClick={() => abrirAjuste(r, q)} aria-label={q.completo || (q.pendiente ?? 1) <= 0 ? `🔁 ${e.nombre} de la OT ${r.ot}: retrabajo` : `⏱ ${e.nombre} de la OT ${r.ot}: cuánto falta`}
                            className="w-full h-[26px] px-2 flex items-center gap-1.5 text-[13px] text-gypi-text bg-transparent border-0 cursor-pointer text-left">
                            {nombre}{q.retrabajo > 0 ? <span className="ml-auto" aria-hidden="true">🔁</span> : q.manual && <span className="ml-auto" aria-hidden="true">⏱</span>}
                          </button>
                        ) : (
                          <div key={e.id} className="h-[26px] px-2 flex items-center gap-1.5 text-[13px] text-gypi-text">{nombre}</div>
                        );
                      })}
                    </div>
                    <div>
                      {ETAPAS_PLAN.map((e) => {
                        const q = r.procesos.find((z) => z.etapa === e.id);
                        return (
                          <svg key={e.id} width={ancho} height={FILA} aria-hidden="true" className={`block ${puedeAjustar && q ? "cursor-pointer" : ""}`} onClick={() => abrirAjuste(r, q)}>
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
      {(tardes.length > 0 || corridas.length > 0) && (
        <section aria-label="Alertas del plan" className="mt-3 rounded-xl border border-gypi-red/40 bg-gypi-red/5 p-3 shrink-0">
          {/* Se puede minimizar para ver el Gantt entero (en el celular, en pantalla completa) */}
          <button type="button" onClick={() => setVerAtrasados((v) => !v)} aria-expanded={verAtrasados}
            className="w-full flex items-center gap-2 bg-transparent border-0 p-0 min-h-11 cursor-pointer text-left text-[15px] font-bold text-gypi-red">
            <span className="flex-1">⚠ {tardes.length} después de su semana · ↪ {corridas.length} corridas del plan</span>
            <span className="text-[14px] text-gypi-dim">{verAtrasados ? "▾ Minimizar" : "▸ Ver detalle"}</span>
          </button>
          {verAtrasados && (
            <ul className={`list-none m-0 p-0 flex flex-col gap-1 overflow-auto ${grande ? "max-h-[30vh]" : ""}`}>
              {[...tardes, ...corridas.filter((r) => !r.tarde)].map((r) => (
                <li key={r.ot}>
                  <button type="button" onClick={() => verDetalle(r.proyecto)}
                    className="w-full text-left bg-transparent border-0 p-0 min-h-11 cursor-pointer text-[15px] text-gypi-text">
                    <span className="font-mono font-bold">{r.ot}</span> · termina el {fechaCorta(r.fin)}
                    {r.tarde && <span className="text-gypi-red font-bold"> · ⚠ {dias(r.diasTarde)} después de su semana ({fechaCorta(r.objetivo)})</span>}
                    {r.diasCorrido > 0 && <span className="text-gypi-amber-ink font-bold"> · ↪ se corrió {dias(r.diasCorrido)} del plan confirmado</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {verAtrasados && sinMotivo.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gypi-border" role="group" aria-label="Atrasos sin motivo">
              <div className="text-[15px] font-bold text-gypi-amber-ink mb-1">📝 Atrasos sin motivo · {sinMotivo.length}</div>
              <ul className={`list-none m-0 p-0 flex flex-col gap-1 overflow-auto ${grande ? "max-h-[20vh]" : ""}`}>
                {sinMotivo.map((a) => (
                  <li key={`${a.ot}-${a.etapa}`} className="flex items-center gap-2 text-[15px] text-gypi-text">
                    <span className="flex-1 min-w-0"><span className="font-mono font-bold">{a.ot}</span> · {a.nombre} · ↪ se corrió {dias(a.dias)}</span>
                    <button type="button" onClick={() => abrirAjuste(a.fila, a.fila.procesos.find((q) => q.etapa === a.etapa), true)}
                      aria-label={`Anotar por qué se corrió ${a.nombre} de la OT ${a.ot}`} className="g-btn g-btn-secondary">Anotar motivo</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      {editar && (
        <AjusteTiempo {...editar} porNombre={usuarioNombre} diasCon={diasCon(editar.ot, editar.etapa)} onClose={() => setEditar(null)}
          onGuardado={(fila) => { setAjustes((a) => [...(a || []), fila]); setEditar(null); }}
          onRetrabajo={(fila) => { setRetrabajos((l) => [...l.filter((x) => x.id == null || x.id !== fila.id), fila]); setEditar(null); }} />
      )}
      {!grande && <p className="text-[13px] text-gypi-mute mt-2 mb-0">Plan vivo: el orden es el del plan confirmado y las fechas se vuelven a armar cada día desde hoy, con lo que falta de cada proceso (escaneo o checkeo manual), los parámetros y la grilla de horarios de ahora (los días sin nadie puesto no se trabajan). Lo que no se terminó pasa al día siguiente y todo se corre. En cada OT un proceso arranca cuando termina el anterior, por cada máquina pasa una OT a la vez y en Armado trabajan hasta el máximo de armadores por OT. La parte clara de cada barra es lo que ya pasó. Tocá una OT para ver su detalle.</p>}
    </div>
  );
}
