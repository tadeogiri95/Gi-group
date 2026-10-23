'use client';
// app/components/Indicadores.jsx — Indicadores de producción del período
// (Órdenes de Producción, parte 7; ítem 39): minutos por unidad de cada
// etapa, horas por módulo, tiempo parado por causa, retrabajo, no
// conformidades, horas por OT y OT atrasadas. Es lo que pide la revisión
// semanal del mapa de procesos. Mide el proceso, no a las personas. Desde la
// parte 8, para el dueño (costoHora), el costo de mano de obra. Sin el
// registro de tareas (conTareas, 2026-10) quedan solo calidad y OT atrasadas:
// lo demás se calcula con las tareas y saldría vacío.
import { useEffect, useMemo, useState } from "react";
import { sbGetAll } from "../lib/supabase";
import { calcularIndicadores, fmtPorUnidad, singular } from "../lib/indicadores";
import { fmtHoras } from "../lib/detalleOp";
import { fechaCorta } from "../lib/ot";
import { hoyArg } from "../lib/dates";
import { exportCSV } from "../lib/exportarReporte";
import { costoDe, fmtPesos } from "../lib/costo";
import Stat from "./ui/Stat";

const fmtPct = (n) => `${Number(n).toLocaleString("es-AR")} %`;

function Seccion({ titulo, children }) {
  return (
    <section aria-label={titulo} className="mb-4">
      <div className="g-label mb-1.5">{titulo}</div>
      {children}
    </section>
  );
}

function Fila({ izquierda, abajo, derecha }) {
  return (
    <div className="flex items-center gap-2 bg-gypi-surface rounded-xl p-3 border border-gypi-border">
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-bold truncate">{izquierda}</div>
        {abajo && <div className="text-[11px] text-gypi-dim">{abajo}</div>}
      </div>
      <div className="text-[13px] font-bold text-right shrink-0">{derecha}</div>
    </div>
  );
}

function Vacio({ children }) {
  return <div className="text-[13px] text-gypi-dim">{children}</div>;
}

/** Las 0 h de un día en Argentina, para filtrar created_at (sin esto el día cortaba a las 21 h). */
function inicioDiaArg(fecha) {
  return encodeURIComponent(`${fecha}T00:00:00-03:00`);
}

