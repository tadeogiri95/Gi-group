'use client';
// app/components/FinanzasOtClientes.jsx — Finanzas → 👥 Clientes → 📋 Cuenta
// por OT (parte 6; /api/finanzas/ot-clientes; reglas en
// app/lib/finanzasOtClientes.js).
//
// Cada OT del cliente con su valor (presupuesto, o materiales ÷ el % de
// materiales de Configuración, 30 % por defecto, marcado
// "⚠ Estimado"), lo cobrado y el saldo; los cobros sin OT restan del total.
// Cada OT con su casilla "Lleva IVA (21 %)" (201, 22/11; antes era una
// casilla para todas), todas las OT o desde una fecha, y la lista de OT
// estimadas para salir a buscar el presupuesto.
// 22/11: las OT se separan en pendientes de entrega y entregadas (terminadas
// en el Plan), con su subtotal y cuánto del saldo es de cada grupo.
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { plata } from "../lib/finanzasOperaciones";
import { resumirCliente, textoPctEstimado } from "../lib/finanzasOtClientes";
import { Chip, Modal, Spinner } from "./ui";
import IvaOt from "./IvaOt";

const fechaCorta = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}` : "");
const normal = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const MAX = 200;

/** Lo que el cliente debe con o sin IVA: "(sin IVA)", "(con IVA)" o "(2 OT con IVA)". */
function textoIva(r) {
  if (!r.con_iva) return " (sin IVA)";
  if (r.con_iva === r.ots.length) return " (con IVA)";
  return ` (${r.con_iva} OT con IVA, las demás sin IVA)`;
}

/** Marca en los datos leídos la casilla de IVA de una OT, para recalcular sin volver a leer. */
const conIvaDe = (d, cambio) => d && ({
  ...d,
  clientes: d.clientes.map((c) => ({ ...c, ots: c.ots.map((o) => (o.proyecto_id === cambio.id ? { ...o, lleva_iva: cambio.lleva_iva } : o)) })),
});

function FilaOt({ o, pct, onIva }) {
  return (
    <tr className={`border-t border-gypi-border align-top ${o.estimado ? "bg-gypi-amber/15" : ""}`}>
      <td className="py-1">
        <span className="font-semibold">{o.ot}</span> {o.obra}
        <span className="block text-[12px] text-gypi-dim">{[fechaCorta(o.fecha), o.descripcion].filter(Boolean).join(" · ")}</span>
        {o.entregada && o.entrega && <span className="block text-[12px] text-gypi-dim">Entregada el {fechaCorta(o.entrega)}</span>}
        {o.estimado && <span className="block text-[12px] font-semibold text-gypi-amber-ink">⚠ Estimado: falta el presupuesto (materiales {plata(o.materiales, "ARS")} ÷ {textoPctEstimado(pct)}{o.sin_precio_materiales ? `; ${o.sin_precio_materiales} artículos sin precio` : ""})</span>}
        {o.sin_valor && <span className="block text-[12px] text-gypi-red">Sin presupuesto ni materiales con precio</span>}
        <IvaOt proyecto={{ id: o.proyecto_id, lleva_iva: o.lleva_iva }} compacto onGuardado={onIva} />
      </td>
      <td className="py-1 text-right font-mono">
        {plata(o.valor, "ARS")}
        {o.lleva_iva && o.iva > 0 && <span className="block text-[12px] text-gypi-dim">{plata(o.neto, "ARS")} + IVA</span>}
      </td>
      <td className="py-1 text-right font-mono">{o.cobrado ? plata(o.cobrado, "ARS") : ""}</td>
      <td className="py-1 text-right font-mono font-semibold">{plata(o.saldo, "ARS")}</td>
    </tr>
  );
}

/** Título de cada grupo (22/11): entregadas y pendientes de entrega, con su subtotal. */
function GrupoOt({ titulo, g }) {
  return (
    <tr className="border-t-2 border-gypi-border bg-gypi-surf-lo">
      <td className="py-1 font-semibold">{titulo} ({g.n})</td>
      <td className="py-1 text-right font-mono font-semibold">{plata(g.valor, "ARS")}</td>
      <td className="py-1 text-right font-mono font-semibold">{g.cobrado ? plata(g.cobrado, "ARS") : ""}</td>
      <td className="py-1 text-right font-mono font-semibold">{plata(g.valor - g.cobrado, "ARS")}</td>
    </tr>
  );
}

function TablaOt({ r, pct, onIva }) {
  const entregadas = r.ots.filter((o) => o.entregada);
  const pendientes = r.ots.filter((o) => !o.entregada);
  return (
    <table className="w-full border-collapse text-[13px] mt-1" aria-label="OT del cliente">
      <thead>
        <tr className="text-left text-gypi-dim">
          <th className="py-1 font-semibold">OT</th>
          <th className="py-1 font-semibold text-right">Valor</th>
          <th className="py-1 font-semibold text-right">Cobrado</th>
          <th className="py-1 font-semibold text-right">Saldo</th>
        </tr>
      </thead>
      <tbody>
        {pendientes.length > 0 && <GrupoOt titulo="Pendientes de entrega" g={r.pendientes} />}
        {pendientes.map((o) => <FilaOt key={o.proyecto_id} o={o} pct={pct} onIva={onIva} />)}
        {entregadas.length > 0 && <GrupoOt titulo="Entregadas" g={r.entregadas} />}
        {entregadas.map((o) => <FilaOt key={o.proyecto_id} o={o} pct={pct} onIva={onIva} />)}
        {r.sin_ot > 0 && (
          <tr className="border-t border-gypi-border">
            <td className="py-1">Cobros sin OT</td>
            <td />
            <td className="py-1 text-right font-mono">{plata(r.sin_ot, "ARS")}</td>
            <td className="py-1 text-right font-mono font-semibold">-{plata(r.sin_ot, "ARS")}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** "De eso, $X es de OT entregadas y $Y de OT pendientes de entrega" (22/11). */
export function textoReparto(r) {
  if (!r?.entregadas || !r?.pendientes) return "";
  const partes = [`${plata(r.entregadas.saldo, "ARS")} de OT entregadas`, `${plata(r.pendientes.saldo, "ARS")} de OT pendientes de entrega`];
  return `De eso: ${partes.join(" y ")}${r.a_favor > 0.009 ? `; y ${plata(r.a_favor, "ARS")} cobrados de más` : ""}.`;
}

/**
 * En la ficha de un cliente: las OT que componen lo que falta cobrar (valor,
 * cobrado y saldo de cada una), cada OT con su IVA.
 */
export function ComposicionOt({ clave }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    apiFetch("/api/finanzas/ot-clientes")
      .then(async (res) => {
        const x = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(x.error || "No se pudo leer");
        setD(x);
      })
      .catch((e) => setError(e.message));
  }, []);
  const c = useMemo(() => (d?.clientes || []).find((x) => x.clave === clave) || null, [d, clave]);
  const r = useMemo(() => (c ? resumirCliente(c) : null), [c]);
  if (error) return <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>;
  if (!d) return <Spinner size={18} />;
  if (!r || !r.ots.length) return <p className="m-0 text-[13px] text-gypi-dim">Este cliente no tiene OT en el Plan de trabajo.</p>;
  return (
    <div className="flex flex-col gap-2" aria-label="OT que componen la deuda">
      <div className="flex flex-wrap items-center gap-3">
        <p className="m-0">Según sus OT falta cobrar <b>{plata(r.saldo, "ARS")}</b>{textoIva(r)}</p>
      </div>
      <p className="m-0 text-[13px]">{textoReparto(r)}</p>
      <p className="m-0 text-[12px] text-gypi-dim">
        {r.ots.length} OT · Valor {plata(r.valor, "ARS")} · Cobrado {plata(r.cobrado, "ARS")}{r.estimadas ? ` · ⚠ ${r.estimadas} estimadas (sin presupuesto: materiales ÷ ${textoPctEstimado(d.materiales_pct)})` : ""}
      </p>
      <TablaOt r={r} pct={d.materiales_pct} onIva={(x) => setD((v) => conIvaDe(v, x))} />
    </div>
  );
}

export default function FinanzasOtClientes({ onCerrar }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [desde, setDesde] = useState("");
  const [vista, setVista] = useState("clientes");
  const [buscar, setBuscar] = useState("");

  useEffect(() => {
    apiFetch("/api/finanzas/ot-clientes")
      .then(async (res) => {
        const x = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(x.error || "No se pudo leer");
        setD(x);
      })
      .catch((e) => setError(e.message));
  }, []);

  const resumen = useMemo(() => (d?.clientes || [])
    .map((c) => ({ ...c, r: resumirCliente(c, { desde }) }))
    .filter((c) => c.r.ots.length)
    .sort((a, b) => b.r.saldo - a.r.saldo), [d, desde]);
  const estimadas = useMemo(() => resumen.flatMap((c) => c.r.ots.filter((o) => o.estimado || o.sin_valor).map((o) => ({ ...o, cliente: c.nombre }))), [resumen]);
  const b = normal(buscar);
  const lista = resumen.filter((c) => !b || normal(c.nombre).includes(b) || c.r.ots.some((o) => normal(o.ot).includes(b)));
  const total = resumen.reduce((s, c) => s + c.r.saldo, 0);
  const otConIva = resumen.reduce((s, c) => s + c.r.con_iva, 0);

  return (
    <Modal open onClose={onCerrar} title="Cuenta por OT" maxWidth={1080}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px] text-gypi-dim">
          Cada OT con su presupuesto (PRECIO del Plan, sin IVA; si tildás &quot;Lleva IVA (21 %)&quot; vale el precio × 1,21). Si no tiene, va el costo de materiales ÷ {textoPctEstimado(d?.materiales_pct)} (el % de materiales de Finanzas → Configuración), en amarillo. Se restan todos los cobros; los que no tienen OT restan del total del cliente. Es para seguir lo que falta cobrar: no cambia la contabilidad.
        </p>
        {!d && !error && <Spinner size={18} />}
        {d?.sin_deudores && <p className="m-0 text-[13px] text-gypi-amber-ink">Falta la cuenta &quot;Deudores por Ventas&quot; en el plan de cuentas: no se ven los cobros.</p>}
        {d && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-[13px]">OT desde <input type="date" className="g-input" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
              {desde && <button type="button" className="g-btn g-btn-secondary" onClick={() => setDesde("")}>Todas</button>}
            </div>
            <p className="m-0">Falta cobrar en total <b>{plata(total, "ARS")}</b>{otConIva ? ` (${otConIva} OT con IVA, las demás sin IVA)` : " (sin IVA)"}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Chip active={vista === "clientes"} onClick={() => setVista("clientes")}>Clientes ({resumen.length})</Chip>
              <Chip active={vista === "estimadas"} onClick={() => setVista("estimadas")}>⚠ OT sin presupuesto ({estimadas.length})</Chip>
              {vista === "clientes" && <input className="g-input flex-1 min-w-[160px]" aria-label="Buscar cliente u OT" placeholder="Buscar cliente u OT" value={buscar} onChange={(e) => setBuscar(e.target.value)} />}
            </div>
            <div className="max-h-[55vh] overflow-y-auto">
              {vista === "clientes" ? (
                <ul className="list-none m-0 p-0 flex flex-col gap-1.5" aria-label="Clientes por OT">
                  {lista.slice(0, MAX).map((c) => (
                    <li key={c.clave} className="border border-gypi-border rounded-lg px-3 py-2">
                      <details>
                        <summary className="cursor-pointer">
                          <span className="font-semibold">{c.nombre}</span>
                          <span className="float-right font-mono font-semibold">{plata(c.r.saldo, "ARS")}</span>
                          <span className="block text-[12px] text-gypi-dim">
                            {c.r.ots.length} OT · Valor {plata(c.r.valor, "ARS")} · Cobrado {plata(c.r.cobrado, "ARS")}{c.r.estimadas ? ` · ⚠ ${c.r.estimadas} estimadas` : ""}
                          </span>
                        </summary>
                        <TablaOt r={c.r} pct={d.materiales_pct} onIva={(x) => setD((v) => conIvaDe(v, x))} />
                      </details>
                    </li>
                  ))}
                </ul>
              ) : (
                <table className="w-full border-collapse text-[13px]" aria-label="OT sin presupuesto">
                  <thead>
                    <tr className="text-left text-gypi-dim"><th className="py-1">OT</th><th className="py-1">Cliente</th><th className="py-1 text-right">Estimado</th></tr>
                  </thead>
                  <tbody>
                    {estimadas.map((o) => (
                      <tr key={o.proyecto_id} className="border-t border-gypi-border">
                        <td className="py-1"><b>{o.ot}</b> {o.obra}</td>
                        <td className="py-1">{o.cliente}</td>
                        <td className="py-1 text-right font-mono">{o.sin_valor ? "Sin datos" : plata(o.valor, "ARS")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {vista === "clientes" && lista.length > MAX && <p className="text-[13px] text-gypi-dim">Hay {lista.length - MAX} más: usá el buscador.</p>}
            </div>
          </>
        )}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end"><button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cerrar</button></div>
      </div>
    </Modal>
  );
}
