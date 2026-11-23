"use client";
// app/components/FinanzasEstadoCuenta.jsx — 📄 Estado de cuenta en PDF para
// mandarle al cliente o al proveedor (20/11). Está en la ficha del cliente,
// en la del proveedor y en la del que es las dos cosas (un solo PDF con las
// dos cuentas y el neto). Por defecto todo el historial; se pueden elegir
// fechas. Reglas en app/lib/finanzasEstadoCuenta.js.
import { useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyAr } from "../lib/finanzasOperaciones";
import { descargarEstadoCuenta, estadoCliente, estadoProveedor } from "../lib/finanzasEstadoCuenta";
import { Chip, Modal } from "./ui";

/**
 * Arma los datos de la hoja con lo que devuelve /api/finanzas/estado-cuenta.
 * @returns {Parameters<typeof descargarEstadoCuenta>[0]}
 */
export function armarEstadoCuenta(d, { desde = "", hasta = "", hoy = hoyAr(), nombre = "" } = {}) {
  const cliente = d.cliente ? estadoCliente(d.cliente, { desde, hasta, hoy }) : null;
  const proveedor = d.proveedor ? estadoProveedor(d.proveedor.movimientos, { desde, hasta, hoy }) : null;
  return {
    empresa: d.empresa || {},
    nombre: nombre || d.cliente?.nombre || d.proveedor?.nombre || "",
    cuit: d.cliente?.cuit || d.proveedor?.cuit || "",
    cliente, proveedor, desde, hasta, hoy,
  };
}

/** Botón que abre la ventanita para descargar el PDF. */
export default function BotonEstadoCuenta({ cliente = "", proveedor = "", nombre = "" }) {
  const [abierto, setAbierto] = useState(false);
  if (!cliente && !proveedor) return null;
  return (
    <>
      <button type="button" className="g-btn g-btn-secondary" onClick={() => setAbierto(true)}>📄 Estado de cuenta en PDF</button>
      {abierto && <EstadoCuenta cliente={cliente} proveedor={proveedor} nombre={nombre} onCerrar={() => setAbierto(false)} />}
    </>
  );
}

function EstadoCuenta({ cliente, proveedor, nombre, onCerrar }) {
  const [fechas, setFechas] = useState(false);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [armando, setArmando] = useState(false);
  const [error, setError] = useState(null);

  async function descargar() {
    const d0 = fechas ? desde : "";
    const h0 = fechas ? hasta : "";
    if (d0 && h0 && d0 > h0) { setError("La fecha desde es posterior a la fecha hasta."); return; }
    setArmando(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (cliente) q.set("cliente", cliente);
      if (proveedor) q.set("proveedor", proveedor);
      const res = await apiFetch(`/api/finanzas/estado-cuenta?${q}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo armar el estado de cuenta");
      await descargarEstadoCuenta(armarEstadoCuenta(d, { desde: d0, hasta: h0, nombre }));
      onCerrar();
    } catch (e) {
      setError(e.message || "No se pudo armar el PDF");
    } finally {
      setArmando(false);
    }
  }

  return (
    <Modal open onClose={onCerrar} title="📄 Estado de cuenta en PDF" maxWidth={460}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px] text-gypi-dim">
          Para mandarle a {nombre || (cliente ? "el cliente" : "el proveedor")}{cliente && proveedor ? " (sale una sola hoja con la cuenta como cliente, como proveedor y el neto)" : ""}.
          No muestra costos, márgenes ni valores estimados: {cliente ? "solo las OT con precio en el Plan y los pagos." : "solo las facturas y los pagos."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Chip active={!fechas} onClick={() => setFechas(false)}>Todo el historial</Chip>
          <Chip active={fechas} onClick={() => setFechas(true)}>Elegir fechas</Chip>
        </div>
        {fechas && (
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-[13px]">Desde<input type="date" className="g-input" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-[13px]">Hasta<input type="date" className="g-input" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
          </div>
        )}
        {cliente && (
          <p className="m-0 text-[12px] text-gypi-dim">Las OT van sin IVA, salvo las que tienen tildado &quot;Lleva IVA (21 %)&quot; (en el detalle de la OT o en la Cuenta por OT).</p>
        )}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <button type="button" className="g-btn g-btn-primary" disabled={armando} onClick={descargar}>{armando ? "Armando el PDF…" : "📥 Descargar PDF"}</button>
      </div>
    </Modal>
  );
}