/** Día siguiente a una fecha "AAAA-MM-DD" (para filtrar created_at hasta el final del día). */
function diaSiguiente(fecha) {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function Indicadores({ fechaDesde, fechaHasta, labelPeriodo, empresaId, etapas = [], causas = [], defectos = [], costoHora = null, conTareas = true }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!fechaDesde || !fechaHasta || !empresaId) return;
    let vivo = true;
    (async () => {
      try {
        const [tareas, ncs, proyectos] = await Promise.all([
          conTareas
            ? sbGetAll(`registro_actividades?empresa_id=eq.${empresaId}&fecha=gte.${fechaDesde}&fecha=lte.${fechaHasta}&select=etapa,causa,tipo,codigo_proyecto,cantidad,duracion_min,hora_inicio,hora_fin`, { maxFilas: 20000 })
            : { data: [] },
          // Sin la migración 101 no hay tabla: los indicadores siguen sin calidad
          sbGetAll(`no_conformidades?empresa_id=eq.${empresaId}&created_at=gte.${inicioDiaArg(fechaDesde)}&created_at=lt.${inicioDiaArg(diaSiguiente(fechaHasta))}&select=defecto,cantidad,etapa_origen,decision,minutos_retrabajo`).catch(() => ({ data: [] })),
          sbGetAll(`proyectos?empresa_id=eq.${empresaId}&select=ot,cliente,proyecto,total_modulos,fecha_entrega,estado,terminado_planilla`, { maxFilas: 20000 }),
        ]);
        if (!vivo) return;
        setDatos({ tareas: tareas.data || [], truncado: tareas.truncado, noConformidades: ncs.data || [], proyectos: proyectos.data || [] });
        setError(null);
      } catch (e) {
        console.error(e);
        if (vivo) setError("No se pudieron cargar los indicadores.");
      }
    })();
    return () => { vivo = false; };
  }, [fechaDesde, fechaHasta, empresaId, conTareas]);

  const ind = useMemo(
    () => (datos ? calcularIndicadores({ ...datos, etapas, causas, defectos, hoy: hoyArg() }) : null),
    [datos, etapas, causas, defectos]
  );

  // Solo llega con valor para el dueño (useCostoHora)
  const conCosto = conTareas && Number(costoHora) > 0;
  const pesos = (min) => costoDe(min, costoHora);
  const costoOt = (o) => pesos(o.min + o.paradaMin);

  if (error) return <div role="alert" className="text-sm text-gypi-red">{error}</div>;
  if (!ind) return <div className="gypi-dots" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>;

  const exportar = () => {
    const filas = [["Indicador", "Detalle", "Valor"]];
    if (conTareas) {
      filas.push(["Horas trabajadas", labelPeriodo, fmtHoras(ind.productivoMin)]);
      filas.push(["Tiempo parado", fmtHoras(ind.paradoMin), fmtPct(ind.paradoPct)]);
      filas.push(["Retrabajo", fmtHoras(ind.retrabajoMin), fmtPct(ind.retrabajoPct)]);
      for (const e of ind.etapas) {
        filas.push([`Etapa ${e.nombre}`, e.unidad ? `${Number(e.cantidad.toFixed(2))} ${e.unidad}` : "sin unidad", e.minPorUnidad != null ? `${fmtPorUnidad(e.minPorUnidad)} por ${singular(e.unidad)}` : fmtHoras(e.min)]);
      }
      for (const p of ind.paradas) filas.push([`Parada ${p.causa}`, p.nombre, fmtPct(p.pct)]);
    }
    for (const d of ind.calidad.porDefecto) filas.push([`Defecto ${d.clave}`, d.nombre, d.piezas]);
    if (conCosto) {
      filas.push(["Costo de la hora", "", fmtPesos(costoHora)]);
      filas.push(["Costo fábrica", fmtHoras(ind.productivoMin - ind.instalacionMin), fmtPesos(pesos(ind.productivoMin - ind.instalacionMin))]);
      filas.push(["Costo paradas", fmtHoras(ind.paradoMin), fmtPesos(pesos(ind.paradoMin))]);
      filas.push(["Costo instalación", fmtHoras(ind.instalacionMin), fmtPesos(pesos(ind.instalacionMin))]);
      filas.push(["Costo total", "", fmtPesos(pesos(ind.productivoMin + ind.paradoMin))]);
    }
    if (conTareas) for (const o of ind.ots) filas.push([`OT ${o.ot}`, o.cliente, conCosto ? `${fmtHoras(o.min)} · ${fmtPesos(costoOt(o))}` : fmtHoras(o.min)]);
    for (const o of ind.atrasadas) filas.push([`Atrasada OT ${o.ot}`, o.cliente, `${o.dias} días`]);
    exportCSV(filas, `indicadores_${fechaDesde}_${fechaHasta}.csv`);
  };

  return (
    <div>
      <section aria-label="Resumen de indicadores" className="grid grid-cols-2 gap-2 mb-3.5">
        {conTareas ? <>
          <Stat value={fmtHoras(ind.productivoMin)} label="Horas trabajadas" />
          <Stat value={fmtPct(ind.paradoPct)} label="Tiempo parado" tone={ind.paradoPct > 15 ? "mal" : ind.paradoPct > 5 ? "atencion" : "bien"} />
          <Stat value={fmtPct(ind.retrabajoPct)} label="Retrabajo" tone={ind.retrabajoPct > 10 ? "mal" : ind.retrabajoPct > 3 ? "atencion" : "bien"} />
        </> : <Stat value={ind.calidad.piezas} label="Piezas no conformes" tone={ind.calidad.piezas ? "atencion" : "bien"} />}
        <Stat value={ind.atrasadas.length} label="OT atrasadas" tone={ind.atrasadas.length ? "mal" : "bien"} />
      </section>

      {datos.truncado && (
        <div role="alert" className="p-3 rounded-[10px] text-[13px] mb-3.5 bg-gypi-amber/10 border border-gypi-amber/20 text-gypi-amber-ink">
          ⚠ El período tiene demasiadas tareas y los números están incompletos. Acotá las fechas.
        </div>
      )}

      <button onClick={exportar} className="w-full min-h-11 py-2.5 px-4 rounded-xl border border-gypi-border bg-gypi-surface text-[13px] font-bold text-gypi-text cursor-pointer mb-3.5">
        📥 Descargar indicadores (Excel)
      </button>

      {conCosto && (
        <Seccion titulo="Costo de mano de obra (solo lo ves vos)">
          <div className="flex flex-col gap-1.5">
            <Fila izquierda="Fábrica" abajo={fmtHoras(ind.productivoMin - ind.instalacionMin)} derecha={fmtPesos(pesos(ind.productivoMin - ind.instalacionMin))} />
            {ind.paradoMin > 0 && <Fila izquierda="Paradas" abajo={fmtHoras(ind.paradoMin)} derecha={fmtPesos(pesos(ind.paradoMin))} />}
            {ind.instalacionMin > 0 && <Fila izquierda="Instalación" abajo={fmtHoras(ind.instalacionMin)} derecha={fmtPesos(pesos(ind.instalacionMin))} />}
            <Fila izquierda="Total del período" abajo={`A ${fmtPesos(costoHora)} la hora`} derecha={fmtPesos(pesos(ind.productivoMin + ind.paradoMin))} />
          </div>
        </Seccion>
      )}

      {conTareas && <>
      <Seccion titulo="Tiempo por unidad en cada etapa">
        {ind.etapas.length === 0 ? <Vacio>No hay tareas en este período.</Vacio> : (
          <div className="flex flex-col gap-1.5">
            {ind.etapas.map((e) => (
              <Fila key={e.codigo}
                izquierda={`${e.icon ? `${e.icon} ` : ""}${e.nombre}`}
                abajo={[
                  `${fmtHoras(e.min)} trabajadas`,
                  e.unidad && e.cantidad > 0 && `${Number(e.cantidad.toFixed(2))} ${e.unidad}`,
                  e.unidad && e.sinCantidadPct > 0 && `${e.sinCantidadPct} % de las horas sin cantidad anotada`,
                  !e.unidad && "sin unidad (se carga en Configuración → Etapas)",
                ].filter(Boolean).join(" · ")}
                derecha={e.minPorUnidad != null ? `${fmtPorUnidad(e.minPorUnidad)} por ${singular(e.unidad)}` : "—"}
              />
            ))}
          </div>
        )}
      </Seccion>

      <Seccion titulo="Tiempo parado por causa">
        {ind.paradas.length === 0 ? <Vacio>Sin paradas en este período.</Vacio> : (
          <div className="flex flex-col gap-1.5">
            {ind.paradas.map((p) => (
              <Fila key={p.causa} izquierda={`${p.causa} · ${p.nombre}`} abajo={`${fmtHoras(p.min)} · ${p.veces === 1 ? "1 vez" : `${p.veces} veces`}`} derecha={fmtPct(p.pct)} />
            ))}
          </div>
        )}
      </Seccion>

      </>}

      <Seccion titulo={conTareas ? "Retrabajo y calidad" : "Calidad"}>
        <div className="flex flex-col gap-1.5">
          {conTareas && ind.retrabajos.map((r) => (
            <Fila key={r.tipo} izquierda={r.nombre} abajo={r.veces === 1 ? "1 tarea" : `${r.veces} tareas`} derecha={fmtHoras(r.min)} />
          ))}
          {ind.calidad.registros === 0 ? (
            <Vacio>Sin piezas no conformes registradas en este período.</Vacio>
          ) : (<>
            <Fila izquierda="Piezas no conformes" abajo={[ind.calidad.sinDecidir && `${ind.calidad.sinDecidir} sin decidir`, ind.calidad.minutosRetrabajo && `${fmtHoras(ind.calidad.minutosRetrabajo)} de retrabajo anotado`].filter(Boolean).join(" · ") || null} derecha={ind.calidad.piezas} />
            {ind.calidad.porDefecto.slice(0, 5).map((d) => (
              <Fila key={d.clave} izquierda={`${d.clave} · ${d.nombre}`} derecha={d.piezas} />
            ))}
            {ind.calidad.porOrigen.length > 0 && (
              <div className="text-[12px] text-gypi-dim px-1">Dónde se originan: {ind.calidad.porOrigen.map((o) => `${o.nombre} ${o.piezas}`).join(" · ")}</div>
            )}
            {ind.calidad.porDecision.length > 0 && (
              <div className="text-[12px] text-gypi-dim px-1">Decisiones: {ind.calidad.porDecision.map((d) => `${d.icon} ${d.nombre} ${d.piezas}`).join(" · ")}</div>
            )}
          </>)}
        </div>
      </Seccion>

      {conTareas && (
      <Seccion titulo="Horas por OT en el período">
        {ind.ots.length === 0 ? <Vacio>No hay horas cargadas a OT en este período.</Vacio> : (
          <div className="flex flex-col gap-1.5">
            {ind.ots.slice(0, 20).map((o) => (
              <Fila key={o.ot} izquierda={`OT ${o.ot}${o.cliente ? ` · ${o.cliente}` : ""}`}
                abajo={[
                  o.totalModulos && `${o.modulosHechos ? `${o.modulosHechos} de ${o.totalModulos} módulos` : `${o.totalModulos} módulos`} · ${fmtPorUnidad(o.minPorModulo)} por módulo`,
                  conCosto && `Costo ${fmtPesos(costoOt(o))}`,
                ].filter(Boolean).join(" · ") || null}
                derecha={fmtHoras(o.min)} />
            ))}
            {ind.ots.length > 20 && <Vacio>Y {ind.ots.length - 20} OT más (están en el Excel).</Vacio>}
          </div>
        )}
      </Seccion>
      )}

      <Seccion titulo="OT atrasadas">
        {ind.atrasadas.length === 0 ? <Vacio>Ninguna OT abierta tiene la entrega vencida.</Vacio> : (
          <div className="flex flex-col gap-1.5">
            {ind.atrasadas.map((o) => (
              <Fila key={o.ot} izquierda={`OT ${o.ot}${o.cliente ? ` · ${o.cliente}` : ""}`} abajo={`Entrega ${fechaCorta(o.fecha_entrega)}`} derecha={o.dias === 1 ? "1 día" : `${o.dias} días`} />
            ))}
          </div>
        )}
      </Seccion>
    </div>
  );
}
