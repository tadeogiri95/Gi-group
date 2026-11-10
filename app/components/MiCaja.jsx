'use client';
// app/components/MiCaja.jsx — "📱 Mi caja" (Finanzas, parte F3b; migración
// 176; /api/mi-caja; reglas en app/lib/finanzasMiCaja.js). Lo ve quien es
// responsable de una caja, en el Inicio del celular o en el Panel de la
// oficina: el saldo, lo último que se movió y dos botones, "Gasté" y
// "Recibí plata". Lo que carga entra a su caja en el momento y le queda al
// dueño para revisar. Mientras el dueño no lo revisó lo puede anular.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { numero, plata } from "../lib/finanzasOperaciones";
import Modal from "./ui/Modal";
import BotonFoto from "./BotonFoto";

const fechaCorta = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : "");

/** El detalle de un movimiento sin repetir el concepto ni el nombre de la
 *  caja (lo que anotó el que lo cargó, o "De Caja Principal a …"). 10/11 */
export function detalleMovimiento(m, nombreCaja = "") {
  const fuera = new Set([String(m.concepto || "").trim(), String(nombreCaja || "").trim()]);
  return String(m.descripcion || "").split(" · ").map((x) => x.trim()).filter((x) => x && !fuera.has(x)).join(" · ");
}

/** Las cajas a cargo del empleado. Sin cajas devuelve una lista vacía. */
export function useMiCaja(activo = true) {
  const [datos, setDatos] = useState({ cajas: [] });
  const cargar = useCallback(async () => {
    if (!activo) return;
    try {
      const res = await apiFetch("/api/mi-caja");
      if (!res.ok) return;
      const d = await res.json().catch(() => null);
      if (Array.isArray(d?.cajas)) setDatos(d);
    } catch { /* sin señal: queda lo último */ }
  }, [activo]);
  useEffect(() => { cargar(); }, [cargar]);
  return { ...datos, cargar };
}

/** Texto corto para el botón: el saldo de cada caja. */
export function detalleMiCaja(cajas = []) {
  const saldos = cajas.map((c) => `${cajas.length > 1 ? `${c.nombre}: ` : "Saldo "}${plata(c.saldo, c.moneda)}`).join(" · ");
  const revisar = cajas.reduce((n, c) => n + c.para_revisar, 0);
  return `${saldos}${revisar ? ` · ${revisar} sin revisar` : ""}`;
}

