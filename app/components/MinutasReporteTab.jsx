'use client';
// app/components/MinutasReporteTab.jsx — Reportes → 📝 Minutas (Minuta,
// parte M5): lo que dicen las minutas de la semana o del mes, todo junto.
// Solo para gerencia con el módulo Minutas (app/lib/minutasReporte.js).
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyArg } from "../lib/dates";
import { resumenMinutas, HORA_REUNION } from "../lib/minutasReporte";
import Stat from "./ui/Stat";

const fmtDias = (d) => (d == null ? "—" : `${String(d).replace(".", ",")} ${d === 1 ? "día" : "días"}`);

function Bloque({ titulo, children }) {
  return (
    <section aria-label={titulo} className="mb-4">
      <h3 className="m-0 mb-2 text-[14px] font-bold text-gypi-text font-heading">{titulo}</h3>
      {children}
    </section>
  );
}

function Fila({ izq, der, detalle }) {
  return (
    <div className="bg-gypi-surface rounded-xl p-3 border border-gypi-border">
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="min-w-0 truncate">{izq}</span>
        <span className="font-mono font-bold shrink-0">{der}</span>
      </div>
      {detalle && <div className="text-[12px] text-gypi-dim mt-1">{detalle}</div>}
    </div>
  );
}

const Vacio = ({ children }) => <div className="text-[13px] text-gypi-dim">{children}</div>;

export default function MinutasReporteTab({ fechaDesde, fechaHasta, labelPeriodo }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!fechaDesde || !fechaHasta) return;
    let vivo = true;
    setDatos(null);
    setError(null);
    apiFetch(`/api/minutas?reporte=${fechaDesde}&hasta=${fechaHasta}`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (vivo) (ok ? setDatos(j) : setError(j.error || "No se pudieron leer las minutas")); })
      .catch(() => { if (vivo) setError("No se pudieron leer las minutas"); });
    return () => { vivo = false; };
  }, [fechaDesde, fechaHasta]);

  const r = useMemo(() => (datos ? resumenMinutas({ minutas: datos.minutas || [], items: datos.items || [], hoy: hoyArg() }) : null), [datos]);

  if (error) return <div role="alert" className="text-[13px] text-gypi-red">{error}</div>;
  if (!r) return <div className="gypi-dots" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>;
  if (!r.reunion.cantidad) return <Vacio>No hay minutas guardadas en {labelPeriodo}.</Vacio>;

  const { reunion, otContingencias, otFoco, pendientes, feedback, compras } = r;
  return (
    <div>
      <p className="text-[12px] text-gypi-dim mt-0 mb-3">Lo que se anotó en las minutas de Buenos Días de {labelPeriodo}.</p>

      <Bloque titulo="Reunión">
        <div className="grid grid-cols-2 gap-2 mb-2">
          <Stat value={reunion.cantidad} label={reunion.cantidad === 1 ? "Reunión" : "Reuniones"} />
          <Stat value={reunion.duracionPromedio == null ? "—" : `${reunion.duracionPromedio} min`} label="Duración promedio" />
          <Stat value={reunion.conInicio ? `${reunion.aHorario} de ${reunion.conInicio}` : "—"} label={`Empezaron a horario (${HORA_REUNION})`}
            tone={reunion.conInicio && reunion.aHorario < reunion.conInicio ? "atencion" : "bien"} />
        </div>
        {reunion.asistencia.length > 0 && (
          <div className="text-[12px] text-gypi-dim px-1">
            Asistencia: {reunion.asistencia.map((a) => `${a.nombre} ${a.veces}/${reunion.cantidad}`).join(" · ")}
          </div>
        )}
      </Bloque>

      <Bloque titulo="OT con más contingencias">
        {otContingencias.length === 0 ? <Vacio>Ninguna OT estuvo en amarillo o rojo.</Vacio> : (
          <div className="flex flex-col gap-1.5">
            {otContingencias.slice(0, 15).map((o) => (
              <Fila key={o.ot}
                izq={<><span className="font-mono font-bold">OT {o.ot}</span>{(o.proyecto || o.cliente) && <span className="text-gypi-dim"> · {[o.proyecto, o.cliente].filter(Boolean).join(" · ")}</span>}</>}
                der={fmtDias(o.dias)} detalle={o.diasRojo ? `🔴 ${fmtDias(o.diasRojo)} en rojo` : "🟡 solo en amarillo"} />
            ))}
          </div>
        )}
        {otFoco.length > 0 && (
          <div className="text-[12px] text-gypi-dim mt-2 px-1">
            Se repiten en el foco: {otFoco.map((f) => `OT ${f.ot} (${f.veces} veces)`).join(" · ")}
          </div>
        )}
      </Bloque>

      <Bloque titulo="Pendientes por responsable">
        {pendientes.length === 0 ? <Vacio>No hubo pendientes en este período.</Vacio> : (
          <div className="flex flex-col gap-1.5">
            {pendientes.map((p) => (
              <Fila key={p.responsable} izq={<span className="font-semibold">{p.responsable}</span>}
                der={`${p.abiertos} abierto${p.abiertos !== 1 ? "s" : ""}`}
                detalle={[
                  p.vencidos ? `⏰ ${p.vencidos} vencido${p.vencidos !== 1 ? "s" : ""}` : "",
                  `${p.resueltos} resuelto${p.resueltos !== 1 ? "s" : ""}`,
                  p.diasPromedio != null ? `tarda ${fmtDias(p.diasPromedio)} en promedio` : "",
                ].filter(Boolean).join(" · ")} />
            ))}
          </div>
        )}
      </Bloque>

      <Bloque titulo="Feedback por área">
        {feedback.total === 0 ? <Vacio>No hubo feedback en este período.</Vacio> : (
          <>
            <div className="flex flex-col gap-1.5">
              {feedback.porArea.map((a) => (
                <Fila key={a.area} izq={<span className="font-semibold">{a.area}</span>} der={a.total}
                  detalle={Object.entries(a.tipos).map(([t, n]) => `${t}: ${n}`).join(" · ")} />
              ))}
            </div>
            <div className="text-[12px] text-gypi-dim mt-2 px-1">Por tipo: {feedback.porTipo.map((t) => `${t.tipo} ${t.n}`).join(" · ")}</div>
          </>
        )}
      </Bloque>

      <Bloque titulo="Compras disparadas desde la minuta">
        <div className="grid grid-cols-3 gap-2">
          <Stat value={compras.total} label="Compras" />
          <Stat value={compras.urgentes} label="Urgentes" tone={compras.urgentes ? "atencion" : "bien"} />
          <Stat value={compras.conPedido} label="Con pedido en Compras" />
        </div>
      </Bloque>
    </div>
  );
}
