'use client';
// app/components/GanttInstalacion.jsx — 🔧 Gantt de instalación (parte 43;
// diseño en notes/diseno-gantt-instalacion.md; app/lib/planInstalacion.js).
//
// Plan vivo, calculado cada vez desde hoy: cada OT de Muebles entra el día
// hábil siguiente a que termina su producción en el Gantt de producción (o
// desde hoy si ya está producida o empezada en obra), con sus días de obra y
// sus instaladores (⚙ Parámetros → 🔧 Instalación y el Detalle de la OT). Las
// OT de la misma obra van juntas. Un renglón por obra, de a medio día, con
// quiénes van. Colores: verde a tiempo; contorno amarillo poco margen; rojo
// termina después de la semana de entrega; rayado naranja = la gente estaría
// libre antes pero la OT todavía no salió de fábrica. Si producción se atrasa,
// la instalación se corre sola. Las OT en pausa no entran. Las instaladas
// (acta firmada) salen.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sb, apiFetch } from "../lib/supabase";
import { hoyArg } from "../lib/dates";
import { fechaCorta } from "../lib/ot";
import { buscarDivision } from "../lib/rutas";
import { pendienteEtapa } from "../lib/cargaPlanta";
import { otsEnPausa } from "../lib/pausaOt";
import { normalizarParametros, divisionPlan } from "../lib/planificacion";
import { etapasDelPlan } from "../lib/ganttPlan";
import { feriadosDe } from "../lib/secuencia";
import { trabajosInstalacion, planInstalacion, trabajaElDia, itemsDelPlan, finConfirmadoPorOt, conCorrimiento, fechaArrastrada } from "../lib/planInstalacion";
import { textoDias } from "../lib/instalacionPlan";
import NombreOt from "./NombreOt";
import { Chip } from "./ui";
import { HORIZONTES_GANTT, ventanaGantt } from "../lib/gantt";
import { partesOt, textoOt } from "../lib/nombreOt";

const DIA_MS = 86400000;
const sumarDias = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const ETIQUETAS = 250;
const FILA = 54;

// Una obra puede juntar varias OT: "OT 7858 + 7859 · CEVT · OFICINAS · Escritorio + Armario"
const descripcionObra = (o) => [...new Set(o.ots.map((t) => partesOt(t.proyecto).descripcion).filter(Boolean))].join(" + ");
const textoObra = (o) => textoOt({ ...o.ots[0].proyecto, ot: o.ots.map((t) => t.ot).join(" + "), descripcion: descripcionObra(o) });
const CAB = 40;
const PX = 46; // ancho de un día con "Todo"
const CLAVE_HORIZONTE = "gypi_gantt_instalacion_horizonte";
const SIN_PAUSAS = [];
const SIN_LISTA = [];

/** Medios días pegados (mañana y tarde, o tarde y la mañana del día siguiente) en una sola barra: [[desde, hasta]]. */
export function seguidos(tramos = []) {
  const idx = (z) => Math.round(Date.parse(`${z.fecha}T00:00:00Z`) / DIA_MS) * 2 + z.medio;
  const out = [];
  for (const z of tramos) {
    const ult = out[out.length - 1];
    if (ult && idx(z) === idx(ult[1]) + 1) ult[1] = z;
    else out.push([z, z]);
  }
  return out;
}

/** % de instalación del último reporte de cada OT (migración 117; gestión ve todos). */
function avanceDeReportes(reportes = []) {
  const m = new Map();
  for (const r of [...reportes].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    if (r.avance != null) m.set(String(r.ot), Number(r.avance));
    else if (!m.has(String(r.ot))) m.set(String(r.ot), 1); // reportó sin %: empezada
  }
  return m;
}

