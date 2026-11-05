'use client';
// app/components/MisPlanillas.jsx — "📐 Mis planillas" de cada arquitecta
// (Gantt de Diseño y Técnica, parte 50; datos de /api/diseno-tecnica?mias=1).
//
// La arquitecta ve en su Inicio las planillas técnicas que le tocan en el
// plan de Diseño y Técnica, en orden (la que está haciendo primero), con
// cuándo empieza y termina cada una, y las OT que tiene en Diseño. Es el
// mismo cálculo que el Gantt 📐: si gerencia cambia el orden o la asigna a
// otra, acá se ve enseguida.
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { fechaCorta } from "../lib/ot";
import { textoDiasHabiles, textoHoras } from "../lib/disenoTecnicaPlan";
import { nombreTipo } from "../lib/tipoProyecto";
import Modal from "./ui/Modal";
import NombreOt from "./NombreOt";

/** Lo de la arquitecta que pregunta; null mientras carga o si no es arquitecta. */
export function useMisPlanillas(activo = true) {
  const [datos, setDatos] = useState(null);
  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    apiFetch("/api/diseno-tecnica?mias=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo) setDatos(d?.es ? d : null); })
      .catch(() => { if (vivo) setDatos(null); });
    return () => { vivo = false; };
  }, [activo]);
  return datos;
}

/** "Haciendo ahora · 12 h" o "Próxima: 3 planillas" para el botón del Inicio. */
export function detalleMisPlanillas(d) {
  if (!d) return "";
  const n = d.tecnica.length;
  if (!n) return d.diseno.length ? `${d.diseno.length} OT en Diseño · sin planillas técnicas` : "Sin planillas por ahora";
  const ahora = d.tecnica[0];
  return `${n} ${n === 1 ? "planilla" : "planillas"} · ahora la OT ${ahora.ot}, hasta el ${fechaCorta(ahora.tecnica.fin)}`;
}

/** Texto de una planilla técnica: "Del 06/11 al 10/11 · 18 h · lleva 30 %". */
export function textoPlanilla(r) {
  const t = r.tecnica;
  const partes = [`Del ${fechaCorta(t.inicio)} al ${fechaCorta(t.fin)}`, `faltan ${textoHoras(t.horas)}`];
  if (t.pct > 0) partes.push(`lleva ${t.pct} %`);
  if (r.corrido > 0) partes.push(`↪ se corrió ${textoDiasHabiles(r.corrido)} desde lo confirmado`);
  return partes.join(" · ");
}

const proyectoDe = (r) => ({ ot: r.ot, cliente: r.cliente, obra: r.obra, proyecto: r.proyecto, descripcion: r.descripcion });

export default function MisPlanillas({ datos, onClose }) {
  if (!datos) return null;
  const { tecnica, diseno } = datos;
  return (
    <Modal open onClose={onClose} title="📐 Mis planillas">
      <div className="p-4 overflow-y-auto text-gypi-text flex flex-col gap-4">
        <div className="text-[14px] text-gypi-dim">
          {datos.nombre} · {datos.pctTecnica} % de tu jornada en Técnica. Una planilla por vez, en este orden. Lo arma el plan de Diseño y Técnica: si gerencia cambia el orden, acá se ve enseguida.
        </div>
        <section aria-label="Planillas técnicas">
          <h3 className="m-0 mb-2 text-[15px] font-bold">Planillas técnicas · {tecnica.length}</h3>
          {!tecnica.length ? (
            <div className="text-[14px] text-gypi-dim">No tenés planillas técnicas en el plan por ahora.</div>
          ) : (
            <ol className="list-none m-0 p-0 flex flex-col gap-2">
              {tecnica.map((r, i) => (
                <li key={r.ot} data-planilla={r.ot} className={`rounded-[14px] border p-3 ${i === 0 ? "border-gypi-amber bg-gypi-amber/10" : "border-gypi-border bg-gypi-surface"}`}>
                  <div className="text-[12px] font-bold text-gypi-amber-ink mb-0.5">{i === 0 ? "▶ Ahora" : `${i + 1}.º`}</div>
                  <div className="text-[15px] font-bold"><NombreOt proyecto={proyectoDe(r)} /></div>
                  <div className="text-[13px] text-gypi-dim">{nombreTipo(r.tipo)} · clase {r.clase}</div>
                  <div className={`text-[14px] mt-1 ${r.corrido > 0 ? "text-gypi-red-ink font-semibold" : ""}`}>{textoPlanilla(r)}</div>
                </li>
              ))}
            </ol>
          )}
        </section>
        {diseno.length > 0 && (
          <section aria-label="En Diseño">
            <h3 className="m-0 mb-2 text-[15px] font-bold">En Diseño · {diseno.length}</h3>
            <ul className="list-none m-0 p-0 flex flex-col gap-2">
              {diseno.map((r) => (
                <li key={r.ot} className="rounded-[14px] border border-gypi-border bg-gypi-surface p-3">
                  <div className="text-[15px] font-bold"><NombreOt proyecto={proyectoDe(r)} /></div>
                  <div className="text-[14px] mt-1">Hasta el {fechaCorta(r.diseno.fin)} · faltan {textoDiasHabiles(r.diseno.dias)}{r.diseno.pct > 0 ? ` · lleva ${r.diseno.pct} %` : ""}</div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Modal>
  );
}
