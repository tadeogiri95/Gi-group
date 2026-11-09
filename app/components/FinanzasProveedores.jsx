'use client';
// app/components/FinanzasProveedores.jsx — Finanzas → 🏭 Proveedores (parte
// F2a, 2; reemplaza CC_PROVEEDORES del libro; /api/finanzas/proveedores;
// reglas en app/lib/finanzasProveedores.js). Sin migración.
//
// La cuenta corriente de cada proveedor sale de las operaciones que tocan la
// cuenta Proveedores: lo comprado sube la deuda, lo pagado la baja. La ficha
// muestra las facturas que faltan pagar (los pagos van a las más viejas) con
// sus días, y los movimientos con el saldo renglón por renglón.
// "Cargar saldos iniciales" lee T-OPERACIONES del libro hasta una fecha de
// corte y carga el saldo de cada proveedor contra Ajuste De Capital.
// Parte 3 (09/11): "📚 Cuenta de cada proveedor" (la del Estado de
// Resultados, aprendida de lo cargado y confirmada por el dueño) y, en la
// ficha, cargar una compra sin factura o una nota de crédito.
// Parte 4: "📄 Importar CSV del S.O.S" (app/components/FinanzasSos.jsx).
// Parte 5: "🔗 Cliente y proveedor" y la cuenta unificada en la ficha.
// Solo el rol Dueño (la pantalla ni aparece para los demás).
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyAr, numero, plata } from "../lib/finanzasOperaciones";
import {
  CLASES_COMPRA, CUENTA_AJUSTE_CAPITAL, ORIGEN_SALDO_INICIAL, cuentaDeProveedor, cuentasAprendidas, emparejarProveedor, movimientosProveedor, pendientesProveedor, saldosDelLibro, saldosProveedores,
} from "../lib/finanzasProveedores";
import { Chip, Modal, Spinner } from "./ui";
import { NuevaOrden, leerDatosPagos } from "./FinanzasPagos";
import FinanzasSos from "./FinanzasSos";
import FinanzasUnificados, { LineaUnificada } from "./FinanzasUnificados";
import { useToast } from "./ui/Toast";

