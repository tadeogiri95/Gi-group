'use client';
// app/components/FinanzasIntegracion.jsx — Finanzas unida con Flota,
// Maquinaria y Stock (parte 9 del plan del 11/11; /api/finanzas/integracion,
// reglas en app/lib/finanzasIntegracion.js). Sin migración.
//
//   - CostosMantenimiento (en Movimientos): los services, reparaciones y
//     arreglos de vehículos y las fallas de máquinas con costo que todavía no
//     están en Finanzas. Cada uno abre "Cargar gasto" ya lleno y queda unido
//     al arreglo (no se carga dos veces).
//   - StockValorizado (en Cierre): stock × último precio de compra contra el
//     saldo de las cuentas de bienes de cambio en Gypi.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { plata } from "../lib/finanzasOperaciones";
import CargarGasto from "./FinanzasCargarGasto";
import { Modal } from "./ui";

const fechaCorta = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}` : "");

function useIntegracion() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const cargar = useCallback(async () => {
    try {
      const res = await apiFetch("/api/finanzas/integracion");
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo leer Flota, Maquinaria y Stock");
      setDatos(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  return { datos, error, cargar };
}

/** El aviso en Movimientos y la lista de costos para pasar a Finanzas. */
export function CostosMantenimiento({ datosGasto, onCargado }) {
  const { datos, cargar } = useIntegracion();
  const [abierto, setAbierto] = useState(false);
  const [item, setItem] = useState(null);
  const pendientes = datos?.mantenimiento?.pendientes || [];
  if (!pendientes.length && !item) return null;
  const total = pendientes.reduce((s, p) => s + p.costo, 0);

  return (
    <>
      <button type="button" onClick={() => setAbierto(true)}
        className="w-full mb-3 p-3 rounded-lg border border-gypi-amber/40 bg-gypi-amber/10 text-left text-[14px] font-semibold text-gypi-amber-ink cursor-pointer">
        🔧 {pendientes.length === 1 ? "1 costo" : `${pendientes.length} costos`} de Flota y Maquinaria para pasar a Finanzas ({plata(total)})
      </button>
      {abierto && !item && (
        <Modal open onClose={() => setAbierto(false)} title="Costos de Flota y Maquinaria" maxWidth={640}>
          <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
            <p className="m-0 text-[13px] text-gypi-dim">
              Services, reparaciones y arreglos con costo de los últimos 12 meses que todavía no están en Finanzas. Tocá Cargar: el gasto viene lleno para revisar y queda unido al arreglo.
              {datos.mantenimiento.cargados.n > 0 && ` Ya cargados: ${datos.mantenimiento.cargados.n} (${plata(datos.mantenimiento.cargados.total)}).`}
            </p>
            <ul className="list-none m-0 p-0 flex flex-col gap-1.5" aria-label="Costos para pasar a Finanzas">
              {pendientes.map((p) => (
                <li key={p.vinculo} className="flex flex-wrap items-center gap-2 rounded-lg border border-gypi-border p-2">
                  <span className="flex-1 min-w-[200px]">
                    <span className="block font-semibold">{p.titulo}</span>
                    <span className="block text-[12px] text-gypi-dim">{fechaCorta(p.fecha)}{p.taller ? ` · ${p.taller}` : ""}{p.detalle ? ` · ${p.detalle}` : ""}{p.factura_url ? " · 🧾 con factura" : ""}</span>
                  </span>
                  <b className="font-mono">{plata(p.costo)}</b>
                  <button type="button" className="g-btn g-btn-primary" aria-label={`Cargar ${p.titulo}`} onClick={() => setItem(p)}>Cargar</button>
                </li>
              ))}
            </ul>
            <div className="flex justify-end"><button type="button" className="g-btn g-btn-secondary" onClick={() => setAbierto(false)}>Cerrar</button></div>
          </div>
        </Modal>
      )}
      {item && (
        <CargarGasto
          datos={datosGasto} inicial={item.inicial} arreglo={item}
          onCerrar={() => setItem(null)}
          onGuardada={() => { setItem(null); cargar(); onCargado?.(); }}
        />
      )}
    </>
  );
}

/** El stock valorizado contra la contabilidad (en Cierre). */
export function StockValorizado() {
  const { datos, error } = useIntegracion();
  const s = datos?.stock;
  if (error || !s) return null;
  const top = s.por_familia.slice(0, 8);
  const max = Math.max(1, ...top.map((f) => f.valor));
  return (
    <section aria-label="Stock valorizado" className="mt-4 p-3 border border-gypi-border rounded-lg">
      <h3 className="m-0 mb-1 text-[15px] font-bold text-gypi-text">📦 Stock valorizado</h3>
      <p className="m-0 mb-2 text-[13px] text-gypi-dim">
        Lo que hay hoy en Planta → Stock por el último precio de compra (sin IVA), contra el saldo de las cuentas de bienes de cambio en Gypi. Sirve para el cierre: la diferencia es lo que se usó en las obras o un ajuste de inventario para ver con el contador.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
        <div className="rounded-lg bg-gypi-surface p-2">
          <span className="block text-[12px] text-gypi-dim">Stock valorizado</span>
          <b className="font-mono text-[16px] text-gypi-text">{plata(s.valorizado)}</b>
          <span className="block text-[12px] text-gypi-dim">{s.articulos} artículos con stock</span>
        </div>
        <div className="rounded-lg bg-gypi-surface p-2">
          <span className="block text-[12px] text-gypi-dim">En la contabilidad</span>
          <b className="font-mono text-[16px] text-gypi-text">{plata(s.contable)}</b>
          <span className="block text-[12px] text-gypi-dim">{s.cuentas.map((c) => c.nombre).join(", ") || "Sin movimientos en bienes de cambio"}</span>
        </div>
        <div className="rounded-lg bg-gypi-surface p-2">
          <span className="block text-[12px] text-gypi-dim">Diferencia</span>
          <b className={`font-mono text-[16px] ${Math.abs(s.diferencia) >= 1 ? "text-gypi-amber-ink" : "text-gypi-text"}`}>{plata(s.diferencia)}</b>
          <span className="block text-[12px] text-gypi-dim">{s.diferencia > 0 ? "Hay más stock que en la contabilidad" : s.diferencia < 0 ? "Hay menos stock que en la contabilidad" : "Coinciden"}</span>
        </div>
      </div>
      {s.sin_precio > 0 && <p className="m-0 mb-2 text-[13px] text-gypi-amber-ink">⚠ {s.sin_precio} {s.sin_precio === 1 ? "artículo con stock no tiene" : "artículos con stock no tienen"} último precio: no suman. Se completa al recibir una orden de compra.</p>}
      {top.length > 0 && (
        <ul className="list-none m-0 p-0 flex flex-col gap-1" aria-label="Stock por familia">
          {top.map((f) => (
            <li key={f.familia} className="grid grid-cols-[minmax(90px,1fr)_2fr_auto] items-center gap-2 text-[13px] text-gypi-text">
              <span className="truncate">{f.familia}</span>
              <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="w-full h-2" aria-hidden="true"><rect width="100" height="8" rx="4" className="fill-gypi-surf-lo" /><rect width={Math.max(1, Math.round((f.valor / max) * 100))} height="8" rx="4" className="fill-gypi-cyan" /></svg>
              <span className="font-mono text-right">{plata(f.valor)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
