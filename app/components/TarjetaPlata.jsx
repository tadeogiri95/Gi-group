'use client';
// app/components/TarjetaPlata.jsx — 💰 La plata en el Panel de control, para
// el Dueño (auditoría del 12/11, parte 12; app/lib/panelPlata.js). Cuánto hay
// hoy, lo que nos deben y lo que debemos, cómo queda la caja en 4 semanas y
// las OT que van por debajo del margen mínimo. Cada número lleva a su pantalla.
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { fmtPesos } from "../lib/costo";
import { otsBajoMargen, resumenPlata } from "../lib/panelPlata";

const DIAS_MARGEN = 90;
const corta = (f) => (f ? `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}` : "");
const haceDias = (n) => { const d = new Date(Date.now() - 3 * 3600000); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

function Dato({ titulo, valor, detalle = null, rojo = false, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="flex-1 min-w-[140px] text-left p-3 rounded-[12px] border border-gypi-border bg-gypi-surface cursor-pointer font-body text-gypi-text min-h-[64px]">
      <span className="block text-[12px] font-semibold text-gypi-dim">{titulo}</span>
      <span className={`block text-[18px] font-bold font-mono ${rojo ? "text-gypi-red" : ""}`}>{valor}</span>
      {detalle && <span className="block text-[12px] text-gypi-dim">{detalle}</span>}
    </button>
  );
}

export default function TarjetaPlata({ goto }) {
  const [flujo, setFlujo] = useState(undefined);
  const [margen, setMargen] = useState(null);

  useEffect(() => {
    let vivo = true;
    apiFetch("/api/finanzas/flujo")
      .then(async (r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo) setFlujo(d?.previsto ? resumenPlata(d.previsto) : null); })
      .catch(() => { if (vivo) setFlujo(null); });
    const hoy = haceDias(0);
    apiFetch(`/api/costo-reporte?desde=${haceDias(DIAS_MARGEN)}&hasta=${hoy}`)
      .then(async (r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo && d?.ok) setMargen({ minimo: d.margen_minimo, bajas: otsBajoMargen(d.filas) }); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);

  if (flujo === undefined) {
    return <section aria-label="La plata" className="g-card mb-4"><span className="text-[13px] text-gypi-dim" role="status">💰 Cargando la plata…</span></section>;
  }
  if (!flujo && !margen) return null;
  const ir = (id) => () => goto?.(id);
  return (
    <section aria-label="La plata" className="card-hover g-card mb-4">
      <h3 className="m-0 mb-2.5 font-heading text-[15px] font-bold text-gypi-text">💰 La plata</h3>
      {flujo && (
        <div className="flex flex-wrap gap-2 mb-2">
          <Dato titulo="En cajas y bancos hoy" valor={fmtPesos(flujo.hoy)} rojo={flujo.hoy < 0} onClick={ir("finanzas:fin-tesoreria")} />
          <Dato titulo="Nos deben (OT)" valor={fmtPesos(flujo.nosDeben)} onClick={ir("finanzas:fin-clientes")} />
          <Dato titulo="Debemos a proveedores" valor={fmtPesos(flujo.debemos)} onClick={ir("finanzas:fin-proveedores")} />
          {flujo.en4 != null && <Dato titulo={`Caja al ${corta(flujo.semana4)}`} valor={fmtPesos(flujo.en4)} detalle="con lo que viene" rojo={flujo.en4 < 0} onClick={ir("finanzas:fin-flujo")} />}
        </div>
      )}
      {flujo?.peor && (
        <button type="button" onClick={ir("finanzas:fin-flujo")} role="alert"
          className="w-full text-left mb-2 p-2.5 rounded-[10px] border border-gypi-red bg-transparent cursor-pointer font-body text-[13px] font-semibold text-gypi-red">
          ⚠ La caja queda en {fmtPesos(flujo.peor.saldo)} la semana del {corta(flujo.peor.semana)}. Mirá el flujo de caja.
        </button>
      )}
      {margen && (
        margen.bajas.length ? (
          <button type="button" onClick={ir("proyectos:reportes")}
            className="w-full text-left p-2.5 rounded-[10px] border border-gypi-border bg-gypi-surface cursor-pointer font-body text-[13px] text-gypi-text">
            <span className="block font-semibold text-gypi-amber-ink">⚠ {margen.bajas.length === 1 ? "1 OT va" : `${margen.bajas.length} OT van`} por debajo del margen mínimo ({margen.minimo} %)</span>
            <span className="block text-gypi-dim">{margen.bajas.slice(0, 4).map((b) => `${b.ot}${b.cliente ? ` ${b.cliente}` : ""}: ${String(b.margen).replace(".", ",")} %`).join(" · ")}{margen.bajas.length > 4 ? ` · y ${margen.bajas.length - 4} más` : ""}</span>
            <span className="block text-[12px] text-gypi-dim">Reportes → 💲 Costo por OT</span>
          </button>
        ) : <p className="m-0 text-[13px] text-gypi-dim">✅ Las OT de los últimos {DIAS_MARGEN} días con precio están sobre el margen mínimo ({margen.minimo} %).</p>
      )}
    </section>
  );
}
