"use client";
// app/components/FinanzasDescargarExtracto.jsx — Finanzas: 📥 Descargar
// extracto de cajas y bancos en PDF o Excel (13/11). Se abre desde
// Movimientos (con el período y los filtros de esa pantalla) y desde la ficha
// de cada caja o banco (solo esa cuenta). Reglas en
// app/lib/finanzasExtractoDescarga.js.
import { useState } from "react";
import { apiFetch } from "../lib/supabase";
import { textoOt } from "../lib/nombreOt";
import { nombreTipo } from "../lib/finanzasTipos";
import { hoyAr, inicioMes } from "../lib/finanzasOperaciones";
import { armarExtracto, descargarExtracto, hayFiltros } from "../lib/finanzasExtractoDescarga";
import { Modal } from "./ui";

async function leerJson(url, error) {
  const res = await apiFetch(url);
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || error);
  return d;
}

/**
 * @param {{
 *   onCerrar: () => void,
 *   desde?: string, hasta?: string,
 *   filtros?: object, filtrosTexto?: string[],
 *   caja?: string,                       // solo esa caja o banco
 *   operaciones?: any[], tesoreria?: any[], // las de Cajas y bancos (todas las fechas), si ya están
 *   listas?: { tipos?: any[], cuentas?: any[], proveedores?: any[], proyectos?: any[] },
 * }} props
 */
export default function DescargarExtracto({ onCerrar, desde: desde0, hasta: hasta0, filtros = {}, filtrosTexto = [], caja = "", operaciones, tesoreria, listas }) {
  const [periodo, setPeriodo] = useState(() => ({ desde: desde0 || inicioMes(hoyAr()), hasta: hasta0 || hoyAr() }));
  const [armando, setArmando] = useState(null);
  const [error, setError] = useState(null);
  const conFiltros = hayFiltros(filtros);

  const descargar = async (formato) => {
    if (periodo.desde > periodo.hasta) { setError("La fecha desde es posterior a la fecha hasta."); return; }
    setArmando(formato);
    setError(null);
    try {
      // Todas las operaciones de las cajas (para el saldo inicial), y los nombres de proveedores y OT
      const [teso, lis] = await Promise.all([
        operaciones && tesoreria ? { operaciones, tesoreria } : leerJson("/api/finanzas/tesoreria", "No se pudieron leer las cajas y bancos"),
        listas?.proveedores && listas?.proyectos && listas?.tipos ? listas : leerJson(`/api/finanzas/operaciones?desde=${hoyAr()}&hasta=${hoyAr()}`, "No se pudieron leer los proveedores y las OT"),
      ]);
      const prov = new Map((lis.proveedores || []).map((p) => [String(p.id), p.nombre]));
      const ots = new Map((lis.proyectos || []).map((p) => [String(p.id), p]));
      const tipos = new Map((lis.tipos || teso.tipos || []).map((t) => [t.codigo, t]));
      const cuentas = new Map((lis.cuentas || teso.cuentas || []).map((c) => [c.codigo, c.nombre]));
      const ex = armarExtracto({
        operaciones: teso.operaciones || [],
        tesoreria: teso.tesoreria || [],
        desde: periodo.desde,
        hasta: periodo.hasta,
        filtros: { ...filtros, caja: caja || filtros.caja || "" },
        nombres: {
          entidad: (op) => (op.proveedor_id ? prov.get(String(op.proveedor_id)) : null) || op.entidad || "",
          ot: (op) => (op.proyecto_id && ots.get(String(op.proyecto_id)) ? textoOt(ots.get(String(op.proyecto_id))) : ""),
        },
        nombreTipo: (c) => nombreTipo(tipos.get(c) || { codigo: c }),
        nombreCuenta: (c) => cuentas.get(c) || c,
      });
      if (!ex.bloques.length) throw new Error("No hay movimientos de cajas ni bancos en el período con esos filtros.");
      await descargarExtracto(ex, formato, { filtrosTexto });
      onCerrar();
    } catch (e) {
      setError(e.message || "No se pudo armar el extracto");
    } finally {
      setArmando(null);
    }
  };

  const fecha = (k, label) => (
    <label className="flex flex-col gap-1 text-[12px] font-semibold text-gypi-dim">
      {label}
      <input type="date" className="g-input" value={periodo[k]} onChange={(e) => e.target.value && setPeriodo((p) => ({ ...p, [k]: e.target.value }))} />
    </label>
  );

  return (
    <Modal open onClose={onCerrar} title="Descargar extracto" maxWidth={480}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px] text-gypi-dim">
          Lo que entró y salió de {caja ? "esta cuenta" : "cada caja y banco"}, con el saldo inicial, los ingresos, los egresos y el saldo final.
          Las cuentas en dólares van en dólares. Lo anulado no sale.
        </p>
        <div className="flex flex-wrap gap-2">
          {fecha("desde", "Desde")}
          {fecha("hasta", "Hasta")}
        </div>
        {filtrosTexto.length > 0 && <p className="m-0 text-[13px]">Filtros: <b>{filtrosTexto.join(" · ")}</b></p>}
        {conFiltros && (
          <p className="m-0 text-[12px] text-gypi-amber-ink">
            Con filtros, los ingresos y egresos son solo de lo filtrado. El saldo inicial y el final son los de toda la cuenta.
          </p>
        )}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="g-btn g-btn-primary flex-1" disabled={!!armando} onClick={() => descargar("pdf")}>
            {armando === "pdf" ? "Armando el PDF…" : "📄 PDF"}
          </button>
          <button type="button" className="g-btn g-btn-secondary flex-1" disabled={!!armando} onClick={() => descargar("xlsx")}>
            {armando === "xlsx" ? "Armando el Excel…" : "📊 Excel"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
