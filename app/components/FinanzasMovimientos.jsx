'use client';
// app/components/FinanzasMovimientos.jsx — Finanzas → 📒 Movimientos (parte
// F1b; tabla fin_operaciones de la migración 171; /api/finanzas/operaciones;
// reglas en app/lib/finanzasOperaciones.js).
//
// Es T-OPERACIONES dentro de Gypi: la lista del período con filtros por tipo,
// caja o banco, proveedor, OT y centro de costo, y "+ Nueva operación". Al
// elegir el tipo se completan solas las cuentas; si un lado es una caja o un
// banco se elige cuál. Muestra el asiento antes de guardar (con el IVA en su
// cuenta) y no deja guardar lo que hoy marca CHK_CARGA. Nada se borra: una
// operación mal cargada se anula y se carga de nuevo.
// "🧾 Cargar gasto o factura" (parte 5 del 11/11) carga un gasto devengado en
// su mes, con su deuda y su pago: FinanzasCargarGasto.jsx.
// Parte 9: aviso de los costos de Flota y Maquinaria para pasar a Finanzas
// (FinanzasIntegracion.jsx).
// Solo el rol Dueño (la pantalla ni aparece para los demás).
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { textoOt } from "../lib/nombreOt";
import { leyendaTipo, nombreTipo } from "../lib/finanzasTipos";
import { armarAgenda, opcionesAgenda } from "../lib/finanzasPersonas";
import { useAgenda } from "./FinanzasElegirProveedor";
import { VentanaAltaPersona } from "./AltaPersona";
import CargarGasto from "./FinanzasCargarGasto";
import { CostosMantenimiento } from "./FinanzasIntegracion";
import { ORIGEN_GASTO, tiposDeGasto } from "../lib/finanzasGastos";
import { esDeMantenimiento } from "../lib/finanzasIntegracion";
import { MARCA_CORREGIDA, dondeSeCambia, puedeAnular, puedeCorregir } from "../lib/finanzasCorregir";
import CorregirOperacion from "./FinanzasCorregir";
import DescargarExtracto from "./FinanzasDescargarExtracto";
import { ORIGENES, asientoDe, cajasDelLado, cuentasDelTipo, filtrarOperaciones, hoyAr, inicioMes, ladoCaja, movimientoCaja, numero, plata, validarOperacion, separaIva } from "../lib/finanzasOperaciones";
import { cuentaParaElegir, cuentasIniciales } from "../lib/finanzasCuentaElegir";
import { Chip, Modal, SelectBuscable, Spinner } from "./ui";
import { useToast } from "./ui/Toast";

const OTRO = "__otro";
const MAX_LISTA = 300;

function campo(label, input, extra = "") {
  return (
    <label className={`flex flex-col gap-1 text-[13px] lg:text-[14px] font-semibold text-gypi-text ${extra}`}>
      {label}
      {input}
    </label>
  );
}

