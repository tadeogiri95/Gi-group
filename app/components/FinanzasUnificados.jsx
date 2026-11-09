'use client';
// app/components/FinanzasUnificados.jsx — Finanzas, parte 5: cliente que
// también es proveedor (/api/finanzas/unificados; reglas en
// app/lib/finanzasUnificados.js).
//
// "🔗 Cliente y proveedor" (en Clientes y en Proveedores): los unidos con su
// saldo neto y ⚖ Compensar, las uniones sugeridas (mismo CUIT o nombre) y unir
// a mano. En la ficha de cualquiera de los dos, una línea con la cuenta
// unificada (LineaUnificada).
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyAr, numero, plata } from "../lib/finanzasOperaciones";
import { Modal, Spinner } from "./ui";
import { useToast } from "./ui/Toast";

const RUTA = "/api/finanzas/unificados";

async function leer() {
  const res = await apiFetch(RUTA);
  const x = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(x.error || "No se pudo leer");
  return x;
}

async function mandar(body) {
  const res = await apiFetch(RUTA, { method: "POST", body: JSON.stringify(body) });
  const x = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(x.error || "No se pudo guardar");
  return x;
}

/** "Nos debe $ X" / "Le debemos $ X" / "Al día" del neto. */
export function textoNeto(neto) {
  if (neto >= 0.01) return `Neto: nos debe ${plata(neto, "ARS")}`;
  if (neto <= -0.01) return `Neto: le debemos ${plata(-neto, "ARS")}`;
  return "Neto: al día";
}

function Compensar({ cuenta, onCerrar, onHecho }) {
  const toast = useToast();
  const [fecha, setFecha] = useState(hoyAr());
  const [importe, setImporte] = useState(String(cuenta.compensable).replace(".", ","));
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  async function guardar() {
    setError(null);
    const n = numero(importe);
    if (!(n > 0)) return setError("Poné el importe");
    setGuardando(true);
    try {
      await mandar({ accion: "compensar", cliente_id: cuenta.cliente_id, fecha, importe: n, descripcion: nota });
      toast.success("Compensación cargada");
      onHecho();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={guardando ? () => {} : onCerrar} title={`⚖ Compensar · ${cuenta.cliente}`} maxWidth={480}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px] text-gypi-dim">
          Nos debe {plata(cuenta.nos_debe, "ARS")} como cliente y le debemos {plata(cuenta.le_debemos, "ARS")} como proveedor. Compensar baja las dos deudas por el mismo importe, sin mover caja.
        </p>
        <label className="flex flex-col gap-1">Fecha<input type="date" className="g-input" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
        <label className="flex flex-col gap-1">Importe (hasta {plata(cuenta.compensable, "ARS")})<input className="g-input" inputMode="decimal" value={importe} onChange={(e) => setImporte(e.target.value)} /></label>
        <label className="flex flex-col gap-1">Detalle (opcional)<input className="g-input" value={nota} maxLength={200} onChange={(e) => setNota(e.target.value)} /></label>
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" disabled={guardando} onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Compensar"}</button>
        </div>
      </div>
    </Modal>
  );
}

