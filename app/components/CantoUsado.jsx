'use client';
// app/components/CantoUsado.jsx — Materiales → ✂️ Canto usado (pedido de
// Tadeo, 26/11; migración 210). Por OT, el canto que se pegó según los
// escaneos de la etapa de canto (con el desperdicio) y todavía no se asentó
// en el MRP. La oficina revisa el artículo y los metros y aprieta "Asentar en
// el MRP": queda un consumo con la OT, que el script "Gypi" lleva a
// fact_consumos_stock. Reglas en app/lib/cantoConsumo.js; datos de
// /api/stock/canto.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import SelectBuscable from "./ui/SelectBuscable";

const num = (n) => Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 });
const POR = { necesidad: "está en las necesidades de la OT", recordado: "elegido antes", unico: "el único con ese espesor y color" };

/** "12,5" → 12.5; null si no es un número mayor a 0. */
export function leerMetros(texto) {
  const n = Number(String(texto ?? "").trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 && n <= 100000 ? Math.round(n * 1000) / 1000 : null;
}

function TarjetaOt({ ot, cantos, onListo }) {
  const [filas, setFilas] = useState(() => ot.renglones.map((r) => ({ ...r, metrosTexto: String(r.pendiente).replace(".", ","), elegido: r.sku || "" })));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const cambiar = (i, campos) => setFilas((prev) => prev.map((f, j) => (j === i ? { ...f, ...campos } : f)));
  const faltaArticulo = filas.some((f) => !f.elegido);
  const metrosMal = filas.some((f) => leerMetros(f.metrosTexto) == null);

  const asentar = async () => {
    setEnviando(true);
    setError(null);
    try {
      const r = await apiFetch("/api/stock/canto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "asentar", ot: ot.ot, renglones: filas.map((f) => ({ clave: f.clave, sku: f.elegido, metros: leerMetros(f.metrosTexto) })) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo asentar");
      onListo(`OT ${ot.ot}: ${d.cargados === 1 ? "1 consumo asentado" : `${d.cargados} consumos asentados`} en el MRP.`);
    } catch (e) {
      setError(e.message);
      setEnviando(false);
    }
  };

  return (
    <section aria-label={`OT ${ot.ot}`} className="mb-3 p-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
      <h3 className="m-0 mb-2 text-[15px] font-bold">OT {ot.ot}</h3>
      <ul className="list-none p-0 m-0 flex flex-col gap-3">
        {filas.map((f, i) => {
          const lista = f.opciones?.length ? f.opciones : cantos;
          return (
            <li key={f.clave} className="flex flex-col gap-1">
              <div className="text-[14px] font-semibold">{f.texto}</div>
              <div className="text-[12px] text-gypi-dim">
                {f.lados === 1 ? "1 lado pegado" : `${f.lados} lados pegados`} · {num(f.metros)} m con desperdicio
                {f.asentado > 0 ? ` · ya asentado ${num(f.asentado)} m` : ""}
              </div>
              <label className="flex flex-col gap-1 text-[12px] text-gypi-dim">Artículo del MRP{f.elegido && f.por && f.elegido === f.sku ? ` (${POR[f.por]})` : ""}
                <SelectBuscable value={f.elegido} onChange={(e) => cambiar(i, { elegido: e.target.value })} aria-label={`Artículo para ${f.texto}`}>
                  <option value="">{f.opciones?.length ? "Elegí cuál es" : "No encontré uno con ese espesor y color: elegí cuál es"}</option>
                  {lista.map((a) => <option key={a.sku} value={a.sku}>{a.nombre || a.sku}</option>)}
                </SelectBuscable>
              </label>
              <label className="flex items-center gap-2 text-[13px]">Metros
                <input className="g-input w-[110px] text-right" inputMode="decimal" value={f.metrosTexto} aria-label={`Metros de ${f.texto}`}
                  onChange={(e) => cambiar(i, { metrosTexto: e.target.value })} />
              </label>
            </li>
          );
        })}
      </ul>
      {error && <div role="alert" className="mt-2 text-[13px] text-gypi-red">{error}</div>}
      <button onClick={asentar} disabled={enviando || faltaArticulo || metrosMal} className="g-btn g-btn-primary mt-3">
        {enviando ? "Asentando…" : "Asentar en el MRP"}
      </button>
      {(faltaArticulo || metrosMal) && <div className="mt-1 text-[12px] text-gypi-amber-ink">{faltaArticulo ? "Elegí el artículo de cada canto." : "Revisá los metros."}</div>}
    </section>
  );
}

export default function CantoUsado() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [vuelta, setVuelta] = useState(0);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const r = await apiFetch("/api/stock/canto");
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo leer el canto usado");
      setDatos(d);
      setVuelta((v) => v + 1);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const listo = (texto) => { setAviso(texto); cargar(); };

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-28 text-gypi-text">
      <p className="m-0 mb-3 text-[13px] text-gypi-dim">
        Canto pegado según los escaneos de la etapa de canto: cada lado suma su largo de la planilla técnica
        {datos?.pct != null ? ` + ${num(datos.pct)} % de desperdicio (se cambia en Planificación → Parámetros)` : ""}.
        Revisá el artículo y los metros, y asentalo: queda como consumo de la OT en el MRP.
      </p>
      {aviso && <div role="status" className="p-3 mb-3 rounded-[10px] bg-gypi-green/10 text-gypi-green text-[14px]">{aviso}</div>}
      {error && <div role="alert" className="p-3 mb-3 rounded-[10px] bg-gypi-red/10 text-gypi-red text-[14px]">{error}</div>}
      {!datos && !error && <div className="text-[14px] text-gypi-dim">Calculando el canto usado…</div>}
      {datos?.sinEtapa && (
        <div className="text-[14px] text-gypi-dim">Ninguna etapa cuenta por lados. En Configuración → Etapas, a la etapa de canto ponele las columnas L1A, L1B, L2A, L2B.</div>
      )}
      {datos && !datos.sinEtapa && !datos.ots.length && (
        <div className="text-[14px] text-gypi-dim">No hay canto para asentar: todo lo escaneado ya está en el MRP.</div>
      )}
      {datos?.ots.map((ot) => <TarjetaOt key={`${ot.ot}-${vuelta}`} ot={ot} cantos={datos.cantos || []} onListo={listo} />)}
    </div>
  );
}
