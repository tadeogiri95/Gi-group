'use client';
// app/components/FinanzasCorregir.jsx — ✏ Corregir un movimiento (pedido de
// Tadeo del 12/11; reglas en app/lib/finanzasCorregir.js). Se usa en el
// detalle de Movimientos y en la ficha de cada caja o banco.
//
// La operación vieja queda anulada ("corregida") y se carga una nueva con lo
// cambiado: fecha, importe, cuentas, descripción y referencia.
import { useState } from "react";
import { apiFetch } from "../lib/supabase";
import { SelectBuscable } from "./ui";
import AvisoRepetidos, { repetidosDe } from "./FinanzasAvisoRepetidos";
import { useToast } from "./ui/Toast";

function campo(label, input) {
  return (
    <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">
      {label}
      {input}
    </label>
  );
}

const importeTexto = (n) => String(Math.round((Number(n) || 0) * 100) / 100).replace(".", ",");
const leerImporte = (s) => {
  const t = String(s ?? "").trim().replace(/\s/g, "");
  if (!t) return NaN;
  // "1.234.567,89" o "1234567,89" o "1234567.89"
  const limpio = /,\d{1,2}$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  return Number(limpio);
};

export default function CorregirOperacion({ op, cuentas = [], onCancelar, onCorregida }) {
  const toast = useToast();
  const [f, setF] = useState({
    fecha: op.fecha, total: importeTexto(op.total), cuenta_debe: op.cuenta_debe, cuenta_haber: op.cuenta_haber,
    descripcion: op.descripcion || "", referencia: op.referencia || "", tipo_cambio: op.tipo_cambio ? String(op.tipo_cambio) : "",
  });
  const [guardando, setGuardando] = useState(false);
  const [repetidos, setRepetidos] = useState(null);
  const cambiar = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const nombreCuenta = (c) => cuentas.find((x) => x.codigo === c)?.nombre || c;
  const opciones = (actual) => [
    ...cuentas.filter((c) => c.activa !== false || c.codigo === actual),
    ...(actual && !cuentas.some((c) => c.codigo === actual) ? [{ codigo: actual, nombre: actual }] : []),
  ];

  async function guardar(confirmarRepetido = false) {
    const total = leerImporte(f.total);
    if (!(total > 0)) { toast.error("El importe tiene que ser mayor a cero"); return; }
    setGuardando(true);
    try {
      const cambios = { fecha: f.fecha, total, cuenta_debe: f.cuenta_debe, cuenta_haber: f.cuenta_haber, descripcion: f.descripcion, referencia: f.referencia };
      if (op.moneda === "USD") cambios.tipo_cambio = leerImporte(f.tipo_cambio);
      const res = await apiFetch("/api/finanzas/operaciones", { method: "POST", body: JSON.stringify({ accion: "corregir", id: op.id, cambios, confirmar_repetido: confirmarRepetido }) });
      const d = await res.json().catch(() => ({}));
      const rep = repetidosDe(res.status, d);
      if (rep) { setRepetidos(rep); return; }
      if (!res.ok) throw new Error(d.error || "No se pudo corregir");
      toast.success("✅ Corregida: la anterior queda anulada");
      onCorregida(d.operacion);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section aria-label="Corregir la operación" className="rounded-lg border border-gypi-border bg-gypi-surface p-3 flex flex-col gap-2">
      <p className="m-0 text-[13px] text-gypi-dim">La operación de ahora queda anulada (se ve tachada, como corregida) y se carga una nueva con lo que cambies.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {campo("Fecha", <input type="date" className="g-input w-full" value={f.fecha} onChange={cambiar("fecha")} />)}
        {campo(`Importe${op.moneda === "USD" ? " en dólares" : ""}`, <input inputMode="decimal" className="g-input w-full font-mono" value={f.total} onChange={cambiar("total")} />)}
        {op.moneda === "USD" && campo("Tipo de cambio", <input inputMode="decimal" className="g-input w-full font-mono" value={f.tipo_cambio} onChange={cambiar("tipo_cambio")} />)}
        {campo("Debe (entra a)", (
          <SelectBuscable className="g-input w-full" value={f.cuenta_debe} onChange={cambiar("cuenta_debe")} aria-label="Cuenta del debe">
            {opciones(f.cuenta_debe).map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
          </SelectBuscable>
        ))}
        {campo("Haber (sale de)", (
          <SelectBuscable className="g-input w-full" value={f.cuenta_haber} onChange={cambiar("cuenta_haber")} aria-label="Cuenta del haber">
            {opciones(f.cuenta_haber).map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
          </SelectBuscable>
        ))}
      </div>
      {campo("Descripción", <input className="g-input w-full" value={f.descripcion} maxLength={500} onChange={cambiar("descripcion")} />)}
      {campo("Referencia", <input className="g-input w-full" value={f.referencia} maxLength={120} onChange={cambiar("referencia")} />)}
      {(f.cuenta_debe !== op.cuenta_debe || f.cuenta_haber !== op.cuenta_haber) && (
        <p className="m-0 text-[12px] text-gypi-dim">Queda: entra a {nombreCuenta(f.cuenta_debe)} y sale de {nombreCuenta(f.cuenta_haber)}.</p>
      )}
      {repetidos
        ? <AvisoRepetidos repetidos={repetidos} ocupado={guardando} textoIgual="Es otro distinto, corregirla igual" onCargarIgual={() => guardar(true)} onCancelar={() => setRepetidos(null)} />
        : (
          <div className="flex justify-end gap-2">
            <button type="button" className="g-btn g-btn-secondary" onClick={onCancelar}>Cancelar</button>
            <button type="button" className="g-btn g-btn-primary" disabled={guardando} onClick={() => guardar()}>{guardando ? "Guardando…" : "Guardar corrección"}</button>
          </div>
        )}
    </section>
  );
}
