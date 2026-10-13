'use client';
// app/components/DetalleOp.jsx — Detalle de una orden de producción
// (Órdenes de Producción, parte 3; ítem 39). Solo lectura: horas por etapa,
// quién trabajó y retrabajos, con las tareas que ya se registran.
import { useEffect, useMemo, useState } from "react";
import { sb, sbGetAll } from "../lib/supabase";
import { resumirOp, fmtHoras } from "../lib/detalleOp";
import { buscarDivision } from "../lib/rutas";
import { fechaCorta } from "../lib/ot";

function Dato({ label, valor }) {
  return (
    <div className="bg-gypi-surface rounded-xl p-3 border border-gypi-border">
      <div className="text-[11px] text-gypi-dim">{label}</div>
      <div className="text-base font-bold text-gypi-text mt-0.5">{valor}</div>
    </div>
  );
}

function Barra({ pct }) {
  // Ancho en pasos de 10 % con clases fijas (sin estilos sueltos)
  const pasos = ["w-0", "w-[10%]", "w-[20%]", "w-[30%]", "w-[40%]", "w-1/2", "w-[60%]", "w-[70%]", "w-[80%]", "w-[90%]", "w-full"];
  const i = Math.max(0, Math.min(10, Math.round(pct / 10)));
  return (
    <div className="h-2 rounded bg-gypi-surf-hi overflow-hidden mt-1.5">
      <div className={`h-full rounded bg-gypi-amber ${pasos.at(i)}`} />
    </div>
  );
}

