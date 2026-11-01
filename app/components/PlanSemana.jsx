"use client";
// app/components/PlanSemana.jsx — 📅 Plan de la semana (planificación de la
// producción, parte 41; migración 138). Lo que gerencia confirmó en
// Proyectos → Planificación: qué OT y qué etapa toca cada día. Solo lectura;
// lo ven el Tablero y el Inicio de los operarios de la división del plan.
// Sin plan confirmado (o sin la migración) no muestra nada. En el Tablero
// (con las OT) cada OT lleva su cliente y descripción (Tadeo, 30/10) y cada
// día el material de sus procesos contra el stock (Tadeo, 01/11; materialDia.js).
import { useContext, useEffect, useState } from "react";
import { apiFetch, sb } from "../lib/supabase";
import { AuthContext } from "../context/AuthContext";
import { hoyArg } from "../lib/dates";
import { fechaCorta } from "../lib/ot";
import { fmtH, pendienteEtapa } from "../lib/cargaPlanta";
import { planPorDia, planEsDeMiDivision } from "../lib/planGuardado";
import { CLAVE_PLANIFICACION } from "../lib/planificacion";
import { etapasDelPlan } from "../lib/ganttPlan";
import { cantidadTexto } from "../lib/stock";
import { faltaPorOt, materialDelDia } from "../lib/materialDia";

const COLOR_ETAPA = { corte: "bg-proc-corte", canteado: "bg-proc-canteado", mecanizado: "bg-proc-mecanizado", armado: "bg-proc-armado" };

const nombreDia = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`).toLocaleDateString("es-AR", { weekday: "long", timeZone: "UTC" });
  return `${d.charAt(0).toUpperCase()}${d.slice(1)} ${fechaCorta(iso)}`;
};

// Comillas codificadas (%22): los SKU y las OT pueden llevar puntos o guiones
const lista = (xs) => xs.map((x) => `%22${encodeURIComponent(x)}%22`).join(",");

/** Lee lo que hace falta para el material de las OT del plan; null si no hay nada que mostrar. */
async function leerMaterial(empresaId, ots) {
  if (!ots.length) return null;
  const [nec, mov, cfg] = await Promise.all([
    sb.get(`necesidades_stock?empresa_id=eq.${empresaId}&ot=in.(${lista(ots)})&select=ot,sku,nombre,cantidad`).catch(() => []),
    sb.get(`movimientos_stock?empresa_id=eq.${empresaId}&ot=in.(${lista(ots)})&anulado=eq.false&tipo=in.(consumo,devolucion)&select=ot,sku,cantidad,tipo,anulado`).catch(() => []),
    sb.get(`config_sistema?clave=eq.${CLAVE_PLANIFICACION}&select=valor&limit=1`).catch(() => null),
  ]);
  if (!nec?.length) return null;
  const skus = [...new Set(nec.map((n) => n.sku))].slice(0, 300);
  const arts = await sb.get(`articulos_stock?sku=in.(${lista(skus)})&select=sku,nombre,familia,unidad,stock`).catch(() => []);
  const articulos = new Map((arts || []).map((a) => [a.sku, a]));
  // Si el artículo no está en ARTICULOS, el nombre de la planilla de necesidades
  for (const n of nec) if (!articulos.has(n.sku) && n.nombre) articulos.set(n.sku, { sku: n.sku, nombre: n.nombre });
  return { falta: faltaPorOt(nec, mov || []), articulos, cfgValor: cfg?.[0]?.valor || null };
}

function MaterialDia({ material }) {
  const [abierto, setAbierto] = useState(false);
  if (!material.filas.length) return null;
  const resumen = material.conFalta
    ? `🔴 Faltan ${material.conFalta} de ${material.filas.length} ${material.filas.length === 1 ? "artículo" : "artículos"}`
    : `✅ Hay stock de los ${material.filas.length === 1 ? "1 artículo" : `${material.filas.length} artículos`}`;
  return (
    <div className="mt-1.5" data-material-dia>
      <button type="button" onClick={() => setAbierto(!abierto)} aria-expanded={abierto}
        className={`g-btn g-btn-secondary w-full justify-between text-[14px] ${material.conFalta ? "text-gypi-red" : ""}`}>
        <span>🧱 Material del día · {resumen}</span><span aria-hidden="true">{abierto ? "▲" : "▼"}</span>
      </button>
      {abierto && (
        <ul className="list-none m-0 p-0 mt-1 flex flex-col gap-1">
          {material.filas.map((f) => (
            <li key={f.sku} className="text-[13px] flex flex-wrap items-center gap-x-2 border-t border-gypi-border pt-1">
              <span aria-hidden="true" className={`inline-block w-2.5 h-2.5 rounded-sm ${COLOR_ETAPA[f.proceso]}`} />
              <span className="font-bold flex-1 min-w-0">{f.nombre}</span>
              <span className="text-gypi-dim">necesita {cantidadTexto(f.cantidad)}{f.unidad ? ` ${f.unidad}` : ""} · stock {cantidadTexto(f.stock)}</span>
              <span className={f.faltan > 0 ? "text-gypi-red font-bold" : "text-gypi-green"}>{f.faltan > 0 ? `faltan ${cantidadTexto(f.faltan)}` : "✅"}</span>
              <span className="w-full text-xs text-gypi-dim">OT {f.ots.join(", ")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PlanSemana({ divisiones, divisionUsuario = null, proyectos = null, empresaId = null, etapas = [], avance = [], piezas = [] }) {
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

  // Material de cada día: solo en el Tablero (con las OT)
  const [stock, setStock] = useState(null);
  const otsPlan = plan && proyectos ? [...new Set((plan.items || []).filter((i) => i.fecha >= hoy).map((i) => String(i.ot)))].sort().join("|") : "";
  useEffect(() => {
    if (!empresaId || !otsPlan) return;
    let vivo = true;
    leerMaterial(empresaId, otsPlan.split("|")).then((d) => { if (vivo) setStock(d); }).catch(() => {});
    return () => { vivo = false; };
  }, [empresaId, otsPlan]);

  if (!plan || !planEsDeMiDivision(plan, divs, divisionUsuario)) return null;
  const dias = planPorDia(plan.items).filter((d) => d.ots.length);
  if (!dias.length) return null;
  // Desde hoy en adelante; con "Ver todo" también los días que ya pasaron
  const vienen = dias.filter((d) => d.fecha >= hoy);
  const mostrar = verTodo ? dias : vienen.slice(0, 3);
  const extra = new Set((plan.dias_extra || []).map((d) => d.fecha));
  const codigos = stock ? etapasDelPlan(stock.cfgValor, etapas, divs) : null;
  const pendiente = (ot, etapa) => pendienteEtapa({ ot, codigo: codigos?.[etapa], avance, piezas });

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
            {stock && <MaterialDia material={materialDelDia(d.ots, { falta: stock.falta, articulos: stock.articulos, pendiente })} />}
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