const MAX_LISTA = 300;
const fechaCorta = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}` : "");
const normal = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Texto del saldo: "Le debemos $ X", "A favor $ X" o "Al día". */
export function textoSaldo(deuda) {
  if (deuda >= 0.01) return { texto: `Le debemos ${plata(deuda, "ARS")}`, clase: "text-gypi-text" };
  if (deuda <= -0.01) return { texto: `A favor ${plata(-deuda, "ARS")}`, clase: "text-gypi-green" };
  return { texto: "Al día", clase: "text-gypi-dim" };
}

async function leerOperacionesDelLibro(file) {
  const { hojasXlsx, leerHojaXlsx } = await import("../lib/leerXlsx");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hoja = hojasXlsx(bytes).find((n) => normal(n) === "TOPERACIONES");
  if (!hoja) return null;
  return leerHojaXlsx(bytes, hoja, { maxFilas: 60000, maxCols: 60 }) || [];
}

/* ─── Saldos iniciales ───────────────────────────────────────────────── */

function SaldosIniciales({ datos, cuentasProv, onCerrar, onCargados }) {
  const toast = useToast();
  const [grilla, setGrilla] = useState(null);
  const [fecha, setFecha] = useState(hoyAr());
  const [elegidos, setElegidos] = useState({});
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const yaCargados = (datos.operaciones || []).some((o) => o.origen === ORIGEN_SALDO_INICIAL);

  const resultado = useMemo(() => (grilla ? saldosDelLibro(grilla, fecha, cuentasProv) : null), [grilla, fecha, cuentasProv]);
  const filas = useMemo(() => (resultado?.filas || []).map((f) => {
    const elegido = elegidos[f.nombre];
    const proveedor_id = elegido !== undefined ? elegido : (emparejarProveedor(f.nombre, datos.proveedores)?.id ?? "");
    return { ...f, proveedor_id };
  }), [resultado, elegidos, datos.proveedores]);
  const total = filas.reduce((s, f) => s + f.deuda, 0);

  async function abrir(file) {
    if (!file) return;
    setLeyendo(true);
    setError(null);
    try {
      const g = await leerOperacionesDelLibro(file);
      if (!g) throw new Error("El archivo no tiene la hoja T-OPERACIONES.");
      setGrilla(g);
      setElegidos({});
    } catch (e) {
      setError(e.message || "No se pudo leer el archivo");
    } finally {
      setLeyendo(false);
    }
  }

  async function cargar() {
    setGuardando(true);
    try {
      const res = await apiFetch("/api/finanzas/proveedores", {
        method: "POST",
        body: JSON.stringify({ accion: "saldos_iniciales", fecha, filas: filas.map((f) => ({ proveedor_id: f.proveedor_id ? Number(f.proveedor_id) : null, nombre: f.nombre, deuda: f.deuda })) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudieron cargar los saldos");
      toast.success(`Saldos iniciales cargados: ${d.cargados} proveedores`);
      onCargados();
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onCerrar} title="Cargar saldos iniciales" maxWidth={720}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0">
          Subí el libro (.xlsx). Se suma todo lo de T-OPERACIONES que toca Proveedores hasta la fecha de corte, por proveedor,
          y cada saldo entra como &quot;SALDO INICIAL&quot; contra Ajuste De Capital. Lo que cargues en Gypi después de esa fecha sigue desde ahí.
        </p>
        {yaCargados && <p className="m-0 text-[13px] text-gypi-amber-ink">⚠ Ya hay saldos iniciales cargados: los de los proveedores que cargues ahora se reemplazan.</p>}
        <div className="flex flex-wrap items-end gap-2">
          <label className="g-btn g-btn-secondary cursor-pointer">
            {leyendo ? "Leyendo…" : grilla ? "Elegir otro archivo" : "📂 Subir el libro"}
            <input type="file" accept=".xlsx,.xlsm" className="sr-only" aria-label="Subir el libro contable" disabled={leyendo} onChange={(e) => { abrir(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-semibold ml-auto">
            Fecha de corte (incluida)
            <input type="date" className="g-input" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />
          </label>
        </div>
        {(error || resultado?.error) && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error || resultado.error}</p>}
        {resultado && !resultado.error && (
          <>
            <p className="m-0 text-[13px] text-gypi-dim">
              {filas.length} proveedores con saldo al {fechaCorta(fecha)} · Total que les debemos <b className="text-gypi-text">{plata(total, "ARS")}</b>.
              Elegí a qué proveedor de Gypi va cada uno; si no está en la lista queda con el nombre del libro.
            </p>
            <div className="max-h-[50vh] overflow-y-auto border border-gypi-border rounded-lg">
              <table className="w-full text-[13px] border-collapse" aria-label="Saldos del libro">
                <thead>
                  <tr className="text-gypi-dim text-left">
                    <th className="font-semibold p-2">En el libro</th>
                    <th className="font-semibold p-2">Proveedor en Gypi</th>
                    <th className="font-semibold p-2 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.nombre} className="border-t border-gypi-border">
                      <td className="p-2">
                        {f.nombre}
                        {f.variantes > 1 && <span className="block text-[12px] text-gypi-dim">escrito de {f.variantes} formas</span>}
                      </td>
                      <td className="p-2">
                        <select className="g-input w-full" aria-label={`Proveedor para ${f.nombre}`} value={f.proveedor_id}
                          onChange={(e) => setElegidos((x) => ({ ...x, [f.nombre]: e.target.value }))}>
                          <option value="">— Nombre del libro —</option>
                          {datos.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                        </select>
                      </td>
                      <td className={`p-2 text-right font-mono ${textoSaldo(f.deuda).clase}`}>{plata(f.deuda, "ARS")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

/* ─── Parte 3: la cuenta de cada proveedor ───────────────────────────── */

/** Las cuentas que se pueden elegir: todas menos Proveedores. */
function opcionesCuenta(datos, cuentasProv) {
  return (datos.cuentas || []).filter((c) => !cuentasProv.has(c.codigo) && c.activa !== false);
}

/** Lo que aprendió de las compras (sin saldos iniciales ni Ajuste De Capital). */
export function aprendidasDe(datos, cuentasProv) {
  const ajuste = new Set((datos.cuentas || []).filter((c) => CUENTA_AJUSTE_CAPITAL.test(String(c.nombre || "").trim())).map((c) => c.codigo));
  const ops = (datos.operaciones || []).filter((op) => op.origen !== ORIGEN_SALDO_INICIAL);
  return cuentasAprendidas(ops, cuentasProv, { excluir: ajuste });
}

function SelectCuenta({ value, onChange, opciones, label }) {
  return (
    <select className="g-input w-full" aria-label={label} value={value || ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">Sin elegir</option>
      {opciones.map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre} ({c.codigo})</option>)}
    </select>
  );
}

function CuentasDeProveedores({ datos, cuentasProv, aprendidas, onCerrar, onGuardadas }) {
  const toast = useToast();
  const guardadas = datos.cuentas_guardadas || {};
  const opciones = useMemo(() => opcionesCuenta(datos, cuentasProv), [datos, cuentasProv]);
  const nombreCuenta = useMemo(() => new Map((datos.cuentas || []).map((c) => [c.codigo, c.nombre])), [datos]);
  const [elegidas, setElegidas] = useState(() => {
    const o = {};
    for (const p of datos.proveedores || []) {
      const c = cuentaDeProveedor(`p${p.id}`, guardadas, aprendidas);
      if (c) o[`p${p.id}`] = c;
    }
    return o;
  });
  const [buscar, setBuscar] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const filas = useMemo(() => {
    const b = normal(buscar);
    return (datos.proveedores || [])
      .filter((p) => p.activo !== false || guardadas[`p${p.id}`] || aprendidas.has(`p${p.id}`))
      .filter((p) => !b || normal(p.nombre).includes(b))
      .sort((a, b2) => Number(aprendidas.has(`p${b2.id}`)) - Number(aprendidas.has(`p${a.id}`)) || String(a.nombre).localeCompare(String(b2.nombre)));
  }, [datos, buscar, guardadas, aprendidas]);
  const cambios = Object.keys({ ...guardadas, ...elegidas }).filter((k) => (elegidas[k] || "") !== (guardadas[k] || ""));

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const cuentas = Object.fromEntries(cambios.map((k) => [k, elegidas[k] || null]));
      const res = await apiFetch("/api/finanzas/proveedores", { method: "POST", body: JSON.stringify({ accion: "cuentas", cuentas }) });
      const x = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(x.error || "No se pudo guardar");
      toast.success(`Listo: ${x.cuentas} proveedores con su cuenta`);
      onGuardadas();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={guardando ? () => {} : onCerrar} title="Cuenta de cada proveedor" maxWidth={720}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px] text-gypi-dim">
          Es la cuenta del Estado de Resultados donde va lo que se le compra. Ya viene puesta la que más usaste con ese proveedor en el libro y en Gypi; cambiala si hace falta y apretá Guardar. La usan las facturas de las órdenes de compra y las compras sin factura.
        </p>
        <input className="g-input" aria-label="Buscar proveedor" placeholder="Buscar proveedor" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        <ul className="list-none m-0 p-0 flex flex-col gap-2 max-h-[50vh] overflow-y-auto" aria-label="Cuentas de proveedores">
          {filas.slice(0, MAX_LISTA).map((p) => {
            const k = `p${p.id}`;
            const a = aprendidas.get(k);
            return (
              <li key={p.id} className="flex flex-col gap-1 border-b border-gypi-border pb-2">
                <span className="font-semibold">{p.nombre}</span>
                <SelectCuenta label={`Cuenta de ${p.nombre}`} value={elegidas[k]} opciones={opciones} onChange={(v) => setElegidas((o) => ({ ...o, [k]: v }))} />
                <span className="text-[12px] text-gypi-dim">
                  {guardadas[k] ? "✅ Guardada" : a ? "Sugerida, falta guardar" : "Sin compras para sugerir"}
                  {a && ` · En sus compras: ${nombreCuenta.get(a.cuenta) || a.cuenta} (${a.veces} de ${a.de})`}
                </span>
              </li>
            );
          })}
        </ul>
        {filas.length > MAX_LISTA && <p className="m-0 text-[13px] text-gypi-dim">Hay {filas.length - MAX_LISTA} más: usá el buscador.</p>}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" disabled={guardando} onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={guardando || !cambios.length} onClick={guardar}>
            {guardando ? "Guardando…" : `Guardar (${cambios.length})`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Parte 3: compra sin factura o nota de crédito ──────────────────── */

function CompraManual({ clase, saldo, datos, cuentasProv, cuenta, onCerrar, onCargada }) {
  const toast = useToast();
  const opciones = useMemo(() => opcionesCuenta(datos, cuentasProv), [datos, cuentasProv]);
  const [f, setF] = useState({ fecha: hoyAr(), importe: "", iva: "", numero: "", cuenta: cuenta || "", descripcion: "" });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const nc = clase === "nota_credito";
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function guardar() {
    setError(null);
    const importe = numero(f.importe);
    const iva = nc ? numero(f.iva) : 0;
    if (!(importe > 0)) return setError("Poné el importe total");
    if (Number.isNaN(iva)) return setError("El IVA no es un número");
    setGuardando(true);
    try {
      const res = await apiFetch("/api/finanzas/proveedores", {
        method: "POST",
        body: JSON.stringify({ accion: "compra", clase, proveedor_id: saldo.proveedor_id, fecha: f.fecha, importe, iva, numero: f.numero, cuenta: f.cuenta, descripcion: f.descripcion }),
      });
      const x = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(x.error || "No se pudo guardar");
      toast.success(nc ? "Nota de crédito cargada" : "Compra cargada");
      onCargada();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={guardando ? () => {} : onCerrar} title={`${CLASES_COMPRA[clase]} · ${saldo.nombre}`} maxWidth={520}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px] text-gypi-dim">
          {nc ? "Baja lo que le debemos y el gasto de la cuenta. Si la nota trae IVA, ponelo aparte." : "Para lo que se compró con remito o ticket, sin factura: sube lo que le debemos, sin IVA."}
        </p>
        <label className="flex flex-col gap-1">Fecha<input type="date" className="g-input" value={f.fecha} onChange={set("fecha")} /></label>
        <label className="flex flex-col gap-1">{nc ? "Total de la nota (con IVA)" : "Importe"}<input className="g-input" inputMode="decimal" value={f.importe} onChange={set("importe")} placeholder="0,00" /></label>
        {nc && <label className="flex flex-col gap-1">IVA de la nota (si tiene)<input className="g-input" inputMode="decimal" value={f.iva} onChange={set("iva")} placeholder="0,00" /></label>}
        <label className="flex flex-col gap-1">{nc ? "Número de la nota" : "Número de remito o ticket"}<input className="g-input" value={f.numero} onChange={set("numero")} maxLength={60} /></label>
        <div className="flex flex-col gap-1">
          <span>Cuenta del gasto</span>
          <SelectCuenta label="Cuenta del gasto" value={f.cuenta} opciones={opciones} onChange={(v) => setF((x) => ({ ...x, cuenta: v }))} />
        </div>
        <label className="flex flex-col gap-1">Detalle (opcional)<input className="g-input" value={f.descripcion} onChange={set("descripcion")} maxLength={300} /></label>
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" disabled={guardando} onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={guardando || !f.cuenta} onClick={guardar}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Ficha de un proveedor ──────────────────────────────────────────── */

function Ficha({ saldo, datos, cuentasProv, aprendidas, onCerrar, onCargada }) {
  const [vista, setVista] = useState("pendientes");
  const [manual, setManual] = useState(null);
  const cuenta = cuentaDeProveedor(saldo.clave, datos.cuentas_guardadas || {}, aprendidas);
  const nombreCuenta = cuenta ? (datos.cuentas || []).find((c) => c.codigo === cuenta)?.nombre || cuenta : null;
  const [pagos, setPagos] = useState(null);
  const [abriendo, setAbriendo] = useState(false);
  const [errorPago, setErrorPago] = useState(null);
  async function pagar() {
    setErrorPago(null);
    setAbriendo(true);
    try {
      setPagos(await leerDatosPagos());
    } catch (e) {
      setErrorPago(e.message);
    } finally {
      setAbriendo(false);
    }
  }
  const movimientos = useMemo(() => movimientosProveedor(datos.operaciones, saldo.clave, cuentasProv), [datos, saldo, cuentasProv]);
  const pendientes = useMemo(() => pendientesProveedor(movimientos, hoyAr()), [movimientos]);
  const s = textoSaldo(saldo.deuda);
  return (
    <Modal open onClose={onCerrar} title={saldo.nombre || "Proveedor"} maxWidth={640}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className={`m-0 text-[18px] font-bold ${s.clase}`}>{s.texto}</p>
        <p className="m-0 text-[13px] text-gypi-dim">Comprado {plata(saldo.comprado, "ARS")} · Pagado {plata(saldo.pagado, "ARS")}</p>
        {nombreCuenta && <p className="m-0 text-[13px]">Cuenta: <b>{nombreCuenta}</b>{!(datos.cuentas_guardadas || {})[saldo.clave] && <span className="text-gypi-dim"> (sugerida)</span>}</p>}
        {saldo.proveedor_id ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="g-btn g-btn-primary" disabled={abriendo} onClick={pagar}>{abriendo ? "Abriendo…" : "💸 Pagar"}</button>
            <button type="button" className="g-btn g-btn-secondary" onClick={() => setManual("sin_factura")}>＋ Compra sin factura</button>
            <button type="button" className="g-btn g-btn-secondary" onClick={() => setManual("nota_credito")}>＋ Nota de crédito</button>
          </div>
        ) : (
          <p className="m-0 text-[12px] text-gypi-dim">Para pagarle con una orden de pago, primero sumalo a la lista de proveedores.</p>
        )}
        {saldo.proveedor_id && <LineaUnificada proveedorId={saldo.proveedor_id} onCambio={onCargada} />}
        {errorPago && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {errorPago}</p>}
        <div className="flex gap-2">
          <Chip active={vista === "pendientes"} onClick={() => setVista("pendientes")}>Falta pagar ({pendientes.length})</Chip>
          <Chip active={vista === "movimientos"} onClick={() => setVista("movimientos")}>Movimientos ({movimientos.length})</Chip>
        </div>
        {vista === "pendientes" ? (
          pendientes.length ? (
            <table className="w-full text-[13px] border-collapse" aria-label="Falta pagar">
              <thead>
                <tr className="text-gypi-dim text-left">
                  <th className="font-semibold py-1">Compra</th>
                  <th className="font-semibold py-1 text-right">Importe</th>
                  <th className="font-semibold py-1 text-right">Falta</th>
                  <th className="font-semibold py-1 text-right">Días</th>
                </tr>
              </thead>
              <tbody>
                {pendientes.map((p) => (
                  <tr key={p.op.id} className="border-t border-gypi-border">
                    <td className="py-1">
                      <span className="font-mono text-[12px] text-gypi-dim">{fechaCorta(p.op.fecha)}</span> {p.op.tipo}
                      {p.op.descripcion && <span className="block text-[12px] text-gypi-dim truncate">{p.op.descripcion}</span>}
                    </td>
                    <td className="py-1 text-right font-mono">{plata(p.importe, "ARS")}</td>
                    <td className="py-1 text-right font-mono font-semibold">{plata(p.falta, "ARS")}</td>
                    <td className={`py-1 text-right font-mono ${p.dias > 60 ? "text-gypi-red font-semibold" : p.dias > 30 ? "text-gypi-amber-ink" : ""}`}>{p.dias}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="m-0 text-[13px] text-gypi-dim">No hay compras sin pagar.</p>
        ) : (
          <table className="w-full text-[13px] border-collapse" aria-label="Movimientos del proveedor">
            <thead>
              <tr className="text-gypi-dim text-left">
                <th className="font-semibold py-1">Fecha</th>
                <th className="font-semibold py-1 text-right">Compra</th>
                <th className="font-semibold py-1 text-right">Pago</th>
                <th className="font-semibold py-1 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {[...movimientos].reverse().map((m) => (
                <tr key={m.op.id} className="border-t border-gypi-border">
                  <td className="py-1">
                    <span className="font-mono text-[12px] text-gypi-dim">{fechaCorta(m.op.fecha)}</span> {m.op.tipo}
                    {m.op.descripcion && <span className="block text-[12px] text-gypi-dim truncate">{m.op.descripcion}</span>}
                  </td>
                  <td className="py-1 text-right font-mono">{m.compra ? plata(m.compra, "ARS") : ""}</td>
                  <td className="py-1 text-right font-mono">{m.pago ? plata(m.pago, "ARS") : ""}</td>
                  <td className="py-1 text-right font-mono font-semibold">{plata(m.saldo, "ARS")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {pagos && (
        <NuevaOrden datos={pagos} proveedorId={saldo.proveedor_id} pendientes={pendientes} onCerrar={() => setPagos(null)}
          onGuardada={() => setPagos(null)} />
      )}
      {manual && (
        <CompraManual clase={manual} saldo={saldo} datos={datos} cuentasProv={cuentasProv} cuenta={cuenta}
          onCerrar={() => setManual(null)} onCargada={() => { setManual(null); onCargada(); }} />
      )}
    </Modal>
  );
}

/* ─── Pantalla ───────────────────────────────────────────────────────── */

export default function FinanzasProveedores() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [buscar, setBuscar] = useState("");
  const [filtro, setFiltro] = useState("deuda");
  const [ficha, setFicha] = useState(null);
  const [iniciales, setIniciales] = useState(false);
  const [verCuentas, setVerCuentas] = useState(false);
  const [sos, setSos] = useState(false);
  const [unificados, setUnificados] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await apiFetch("/api/finanzas/proveedores");
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudieron cargar los proveedores");
      setDatos(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const cuentasProv = useMemo(() => new Set(datos?.cuentas_proveedores || []), [datos]);
  const aprendidas = useMemo(() => (datos ? aprendidasDe(datos, cuentasProv) : new Map()), [datos, cuentasProv]);
  const saldos = useMemo(() => (datos ? saldosProveedores(datos.operaciones, cuentasProv, datos.proveedores) : []), [datos, cuentasProv]);
  const lista = useMemo(() => {
    const b = normal(buscar);
    return saldos.filter((s) => (filtro === "deuda" ? s.deuda >= 0.01 : filtro === "favor" ? s.deuda <= -0.01 : true) && (!b || normal(s.nombre).includes(b)));
  }, [saldos, buscar, filtro]);

  if (error) return <p role="alert" className="m-[18px] text-[14px] text-gypi-red">⚠ {error}</p>;
  if (!datos) return <div className="flex-1 flex items-center justify-center py-10"><Spinner /></div>;
  if (!cuentasProv.size) {
    return <p className="m-[18px] text-[14px] text-gypi-text">Primero copiá el libro en Finanzas → 🧾 Configuración: falta la cuenta &quot;Proveedores&quot; en el plan de cuentas.</p>;
  }

  const debemos = saldos.reduce((s, x) => s + Math.max(0, x.deuda), 0);
  const aFavor = saldos.reduce((s, x) => s + Math.max(0, -x.deuda), 0);
  const cuantos = (f) => saldos.filter((s) => (f === "deuda" ? s.deuda >= 0.01 : s.deuda <= -0.01)).length;

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <p className="m-0 text-[14px] text-gypi-text">
          Les debemos <b>{plata(debemos, "ARS")}</b>{aFavor >= 0.01 && <> · A favor nuestro <b className="text-gypi-green">{plata(aFavor, "ARS")}</b></>}
        </p>
        <button type="button" className="g-btn g-btn-secondary ml-auto" onClick={() => setVerCuentas(true)}>📚 Cuenta de cada proveedor</button>
        <button type="button" className="g-btn g-btn-secondary" onClick={() => setSos(true)}>📄 Importar CSV del S.O.S</button>
        <button type="button" className="g-btn g-btn-secondary" onClick={() => setUnificados(true)}>🔗 Cliente y proveedor</button>
        <button type="button" className="g-btn g-btn-secondary" onClick={() => setIniciales(true)}>📥 Cargar saldos iniciales</button>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Chip active={filtro === "deuda"} onClick={() => setFiltro("deuda")}>Les debemos ({cuantos("deuda")})</Chip>
        <Chip active={filtro === "favor"} onClick={() => setFiltro("favor")}>A favor ({cuantos("favor")})</Chip>
        <Chip active={filtro === "todos"} onClick={() => setFiltro("todos")}>Todos ({saldos.length})</Chip>
        <input className="g-input flex-1 min-w-[180px]" aria-label="Buscar proveedor" placeholder="Buscar proveedor" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
      </div>
      <ul className="list-none m-0 p-0 flex flex-col gap-1.5" aria-label="Proveedores">
        {lista.slice(0, MAX_LISTA).map((s) => {
          const t = textoSaldo(s.deuda);
          return (
            <li key={s.clave}>
              <button type="button" onClick={() => setFicha(s)}
                className="w-full text-left min-h-[48px] px-3 py-2 rounded-lg border border-gypi-border bg-gypi-surface cursor-pointer">
                <span className="flex items-baseline gap-2 text-[14px] text-gypi-text">
                  <span className="font-semibold flex-1 min-w-0 truncate">{s.nombre || "Sin nombre"}</span>
                  <span className={`font-mono font-semibold ${t.clase}`}>{t.texto}</span>
                </span>
                <span className="block text-[12px] text-gypi-dim">
                  Último movimiento {fechaCorta(s.ultimo)}{!s.proveedor_id && " · No está en la lista de proveedores"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {lista.length > MAX_LISTA && <p className="mt-2 text-[13px] text-gypi-dim">Hay {lista.length - MAX_LISTA} más: usá el buscador.</p>}
      {!lista.length && (
        <p className="mt-2 text-[13px] text-gypi-dim">
          {saldos.length ? "Ningún proveedor con ese filtro." : "Todavía no hay compras ni pagos a proveedores. Empezá cargando los saldos iniciales del libro."}
        </p>
      )}

      {ficha && <Ficha saldo={ficha} datos={datos} cuentasProv={cuentasProv} aprendidas={aprendidas} onCerrar={() => setFicha(null)} onCargada={() => { setFicha(null); cargar(); }} />}
      {unificados && <FinanzasUnificados onCerrar={() => setUnificados(false)} onCambio={cargar} />}
      {sos && <FinanzasSos onCerrar={() => setSos(false)} onImportado={() => { setSos(false); cargar(); }} />}
      {verCuentas && <CuentasDeProveedores datos={datos} cuentasProv={cuentasProv} aprendidas={aprendidas} onCerrar={() => setVerCuentas(false)} onGuardadas={() => { setVerCuentas(false); cargar(); }} />}
      {iniciales && <SaldosIniciales datos={datos} cuentasProv={cuentasProv} onCerrar={() => setIniciales(false)} onCargados={() => { setIniciales(false); cargar(); }} />}
    </div>
  );
}
