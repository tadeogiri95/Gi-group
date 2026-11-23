'use client';
// app/components/FinanzasPagosVarios.jsx — Finanzas → ➕ Cargar → 💸 Pagos
// (pedido de Tadeo del 19/11; reglas en app/lib/finanzasPagosVarios.js).
//
// Varios pagos a la vez: a quién, con qué (caja, banco, e-cheq o un cheque
// de la cartera), el importe y el comprobante de cada uno (foto o PDF).
//   💸 Guardar pagos → quedan asentados ya (una orden de pago pagada por
//      renglón, como si se apretara 💸 Registrar pago).
//   📋 Armar orden de pago para el CFO → las órdenes quedan sin pagar,
//      juntas en un resumen con el comprobante de cada una, y se le manda al
//      CFO por WhatsApp para que sepa qué tiene que firmar en el banco. Se
//      pagan después, desde 💸 Órdenes de pago.
import { useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyAr, plata } from "../lib/finanzasOperaciones";
import { FORMAS_PAGO, cuentasParaPagar, fechaCorta } from "../lib/finanzasPagos";
import {
  MAX_PAGOS_VARIOS, erroresPagos, ordenesDePagos, renglonPagoVacio, textoResultadoPagos, totalPagos,
} from "../lib/finanzasPagosVarios";
import { Modal, SelectBuscable } from "./ui";
import { useToast } from "./ui/Toast";
import ElegirProveedor from "./FinanzasElegirProveedor";
import Comprobantes from "./FinanzasComprobantes";
import { mandarWhatsappResumen } from "./FinanzasPagos";