function Cargar({ caja, clase, conceptos, hoy, onCerrar, onHecho }) {
  const lista = clase === "gasto" ? conceptos.gastos : conceptos.ingresos;
  const [f, setF] = useState({ concepto: lista.length === 1 ? lista[0].codigo : "", importe: "", fecha: hoy, descripcion: "", tipo_cambio: "", comprobante_url: "" });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const usd = caja.moneda === "USD";

  async function guardar() {
    setError(null);
    setGuardando(true);
    try {
      const res = await apiFetch("/api/mi-caja", {
        method: "POST",
        body: JSON.stringify({ accion: "cargar", cuenta: caja.cuenta, clase, ...f, importe: numero(f.importe), tipo_cambio: usd ? numero(f.tipo_cambio) : null }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo guardar");
      onHecho();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  const campo = (label, input) => <label className="flex flex-col gap-1 text-[14px] font-semibold text-gypi-text">{label}{input}</label>;
  return (
    <Modal open onClose={onCerrar} title={clase === "gasto" ? "Cargar un gasto" : "Plata que recibí"} maxWidth={480}>
      <div className="flex flex-col gap-3">
        {!lista.length ? (
          <p className="m-0 text-[14px] text-gypi-text">Todavía no hay nada para elegir: pedile al dueño que lo arme en Finanzas → Cajas y bancos → ⚙ Mi caja.</p>
        ) : (
          <>
            {campo(clase === "gasto" ? "¿En qué?" : "¿De dónde vino?", (
              <select className="g-input w-full" aria-label="Concepto" value={f.concepto} onChange={set("concepto")}>
                <option value="">Elegí…</option>
                {lista.map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
              </select>
            ))}
            <div className="flex flex-wrap gap-2">
              {campo(usd ? "Importe (USD)" : "Importe", <input className="g-input w-[160px] text-right font-mono" inputMode="decimal" aria-label="Importe" value={f.importe} onChange={set("importe")} />)}
              {campo("Fecha", <input type="date" className="g-input" aria-label="Fecha" max={hoy} value={f.fecha} onChange={set("fecha")} />)}
              {usd && campo("Tipo de cambio", <input className="g-input w-[120px]" inputMode="decimal" aria-label="Tipo de cambio" value={f.tipo_cambio} onChange={set("tipo_cambio")} />)}
            </div>
            {campo("Detalle (opcional)", <input className="g-input w-full" aria-label="Detalle" maxLength={300} placeholder={clase === "gasto" ? "Ej.: nafta camioneta" : "Ej.: me la dio Tadeo"} value={f.descripcion} onChange={set("descripcion")} />)}
            {f.comprobante_url ? (
              <div className="flex items-center gap-2">
                <img src={f.comprobante_url} alt="Foto del ticket" className="w-16 h-16 object-cover rounded-lg border border-gypi-border" />
                <button type="button" className="g-btn g-btn-secondary" onClick={() => setF((x) => ({ ...x, comprobante_url: "" }))}>Sacar la foto</button>
              </div>
            ) : (
              <BotonFoto label="📷 Foto del ticket (opcional)" onFoto={(url) => setF((x) => ({ ...x, comprobante_url: url }))} />
            )}
          </>
        )}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          {lista.length > 0 && <button type="button" className="g-btn g-btn-primary" disabled={guardando || !f.concepto || !f.importe} onClick={guardar}>{guardando ? "Guardando…" : "Guardar"}</button>}
        </div>
      </div>
    </Modal>
  );
}

/** La pantalla de Mi caja: saldo, Gasté / Recibí plata y los últimos movimientos. */
export default function MiCaja({ datos, onClose, onCambio }) {
  const [elegida, setElegida] = useState(datos.cajas[0]?.cuenta || "");
  const [cargar, setCargar] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const caja = datos.cajas.find((c) => c.cuenta === elegida) || datos.cajas[0];
  if (!caja) return null;

  async function anular(id) {
    setError(null);
    try {
      const res = await apiFetch("/api/mi-caja", { method: "POST", body: JSON.stringify({ accion: "anular", id }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo anular");
      setAviso("Listo: lo anulaste");
      onCambio();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <Modal open onClose={onClose} title="📱 Mi caja" maxWidth={520}>
      <div className="flex flex-col gap-3 text-gypi-text">
        {datos.cajas.length > 1 && (
          <select className="g-input w-full" aria-label="Caja" value={caja.cuenta} onChange={(e) => setElegida(e.target.value)}>
            {datos.cajas.map((c) => <option key={c.cuenta} value={c.cuenta}>{c.nombre}</option>)}
          </select>
        )}
        <div>
          <div className="text-[14px] text-gypi-dim">{caja.nombre}</div>
          <div className={`text-[30px] font-extrabold font-mono ${caja.saldo < 0 ? "text-gypi-red" : ""}`}>{plata(caja.saldo, caja.moneda)}</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="g-btn g-btn-primary min-h-[56px] text-[16px]" onClick={() => { setAviso(null); setCargar("gasto"); }}>➖ Gasté</button>
          <button type="button" className="g-btn g-btn-secondary min-h-[56px] text-[16px]" onClick={() => { setAviso(null); setCargar("ingreso"); }}>➕ Recibí plata</button>
        </div>
        {aviso && <p role="status" className="m-0 text-[14px] text-gypi-green-ink font-semibold">✓ {aviso}</p>}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <h3 className="m-0 mt-1 text-[14px] font-bold text-gypi-dim">Últimos movimientos</h3>
        {caja.movimientos.length ? (
          <ul className="list-none m-0 p-0 flex flex-col" aria-label="Movimientos de mi caja">
            {caja.movimientos.map((m) => (
              <li key={m.id} className="py-2 border-b border-gypi-border last:border-b-0 flex items-start gap-2 text-[14px]">
                <span className="font-mono text-[12px] text-gypi-dim pt-0.5">{fechaCorta(m.fecha)}</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold">{m.concepto}</span>
                  {detalleMovimiento(m, caja.nombre) && <span className="block text-[13px] text-gypi-dim break-words">{detalleMovimiento(m, caja.nombre)}</span>}
                  {m.estado === "para_revisar" && <span className="block text-[12px] text-gypi-amber-ink font-semibold">Falta que el dueño lo revise</span>}
                  {m.comprobante_url && <a href={m.comprobante_url} target="_blank" rel="noopener noreferrer" className="text-[12px] text-gypi-cyan underline">🧾 Ticket</a>}
                  {m.propia && m.estado === "para_revisar" && (
                    <button type="button" className="ml-2 text-[12px] text-gypi-red underline bg-transparent border-none p-0 cursor-pointer" onClick={() => anular(m.id)}>Anular</button>
                  )}
                </span>
                <span className={`font-mono font-semibold ${m.sale ? "text-gypi-red" : "text-gypi-green-ink"}`}>{m.sale ? `−${plata(m.sale, caja.moneda)}` : `+${plata(m.entra, caja.moneda)}`}</span>
              </li>
            ))}
          </ul>
        ) : <p className="m-0 text-[14px] text-gypi-dim">Todavía no hay movimientos.</p>}
      </div>
      {cargar && (
        <Cargar caja={caja} clase={cargar} conceptos={datos.conceptos || { gastos: [], ingresos: [] }} hoy={datos.hoy}
          onCerrar={() => setCargar(null)}
          onHecho={() => { setCargar(null); setAviso(`${cargar === "gasto" ? "Gasto cargado" : "Plata recibida cargada"}: ya cuenta en tu saldo y el dueño lo va a revisar`); onCambio(); }} />
      )}
    </Modal>
  );
}