export default function FinanzasUnificados({ onCerrar, onCambio }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [compensar, setCompensar] = useState(null);
  const [cli, setCli] = useState("");
  const [prov, setProv] = useState("");

  const cargar = useCallback(() => leer().then(setD).catch((e) => setError(e.message)), []);
  useEffect(() => { cargar(); }, [cargar]);

  async function accion(body, ok) {
    setOcupado(true);
    setError(null);
    try {
      await mandar(body);
      toast.success(ok);
      await cargar();
      onCambio?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal open onClose={ocupado ? () => {} : onCerrar} title="Cliente y proveedor" maxWidth={720}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px] text-gypi-dim">
          Si un cliente también nos vende, unilos: en la ficha de los dos se ve lo que nos debe, lo que le debemos y el neto, y se puede compensar una deuda con la otra. Las dos cuentas siguen separadas para impuestos y el Estado de Resultados.
        </p>
        {!d && !error && <Spinner size={18} />}
        {d && (
          <>
            {d.unificadas.length > 0 && (
              <ul className="list-none m-0 p-0 flex flex-col gap-2" aria-label="Unidos">
                {d.unificadas.map((u) => (
                  <li key={u.cliente_id} className="border border-gypi-border rounded-lg p-2">
                    <p className="m-0 font-semibold">{u.cliente} <span className="font-normal text-gypi-dim">= {u.proveedor}</span></p>
                    <p className="m-0 text-[13px]">Nos debe {plata(u.nos_debe, "ARS")} · Le debemos {plata(u.le_debemos, "ARS")} · <b>{textoNeto(u.neto)}</b></p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      <button type="button" className="g-btn g-btn-primary" disabled={ocupado || !(u.compensable > 0)} onClick={() => setCompensar(u)}>⚖ Compensar</button>
                      <button type="button" className="g-btn g-btn-secondary" disabled={ocupado} onClick={() => accion({ accion: "separar", cliente_id: u.cliente_id }, "Separados")}>Separar</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {d.sugeridas.length > 0 && (
              <div>
                <p className="m-0 text-[13px] font-bold text-gypi-dim">Gypi sugiere unir (mismo CUIT o nombre)</p>
                <ul className="list-none m-0 p-0 flex flex-col gap-1" aria-label="Sugeridos">
                  {d.sugeridas.map((s) => (
                    <li key={s.cliente_id} className="flex flex-wrap items-center gap-2 border-b border-gypi-border py-1">
                      <span className="flex-1 min-w-[200px]">{s.cliente} <span className="text-gypi-dim">= {s.proveedor} ({s.por === "cuit" ? "mismo CUIT" : "mismo nombre"})</span></span>
                      <button type="button" className="g-btn g-btn-secondary" disabled={ocupado} onClick={() => accion({ accion: "unir", cliente_id: s.cliente_id, proveedor_id: s.proveedor_id }, "Unidos")}>Unir</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <p className="m-0 text-[13px] font-bold text-gypi-dim">Unir a mano</p>
              <div className="flex flex-wrap gap-2">
                <select className="g-input flex-1 min-w-[180px]" aria-label="Cliente" value={cli} onChange={(e) => setCli(e.target.value)}>
                  <option value="">Cliente…</option>
                  {d.clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
                <select className="g-input flex-1 min-w-[180px]" aria-label="Proveedor" value={prov} onChange={(e) => setProv(e.target.value)}>
                  <option value="">Proveedor…</option>
                  {d.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
                <button type="button" className="g-btn g-btn-secondary" disabled={ocupado || !cli || !prov}
                  onClick={() => accion({ accion: "unir", cliente_id: Number(cli), proveedor_id: Number(prov) }, "Unidos").then(() => { setCli(""); setProv(""); })}>Unir</button>
              </div>
            </div>
          </>
        )}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end">
          <button type="button" className="g-btn g-btn-secondary" disabled={ocupado} onClick={onCerrar}>Cerrar</button>
        </div>
      </div>
      {compensar && <Compensar cuenta={compensar} onCerrar={() => setCompensar(null)} onHecho={() => { setCompensar(null); cargar(); onCambio?.(); }} />}
    </Modal>
  );
}

/** En la ficha del cliente o del proveedor: la cuenta unificada, si está unido. */
export function LineaUnificada({ clienteId = null, proveedorId = null, onCambio }) {
  const [u, setU] = useState(null);
  const [abierto, setAbierto] = useState(false);
  const cargar = useCallback(() => leer()
    .then((x) => setU(x.unificadas.find((y) => (clienteId && y.cliente_id === Number(clienteId)) || (proveedorId && y.proveedor_id === Number(proveedorId))) || null))
    .catch(() => setU(null)), [clienteId, proveedorId]);
  useEffect(() => { if (clienteId || proveedorId) cargar(); }, [cargar, clienteId, proveedorId]);
  if (!u) return null;
  return (
    <div className="border border-gypi-border rounded-lg p-2 text-[13px]" aria-label="Cuenta unificada">
      <p className="m-0">🔗 {clienteId ? <>También es proveedor ({u.proveedor})</> : <>También es cliente ({u.cliente})</>}</p>
      <p className="m-0">Nos debe {plata(u.nos_debe, "ARS")} · Le debemos {plata(u.le_debemos, "ARS")} · <b>{textoNeto(u.neto)}</b></p>
      {u.compensable > 0 && <button type="button" className="g-btn g-btn-secondary mt-1" onClick={() => setAbierto(true)}>⚖ Compensar</button>}
      {abierto && <Compensar cuenta={u} onCerrar={() => setAbierto(false)} onHecho={() => { setAbierto(false); onCambio?.(); }} />}
    </div>
  );
}
