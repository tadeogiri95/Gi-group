'use client';
// app/components/FinanzasTesoreria.jsx — Finanzas → 💰 Cajas y bancos (parte
// F3a; reemplaza TESORERIA y RESUMEN CAJA del libro; /api/finanzas/tesoreria;
// reglas en app/lib/finanzasTesoreria.js). Sin migración.
//
// El saldo de cada caja y banco sale de las operaciones: lo que entra y lo que
// sale. La ficha muestra los movimientos con el saldo renglón por renglón.
// "Cargar saldos iniciales" lee T-OPERACIONES del libro hasta una fecha de
// corte; "Pasar plata" es una TRANSFERENCIA ENTRE CAJAS entre dos cajas.
// F3b (176): lo que cargan los responsables desde 📱 Mi caja espera acá
// ("Para revisar") y "⚙ Mi caja" elige qué tipos se les ofrecen.
// F5a: en la ficha de un banco, "📥 Subir extracto" (FinanzasExtracto.jsx).
// Solo el rol Dueño (la pantalla ni aparece para los demás).
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyAr, numero, plata } from "../lib/finanzasOperaciones";
import { ORIGEN_SALDO_INICIAL } from "../lib/finanzasProveedores";
import { NOMBRE_GRUPO, ORDEN_TIPOS, movimientosDeCaja, saldosCajasDelLibro, saldosTesoreria, totalesTesoreria } from "../lib/finanzasTesoreria";
import { paraRevisarMiCaja, tiposParaMiCaja } from "../lib/finanzasMiCaja";
import SubirExtracto from "./FinanzasExtracto";
import { Modal, Spinner } from "./ui";
import { useToast } from "./ui/Toast";

