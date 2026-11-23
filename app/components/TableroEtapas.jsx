'use client';
// app/components/TableroEtapas.jsx — Producción → OT → 🗂️ Trello (Tadeo,
// 22/11): tablero tipo Trello con una columna por proceso (Corte, Canteado,
// Mecanizado, Armado), Instalación y Terminadas. Cada OT está en la etapa en
// que va, con cuánto lleva ahí en horas de jornada; al tocarla se ve el
// registro de cada etapa y la duración de la OT. La cuenta está en
// app/lib/tableroEtapas.js; reemplaza a Del día, Indicadores, Lead time y
// Obra de Reportes.
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, sbGetAll } from "../lib/supabase";
import { leadTimeProcesos, ventanasDeGrilla, fmtHoras } from "../lib/leadTimeHoras";
import { etapasDelPlan, itemsVigentes, leerPlanesConfirmados } from "../lib/ganttPlan";
import { normalizarParametros } from "../lib/planificacion";
import { feriadosDe } from "../lib/secuencia";
import { ventanasSemana } from "../lib/cargaPlanta";
import { piezasConManual } from "../lib/avanceManual";
import { tableroEtapas, instalacionPorOt, pctPorProceso, otsDelPlan, DIAS_TERMINADAS } from "../lib/tableroEtapas";
import { Modal } from "./ui";
import NombreOt from "./NombreOt";

const vacio = () => ({ data: [] });

// Colores fijos de cada columna (los mismos de cada proceso en el Gantt)
const COLOR_COLUMNA = {
  corte: "bg-proc-corte", canteado: "bg-proc-canteado", mecanizado: "bg-proc-mecanizado", armado: "bg-proc-armado",
  instalacion: "bg-gypi-cyan", terminadas: "bg-gypi-green",
};

/** "18/11 10:30", en hora de Argentina. */
export function fechaHora(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const f = d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
  const h = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Argentina/Buenos_Aires" });
  return `${f} ${h}`;
}

