'use client';
// app/components/FinanzasOtClientes.jsx — Finanzas → 👥 Clientes → 📋 Cuenta
// por OT (parte 6; /api/finanzas/ot-clientes; reglas en
// app/lib/finanzasOtClientes.js).
//
// Cada OT del cliente con su valor (presupuesto, o materiales ÷ 0,3 marcado
// "⚠ Estimado"), lo cobrado y el saldo; los cobros sin OT restan del total.
// Con IVA o sin IVA, todas las OT o desde una fecha, y la lista de OT
// estimadas para salir a buscar el presupuesto.
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { plata } from "../lib/finanzasOperaciones";
import { resumirCliente } from "../lib/finanzasOtClientes";
import { Chip, Modal, Spinner } from "./ui";

const fechaCorta = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}` : "");
const normal = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const MAX = 200;

function TablaOt({ r }) {
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
        {r.ots.map((o) => (
          <tr key={o.proyecto_id} className={`border-t border-gypi-border align-top ${o.estimado ? "bg-gypi-amber/15" : ""}`}>
            <td className="py-1">
              <span className="font-semibold">{o.ot}</span> {o.obra}
              <span className="block text-[12px] text-gypi-dim">{[fechaCorta(o.fecha), o.descripcion].filter(Boolean).join(" · ")}</span>
              {o.estimado && <span className="block text-[12px] font-semibold text-gypi-amber-ink">⚠ Estimado: falta el presupuesto (materiales {plata(o.materiales, "ARS")} ÷ 0,3{o.sin_precio_materiales ? `; ${o.sin_precio_materiales} artículos sin precio` : ""})</span>}
              {o.sin_valor && <span className="block text-[12px] text-gypi-red">Sin presupuesto ni materiales con precio</span>}
            </td>
            <td className="py-1 text-right font-mono">{plata(o.valor, "ARS")}</td>
            <td className="py-1 text-right font-mono">{o.cobrado ? plata(o.cobrado, "ARS") : ""}</td>
            <td className="py-1 text-right font-mono font-semibold">{plata(o.saldo, "ARS")}</td>
          </tr>
        ))}
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

export default function FinanzasOtClientes({ onCerrar }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [conIva, setConIva] = useState(false);
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
    .map((c) => ({ ...c, r: resumirCliente(c, { conIva, desde }) }))
    .filter((c) => c.r.ots.length)
    .sort((a, b) => b.r.saldo - a.r.saldo), [d, conIva, desde]);
  const estimadas = useMemo(() => resumen.flatMap((c) => c.r.ots.filter((o) => o.estimado || o.sin_valor).map((o) => ({ ...o, cliente: c.nombre }))), [resumen]);
  const b = normal(buscar);
  const lista = resumen.filter((c) => !b || normal(c.nombre).includes(b) || c.r.ots.some((o) => normal(o.ot).includes(b)));
  const total = resumen.reduce((s, c) => s + c.r.saldo, 0);

  return (
    <Modal open onClose={onCerrar} title="Cuenta por OT" maxWidth={820}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px] text-gypi-dim">
          Cada OT con su presupuesto (PRECIO del Plan, sin IVA). Si no tiene, va el costo de materiales ÷ 0,3, en amarillo. Se restan todos los cobros; los que no tienen OT restan del total del cliente. Es para seguir lo que falta cobrar: no cambia la contabilidad.
        </p>
        {!d && !error && <Spinner size={18} />}
        {d?.sin_deudores && <p className="m-0 text-[13px] text-gypi-amber-ink">Falta la cuenta &quot;Deudores por Ventas&quot; en el plan de cuentas: no se ven los cobros.</p>}
        {d && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={conIva} onChange={(e) => setConIva(e.target.checked)} /> Con IVA (21 %)</label>
              <label className="flex items-center gap-2 text-[13px]">OT desde <input type="date" className="g-input" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
              {desde && <button type="button" className="g-btn g-btn-secondary" onClick={() => setDesde("")}>Todas</button>}
            </div>
            <p className="m-0">Falta cobrar en total <b>{plata(total, "ARS")}</b>{conIva ? " (con IVA)" : " (sin IVA)"}</p>
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
                        <TablaOt r={c.r} />
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
