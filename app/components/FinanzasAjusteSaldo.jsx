'use client';
// app/components/FinanzasAjusteSaldo.jsx — ⚖ Ajustar saldo de un cliente o un
// proveedor (19/11, punto 15; reglas en app/lib/finanzasAjusteSaldo.js). Se
// elige en cuánto tiene que quedar el saldo, la fecha y el motivo. Va contra
// "Ajuste de resultados de ejercicios anteriores": no mueve ninguna caja ni
// el resultado del período.
import { useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyAr, plata } from "../lib/finanzasOperaciones";
import { MAX_MOTIVO_AJUSTE, NOMBRE_CUENTA_AJUSTE, leerImporte } from "../lib/finanzasAjusteSaldo";
import { Modal } from "./ui";
import { useToast } from "./ui/Toast";

const TEXTOS = {
  cliente: { url: "/api/finanzas/clientes", debe: "Nos debe", favor: "A favor del cliente" },
  proveedor: { url: "/api/finanzas/proveedores", debe: "Le debemos", favor: "A favor nuestro" },
};

/** "Nos debe $ 1.000", "A favor del cliente $ 200" o "Al día". */
export function textoSaldoAjuste(lado, saldo) {
  const t = TEXTOS[lado];
  if (saldo >= 0.01) return `${t.debe} ${plata(saldo, "ARS")}`;
  if (saldo <= -0.01) return `${t.favor} ${plata(-saldo, "ARS")}`;
  return "Al día";
}

/**
 * @param {{ lado: "cliente"|"proveedor", clave: string, nombre: string, saldo: number, onCerrar: () => void, onHecho: () => void }} props
 *   saldo: cliente = lo que nos debe; proveedor = lo que le debemos.
 */
export default function AjusteSaldo({ lado, clave, nombre, saldo, onCerrar, onHecho }) {
  const toast = useToast();
  const t = TEXTOS[lado];
  const [f, setF] = useState({ importe: "0", sentido: "debe", fecha: hoyAr(), motivo: "" });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const importe = leerImporte(f.importe);
  const nuevo = importe === null ? null : (f.sentido === "favor" ? -1 : 1) * Math.abs(importe);
  const diferencia = nuevo === null ? null : Math.round((nuevo - saldo) * 100) / 100;

  async function guardar() {
    setError(null);
    if (nuevo === null) { setError("Escribí en cuánto tiene que quedar el saldo"); return; }
    if (Math.abs(diferencia) < 0.01) { setError("El saldo ya es ese: no hay nada que ajustar"); return; }
    if (f.motivo.trim().length < 3) { setError("Escribí el motivo del ajuste"); return; }
    setGuardando(true);
    try {
      const res = await apiFetch(t.url, { method: "POST", body: JSON.stringify({ accion: "ajuste_saldo", clave, saldo_nuevo: nuevo, fecha: f.fecha, motivo: f.motivo }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo ajustar");
      toast.success(d.cuenta_creada ? `✅ Saldo ajustado. Se creó la cuenta "${NOMBRE_CUENTA_AJUSTE}" (${d.cuenta_creada}).` : "✅ Saldo ajustado");
      onHecho();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={guardando ? () => {} : onCerrar} title={`⚖ Ajustar saldo · ${nombre || ""}`} maxWidth={520}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0">Hoy: <b>{textoSaldoAjuste(lado, saldo)}</b></p>
        <p className="m-0 text-[12px] text-gypi-dim">
          Para dejar la cuenta corriente en lo que corresponde. Va contra &quot;{NOMBRE_CUENTA_AJUSTE}&quot; (patrimonio): no mueve ninguna caja ni banco y no cambia el resultado del mes.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[13px] font-semibold flex-1 min-w-[140px]">
            Tiene que quedar en
            <input className="g-input w-full" inputMode="decimal" value={f.importe} onChange={set("importe")} placeholder="0,00" />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            <span className="sr-only">Para qué lado</span>
            <select className="g-input" aria-label="Para qué lado" value={f.sentido} onChange={set("sentido")}>
              <option value="debe">{t.debe}</option>
              <option value="favor">{t.favor}</option>
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1 text-[13px] font-semibold">Fecha del ajuste<input type="date" className="g-input" value={f.fecha} onChange={set("fecha")} /></label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold">
          Motivo (queda en la cuenta corriente)
          <input className="g-input" value={f.motivo} onChange={set("motivo")} maxLength={MAX_MOTIVO_AJUSTE} placeholder="Ej.: diferencia vieja del libro" />
        </label>
        {diferencia !== null && Math.abs(diferencia) >= 0.01 && (
          <p role="status" className="m-0 text-[13px]">
            Queda <b>{textoSaldoAjuste(lado, nuevo)}</b>: el ajuste {diferencia > 0 ? "suma" : "resta"} <b>{plata(Math.abs(diferencia), "ARS")}</b>.
          </p>
        )}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" disabled={guardando} onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Ajustar"}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Anular un ajuste desde la cuenta corriente (va por Movimientos: se anula, no se borra). */
export async function anularAjuste(id) {
  const res = await apiFetch("/api/finanzas/operaciones", { method: "POST", body: JSON.stringify({ accion: "anular", id }) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "No se pudo anular el ajuste");
  return d;
}