/** Lee todo lo que hace falta para el tablero (navegador). Sin cada migración, ese dato queda vacío. */
async function leerDatos(empresaId) {
  const e = empresaId;
  const [piezas, manual, avance, cargas, bultos, reportes, actas, proyectosManual, plan, planInst] = await Promise.all([
    sbGetAll(`v_avance_piezas?empresa_id=eq.${e}&select=ot,etapa,total,pasaron,primer_paso,ultimo_paso`, { maxFilas: 20000 }).catch(vacio),
    sbGetAll(`avance_manual_historial?empresa_id=eq.${e}&select=ot,etapa,pct,created_at&order=created_at.asc`, { maxFilas: 50000 }).catch(vacio),
    sbGetAll(`avance_etapas?empresa_id=eq.${e}&select=ot,etapa,estado,terminada_at,aprobada_at`, { maxFilas: 20000 }).catch(vacio),
    sbGetAll(`cargas_ot?empresa_id=eq.${e}&select=ot,firma_carga_at`).catch(vacio),
    sbGetAll(`bultos_ot?empresa_id=eq.${e}&cargado=eq.true&select=ot,cargado_at`, { maxFilas: 20000 }).catch(vacio),
    sbGetAll(`reportes_instalacion?empresa_id=eq.${e}&select=ot,avance,created_at`, { maxFilas: 20000 }).catch(vacio),
    sbGetAll(`actas_ot?empresa_id=eq.${e}&firmada_at=not.is.null&select=ot,firmada_at`).catch(vacio),
    sbGetAll(`proyectos?empresa_id=eq.${e}&avance_manual=not.is.null&select=ot,avance_manual`, { maxFilas: 20000 }).catch(vacio),
    leerPlanesConfirmados().catch(() => ({ planes: [], cfgValor: null, empleados: [] })),
    apiFetch("/api/plan-instalacion").then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  return {
    piezas: piezas.data, manual: manual.data, avance: avance.data, cargas: cargas.data, bultos: bultos.data,
    reportes: reportes.data, actas: actas.data, proyectosManual: proyectosManual.data,
    planes: plan.planes || [], cfgValor: plan.cfgValor || null, empleados: plan.empleados || [],
    planesInstalacion: planInst?.planes || [],
  };
}

function Tarjeta({ t, onAbrir }) {
  const paralelo = t.atrasados.length > 0 && t.estado === "en_curso";
  const borde = paralelo ? "border-2 border-orange-500" : t.fueraDelGantt ? "border-2 border-purple-600" : "border border-gypi-border";
  return (
    <button type="button" onClick={() => onAbrir(t)} data-tarjeta-ot={t.ot} data-estado={t.estado}
      data-paralelo={paralelo ? "si" : undefined} data-fuera-gantt={t.fueraDelGantt ? "si" : undefined}
      aria-label={`OT ${t.ot}: ver el registro de sus etapas`}
      className={`w-full min-w-0 overflow-hidden whitespace-normal break-words text-left bg-gypi-surface rounded-xl p-2.5 cursor-pointer ${borde} ${t.estado === "esperando" ? "opacity-80" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[13px] font-bold text-gypi-amber-ink">OT {t.ot}</span>
        <span className="text-[13px] font-bold text-gypi-text shrink-0" data-lleva>
          {t.estado === "terminada" ? fmtHoras(t.horas ?? t.produccion) : fmtHoras(t.lleva)}
        </span>
      </div>
      <NombreOt proyecto={t.proyecto} forma="bloque" sinCodigo truncar className="text-[12px] mt-0.5" />
      {t.estado === "en_curso" && t.pct != null && (
        <div className="mt-1.5">
          <progress value={t.pct} max={100} aria-label={`Avance ${t.pct} %`}
            className="block w-full h-1.5 appearance-none rounded-full overflow-hidden bg-gypi-surf-hi [&::-webkit-progress-bar]:bg-gypi-surf-hi [&::-webkit-progress-value]:bg-gypi-green [&::-moz-progress-bar]:bg-gypi-green" />
          <div className="text-xs text-gypi-dim mt-0.5">{t.pct} % · desde {fechaHora(t.desde)}</div>
        </div>
      )}
      {t.estado === "esperando" && <div className="text-xs text-gypi-dim mt-1">⏳ Esperando desde {fechaHora(t.desde)}</div>}
      {t.estado === "terminada" && <div className="text-xs text-gypi-dim mt-1">✅ {fechaHora(t.fin)}</div>}
      <div className="flex flex-wrap gap-1 mt-1.5">
        {paralelo && (
          <span className="text-xs font-bold px-1.5 py-0.5 rounded-md bg-orange-500 text-white">
            ⚠ {t.atrasados.map((a) => `${a.nombre} sin terminar${a.pct != null ? `: ${a.pct} %` : ""}`).join(" · ")}
          </span>
        )}
        {t.fueraDelGantt && <span className="text-xs font-bold px-1.5 py-0.5 rounded-md bg-purple-600 text-white">🟣 Fuera del Gantt</span>}
        {t.enPausa && <span className="text-xs font-bold px-1.5 py-0.5 rounded-md bg-gypi-surf-hi text-gypi-text">⏸ En pausa</span>}
      </div>
    </button>
  );
}

function Registro({ t, onVerDetalle }) {
  const filas = [
    ...t.procesos.map((q) => ({ id: q.etapa, nombre: q.nombre, inicio: q.inicio, fin: q.fin, horas: q.horas, lleva: q.lleva, pct: q.pct })),
    { id: "instalacion", nombre: "Instalación", ...(t.instalacion || {}) },
  ];
  return (
    <div>
      <NombreOt proyecto={t.proyecto} forma="bloque" className="text-[13px] mb-3" />
      <table className="w-full border-collapse text-[13px]" aria-label="Registro de etapas">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-gypi-dim">
            <th scope="col" className="py-1.5 pr-2">Etapa</th>
            <th scope="col" className="py-1.5 pr-2">Empezó</th>
            <th scope="col" className="py-1.5 pr-2">Terminó</th>
            <th scope="col" className="py-1.5 text-right">Horas</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id} className="border-t border-gypi-border" data-registro={f.id}>
              <td className="py-1.5 pr-2 font-semibold">{f.nombre}{f.pct != null && !f.fin && f.inicio ? <span className="text-gypi-dim font-normal"> · {f.pct} %</span> : null}</td>
              <td className="py-1.5 pr-2">{f.inicio ? fechaHora(f.inicio) : "—"}</td>
              <td className="py-1.5 pr-2">{f.fin ? fechaHora(f.fin) : f.inicio ? "en curso" : "—"}</td>
              <td className="py-1.5 text-right font-bold">{f.fin ? fmtHoras(f.horas) : f.inicio ? `lleva ${fmtHoras(f.lleva)}` : "—"}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-gypi-border" data-registro="produccion">
            <td className="py-1.5 pr-2 font-bold" colSpan={3}>Producción completa</td>
            <td className="py-1.5 text-right font-bold">{fmtHoras(t.produccion)}</td>
          </tr>
          <tr className="border-t border-gypi-border" data-registro="ot">
            <td className="py-1.5 pr-2 font-bold" colSpan={3}>OT completa{t.inicio ? ` (desde ${fechaHora(t.inicio)})` : ""}</td>
            <td className="py-1.5 text-right font-bold">{t.fin ? fmtHoras(t.horas) : `lleva ${fmtHoras(t.llevaOt)}`}</td>
          </tr>
        </tbody>
      </table>
      <p className="text-xs text-gypi-dim mt-2 mb-3">
        Horas de jornada: solo las de la grilla de horarios, sin noches, fines de semana, feriados ni tiempo en pausa. La OT completa va de su primer avance hasta el acta firmada.
        Entre etapas puede haber horas de espera, por eso la suma de las etapas no siempre da el total.
      </p>
      {onVerDetalle && (
        <button type="button" onClick={() => onVerDetalle(t.proyecto)} className="w-full min-h-[44px] rounded-xl border border-gypi-border bg-transparent text-gypi-text font-semibold cursor-pointer">
          Ver el detalle de la OT
        </button>
      )}
    </div>
  );
}

export default function TableroEtapas({ proyectos = [], empresaId, etapas = [], divisiones = [], pausas = [], onVerDetalle = null }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [abierta, setAbierta] = useState(null);
  const [cargando, setCargando] = useState(false);

  const leer = useCallback(async () => {
    if (!empresaId) return;
    setCargando(true);
    try { setDatos(await leerDatos(empresaId)); setError(null); }
    catch (err) { console.error(err); setError("No se pudo armar el tablero."); }
    setCargando(false);
  }, [empresaId]);
  useEffect(() => {
    if (!empresaId) return;
    let vivo = true;
    leerDatos(empresaId).then((d) => { if (vivo) setDatos(d); })
      .catch((err) => { console.error(err); if (vivo) setError("No se pudo armar el tablero."); });
    return () => { vivo = false; };
  }, [empresaId]);

  const tablero = useMemo(() => {
    if (!datos) return null;
    const params = normalizarParametros(datos.cfgValor);
    const feriados = feriadosDe(params);
    const etapasCodigo = etapasDelPlan(datos.cfgValor, etapas, divisiones);
    const ventanas = ventanasDeGrilla(datos.empleados, divisiones, datos.cfgValor);
    const vInst = ventanasSemana((datos.empleados || []).filter((e) => e.es_instalador));
    const lead = leadTimeProcesos({
      etapasCodigo, piezas: datos.piezas, manual: datos.manual, avance: datos.avance,
      proyectos: datos.proyectosManual, ventanas, pausas, feriados,
    });
    const planInst = otsDelPlan(datos.planesInstalacion.flatMap((p) => p.items || []));
    return tableroEtapas({
      proyectos, lead, pct: pctPorProceso(piezasConManual(datos.piezas, datos.proyectosManual)),
      instalacion: instalacionPorOt(datos), etapasCodigo, divisiones, ventanas,
      ventanasInstalacion: vInst.some(Boolean) ? vInst : ventanas, feriados, pausas,
      planProduccion: otsDelPlan(itemsVigentes(datos.planes)),
      planInstalacion: planInst.size ? planInst : null,
    });
  }, [datos, proyectos, etapas, divisiones, pausas]);

  if (error) return <div role="alert" className="text-[13px] text-gypi-red">{error}</div>;
  if (!tablero) return <div className="gypi-dots" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gypi-dim mb-2">
        <span>Horas de jornada en cada etapa.</span>
        <span><span className="inline-block w-3 h-3 rounded-sm border-2 border-orange-500 align-middle mr-1" aria-hidden="true" />Avanza sin terminar la etapa anterior</span>
        <span><span className="inline-block w-3 h-3 rounded-sm border-2 border-purple-600 align-middle mr-1" aria-hidden="true" />Fuera del Gantt</span>
        <span>⏳ Esperando: terminó la etapa anterior y esta no empezó</span>
        <button type="button" onClick={leer} disabled={cargando} className="ml-auto bg-transparent border border-gypi-border rounded-lg px-2.5 min-h-[36px] text-xs font-semibold text-gypi-text cursor-pointer">
          {cargando ? "Actualizando…" : "🔄 Actualizar"}
        </button>
      </div>
      {/* Sin .fila-desliza (23/11): esconde la barra y no deja cortar el texto en renglones.
          En la computadora las 6 columnas se reparten el ancho; si no entran, barra para deslizar */}
      <div className="flex gap-2 overflow-x-auto pb-2 snap-x" role="list" aria-label="Trello de OT por etapa" data-tablero-etapas>
        {tablero.columnas.map((c) => (
          <section key={c.id} role="listitem" aria-label={c.nombre} data-columna={c.id}
            className="snap-start shrink-0 w-[78vw] max-w-[280px] md:shrink md:flex-1 md:w-auto md:min-w-[170px] md:max-w-none min-w-0 bg-gypi-surf-lo rounded-2xl border border-gypi-border p-2 flex flex-col">
            <div className="flex items-center gap-1.5 mb-2 px-0.5">
              <span className={`w-2.5 h-2.5 rounded-full ${COLOR_COLUMNA[c.id]}`} aria-hidden="true" />
              <h3 className="m-0 text-[14px] font-bold text-gypi-text font-heading flex-1">{c.nombre}</h3>
              <span className="text-xs font-bold text-gypi-dim" data-cantidad>{c.tarjetas.length}</span>
            </div>
            {c.id === "terminadas" && (
              <div className="text-xs text-gypi-dim mb-2 px-0.5">
                Últimos {DIAS_TERMINADAS} días.{c.promedios?.length ? " Promedios: " : ""}
                {(c.promedios || []).map((x) => `${x.nombre} ${fmtHoras(x.promedio)}`).join(" · ")}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              {c.tarjetas.length === 0 ? <div className="text-xs text-gypi-dim px-0.5 py-2">Ninguna OT.</div>
                : c.tarjetas.map((t) => <Tarjeta key={t.ot} t={t} onAbrir={setAbierta} />)}
            </div>
          </section>
        ))}
      </div>
      <Modal open={!!abierta} onClose={() => setAbierta(null)} title={abierta ? `OT ${abierta.ot} · registro de etapas` : ""}>
        {abierta && <Registro t={abierta} onVerDetalle={onVerDetalle ? (p) => { setAbierta(null); onVerDetalle(p); } : null} />}
      </Modal>
    </div>
  );
}
