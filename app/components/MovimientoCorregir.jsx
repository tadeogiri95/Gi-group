'use client';
// app/components/MovimientoCorregir.jsx — ✏ Corregir un movimiento de
// Materiales y 🕓 su historial (19/11, punto 12; migración 199; reglas en
// movimientoCorregido de app/lib/movimientosStock.js).
//
// Se corrige la fecha, la cantidad, la OT, las notas y, en un ingreso, el
// precio. El movimiento queda anulado y se carga uno nuevo con lo corregido
// (la planilla MRP cambia su renglón); los dos guardan qué cambió y quién.
import { useState } from "react";
import { apiFetch } from "../lib/supabase";
import { CAMPOS_MOVIMIENTO, DIAS_ATRAS_MOVIMIENTO, diaDelMovimiento, hoyMovimiento, leerCantidadMovimiento } from "../lib/movimientosStock";
import { historialDe } from "../lib/historialCambios";
import HistorialCambios from "./HistorialCambios";

const numeroTexto = (n) => (n === null || n === undefined || n === "" ? "" : String(Number(n)).replace(".", ","));

/** Las entradas del historial de un movimiento: carga, correcciones y anulación. */
export const historialMovimiento = (m) => historialDe(m, { anuladaAt: m?.anulado ? m.anulado_at : null, cargadaPor: m?.empleado_nombre || null });

export function HistorialMovimiento({ m }) {
  return <HistorialCambios entradas={historialMovimiento(m)} etiquetas={CAMPOS_MOVIMIENTO} />;
}

/**
 * @param {{ m: object, onCancelar: () => void, onCorregido: () => void }} props
 */
export default function MovimientoCorregir({ m, onCancelar, onCorregido }) {
  const [f, setF] = useState(() => ({
    fecha: diaDelMovimiento(m) || hoyMovimiento(), cantidad: numeroTexto(m.cantidad), ot: m.ot || "", notas: m.notas || "",
    precio: numeroTexto(m.precio_unitario),
  }));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const cambiar = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const ingreso = m.tipo === "ingreso";

  async function guardar() {
    const cantidad = leerCantidadMovimiento(f.cantidad, { conSigno: m.tipo === "ajuste" });
    if (cantidad === null) { setError("La cantidad no es válida"); return; }
    const precio = f.precio.trim() ? leerCantidadMovimiento(f.precio) : null;
    if (ingreso && f.precio.trim() && precio === null) { setError("El precio no es válido"); return; }
    setGuardando(true);
    setError(null);
    try {
      const cambios = { fecha: f.fecha, cantidad, ot: f.ot.trim() || null, notas: f.notas.trim() || null, ...(ingreso ? { precio_unitario: precio } : {}) };
      const res = await apiFetch("/api/stock/movimientos", { method: "POST", body: JSON.stringify({ accion: "corregir", id: m.id, cambios }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || "No se pudo corregir");
      onCorregido(d);
    } catch (e) {
      setError(e.message);
    }
    setGuardando(false);
  }

  return (
    <section aria-label="Corregir el movimiento" className="mt-2 p-3 rounded-[10px] border border-gypi-border bg-gypi-bg flex flex-col gap-1">
      <p className="m-0 mb-1 text-[12px] text-gypi-dim">Lo que cambies queda en el 🕓 Historial, con quién y cuándo. La planilla MRP cambia su renglón sola.</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="g-label" htmlFor={`corr-fecha-${m.id}`}>Fecha</label>
          <input id={`corr-fecha-${m.id}`} type="date" className="g-input w-full" value={f.fecha} onChange={cambiar("fecha")}
            max={hoyMovimiento()} min={hoyMovimiento(new Date(Date.now() - DIAS_ATRAS_MOVIMIENTO * 86400000))} />
        </div>
        <div>
          <label className="g-label" htmlFor={`corr-cant-${m.id}`}>Cantidad{m.unidad ? ` (${m.unidad})` : ""}</label>
          <input id={`corr-cant-${m.id}`} className="g-input w-full" inputMode="decimal" value={f.cantidad} onChange={cambiar("cantidad")} />
        </div>
        <div>
          <label className="g-label" htmlFor={`corr-ot-${m.id}`}>OT (opcional)</label>
          <input id={`corr-ot-${m.id}`} className="g-input w-full" value={f.ot} onChange={cambiar("ot")} maxLength={40} />
        </div>
        {ingreso && (
          <div>
            <label className="g-label" htmlFor={`corr-precio-${m.id}`}>Precio unitario (sin IVA)</label>
            <input id={`corr-precio-${m.id}`} className="g-input w-full" inputMode="decimal" value={f.precio} onChange={cambiar("precio")} />
          </div>
        )}
      </div>
      <label className="g-label" htmlFor={`corr-notas-${m.id}`}>Notas (opcional)</label>
      <input id={`corr-notas-${m.id}`} className="g-input w-full" value={f.notas} onChange={cambiar("notas")} maxLength={300} />
      {error && <div role="alert" className="text-[13px] text-gypi-red">{error}</div>}
      <div className="flex gap-2 mt-1">
        <button type="button" onClick={onCancelar} className="g-btn g-btn-secondary flex-1">Cancelar</button>
        <button type="button" onClick={guardar} disabled={guardando} className="g-btn g-btn-primary flex-1">{guardando ? "Guardando…" : "Guardar corrección"}</button>
      </div>
    </section>
  );
}
