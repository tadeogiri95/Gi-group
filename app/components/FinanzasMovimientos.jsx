'use client';
// app/components/FinanzasMovimientos.jsx — Finanzas → 📒 Movimientos (parte
// F1b; tabla fin_operaciones de la migración 171; /api/finanzas/operaciones;
// reglas en app/lib/finanzasOperaciones.js).
//
// Es T-OPERACIONES dentro de Gypi: la lista del período con filtros por tipo,
// caja o banco, proveedor, OT y centro de costo, y "➕ Cargar" (14/11). Al
// elegir el tipo se completan solas las cuentas; si un lado es una caja o un
// banco se elige cuál. Muestra el asiento antes de guardar (con el IVA en su
// cuenta) y no deja guardar lo que hoy marca CHK_CARGA. Nada se borra: una
// operación mal cargada se anula y se carga de nuevo.
// "🧾 Cargar gasto o factura" (parte 5 del 11/11) carga un gasto devengado en
// su mes, con su deuda y su pago: FinanzasCargarGasto.jsx.
// Parte 9: aviso de los costos de Flota y Maquinaria para pasar a Finanzas
// (FinanzasIntegracion.jsx).
// 13/11 (parte 3 del plan de Tesorería): ya no es una pantalla aparte; es la
// lista de 💰 Tesorería, filtrada por las cajas elegidas arriba.
// Solo el rol Dueño (la pantalla ni aparece para los demás).
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { textoOt } from "../lib/nombreOt";
import { nombreTipo } from "../lib/finanzasTipos";
import { CostosMantenimiento } from "./FinanzasIntegracion";
import { ORIGEN_GASTO, tiposDeGasto } from "../lib/finanzasGastos";
import { esDeMantenimiento } from "../lib/finanzasIntegracion";
import { MARCA_CORREGIDA, dondeSeCambia, puedeAnular, puedeCorregir } from "../lib/finanzasCorregir";
import CorregirOperacion from "./FinanzasCorregir";
import DescargarExtracto from "./FinanzasDescargarExtracto";
import Comprobantes from "./FinanzasComprobantes";
import { comprobantesDe } from "../lib/finanzasAdjuntos";
import { ORIGENES, filtrarOperaciones, hoyAr, inicioMes, ladoCaja, movimientoCaja, plata } from "../lib/finanzasOperaciones";
import { Modal, SelectBuscable, Spinner } from "./ui";
import { useToast } from "./ui/Toast";
import { Asiento } from "./FinanzasNuevaOperacion";
import BotonCargar from "./FinanzasCargar";

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