export default function DetalleOp({ proyecto, empresaId, etapas = [], divisiones = [], onClose }) {
  const [tareas, setTareas] = useState(null);
  const [empleados, setEmpleados] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!proyecto?.ot || !empresaId) return;
    let vivo = true;
    (async () => {
      try {
        const ot = encodeURIComponent(proyecto.ot);
        const [regs, emps] = await Promise.all([
          sbGetAll(`registro_actividades?empresa_id=eq.${empresaId}&codigo_proyecto=eq.${ot}&etapa=gt.0&select=id,empleado_id,legajo,fecha,hora_inicio,hora_fin,etapa,tipo,duracion_min&order=hora_inicio.asc`),
          sb.get(`empleados?empresa_id=eq.${empresaId}&select=id,legajo,nombre,apodo`).catch(() => []),
        ]);
        if (!vivo) return;
        setTareas(regs.data || []);
        setEmpleados(emps || []);
      } catch (e) {
        if (vivo) setError("No se pudieron cargar las tareas de esta OT.");
        console.error(e);
      }
    })();
    return () => { vivo = false; };
  }, [proyecto?.ot, empresaId]);

  const division = buscarDivision(divisiones, proyecto?.division);
  const resumen = useMemo(
    () => (tareas ? resumirOp(tareas, { etapas, division, empleados }) : null),
    [tareas, etapas, division, empleados]
  );
  const maxEtapa = resumen ? Math.max(1, ...resumen.etapas.map((e) => e.min)) : 1;

  return (
    <div className="fixed inset-0 z-200 flex items-end justify-center" role="dialog" aria-label={`Detalle de la OT ${proyecto?.ot}`}>
      <div onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-[560px] bg-gypi-bg rounded-t-[20px] p-[20px_18px_30px] max-h-[90vh] overflow-y-auto border border-gypi-border text-gypi-text">
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <div className="g-overline text-gypi-amber-ink">Orden {proyecto?.ot}</div>
            <h3 className="m-0 font-heading text-lg font-bold truncate">{proyecto?.cliente || proyecto?.proyecto || "—"}</h3>
            <div className="text-xs text-gypi-dim mt-0.5">
              {[proyecto?.obra, proyecto?.descripcion, division?.label || proyecto?.division].filter(Boolean).join(" · ")}
            </div>
            {(proyecto?.fecha_entrega || proyecto?.cantidad != null) && (
              <div className="text-xs text-gypi-dim mt-0.5">
                {[proyecto?.fecha_entrega && `Entrega ${fechaCorta(proyecto.fecha_entrega)}`, proyecto?.cantidad != null && `Cantidad ${proyecto.cantidad}`].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="min-w-[44px] min-h-[44px] bg-transparent border-none text-2xl cursor-pointer text-gypi-text">✕</button>
        </div>

        {error ? (
          <div role="alert" className="text-sm text-gypi-red">{error}</div>
        ) : !resumen ? (
          <div className="gypi-dots py-6"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>
        ) : resumen.tareas === 0 ? (
          <div className="text-sm text-gypi-dim py-4">Todavía nadie registró tareas en esta OT.</div>
        ) : (<>
          <div className="grid grid-cols-3 gap-2 mb-4">
            <Dato label="Horas trabajadas" valor={fmtHoras(resumen.totalMin)} />
            <Dato label="Personas" valor={resumen.personas.length} />
            <Dato label="Días" valor={resumen.dias} />
          </div>
          {resumen.desde && (
            <div className="text-xs text-gypi-dim mb-3">
              {resumen.desde === resumen.hasta ? `Trabajada el ${fechaCorta(resumen.desde)}` : `Del ${fechaCorta(resumen.desde)} al ${fechaCorta(resumen.hasta)}`}
              {resumen.ahoraTrabajando.length > 0 && ` · Ahora: ${resumen.ahoraTrabajando.join(", ")}`}
            </div>
          )}

          <div className="g-label mb-1.5">Horas por etapa</div>
          <div className="flex flex-col gap-1.5 mb-4">
            {resumen.etapas.map((e) => (
              <div key={e.codigo} className="bg-gypi-surface rounded-xl p-3 border border-gypi-border">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{e.icon}</span>
                  <span className="flex-1 min-w-0 text-[13px] font-bold truncate">{e.nombre}</span>
                  <span className="text-[13px] font-bold">{fmtHoras(e.min)}</span>
                </div>
                <Barra pct={(e.min / maxEtapa) * 100} />
                <div className="text-[11px] text-gypi-dim mt-1">
                  {e.personas.length ? e.personas.join(", ") : "Sin tareas todavía"}
                  {e.retrabajoMin > 0 && ` · ${fmtHoras(e.retrabajoMin)} de retrabajo`}
                  {resumen.tieneRuta && !e.enRuta && " · fuera de la ruta"}
                </div>
              </div>
            ))}
          </div>

          <div className="g-label mb-1.5">Quién trabajó</div>
          <div className="flex flex-col gap-1.5 mb-4">
            {resumen.personas.map((p) => (
              <div key={p.nombre} className="flex items-center gap-2 bg-gypi-surface rounded-xl p-3 border border-gypi-border">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold truncate">{p.nombre}</div>
                  <div className="text-[11px] text-gypi-dim truncate">{p.etapas.join(", ")}</div>
                </div>
                <span className="text-[13px] font-bold">{fmtHoras(p.min)}</span>
              </div>
            ))}
          </div>

          <div className="g-label mb-1.5">Retrabajos</div>
          {resumen.retrabajos.length === 0 ? (
            <div className="text-[13px] text-gypi-dim mb-4">Sin retrabajos registrados.</div>
          ) : (
            <div className="flex flex-col gap-1.5 mb-4">
              {resumen.retrabajos.map((r) => (
                <div key={r.tipo} className="flex items-center gap-2 bg-gypi-surface rounded-xl p-3 border border-gypi-border">
                  <span className="flex-1 text-[13px] font-bold">{r.nombre}</span>
                  <span className="text-[11px] text-gypi-dim">{r.veces === 1 ? "1 vez" : `${r.veces} veces`}</span>
                  <span className="text-[13px] font-bold">{fmtHoras(r.min)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="text-[11px] text-gypi-dim">Las paradas (falta material, herramienta, etc.) no se cargan con OT, por eso no aparecen acá.</div>
        </>)}
      </div>
    </div>
  );
}
