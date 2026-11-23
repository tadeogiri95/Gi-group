'use client';
// app/components/FinanzasCuentasPagarCobrar.jsx — Finanzas → Informes → 🗂
// Cuentas a cobrar y a pagar (pedido de Tadeo del 19/11; reglas en
// app/lib/finanzasCuentasPagarCobrar.js). Sin migración.
//
// Como Resultados o Flujo de caja: a una fecha, cuánto nos deben los
// clientes y cuánto les debemos a los proveedores, quién, y hace cuánto
// (hasta 30 días, 31 a 60, 61 a 90, más de 90). Se baja en PDF o Excel.
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyAr, plata } from "../lib/finanzasOperaciones";
import { TRAMOS, cuentasPagarCobrar, informeCuentas, pctTramos } from "../lib/finanzasCuentasPagarCobrar";
import { Chip, Spinner } from "./ui";
import BotonesExportar from "./FinanzasExportar";

async function leer(url, error) {
  const res = await apiFetch(url);
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || error);
  return d;
}

// Colores de cada tramo (de más nuevo a más viejo)
const COLOR_TRAMO = { d30: "bg-gypi-green", d60: "bg-gypi-amber", d90: "bg-gypi-violet", mas: "bg-gypi-red" };
const LADOS = [
  { id: "cobrar", campo: "a_cobrar", nombre: "A cobrar (clientes)", quien: "Cliente", favor: "A favor de clientes" },
  { id: "pagar", campo: "a_pagar", nombre: "A pagar (proveedores)", quien: "Proveedor", favor: "A favor nuestro (anticipos)" },
];

function Tramos({ l }) {
  const pct = pctTramos(l);
  return (
    <div className="flex flex-col gap-2">
      <dl className="m-0 grid grid-cols-2 sm:grid-cols-4 gap-2">
        {TRAMOS.map((t) => (
          <div key={t.id} className="rounded-lg border border-gypi-border bg-gypi-surface px-3 py-2">
            <dt className="text-[12px] text-gypi-dim flex items-center gap-1.5"><span className={`inline-block w-2.5 h-2.5 rounded-full ${COLOR_TRAMO[t.id]}`} aria-hidden="true" />{t.nombre}</dt>
            <dd className={`m-0 font-mono font-semibold text-[14px] ${t.id === "mas" && l.tramos[t.id] > 0 ? "text-gypi-red" : "text-gypi-text"}`}>{plata(l.tramos[t.id], "ARS")}</dd>
            <dd className="m-0 text-[12px] text-gypi-dim">{String(pct[t.id]).replace(".", ",")} % del total</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function FinanzasCuentasPagarCobrar() {
  const [cli, setCli] = useState(null);
  const [prov, setProv] = useState(null);
  const [error, setError] = useState(null);
  const [hasta, setHasta] = useState(hoyAr());
  const [ladoId, setLadoId] = useState("cobrar");

  const cargar = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([
        leer("/api/finanzas/clientes", "No se pudieron cargar los clientes"),
        leer("/api/finanzas/proveedores", "No se pudieron cargar los proveedores"),
      ]);
      setCli(c);
      setProv(p);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const r = useMemo(() => {
    if (!cli || !prov) return null;
    return cuentasPagarCobrar({
      opsClientes: cli.operaciones || [], opsProveedores: prov.operaciones || [],
      cuentasDeu: new Set(cli.cuentas_deudores || []), cuentasProv: new Set(prov.cuentas_proveedores || []),
      clientes: cli.clientes || [], proveedores: prov.proveedores || [], hasta,
    });
  }, [cli, prov, hasta]);

  if (error) return <p role="alert" className="m-[18px] text-[14px] text-gypi-red">⚠ {error}</p>;
  if (!r) return <div className="flex-1 flex items-center justify-center py-10"><Spinner /></div>;
  const L = LADOS.find((x) => x.id === ladoId);
  const l = r[L.campo];

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-gypi-dim">
          Al día
          <input type="date" className="g-input" aria-label="Al día" value={hasta} max={hoyAr()} onChange={(e) => e.target.value && setHasta(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          {LADOS.map((x) => (
            <Chip key={x.id} active={ladoId === x.id} onClick={() => setLadoId(x.id)}>{x.nombre} · {plata(r[x.campo].total, "ARS")}</Chip>
          ))}
        </div>
        <div className="ml-auto">
          <BotonesExportar nombre={L.nombre} informe={() => informeCuentas(r, ladoId)} />
        </div>
      </div>

      <section aria-label={L.nombre} className="flex flex-col gap-3">
        <p className="m-0 text-[15px] text-gypi-text">
          {ladoId === "cobrar" ? "Nos deben" : "Les debemos"} <b className="font-mono">{plata(l.total, "ARS")}</b>
          <span className="text-gypi-dim"> · {l.cantidad} {l.cantidad === 1 ? "cuenta" : "cuentas"}</span>
          {l.a_favor >= 0.01 && <span className="text-gypi-green"> · {L.favor}: {plata(l.a_favor, "ARS")}</span>}
        </p>
        <Tramos l={l} />
        {l.renglones.length ? (
          <div className="overflow-x-auto rounded-lg border border-gypi-border">
            <table className="w-full text-[13px] text-gypi-text border-collapse">
              <thead>
                <tr className="bg-gypi-surface text-gypi-dim text-[12px]">
                  <th className="text-left px-2 py-1.5">{L.quien}</th>
                  {TRAMOS.map((t) => <th key={t.id} className="text-right px-2 py-1.5 whitespace-nowrap">{t.nombre}</th>)}
                  <th className="text-right px-2 py-1.5">Total</th>
                  <th className="text-right px-2 py-1.5 whitespace-nowrap">Lo más viejo</th>
                </tr>
              </thead>
              <tbody>
                {l.renglones.map((x) => (
                  <tr key={x.clave} className="border-t border-gypi-border">
                    <td className="px-2 py-1.5 min-w-[160px]">{x.nombre}</td>
                    {TRAMOS.map((t) => <td key={t.id} className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{x.tramos[t.id] ? plata(x.tramos[t.id], "ARS") : ""}</td>)}
                    <td className="px-2 py-1.5 text-right font-mono font-semibold whitespace-nowrap">{plata(x.saldo, "ARS")}</td>
                    <td className={`px-2 py-1.5 text-right whitespace-nowrap ${x.dias > 90 ? "text-gypi-red font-semibold" : ""}`}>{x.dias} días</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gypi-border font-bold">
                  <td className="px-2 py-1.5">Total</td>
                  {TRAMOS.map((t) => <td key={t.id} className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{plata(l.tramos[t.id], "ARS")}</td>)}
                  <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{plata(l.total, "ARS")}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="m-0 text-[13px] text-gypi-dim">{ladoId === "cobrar" ? "Ningún cliente debe nada a esa fecha." : "No se le debe nada a ningún proveedor a esa fecha."}</p>
        )}
        <p className="m-0 text-[12px] text-gypi-dim">Los cobros y los pagos se aplican a lo más viejo primero, como en la ficha de cada uno. Los días se cuentan desde la fecha de la venta o la compra.</p>
      </section>
    </div>
  );
}
