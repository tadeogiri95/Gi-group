'use client';
// app/components/FinanzasCheques.jsx — Finanzas → 🏦 Cheques (parte F2b, 1;
// migración 174; /api/finanzas/cheques; reglas en app/lib/finanzasCheques.js).
// Reemplaza R-CHEQUES y PREVISIÓN CHEQUES: los propios por debitar, los de
// terceros en cartera, el calendario por semana y el historial. Cada cambio
// (debitado, depositado, entregado, rechazado) genera su operación sola.
// Solo el rol Dueño (la pantalla ni aparece para los demás).
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyAr, numero, plata } from "../lib/finanzasOperaciones";
import { emparejarProveedor } from "../lib/finanzasProveedores";
import {
  ACCIONES, BANCO_ECHEQ, ESTADOS_CHEQUE, NOMBRE_ACCION, TIPOS_CHEQUE, calendarioCheques, chequesDelLibro, cuentaBancoDe,
} from "../lib/finanzasCheques";
import { Chip, Modal, SelectBuscable, Spinner } from "./ui";
import { useToast } from "./ui/Toast";

const fechaCorta = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}` : "");
const normal = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const MAX_LISTA = 300;

async function postCheques(body) {
  const res = await apiFetch("/api/finanzas/cheques", { method: "POST", body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "No se pudo guardar");
  return d;
}

function campo(label, input) {
  return <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">{label}{input}</label>;
}

const diasA = (f, hoy) => Math.round((Date.parse(`${f}T12:00:00Z`) - Date.parse(`${hoy}T12:00:00Z`)) / 86400000);
function cuando(f, hoy) {
  const d = diasA(f, hoy);
  if (d < 0) return { texto: `venció hace ${-d} día${d === -1 ? "" : "s"}`, clase: "text-gypi-red font-semibold" };
  if (d === 0) return { texto: "hoy", clase: "text-gypi-red font-semibold" };
  if (d === 1) return { texto: "mañana", clase: "text-gypi-amber-ink font-semibold" };
  return { texto: `en ${d} días`, clase: "text-gypi-dim" };
}

/* ─── Nuevo cheque ───────────────────────────────────────────────────── */

function NuevoCheque({ clase, datos, onCerrar, onGuardado }) {
  const toast = useToast();
  const bancos = datos.tesoreria.filter((t) => t.tipo === "banco" && t.activa !== false);
  const [f, setF] = useState(() => ({
    tipo: "echeq_diferido", banco: clase === "propio" ? BANCO_ECHEQ : "", numero: "", importe: "", fecha_emision: hoyAr(), fecha_pago: "",
    proveedor_id: "", recibido_de: "", librador: "", cuenta_banco: clase === "propio" ? cuentaBancoDe(BANCO_ECHEQ, datos.tesoreria) || "" : "", notas: "",
  }));
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function guardar() {
    setError(null);
    const importe = numero(f.importe);
    if (!(importe > 0)) { setError("Revisá el importe"); return; }
    setGuardando(true);
    try {
      await postCheques({ accion: "crear", cheque: { ...f, clase, importe, proveedor_id: f.proveedor_id ? Number(f.proveedor_id) : null } });
      toast.success(clase === "propio" ? "Cheque guardado: la deuda del proveedor bajó" : "Cheque recibido guardado");
      onGuardado();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onCerrar} title={clase === "propio" ? "Cheque propio a un proveedor" : "Cheque recibido"} maxWidth={560}>
      <div className="flex flex-col gap-3">
        {campo("Tipo", (
          <SelectBuscable className="g-input w-full" aria-label="Tipo de cheque" value={f.tipo} onChange={set("tipo")}>
            {Object.entries(TIPOS_CHEQUE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </SelectBuscable>
        ))}
        {clase === "propio" ? (
          <>
            {campo("Proveedor", (
              <SelectBuscable className="g-input w-full" aria-label="Proveedor" value={f.proveedor_id} onChange={set("proveedor_id")}>
                <option value="">Elegí el proveedor</option>
                {datos.proveedores.filter((p) => p.activo !== false).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </SelectBuscable>
            ))}
            {campo("Banco que lo debita", (
              <SelectBuscable className="g-input w-full" aria-label="Banco que lo debita" value={f.cuenta_banco} onChange={set("cuenta_banco")}>
                <option value="">Elegí el banco</option>
                {bancos.map((t) => <option key={t.cuenta} value={t.cuenta}>{t.nombre}</option>)}
              </SelectBuscable>
            ))}
          </>
        ) : (
          <>
            {campo("Recibido de", <input className="g-input w-full" aria-label="Recibido de" value={f.recibido_de} maxLength={120} onChange={set("recibido_de")} placeholder="Cliente que lo dio" />)}
            {campo("Librador (quien lo firmó)", <input className="g-input w-full" aria-label="Librador" value={f.librador} maxLength={120} onChange={set("librador")} />)}
          </>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {campo("Banco del cheque", <input className="g-input w-full" aria-label="Banco del cheque" value={f.banco} maxLength={60} onChange={set("banco")} />)}
          {campo("Número", <input className="g-input w-full" aria-label="Número del cheque" value={f.numero} maxLength={40} onChange={set("numero")} />)}
          {campo("Importe", <input className="g-input w-full" aria-label="Importe" inputMode="decimal" value={f.importe} onChange={set("importe")} placeholder="0,00" />)}
          {campo("Fecha de pago", <input type="date" className="g-input w-full" aria-label="Fecha de pago" value={f.fecha_pago} onChange={set("fecha_pago")} />)}
          {campo("Fecha de emisión", <input type="date" className="g-input w-full" aria-label="Fecha de emisión" value={f.fecha_emision} onChange={set("fecha_emision")} />)}
        </div>
        {campo("Notas", <input className="g-input w-full" aria-label="Notas" value={f.notas} maxLength={300} onChange={set("notas")} />)}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar cheque"}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Detalle y cambio de estado ─────────────────────────────────────── */

function Detalle({ ch, datos, onCerrar, onCambiado }) {
  const toast = useToast();
  const [accion, setAccion] = useState(null);
  const [fecha, setFecha] = useState(hoyAr());
  const [cuenta, setCuenta] = useState(ch.cuenta_banco || (ch.clase === "propio" ? cuentaBancoDe(ch.banco, datos.tesoreria) || "" : ""));
  const [proveedor, setProveedor] = useState("");
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const acciones = ACCIONES[ch.clase]?.[ch.estado] || [];
  const bancos = datos.tesoreria.filter((t) => t.tipo === "banco" && t.activa !== false);
  const prov = datos.proveedores.find((p) => Number(p.id) === Number(ch.proveedor_id));
  const fila = (k, v) => (v ? <div className="flex justify-between gap-3 py-1 border-t border-gypi-border text-[13px]"><span className="text-gypi-dim">{k}</span><span className="text-right">{v}</span></div> : null);

  async function confirmar() {
    setError(null);
    setGuardando(true);
    try {
      await postCheques({ accion: "cambiar", id: ch.id, a: accion, fecha, cuenta_banco: cuenta || null, proveedor_id: proveedor ? Number(proveedor) : null });
      toast.success(`Cheque ${accion === "anular" ? "anulado" : NOMBRE_ACCION[accion].toLowerCase()}`);
      onCambiado();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onCerrar} title={`${TIPOS_CHEQUE[ch.tipo]}${ch.numero ? ` N° ${ch.numero}` : ""}`} maxWidth={520}>
      <div className="flex flex-col gap-2 text-gypi-text">
        <p className="m-0 text-[20px] font-bold">{plata(ch.importe, "ARS")}</p>
        <p className="m-0 text-[13px] text-gypi-dim">{ESTADOS_CHEQUE[ch.estado]?.nombre} · paga el {fechaCorta(ch.fecha_pago)}</p>
        <div>
          {fila("Banco", ch.banco)}
          {fila(ch.clase === "propio" ? "Para" : "Recibido de", ch.clase === "propio" ? prov?.nombre || ch.beneficiario : ch.recibido_de)}
          {fila("Librador", ch.clase === "tercero" ? ch.librador : null)}
          {fila("Entregado a", ch.entregado_a)}
          {fila("Emitido", fechaCorta(ch.fecha_emision))}
          {fila("Notas", ch.notas)}
        </div>
        {!accion && acciones.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {acciones.map((a) => (
              <button key={a} type="button" className={`g-btn ${a === "anular" || a === "rechazado" ? "g-btn-secondary" : "g-btn-primary"} flex-1`} onClick={() => setAccion(a)}>{NOMBRE_ACCION[a]}</button>
            ))}
          </div>
        )}
        {accion && (
          <div className="flex flex-col gap-2 mt-2 p-3 rounded-[10px] border border-gypi-border">
            <p className="m-0 text-[14px] font-semibold">{NOMBRE_ACCION[accion]}</p>
            {campo("Fecha", <input type="date" className="g-input w-full" aria-label="Fecha del cambio" value={fecha} onChange={(e) => setFecha(e.target.value)} />)}
            {(accion === "debitado" || accion === "depositado") && campo(accion === "debitado" ? "Banco que lo debitó" : "Banco donde lo depositaste", (
              <SelectBuscable className="g-input w-full" aria-label="Banco" value={cuenta} onChange={(e) => setCuenta(e.target.value)}>
                <option value="">Elegí el banco</option>
                {bancos.map((t) => <option key={t.cuenta} value={t.cuenta}>{t.nombre}</option>)}
              </SelectBuscable>
            ))}
            {accion === "entregado" && campo("Proveedor", (
              <SelectBuscable className="g-input w-full" aria-label="Proveedor que lo recibe" value={proveedor} onChange={(e) => setProveedor(e.target.value)}>
                <option value="">Elegí el proveedor</option>
                {datos.proveedores.filter((p) => p.activo !== false).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </SelectBuscable>
            ))}
            {accion === "anular" && <p className="m-0 text-[13px] text-gypi-dim">El cheque queda anulado y su operación también. No se borra.</p>}
            {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
            <div className="flex gap-2">
              <button type="button" className="g-btn g-btn-secondary flex-1" onClick={() => { setAccion(null); setError(null); }}>Volver</button>
              <button type="button" className="g-btn g-btn-primary flex-1" disabled={guardando} onClick={confirmar}>{guardando ? "Guardando…" : "Confirmar"}</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ─── Copiar del libro ───────────────────────────────────────────────── */

async function leerRCheques(file) {
  const { hojasXlsx, leerHojaXlsx } = await import("../lib/leerXlsx");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hoja = hojasXlsx(bytes).find((n) => normal(n) === "RCHEQUES");
  return hoja ? leerHojaXlsx(bytes, hoja, { maxFilas: 20000, maxCols: 30 }) || [] : null;
}

function CopiarLibro({ datos, onCerrar, onCopiados }) {
  const toast = useToast();
  const [grilla, setGrilla] = useState(null);
  const [empresa, setEmpresa] = useState("");
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const r = useMemo(() => (grilla ? chequesDelLibro(grilla, { empresa }) : null), [grilla, empresa]);
  const filas = useMemo(() => (r?.filas || []).map((f) => ({
    ...f,
    // A qué proveedor de Gypi va: el beneficiario del propio o a quién se entregó
    proveedor_id: emparejarProveedor(f.clase === "propio" ? f.beneficiario : f.entregado_a, datos.proveedores)?.id || null,
    cuenta_banco: f.clase === "propio" ? cuentaBancoDe(f.banco, datos.tesoreria) : null,
  })), [r, datos]);
  const cuenta = (pred) => filas.filter(pred);

  async function abrir(file) {
    if (!file) return;
    setError(null);
    try {
      const g = await leerRCheques(file);
      if (!g) throw new Error("El archivo no tiene la hoja R-CHEQUES.");
      setGrilla(g);
    } catch (e) {
      setError(e.message || "No se pudo leer el archivo");
    }
  }
  async function copiar() {
    setGuardando(true);
    setError(null);
    try {
      const d = await postCheques({ accion: "copiar_libro", filas });
      toast.success(`Copiados ${d.copiados} cheques${d.repetidos ? ` (${d.repetidos} ya estaban)` : ""}`);
      onCopiados();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }
  const resumen = (l) => `${l.length} por ${plata(l.reduce((s, f) => s + f.importe, 0), "ARS")}`;

  return (
    <Modal open onClose={onCerrar} title="Copiar cheques del libro" maxWidth={560}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0">Subí el libro (.xlsx). Se copian los cheques ACTIVO y ENTREGADO de R-CHEQUES, sin tocar las cuentas (eso ya está en el libro). Los que ya copiaste no se repiten.</p>
        <label className="g-btn g-btn-secondary cursor-pointer self-start">
          {grilla ? "Elegir otro archivo" : "📂 Subir el libro"}
          <input type="file" accept=".xlsx,.xlsm" className="sr-only" aria-label="Subir el libro contable" onChange={(e) => { abrir(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {(error || r?.error) && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error || r.error}</p>}
        {r && !r.error && (
          <>
            {campo("Nombre de la empresa en los cheques (para saber cuáles son propios)", <input className="g-input w-full" aria-label="Nombre de la empresa" value={empresa || r.empresa} onChange={(e) => setEmpresa(e.target.value)} />)}
            <ul className="m-0 pl-5 text-[13px]" aria-label="Lo que se copia">
              <li>Propios por debitar: {resumen(cuenta((f) => f.clase === "propio"))}</li>
              <li>De terceros en cartera: {resumen(cuenta((f) => f.estado === "en_cartera"))}</li>
              <li>De terceros entregados: {resumen(cuenta((f) => f.estado === "entregado"))}</li>
            </ul>
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={!filas.length || guardando} onClick={copiar}>{guardando ? "Copiando…" : `Copiar ${filas.length} cheques`}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Pantalla ───────────────────────────────────────────────────────── */

export default function FinanzasCheques() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [vista, setVista] = useState("propios");
  const [buscar, setBuscar] = useState("");
  const [nuevo, setNuevo] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [copiar, setCopiar] = useState(false);
  const hoy = hoyAr();

  const cargar = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/finanzas/cheques${vista === "historial" ? "?anulados=1" : ""}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudieron cargar los cheques");
      setDatos(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [vista]);
  useEffect(() => { cargar(); }, [cargar]);

  const cheques = useMemo(() => datos?.cheques || [], [datos]);
  const propios = cheques.filter((c) => c.clase === "propio" && c.estado === "pendiente");
  const cartera = cheques.filter((c) => c.clase === "tercero" && c.estado === "en_cartera");
  const lista = useMemo(() => {
    const base = vista === "propios" ? cheques.filter((c) => c.clase === "propio" && c.estado === "pendiente")
      : vista === "cartera" ? cheques.filter((c) => c.clase === "tercero" && c.estado === "en_cartera")
        : [...cheques].filter((c) => !ESTADOS_CHEQUE[c.estado]?.vivo).sort((a, b) => (a.fecha_pago < b.fecha_pago ? 1 : -1));
    const b = normal(buscar);
    if (!b) return base;
    const prov = new Map((datos?.proveedores || []).map((p) => [Number(p.id), p.nombre]));
    return base.filter((c) => normal([c.numero, c.banco, c.librador, c.beneficiario, c.recibido_de, c.entregado_a, prov.get(Number(c.proveedor_id))].join(" ")).includes(b));
  }, [cheques, vista, buscar, datos]);
  const calendario = useMemo(() => calendarioCheques(cheques, hoy), [cheques, hoy]);

  if (error) return <p role="alert" className="m-[18px] text-[14px] text-gypi-red">⚠ {error}</p>;
  if (!datos) return <div className="flex-1 flex items-center justify-center py-10"><Spinner /></div>;
  const suma = (l) => l.reduce((s, c) => s + (Number(c.importe) || 0), 0);
  const prov = new Map(datos.proveedores.map((p) => [Number(p.id), p.nombre]));
  const quien = (c) => (c.clase === "propio" ? prov.get(Number(c.proveedor_id)) || c.beneficiario : c.estado === "entregado" ? `${c.recibido_de || c.librador || ""} → ${c.entregado_a || ""}` : c.recibido_de || c.librador) || "—";

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <button type="button" className="g-btn g-btn-primary" onClick={() => setNuevo("propio")}>+ Cheque propio</button>
        <button type="button" className="g-btn g-btn-secondary" onClick={() => setNuevo("tercero")}>+ Cheque recibido</button>
        <button type="button" className="g-btn g-btn-secondary ml-auto" onClick={() => setCopiar(true)}>📥 Copiar del libro</button>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Chip active={vista === "propios"} onClick={() => setVista("propios")}>Por debitar ({propios.length})</Chip>
        <Chip active={vista === "cartera"} onClick={() => setVista("cartera")}>En cartera ({cartera.length})</Chip>
        <Chip active={vista === "calendario"} onClick={() => setVista("calendario")}>Calendario</Chip>
        <Chip active={vista === "historial"} onClick={() => setVista("historial")}>Historial</Chip>
      </div>

      {vista === "calendario" ? (
        <table className="w-full text-[13px] border-collapse" aria-label="Calendario de cheques">
          <thead>
            <tr className="text-gypi-dim text-left">
              <th className="font-semibold py-1">Cuándo</th>
              <th className="font-semibold py-1 text-right">Se debita</th>
              <th className="font-semibold py-1 text-right">Vence en cartera</th>
            </tr>
          </thead>
          <tbody>
            {calendario.filter((t) => t.cantidad || (t.desde !== null && t.desde >= 0 && t.hasta !== null && t.hasta <= 28)).map((t) => (
              <tr key={t.etiqueta} className={`border-t border-gypi-border ${t.etiqueta === "Vencidos" && t.cantidad ? "text-gypi-red" : ""}`}>
                <td className="py-1">{t.etiqueta}</td>
                <td className="py-1 text-right font-mono">{t.debitar ? plata(t.debitar, "ARS") : "—"}</td>
                <td className="py-1 text-right font-mono">{t.cobrar ? plata(t.cobrar, "ARS") : "—"}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-gypi-border font-bold">
              <td className="py-1">Total</td>
              <td className="py-1 text-right font-mono">{plata(suma(propios), "ARS")}</td>
              <td className="py-1 text-right font-mono">{plata(suma(cartera), "ARS")}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <>
          <input className="g-input w-full mb-2" aria-label="Buscar cheque" placeholder="Buscar por número, banco, proveedor o cliente" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
          {vista !== "historial" && <p className="mb-2 text-[13px] text-gypi-dim">{lista.length} cheque{lista.length === 1 ? "" : "s"} · {plata(suma(lista), "ARS")}</p>}
          <ul className="list-none m-0 p-0 flex flex-col gap-1.5" aria-label="Cheques">
            {lista.slice(0, MAX_LISTA).map((c) => {
              const w = ESTADOS_CHEQUE[c.estado]?.vivo ? cuando(c.fecha_pago, hoy) : { texto: ESTADOS_CHEQUE[c.estado]?.nombre, clase: "text-gypi-dim" };
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => setDetalle(c)} className={`w-full text-left min-h-[48px] px-3 py-2 rounded-lg border border-gypi-border bg-gypi-surface cursor-pointer ${c.estado === "anulado" ? "opacity-60" : ""}`}>
                    <span className="flex items-baseline gap-2 text-[14px] text-gypi-text">
                      <span className="text-gypi-dim font-mono text-[12px]">{fechaCorta(c.fecha_pago)}</span>
                      <span className="font-semibold flex-1 min-w-0 truncate">{quien(c)}</span>
                      <span className="font-mono font-semibold">{plata(c.importe, "ARS")}</span>
                    </span>
                    <span className="block text-[12px] text-gypi-dim truncate">
                      {TIPOS_CHEQUE[c.tipo]}{c.banco ? ` · ${c.banco}` : ""}{c.numero ? ` N° ${c.numero}` : ""} · <span className={w.clase}>{w.texto}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {lista.length > MAX_LISTA && <p className="mt-2 text-[13px] text-gypi-dim">Hay {lista.length - MAX_LISTA} más: usá el buscador.</p>}
          {!lista.length && <p className="mt-2 text-[13px] text-gypi-dim">{cheques.length ? "No hay cheques acá." : "Todavía no hay cheques. Copiá los vivos del libro o cargá uno."}</p>}
        </>
      )}

      {nuevo && <NuevoCheque clase={nuevo} datos={datos} onCerrar={() => setNuevo(null)} onGuardado={() => { setNuevo(null); cargar(); }} />}
      {detalle && <Detalle ch={detalle} datos={datos} onCerrar={() => setDetalle(null)} onCambiado={() => { setDetalle(null); cargar(); }} />}
      {copiar && <CopiarLibro datos={datos} onCerrar={() => setCopiar(false)} onCopiados={() => { setCopiar(false); cargar(); }} />}
    </div>
  );
}
