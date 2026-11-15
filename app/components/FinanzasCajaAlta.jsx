'use client';
// app/components/FinanzasCajaAlta.jsx — 💰 Tesorería (15/11, pedido de Tadeo):
// crear una caja con solo el nombre (el código lo pone Gypi) y eliminarla
// (se borra si nunca se usó; si tuvo movimientos se archiva con saldo en
// cero). Reglas en app/lib/finanzasCajas.js; /api/finanzas (caja_nueva,
// caja_eliminar, guardar para volver a activar). Migración 195 para borrar.
import { useState } from "react";
import { apiFetch } from "../lib/supabase";
import { plata } from "../lib/finanzasOperaciones";
import { TIPOS_CAJA_NUEVA, comoEliminarCaja } from "../lib/finanzasCajas";
import { Chip, Modal, SelectBuscable } from "./ui";
import { useToast } from "./ui/Toast";

async function postFin(body) {
  const res = await apiFetch("/api/finanzas", { method: "POST", body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "No se pudo guardar");
  return d;
}

function campo(label, input) {
  return (
    <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">
      {label}
      {input}
    </label>
  );
}

/** ➕ Nueva caja: nombre, tipo, moneda y responsable. */
export function NuevaCaja({ personal = [], onCerrar, onCreada }) {
  const toast = useToast();
  const [f, setF] = useState({ nombre: "", tipo: "caja", moneda: "ARS", responsable_id: "" });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => { setError(null); setF((x) => ({ ...x, [k]: e.target.value })); };

  const guardar = async () => {
    if (!f.nombre.trim()) { setError("Poné el nombre de la caja."); return; }
    setGuardando(true);
    try {
      const d = await postFin({ accion: "caja_nueva", caja: { ...f, responsable_id: f.responsable_id || null } });
      toast.success(`✅ ${d.fila.nombre} creada${d.reusa ? " (con su cuenta del plan)" : ""}`);
      onCreada(d.fila);
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal open onClose={onCerrar} title="Nueva caja" maxWidth={480}>
      <div className="flex flex-col gap-3">
        {campo("Nombre", <input className="g-input w-full" value={f.nombre} onChange={set("nombre")} placeholder="Caja Desarrollista" autoFocus />)}
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold text-gypi-text">Tipo</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tipo">
            {Object.entries(TIPOS_CAJA_NUEVA).map(([k, v]) => <Chip key={k} active={f.tipo === k} onClick={() => setF((x) => ({ ...x, tipo: k }))}>{v}</Chip>)}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold text-gypi-text">Moneda</span>
          <div className="flex gap-1.5" role="group" aria-label="Moneda">
            <Chip active={f.moneda === "ARS"} onClick={() => setF((x) => ({ ...x, moneda: "ARS" }))}>Pesos</Chip>
            <Chip active={f.moneda === "USD"} onClick={() => setF((x) => ({ ...x, moneda: "USD" }))}>Dólares</Chip>
          </div>
        </div>
        {campo("Responsable (la carga desde su celular, en 📱 Mi caja)", (
          <SelectBuscable className="g-input w-full" value={f.responsable_id} onChange={set("responsable_id")}>
            <option value="">Sin responsable</option>
            {personal.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </SelectBuscable>
        ))}
        <p className="m-0 text-[12px] text-gypi-dim">
          El código de cuenta lo pone Gypi, al lado de las otras cajas, y la suma al plan de cuentas. Si en el plan ya hay una cuenta con ese nombre, usa esa.
        </p>
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex gap-2">
          <button type="button" className="g-btn g-btn-primary" disabled={guardando} onClick={guardar}>{guardando ? "Creando…" : "Crear caja"}</button>
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * 🗑 Eliminar una caja. Lo que se ve acá es con las operaciones de Tesorería
 * (sin anuladas); el servidor vuelve a mirar todo antes de borrar.
 */
export function EliminarCaja({ caja, operaciones = [], onCerrar, onHecho }) {
  const toast = useToast();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const r = comoEliminarCaja(caja, operaciones);

  const eliminar = async () => {
    setGuardando(true);
    try {
      const d = await postFin({ accion: "caja_eliminar", cuenta: caja.cuenta });
      toast.success(d.accion === "borrar" ? `🗑 ${caja.nombre} eliminada` : `📦 ${caja.nombre} archivada`);
      if (d.aviso) toast.error(d.aviso);
      onHecho();
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal open onClose={onCerrar} title={`Eliminar ${caja.nombre}`} maxWidth={480}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        {r.accion === "saldo" ? (
          <p className="m-0">
            Tiene <b className="font-mono">{plata(r.saldo, caja.moneda)}</b>. Primero pasá esa plata a otra caja (➕ Cargar → Entre cajas y bancos);
            con el saldo en cero la podés archivar.
          </p>
        ) : r.accion === "archivar" ? (
          <p className="m-0">
            Tiene {r.movimientos === 1 ? "1 movimiento" : `${r.movimientos} movimientos`}, así que no se borra: se <b>archiva</b>.
            Deja de aparecer en las listas, pero sus movimientos quedan y se ve con “Ver las inactivas”. Se puede volver a activar.
          </p>
        ) : (
          <p className="m-0">Nunca tuvo movimientos: se borra.</p>
        )}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex gap-2">
          {r.accion !== "saldo" && (
            <button type="button" className="g-btn g-btn-primary" disabled={guardando} onClick={eliminar}>
              {guardando ? "Un momento…" : r.accion === "archivar" ? "📦 Archivar" : "🗑 Eliminar"}
            </button>
          )}
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>{r.accion === "saldo" ? "Entendido" : "Cancelar"}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Volver a activar una caja archivada. */
export async function reactivarCaja(caja) {
  return postFin({ accion: "guardar", tabla: "tesoreria", fila: { cuenta: caja.cuenta, nombre: caja.nombre, tipo: caja.tipo, moneda: caja.moneda, activa: true } });
}
