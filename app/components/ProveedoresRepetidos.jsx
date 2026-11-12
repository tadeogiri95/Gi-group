'use client';
// app/components/ProveedoresRepetidos.jsx — Compras → Proveedores: los que
// parecen el mismo (mismo CUIT o el mismo nombre escrito distinto) y el botón
// para unirlos (auditoría del 12/11, parte 5; migración 183). Al unir, todo lo
// del repetido pasa al que queda: órdenes de compra, facturas, Finanzas,
// cheques, órdenes de pago, agenda, cotizaciones, services y fallas. El
// repetido queda dado de baja con la nota "Unido a …". Lo hacen el Dueño o el
// Supervisor.
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";

export default function ProveedoresRepetidos({ version, onUnidos }) {
  const [datos, setDatos] = useState(null);
  const [abierto, setAbierto] = useState(false);
  const [confirmar, setConfirmar] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let vivo = true;
    apiFetch("/api/compras?repetidos=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo) setDatos(d); })
      .catch(() => { if (vivo) setDatos(null); });
    return () => { vivo = false; };
  }, [version]);

  const pares = datos?.repetidos || [];
  if (!pares.length) return null;

  const unir = async () => {
    const { queda, sale } = confirmar;
    setEnviando(true);
    setError(null);
    try {
      const res = await apiFetch("/api/compras", { method: "POST", body: JSON.stringify({ accion: "proveedores_unir", queda: queda.id, sale: sale.id }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || "No se pudo unir");
      setConfirmar(null);
      await onUnidos(`Uní ${sale.nombre} a ${queda.nombre}${d.movidos ? ` (pasaron ${d.movidos} registro${d.movidos === 1 ? "" : "s"})` : ""}.`);
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  return (
    <div className="p-2.5 mb-3 rounded-[10px] border border-gypi-amber bg-gypi-amber/10">
      <button type="button" onClick={() => setAbierto((x) => !x)} aria-expanded={abierto}
        className="w-full min-h-[44px] flex items-center gap-2 bg-transparent border-none p-0 cursor-pointer text-left font-body text-gypi-text">
        <span className="flex-1 text-[14px] font-semibold text-gypi-amber-ink">⚠ {pares.length} proveedor{pares.length === 1 ? " parece repetido" : "es parecen repetidos"}</span>
        <span className="text-[13px] text-gypi-dim">{abierto ? "Ocultar" : "Ver"}</span>
      </button>
      {abierto && (
        <div className="mt-1">
          {datos.falta_migracion && <div className="text-[13px] text-gypi-dim mb-2">{datos.falta_migracion}</div>}
          <div className="text-[13px] text-gypi-dim mb-2">
            Mismo CUIT o el mismo nombre escrito distinto. Al unirlos, todo lo del repetido (compras, facturas, Finanzas, cheques, services) pasa al que queda.
          </div>
          <ul aria-label="Proveedores repetidos" className="list-none m-0 p-0 flex flex-col gap-1.5">
            {pares.map((par) => {
              const elegido = confirmar && [par.queda.id, par.sale.id].includes(confirmar.sale.id) && [par.queda.id, par.sale.id].includes(confirmar.queda.id) ? confirmar : null;
              return (
                <li key={`${par.queda.id}-${par.sale.id}`} className="p-2 rounded-[10px] border border-gypi-border bg-gypi-surface">
                  <div className="text-[14px]">
                    <span className="font-semibold">{par.queda.nombre}</span> y <span className="font-semibold">{par.sale.nombre}</span>
                  </div>
                  <div className="text-[12px] text-gypi-dim mb-1.5">{par.por === "cuit" ? `Mismo CUIT ${par.queda.cuit || par.sale.cuit}` : "Mismo nombre"}</div>
                  {!datos.puede_unir ? (
                    <div className="text-[12px] text-gypi-dim">Los une el Dueño o el Supervisor.</div>
                  ) : elegido ? (
                    <div role="alert">
                      <div className="text-[13px] mb-1.5">Queda <b>{elegido.queda.nombre}</b>. <b>{elegido.sale.nombre}</b> se da de baja y todo lo suyo pasa al que queda. No se puede deshacer.</div>
                      {error && <div className="text-[13px] text-gypi-red mb-1.5">{error}</div>}
                      <div className="flex gap-2">
                        <button onClick={() => { setConfirmar(null); setError(null); }} className="g-btn g-btn-secondary flex-1">Cancelar</button>
                        <button onClick={unir} disabled={enviando} className="g-btn g-btn-primary flex-1">{enviando ? "Uniendo…" : "Unir"}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2 flex-wrap">
                      <button onClick={() => { setConfirmar({ queda: par.queda, sale: par.sale }); setError(null); }} className="g-btn g-btn-secondary flex-1 min-w-[140px]">Queda {par.queda.nombre}</button>
                      <button onClick={() => { setConfirmar({ queda: par.sale, sale: par.queda }); setError(null); }} className="g-btn g-btn-secondary flex-1 min-w-[140px]">Queda {par.sale.nombre}</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