const fechaCorta = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}` : "");
const normal = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const MAX_MOVIMIENTOS = 300;

async function postTesoreria(body) {
  const res = await apiFetch("/api/finanzas/tesoreria", { method: "POST", body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "No se pudo guardar");
  return d;
}

function campo(label, input) {
  return <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">{label}{input}</label>;
}

async function leerOperacionesDelLibro(file) {
  const { hojasXlsx, leerHojaXlsx } = await import("../lib/leerXlsx");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hoja = hojasXlsx(bytes).find((n) => normal(n) === "TOPERACIONES");
  if (!hoja) return null;
  return leerHojaXlsx(bytes, hoja, { maxFilas: 60000, maxCols: 60 }) || [];
}

/* ─── Saldos iniciales ───────────────────────────────────────────────── */

function SaldosIniciales({ datos, onCerrar, onCargados }) {
  const toast = useToast();
  const [grilla, setGrilla] = useState(null);
  const [fecha, setFecha] = useState(hoyAr());
  const [tc, setTc] = useState("");
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const yaCargados = (datos.operaciones || []).some((o) => o.origen === ORIGEN_SALDO_INICIAL);
  const resultado = useMemo(() => (grilla ? saldosCajasDelLibro(grilla, fecha, datos.tesoreria) : null), [grilla, fecha, datos.tesoreria]);
  const filas = useMemo(() => (resultado?.filas || [])
    .map((f) => ({ ...f, caja: datos.tesoreria.find((t) => t.cuenta === f.cuenta) }))
    .filter((f) => f.caja && Math.abs(f.saldo) >= 0.01)
    .sort((a, b) => a.caja.nombre.localeCompare(b.caja.nombre)), [resultado, datos.tesoreria]);
  const hayUsd = filas.some((f) => f.caja.moneda === "USD");

  async function abrir(file) {
    if (!file) return;
    setLeyendo(true);
    setError(null);
    try {
      const g = await leerOperacionesDelLibro(file);
      if (!g) throw new Error("El archivo no tiene la hoja T-OPERACIONES.");
      setGrilla(g);
    } catch (e) {
      setError(e.message || "No se pudo leer el archivo");
    } finally {
      setLeyendo(false);
    }
  }

  async function cargar() {
    setError(null);
    if (hayUsd && !(numero(tc) > 0)) { setError("Poné el tipo de cambio para las cajas en dólares"); return; }
    setGuardando(true);
    try {
      const d = await postTesoreria({ accion: "saldos_iniciales", fecha, tipo_cambio: hayUsd ? numero(tc) : null, filas: filas.map((f) => ({ cuenta: f.cuenta, saldo: f.saldo })) });
      toast.success(`Saldos iniciales cargados: ${d.cargados} cajas y bancos`);
      onCargados();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onCerrar} title="Cargar saldos iniciales" maxWidth={640}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0">
          Subí el libro (.xlsx). Se suma todo lo de T-OPERACIONES que entró y salió de cada caja y banco hasta la fecha de corte, y
          cada saldo entra como &quot;SALDO INICIAL&quot; contra Ajuste De Capital. Lo que cargues en Gypi después de esa fecha sigue desde ahí.
        </p>
        {yaCargados && <p className="m-0 text-[13px] text-gypi-amber-ink">⚠ Ya hay saldos iniciales cargados: los de las cajas que cargues ahora se reemplazan.</p>}
        <div className="flex flex-wrap items-end gap-2">
          <label className="g-btn g-btn-secondary cursor-pointer">
            {leyendo ? "Leyendo…" : grilla ? "Elegir otro archivo" : "📂 Subir el libro"}
            <input type="file" accept=".xlsx,.xlsm" className="sr-only" aria-label="Subir el libro contable" disabled={leyendo} onChange={(e) => { abrir(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          <div className="ml-auto">
            {campo("Fecha de corte (incluida)", <input type="date" className="g-input" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />)}
          </div>
        </div>
        {(error || resultado?.error) && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error || resultado.error}</p>}
        {resultado && !resultado.error && (
          <>
            <ul className="list-none m-0 p-0 flex flex-col max-h-[45vh] overflow-y-auto border border-gypi-border rounded-lg" aria-label="Saldos del libro">
              {filas.map((f) => (
                <li key={f.cuenta} className="flex items-baseline gap-2 px-2 py-1.5 border-b border-gypi-border last:border-b-0 text-[13px]">
                  <span className="flex-1 min-w-0">{f.caja.nombre}</span>
                  <span className={`font-mono font-semibold ${f.saldo < 0 ? "text-gypi-red" : ""}`}>{plata(f.saldo, f.caja.moneda)}</span>
                </li>
              ))}
              {!filas.length && <li className="p-2 text-[13px] text-gypi-dim">Ninguna caja con saldo a esa fecha.</li>}
            </ul>
            {hayUsd && campo("Tipo de cambio para las cajas en dólares", <input className="g-input w-[160px]" inputMode="decimal" aria-label="Tipo de cambio" value={tc} onChange={(e) => setTc(e.target.value)} />)}
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={!filas.length || guardando} onClick={cargar}>
            {guardando ? "Cargando…" : `Cargar ${filas.length} saldos`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Pasar plata entre cajas ────────────────────────────────────────── */

function Transferir({ datos, desdeInicial = "", onCerrar, onHecho }) {
  const toast = useToast();
  const vivas = datos.tesoreria.filter((t) => t.activa !== false);
  const [f, setF] = useState({ desde: desdeInicial, hacia: "", importe: "", fecha: hoyAr(), tipo_cambio: "", descripcion: "" });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const desde = vivas.find((t) => t.cuenta === f.desde);
  const usd = desde?.moneda === "USD";

  async function guardar() {
    setError(null);
    setGuardando(true);
    try {
      await postTesoreria({ accion: "transferir", ...f, importe: numero(f.importe), tipo_cambio: usd ? numero(f.tipo_cambio) : null });
      toast.success("Listo: la plata pasó de caja");
      onHecho();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  const opciones = (excluir) => vivas.filter((t) => t.cuenta !== excluir && (!desde || excluir !== f.desde || (t.moneda === "USD") === usd));
  return (
    <Modal open onClose={onCerrar} title="Pasar plata entre cajas" maxWidth={480}>
      <div className="flex flex-col gap-3">
        {campo("Sale de", (
          <select className="g-input w-full" aria-label="Sale de" value={f.desde} onChange={set("desde")}>
            <option value="">Elegí…</option>
            {vivas.map((t) => <option key={t.cuenta} value={t.cuenta}>{t.nombre}</option>)}
          </select>
        ))}
        {campo("Va a", (
          <select className="g-input w-full" aria-label="Va a" value={f.hacia} onChange={set("hacia")}>
            <option value="">Elegí…</option>
            {opciones(f.desde).map((t) => <option key={t.cuenta} value={t.cuenta}>{t.nombre}</option>)}
          </select>
        ))}
        <div className="flex flex-wrap gap-2">
          {campo(usd ? "Importe (USD)" : "Importe", <input className="g-input w-[160px] text-right font-mono" inputMode="decimal" aria-label="Importe" value={f.importe} onChange={set("importe")} />)}
          {campo("Fecha", <input type="date" className="g-input" aria-label="Fecha" value={f.fecha} onChange={set("fecha")} />)}
          {usd && campo("Tipo de cambio", <input className="g-input w-[120px]" inputMode="decimal" aria-label="Tipo de cambio" value={f.tipo_cambio} onChange={set("tipo_cambio")} />)}
        </div>
        {campo("Nota (opcional)", <input className="g-input w-full" aria-label="Nota" maxLength={300} value={f.descripcion} onChange={set("descripcion")} />)}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={guardando || !f.desde || !f.hacia} onClick={guardar}>{guardando ? "Guardando…" : "Pasar la plata"}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Ficha de una caja ──────────────────────────────────────────────── */

function Ficha({ caja, datos, onCerrar, onTransferir, onExtracto }) {
  const movimientos = useMemo(() => movimientosDeCaja(datos.operaciones, caja), [datos, caja]);
  const responsable = datos.personal.find((p) => p.id === caja.responsable_id)?.nombre;
  return (
    <Modal open onClose={onCerrar} title={caja.nombre} maxWidth={640}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className={`m-0 text-[22px] font-bold font-mono ${caja.saldo < 0 ? "text-gypi-red" : ""}`}>{plata(caja.saldo, caja.moneda)}</p>
        <p className="m-0 text-[13px] text-gypi-dim">{responsable ? `Responsable: ${responsable} · ` : ""}{movimientos.length} movimientos</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onTransferir}>⇄ Pasar plata desde esta caja</button>
          {caja.tipo === "banco" && caja.moneda !== "USD" && <button type="button" className="g-btn g-btn-secondary" onClick={onExtracto}>📥 Subir extracto</button>}
        </div>
        {movimientos.length ? (
          <table className="w-full text-[13px] border-collapse" aria-label="Movimientos de la caja">
            <thead>
              <tr className="text-gypi-dim text-left">
                <th className="font-semibold py-1">Fecha</th>
                <th className="font-semibold py-1 text-right">Entra</th>
                <th className="font-semibold py-1 text-right">Sale</th>
                <th className="font-semibold py-1 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {[...movimientos].reverse().slice(0, MAX_MOVIMIENTOS).map((m) => (
                <tr key={m.op.id} className="border-t border-gypi-border">
                  <td className="py-1">
                    <span className="font-mono text-[12px] text-gypi-dim">{fechaCorta(m.op.fecha)}</span> {m.op.tipo}
                    {m.op.estado === "para_revisar" && <b className="ml-1 text-gypi-amber-ink">· Para revisar</b>}
                    {m.op.descripcion && <span className="block text-[12px] text-gypi-dim truncate">{m.op.descripcion}</span>}
                    {m.op.comprobante_url && <a href={m.op.comprobante_url} target="_blank" rel="noopener noreferrer" className="text-[12px] text-gypi-cyan underline">🧾 Ver ticket</a>}
                  </td>
                  <td className="py-1 text-right font-mono">{m.entra ? plata(m.entra, caja.moneda) : ""}</td>
                  <td className="py-1 text-right font-mono">{m.sale ? plata(m.sale, caja.moneda) : ""}</td>
                  <td className={`py-1 text-right font-mono font-semibold ${m.saldo < 0 ? "text-gypi-red" : ""}`}>{plata(m.saldo, caja.moneda)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="m-0 text-[13px] text-gypi-dim">Sin movimientos todavía.</p>}
        {movimientos.length > MAX_MOVIMIENTOS && <p className="m-0 text-[12px] text-gypi-dim">Se ven los últimos {MAX_MOVIMIENTOS}. El resto está en Movimientos, filtrando por esta caja.</p>}
      </div>
    </Modal>
  );
}

/* ─── Mi caja: qué se ofrece y lo que espera revisión (F3b, 176) ───── */

function ConfigMiCaja({ datos, onCerrar, onGuardado }) {
  const toast = useToast();
  const sirven = useMemo(() => tiposParaMiCaja(datos.tipos || []), [datos.tipos]);
  const [elegidos, setElegidos] = useState({ gastos: new Set(datos.mi_caja?.gastos || []), ingresos: new Set(datos.mi_caja?.ingresos || []) });
  const [buscar, setBuscar] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const b = normal(buscar);
  const alternar = (lado, codigo) => setElegidos((x) => {
    const nuevo = new Set(x[lado]);
    if (nuevo.has(codigo)) nuevo.delete(codigo); else nuevo.add(codigo);
    return { ...x, [lado]: nuevo };
  });

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await postTesoreria({ accion: "config_mi_caja", gastos: [...elegidos.gastos], ingresos: [...elegidos.ingresos] });
      toast.success("Listo: Mi caja ya ofrece esos tipos");
      onGuardado();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  const listaDe = (lado, titulo) => (
    <fieldset className="border border-gypi-border rounded-lg p-2 m-0 min-w-0">
      <legend className="px-1 text-[13px] font-bold">{titulo} ({elegidos[lado].size})</legend>
      <ul className="list-none m-0 p-0 max-h-[30vh] overflow-y-auto">
        {sirven[lado].filter((t) => !b || normal(`${t.codigo} ${t.nombre}`).includes(b)).map((t) => (
          <li key={t.codigo}>
            <label className="flex items-center gap-2 py-1 text-[13px] cursor-pointer">
              <input type="checkbox" checked={elegidos[lado].has(t.codigo)} onChange={() => alternar(lado, t.codigo)} />
              <span className="flex-1 min-w-0">{t.nombre || t.codigo}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );

  return (
    <Modal open onClose={onCerrar} title="Qué se carga desde Mi caja" maxWidth={640}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0">
          Cada responsable de una caja la ve en su celular (📱 Mi caja) y carga lo que gastó y la plata que recibió.
          Elegí qué tipos de operación le aparecen: él ve el nombre y la cuenta la pone el tipo. Lo que carga te queda &quot;Para revisar&quot; acá.
        </p>
        <input className="g-input w-full" placeholder="Buscar tipo…" aria-label="Buscar tipo" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        {listaDe("gastos", "Gastos")}
        {listaDe("ingresos", "Plata que recibe")}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>
    </Modal>
  );
}

function RevisarMiCaja({ datos, pendientes, onCerrar, onCambio }) {
  const toast = useToast();
  const [ocupado, setOcupado] = useState(null);
  const [tipos, setTipos] = useState({});
  const [error, setError] = useState(null);
  const cuentasCaja = useMemo(() => new Set(datos.tesoreria.map((t) => t.cuenta)), [datos.tesoreria]);
  const sirven = useMemo(() => tiposParaMiCaja(datos.tipos || []), [datos.tipos]);
  const nombreTipo = (c) => (datos.tipos || []).find((t) => t.codigo === c)?.nombre || c;

  async function hacer(op, accion) {
    setOcupado(op.id);
    setError(null);
    try {
      await postTesoreria(accion === "revisar" ? { accion, id: op.id, tipo: tipos[op.id] || op.tipo } : { accion, id: op.id });
      toast.success(accion === "revisar" ? "Confirmado" : "Anulado");
      onCambio();
    } catch (e) {
      setError(e.message);
    }
    setOcupado(null);
  }

  return (
    <Modal open onClose={onCerrar} title={`Para revisar de Mi caja (${pendientes.length})`} maxWidth={640}>
      <div className="flex flex-col gap-2 text-[14px] text-gypi-text">
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        {!pendientes.length && <p className="m-0 text-gypi-dim">No queda nada para revisar.</p>}
        <ul className="list-none m-0 p-0 flex flex-col gap-2" aria-label="Para revisar">
          {pendientes.map((op) => {
            const gasto = cuentasCaja.has(op.cuenta_haber);
            const caja = datos.tesoreria.find((t) => t.cuenta === (gasto ? op.cuenta_haber : op.cuenta_debe));
            const opciones = gasto ? sirven.gastos : sirven.ingresos;
            return (
              <li key={op.id} className="p-2.5 rounded-lg border border-gypi-border flex flex-col gap-1.5">
                <span className="flex items-baseline gap-2">
                  <span className="flex-1 min-w-0 font-semibold">{op.cargada_por_nombre || "—"} · {caja?.nombre}</span>
                  <span className={`font-mono font-semibold ${gasto ? "text-gypi-red" : "text-gypi-green-ink"}`}>{gasto ? "−" : "+"}{plata(op.total, op.moneda)}</span>
                </span>
                <span className="text-[12px] text-gypi-dim">{fechaCorta(op.fecha)} · {op.descripcion}</span>
                {op.comprobante_url && <a href={op.comprobante_url} target="_blank" rel="noopener noreferrer" className="text-[13px] text-gypi-cyan underline self-start">🧾 Ver ticket</a>}
                <span className="flex flex-wrap items-center gap-2">
                  <select className="g-input flex-1 min-w-[180px]" aria-label={`Tipo del movimiento ${op.id}`} value={tipos[op.id] || op.tipo} onChange={(e) => setTipos((x) => ({ ...x, [op.id]: e.target.value }))}>
                    {!opciones.some((t) => t.codigo === op.tipo) && <option value={op.tipo}>{nombreTipo(op.tipo)}</option>}
                    {opciones.map((t) => <option key={t.codigo} value={t.codigo}>{t.nombre || t.codigo}</option>)}
                  </select>
                  <button type="button" className="g-btn g-btn-primary" disabled={ocupado === op.id} onClick={() => hacer(op, "revisar")}>✓ Confirmar</button>
                  <button type="button" className="g-btn g-btn-secondary" disabled={ocupado === op.id} onClick={() => hacer(op, "anular_mi_caja")}>Anular</button>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}

/* ─── Pantalla ───────────────────────────────────────────────────────── */

export default function FinanzasTesoreria() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [ficha, setFicha] = useState(null);
  const [transferir, setTransferir] = useState(null);
  const [iniciales, setIniciales] = useState(false);
  const [inactivas, setInactivas] = useState(false);
  const [verRevisar, setVerRevisar] = useState(false);
  const [verConfig, setVerConfig] = useState(false);
  const [extracto, setExtracto] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const res = await apiFetch("/api/finanzas/tesoreria");
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudieron cargar las cajas");
      setDatos(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const saldos = useMemo(() => (datos ? saldosTesoreria(datos.operaciones, datos.tesoreria) : []), [datos]);
  const totales = useMemo(() => totalesTesoreria(saldos), [saldos]);
  const pendientes = useMemo(() => paraRevisarMiCaja(datos?.operaciones), [datos]);

  if (error) return <p role="alert" className="m-[18px] text-[14px] text-gypi-red">⚠ {error}</p>;
  if (!datos) return <div className="flex-1 flex items-center justify-center py-10"><Spinner /></div>;
  if (!datos.tesoreria.length) {
    return <p className="m-[18px] text-[14px] text-gypi-text">Primero copiá el libro en Finanzas → 🧾 Configuración: no hay cajas ni bancos cargados.</p>;
  }
  const visibles = saldos.filter((s) => inactivas || s.activa !== false);
  const cajaFicha = ficha ? saldos.find((s) => s.cuenta === ficha) : null;

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <p className="m-0 text-[15px] text-gypi-text flex-1 min-w-[200px]">
          En pesos <b className="font-mono">{plata(totales.ARS, "ARS")}</b>{Math.abs(totales.USD) >= 0.01 && <> · En dólares <b className="font-mono">{plata(totales.USD, "USD")}</b></>}
        </p>
        <button type="button" className="g-btn g-btn-primary" onClick={() => setTransferir("")}>⇄ Pasar plata</button>
        <button type="button" className="g-btn g-btn-secondary" onClick={() => setIniciales(true)}>📥 Cargar saldos iniciales</button>
        <button type="button" className="g-btn g-btn-secondary" onClick={() => setVerConfig(true)}>⚙ Mi caja</button>
      </div>
      {pendientes.length > 0 && (
        <button type="button" onClick={() => setVerRevisar(true)}
          className="w-full mb-3 p-3 rounded-lg border border-gypi-amber/40 bg-gypi-amber/10 text-left text-[14px] font-semibold text-gypi-amber-ink cursor-pointer">
          📱 {pendientes.length === 1 ? "1 movimiento" : `${pendientes.length} movimientos`} de Mi caja para revisar
        </button>
      )}
      {ORDEN_TIPOS.map((tipo) => {
        const grupo = visibles.filter((s) => (s.tipo || "otro") === tipo);
        if (!grupo.length) return null;
        return (
          <section key={tipo} aria-label={NOMBRE_GRUPO[tipo]} className="mb-4">
            <h2 className="m-0 mb-1.5 text-[14px] font-bold text-gypi-dim">{NOMBRE_GRUPO[tipo]}</h2>
            <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
              {grupo.map((s) => (
                <li key={s.cuenta}>
                  <button type="button" onClick={() => setFicha(s.cuenta)}
                    className={`w-full text-left min-h-[48px] px-3 py-2 rounded-lg border border-gypi-border bg-gypi-surface cursor-pointer ${s.activa === false ? "opacity-60" : ""}`}>
                    <span className="flex items-baseline gap-2 text-[14px] text-gypi-text">
                      <span className="font-semibold flex-1 min-w-0 truncate">{s.nombre}</span>
                      <span className={`font-mono font-semibold ${s.saldo < 0 ? "text-gypi-red" : ""}`}>{plata(s.saldo, s.moneda)}</span>
                    </span>
                    <span className="block text-[12px] text-gypi-dim">
                      {s.ultimo ? `Último movimiento ${fechaCorta(s.ultimo)}` : "Sin movimientos"}
                      {s.responsable_id && datos.personal.find((p) => p.id === s.responsable_id) ? ` · ${datos.personal.find((p) => p.id === s.responsable_id).nombre}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {saldos.some((s) => s.activa === false) && (
        <label className="flex items-center gap-2 text-[13px] text-gypi-dim">
          <input type="checkbox" checked={inactivas} onChange={(e) => setInactivas(e.target.checked)} /> Ver las inactivas
        </label>
      )}

      {cajaFicha && <Ficha caja={cajaFicha} datos={datos} onCerrar={() => setFicha(null)} onTransferir={() => { setTransferir(cajaFicha.cuenta); setFicha(null); }} onExtracto={() => { setExtracto(cajaFicha.cuenta); setFicha(null); }} />}
      {extracto && <SubirExtracto caja={saldos.find((s) => s.cuenta === extracto) || { cuenta: extracto, nombre: extracto }} datos={datos} onCerrar={() => setExtracto(null)} onCargado={() => { setExtracto(null); cargar(); }} />}
      {transferir !== null && <Transferir datos={datos} desdeInicial={transferir} onCerrar={() => setTransferir(null)} onHecho={() => { setTransferir(null); cargar(); }} />}
      {verRevisar && <RevisarMiCaja datos={datos} pendientes={pendientes} onCerrar={() => setVerRevisar(false)} onCambio={cargar} />}
      {verConfig && <ConfigMiCaja datos={datos} onCerrar={() => setVerConfig(false)} onGuardado={() => { setVerConfig(false); cargar(); }} />}
      {iniciales && <SaldosIniciales datos={datos} onCerrar={() => setIniciales(false)} onCargados={() => { setIniciales(false); cargar(); }} />}
    </div>
  );
}
