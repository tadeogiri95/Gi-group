'use client';
// app/components/LeadTimeTab.jsx — Reportes → Lead time (seguimiento de OT
// por escaneo, parte 27): cuántos días tardaron producción, instalación y
// el total de las OT que terminaron en el período, con promedios por división.
// Por proceso y de la OT en horas de trabajo (Tadeo, 30/10;
// app/lib/leadTimeHoras.js).
import { useEffect, useMemo, useState } from "react";
import { sbGetAll } from "../lib/supabase";
import { leadTimes, resumenLeadTime } from "../lib/leadTime";
import { leadTimeProcesos, leadTimeDelPeriodo, ventanasDeGrilla, fmtHoras } from "../lib/leadTimeHoras";
import { etapasDelPlan } from "../lib/ganttPlan";
import { CLAVE_PLANIFICACION } from "../lib/planificacion";
import { buscarDivision } from "../lib/rutas";
import { fechaCorta } from "../lib/ot";
import { hoyArg } from "../lib/dates";
import Stat from "./ui/Stat";

const fmtDias = (d) => (d == null ? "—" : `${String(d).replace(".", ",")} ${d === 1 ? "día" : "días"}`);
const vacio = () => ({ data: [] });

export default function LeadTimeTab({ fechaDesde, fechaHasta, labelPeriodo, empresaId, divisiones = [], division = "todas" }) {
  const [filas, setFilas] = useState(null);
  const [crudo, setCrudo] = useState(null); // para el lead time por proceso, en horas de trabajo
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!empresaId) return;
    let vivo = true;
    (async () => {
      try {
        const e = empresaId;
        const [proyectos, piezas, etapas, cargas, bultos, actas, manual, empleados, cfg, etapasEmpresa] = await Promise.all([
          sbGetAll(`proyectos?empresa_id=eq.${e}&select=ot,cliente,proyecto,division,created_at,liberada_at,avance_manual&order=id.asc`, { maxFilas: 20000 })
            .catch(() => sbGetAll(`proyectos?empresa_id=eq.${e}&select=ot,cliente,proyecto,division,created_at,liberada_at&order=id.asc`, { maxFilas: 20000 })),
          // Sin las migraciones de cada parte, ese tramo queda sin dato
          sbGetAll(`v_avance_piezas?empresa_id=eq.${e}&select=ot,etapa,total,pasaron,primer_paso,ultimo_paso`, { maxFilas: 20000 }).catch(vacio),
          sbGetAll(`avance_etapas?empresa_id=eq.${e}&select=ot,etapa,estado,terminada_at,aprobada_at`, { maxFilas: 20000 }).catch(vacio),
          sbGetAll(`cargas_ot?empresa_id=eq.${e}&select=ot,firma_carga_at`).catch(vacio),
          sbGetAll(`bultos_ot?empresa_id=eq.${e}&cargado=eq.true&select=ot,cargado_at`, { maxFilas: 20000 }).catch(vacio),
          sbGetAll(`actas_ot?empresa_id=eq.${e}&firmada_at=not.is.null&select=ot,firmada_at`).catch(vacio),
          sbGetAll(`avance_manual_historial?empresa_id=eq.${e}&select=ot,etapa,pct,created_at&order=created_at.asc`, { maxFilas: 50000 }).catch(vacio),
          sbGetAll(`empleados?empresa_id=eq.${e}&activo=eq.true&rol=eq.operativo&select=id,rol,division,diagrama,activo,es_instalador,puesto_planta`, { maxFilas: 5000 }).catch(vacio),
          sbGetAll(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_PLANIFICACION}&select=valor`).catch(vacio),
          sbGetAll(`etapas?empresa_id=eq.${e}&activa=eq.true&order=orden.asc`).catch(vacio),
        ]);
        if (!vivo) return;
        setFilas(leadTimes({
          proyectos: proyectos.data, avancePiezas: piezas.data, avanceEtapas: etapas.data,
          cargas: cargas.data, bultos: bultos.data, actas: actas.data,
        }));
        setCrudo({ cfgValor: cfg.data[0]?.valor || null, etapas: etapasEmpresa.data, piezas: piezas.data, manual: manual.data,
          avance: etapas.data, proyectos: proyectos.data, empleados: empleados.data });
      } catch (err) {
        if (vivo) setError("No se pudo calcular el lead time.");
        console.error(err);
      }
    })();
    return () => { vivo = false; };
  }, [empresaId]);

  const horas = useMemo(() => crudo && leadTimeProcesos({
    etapasCodigo: etapasDelPlan(crudo.cfgValor, crudo.etapas, divisiones), piezas: crudo.piezas, manual: crudo.manual,
    avance: crudo.avance, proyectos: crudo.proyectos, ventanas: ventanasDeGrilla(crudo.empleados, divisiones, crudo.cfgValor),
  }), [crudo, divisiones]);

  const resumen = useMemo(() => {
    if (!filas || !fechaDesde || !fechaHasta) return null;
    const div = division === "todas" ? null : buscarDivision(divisiones, division);
    const deLaDivision = div ? filas.filter((f) => buscarDivision(divisiones, f.division)?.id === div.id) : filas;
    return resumenLeadTime(deLaDivision, { desde: fechaDesde, hasta: fechaHasta, divisiones });
  }, [filas, fechaDesde, fechaHasta, divisiones, division]);

  const enHoras = useMemo(() => {
    if (!horas || !filas || !fechaDesde || !fechaHasta) return null;
    const div = division === "todas" ? null : buscarDivision(divisiones, division);
    const datos = new Map(filas.map((f) => [f.ot, f]));
    const deLaDivision = div ? new Map([...horas].filter(([ot]) => buscarDivision(divisiones, datos.get(ot)?.division)?.id === div.id)) : horas;
    return leadTimeDelPeriodo(deLaDivision, { desde: fechaDesde, hasta: fechaHasta }, datos);
  }, [horas, filas, fechaDesde, fechaHasta, divisiones, division]);

  if (error) return <div role="alert" className="text-[13px] text-gypi-red">{error}</div>;
  if (!resumen) return <div className="gypi-dots" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>;

  return (
    <div>
      <p className="text-[12px] text-gypi-dim mt-0 mb-3">
        OT que terminaron cada tramo en {labelPeriodo}. Producción: de la liberación (o el primer escaneo) a la última pieza escaneada.
        Instalación: de la carga en el camión al acta firmada. Total: del alta de la OT al acta.
      </p>
      <section aria-label="Promedios de lead time" className="grid grid-cols-1 gap-2 mb-4">
        {resumen.tramos.map((t) => (
          <div key={t.clave}>
            <Stat value={fmtDias(t.promedio)} label={`${t.nombre} · promedio de ${t.cantidad === 1 ? "1 OT" : `${t.cantidad} OT`}`} />
            {t.porDivision.length > 1 && (
              <div className="text-xs text-gypi-dim mt-1 px-1">
                {t.porDivision.map((d) => `${d.nombre}: ${fmtDias(d.promedio)} (${d.cantidad})`).join(" · ")}
              </div>
            )}
          </div>
        ))}
      </section>

      {enHoras && (
        <section aria-label="Lead time por proceso" className="mb-4">
          <h3 className="m-0 mb-1 text-[14px] font-bold text-gypi-text font-heading">⏱ Por proceso, en horas de trabajo</h3>
          <p className="text-[12px] text-gypi-dim mt-0 mb-2">
            Procesos que llegaron al 100 % en {labelPeriodo}: desde su primer avance (escaneo o checkeo manual) hasta el 100 %. La OT completa va del primer avance
            de cualquier proceso hasta Armado al 100 %. Solo cuentan las horas en que trabaja la planta según la grilla de horarios.
          </p>
          {enHoras.ots.length === 0 ? (
            <div className="text-[13px] text-gypi-dim">Ningún proceso terminó en este período.</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 mb-2">
                {enHoras.promedios.map((x) => (
                  <Stat key={x.etapa} value={fmtHoras(x.promedio)} label={`${x.nombre} · promedio de ${x.cantidad === 1 ? "1 OT" : `${x.cantidad} OT`}`} />
                ))}
              </div>
              <div className="flex flex-col gap-1.5">
                {enHoras.ots.map((o) => (
                  <div key={o.ot} className="bg-gypi-surface rounded-xl p-3 border border-gypi-border" data-lead-horas={o.ot}>
                    <div className="text-[13px] truncate">
                      <span className="font-mono font-bold">OT {o.ot}</span>{o.cliente && <span className="text-gypi-dim"> · {o.cliente}</span>}
                      {o.horas != null && <span className="font-bold"> · terminada en {fmtHoras(o.horas)}</span>}
                    </div>
                    <div className="text-[12px] text-gypi-dim mt-1">{o.procesos.map((q) => `${q.nombre} ${fmtHoras(q.horas)}`).join(" · ")}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      <h3 className="m-0 mb-2 text-[14px] font-bold text-gypi-text font-heading">Por OT</h3>
      {resumen.ots.length === 0 ? (
        <div className="text-[13px] text-gypi-dim">Ninguna OT terminó producción ni instalación en este período.</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {resumen.ots.map((o) => (
            <div key={o.ot} className="bg-gypi-surface rounded-xl p-3 border border-gypi-border">
              <div className="text-[13px] truncate"><span className="font-mono font-bold">OT {o.ot}</span>{o.cliente && <span className="text-gypi-dim"> · {o.cliente}</span>}</div>
              <div className="text-[12px] text-gypi-dim mt-1">
                Producción {fmtDias(o.produccion)} · Instalación {fmtDias(o.instalacion)} · Total {fmtDias(o.total)}
              </div>
              {(o.finProduccion || o.finInstalacion) && (
                <div className="text-xs text-gypi-dim mt-0.5">
                  {[o.finProduccion && `Producción terminada ${fechaCorta(hoyArg(new Date(o.finProduccion)))}`, o.finInstalacion && `Acta ${fechaCorta(hoyArg(new Date(o.finInstalacion)))}`].filter(Boolean).join(" · ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