async function postPagos(body) {
  const res = await apiFetch("/api/finanzas/pagos", { method: "POST", body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(d.error || "No se pudo guardar"), { status: res.status, datos: d });
  return d;
}

function Campo({ label, children, className = "" }) {
  return (
    <label className={`flex flex-col gap-1 text-[12px] font-semibold text-gypi-dim ${className}`}>
      {label}
      {children}
    </label>
  );
}

/** Un pago: proveedor, con qué, importe y comprobante. */
function RenglonPago({ i, r, datos, cajas, bancos, usados, cambiar, quitar, solo, deshabilitado }) {
  const set = (k) => (e) => cambiar(i, { [k]: e.target.value });
  return (
    <fieldset className="m-0 p-2 rounded-lg border border-gypi-border bg-gypi-surface flex flex-col gap-2" aria-label={`Pago ${i + 1}`} disabled={deshabilitado}>
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-bold text-gypi-text flex-1">Pago {i + 1}</span>
        {!solo && <button type="button" className="g-btn g-btn-secondary min-h-[40px]" aria-label={`Quitar el pago ${i + 1}`} onClick={() => quitar(i)}>✕ Quitar</button>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Campo label="A quién" className="flex-1 min-w-[200px]">
          <ElegirProveedor aria-label={`Proveedor del pago ${i + 1}`} vacio="Elegí el proveedor" value={r.proveedor} proveedores={datos.proveedores} onChange={set("proveedor")} />
        </Campo>
        <Campo label="Con qué" className="min-w-[170px]">
          <select className="g-input" aria-label={`Con qué se paga el pago ${i + 1}`} value={r.forma}
            onChange={(e) => cambiar(i, { forma: e.target.value, cuenta: e.target.value === "efectivo" && cajas.length === 1 ? cajas[0].cuenta : e.target.value === "transferencia" && bancos.length === 1 ? bancos[0].cuenta : "", cheque_id: "" })}>
            {Object.entries(FORMAS_PAGO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Campo>
      </div>
      <div className="flex flex-wrap gap-2 items-end">
        {(r.forma === "efectivo" || r.forma === "transferencia") && (
          <Campo label={r.forma === "efectivo" ? "Caja" : "Banco"} className="flex-1 min-w-[170px]">
            <SelectBuscable className="g-input" aria-label={`${r.forma === "efectivo" ? "Caja" : "Banco"} del pago ${i + 1}`} value={r.cuenta} onChange={set("cuenta")}>
              <option value="">{r.forma === "efectivo" ? "Elegí la caja" : "Elegí el banco"}</option>
              {(r.forma === "efectivo" ? cajas : bancos).map((t) => <option key={t.cuenta} value={t.cuenta}>{t.nombre}</option>)}
            </SelectBuscable>
          </Campo>
        )}
        {r.forma === "echeq" && (
          <>
            <Campo label="Vence el"><input type="date" className="g-input" aria-label={`Vencimiento del e-cheq del pago ${i + 1}`} value={r.fecha_pago} onChange={set("fecha_pago")} /></Campo>
            <Campo label="N° (si ya lo tenés)"><input className="g-input w-[130px]" aria-label={`Número del e-cheq del pago ${i + 1}`} value={r.numero} maxLength={40} onChange={set("numero")} /></Campo>
          </>
        )}
        {r.forma === "cheque_tercero" ? (
          <Campo label="Cheque de la cartera" className="flex-1 min-w-[220px]">
            <SelectBuscable className="g-input" aria-label={`Cheque de la cartera del pago ${i + 1}`} value={r.cheque_id} onChange={set("cheque_id")}>
              <option value="">Elegí un cheque en cartera</option>
              {datos.cheques.filter((c) => !usados.has(String(c.id)) || String(c.id) === String(r.cheque_id)).map((c) => (
                <option key={c.id} value={c.id}>{plata(c.importe, "ARS")} · {c.banco || "Cheque"}{c.numero ? ` N° ${c.numero}` : ""} · vence {fechaCorta(c.fecha_pago)}</option>
              ))}
            </SelectBuscable>
          </Campo>
        ) : (
          <Campo label="Importe">
            <input className="g-input w-[150px] text-right font-mono" inputMode="decimal" aria-label={`Importe del pago ${i + 1}`} placeholder="0,00" value={r.importe} onChange={set("importe")} />
          </Campo>
        )}
      </div>
      <Campo label="Detalle (opcional)">
        <input className="g-input" aria-label={`Detalle del pago ${i + 1}`} value={r.nota} maxLength={200} placeholder="Ej.: factura A 0003-1234" onChange={set("nota")} />
      </Campo>
      <Comprobantes titulo={`Comprobante del pago ${i + 1}`} lista={r.comprobantes} onCambio={(lista) => cambiar(i, { comprobantes: lista })} disabled={deshabilitado} />
    </fieldset>
  );
}

/**
 * @param {{ datos: object, proveedorId?: number|null, onCerrar: Function, onHecho: Function }} props
 *   datos: lo de GET /api/finanzas/pagos (proveedores, cheques, tesoreria, cfo, empresa).
 */
export default function PagosVarios({ datos, proveedorId = null, onCerrar, onHecho }) {
  const toast = useToast();
  const { cajas, bancos } = useMemo(() => cuentasParaPagar(datos.tesoreria), [datos.tesoreria]);
  const [fecha, setFecha] = useState(hoyAr());
  const [renglones, setRenglones] = useState(() => [renglonPagoVacio({ proveedorId, cajas, bancos })]);
  const [notas, setNotas] = useState("");
  const [haciendo, setHaciendo] = useState(null);
  const [error, setError] = useState(null);

  const usados = new Set(renglones.filter((r) => r.forma === "cheque_tercero" && r.cheque_id).map((r) => String(r.cheque_id)));
  const total = totalPagos(renglones, datos.cheques);
  const cambiar = (i, cambio) => setRenglones((x) => x.map((r, j) => (j === i ? { ...r, ...cambio } : r)));
  const quitar = (i) => setRenglones((x) => x.filter((_, j) => j !== i));
  const agregar = () => setRenglones((x) => [...x, renglonPagoVacio({ cajas, bancos })]);

  function revisar() {
    const errores = erroresPagos(renglones, { cheques: datos.cheques, fecha });
    if (errores.length) { setError(errores.join(" · ")); return false; }
    setError(null);
    return true;
  }

  /** 💸 Guardar pagos: cada renglón, una orden pagada en el momento. */
  async function guardarPagos() {
    if (!revisar()) return;
    setHaciendo("pagar");
    const ordenes = ordenesDePagos(renglones, { fecha, notas });
    const quedan = [];
    const aElegir = [];
    const errores = [];
    let pagados = 0;
    for (const [i, orden] of ordenes.entries()) {
      let creada = null;
      try {
        creada = (await postPagos({ accion: "crear", orden })).orden;
        await postPagos({ accion: "pagar", id: creada.id, fecha });
        pagados += 1;
      } catch (e) {
        // Si el pago ya puede estar en el banco (409), la orden queda para elegir en Órdenes de pago
        if (creada && e.status === 409 && e.datos?.elegir) aElegir.push(creada.numero);
        else if (creada) errores.push(`Pago ${i + 1}: la orden N° ${creada.numero} quedó sin pagar (${e.message})`);
        else { errores.push(`Pago ${i + 1}: ${e.message}`); quedan.push(renglones[i]); }
      }
    }
    setHaciendo(null);
    const texto = textoResultadoPagos({ pagados, aElegir, errores });
    if (!errores.length && !aElegir.length) { toast.success(texto); onHecho(); return; }
    if (pagados) toast.success(pagados === 1 ? "1 pago guardado" : `${pagados} pagos guardados`);
    if (!quedan.length) { toast.info(texto); onHecho(); return; }
    // Quedan en la ventana solo los que no se pudieron crear, para corregirlos
    setRenglones(quedan);
    setError(texto);
  }

  /** 📋 Armar orden de pago para el CFO: órdenes sin pagar, juntas en un resumen. */
  async function armarOrden() {
    if (!revisar()) return;
    setHaciendo("orden");
    const creadas = [];
    try {
      for (const orden of ordenesDePagos(renglones, { fecha, notas })) creadas.push((await postPagos({ accion: "crear", orden })).orden);
      const d = await postPagos({ accion: "resumen_crear", mandar: true, resumen: { ordenes: creadas.map((o) => o.id), fecha, notas } });
      if (d.url) mandarWhatsappResumen(d.resumen, creadas, d.url, datos);
      toast.success(`Orden de pago lista (resumen N° ${d.resumen?.numero}): mandásela al CFO por WhatsApp. Cuando la firme, pagala desde 💸 Órdenes de pago.`);
      onHecho();
    } catch (e) {
      setHaciendo(null);
      setError(creadas.length
        ? `${e.message}. Se guardaron ${creadas.length} ${creadas.length === 1 ? "orden" : "órdenes"} (N° ${creadas.map((o) => o.numero).join(", ")}) sin pagar: juntalas en un resumen desde 💸 Órdenes de pago.`
        : e.message);
      if (creadas.length) setRenglones((x) => x.slice(creadas.length));
    }
  }

  const ocupado = !!haciendo;
  return (
    <Modal open onClose={ocupado ? () => {} : onCerrar} title="💸 Pagos" maxWidth={760}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px] text-gypi-dim">
          Cargá uno o varios pagos, cada uno con su comprobante. Si se pagan ya, apretá 💸 Guardar pagos. Si los tiene que firmar el CFO en el banco, armá la orden de pago y mandásela: se pagan cuando la firme.
        </p>
        <Campo label="Fecha de los pagos" className="self-start">
          <input type="date" className="g-input" aria-label="Fecha de los pagos" value={fecha} disabled={ocupado} onChange={(e) => e.target.value && setFecha(e.target.value)} />
        </Campo>
        <div className="flex flex-col gap-2">
          {renglones.map((r, i) => (
            <RenglonPago key={i} i={i} r={r} datos={datos} cajas={cajas} bancos={bancos} usados={usados} cambiar={cambiar} quitar={quitar} solo={renglones.length === 1} deshabilitado={ocupado} />
          ))}
        </div>
        <button type="button" className="g-btn g-btn-secondary self-start" disabled={ocupado || renglones.length >= MAX_PAGOS_VARIOS} onClick={agregar}>＋ Otro pago</button>
        <p className="m-0 text-[16px]">
          Total: <b className="font-mono">{plata(total, "ARS")}</b>
          <span className="text-[13px] text-gypi-dim"> · {renglones.length === 1 ? "1 pago" : `${renglones.length} pagos`}</span>
        </p>
        <Campo label="Nota para el CFO (opcional)">
          <textarea className="g-input w-full min-h-[50px]" aria-label="Nota para el CFO" value={notas} maxLength={300} disabled={ocupado} onChange={(e) => setNotas(e.target.value)} />
        </Campo>
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" disabled={ocupado} onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-secondary" disabled={ocupado} onClick={armarOrden}>
            {haciendo === "orden" ? "Armando…" : "📋 Armar orden de pago para el CFO"}
          </button>
          <button type="button" className="g-btn g-btn-primary" disabled={ocupado} onClick={guardarPagos}>
            {haciendo === "pagar" ? "Guardando…" : "💸 Guardar pagos"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
