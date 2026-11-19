'use client';
// app/components/FinanzasPctMateriales.jsx — El % de materiales, uno solo para
// toda Finanzas (19/11, punto 9). Se cambia en Finanzas → Configuración (o
// desde ⚙ Materiales en el Estado de resultados) y lo usan:
//   - el Estado de resultados y el Reporte financiero (costo de materiales
//     estimado = ese % de las entregas);
//   - las OT sin precio en el Plan (valor = materiales ÷ ese %) en la cuenta
//     corriente de clientes, las entregas estimadas y el Reporte.
// 30 % por defecto. Con 0 el Estado de resultados usa las cuentas de
// materiales y las OT sin precio siguen con el 30 %.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { MATERIALES_PCT } from "../lib/finanzasResultados";
import { textoPctEstimado } from "../lib/finanzasOtClientes";
import { Modal } from "./ui";
import { useToast } from "./ui/Toast";

const pct = (n) => (n == null ? "" : `${String(n).replace(".", ",")} %`);

/** El cuadro para cambiar el % (y si se usa el costo real de cada OT). */
export default function ConfigMateriales({ valor, real: realGuardado = false, onCerrar, onGuardado }) {
  const toast = useToast();
  const [v, setV] = useState(String(valor ?? MATERIALES_PCT).replace(".", ","));
  const [real, setReal] = useState(!!realGuardado);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const res = await apiFetch("/api/finanzas/resultados", { method: "POST", body: JSON.stringify({ accion: "config", materiales_pct: v, materiales_real: real }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo guardar");
      toast.success("Guardado");
      onGuardado();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onCerrar} title="% de materiales" maxWidth={460}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px] text-gypi-dim">
          Cuánto de lo que se cobra por una OT son materiales. Es uno solo para toda Finanzas: el costo de materiales estimado en el Estado de resultados y el Reporte, y el valor de las OT sin precio en el Plan (materiales ÷ este %) en la cuenta de clientes.
        </p>
        <label className="flex flex-col gap-1 text-[13px] font-semibold">
          {real ? "% de materiales (para las OT sin costo en Gypi y las OT sin precio)" : "% de materiales"}
          <input className="g-input w-[120px] text-right" inputMode="decimal" aria-label="Porcentaje de materiales" value={v} onChange={(e) => setV(e.target.value)} />
        </label>
        <p className="m-0 text-[12px] text-gypi-dim">Con 0, el Estado de resultados usa las cuentas de materiales y las OT sin precio siguen con el {pct(MATERIALES_PCT)}.</p>
        <label className="flex items-start gap-2 text-[13px]">
          <input type="checkbox" className="mt-1" checked={real} onChange={(e) => setReal(e.target.checked)} />
          <span><span className="font-semibold">En el Estado de resultados, usar el costo real de cada OT entregada</span><br /><span className="text-gypi-dim">Lo del MRP, lo retirado de más y las compras sin stock de cada OT (💲 Costo por OT). Las entregas de OT sin materiales en Gypi siguen con el %.</span></span>
        </label>
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>
    </Modal>
  );
}

/** La tarjeta de Finanzas → Configuración. */
export function PctMateriales() {
  const [config, setConfig] = useState(null);
  const [abierto, setAbierto] = useState(false);
  const cargar = useCallback(async () => {
    try {
      const res = await apiFetch("/api/finanzas/resultados?solo=config");
      const d = await res.json().catch(() => ({}));
      if (res.ok) setConfig(d.config || { materiales_pct: MATERIALES_PCT });
    } catch {
      // Sin la config, la tarjeta muestra el % por defecto
      setConfig({ materiales_pct: MATERIALES_PCT });
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  const valor = config?.materiales_pct ?? MATERIALES_PCT;
  return (
    <section className="g-card p-4 mb-3" aria-label="% de materiales de Finanzas">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 text-[16px] font-bold text-gypi-text flex-1 min-w-[200px]">🪵 % de materiales: {config ? pct(valor) : "…"}</h2>
        <button type="button" className="g-btn g-btn-secondary" disabled={!config} onClick={() => setAbierto(true)}>Cambiar</button>
      </div>
      <p className="m-0 mt-1 text-[13px] text-gypi-dim">
        Uno solo para toda Finanzas: el costo de materiales estimado del Estado de resultados y el Reporte, y las OT sin precio (materiales ÷ {textoPctEstimado(valor)}) en la cuenta de clientes.{config?.materiales_real ? " En el Estado de resultados se usa el costo real de cada OT entregada." : ""}
      </p>
      {abierto && <ConfigMateriales valor={valor} real={config?.materiales_real} onCerrar={() => setAbierto(false)} onGuardado={() => { setAbierto(false); cargar(); }} />}
    </section>
  );
}