export default function GanttInstalacion({ vivo, proyectos = SIN_LISTA, etapas = SIN_LISTA, divisiones = SIN_LISTA, avanceHoras = null, pausas = SIN_PAUSAS, empresaId = null, onVerDetalle, puedeConfirmar = false }) {
  const hoy = hoyArg();
  const [datos, setDatos] = useState(null);
  // Plan confirmado (154): cuánto se corrió cada obra; se vuelve a leer al confirmar
  const [confirmados, setConfirmados] = useState({ planes: [], falta: false });
  const [vuelta, setVuelta] = useState(0);
  useEffect(() => {
    let vivoEf = true;
    apiFetch("/api/plan-instalacion").then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((d) => { if (vivoEf) setConfirmados({ planes: d?.planes || [], falta: !!d?.falta_migracion }); });
    return () => { vivoEf = false; };
  }, [vuelta]);
  // Prioridad de instalación (153) cambiada acá, antes de que vuelvan a leerse las OT
  const [prioLocal, setPrioLocal] = useState(() => new Map());
  // Día elegido arrastrando (157), antes de que vuelvan a leerse las OT
  const [fijaLocal, setFijaLocal] = useState(() => new Map());
  // { clave, x0, dx }: la obra que se está arrastrando y cuánto se movió
  const [arrastre, setArrastre] = useState(null);
  const recienArrastrada = useRef(false);
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [verOrden, setVerOrden] = useState(false);
  // Horizonte como en producción (Tadeo, 05/11): 1 día … 1 mes o Todo, con ◀ Hoy ▶
  const [horizonte, setHorizonte] = useState(() => { try { const h = localStorage.getItem(CLAVE_HORIZONTE); return HORIZONTES_GANTT.some((x) => x.id === h) ? h : "todo"; } catch { return "todo"; } });
  const [corrimiento, setCorrimiento] = useState(0);
  const cambiarHorizonte = (h) => { setHorizonte(h); setCorrimiento(0); try { localStorage.setItem(CLAVE_HORIZONTE, h); } catch { /* sin almacenamiento */ } };
  const [anchoVisible, setAnchoVisible] = useState(0);
  const scrollRef = useRef(null);
  const observador = useRef(null);
  const medir = useCallback((el) => {
    scrollRef.current = el;
    observador.current?.disconnect();
    observador.current = null;
    if (!el) return;
    setAnchoVisible(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    observador.current = new ResizeObserver(() => setAnchoVisible(el.clientWidth));
    observador.current.observe(el);
  }, []);
  useEffect(() => {
    let vivoEf = true;
    const e = empresaId ? `empresa_id=eq.${empresaId}&` : "";
    Promise.all([
      // Sin la migración 116 no hay es_instalador: sin instaladores
      sb.get(`empleados?${e}activo=eq.true&es_instalador=eq.true&select=id,nombre,apodo,diagrama&order=nombre.asc`).catch(() => []),
      sb.get(`actas_ot?${e}firmada_at=not.is.null&select=ot`).catch(() => []),
      apiFetch("/api/instalacion").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([instaladores, actas, hist]) => {
      if (!vivoEf) return;
      setDatos({ instaladores: instaladores || [], instaladas: new Set((actas || []).map((a) => String(a.ot))), avance: avanceDeReportes(hist?.reportes || []) });
    });
    return () => { vivoEf = false; };
  }, [empresaId]);

  const calculo = useMemo(() => {
    if (!vivo || !datos) return null;
    const params = normalizarParametros(vivo.cfgValor);
    const division = divisionPlan(divisiones, params.division_id);
    const deLaDivision = proyectos.filter((p) => p.estado !== "cerrado" && (!division || buscarDivision(divisiones, p.division)?.id === division.id))
      .map((p) => (prioLocal.has(String(p.ot)) ? { ...p, prioridad_instalacion: prioLocal.get(String(p.ot)) } : p))
      .map((p) => (fijaLocal.has(String(p.ot)) ? { ...p, instalacion_desde: fijaLocal.get(String(p.ot)) } : p));
    const finProduccion = new Map();
    const producidas = new Set();
    for (const r of vivo.renglones || []) {
      if (r.procesos.every((q) => q.completo)) producidas.add(String(r.ot));
      else finProduccion.set(String(r.ot), { fin: r.fin });
    }
    // Fuera del plan de producción: producida si Armado está terminado (o escaneado entero)
    const armado = etapasDelPlan(vivo.cfgValor, etapas, divisiones).armado;
    for (const p of deLaDivision) {
      const ot = String(p.ot);
      if (finProduccion.has(ot) || producidas.has(ot)) continue;
      if (armado != null && pendienteEtapa({ ot, codigo: armado, avance: avanceHoras?.avance || [], piezas: avanceHoras?.piezas || [] }) <= 0) producidas.add(ot);
    }
    const feriados = feriadosDe(params);
    const { trabajos, sinProduccion, sinDato } = trabajosInstalacion({
      proyectos: deLaDivision, finProduccion, producidas, instaladas: datos.instaladas, pausadas: otsEnPausa(pausas),
      avance: datos.avance, params, inst: params.instalacion, modulos: vivo.modulos, hoy, feriados,
      maxPersonas: datos.instaladores.length || 2,
    });
    const obras = conCorrimiento(planInstalacion(trabajos, datos.instaladores, { hoy, feriados }), finConfirmadoPorOt(confirmados.planes));
    return { obras, sinProduccion, sinDato, feriados, divisionId: division?.id || null };
  }, [vivo, datos, proyectos, divisiones, etapas, avanceHoras, pausas, hoy, confirmados, prioLocal, fijaLocal]);

  if (!calculo) return <div className="gypi-dots py-6" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>;
  const { obras, sinProduccion, sinDato, feriados, divisionId } = calculo;
  const corridas = obras.filter((o) => o.diasCorrido > 0);
  const ultimoPlan = confirmados.planes.find((p) => (p.division_id || null) === divisionId) || confirmados.planes[0] || null;

  const confirmar = async () => {
    setOcupado(true);
    setAviso(null);
    try {
      const r = await apiFetch("/api/plan-instalacion", { method: "POST", body: JSON.stringify({ division_id: divisionId, items: itemsDelPlan(obras) }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo confirmar el plan de instalación.");
      setAviso("✅ Plan de instalación confirmado. Cada instalador ya ve sus obras en Instalaciones.");
      setVuelta((v) => v + 1);
    } catch (e) {
      setAviso(e.message);
    } finally {
      setOcupado(false);
    }
  };
  // ▲▼: el orden de las obras queda como prioridad de instalación de sus OT (1, 2, 3…)
  const guardarOrden = async (lista) => {
    setOcupado(true);
    setAviso(null);
    const nueva = new Map(prioLocal);
    lista.forEach((o, i) => o.ots.forEach((t) => nueva.set(String(t.ot), i + 1)));
    const antes = prioLocal;
    setPrioLocal(nueva);
    try {
      for (const [i, o] of lista.entries()) {
        const ids = o.ots.map((t) => t.proyecto?.id).filter((id) => id != null);
        if (ids.length) await sb.patch(`proyectos?id=in.(${ids.join(",")})`, { prioridad_instalacion: i + 1 });
      }
    } catch (e) {
      setPrioLocal(antes);
      setAviso(/prioridad_instalacion/.test(String(e.message)) ? "Para cambiar el orden falta correr la migración 153 en Supabase." : `No se pudo guardar el orden: ${e.message}`);
    } finally {
      setOcupado(false);
    }
  };
  const mover = (i, d) => {
    const lista = [...obras];
    const j = i + d;
    if (j < 0 || j >= lista.length) return;
    [lista[i], lista[j]] = [lista[j], lista[i]];
    guardarOrden(lista);
  };
  // Arrastrar una obra a otro día (Tadeo, 05/11): queda "instalar desde" en
  // sus OT; nunca antes del día hábil siguiente al fin de producción
  const fijar = async (o, fecha) => {
    const ids = o.ots.map((t) => t.proyecto?.id).filter((id) => id != null);
    if (!ids.length) return;
    const antes = fijaLocal;
    setFijaLocal(new Map([...fijaLocal, ...o.ots.map((t) => [String(t.ot), fecha])]));
    setOcupado(true);
    try {
      await sb.patch(`proyectos?id=in.(${ids.join(",")})`, { instalacion_desde: fecha });
    } catch (e) {
      setFijaLocal(antes);
      setAviso(/instalacion_desde/.test(String(e.message)) ? "Para mover obras falta correr la migración 157 en Supabase." : `No se pudo mover la obra: ${e.message}`);
    } finally {
      setOcupado(false);
    }
  };
  const soltar = (o, dias) => {
    if (!dias || o.sinLugar) return;
    const { fecha, ajustada } = fechaArrastrada(o, sumarDias(o.inicio, dias));
    setAviso(ajustada
      ? `La OT ${o.ots.map((t) => t.ot).join(" + ")} no se puede instalar antes del ${fechaCorta(fecha)} (el día hábil siguiente a que termina producción). Quedó desde ese día.`
      : `OT ${o.ots.map((t) => t.ot).join(" + ")}: se instala desde el ${fechaCorta(fecha)} (o el primer día con instaladores libres).`);
    fijar(o, fecha);
  };
  const quitarFecha = (o) => fijar(o, null).then(() => setAviso(`OT ${o.ots.map((t) => t.ot).join(" + ")}: vuelve a la fecha automática.`));
  const empezarArrastre = (e, o) => {
    if (!puedeConfirmar || ocupado || o.sinLugar) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setArrastre({ clave: o.clave, x0: e.clientX, dx: 0 });
  };
  const moverArrastre = (e) => {
    if (!arrastre) return;
    setArrastre({ ...arrastre, dx: e.clientX - arrastre.x0 });
  };
  const soltarArrastre = (o) => {
    if (!arrastre) return;
    const dias = Math.round(arrastre.dx / px);
    if (Math.abs(arrastre.dx) > 4) recienArrastrada.current = true; // que no abra el detalle
    setArrastre(null);
    soltar(o, dias);
  };
  const quitarOrden = async () => {
    const ids = obras.flatMap((o) => o.ots.map((t) => t.proyecto?.id)).filter((id) => id != null);
    setOcupado(true);
    setAviso(null);
    try {
      if (ids.length) await sb.patch(`proyectos?id=in.(${ids.join(",")})`, { prioridad_instalacion: null });
      setPrioLocal(new Map(obras.flatMap((o) => o.ots.map((t) => [String(t.ot), null]))));
    } catch (e) {
      setAviso(`No se pudo quitar el orden: ${e.message}`);
    } finally {
      setOcupado(false);
    }
  };
  const nombres = new Map((datos.instaladores || []).map((g) => [g.id, g.apodo || g.nombre]));
  const sinInstaladores = !datos.instaladores.length;
  const tardes = obras.filter((o) => o.tarde);
  const conLugar = obras.filter((o) => !o.sinLugar);

  const ultimo = conLugar.reduce((m, o) => (o.fin > m ? o.fin : m), sumarDias(hoy, 13));
  const recortado = horizonte !== "todo";
  const ventana = recortado ? ventanaGantt(null, horizonte, hoy, corrimiento) : null;
  const desde = ventana?.desde || hoy;
  const totalDias = ventana ? ventana.dias : Math.min(400, Math.round((Date.parse(`${ultimo}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / DIA_MS) + 3);
  const hasta = sumarDias(desde, totalDias); // el día siguiente al último que se ve
  // Con un horizonte, los días se estiran para ocupar todo el ancho
  const px = recortado && anchoVisible > ETIQUETAS + 40 ? Math.max(12, (anchoVisible - ETIQUETAS - 2) / totalDias) : PX;
  const fechas = Array.from({ length: totalDias }, (_, i) => sumarDias(desde, i));
  const x = (fecha) => Math.round((Date.parse(`${fecha}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / DIA_MS) * px;
  const ancho = totalDias * px;
  const enVentana = (f) => f >= desde && f < hasta;
  // Con un horizonte, solo las obras que trabajan en esos días
  const vistas = recortado ? obras.filter((o) => o.tramos.some((z) => enVentana(z.fecha))) : obras;
  const navegar = (paso) => {
    if (recortado) { setCorrimiento((c) => c + paso); return; }
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, el.scrollLeft + paso * 7 * PX);
  };
  const irAHoy = () => {
    if (recortado) { setCorrimiento(0); return; }
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  };
  const conEtiqueta = (f, d) => px >= 30 || d === 1 || f === hoy; // angosto: solo los lunes (y hoy)
  const algunoTrabaja = (f) => (sinInstaladores ? trabajaElDia(null, f, feriados) : datos.instaladores.some((g) => trabajaElDia(g, f, feriados)));

  return (
    <section aria-label="Gantt de instalación">
      <div className="flex flex-wrap gap-1.5 items-center mb-2" role="group" aria-label="Qué se ve">
        <span className="text-[14px] text-gypi-dim">Ver:</span>
        {HORIZONTES_GANTT.map((h) => (
          <Chip key={h.id} active={horizonte === h.id} onClick={() => cambiarHorizonte(h.id)}>{h.label}</Chip>
        ))}
      </div>
      <div className="flex items-center gap-2 mb-2" role="group" aria-label="Moverse en el Gantt de instalación">
        <button type="button" onClick={() => navegar(-1)} aria-label={recortado ? "Ver antes" : "Una semana para atrás"} className="g-btn g-btn-secondary min-w-11">◀</button>
        <button type="button" onClick={irAHoy} className="g-btn g-btn-secondary">Hoy</button>
        <button type="button" onClick={() => navegar(1)} aria-label={recortado ? "Ver después" : "Una semana para adelante"} className="g-btn g-btn-secondary min-w-11">▶</button>
        {recortado && <span className="text-[14px] text-gypi-dim">{corrimiento === 0 ? "Desde hoy" : `Del ${fechaCorta(desde)} al ${fechaCorta(sumarDias(hasta, -1))}`}</span>}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[15px] text-gypi-text mb-2" aria-label="Colores del Gantt de instalación">
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-4 h-4 rounded-sm bg-gypi-green" />Instalación</span>
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-4 h-4 rounded-sm border-[3px] border-gypi-red" /><span className={tardes.length ? "text-gypi-red font-bold" : ""}>⚠ Termina después de la entrega {tardes.length}</span></span>
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-4 h-4 rounded-sm border-[3px] border-dashed border-proc-margen" />Poco margen</span>
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-4 h-4 rounded-sm bg-gypi-amber" />🏭 Espera producción</span>
        {ultimoPlan && <span className={corridas.length ? "font-bold" : ""}>↪ Se corrió del plan confirmado {corridas.length}</span>}
      </div>
      {puedeConfirmar && obras.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <button type="button" onClick={confirmar} disabled={ocupado} className="g-btn g-btn-primary">{ocupado ? "Guardando…" : "✅ Confirmar plan de instalación"}</button>
          <button type="button" onClick={() => setVerOrden((v) => !v)} className="g-btn g-btn-secondary">{verOrden ? "Cerrar orden" : "↕ Cambiar orden"}</button>
          <span className="text-[13px] text-gypi-dim">
            {confirmados.falta ? "Para confirmar falta correr la migración 154 en Supabase."
              : ultimoPlan ? `Confirmado el ${fechaCorta(String(ultimoPlan.confirmado_at).slice(0, 10))}${ultimoPlan.confirmado_nombre ? ` por ${ultimoPlan.confirmado_nombre}` : ""}. Los instaladores ven ese plan.`
                : "Todavía no hay un plan confirmado: los instaladores no ven sus obras."}
          </span>
        </div>
      )}
      {aviso && <div role="status" className="text-[14px] font-bold text-gypi-text mb-2">{aviso}</div>}
      {puedeConfirmar && verOrden && obras.length > 0 && (
        <section aria-label="Orden de las obras" className="g-card mb-2">
          <div className="text-[13px] text-gypi-dim mb-2">Las de arriba se instalan primero. El orden queda guardado en cada OT; las obras nuevas van después, por fecha de entrega. 📌 = la moviste a un día arrastrándola; tocá ✕ para que vuelva a la fecha automática.</div>
          <ol className="list-none m-0 p-0 flex flex-col gap-1">
            {obras.map((o, i) => (
              <li key={o.clave} className="flex items-center gap-2 text-[14px]">
                <span className="w-6 text-gypi-dim text-right">{i + 1}</span>
                <span className="flex-1 min-w-0 truncate" title={textoObra(o)}>{textoObra(o)}</span>
                {o.fijada && (
                  <button type="button" disabled={ocupado} onClick={() => quitarFecha(o)} aria-label={`Quitar la fecha elegida de la OT ${o.ots[0].ot}`} className="g-btn g-btn-secondary">📌 {fechaCorta(o.fijada)} ✕</button>
                )}
                <button type="button" aria-label={`Subir la obra de la OT ${o.ots[0].ot}`} disabled={ocupado || i === 0} onClick={() => mover(i, -1)} className="g-btn g-btn-secondary min-w-11">▲</button>
                <button type="button" aria-label={`Bajar la obra de la OT ${o.ots[0].ot}`} disabled={ocupado || i === obras.length - 1} onClick={() => mover(i, 1)} className="g-btn g-btn-secondary min-w-11">▼</button>
              </li>
            ))}
          </ol>
          <button type="button" onClick={quitarOrden} disabled={ocupado} className="g-btn g-btn-secondary mt-2">Volver al orden por fecha de entrega</button>
        </section>
      )}
      {sinInstaladores && (
        <div role="status" className="text-[14px] text-gypi-amber-ink font-bold mb-2">No hay instaladores marcados: se planifica con 2 de lunes a viernes. Marcalos en la ficha de cada uno (&quot;Es instalador&quot;).</div>
      )}

      {!obras.length ? (
        <div className="g-card py-8 px-6 text-center">
          <div className="text-[28px] mb-2">🔧</div>
          <div className="text-sm font-bold text-gypi-text mb-1">No hay OT para instalar</div>
          <div className="text-xs text-gypi-dim">Entran las OT de Muebles que están en el plan de producción o ya producidas, con días de instalación y sin acta firmada.</div>
        </div>
      ) : (
        <div ref={medir} className="overflow-x-auto border border-gypi-border rounded-xl bg-gypi-surface">
          {!vistas.length && <div className="px-3 py-6 text-[15px] text-gypi-dim">No hay obras para instalar {horizonte === "1d" ? "ese día" : "en esos días"}.</div>}
          {vistas.length > 0 && <svg width={ETIQUETAS + ancho} height={CAB + vistas.length * FILA} role="img" aria-label={`Instalación de ${vistas.length} ${vistas.length === 1 ? "obra" : "obras"}`}>
            {fechas.map((f) => {
              const d = new Date(`${f}T00:00:00Z`).getUTCDay();
              return (
                <g key={f}>
                  {!algunoTrabaja(f) && <rect x={ETIQUETAS + x(f)} y={0} width={px} height={CAB + vistas.length * FILA} className="fill-gypi-surf-hi" />}
                  <line x1={ETIQUETAS + x(f)} x2={ETIQUETAS + x(f)} y1={0} y2={CAB + vistas.length * FILA} className={d === 1 ? "stroke-gypi-dim" : "stroke-gypi-border"} strokeWidth={d === 1 ? 1 : 0.5} />
                  {conEtiqueta(f, d) && <text x={ETIQUETAS + x(f) + (px >= 30 ? px / 2 : 2)} y={16} textAnchor={px >= 30 ? "middle" : "start"} className="fill-gypi-dim text-[12px]">{DIAS[d]}</text>}
                  {conEtiqueta(f, d) && <text x={ETIQUETAS + x(f) + (px >= 30 ? px / 2 : 2)} y={32} textAnchor={px >= 30 ? "middle" : "start"} className={f === hoy ? "fill-gypi-amber text-[12px] font-bold" : "fill-gypi-text text-[12px]"}>{Number(f.slice(8))}/{Number(f.slice(5, 7))}</text>}
                </g>
              );
            })}
            {vistas.map((o, i) => {
              const y = CAB + i * FILA;
              const tramos = o.tramos.filter((z) => enVentana(z.fecha));
              const finVisible = !o.sinLugar && enVentana(o.fin);
              const p0 = o.ots[0].proyecto;
              const titulo = o.ots.map((t) => t.ot).join(" + ");
              // Código · Cliente · Proyecto · Descripción, como en toda la app (02/11)
              const sub = [partesOt(p0).cliente, partesOt(p0).proyecto].filter(Boolean).join(" · ");
              const desc = descripcionObra(o);
              const equipo = o.equipo.map((id) => nombres.get(id) || "Instalador").join(", ");
              const movible = puedeConfirmar && !o.sinLugar;
              const moviendo = arrastre?.clave === o.clave;
              const destino = moviendo && o.inicio ? fechaArrastrada(o, sumarDias(o.inicio, Math.round(arrastre.dx / px))) : null;
              const contorno = o.tarde ? "stroke-gypi-red" : o.poco ? "stroke-proc-margen" : "stroke-none";
              const texto = `OT ${titulo}${sub ? `, ${sub}` : ""}${desc ? `, ${desc}` : ""}: ${o.sinLugar ? "sin lugar en el plan" : `del ${fechaCorta(o.inicio)} al ${fechaCorta(o.fin)}, ${textoDias(o.dias)} con ${o.personas} ${o.personas === 1 ? "instalador" : "instaladores"}`}${o.tarde ? `, termina ${o.diasTarde} días después de la entrega` : ""}${o.esperaProduccion ? ", espera que termine producción" : ""}${o.diasCorrido > 0 ? `, se corrió ${o.diasCorrido} días del plan confirmado` : ""}${o.fijada ? `, movida a mano desde el ${fechaCorta(o.fijada)}` : ""}`;
              return (
                <g key={o.clave} role="button" tabIndex={0} aria-label={texto} className="cursor-pointer"
                  onClick={() => { if (recienArrastrada.current) { recienArrastrada.current = false; return; } onVerDetalle?.(p0); }} onKeyDown={(e) => { if (e.key === "Enter") onVerDetalle?.(p0); }}>
                  <line x1={0} x2={ETIQUETAS + ancho} y1={y + FILA} y2={y + FILA} className="stroke-gypi-border" strokeWidth={0.5} />
                  <text x={8} y={y + 16} className="fill-gypi-text text-[13px] font-bold font-mono">{titulo.length > 28 ? `${titulo.slice(0, 27)}…` : titulo}{o.enCurso ? " · en obra" : ""}</text>
                  <text x={8} y={y + 32} className="fill-gypi-dim text-[12px]">{(sub || "").slice(0, 38)}</text>
                  {desc && <text x={8} y={y + 47} className="fill-gypi-text text-[12px] font-semibold" data-descripcion>{desc.length > 38 ? `${desc.slice(0, 37)}…` : desc}</text>}
                  {o.esperaProduccion && o.inicio > desde && (
                    <rect x={ETIQUETAS + 2} y={y + 15} width={Math.max(0, Math.min(ancho, x(o.inicio)) - 4)} height={4} rx={2} className="fill-gypi-amber" opacity={0.6} />
                  )}
                  <g data-barras={o.clave} transform={moviendo ? `translate(${arrastre.dx} 0)` : undefined} opacity={moviendo ? 0.75 : 1}
                    className={movible ? "cursor-grab touch-none" : undefined}
                    onPointerDown={movible ? (e) => empezarArrastre(e, o) : undefined} onPointerMove={movible ? moverArrastre : undefined}
                    onPointerUp={movible ? () => soltarArrastre(o) : undefined} onPointerCancel={movible ? () => setArrastre(null) : undefined}>
                  {seguidos(tramos).map(([a, b]) => (
                    <rect key={`${a.fecha}|${a.medio}`} x={ETIQUETAS + x(a.fecha) + (a.medio ? px / 2 : 0) + 1} y={y + 7}
                      width={x(b.fecha) + (b.medio ? px : px / 2) - x(a.fecha) - (a.medio ? px / 2 : 0) - 2} height={FILA - 14} rx={4}
                      className={`fill-gypi-green ${contorno}`} strokeWidth={o.tarde || o.poco ? 2.5 : 0} strokeDasharray={o.poco && !o.tarde ? "4 2" : undefined} />
                  ))}
                  </g>
                  {moviendo && destino && (
                    <text x={ETIQUETAS + Math.max(0, x(o.inicio) + arrastre.dx)} y={y + 5} className={`text-[12px] font-bold ${destino.ajustada ? "fill-gypi-red" : "fill-gypi-text"}`}>
                      → {fechaCorta(destino.fecha)}{destino.ajustada ? " (antes no: termina producción)" : ""}
                    </text>
                  )}
                  {finVisible && (
                    <text x={ETIQUETAS + x(o.fin) + (o.finMedio ? px : px / 2) + 4} y={y + FILA / 2 + 4} className={`text-[12px] ${o.tarde ? "fill-gypi-red font-bold" : "fill-gypi-text"}`}>
                      {textoDias(o.dias)} · {equipo}{o.tarde ? ` · ⚠ ${o.diasTarde} d tarde` : ""}{o.diasCorrido > 0 ? ` · ↪ ${o.diasCorrido} d` : ""}{o.fijada ? " · 📌" : ""}
                    </text>
                  )}
                  {o.entrega && enVentana(o.entrega) && (
                    <line x1={ETIQUETAS + x(o.entrega) + px} x2={ETIQUETAS + x(o.entrega) + px} y1={y + 3} y2={y + FILA - 3} className="stroke-gypi-red" strokeWidth={2} />
                  )}
                </g>
              );
            })}
          </svg>}
        </div>
      )}

      {(sinDato.length > 0 || sinProduccion.length > 0 || obras.some((o) => o.sinLugar)) && (
        <div className="g-card mt-2 text-[14px] text-gypi-text">
          {sinDato.length > 0 && (
            <div className="mb-2">
              <div className="font-bold mb-1">Sin días de instalación · {sinDato.length}</div>
              <div className="text-gypi-dim text-[13px] mb-1">Cargá los gabinetes por persona por día en ⚙ Parámetros → 🔧 Instalación, o corregilo a mano en el Detalle de la OT.</div>
              <ul className="list-none m-0 p-0 flex flex-wrap gap-1.5">
                {sinDato.map(({ proyecto: p }) => (
                  <li key={p.ot}><button type="button" className="g-btn g-btn-secondary text-left" onClick={() => onVerDetalle?.(p)}><NombreOt proyecto={p} /></button></li>
                ))}
              </ul>
            </div>
          )}
          {sinProduccion.length > 0 && (
            <div className="text-gypi-dim text-[13px]">{sinProduccion.length === 1 ? "1 OT sin terminar no está" : `${sinProduccion.length} OT sin terminar no están`} en el plan de producción: entran cuando se planifique su producción.</div>
          )}
          {obras.some((o) => o.sinLugar) && <div className="text-gypi-red text-[13px] mt-1">Hay obras que no entran en los próximos 400 días con los instaladores de ahora.</div>}
        </div>
      )}
      <p className="text-[13px] text-gypi-mute mt-2 mb-0">Plan vivo: cada OT entra el día hábil siguiente a que termina su producción (si producción se atrasa, la instalación se corre sola). Días de obra = gabinetes ÷ gabinetes por persona por día ÷ instaladores, de a medio día. Las OT de la misma obra van juntas y se reparten la gente. La línea roja es el fin de la semana de entrega. Los días grises no trabaja ningún instalador (o son feriados). Tocá una obra para ver el detalle.{puedeConfirmar ? " Para cambiarla de día, tomá su barra y arrastrala: nunca antes del día hábil siguiente a que termina producción." : ""}</p>
    </section>
  );
}
