"use client";
// app/components/PlanSemana.jsx — 📅 Plan de la semana (planificación de la
// producción, parte 41; migración 138). Lo que gerencia confirmó en
// Proyectos → Planificación: qué OT y qué etapa toca cada día. Solo lectura;
// lo ven el Tablero y el Inicio de los operarios de la división del plan.
// Sin plan confirmado (o sin la migración) no muestra nada. En el Tablero
// (con las OT) cada OT lleva su cliente y descripción (Tadeo, 30/10) y cada
// día el material de sus procesos contra el stock (Tadeo, 01/11; materialDia.js),
// y el material sumado de los días que se elijan (Tadeo, 05/11), que desde
// el 26/11 es el 🧮 Resumen de materiales por semana con PDF y Excel.
import { useContext, useEffect, useState } from "react";
import { apiFetch, sb, sbGetAll } from "../lib/supabase";
import { AuthContext } from "../context/AuthContext";
import { hoyArg } from "../lib/dates";
import { fechaCorta } from "../lib/ot";
import { fmtH, pendienteEtapa } from "../lib/cargaPlanta";
import { planPorDia, planEsDeMiDivision } from "../lib/planGuardado";
import { CLAVE_PLANIFICACION } from "../lib/planificacion";
import { etapasDelPlan } from "../lib/ganttPlan";
import { cantidadTexto } from "../lib/stock";
import { faltaPorOt, materialDelDia } from "../lib/materialDia";
import { CLAVE_FECHA_OBJETIVO, normalizarModo } from "../lib/semanaObjetivo";
import ResumenMateriales from "./ResumenMateriales";
import NombreOt from "./NombreOt";
import { mapaOts, otCompleta, textoOt } from "../lib/nombreOt";

const COLOR_ETAPA = { corte: "bg-proc-corte", canteado: "bg-proc-canteado", mecanizado: "bg-proc-mecanizado", armado: "bg-proc-armado" };

