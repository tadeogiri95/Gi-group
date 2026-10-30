"use client";
// app/components/PlanSemana.jsx — 📅 Plan de la semana (planificación de la
// producción, parte 41; migración 138). Lo que gerencia confirmó en
// Proyectos → Planificación: qué OT y qué etapa toca cada día. Solo lectura;
// lo ven el Tablero y el Inicio de los operarios de la división del plan.
// Sin plan confirmado (o sin la migración) no muestra nada. En el Tablero
// (con las OT) cada OT lleva su cliente y descripción (Tadeo, 30/10).
import { useContext, useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { AuthContext } from "../context/AuthContext";
import { hoyArg } from "../lib/dates";
import { fechaCorta } from "../lib/ot";
import { fmtH } from "../lib/cargaPlanta";
import { planPorDia, planEsDeMiDivision } from "../lib/planGuardado";

const COLOR_ETAPA = { corte: "bg-proc-corte", canteado: "bg-proc-canteado", mecanizado: "bg-proc-mecanizado", armado: "bg-proc-armado" };

const nombreDia = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`).toLocaleDateString("es-AR", { weekday: "long", timeZone: "UTC" });
  return `${d.charAt(0).toUpperCase()}${d.slice(1)} ${fechaCorta(iso)}`;
};

export default function PlanSemana({ divisiones, divisionUsuario = null, proyectos = null }) {
  const auth = useContext(AuthContext);
  const divs = divisiones || auth?.divisiones || [];
  const [plan, setPlan] = useState(null);
  const [verTodo, setVerTodo] = useState(false);
  const hoy = hoyArg();
  const porOt = new Map((proyectos || []).map((p) => [String(p.ot), p]));

  useEffect(() => {
    let vivo = true;
    apiFetch(`/api/planificacion?fecha=${hoy}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo) setPlan(d?.plan || null); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [hoy]);

  if (!plan || !planEsDeMiDivision(plan, divs, divisionUsuario)) return null;
  const dias = planPorDia(plan.items).filter((d) => d.ots.length);
  if (!dias.length) return null;
  // Desde hoy en adelante; con "Ver todo" también los días que ya pasaron
  const vienen = dias.filter((d) => d.fecha >= hoy);
  const mostrar = verTodo ? dias : vienen.slice(0, 3);
  const extra = new Set((plan.dias_extra || []).map((d) => d.fecha));

  return (
    <section aria-label="Plan de la semana" className="g-card mb-[18px]">
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 font-heading font-bold text-base">📅 Plan {plan.tipo === "mes" ? "del mes" : plan.tipo === "horizonte" ? "de producción" : "de la semana"}</div>
        <div className="text-xs text-gypi-dim">{fechaCorta(plan.desde)} al {fechaCorta(plan.hasta)}</div>
      </div>
      {!mostrar.length && <div className="text-[14px] text-gypi-dim">No queda nada planificado para estos días.</div>}
      <ul className="list-none m-0 p-0 flex flex-col gap-2">
        {mostrar.map((d) => (
          <li key={d.fecha} aria-label={`Plan del ${nombreDia(d.fecha)}`}
            className={`rounded-xl p-2.5 border ${d.fecha === hoy ? "border-gypi-amber/50 bg-gypi-amber/10" : "border-gypi-border"}`}>
            <div className="text-[14px] font-bold mb-1">
              {d.fecha === hoy ? "Hoy · " : ""}{nombreDia(d.fecha)}{extra.has(d.fecha) ? " · ⏱ horas extra" : ""}
            </div>
            <ul className="list-none m-0 p-0 flex flex-col gap-1">
              {d.ots.map((o) => (
                <li key={o.ot} className="text-[14px]">
                  <span className="font-mono font-bold">{o.ot}</span>{" "}
                  {(() => {
                    const p = porOt.get(String(o.ot));
                    const texto = [p?.cliente, p?.descripcion].filter(Boolean).join(" · ");
                    return texto ? <span className="text-gypi-text mr-2" data-proyecto>{texto}</span> : null;
                  })()}
                  {o.etapas.map((e) => (
                    <span key={e.id} className="inline-flex items-center gap-1 mr-2 text-gypi-dim">
                      <span aria-hidden="true" className={`inline-block w-2.5 h-2.5 rounded-sm ${COLOR_ETAPA[e.id]}`} />{e.nombre} {fmtH(e.horas)}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {dias.length > mostrar.length && (
        <button type="button" onClick={() => setVerTodo(true)} className="g-btn g-btn-secondary w-full mt-2">Ver todo el plan</button>
      )}
      {verTodo && <button type="button" onClick={() => setVerTodo(false)} className="g-btn g-btn-secondary w-full mt-2">Ver menos</button>}
    </section>
  );
}