const fechaCorta = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}` : "");
/** La agenda (parte 4): la de 📇 Personas o, sin la 180, solo los proveedores. */
const agendaDe = (datos, agenda) => (agenda?.length ? agenda : armarAgenda({ proveedores: datos.proveedores || [] }));

/** La agenda más los que se dieron de alta recién con ➕ Nuevo (todavía no vuelven en la lista). */
const conNuevas = (lista, nuevas) => {
  const igual = (e, n) => e.clave === n.clave || (n.proveedor_id && n.proveedor_id === e.proveedor_id) || (n.cliente_id && n.cliente_id === e.cliente_id);
  return [...lista.map((e) => ({ ...e, ...nuevas.find((n) => igual(e, n)) })), ...nuevas.filter((n) => !lista.some((e) => igual(e, n)))];
};

/** En los cobros y las ventas el que se da de alta es, casi siempre, un cliente. */
const esDeCliente = (tipo) => /^(COBROS|VENTAS)$/.test(String(tipo?.grupo || "").toUpperCase());

/** El nombre de un tipo por su código ("COBRO A CLIENTES" → "Cobro a clientes"). */
const nombreDeTipo = (codigo, tipos) => nombreTipo(tipos.find((t) => t.codigo === codigo) || { codigo });
// Entra en verde con +, sale en rojo con −; los pases y lo que no toca una caja, sin color
const SIGNO_LADO = { entra: "+ ", sale: "− " };
const COLOR_LADO = { entra: "text-gypi-green", sale: "text-gypi-red" };
const nombreCuenta = (codigo, cuentas) => cuentas.find((c) => c.codigo === codigo)?.nombre || codigo || "—";

/* ─── Asiento ────────────────────────────────────────────────────────── */

function Asiento({ op, datos }) {
  const { renglones, aviso } = asientoDe(op, datos);
  const usd = op.moneda === "USD" && Number(op.tipo_cambio) > 0;
  return (
    <div>
      <table className="w-full text-[13px] border-collapse" aria-label="Asiento">
        <thead>
          <tr className="text-gypi-dim text-left">
            <th className="font-semibold py-1">Cuenta</th>
            <th className="font-semibold py-1 text-right">Debe</th>
            <th className="font-semibold py-1 text-right">Haber</th>
          </tr>
        </thead>
        <tbody>
          {renglones.map((r, i) => (
            <tr key={i} className="border-t border-gypi-border">
              <td className={`py-1 ${r.lado === "haber" ? "pl-4" : ""}`}>
                <span className="block text-gypi-text">{r.nombre || "Sin cuenta"}</span>
                <span className="block text-[12px] text-gypi-dim font-mono">{r.cuenta || "—"}</span>
              </td>
              <td className="py-1 text-right font-mono">{r.lado === "debe" ? plata(r.importe, op.moneda) : ""}</td>
              <td className="py-1 text-right font-mono">{r.lado === "haber" ? plata(r.importe, op.moneda) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {usd && <p className="mt-1 text-[12px] text-gypi-dim">En pesos: {plata(Number(op.total) * Number(op.tipo_cambio))} (dólar a {plata(op.tipo_cambio)}). Las cuentas corrientes van en pesos.</p>}
      {aviso && <p className="mt-1 text-[12px] text-gypi-amber-ink">⚠ {aviso}</p>}
    </div>
  );
}

/* ─── Nueva operación ────────────────────────────────────────────────── */

const VACIA = {
  fecha: "", tipo: "", proveedor_id: "", entidad: "", proyecto_id: "", centro_costo: "",
  neto: "", iva: "", otros_impuestos: "", moneda: "ARS", tipo_cambio: "",
  cuenta_debe: "", cuenta_haber: "", descripcion: "", referencia: "",
};

function NuevaOperacion({ datos, onCerrar, onGuardada }) {
  const toast = useToast();
  const agenda = useAgenda();
  const [f, setF] = useState({ ...VACIA, fecha: hoyAr() });
  const [otroNombre, setOtroNombre] = useState(false);
  const [alta, setAlta] = useState(null);
  const [nuevas, setNuevas] = useState([]);
  const [cambiarCuentas, setCambiarCuentas] = useState(false);
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const tipo = datos.tipos.find((t) => t.codigo === f.tipo);
  const cajasDebe = cajasDelLado(tipo?.cuenta_debe, datos.tesoreria);
  const cajasHaber = cajasDelLado(tipo?.cuenta_haber, datos.tesoreria);
  const elegir = cuentaParaElegir(tipo, datos.cuentas);
  const tiposActivos = datos.tipos.filter((t) => t.activo !== false);
  const grupos = [...new Set(tiposActivos.map((t) => t.grupo || "Otros"))];

  const elegirTipo = (e) => {
    const t = datos.tipos.find((x) => x.codigo === e.target.value);
    setF((x) => {
      // Un tipo sin IVA junta lo que estaba en neto, IVA y otros en un solo importe
      const junto = t && !separaIva(t) && (numero(x.iva) || numero(x.otros_impuestos))
        ? { neto: String(Math.round(((numero(x.neto) || 0) + (numero(x.iva) || 0) + (numero(x.otros_impuestos) || 0)) * 100) / 100).replace(".", ","), iva: "", otros_impuestos: "" }
        : {};
      return { ...x, ...junto, tipo: e.target.value, ...cuentasIniciales(t, datos.cuentas, cuentasDelTipo(t, datos.tesoreria)) };
    });
    setErrores([]);
  };

  const conIva = !tipo || separaIva(tipo);
  const neto = numero(f.neto) || 0;
  const iva = conIva ? numero(f.iva) || 0 : 0;
  const otros = conIva ? numero(f.otros_impuestos) || 0 : 0;
  const total = Math.round((neto + iva + otros) * 100) / 100;
  const vista = { ...f, neto, iva, otros_impuestos: otros, total, tipo_cambio: numero(f.tipo_cambio) || null };

  const guardar = async () => {
    const operacion = { ...f, ...(conIva ? {} : { iva: "", otros_impuestos: "" }), proveedor_id: otroNombre ? "" : f.proveedor_id, entidad: f.proveedor_id && !otroNombre ? "" : f.entidad };
    const { errores: e } = validarOperacion(operacion, datos);
    setErrores(e);
    if (e.length) return;
    setGuardando(true);
    try {
      const res = await apiFetch("/api/finanzas/operaciones", { method: "POST", body: JSON.stringify({ accion: "crear", operacion }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErrores(d.errores || [d.error || "No se pudo guardar"]); return; }
      toast.success("✅ Operación guardada");
      onGuardada();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setGuardando(false);
    }
  };

  const selectCaja = (lado, cajas) => campo(
    lado === "debe" ? "Caja o banco que recibe" : "Caja o banco que paga",
    <SelectBuscable className="g-input w-full" listaAncha value={f[`cuenta_${lado}`]} onChange={set(`cuenta_${lado}`)}>
      <option value="">Elegí…</option>
      {cajas.opciones.map((c) => <option key={c.cuenta} value={c.cuenta}>{c.nombre}{c.moneda === "USD" ? " (USD)" : ""}</option>)}
    </SelectBuscable>,
  );
  const selectCuenta = (lado) => campo(
    lado === "debe" ? "Cuenta del debe" : "Cuenta del haber",
    <SelectBuscable className="g-input w-full" listaAncha value={f[`cuenta_${lado}`]} onChange={set(`cuenta_${lado}`)}>
      <option value="">Elegí…</option>
      {datos.cuentas.filter((c) => c.activa !== false || c.codigo === f[`cuenta_${lado}`]).map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nombre}</option>)}
    </SelectBuscable>,
  );

  return (
    <Modal open onClose={onCerrar} title="Nueva operación" grande>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-[170px_1fr] gap-3">
          {campo("Fecha", <input type="date" className="g-input w-full" value={f.fecha} onChange={set("fecha")} />)}
          {campo("Tipo de operación", (
            <SelectBuscable className="g-input w-full" value={f.tipo} onChange={elegirTipo}>
              <option value="">Elegí…</option>
              {grupos.map((g) => (
                <optgroup key={g} label={g}>
                  {tiposActivos.filter((t) => (t.grupo || "Otros") === g).map((t) => <option key={t.codigo} value={t.codigo}>{nombreTipo(t)}</option>)}
                </optgroup>
              ))}
            </SelectBuscable>
          ))}
        </div>
        {tipo && leyendaTipo(tipo) && <p className="-mt-2 m-0 text-[13px] leading-snug text-gypi-dim" aria-label="Qué comprende este tipo">ℹ {leyendaTipo(tipo)}</p>}

        {/* En la computadora, dos columnas: a la izquierda de dónde sale y a
            quién; a la derecha cuánto y el detalle (11/11, ventana grande). */}
        {tipo && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-4 items-start">
            <section className="flex flex-col gap-3" aria-label="Cuentas y a quién">
              <h3 className="g-overline m-0 text-gypi-dim">Cuentas y a quién</h3>
              {(cajasDebe || cajasHaber) && !cambiarCuentas && (
                <div className="flex flex-col gap-3">
                  {cajasDebe && selectCaja("debe", cajasDebe)}
                  {cajasHaber && selectCaja("haber", cajasHaber)}
                </div>
              )}
              {elegir && !cambiarCuentas && (
                <div className="flex flex-col gap-1.5">
                  <p className="m-0 text-[13px] lg:text-[14px] font-semibold text-gypi-text">{elegir.pregunta}{elegir.obligatoria ? " (obligatorio)" : ""}</p>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label={elegir.pregunta}>
                    {elegir.opciones.map((o) => (
                      <Chip key={o.codigo} active={f[`cuenta_${elegir.lado}`] === o.codigo} onClick={() => setF((x) => ({ ...x, [`cuenta_${elegir.lado}`]: o.codigo }))}>{o.etiqueta}</Chip>
                    ))}
                    <Chip onClick={() => setCambiarCuentas(true)}>Otra cuenta…</Chip>
                  </div>
                </div>
              )}
              {/* Debe y haber uno debajo del otro, a todo el ancho: en dos columnas el nombre de la cuenta se cortaba (12/11) */}
              {cambiarCuentas ? (
                <div className="flex flex-col gap-3">
                  {selectCuenta("debe")}
                  {selectCuenta("haber")}
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-lg bg-gypi-surface px-3 py-2 text-[13px] lg:text-[14px] text-gypi-dim">
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span>Debe: <b className="text-gypi-text">{nombreCuenta(f.cuenta_debe, datos.cuentas)}</b></span>
                    <span>Haber: <b className="text-gypi-text">{nombreCuenta(f.cuenta_haber, datos.cuentas)}</b></span>
                  </div>
                  <button type="button" className="g-btn g-btn-secondary shrink-0" onClick={() => setCambiarCuentas(true)}>Cambiar cuentas</button>
                </div>
              )}

              {campo(`Proveedor o cliente${tipo.pide_entidad ? " (obligatorio)" : ""}`, (
                <SelectBuscable className="g-input w-full" value={otroNombre ? OTRO : f.proveedor_id ? `p${f.proveedor_id}` : f.entidad ? `n${f.entidad}` : ""}
                  nuevo={{ etiqueta: "Nuevo cliente o proveedor", onElegir: (nombre) => setAlta({ nombre }) }} onChange={(e) => {
                  const v = e.target.value;
                  if (v === OTRO) { setOtroNombre(true); setF((x) => ({ ...x, proveedor_id: "", entidad: "" })); return; }
                  setOtroNombre(false);
                  // p<id>: un proveedor de la lista; n<nombre>: un cliente o alguien de la agenda
                  setF((x) => ({ ...x, proveedor_id: v.startsWith("p") ? v.slice(1) : "", entidad: v.startsWith("n") ? v.slice(1) : "" }));
                }}>
                  <option value="">Ninguno</option>
                  {opcionesAgenda(conNuevas(agendaDe(datos, agenda), nuevas)).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  <option value={OTRO}>Otro: escribir el nombre sin darlo de alta</option>
                </SelectBuscable>
              ))}
              <VentanaAltaPersona abierta={!!alta} onCerrar={() => setAlta(null)} nombre={alta?.nombre || ""}
                rol={esDeCliente(tipo) ? "cliente" : "proveedor"} roles={esDeCliente(tipo) ? ["cliente", "proveedor"] : ["proveedor", "cliente"]}
                onCreada={(p) => {
                  setNuevas((x) => [...x.filter((n) => n.clave !== p.clave), p]);
                  setOtroNombre(false);
                  // Un proveedor queda con su id; un cliente, con su nombre (como los de la agenda)
                  setF((x) => ({ ...x, proveedor_id: p.proveedor_id ? String(p.proveedor_id) : "", entidad: p.proveedor_id ? "" : p.nombre }));
                }} />
              {otroNombre && campo("Nombre", <input className="g-input w-full" value={f.entidad} onChange={set("entidad")} placeholder="Cliente u otro" />)}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {campo(`OT${tipo.pide_ot ? " (obligatoria)" : ""}`, (
                  <SelectBuscable className="g-input w-full" value={f.proyecto_id} onChange={set("proyecto_id")}>
                    <option value="">Sin OT</option>
                    {datos.proyectos.map((p) => <option key={p.id} value={p.id}>{textoOt(p)}</option>)}
                  </SelectBuscable>
                ))}
                {campo(`Centro de costo${tipo.pide_cc ? " (obligatorio)" : ""}`, (
                  <SelectBuscable className="g-input w-full" value={f.centro_costo} onChange={set("centro_costo")}>
                    <option value="">Sin centro de costo</option>
                    {datos.centros.filter((c) => c.activo !== false).map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre && c.nombre.toUpperCase() !== c.codigo.toUpperCase() ? `${c.codigo} · ${c.nombre}` : c.codigo}</option>)}
                  </SelectBuscable>
                ))}
              </div>
            </section>

            <section className="flex flex-col gap-3" aria-label="Importe y detalle">
              <h3 className="g-overline m-0 text-gypi-dim">Importe y detalle</h3>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex gap-1.5" aria-label="Moneda">
                  <Chip active={f.moneda === "ARS"} onClick={() => setF((x) => ({ ...x, moneda: "ARS" }))}>Pesos</Chip>
                  <Chip active={f.moneda === "USD"} onClick={() => setF((x) => ({ ...x, moneda: "USD" }))}>Dólares</Chip>
                </div>
                {f.moneda === "USD" && campo("Tipo de cambio ($ por dólar)", <input className="g-input w-[160px]" inputMode="decimal" value={f.tipo_cambio} onChange={set("tipo_cambio")} placeholder="1450" />)}
              </div>
              {conIva ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {campo("Neto", <input className="g-input w-full" inputMode="decimal" value={f.neto} onChange={set("neto")} placeholder="0,00" />)}
                  {campo("IVA", <input className="g-input w-full" inputMode="decimal" value={f.iva} onChange={set("iva")} placeholder="0,00" />)}
                  {campo("Otros impuestos", <input className="g-input w-full" inputMode="decimal" value={f.otros_impuestos} onChange={set("otros_impuestos")} placeholder="0,00" />)}
                </div>
              ) : (
                <>
                  {campo("Importe", <input className="g-input w-full sm:w-[260px]" inputMode="decimal" value={f.neto} onChange={set("neto")} placeholder="0,00" />)}
                  <p className="-mt-1 m-0 text-[12px] lg:text-[13px] text-gypi-dim">En {String(tipo.grupo || "este tipo").toLowerCase()} no se separa el IVA: va el importe total. El IVA se carga en la compra o la venta.</p>
                </>
              )}
              <p className="m-0 text-[16px] lg:text-[18px] font-bold text-gypi-text">Total: {plata(total, f.moneda)}</p>

              {campo("Descripción", <textarea className="g-input w-full" rows={2} value={f.descripcion} onChange={set("descripcion")} />)}
              {campo("Referencia (factura, recibo, número de transferencia)", <input className="g-input w-full" value={f.referencia} onChange={set("referencia")} />)}

              {total > 0 && f.cuenta_debe && f.cuenta_haber && (
                <section className="rounded-lg border border-gypi-border bg-gypi-surface p-3">
                  <h3 className="m-0 mb-1 text-[13px] lg:text-[14px] font-bold text-gypi-text">Así queda el asiento</h3>
                  <Asiento op={vista} datos={datos} />
                </section>
              )}
            </section>
          </div>
        )}

        {errores.length > 0 && (
          <ul role="alert" className="m-0 pl-5 text-[13px] lg:text-[14px] text-gypi-red">
            {errores.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}
        <div className="flex justify-end gap-2 border-t border-gypi-border pt-3">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={guardando || !tipo} onClick={guardar}>{guardando ? "Guardando…" : "Guardar operación"}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Detalle y anular ───────────────────────────────────────────────── */

/** Compra que salió de una factura: el dueño elige el tipo y Gypi lo recuerda para el proveedor. */
function CambiarTipo({ op, datos, onCambiado }) {
  const toast = useToast();
  const [tipo, setTipo] = useState(op.tipo);
  const [recordar, setRecordar] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const deMantenimiento = esDeMantenimiento(op);
  const opciones = (deMantenimiento ? tiposDeGasto(datos.tipos, datos.tesoreria || []) : datos.tipos).filter((t) => t.activo !== false && t.cuenta_debe && t.cuenta_haber);
  const guardar = async () => {
    setGuardando(true);
    try {
      const res = await apiFetch("/api/finanzas/operaciones", { method: "POST", body: JSON.stringify({ accion: "cambiar_tipo", id: op.id, tipo, recordar: recordar && !!op.proveedor_id }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo cambiar el tipo");
      toast.success("✅ Tipo guardado");
      onCambiado();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  };
  return (
    <section className="rounded-lg border border-gypi-border bg-gypi-surface p-3 flex flex-col gap-2">
      {campo(deMantenimiento ? "Tipo de gasto" : "Tipo de compra", (
        <SelectBuscable className="g-input w-full" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {opciones.map((t) => <option key={t.codigo} value={t.codigo}>{nombreTipo(t)}</option>)}
        </SelectBuscable>
      ))}
      {op.proveedor_id && (
        <label className="flex items-center gap-2 text-[13px] text-gypi-text cursor-pointer">
          <input type="checkbox" checked={recordar} onChange={(e) => setRecordar(e.target.checked)} /> Usar este tipo para las próximas facturas de este proveedor
        </label>
      )}
      <button type="button" className="g-btn g-btn-primary self-end" disabled={guardando || (tipo === op.tipo && op.estado !== "para_revisar")} onClick={guardar}>
        {guardando ? "Guardando…" : op.estado === "para_revisar" && tipo === op.tipo ? "Confirmar tipo" : "Guardar tipo"}
      </button>
    </section>
  );
}

/** "Anulada por Tadeo" o, si se corrigió, "Corregida por Tadeo (la nueva está aparte)". */
function textoAnulada(op) {
  const quien = String(op.anulada_por_nombre || "");
  if (quien.endsWith(MARCA_CORREGIDA)) {
    const n = quien.slice(0, -MARCA_CORREGIDA.length).trim();
    return `Corregida${n ? ` por ${n}` : ""} (la corrección es otra operación)`;
  }
  return `Anulada${quien ? ` por ${quien}` : ""}`;
}

const SIN_NOMBRES = { entidad: (op) => op.entidad || null, ot: () => null };

// 12/11: también se corrige (✏) y se anula lo copiado del libro, los plazos
// fijos, el extracto, los saldos iniciales y Mi caja (finanzasCorregir.js).
export function Detalle({ op, datos, nombres = SIN_NOMBRES, onCerrar, onAnulada }) {
  const toast = useToast();
  const [confirmar, setConfirmar] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [corrigiendo, setCorrigiendo] = useState(false);
  const gasto = op.origen === ORIGEN_GASTO;
  const automatica = !puedeAnular(op) && !op.anulada_at;
  const compra = ["factura_oc", "factura_oc_otra", "factura_suelta"].includes(op.origen);
  const deMantenimiento = esDeMantenimiento(op);

  const anular = async () => {
    setAnulando(true);
    try {
      const res = await apiFetch("/api/finanzas/operaciones", { method: "POST", body: JSON.stringify({ accion: "anular", id: op.id }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo anular");
      toast.success("Operación anulada");
      onAnulada();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setAnulando(false);
    }
  };

  const fila = (k, v) => v ? <p className="m-0 text-[13px]"><span className="text-gypi-dim">{k}:</span> <span className="text-gypi-text">{v}</span></p> : null;
  return (
    <Modal open onClose={onCerrar} title={`${nombreDeTipo(op.tipo, datos.tipos)} · ${fechaCorta(op.fecha)}`} maxWidth={560}>
      <div className="flex flex-col gap-2">
        {op.anulada_at && <p className="m-0 text-[13px] font-semibold text-gypi-red">{textoAnulada(op)} el {fechaCorta(op.anulada_at.slice(0, 10))}</p>}
        {fila("Proveedor o cliente", nombres.entidad(op))}
        {fila("OT", nombres.ot(op))}
        {fila("Centro de costo", op.centro_costo)}
        {fila("Descripción", op.descripcion)}
        {fila("Referencia", op.referencia)}
        {fila("Cargada por", op.cargada_por_nombre)}
        {op.origen && op.origen !== "manual" && fila("Salió de", ORIGENES[op.origen] || op.origen)}
        {op.estado === "para_revisar" && !op.anulada_at && (
          <p className="m-0 text-[13px] font-semibold text-gypi-amber-ink">
            {deMantenimiento
              ? "Para revisar: Gypi lo pasó solo desde Mantenimiento. Mirá el tipo y el importe y confirmalo. Si tenía factura con IVA, anulalo: vuelve a aparecer en el aviso 🔧 de Flota y Maquinaria para cargarlo con la factura."
              : "Para revisar: el proveedor no tiene tipo de compra. Elegí el que corresponde."}
          </p>
        )}
        <div className="mt-1"><Asiento op={op} datos={datos} /></div>
        {(compra || deMantenimiento) && !op.anulada_at && <CambiarTipo op={op} datos={datos} onCambiado={onAnulada} />}
        {automatica && !compra && !op.anulada_at && <p className="m-0 text-[12px] text-gypi-dim">Se cambia o se anula desde {dondeSeCambia(op)}.</p>}
        {corrigiendo && <CorregirOperacion op={op} cuentas={datos.cuentas || []} onCancelar={() => setCorrigiendo(false)} onCorregida={onAnulada} />}
        {compra && !op.anulada_at && <p className="m-0 text-[12px] text-gypi-dim">Los importes vienen de la factura: si la corregís o la anulás en Compras, esta compra se corrige o se anula sola.</p>}
        {!op.anulada_at && !automatica && !corrigiendo && (
          <div className="flex flex-wrap justify-end gap-2 mt-2">
            {!confirmar && puedeCorregir(op) && <button type="button" className="g-btn g-btn-secondary" onClick={() => setCorrigiendo(true)}>✏ Corregir</button>}
            {confirmar ? (
              <>
                <span className="self-center text-[13px] text-gypi-text">{gasto ? "¿Anular este gasto? Se anula junto con su pago, si lo cargaste. Queda tachado y no suma." : "¿Anular esta operación? Queda tachada y no suma."}</span>
                <button type="button" className="g-btn g-btn-secondary" onClick={() => setConfirmar(false)}>No</button>
                <button type="button" className="g-btn g-btn-primary" disabled={anulando} onClick={anular}>{anulando ? "Anulando…" : "Sí, anular"}</button>
              </>
            ) : (
              <button type="button" className="g-btn g-btn-secondary" onClick={() => setConfirmar(true)}>Anular operación</button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ─── Pantalla ───────────────────────────────────────────────────────── */

export default function FinanzasMovimientos() {
  const [periodo, setPeriodo] = useState(() => ({ desde: inicioMes(hoyAr()), hasta: hoyAr() }));
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [filtros, setFiltros] = useState({ revisar: false, tipo: "", caja: "", proveedor: "", proyecto: "", centro: "", buscar: "", anuladas: false });
  // Los filtros se pliegan: en el celular la lista quedaba debajo de 10 casillas (11/11, revisión de interfaz)
  const [verFiltros, setVerFiltros] = useState(false);
  const [nueva, setNueva] = useState(false);
  const [cargarGasto, setCargarGasto] = useState(false);
  const [detalle, setDetalle] = useState(null);
  const [descargar, setDescargar] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/finanzas/operaciones?desde=${periodo.desde}&hasta=${periodo.hasta}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudieron cargar los movimientos");
      setDatos(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [periodo]);
  useEffect(() => { cargar(); }, [cargar]);

  const nombres = useMemo(() => {
    const prov = new Map((datos?.proveedores || []).map((p) => [String(p.id), p.nombre]));
    const ots = new Map((datos?.proyectos || []).map((p) => [String(p.id), p]));
    return {
      entidad: (op) => (op.proveedor_id ? prov.get(String(op.proveedor_id)) : null) || op.entidad || "",
      ot: (op) => (op.proyecto_id && ots.get(String(op.proyecto_id)) ? textoOt(ots.get(String(op.proyecto_id))) : ""),
    };
  }, [datos]);

  const lista = useMemo(
    () => filtrarOperaciones(datos?.operaciones, filtros, (op) => `${nombres.entidad(op)} ${nombres.ot(op)}`),
    [datos, filtros, nombres],
  );

  if (error) return <p role="alert" className="m-[18px] text-[14px] text-gypi-red">⚠ {error}</p>;
  if (!datos) return <div className="flex-1 flex items-center justify-center py-10"><Spinner /></div>;
  if (!datos.tipos.length) {
    return <p className="m-[18px] text-[14px] text-gypi-text">Primero copiá el libro en Finanzas → 🧾 Configuración: sin tipos de operación no se pueden cargar movimientos.</p>;
  }

  const setFiltro = (k) => (e) => setFiltros((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const caja = datos.tesoreria.find((t) => t.cuenta === filtros.caja);
  const entro = caja ? lista.reduce((s, op) => s + Math.max(0, movimientoCaja(op, caja)), 0) : 0;
  const salio = caja ? lista.reduce((s, op) => s + Math.max(0, -movimientoCaja(op, caja)), 0) : 0;
  const filtro = (k, label, opciones) => (
    <SelectBuscable className="g-input min-w-[150px] flex-1" aria-label={label} value={filtros[k]} onChange={setFiltro(k)}>
      <option value="">{label}: todos</option>
      {opciones}
    </SelectBuscable>
  );
  const revisar = (datos.operaciones || []).filter((o) => o.estado === "para_revisar" && !o.anulada_at).length;
  const activos = ["tipo", "caja", "proveedor", "proyecto", "centro"].filter((k) => filtros[k]).length;
  const usadas = (k) => new Set((datos.operaciones || []).map((o) => String(o[k] ?? "")).filter(Boolean));
  const provUsados = usadas("proveedor_id");
  const otsUsadas = usadas("proyecto_id");

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      <div className="flex flex-wrap items-end gap-2 mb-2">
        <button type="button" className="g-btn g-btn-primary" onClick={() => setNueva(true)}>+ Nueva operación</button>
        <button type="button" className="g-btn g-btn-secondary" onClick={() => setCargarGasto(true)}>🧾 Cargar gasto o factura</button>
        <button type="button" className="g-btn g-btn-secondary" onClick={() => setDescargar(true)}>⬇ Descargar extracto</button>
        {campo("Desde", <input type="date" className="g-input" value={periodo.desde} onChange={(e) => e.target.value && setPeriodo((p) => ({ ...p, desde: e.target.value }))} />, "ml-auto")}
        {campo("Hasta", <input type="date" className="g-input" value={periodo.hasta} onChange={(e) => e.target.value && setPeriodo((p) => ({ ...p, hasta: e.target.value }))} />)}
      </div>
      <CostosMantenimiento datosGasto={datos} onCargado={cargar} />
      {verFiltros && (
      <div className="flex flex-wrap gap-2 mb-2">
        {filtro("tipo", "Tipo", [...new Set((datos.operaciones || []).map((o) => o.tipo))].map((t) => [t, nombreDeTipo(t, datos.tipos)]).sort((a, b) => a[1].localeCompare(b[1], "es")).map(([t, n]) => <option key={t} value={t}>{n}</option>))}
        {filtro("caja", "Caja o banco", datos.tesoreria.map((t) => <option key={t.cuenta} value={t.cuenta}>{t.nombre}</option>))}
        {filtro("proveedor", "Proveedor", datos.proveedores.filter((p) => provUsados.has(String(p.id))).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>))}
        {filtro("proyecto", "OT", datos.proyectos.filter((p) => otsUsadas.has(String(p.id))).map((p) => <option key={p.id} value={p.id}>{textoOt(p)}</option>))}
        {filtro("centro", "Centro de costo", datos.centros.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo}</option>))}
      </div>
      )}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input className="g-input flex-1 min-w-[180px]" aria-label="Buscar" placeholder="Buscar por descripción, proveedor u OT" value={filtros.buscar} onChange={setFiltro("buscar")} />
        <button type="button" onClick={() => setVerFiltros((v) => !v)} aria-expanded={verFiltros}
          className={`min-h-[44px] px-3 rounded-lg border text-[13px] font-semibold cursor-pointer ${activos ? "bg-gypi-amber/15 border-gypi-amber text-gypi-amber-ink" : "bg-gypi-bg border-gypi-border text-gypi-dim"}`}>
          ⚙ Filtros{activos ? ` (${activos})` : ""}
        </button>
        {revisar > 0 && (
          <label className="flex items-center gap-2 text-[13px] font-semibold text-gypi-amber-ink cursor-pointer">
            <input type="checkbox" checked={filtros.revisar} onChange={setFiltro("revisar")} /> Solo para revisar ({revisar})
          </label>
        )}
        <label className="flex items-center gap-2 text-[13px] text-gypi-text cursor-pointer">
          <input type="checkbox" checked={filtros.anuladas} onChange={setFiltro("anuladas")} /> Ver anuladas
        </label>
      </div>

      <p className="mb-2 text-[13px] text-gypi-dim">
        {lista.length} {lista.length === 1 ? "operación" : "operaciones"}
        {caja && <> · Entró <b className="text-gypi-text">{plata(entro, caja.moneda)}</b> · Salió <b className="text-gypi-text">{plata(salio, caja.moneda)}</b> · Diferencia <b className="text-gypi-text">{plata(entro - salio, caja.moneda)}</b></>}
      </p>
      {datos.truncado && <p className="mb-2 text-[13px] text-gypi-amber-ink">⚠ Hay muchas operaciones en el período: se ven las primeras. Achicá las fechas.</p>}

      <ul className="list-none m-0 p-0 flex flex-col gap-1.5" aria-label="Operaciones">
        {lista.slice(0, MAX_LISTA).map((op) => {
          const quien = nombres.entidad(op);
          const ot = nombres.ot(op);
          const lado = ladoCaja(op, datos.tesoreria);
          return (
            <li key={op.id}>
              <button type="button" onClick={() => setDetalle(op)}
                className={`w-full text-left min-h-[48px] px-3 py-2 rounded-lg border border-gypi-border bg-gypi-surface cursor-pointer ${op.anulada_at ? "opacity-60" : ""}`}>
                <span className={`flex items-baseline gap-2 text-[14px] text-gypi-text ${op.anulada_at ? "line-through" : ""}`}>
                  <span className="text-gypi-dim font-mono text-[12px]">{fechaCorta(op.fecha)}</span>
                  <span className="font-semibold flex-1 min-w-0 truncate">{nombreDeTipo(op.tipo, datos.tipos)}{quien ? ` · ${quien}` : ""}</span>
                  <span className={`font-mono font-semibold ${COLOR_LADO[lado.como] || ""}`}>{SIGNO_LADO[lado.como] || ""}{plata(op.total, op.moneda)}</span>
                </span>
                <span className="block text-[12px] text-gypi-dim truncate">
                  {lado.texto || `${nombreCuenta(op.cuenta_debe, datos.cuentas)} ← ${nombreCuenta(op.cuenta_haber, datos.cuentas)}`}
                  {ot ? ` · ${ot}` : ""}{op.descripcion ? ` · ${op.descripcion}` : ""}
                </span>
                {(ORIGENES[op.origen] || op.estado === "para_revisar") && (
                  <span className="block text-[12px] text-gypi-dim">
                    {ORIGENES[op.origen] || ""}
                    {op.estado === "para_revisar" && !op.anulada_at && <b className="ml-1 text-gypi-amber-ink">· Para revisar</b>}
                  </span>
                )}
                {op.anulada_at && <span className="block text-[12px] font-semibold text-gypi-red">Anulada</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {lista.length > MAX_LISTA && <p className="mt-2 text-[13px] text-gypi-dim">Hay {lista.length - MAX_LISTA} más: usá los filtros o achicá las fechas.</p>}
      {!lista.length && <p className="mt-2 text-[13px] text-gypi-dim">No hay operaciones en el período con esos filtros.</p>}

      {nueva && <NuevaOperacion datos={datos} onCerrar={() => setNueva(false)} onGuardada={() => { setNueva(false); cargar(); }} />}
      {cargarGasto && <CargarGasto datos={datos} onCerrar={() => setCargarGasto(false)} onGuardada={() => { setCargarGasto(false); cargar(); }} />}
      {detalle && <Detalle op={detalle} datos={datos} nombres={nombres} onCerrar={() => setDetalle(null)} onAnulada={() => { setDetalle(null); cargar(); }} />}
      {descargar && (
        <DescargarExtracto desde={periodo.desde} hasta={periodo.hasta} filtros={filtros} listas={datos} onCerrar={() => setDescargar(false)}
          filtrosTexto={[
            filtros.caja && (caja?.nombre || filtros.caja),
            filtros.tipo && nombreDeTipo(filtros.tipo, datos.tipos),
            filtros.proveedor && datos.proveedores.find((p) => String(p.id) === String(filtros.proveedor))?.nombre,
            filtros.proyecto && textoOt(datos.proyectos.find((p) => String(p.id) === String(filtros.proyecto)) || {}),
            filtros.centro && `Centro ${filtros.centro}`,
            filtros.buscar.trim() && `“${filtros.buscar.trim()}”`,
          ].filter(Boolean)} />
      )}
    </div>
  );
}
