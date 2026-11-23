'use client';
// app/components/FinanzasImputar.jsx — Imputar después (19/11, punto 13;
// reglas en app/lib/finanzasImputar.js). Con ☑ Imputar en Movimientos se
// tildan una o varias operaciones y esta barra les pone, todas juntas, un
// cliente, un proveedor, una OT, un centro de costo, una cuenta, una caja,
// un vehículo o una máquina. Las que no se pueden se cuentan con el motivo.
import { useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { textoOt } from "../lib/nombreOt";
import { CAMPOS_IMPUTAR } from "../lib/finanzasImputar";
import { SelectBuscable } from "./ui";
import { useToast } from "./ui/Toast";

const SIN = "__sin__";
/** Los que se pueden sacar (dejar vacíos). */
const SE_SACAN = new Set(["cliente", "proveedor", "ot", "centro_costo", "vehiculo", "maquina"]);

export const nombreVehiculo = (v) => (v ? [v.patente, [v.marca, v.modelo].filter(Boolean).join(" ")].filter(Boolean).join(" · ") : "");
export const nombreMaquina = (m) => (m ? [m.codigo, m.nombre].filter(Boolean).join(" · ") : "");

/** Las opciones de cada campo, de las listas de Finanzas: [[valor, texto]]. */
export function opcionesImputar(campo, datos = {}) {
  const cajas = new Set((datos.tesoreria || []).map((t) => t.cuenta));
  const activo = (x) => x.activo !== false && x.activa !== false;
  if (campo === "cliente") return (datos.clientes || []).filter((c) => activo(c) && !c.unido_a).map((c) => [String(c.id), c.nombre]);
  if (campo === "proveedor") return (datos.proveedores || []).filter(activo).map((p) => [String(p.id), p.nombre]);
  if (campo === "ot") return (datos.proyectos || []).map((p) => [String(p.id), textoOt(p)]);
  if (campo === "centro_costo") return (datos.centros || []).filter(activo).map((c) => [c.codigo, c.nombre ? `${c.codigo} · ${c.nombre}` : c.codigo]);
  if (campo === "cuenta") return (datos.cuentas || []).filter((c) => activo(c) && !cajas.has(c.codigo)).map((c) => [c.codigo, `${c.nombre} (${c.codigo})`]);
  if (campo === "caja") return (datos.tesoreria || []).filter(activo).map((t) => [t.cuenta, t.nombre]);
  if (campo === "vehiculo") return (datos.vehiculos || []).filter(activo).map((v) => [String(v.id), nombreVehiculo(v)]);
  if (campo === "maquina") return (datos.maquinas || []).filter(activo).map((m) => [String(m.id), nombreMaquina(m)]);
  return [];
}

/**
 * @param {{ datos: object, ids: number[], total: number, onTodas: () => void, onNinguna: () => void, onHecho: () => void }} props
 */
export default function BarraImputar({ datos, ids, total, onTodas, onNinguna, onHecho }) {
  const toast = useToast();
  const [campo, setCampo] = useState("ot");
  const [valor, setValor] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [saltadas, setSaltadas] = useState(null);
  const opciones = useMemo(() => opcionesImputar(campo, datos), [campo, datos]);

  async function imputar() {
    if (!ids.length) { toast.error("Tildá al menos una operación"); return; }
    if (!valor) { toast.error(`Elegí ${CAMPOS_IMPUTAR[campo].toLowerCase()}`); return; }
    setGuardando(true);
    setSaltadas(null);
    try {
      const res = await apiFetch("/api/finanzas/operaciones", { method: "POST", body: JSON.stringify({ accion: "imputar", ids, campo, valor: valor === SIN ? null : valor }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo imputar");
      const saltan = d.saltadas || [];
      if (d.imputadas) toast.success(`✅ ${d.imputadas === 1 ? "Imputada 1 operación" : `Imputadas ${d.imputadas} operaciones`}`);
      if (saltan.length) setSaltadas(saltan);
      else onNinguna();
      if (d.imputadas) onHecho();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  }

  // Por qué no se pudo, agrupado: "3 · Sale de otra pantalla: se cambia desde ahí"
  const motivos = saltadas ? [...saltadas.reduce((m, s) => m.set(s.motivo, (m.get(s.motivo) || 0) + 1), new Map())] : [];
  return (
    <section aria-label="Imputar las tildadas" className="sticky bottom-0 z-10 mb-3 p-3 rounded-lg border border-gypi-amber bg-gypi-surface flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-gypi-text">
        <b>{ids.length} tildada{ids.length === 1 ? "" : "s"}</b>
        {ids.length < total && <button type="button" className="min-h-[40px] p-0 bg-transparent border-none font-semibold text-gypi-amber-ink cursor-pointer" onClick={onTodas}>Tildar las {total} de la lista</button>}
        {ids.length > 0 && <button type="button" className="min-h-[40px] p-0 bg-transparent border-none font-semibold text-gypi-dim cursor-pointer" onClick={onNinguna}>Destildar</button>}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">
          Imputar
          <select className="g-input" value={campo} onChange={(e) => { setCampo(e.target.value); setValor(""); }} aria-label="Qué imputar">
            {Object.entries(CAMPOS_IMPUTAR).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text flex-1 min-w-[180px]">
          A
          <SelectBuscable className="g-input w-full" value={valor} onChange={(e) => setValor(e.target.value)} aria-label={`${CAMPOS_IMPUTAR[campo]} a imputar`}>
            <option value="">Elegí…</option>
            {SE_SACAN.has(campo) && <option value={SIN}>(Sacarle {CAMPOS_IMPUTAR[campo].toLowerCase()})</option>}
            {opciones.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </SelectBuscable>
        </label>
        <button type="button" className="g-btn g-btn-primary" disabled={guardando || !ids.length} onClick={imputar}>{guardando ? "Imputando…" : "Imputar"}</button>
      </div>
      {(campo === "vehiculo" || campo === "maquina") && !opciones.length && (
        <p className="m-0 text-[12px] text-gypi-dim">No hay {campo === "vehiculo" ? "vehículos en Flota" : "máquinas en Maquinaria"} todavía.</p>
      )}
      {["cliente", "proveedor", "cuenta", "caja"].includes(campo) && (
        <p className="m-0 text-[12px] text-gypi-dim">Solo en las que se corrigen acá: las de una factura, un cheque o una orden se cambian desde donde salieron.</p>
      )}
      {motivos.length > 0 && (
        <div role="status" className="text-[12px] text-gypi-amber-ink">
          {saltadas.length === 1 ? "Una no se pudo:" : `${saltadas.length} no se pudieron:`}
          <ul className="m-0 pl-4">{motivos.map(([m, n]) => <li key={m}>{n} · {m}</li>)}</ul>
        </div>
      )}
    </section>
  );
}
