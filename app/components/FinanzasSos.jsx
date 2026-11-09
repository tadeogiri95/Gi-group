'use client';
// app/components/FinanzasSos.jsx — Finanzas → 🏭 Proveedores → 📄 Importar CSV
// del S.O.S (parte 4; /api/finanzas/sos; reglas en app/lib/finanzasSos.js).
//
// Se elige el CSV de compras que baja el S.O.S Contador, Gypi muestra qué
// comprobantes ya están (en el libro, en una factura de OC o cargados a mano)
// y cuáles son nuevos, y carga los tildados. Los "¿ya está?" (mismo importe y
// fecha, otro nombre) vienen sin tildar.
import { useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { plata } from "../lib/finanzasOperaciones";
import { Chip, Modal, Spinner } from "./ui";
import { useToast } from "./ui/Toast";

const fechaCorta = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}` : "");
const CLASE = { FC: "Factura", NC: "Nota de crédito", ND: "Nota de débito" };
const ESTADOS = { nueva: "Nuevos", dudosa: "¿Ya están?", ya_esta: "Ya están", importada: "Ya importados" };

/** Lee el archivo: UTF-8, y si trae letras rotas, como Windows (latin1). */
export async function textoDelArchivo(file) {
  const buf = await file.arrayBuffer();
  const utf = new TextDecoder("utf-8").decode(buf);
  return utf.includes("�") ? new TextDecoder("windows-1252").decode(buf) : utf;
}

async function pedir(body) {
  const res = await apiFetch("/api/finanzas/sos", { method: "POST", body: JSON.stringify(body) });
  const x = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(x.error || "No se pudo leer el archivo");
  return x;
}

export default function FinanzasSos({ onCerrar, onImportado }) {
  const toast = useToast();
  const [texto, setTexto] = useState("");
  const [d, setD] = useState(null);
  const [tildadas, setTildadas] = useState(new Set());
  const [vista, setVista] = useState("nueva");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);

  async function abrir(file) {
    if (!file) return;
    setError(null);
    setOcupado(true);
    try {
      const t = await textoDelArchivo(file);
      const x = await pedir({ accion: "ver", texto: t });
      setTexto(t);
      setD(x);
      setTildadas(new Set(x.filas.filter((f) => f.estado === "nueva" && f.cuenta).map((f) => f.clave)));
      setVista(x.filas.some((f) => f.estado === "nueva") ? "nueva" : "ya_esta");
    } catch (e) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function importar() {
    setError(null);
    setOcupado(true);
    try {
      const x = await pedir({ accion: "importar", texto, claves: [...tildadas] });
      toast.success(`Listo: ${x.cargadas} comprobantes cargados${x.proveedores_nuevos ? `, ${x.proveedores_nuevos} proveedores nuevos` : ""}`);
      onImportado();
    } catch (e) {
      setError(e.message);
      setOcupado(false);
    }
  }

  const cuenta = useMemo(() => {
    const c = {};
    for (const f of d?.filas || []) c[f.estado] = (c[f.estado] || 0) + 1;
    return c;
  }, [d]);
  const lista = (d?.filas || []).filter((f) => f.estado === vista);
  const elegible = (f) => (f.estado === "nueva" || f.estado === "dudosa") && f.cuenta;
  const tildar = (clave) => setTildadas((s) => { const n = new Set(s); if (n.has(clave)) n.delete(clave); else n.add(clave); return n; });
  const sinCuentaProv = (d?.filas || []).filter((f) => tildadas.has(f.clave) && !f.de_proveedor).length;

  return (
    <Modal open onClose={ocupado ? () => {} : onCerrar} title="Importar CSV del S.O.S Contador" maxWidth={760}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px] text-gypi-dim">
          Elegí el CSV de compras que baja el S.O.S. Gypi se fija cuáles ya están cargados (en el libro, en una factura de orden de compra o a mano) para no duplicarlos. La cuenta sale de cada proveedor; si no tiene, va la del S.O.S y queda para revisar.
        </p>
        <input type="file" accept=".csv,text/csv,text/plain" aria-label="CSV del S.O.S" disabled={ocupado} onChange={(e) => abrir(e.target.files?.[0])} />
        {ocupado && !d && <Spinner size={18} />}
        {d && (
          <>
            <div className="flex flex-wrap gap-2">
              {Object.entries(ESTADOS).filter(([k]) => cuenta[k]).map(([k, t]) => (
                <Chip key={k} active={vista === k} onClick={() => setVista(k)}>{t} ({cuenta[k]})</Chip>
              ))}
            </div>
            {vista === "dudosa" && <p className="m-0 text-[13px] text-gypi-dim">Hay una compra con el mismo importe y fecha parecida, pero con otro nombre. Tildalos solo si no son la misma.</p>}
            <div className="max-h-[45vh] overflow-y-auto border border-gypi-border rounded-lg">
              <table className="w-full border-collapse text-[13px]" aria-label="Comprobantes del S.O.S">
                <thead>
                  <tr className="bg-gypi-surface text-left">
                    {vista === "nueva" || vista === "dudosa" ? <th className="px-2 py-1 w-8"><span className="sr-only">Cargar</span></th> : null}
                    <th className="px-2 py-1">Comprobante</th>
                    <th className="px-2 py-1 text-right">Total</th>
                    <th className="px-2 py-1">{vista === "nueva" ? "Cuenta" : "Ya cargado como"}</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((f) => (
                    <tr key={f.clave} className="border-t border-gypi-border align-top">
                      {vista === "nueva" || vista === "dudosa" ? (
                        <td className="px-2 py-1">
                          <input type="checkbox" aria-label={`Cargar ${f.comprobante}`} disabled={!elegible(f)} checked={tildadas.has(f.clave)} onChange={() => tildar(f.clave)} />
                        </td>
                      ) : null}
                      <td className="px-2 py-1">
                        <span className="font-semibold">{f.proveedor_nombre || f.nombre}</span>
                        {!f.proveedor_id && <span className="text-gypi-dim"> (nuevo)</span>}
                        <span className="block text-[12px] text-gypi-dim">{fechaCorta(f.fecha)} · {CLASE[f.clase]} {f.comprobante}</span>
                      </td>
                      <td className={`px-2 py-1 text-right font-mono ${f.signo < 0 ? "text-gypi-green" : ""}`}>{f.signo < 0 ? "-" : ""}{plata(f.total, f.moneda)}</td>
                      <td className="px-2 py-1 text-[12px]">
                        {vista === "nueva"
                          ? (f.cuenta_nombre ? <>{f.cuenta_nombre}{!f.de_proveedor && <span className="text-gypi-amber-ink"> · para revisar</span>}</> : <span className="text-gypi-red">Sin cuenta</span>)
                          : <>{f.op_nombre || "—"} <span className="text-gypi-dim">{fechaCorta(f.op_fecha)}</span></>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {d.errores.length > 0 && (
              <details className="text-[13px]">
                <summary className="cursor-pointer">{d.errores.length} renglones no se cargan</summary>
                <ul className="m-0 pl-5">{d.errores.slice(0, 50).map((x) => <li key={x}>{x}</li>)}</ul>
              </details>
            )}
            {sinCuentaProv > 0 && <p className="m-0 text-[13px] text-gypi-dim">{sinCuentaProv} van con la cuenta del S.O.S y quedan para revisar en Operaciones. Para que no pase, elegí la cuenta de esos proveedores en 📚 Cuenta de cada proveedor.</p>}
          </>
        )}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" disabled={ocupado} onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={!d || ocupado || !tildadas.size} onClick={importar}>
            {ocupado && d ? "Cargando…" : `Cargar ${tildadas.size}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