const nombreDia = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`).toLocaleDateString("es-AR", { weekday: "long", timeZone: "UTC" });
  return `${d.charAt(0).toUpperCase()}${d.slice(1)} ${fechaCorta(iso)}`;
};

// Comillas codificadas (%22): los SKU y las OT pueden llevar puntos o guiones
const lista = (xs) => xs.map((x) => `%22${encodeURIComponent(x)}%22`).join(",");

/** De a tandas (la dirección no puede ser eterna) y paginado (Supabase corta en 1000 filas). */
async function leerEnTandas(valores, tam, armar) {
  const tandas = [];
  for (let i = 0; i < valores.length; i += tam) tandas.push(valores.slice(i, i + tam));
  const partes = await Promise.all(tandas.map((t) => sbGetAll(armar(lista(t)), { maxFilas: 20000 }).then((r) => r.data || []).catch(() => [])));
  return partes.flat();
}

/** Lee lo que hace falta para el material de las OT del plan; null si no hay nada que mostrar. */
async function leerMaterial(empresaId, ots) {
  if (!ots.length) return null;
  const [nec, mov, cfg, cfgSemana] = await Promise.all([
    leerEnTandas(ots, 80, (l) => `necesidades_stock?empresa_id=eq.${empresaId}&ot=in.(${l})&select=ot,sku,nombre,cantidad&order=ot.asc,sku.asc`),
    leerEnTandas(ots, 80, (l) => `movimientos_stock?empresa_id=eq.${empresaId}&ot=in.(${l})&anulado=eq.false&tipo=in.(consumo,devolucion)&select=ot,sku,cantidad,tipo,anulado&order=id.asc`),
    sb.get(`config_sistema?clave=eq.${CLAVE_PLANIFICACION}&select=valor&limit=1`).catch(() => null),
    sb.get(`config_sistema?clave=eq.${CLAVE_FECHA_OBJETIVO}&select=valor&limit=1`).catch(() => null),
  ]);
  if (!nec?.length) return null;
  const skus = [...new Set(nec.map((n) => n.sku))];
  const arts = await leerEnTandas(skus, 150, (l) => `articulos_stock?sku=in.(${l})&select=sku,nombre,familia,tipo,marca,unidad,stock&order=sku.asc`);
  const articulos = new Map((arts || []).map((a) => [a.sku, a]));
  // Si el artículo no está en ARTICULOS, el nombre de la planilla de necesidades
  for (const n of nec) if (!articulos.has(n.sku) && n.nombre) articulos.set(n.sku, { sku: n.sku, nombre: n.nombre });
  // Semanas como en Planificación: de domingo si la empresa cuenta así; si no, de lunes
  const modo = normalizarModo(cfgSemana?.[0]?.valor?.modo) === "semana_domingo" ? "semana_domingo" : "semana_lunes";
  return { falta: faltaPorOt(nec, mov || []), articulos, cfgValor: cfg?.[0]?.valor || null, modo };
}

function MaterialDia({ material, porOt }) {
  const [abierto, setAbierto] = useState(false);
  if (!material.filas.length) return null;
  const resumen = resumenMaterial(material);
  return (
    <div className="mt-1.5" data-material-dia>
      <button type="button" onClick={() => setAbierto(!abierto)} aria-expanded={abierto}
        className={`g-btn g-btn-secondary w-full justify-between text-[14px] ${material.conFalta ? "text-gypi-red" : ""}`}>
        <span>🧱 Material del día · {resumen}</span><span aria-hidden="true">{abierto ? "▲" : "▼"}</span>
      </button>
      {abierto && <ListaMaterial filas={material.filas} porOt={porOt} />}
    </div>
  );
}

function resumenMaterial(material) {
  return material.conFalta
    ? `🔴 Faltan ${material.conFalta} de ${material.filas.length} ${material.filas.length === 1 ? "artículo" : "artículos"}`
    : `✅ Hay stock de los ${material.filas.length === 1 ? "1 artículo" : `${material.filas.length} artículos`}`;
}

function ListaMaterial({ filas, porOt }) {
  return (
    <ul className="list-none m-0 p-0 mt-1 flex flex-col gap-1">
      {filas.map((f) => (
        <li key={f.sku} className="text-[13px] flex flex-wrap items-center gap-x-2 border-t border-gypi-border pt-1">
          <span aria-hidden="true" className={`inline-block w-2.5 h-2.5 rounded-sm ${COLOR_ETAPA[f.proceso]}`} />
          <span className="font-bold flex-1 min-w-0">{f.nombre}</span>
          <span className="text-gypi-dim">necesita {cantidadTexto(f.cantidad)}{f.unidad ? ` ${f.unidad}` : ""} · stock {cantidadTexto(f.stock)}</span>
          <span className={f.faltan > 0 ? "text-gypi-red font-bold" : "text-gypi-green"}>{f.faltan > 0 ? `faltan ${cantidadTexto(f.faltan)}` : "✅"}</span>
          <span className="w-full text-xs text-gypi-dim">{f.ots.map((ot) => textoOt(otCompleta(ot, porOt))).join(" / ")}</span>
        </li>
      ))}
    </ul>
  );
}

export default function PlanSemana({ divisiones, divisionUsuario = null, proyectos = null, empresaId = null, etapas = [], avance = [], piezas = [] }) {
  const auth = useContext(AuthContext);
  const divs = divisiones || auth?.divisiones || [];
  const [plan, setPlan] = useState(null);
  const [verTodo, setVerTodo] = useState(false);
  const hoy = hoyArg();
  // En el Inicio no viene la lista de OT: se leen las del plan para mostrar
  // cada OT completa (Código · Cliente · Proyecto · Descripción, 02/11)
  const [leidas, setLeidas] = useState(null);
  const porOt = mapaOts(proyectos || leidas || []);

  useEffect(() => {
    let vivo = true;
    apiFetch(`/api/planificacion?fecha=${hoy}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo) setPlan(d?.plan || null); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [hoy]);

  const otsDelPlan = plan && !proyectos ? [...new Set((plan.items || []).map((i) => String(i.ot)))].sort().join("|") : "";
  useEffect(() => {
    if (!otsDelPlan) return;
    let vivo = true;
    sb.get(`proyectos?ot=in.(${lista(otsDelPlan.split("|"))})&select=ot,cliente,obra,descripcion`)
      .then((d) => { if (vivo && Array.isArray(d)) setLeidas(d); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [otsDelPlan]);

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
                  <NombreOt proyecto={otCompleta(o.ot, porOt)} className="text-gypi-text mr-2" />{" "}
                  {o.etapas.map((e) => (
                    <span key={e.id} className="inline-flex items-center gap-1 mr-2 text-gypi-dim">
                      <span aria-hidden="true" className={`inline-block w-2.5 h-2.5 rounded-sm ${COLOR_ETAPA[e.id]}`} />{e.nombre} {fmtH(e.horas)}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
            {stock && <MaterialDia porOt={porOt} material={materialDelDia(d.ots, { falta: stock.falta, articulos: stock.articulos, pendiente })} />}
          </li>
        ))}
      </ul>
      {stock && vienen.length > 0 && (
        <ResumenMateriales dias={vienen} hoy={hoy} porOt={porOt} modo={stock.modo} empresa={auth?.empresa?.nombre_corto || auth?.empresa?.nombre || ""}
          datos={{ falta: stock.falta, articulos: stock.articulos, pendiente }} />
      )}
      {dias.length > mostrar.length && (
        <button type="button" onClick={() => setVerTodo(true)} className="g-btn g-btn-secondary w-full mt-2">Ver todo el plan</button>
      )}
      {verTodo && <button type="button" onClick={() => setVerTodo(false)} className="g-btn g-btn-secondary w-full mt-2">Ver menos</button>}
    </section>
  );
}
