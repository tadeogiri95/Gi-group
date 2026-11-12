'use client';
// app/components/CostoRealOt.jsx — 💲 Costo previsto y real de la OT en su
// detalle (auditoría 12/11, parte 3; /api/costo-real). Solo Dueño y
// Supervisor. Renglón por renglón: lo previsto (MRP, horas presupuestadas,
// días de instalación) y lo real (más lo retirado de más, las compras sin
// stock, el retrabajo y los gastos de Finanzas con la OT). Sin IVA.
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { fmtPesos } from "../lib/costo";
import { textoHoras } from "../lib/horasOt";

const pesos = (v) => (v == null ? "—" : fmtPesos(v));
const fechaCorta = (f) => (f ? String(f).split("-").reverse().join("/") : "");
const cant = (n) => Number(n).toLocaleString("es-AR", { maximumFractionDigits: 3 });

function Dif({ valor, pct = null }) {
  if (!valor) return <span className="text-gypi-dim">—</span>;
  return <span className={`font-semibold ${valor > 0 ? "text-gypi-red" : "text-gypi-green"}`}>{valor > 0 ? "+" : ""}{fmtPesos(valor)}{pct != null ? ` (${pct} %)` : ""}</span>;
}

/** Las horas que explican un renglón de mano de obra. */
function horasDe(f) {
  if (f.id === "retrabajo") return f.horasReales ? `${textoHoras(f.horasReales)}` : null;
  if (f.id !== "planta" && f.id !== "instalacion") return null;
  if (f.horasPrevistas == null && f.horasReales == null) return null;
  return `${textoHoras(f.horasPrevistas)} previstas · ${textoHoras(f.horasReales)} reales`;
}

