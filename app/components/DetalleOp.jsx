'use client';
// app/components/DetalleOp.jsx — Detalle de una orden de producción
// (Órdenes de Producción, parte 3; ítem 39). Solo lectura: horas por etapa,
// quién trabajó y retrabajos, con las tareas que ya se registran. Desde la
// parte 4 también la cantidad hecha por etapa y las paradas en la OT; desde
// la parte 6, los módulos hechos contra el total y las no conformidades; desde
// la parte 8, el costo de mano de obra (solo el dueño, con costoHora); desde
// la parte 9, cuántos sueltos hay y cuántos están en acopio y cargados; desde
// la parte 10, los bultos cargados y si la carga está firmada; desde Stock
// parte 16, el material necesario contra el retirado.
import { useEffect, useMemo, useState } from "react";
import { sb, sbGetAll } from "../lib/supabase";
import { resumirOp, fmtHoras } from "../lib/detalleOp";
import { buscarDivision } from "../lib/rutas";
import { fechaCorta } from "../lib/ot";
import { esEtapaDeModulos, textoModulos, nombreDefecto, nombreDecision } from "../lib/calidad";
import { costoOp, fmtPesos } from "../lib/costo";
import { resumenSueltos } from "../lib/sueltos";
import { avancePiezas, textoAvancePiezas, reglasPieza, nombresEtapas } from "../lib/piezas";
import { estadoCarga } from "../lib/carga";
import { estadoActa, NOMBRE_ESTADO_ACTA } from "../lib/acta";
import MaterialOt from "./MaterialOt";

// 4.5 → "4,5 min"; 95 → "1 h 35 min"
function fmtPorUnidad(min) {
  return min < 60 ? `${Number(min.toFixed(1)).toLocaleString("es-AR")} min` : fmtHoras(min);
}

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