/** El nombre de un tipo por su código ("COBRO A CLIENTES" → "Cobro a clientes"). */
const nombreDeTipo = (codigo, tipos) => nombreTipo(tipos.find((t) => t.codigo === codigo) || { codigo });
// Entra en verde con +, sale en rojo con −; los pases y lo que no toca una caja, sin color
const SIGNO_LADO = { entra: "+ ", sale: "− " };
const COLOR_LADO = { entra: "text-gypi-green", sale: "text-gypi-red" };
const nombreCuenta = (codigo, cuentas) => cuentas.find((c) => c.codigo === codigo)?.nombre || codigo || "—";

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
/** Los comprobantes de un movimiento ya guardado: se agregan o se quitan en el momento (13/11, parte 4). */
function ComprobantesGuardados({ op, onCambio }) {
  const toast = useToast();
  const [lista, setLista] = useState(() => comprobantesDe(op));
  const [guardando, setGuardando] = useState(false);
  const cambiar = async (nueva) => {
    setGuardando(true);
    try {
      const res = await apiFetch("/api/finanzas/operaciones", { method: "POST", body: JSON.stringify({ accion: "comprobantes", id: op.id, comprobantes: nueva }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudieron guardar los comprobantes");
      setLista(d.comprobantes || nueva);
      toast.success(nueva.length > lista.length ? "Comprobante adjuntado" : "Comprobante quitado");
      onCambio?.();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  };
  return <Comprobantes lista={lista} onCambio={cambiar} disabled={guardando || !!op.anulada_at} />;
}

export function Detalle({ op, datos, nombres = SIN_NOMBRES, onCerrar, onAnulada, onAdjuntos = null }) {
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
        {(!op.anulada_at || comprobantesDe(op).length > 0) && <ComprobantesGuardados op={op} onCambio={onAdjuntos} />}
        {(compra || deMantenimiento) && !op.anulada_at && <CambiarTipo op={op} datos={datos} onCambiado={onAnulada} />}
        {automatica && !compra && !op.anulada_at && <p className="m-0 text-[12px] text-gypi-dim">Se cambia o se anula desde {dondeSeCambia(op)}.</p>}
        {corrigiendo && <CorregirOperacion op={op} cuentas={datos.cuentas || []} onCancelar={() => setCorrigiendo(false)} onCorregida={onAnulada} />}
        {compra && !op.anulada_at && <p className="m-0 text-[12px] text-gypi-dim">Los importes vienen de la factura: si la corregís o la anulás en Compras, esta compra se corrige o se anula sola.</p>}
        {!op.anulada_at && !automatica && !corrigiendo && (
          <div className="flex flex-wrap justify-end gap-2 mt-2">
            {!confirmar && puedeCorregir(op) && <button type="button" className="g-btn g-btn-secondary" onClick={() => setCorrigiendo(true)}>✏ Corregir</button>}
            {confirmar ? (
              <>
                <span className="self-center text-[13px] text-gypi-text">{gasto ? "¿Anular este gasto? Se anula junto con su pago, si lo cargaste. Queda tachado y no suma."
                  : op.origen === "libro" ? "¿Anular esta operación? Queda tachada y no suma. Sigue en tu planilla del libro, pero al pasar el histórico no vuelve."
                    : op.origen === "saldo_inicial" ? "¿Anular este saldo inicial? Queda tachado y no suma. Si volvés a pasar el histórico, la apertura se arma de nuevo."
                      : "¿Anular esta operación? Queda tachada y no suma."}</span>
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

/**
 * La lista de movimientos. Desde el 13/11 (parte 3 del plan) vive dentro de
 * 💰 Tesorería: cajas = las cajas elegidas arriba (ninguna = todo), saldos =
 * el saldo después de cada movimiento cuando hay una sola, cajaNueva = la que
 * queda puesta en "+ Nuevo movimiento", acciones = botones de esa caja,
 * onCambio = avisa que se guardó algo, recargar = vuelve a leer.
 * @param {{ cajas?: string[]|null, saldos?: Map<number, number>|null, cajaNueva?: string, acciones?: any, onCambio?: (() => void)|null, recargar?: number }} props
 */
export default function FinanzasMovimientos({ cajas = null, saldos = null, cajaNueva = "", acciones = null, onCambio = null, recargar = 0 } = {}) {
  const [periodo, setPeriodo] = useState(() => ({ desde: inicioMes(hoyAr()), hasta: hoyAr() }));
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [filtros, setFiltros] = useState({ revisar: false, tipo: "", caja: "", proveedor: "", proyecto: "", centro: "", buscar: "", anuladas: false });
  // Los filtros se pliegan: en el celular la lista quedaba debajo de 10 casillas (11/11, revisión de interfaz)
  const [verFiltros, setVerFiltros] = useState(false);
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
  }, [periodo, recargar]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { cargar(); }, [cargar]);
  const cambio = () => { cargar(); onCambio?.(); };

  const nombres = useMemo(() => {
    const prov = new Map((datos?.proveedores || []).map((p) => [String(p.id), p.nombre]));
    const ots = new Map((datos?.proyectos || []).map((p) => [String(p.id), p]));
    return {
      entidad: (op) => (op.proveedor_id ? prov.get(String(op.proveedor_id)) : null) || op.entidad || "",
      ot: (op) => (op.proyecto_id && ots.get(String(op.proyecto_id)) ? textoOt(ots.get(String(op.proyecto_id))) : ""),
    };
  }, [datos]);

  const elegidas = useMemo(() => new Set(cajas || []), [cajas]);
  const lista = useMemo(
    () => filtrarOperaciones(datos?.operaciones, filtros, (op) => `${nombres.entidad(op)} ${nombres.ot(op)}`)
      .filter((op) => !elegidas.size || elegidas.has(op.cuenta_debe) || elegidas.has(op.cuenta_haber)),
    [datos, filtros, nombres, elegidas],
  );

  if (error) return <p role="alert" className="m-[18px] text-[14px] text-gypi-red">⚠ {error}</p>;
  if (!datos) return <div className="flex-1 flex items-center justify-center py-10"><Spinner /></div>;
  if (!datos.tipos?.length) {
    return <p className="m-[18px] text-[14px] text-gypi-text">Primero copiá el libro en Finanzas → 🧾 Configuración: sin tipos de operación no se pueden cargar movimientos.</p>;
  }

  const setFiltro = (k) => (e) => setFiltros((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const cajaFiltro = elegidas.size === 1 ? [...elegidas][0] : filtros.caja;
  const caja = datos.tesoreria.find((t) => t.cuenta === cajaFiltro);
  const entro = caja ? lista.reduce((s, op) => s + Math.max(0, movimientoCaja(op, caja)), 0) : 0;
  const salio = caja ? lista.reduce((s, op) => s + Math.max(0, -movimientoCaja(op, caja)), 0) : 0;
  const filtro = (k, label, opciones) => (
    <SelectBuscable className="g-input min-w-[150px] flex-1" aria-label={label} value={filtros[k]} onChange={setFiltro(k)}>
      <option value="">{label}: todos</option>
      {opciones}
    </SelectBuscable>
  );
  const revisar = (datos.operaciones || []).filter((o) => o.estado === "para_revisar" && !o.anulada_at).length;
  const activos = ["tipo", ...(elegidas.size ? [] : ["caja"]), "proveedor", "proyecto", "centro"].filter((k) => filtros[k]).length;
  const usadas = (k) => new Set((datos.operaciones || []).map((o) => String(o[k] ?? "")).filter(Boolean));
  const provUsados = usadas("proveedor_id");
  const otsUsadas = usadas("proyecto_id");

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      <div className="flex flex-wrap items-end gap-2 mb-2">
        <BotonCargar contexto={{ caja: cajaNueva }} onHecho={cambio} />
        <button type="button" className="g-btn g-btn-secondary" onClick={() => setDescargar(true)}>⬇ Descargar extracto</button>
        {acciones}
        {campo("Desde", <input type="date" className="g-input" value={periodo.desde} onChange={(e) => e.target.value && setPeriodo((p) => ({ ...p, desde: e.target.value }))} />, "ml-auto")}
        {campo("Hasta", <input type="date" className="g-input" value={periodo.hasta} onChange={(e) => e.target.value && setPeriodo((p) => ({ ...p, hasta: e.target.value }))} />)}
      </div>
      <CostosMantenimiento datosGasto={datos} onCargado={cambio} />
      {verFiltros && (
      <div className="flex flex-wrap gap-2 mb-2">
        {filtro("tipo", "Tipo", [...new Set((datos.operaciones || []).map((o) => o.tipo))].map((t) => [t, nombreDeTipo(t, datos.tipos)]).sort((a, b) => a[1].localeCompare(b[1], "es")).map(([t, n]) => <option key={t} value={t}>{n}</option>))}
        {!elegidas.size && filtro("caja", "Caja o banco", datos.tesoreria.map((t) => <option key={t.cuenta} value={t.cuenta}>{t.nombre}</option>))}
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
                {saldos?.has(op.id) && caja && !op.anulada_at && (
                  <span className="block text-right text-[12px] text-gypi-dim">Saldo <b className={`font-mono ${saldos.get(op.id) < 0 ? "text-gypi-red" : "text-gypi-text"}`}>{plata(saldos.get(op.id), caja.moneda)}</b></span>
                )}
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
                {comprobantesDe(op).length > 0 && <span className="block text-[12px] text-gypi-cyan" aria-label={`${comprobantesDe(op).length} comprobantes`}>📎 {comprobantesDe(op).length}</span>}
                {op.anulada_at && <span className="block text-[12px] font-semibold text-gypi-red">Anulada</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {lista.length > MAX_LISTA && <p className="mt-2 text-[13px] text-gypi-dim">Hay {lista.length - MAX_LISTA} más: usá los filtros o achicá las fechas.</p>}
      {!lista.length && <p className="mt-2 text-[13px] text-gypi-dim">No hay operaciones en el período con esos filtros.</p>}

      {detalle && <Detalle op={detalle} datos={datos} nombres={nombres} onCerrar={() => setDetalle(null)} onAnulada={() => { setDetalle(null); cambio(); }} onAdjuntos={cargar} />}
      {descargar && (
        <DescargarExtracto desde={periodo.desde} hasta={periodo.hasta} filtros={{ ...filtros, caja: cajaFiltro || "" }} listas={datos} onCerrar={() => setDescargar(false)}
          filtrosTexto={[
            cajaFiltro && (caja?.nombre || cajaFiltro),
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