export default function CostoRealOt({ ot }) {
  const [datos, setDatos] = useState(null);
  const [verDetalle, setVerDetalle] = useState(false);

  useEffect(() => {
    if (!ot) return;
    let vivo = true;
    apiFetch(`/api/costo-real?ot=${encodeURIComponent(ot)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => { if (vivo) setDatos(d); })
      .catch(() => { if (vivo) setDatos(null); });
    return () => { vivo = false; };
  }, [ot]);

  if (datos?.falta_migracion) {
    return (
      <section aria-label="Costo previsto y real" className="mb-4">
        <div className="g-label mb-1">💲 Costo previsto y real</div>
        <div className="text-xs text-gypi-dim">{datos.falta_migracion}</div>
      </section>
    );
  }
  if (!datos?.ok) return null;
  const hayDetalle = datos.fuera.length + datos.compras.length + datos.gastos.length > 0;
  const pasado = datos.diferencia > 0;

  return (
    <section aria-label="Costo previsto y real" className="mb-4">
      <div className="g-label mb-1">💲 Costo previsto y real</div>
      <div className="bg-gypi-surface rounded-xl p-3 border border-gypi-border">
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div>
            <div className="text-xs text-gypi-dim">Previsto</div>
            <div className="text-[17px] font-bold">{pesos(datos.previsto)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gypi-dim">Real hasta hoy</div>
            <div className={`text-[17px] font-bold ${pasado ? "text-gypi-red" : ""}`}>{pesos(datos.real)}</div>
          </div>
        </div>
        {datos.diferencia !== 0 && (
          <div className={`text-[13px] font-semibold mb-2 ${pasado ? "text-gypi-red" : "text-gypi-green"}`}>
            {pasado ? "⚠ Se gastó " : "✓ Va "}{fmtPesos(Math.abs(datos.diferencia))} {pasado ? "más" : "menos"} de lo previsto{datos.pct != null ? ` (${datos.pct} % de lo previsto)` : ""}
          </div>
        )}
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="text-xs text-gypi-dim text-left">
              <th className="font-semibold py-1 pr-2">Concepto</th>
              <th className="font-semibold py-1 px-1 text-right">Previsto</th>
              <th className="font-semibold py-1 px-1 text-right">Real</th>
              <th className="font-semibold py-1 pl-1 text-right hidden sm:table-cell">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {datos.renglones.map((f) => (
              <tr key={f.id} className="border-t border-gypi-border align-top">
                <td className="py-1.5 pr-2">
                  {f.nombre}
                  {horasDe(f) && <div className="text-xs text-gypi-dim">{horasDe(f)}</div>}
                  <div className="text-xs sm:hidden"><Dif valor={f.diferencia} /></div>
                </td>
                <td className="py-1.5 px-1 text-right whitespace-nowrap">{pesos(f.previsto)}</td>
                <td className="py-1.5 px-1 text-right whitespace-nowrap">{pesos(f.real)}</td>
                <td className="py-1.5 pl-1 text-right whitespace-nowrap hidden sm:table-cell"><Dif valor={f.diferencia} /></td>
              </tr>
            ))}
            <tr className="border-t-2 border-gypi-border font-bold">
              <td className="py-1.5 pr-2">Total sin IVA</td>
              <td className="py-1.5 px-1 text-right whitespace-nowrap">{pesos(datos.previsto)}</td>
              <td className="py-1.5 px-1 text-right whitespace-nowrap">{pesos(datos.real)}</td>
              <td className="py-1.5 pl-1 text-right whitespace-nowrap hidden sm:table-cell"><Dif valor={datos.diferencia} pct={datos.pct} /></td>
            </tr>
          </tbody>
        </table>
        {datos.avisos.length > 0 && <div className="text-xs font-semibold text-gypi-amber-ink mt-2">⚠ {datos.avisos.join(" · ")}</div>}
        <div className="text-xs text-gypi-dim mt-1">Instalación: 8 h por persona por cada día previsto o con reporte. Las facturas de OC no se suman como gasto: su material ya está en el stock o en las compras sin stock.</div>
        {hayDetalle && (
          <button type="button" onClick={() => setVerDetalle((x) => !x)} className="min-h-[40px] bg-transparent border-none cursor-pointer text-xs text-gypi-dim underline p-0 mt-1">
            {verDetalle ? "Ocultar" : "Ver"} qué suma fuera de lo previsto
          </button>
        )}
        {verDetalle && (
          <div className="flex flex-col gap-2 mt-1 text-xs">
            {datos.fuera.length > 0 && (
              <div>
                <div className="font-semibold mb-0.5">Retirado de más o fuera del MRP</div>
                <ul className="list-none m-0 p-0 flex flex-col gap-0.5">
                  {datos.fuera.map((r) => (
                    <li key={r.sku} className="flex gap-2">
                      <span className="flex-1 min-w-0">{r.nombre || r.sku}: {r.fueraMrp ? `${cant(r.retirado)} ${r.unidad || ""} sin estar en el MRP` : `${cant(r.retirado)} retirado de ${cant(r.necesario)} ${r.unidad || ""}`}</span>
                      <span className={r.subtotal == null ? "text-gypi-red" : ""}>{r.subtotal == null ? "sin precio" : fmtPesos(r.subtotal)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {datos.compras.length > 0 && (
              <div>
                <div className="font-semibold mb-0.5">Compras para la OT sin stock</div>
                <ul className="list-none m-0 p-0 flex flex-col gap-0.5">
                  {datos.compras.map((r, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="flex-1 min-w-0">{r.descripcion} · {cant(r.cantidad)} {r.unidad || ""} · OC N° {r.oc_numero}{r.proveedor ? ` · ${r.proveedor}` : ""}</span>
                      <span className={r.subtotal == null ? "text-gypi-red" : ""}>{r.subtotal == null ? "sin precio" : fmtPesos(r.subtotal)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {datos.gastos.length > 0 && (
              <div>
                <div className="font-semibold mb-0.5">Gastos de Finanzas con esta OT</div>
                <ul className="list-none m-0 p-0 flex flex-col gap-0.5">
                  {datos.gastos.map((r) => (
                    <li key={r.id} className="flex gap-2">
                      <span className="flex-1 min-w-0">{fechaCorta(r.fecha)} · {r.descripcion || r.tipo}{r.entidad ? ` · ${r.entidad}` : ""}{r.paraRevisar ? " (para revisar)" : ""}</span>
                      <span>{fmtPesos(r.importe)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