export default function DetalleOp({ proyecto, empresaId, etapas = [], divisiones = [], causas = [], defectos = [], costoHora = null, onClose }) {
  const [tareas, setTareas] = useState(null);
  const [noConformes, setNoConformes] = useState([]);
  const [sueltos, setSueltos] = useState([]);
  const [piezas, setPiezas] = useState({ piezas: [], pasos: [] });
  const [carga, setCarga] = useState({ bultos: [], fila: null });
  const [acta, setActa] = useState({ fila: null, pendientes: [] });
  const [empleados, setEmpleados] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!proyecto?.ot || !empresaId) return;
    let vivo = true;
    (async () => {
      try {
        const ot = encodeURIComponent(proyecto.ot);
        const [regs, emps, ncs, sts, bultos, cargas, actas, pendientes, pzs, pasos] = await Promise.all([
          sbGetAll(`registro_actividades?empresa_id=eq.${empresaId}&codigo_proyecto=eq.${ot}&select=id,empleado_id,legajo,fecha,hora_inicio,hora_fin,etapa,tipo,causa,cantidad,duracion_min&order=hora_inicio.asc`),
          sb.get(`empleados?empresa_id=eq.${empresaId}&select=id,legajo,nombre,apodo`).catch(() => []),
          // Sin la migración 101 no hay tabla: el detalle sigue sin ese dato
          sb.get(`no_conformidades?empresa_id=eq.${empresaId}&ot=eq.${ot}&select=id,defecto,cantidad,pieza,decision,minutos_retrabajo,created_at&order=created_at.desc`).catch(() => []),
          // Sin la migración 103, igual
          sb.get(`sueltos_ot?empresa_id=eq.${empresaId}&ot=eq.${ot}&select=id,acopio,carga`).catch(() => []),
          // Sin la migración 104, igual
          sb.get(`bultos_ot?empresa_id=eq.${empresaId}&ot=eq.${ot}&select=id,cargado`).catch(() => []),
          sb.get(`cargas_ot?empresa_id=eq.${empresaId}&ot=eq.${ot}&select=faltantes,firma_carga_por,firma_instalacion_por&limit=1`).catch(() => []),
          // Sin la migración 105, igual
          sb.get(`actas_ot?empresa_id=eq.${empresaId}&ot=eq.${ot}&select=firmada_at,cliente_nombre&limit=1`).catch(() => []),
          sb.get(`pendientes_obra?empresa_id=eq.${empresaId}&ot=eq.${ot}&select=id,resuelto`).catch(() => []),
          // Sin las migraciones 109 y 110 (piezas con QR), igual
          sbGetAll(`piezas_ot?empresa_id=eq.${empresaId}&ot=eq.${ot}&select=id,etapas&order=id.asc`).then((r) => r.data || []).catch(() => []),
          sbGetAll(`pasos_pieza?empresa_id=eq.${empresaId}&ot=eq.${ot}&select=pieza_id,etapa&order=id.asc`).then((r) => r.data || []).catch(() => []),
        ]);
        if (!vivo) return;
        setNoConformes(ncs || []);
        setSueltos(sts || []);
        setPiezas({ piezas: Array.isArray(pzs) ? pzs : [], pasos: Array.isArray(pasos) ? pasos : [] });
        setCarga({ bultos: bultos || [], fila: cargas?.[0] || null });
        setActa({ fila: actas?.[0] || null, pendientes: pendientes || [] });
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
    () => (tareas ? resumirOp(tareas, { etapas, division, empleados, causas }) : null),
    [tareas, etapas, division, empleados, causas]
  );
  const maxEtapa = resumen ? Math.max(1, ...resumen.etapas.map((e) => e.min)) : 1;
  const costo = useMemo(() => costoOp(resumen, costoHora), [resumen, costoHora]);
  const resSueltos = resumenSueltos(sueltos);
  const textoPiezas = piezas.piezas.length
    ? textoAvancePiezas(avancePiezas(piezas.piezas, piezas.pasos, reglasPieza(etapas).map((r) => r.codigo)), nombresEtapas(etapas))
    : "";
  const resCarga = estadoCarga({ bultos: carga.bultos, carga: carga.fila });
  const resActa = estadoActa({ acta: acta.fila, pendientes: acta.pendientes });

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
            {(proyecto?.fecha_entrega || proyecto?.cantidad != null || proyecto?.total_modulos) && (
              <div className="text-xs text-gypi-dim mt-0.5">
                {[proyecto?.fecha_entrega && `Entrega ${fechaCorta(proyecto.fecha_entrega)}`, proyecto?.cantidad != null && `Cantidad ${proyecto.cantidad}`, proyecto?.total_modulos && `${proyecto.total_modulos} módulos`].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="min-w-[44px] min-h-[44px] bg-transparent border-none text-2xl cursor-pointer text-gypi-text">✕</button>
        </div>

        {textoPiezas && (
          <div className="text-xs text-gypi-dim mb-3">🧩 Piezas escaneadas ({piezas.piezas.length}): {textoPiezas}</div>
        )}

        {resSueltos.total > 0 && (
          <div className="text-xs text-gypi-dim mb-3">📦 Sueltos: {resSueltos.total === 1 ? "1 ítem" : `${resSueltos.total} ítems`} · Acopio {resSueltos.acopio} de {resSueltos.total} · Carga {resSueltos.carga} de {resSueltos.total}</div>
        )}

        {resCarga.bultos > 0 && (
          <div className="text-xs text-gypi-dim mb-3">🚚 Carga: {resCarga.firmada ? `firmada${resCarga.conFaltantes ? ", con faltantes" : ""}` : `${resCarga.bultosCargados} de ${resCarga.bultos} bultos cargados${resCarga.empezada ? " · falta una firma" : ""}`}</div>
        )}

        {NOMBRE_ESTADO_ACTA[resActa.estado] && (
          <div className="text-xs text-gypi-dim mb-3">{NOMBRE_ESTADO_ACTA[resActa.estado]}{resActa.firmada ? ` · acta firmada por ${acta.fila.cliente_nombre}` : ""}{resActa.abiertos ? ` · ${resActa.abiertos === 1 ? "1 pendiente" : `${resActa.abiertos} pendientes`}` : ""}</div>
        )}

        <MaterialOt ot={proyecto?.ot} empresaId={empresaId} />

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

          {costo && (
            <section aria-label="Costo de mano de obra" className="mb-4">
              <div className="g-label mb-1.5">Costo de mano de obra (solo lo ves vos)</div>
              <div className="bg-gypi-surface rounded-xl p-3 border border-gypi-border">
                {[
                  ["Fábrica", costo.fabricaMin, costo.fabrica],
                  ["Paradas en esta OT", costo.paradaMin, costo.paradas],
                  ["Instalación", costo.instalacionMin, costo.instalacion],
                ].filter(([, min], i) => i === 0 || min > 0).map(([nombre, min, pesos]) => (
                  <div key={nombre} className="flex items-center gap-2 text-[13px] py-0.5">
                    <span className="flex-1">{nombre}</span>
                    <span className="text-[11px] text-gypi-dim">{fmtHoras(min)}</span>
                    <span className="w-24 text-right font-bold">{fmtPesos(pesos)}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2 text-[14px] font-bold border-t border-gypi-border mt-1.5 pt-1.5">
                  <span className="flex-1">Total</span>
                  <span className="w-24 text-right">{fmtPesos(costo.total)}</span>
                </div>
              </div>
              <div className="text-[11px] text-gypi-dim mt-1">A {fmtPesos(costoHora)} la hora. Se cambia en Configuración → Costo.</div>
            </section>
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
                {e.unidad && (e.cantidad > 0 || (esEtapaDeModulos(e) && proyecto?.total_modulos)) && (
                  <div className="text-[11px] text-gypi-dim mt-0.5">
                    {esEtapaDeModulos(e) && proyecto?.total_modulos
                      ? `${textoModulos(e.cantidad, proyecto.total_modulos)} ${e.unidad}`
                      : `${Number(e.cantidad.toFixed(2))} ${e.unidad}`}
                    {e.minPorUnidad != null && ` · ${fmtPorUnidad(e.minPorUnidad)} por ${e.unidad}`}
                  </div>
                )}
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
          <div className="g-label mb-1.5">Paradas en esta OT</div>
          {resumen.paradas.length === 0 ? (
            <div className="text-[13px] text-gypi-dim mb-4">Sin paradas registradas en esta OT.</div>
          ) : (
            <div className="flex flex-col gap-1.5 mb-4">
              {resumen.paradas.map((p) => (
                <div key={p.causa} className="flex items-center gap-2 bg-gypi-surface rounded-xl p-3 border border-gypi-border">
                  <span className="flex-1 min-w-0 text-[13px] font-bold truncate">{p.nombre}</span>
                  <span className="text-[11px] text-gypi-dim">{p.veces === 1 ? "1 vez" : `${p.veces} veces`}</span>
                  <span className="text-[13px] font-bold">{fmtHoras(p.min)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="text-[11px] text-gypi-dim mb-4">Las paradas cuentan desde que se anotan con la OT en la que se estaba; las anteriores no tienen OT.</div>

        </>)}
        {noConformes.length > 0 && (<>
          <div className="g-label mb-1.5">No conformidades</div>
          <div className="flex flex-col gap-1.5">
            {noConformes.map((nc) => (
              <div key={nc.id} className="flex items-center gap-2 bg-gypi-surface rounded-xl p-3 border border-gypi-border">
                <span className="w-10 font-mono text-[12px] font-bold text-gypi-red">{nc.defecto}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold truncate">{nombreDefecto(defectos, nc.defecto)}</div>
                  <div className="text-[11px] text-gypi-dim truncate">
                    {[nc.cantidad > 1 ? `${nc.cantidad} piezas` : "1 pieza", nc.pieza, nc.minutos_retrabajo ? `${nc.minutos_retrabajo} min de retrabajo` : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <span className={`text-[11px] font-bold ${nc.decision ? "text-gypi-green" : "text-gypi-red"}`}>{nc.decision ? nombreDecision(nc.decision) : "Sin decidir"}</span>
              </div>
            ))}
          </div>
        </>)}
      </div>
    </div>
  );
}
