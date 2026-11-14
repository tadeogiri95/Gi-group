'use client';
// app/components/FinanzasTransferir.jsx — pasar plata entre cajas y bancos
// (una TRANSFERENCIA ENTRE CAJAS; /api/finanzas/tesoreria accion "transferir").
// Antes vivía dentro de 💰 Tesorería; desde la etapa 3 de la auditoría (14/11)
// es el formulario de "⇄ Entre cajas y bancos" del botón ➕ Cargar.
import { useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyAr, numero } from "../lib/finanzasOperaciones";
import AvisoRepetidos, { repetidosDe } from "./FinanzasAvisoRepetidos";
import { Modal, SelectBuscable } from "./ui";
import { useToast } from "./ui/Toast";

async function postTesoreria(body) {
  const res = await apiFetch("/api/finanzas/tesoreria", { method: "POST", body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(d.error || "No se pudo guardar"), { status: res.status, datos: d });
  return d;
}

function campo(label, input) {
  return <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">{label}{input}</label>;
}

/* ─── Pasar plata entre cajas ────────────────────────────────────────── */

export default function Transferir({ datos, desdeInicial = "", onCerrar, onHecho }) {
  const toast = useToast();
  const vivas = datos.tesoreria.filter((t) => t.activa !== false);
  const [f, setF] = useState({ desde: desdeInicial, hacia: "", importe: "", fecha: hoyAr(), tipo_cambio: "", descripcion: "" });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [repetidos, setRepetidos] = useState(null);
  const set = (k) => (e) => { setRepetidos(null); setF((x) => ({ ...x, [k]: e.target.value })); };
  const desde = vivas.find((t) => t.cuenta === f.desde);
  const usd = desde?.moneda === "USD";

  async function guardar(confirmarRepetido = false) {
    setError(null);
    setGuardando(true);
    try {
      await postTesoreria({ accion: "transferir", ...f, importe: numero(f.importe), tipo_cambio: usd ? numero(f.tipo_cambio) : null, confirmar_repetido: confirmarRepetido });
      toast.success("Listo: la plata pasó de caja");
      onHecho();
    } catch (e) {
      const rep = repetidosDe(e.status, e.datos);
      if (rep) setRepetidos(rep);
      else setError(e.message);
      setGuardando(false);
    }
  }

  const opciones = (excluir) => vivas.filter((t) => t.cuenta !== excluir && (!desde || excluir !== f.desde || (t.moneda === "USD") === usd));
  return (
    <Modal open onClose={onCerrar} title="Pasar plata entre cajas" maxWidth={480}>
      <div className="flex flex-col gap-3">
        {campo("Sale de", (
          <SelectBuscable className="g-input w-full" aria-label="Sale de" value={f.desde} onChange={set("desde")}>
            <option value="">Elegí…</option>
            {vivas.map((t) => <option key={t.cuenta} value={t.cuenta}>{t.nombre}</option>)}
          </SelectBuscable>
        ))}
        {campo("Va a", (
          <SelectBuscable className="g-input w-full" aria-label="Va a" value={f.hacia} onChange={set("hacia")}>
            <option value="">Elegí…</option>
            {opciones(f.desde).map((t) => <option key={t.cuenta} value={t.cuenta}>{t.nombre}</option>)}
          </SelectBuscable>
        ))}
        <div className="flex flex-wrap gap-2">
          {campo(usd ? "Importe (USD)" : "Importe", <input className="g-input w-[160px] text-right font-mono" inputMode="decimal" aria-label="Importe" value={f.importe} onChange={set("importe")} />)}
          {campo("Fecha", <input type="date" className="g-input" aria-label="Fecha" value={f.fecha} onChange={set("fecha")} />)}
          {usd && campo("Tipo de cambio", <input className="g-input w-[120px]" inputMode="decimal" aria-label="Tipo de cambio" value={f.tipo_cambio} onChange={set("tipo_cambio")} />)}
        </div>
        {campo("Nota (opcional)", <input className="g-input w-full" aria-label="Nota" maxLength={300} value={f.descripcion} onChange={set("descripcion")} />)}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        {repetidos
          ? <AvisoRepetidos repetidos={repetidos} ocupado={guardando} onCargarIgual={() => guardar(true)} onCancelar={() => setRepetidos(null)} />
          : (
            <div className="flex justify-end gap-2">
              <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
              <button type="button" className="g-btn g-btn-primary" disabled={guardando || !f.desde || !f.hacia} onClick={() => guardar()}>{guardando ? "Guardando…" : "Pasar la plata"}</button>
            </div>
          )}
      </div>
    </Modal>
  );
}
