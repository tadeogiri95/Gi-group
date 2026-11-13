'use client';
// app/components/FinanzasPagos.jsx — Finanzas → 💸 Pagos (parte F2b, 2;
// migración 175; /api/finanzas/pagos; reglas en app/lib/finanzasPagos.js).
//
// La Orden de Pago: desde la ficha del proveedor (botón 💸 Pagar) o desde
// acá se eligen las compras que se pagan y con qué (efectivo, transferencia,
// e-cheq Credicoop o cheques de la cartera). El dueño la paga cuando quiere
// (💸 Registrar pago: ahí se generan las operaciones y los cheques), sin
// esperar a nadie. Al CFO se le manda por WhatsApp solo para que sepa lo que
// tiene para firmar en el banco (/op/<token>, sin usuario; 13/11): puede
// apretar 👍 Visto. El PDF sale de la ventana de imprimir.
//
// 12/11 (migración 186): 📋 Resumen para el CFO junta varias órdenes, con el
// comprobante de cada una (foto, opcional) y la suma de lo inmediato
// (efectivo y transferencia) y de los cheques. Se lo invita al CFO por
// WhatsApp (/op/resumen/<token>, solo para mirar) o se exporta en PDF.
// Solo el rol Dueño (la pantalla ni aparece para los demás).
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyAr, numero, plata } from "../lib/finanzasOperaciones";
import { numeroWhatsapp } from "../lib/compras";
import {
  ESTADOS_ORDEN, FORMAS_PAGO, SIN_PAGAR, accionesOrden, cuentasParaPagar, fechaCorta, imprimirOrdenPago, mandadaAlCfo, textoForma, textoWhatsappCfo, vistaPorCfo,
} from "../lib/finanzasPagos";
import { Chip, Modal, SelectBuscable, Spinner } from "./ui";
import { useToast } from "./ui/Toast";
import ElegirProveedor from "./FinanzasElegirProveedor";
import { saldosPorOc } from "../lib/finanzasProveedores";
import {
  ESTADOS_RESUMEN, imprimirResumenPago, puedeEntrar, renglonesResumen, textoWhatsappResumen, totalesResumen,
} from "../lib/finanzasResumenPago";
import { fotoBase64, subirImagen } from "../lib/foto";

const normal = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

async function postPagos(body) {
  const res = await apiFetch("/api/finanzas/pagos", { method: "POST", body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "No se pudo guardar");
  return d;
}

/** Abre WhatsApp con el link para el CFO. */
function mandarWhatsapp(orden, url, datos) {
  const texto = textoWhatsappCfo(orden, url, { empresa: datos.empresa?.nombre || "", cfo: datos.cfo?.nombre || "" });
  const tel = numeroWhatsapp(datos.cfo?.telefono);
  window.open(`https://wa.me/${tel || ""}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
}

/** Abre WhatsApp invitando al CFO a ver el resumen. */
function mandarWhatsappResumen(resumen, ordenes, url, datos) {
  const texto = textoWhatsappResumen(resumen, ordenes, url, { empresa: datos.empresa?.nombre || "", cfo: datos.cfo?.nombre || "" });
  const tel = numeroWhatsapp(datos.cfo?.telefono);
  window.open(`https://wa.me/${tel || ""}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
}

/** Subir (o cambiar) la foto del comprobante: de la cámara o de la galería. */
function BotonComprobante({ url, etiqueta = "📎 Comprobante", onSubido, disabled }) {
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState(null);
  async function elegir(file) {
    if (!file) return;
    setSubiendo(true);
    setError(null);
    try {
      onSubido(await subirImagen(await fotoBase64(file)));
    } catch (e) {
      setError(e.message);
    }
    setSubiendo(false);
  }
  return (
    <span className="inline-flex flex-col gap-0.5">
      <label className={`g-btn g-btn-secondary text-[13px] cursor-pointer ${disabled ? "opacity-50" : ""}`}>
        {subiendo ? "Subiendo…" : url ? "📎 Cambiar comprobante" : etiqueta}
        <input type="file" accept="image/*" className="hidden" aria-label={url ? "Cambiar comprobante" : "Cargar comprobante"} disabled={disabled || subiendo} onChange={(e) => elegir(e.target.files?.[0])} />
      </label>
      {error && <span role="alert" className="text-[12px] text-gypi-red">{error}</span>}
    </span>
  );
}

function campo(label, input) {
  return <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">{label}{input}</label>;
}

/* ─── Nueva orden ────────────────────────────────────────────────────── */

const FORMA_VACIA = { efectivo: { cuenta: "", importe: "" }, transferencia: { cuenta: "", importe: "" }, echeq: { importe: "", fecha_pago: "", numero: "" }, cheque_tercero: { cheque_id: "" } };

/**
 * @param {{ datos: object, proveedorId?: number, pendientes?: { op: object, falta: number }[], onCerrar: Function, onGuardada: Function }} props
 *   pendientes: las compras sin pagar del proveedor (de la ficha), para elegir qué se paga.
 */
export function NuevaOrden({ datos, proveedorId = null, pendientes = [], onCerrar, onGuardada }) {
  const toast = useToast();
  const { cajas, bancos } = useMemo(() => cuentasParaPagar(datos.tesoreria), [datos.tesoreria]);
  const [proveedor, setProveedor] = useState(proveedorId ? String(proveedorId) : "");
  const [fecha, setFecha] = useState(hoyAr());
  const [elegidas, setElegidas] = useState(() => new Set());
  const [formas, setFormas] = useState([]);
  const [notas, setNotas] = useState("");
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const usados = new Set(formas.filter((f) => f.forma === "cheque_tercero").map((f) => String(f.cheque_id)));
  const importeDe = (f) => (f.forma === "cheque_tercero" ? Number(datos.cheques.find((c) => String(c.id) === String(f.cheque_id))?.importe) || 0 : numero(f.importe) || 0);
  const total = formas.reduce((s, f) => s + importeDe(f), 0);
  const aPagar = pendientes.filter((p) => elegidas.has(p.op.id)).reduce((s, p) => s + p.falta, 0);
  const diferencia = Math.round((total - aPagar) * 100) / 100;

  const agregar = (forma) => setFormas((x) => [...x, {
    forma, ...FORMA_VACIA[forma],
    ...(forma === "efectivo" && cajas.length === 1 ? { cuenta: cajas[0].cuenta } : {}),
    ...(forma === "transferencia" && bancos.length === 1 ? { cuenta: bancos[0].cuenta } : {}),
    // Lo que falta para llegar a lo elegido
    ...(forma !== "cheque_tercero" && aPagar - total > 0 ? { importe: String(Math.round((aPagar - total) * 100) / 100).replace(".", ",") } : {}),
  }]);
  const cambiar = (i, k) => (e) => setFormas((x) => x.map((f, j) => (j === i ? { ...f, [k]: e.target.value } : f)));
  const quitar = (i) => setFormas((x) => x.filter((_, j) => j !== i));
  const elegir = (id) => setElegidas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function guardar(mandar) {
    setError(null);
    setGuardando(true);
    try {
      const d = await postPagos({
        accion: "crear", mandar,
        orden: {
          proveedor_id: proveedor ? Number(proveedor) : null, fecha, notas,
          facturas: pendientes.filter((p) => elegidas.has(p.op.id)).map((p) => ({ op_id: p.op.id, fecha: p.op.fecha, detalle: [p.op.tipo, p.op.descripcion].filter(Boolean).join(" · "), importe: p.falta })),
          formas: formas.map((f) => ({ ...f, importe: f.forma === "cheque_tercero" ? undefined : numero(f.importe) })),
        },
      });
      if (mandar && d.url) mandarWhatsapp(d.orden, d.url, datos);
      toast.success(mandar ? `Orden N° ${d.orden.numero} guardada y mandada al CFO. Ya la podés pagar.` : `Orden N° ${d.orden.numero} guardada. Ya la podés pagar.`);
      onGuardada(d.orden);
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onCerrar} title="Orden de pago" maxWidth={640}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <div className="flex flex-wrap gap-2">
          <div className="flex-1 min-w-[200px]">
            {campo("Proveedor", (
              <ElegirProveedor aria-label="Proveedor" vacio="Elegí…" value={proveedor} disabled={!!proveedorId} proveedores={datos.proveedores} onChange={(e) => setProveedor(e.target.value)} />
            ))}
          </div>
          {campo("Fecha", <input type="date" className="g-input" aria-label="Fecha de la orden" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />)}
        </div>

        {pendientes.length > 0 && (
          <fieldset className="border border-gypi-border rounded-lg p-2 m-0">
            <legend className="text-[13px] font-semibold px-1">Qué se paga</legend>
            <ul className="list-none m-0 p-0 flex flex-col gap-1 max-h-[30vh] overflow-y-auto">
              {pendientes.map((p) => (
                <li key={p.op.id}>
                  <label className="flex items-baseline gap-2 text-[13px] min-h-[36px] cursor-pointer">
                    <input type="checkbox" checked={elegidas.has(p.op.id)} onChange={() => elegir(p.op.id)} aria-label={`Pagar ${p.op.tipo} del ${fechaCorta(p.op.fecha)}`} />
                    <span className="font-mono text-[12px] text-gypi-dim">{fechaCorta(p.op.fecha)}</span>
                    <span className="flex-1 min-w-0 truncate">{p.op.tipo}{p.op.descripcion ? ` · ${p.op.descripcion}` : ""}</span>
                    <span className="font-mono font-semibold">{plata(p.falta, "ARS")}</span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="m-0 mt-1 text-[12px] text-gypi-dim">Elegido: <b className="text-gypi-text">{plata(aPagar, "ARS")}</b></p>
          </fieldset>
        )}

        <div className="flex flex-col gap-2">
          <div className="text-[13px] font-semibold">Con qué se paga</div>
          {formas.map((f, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 p-2 rounded-lg border border-gypi-border bg-gypi-surface">
              <span className="w-full text-[13px] font-semibold">{FORMAS_PAGO[f.forma]}</span>
              {(f.forma === "efectivo" || f.forma === "transferencia") && (
                <SelectBuscable className="g-input flex-1 min-w-[160px]" aria-label={f.forma === "efectivo" ? "Caja" : "Banco"} value={f.cuenta} onChange={cambiar(i, "cuenta")}>
                  <option value="">{f.forma === "efectivo" ? "Elegí la caja" : "Elegí el banco"}</option>
                  {(f.forma === "efectivo" ? cajas : bancos).map((t) => <option key={t.cuenta} value={t.cuenta}>{t.nombre}</option>)}
                </SelectBuscable>
              )}
              {f.forma === "echeq" && (
                <>
                  {campo("Vence el", <input type="date" className="g-input" aria-label="Fecha de pago del e-cheq" value={f.fecha_pago} onChange={cambiar(i, "fecha_pago")} />)}
                  {campo("N° (si ya lo tenés)", <input className="g-input w-[130px]" aria-label="Número del e-cheq" value={f.numero} maxLength={40} onChange={cambiar(i, "numero")} />)}
                </>
              )}
              {f.forma === "cheque_tercero" ? (
                <SelectBuscable className="g-input flex-1 min-w-[220px]" aria-label="Cheque de la cartera" value={f.cheque_id} onChange={cambiar(i, "cheque_id")}>
                  <option value="">Elegí un cheque en cartera</option>
                  {datos.cheques.filter((c) => !usados.has(String(c.id)) || String(c.id) === String(f.cheque_id)).map((c) => (
                    <option key={c.id} value={c.id}>{plata(c.importe, "ARS")} · {c.banco || "Cheque"}{c.numero ? ` N° ${c.numero}` : ""} · vence {fechaCorta(c.fecha_pago)}</option>
                  ))}
                </SelectBuscable>
              ) : (
                <input className="g-input w-[150px] text-right font-mono" inputMode="decimal" aria-label={`Importe en ${FORMAS_PAGO[f.forma]}`} placeholder="Importe" value={f.importe} onChange={cambiar(i, "importe")} />
              )}
              <button type="button" className="g-btn g-btn-secondary min-h-[44px]" aria-label="Quitar esta forma de pago" onClick={() => quitar(i)}>✕</button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="g-btn g-btn-secondary" disabled={!cajas.length} onClick={() => agregar("efectivo")}>+ Efectivo</button>
            <button type="button" className="g-btn g-btn-secondary" disabled={!bancos.length} onClick={() => agregar("transferencia")}>+ Transferencia</button>
            <button type="button" className="g-btn g-btn-secondary" onClick={() => agregar("echeq")}>+ E-cheq Credicoop</button>
            <button type="button" className="g-btn g-btn-secondary" disabled={!datos.cheques.length} onClick={() => agregar("cheque_tercero")}>+ Cheque de la cartera</button>
          </div>
        </div>

        <p className="m-0 text-[16px]">Total de la orden: <b className="font-mono">{plata(total, "ARS")}</b></p>
        {pendientes.length > 0 && elegidas.size > 0 && Math.abs(diferencia) >= 0.01 && (
          <p className="m-0 text-[13px] text-gypi-amber-ink">
            {diferencia > 0 ? `Pagás ${plata(diferencia, "ARS")} más que lo elegido: queda a cuenta.` : `Faltan ${plata(-diferencia, "ARS")} para cubrir lo elegido: queda un pago parcial.`}
          </p>
        )}
        {campo("Nota (opcional, la ve el CFO)", <textarea className="g-input w-full min-h-[60px]" aria-label="Nota" value={notas} maxLength={500} onChange={(e) => setNotas(e.target.value)} />)}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-secondary" disabled={guardando || !formas.length} onClick={() => guardar(false)}>Guardar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={guardando || !formas.length} onClick={() => guardar(true)}>
            {guardando ? "Guardando…" : "Guardar y mandar al CFO"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Detalle de una orden ───────────────────────────────────────────── */

function Detalle({ orden, datos, url, onCerrar, onCambio }) {
  const resumen = orden.resumen_id ? (datos.resumenes || []).find((r) => r.id === orden.resumen_id) : null;
  const toast = useToast();
  const [fecha, setFecha] = useState(hoyAr());
  const [haciendo, setHaciendo] = useState(null);
  const [confirmarAnular, setConfirmarAnular] = useState(false);
  const [error, setError] = useState(null);
  const est = ESTADOS_ORDEN[orden.estado] || { nombre: orden.estado, icono: "" };
  const acciones = accionesOrden(orden.estado);

  async function hacer(accion, extra = {}) {
    setError(null);
    setHaciendo(accion);
    try {
      const d = await postPagos({ accion, id: orden.id, ...extra });
      if (accion === "mandar" && d.url) mandarWhatsapp(d.orden, d.url, datos);
      toast.success({ mandar: "Abrimos WhatsApp con el link para el CFO", pagar: "Pago registrado: se generaron las operaciones y los cheques", anular: "Orden anulada", comprobante: extra.url ? "Comprobante guardado" : "Comprobante quitado" }[accion]);
      onCambio();
    } catch (e) {
      setError(e.message);
    } finally {
      setHaciendo(null);
    }
  }

  function pdf() {
    setError(null);
    try { imprimirOrdenPago({ empresa: datos.empresa, orden }); } catch (e) { setError(e.message); }
  }

  return (
    <Modal open onClose={onCerrar} title={`Orden de pago N° ${orden.numero}`} maxWidth={600}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <div>
          <div className="text-[17px] font-bold">{orden.proveedor_nombre}</div>
          <div className="text-[13px] text-gypi-dim">{est.icono} {est.nombre} · {fechaCorta(orden.fecha)}{orden.cargada_por_nombre ? ` · ${orden.cargada_por_nombre}` : ""}</div>
        </div>
        <p className="m-0 text-[22px] font-bold font-mono">{plata(orden.total, "ARS")}</p>
        <ul className="list-none m-0 p-0 flex flex-col gap-1" aria-label="Formas de pago">
          {(orden.formas || []).map((f, i) => (
            <li key={i} className="flex items-baseline gap-2 text-[13px]">
              <span className="flex-1 min-w-0">{textoForma(f)}</span>
              <span className="font-mono font-semibold">{plata(f.importe, "ARS")}</span>
            </li>
          ))}
        </ul>
        {(orden.facturas || []).length > 0 && (
          <div className="text-[13px] text-gypi-dim">
            Paga: {(orden.facturas || []).map((f) => `${fechaCorta(f.fecha)} ${f.detalle} (${plata(f.importe, "ARS")})`).join(" · ")}
          </div>
        )}
        {orden.notas && <p className="m-0 text-[13px]">📝 {orden.notas}</p>}
        {vistaPorCfo(orden) ? (
          <p className="m-0 text-[13px] text-gypi-green">
            👍 {orden.decidida_por_nombre || "El CFO"} la vio el {fechaCorta(String(orden.decidida_at).slice(0, 10))}
          </p>
        ) : mandadaAlCfo(orden) ? (
          <p className="m-0 text-[13px] text-gypi-dim">📲 Mandada al CFO{orden.enviada_at ? ` el ${fechaCorta(String(orden.enviada_at).slice(0, 10))}` : ""}. Todavía no apretó 👍 Visto.</p>
        ) : null}
        {orden.estado === "pagada" && (
          <p className="m-0 text-[13px] text-gypi-dim">
            💸 Pagada el {fechaCorta(orden.pagada_fecha)}{orden.pagada_por_nombre ? ` por ${orden.pagada_por_nombre}` : ""}. Las operaciones están en Movimientos y los cheques en Cheques.
          </p>
        )}
        {orden.estado !== "anulada" && url && (
          <p className="m-0 text-[12px] text-gypi-dim break-all">Link para el CFO: {url}</p>
        )}
        {resumen && <p className="m-0 text-[13px] text-gypi-dim">📋 Está en el resumen N° {resumen.numero}</p>}
        {orden.estado !== "anulada" && !datos.falta_186 && (
          <div className="flex flex-wrap items-center gap-2">
            {orden.comprobante_url && <a className="text-[13px] font-semibold text-gypi-amber-ink" href={orden.comprobante_url} target="_blank" rel="noopener noreferrer">📎 Ver comprobante</a>}
            <BotonComprobante url={orden.comprobante_url} etiqueta="📎 Cargar comprobante (opcional)" disabled={!!haciendo} onSubido={(u) => hacer("comprobante", { url: u })} />
            {orden.comprobante_url && <button type="button" className="g-btn g-btn-secondary text-[13px]" disabled={!!haciendo} onClick={() => hacer("comprobante", { url: null })}>Quitar</button>}
          </div>
        )}

        {acciones.includes("pagar") && (
          <div className="flex flex-wrap items-end gap-2 p-2 rounded-lg border border-gypi-border">
            {campo("Fecha del pago", <input type="date" className="g-input" aria-label="Fecha del pago" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />)}
            <button type="button" className="g-btn g-btn-primary flex-1" disabled={!!haciendo} onClick={() => hacer("pagar", { fecha })}>
              {haciendo === "pagar" ? "Registrando…" : "💸 Registrar pago"}
            </button>
          </div>
        )}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        {confirmarAnular ? (
          <div className="flex flex-col gap-2 p-2 rounded-lg border border-gypi-red">
            <p className="m-0 text-[13px]">
              {orden.estado === "pagada"
                ? "¿Anular la orden pagada? Se anulan sus operaciones, los e-cheq que emitió y los cheques de terceros vuelven a la cartera."
                : "¿Anular la orden? El link del CFO deja de servir."}
            </p>
            <div className="flex gap-2">
              <button type="button" className="g-btn g-btn-secondary flex-1" onClick={() => setConfirmarAnular(false)}>No</button>
              <button type="button" className="g-btn g-btn-danger flex-1" disabled={!!haciendo} onClick={() => hacer("anular")}>{haciendo === "anular" ? "Anulando…" : "Sí, anular"}</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="g-btn g-btn-secondary flex-1" onClick={pdf}>📄 PDF</button>
            {acciones.includes("mandar") && (
              <button type="button" className="g-btn g-btn-secondary flex-1" disabled={!!haciendo} onClick={() => hacer("mandar")}>
                {url ? "📲 Mandar el link de nuevo" : "📲 Mandar al CFO"}
              </button>
            )}
            {acciones.includes("anular") && <button type="button" className="g-btn g-btn-secondary flex-1" onClick={() => setConfirmarAnular(true)}>🚫 Anular</button>}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ─── Resumen de órdenes de pago (186) ───────────────────────────────── */

function Totales({ ordenes }) {
  const t = totalesResumen(ordenes);
  return (
    <div className="flex flex-col gap-1 p-3 rounded-lg border border-gypi-border bg-gypi-surface text-[14px]" aria-label="Totales del resumen">
      <div className="flex items-baseline gap-2"><span className="flex-1">⚡ Transferencia, efectivo o inmediato</span><b className="font-mono">{plata(t.inmediato, "ARS")}</b></div>
      <div className="flex items-baseline gap-2"><span className="flex-1">🧾 Cheques (e-cheq y de terceros)</span><b className="font-mono">{plata(t.cheques, "ARS")}</b></div>
      <div className="flex items-baseline gap-2 border-t border-gypi-border pt-1 text-[16px]"><span className="flex-1 font-bold">Total · {t.ordenes} {t.ordenes === 1 ? "orden" : "órdenes"}</span><b className="font-mono">{plata(t.total, "ARS")}</b></div>
    </div>
  );
}

/** Tabla del resumen: fecha, proveedor, medio de pago, importe y comprobante. */
function TablaResumen({ ordenes }) {
  const filas = renglonesResumen(ordenes);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] border-collapse" aria-label="Pagos del resumen">
        <thead>
          <tr className="text-gypi-dim text-left">
            <th className="font-semibold py-1 px-1.5">Fecha</th>
            <th className="font-semibold py-1 px-1.5">Proveedor</th>
            <th className="font-semibold py-1 px-1.5">Medio de pago</th>
            <th className="font-semibold py-1 px-1.5 text-right">Importe</th>
            <th className="font-semibold py-1 px-1.5">Comprobante</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((r, i) => (
            <tr key={`${r.orden_id}-${i}`} className="border-t border-gypi-border align-top">
              <td className="py-1 px-1.5 font-mono whitespace-nowrap">{fechaCorta(r.fecha)}</td>
              <td className="py-1 px-1.5">{r.proveedor} <span className="block text-[12px] text-gypi-dim">OP N° {r.numero}</span></td>
              <td className="py-1 px-1.5">{r.clase === "cheque" ? "🧾" : "⚡"} {r.medio}</td>
              <td className="py-1 px-1.5 text-right font-mono whitespace-nowrap">{plata(r.importe, "ARS")}</td>
              <td className="py-1 px-1.5">{r.comprobante ? <a className="font-semibold text-gypi-amber-ink" href={r.comprobante} target="_blank" rel="noopener noreferrer">📎 Ver</a> : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NuevoResumen({ datos, onCerrar, onGuardado }) {
  const toast = useToast();
  const libres = useMemo(() => (datos.ordenes || []).filter(puedeEntrar), [datos.ordenes]);
  const [elegidas, setElegidas] = useState(() => new Set());
  const [comprobantes, setComprobantes] = useState({});
  const [fecha, setFecha] = useState(hoyAr());
  const [notas, setNotas] = useState("");
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const elegir = (id) => setElegidas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const todas = elegidas.size === libres.length && libres.length > 0;
  const seleccion = libres.filter((o) => elegidas.has(o.id)).map((o) => ({ ...o, comprobante_url: comprobantes[o.id] || o.comprobante_url || null }));

  async function guardar(mandar) {
    setError(null);
    setGuardando(true);
    try {
      const d = await postPagos({
        accion: "resumen_crear", mandar,
        resumen: { ordenes: [...elegidas], fecha, notas },
        comprobantes: Object.fromEntries(Object.entries(comprobantes).filter(([id]) => elegidas.has(Number(id)))),
      });
      if (mandar && d.url) mandarWhatsappResumen(d.resumen, seleccion, d.url, datos);
      toast.success(mandar ? `Resumen N° ${d.resumen.numero} listo: mandáselo al CFO por WhatsApp` : `Resumen N° ${d.resumen.numero} guardado`);
      if (d.afuera) toast.error(`${d.afuera} ${d.afuera === 1 ? "orden quedó" : "órdenes quedaron"} afuera: ya estaban en otro resumen`);
      onGuardado(d.resumen);
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onCerrar} title="Resumen de órdenes de pago" maxWidth={720}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px] text-gypi-dim">Elegí las órdenes que van juntas. A cada una le podés cargar la foto del comprobante (no es obligatorio).</p>
        {libres.length ? (
          <fieldset className="border border-gypi-border rounded-lg p-2 m-0">
            <legend className="text-[13px] font-semibold px-1">Órdenes de pago</legend>
            <label className="flex items-center gap-2 text-[13px] min-h-[36px] cursor-pointer font-semibold">
              <input type="checkbox" checked={todas} onChange={() => setElegidas(todas ? new Set() : new Set(libres.map((o) => o.id)))} aria-label="Tildar todas" /> Tildar todas
            </label>
            <ul className="list-none m-0 p-0 flex flex-col gap-1 max-h-[38vh] overflow-y-auto">
              {libres.map((o) => {
                const est = ESTADOS_ORDEN[o.estado] || { nombre: o.estado, icono: "" };
                const comp = comprobantes[o.id] || o.comprobante_url;
                return (
                  <li key={o.id} className="flex flex-wrap items-center gap-2 border-t border-gypi-border pt-1">
                    <label className="flex items-baseline gap-2 text-[13px] min-h-[40px] cursor-pointer flex-1 min-w-[220px]">
                      <input type="checkbox" checked={elegidas.has(o.id)} onChange={() => elegir(o.id)} aria-label={`Sumar la orden N° ${o.numero}`} />
                      <span className="font-mono text-[12px] text-gypi-dim">N° {o.numero} · {fechaCorta(o.fecha)}</span>
                      <span className="flex-1 min-w-0 truncate font-semibold">{o.proveedor_nombre}</span>
                      <span className="font-mono font-semibold">{plata(o.total, "ARS")}</span>
                      <span className="text-[12px] text-gypi-dim">{est.icono}</span>
                    </label>
                    {elegidas.has(o.id) && (
                      <span className="flex items-center gap-2">
                        {comp && <a className="text-[13px] font-semibold text-gypi-green" href={comp} target="_blank" rel="noopener noreferrer">✓ Comprobante</a>}
                        <BotonComprobante url={comp} onSubido={(u) => setComprobantes((c) => ({ ...c, [o.id]: u }))} />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ) : (
          <p className="m-0 text-[13px] text-gypi-dim">No hay órdenes para juntar: las que no están pagadas ni anuladas ya están en otro resumen. Armá órdenes con &quot;+ Orden de pago&quot;.</p>
        )}
        {seleccion.length > 0 && <Totales ordenes={seleccion} />}
        <div className="flex flex-wrap gap-2">
          {campo("Fecha del resumen", <input type="date" className="g-input" aria-label="Fecha del resumen" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />)}
          <div className="flex-1 min-w-[220px]">{campo("Nota para el CFO (opcional)", <input className="g-input w-full" aria-label="Nota del resumen" value={notas} maxLength={500} onChange={(e) => setNotas(e.target.value)} />)}</div>
        </div>
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-secondary" disabled={guardando || !elegidas.size} onClick={() => guardar(false)}>Guardar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={guardando || !elegidas.size} onClick={() => guardar(true)}>
            {guardando ? "Guardando…" : "Guardar e invitar al CFO"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DetalleResumen({ resumen, datos, url, onCerrar, onCambio, onAbrirOrden }) {
  const toast = useToast();
  const [haciendo, setHaciendo] = useState(null);
  const [confirmarAnular, setConfirmarAnular] = useState(false);
  const [error, setError] = useState(null);
  const ordenes = (datos.ordenes || []).filter((o) => o.resumen_id === resumen.id);
  const est = ESTADOS_RESUMEN[resumen.estado] || { nombre: resumen.estado, icono: "" };
  const t = totalesResumen(ordenes);

  async function hacer(accion) {
    setError(null);
    setHaciendo(accion);
    try {
      const d = await postPagos({ accion, id: resumen.id });
      if (accion === "resumen_mandar" && d.url) mandarWhatsappResumen(d.resumen, ordenes, d.url, datos);
      toast.success(accion === "resumen_mandar" ? "Abrimos WhatsApp con el link para el CFO" : "Resumen anulado: las órdenes siguen como estaban");
      onCambio();
      if (accion === "resumen_anular") onCerrar();
    } catch (e) {
      setError(e.message);
    } finally {
      setHaciendo(null);
    }
  }

  function pdf() {
    setError(null);
    try { imprimirResumenPago({ empresa: datos.empresa, resumen, ordenes }); } catch (e) { setError(e.message); }
  }

  return (
    <Modal open onClose={onCerrar} title={`Resumen de órdenes de pago N° ${resumen.numero}`} maxWidth={760}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <div className="text-[13px] text-gypi-dim">
          {est.icono} {est.nombre} · {fechaCorta(resumen.fecha)}{resumen.cargado_por_nombre ? ` · ${resumen.cargado_por_nombre}` : ""} · {t.pagadas} de {t.ordenes} pagadas · 👍 {t.vistas} vistas
        </div>
        <TablaResumen ordenes={ordenes} />
        <Totales ordenes={ordenes} />
        {resumen.notas && <p className="m-0 text-[13px]">📝 {resumen.notas}</p>}
        {url && <p className="m-0 text-[12px] text-gypi-dim break-all">Link para el CFO: {url}</p>}
        <div className="flex flex-wrap gap-1">
          {ordenes.filter((o) => o.estado !== "anulada").map((o) => (
            <button key={o.id} type="button" className="g-btn g-btn-secondary text-[12px]" onClick={() => onAbrirOrden(o.id)}>OP N° {o.numero} {o.comprobante_url ? "📎" : ""}</button>
          ))}
        </div>
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        {confirmarAnular ? (
          <div className="flex flex-col gap-2 p-2 rounded-lg border border-gypi-red">
            <p className="m-0 text-[13px]">¿Anular el resumen? Las órdenes no cambian y quedan libres para otro resumen. El link del resumen deja de servir.</p>
            <div className="flex gap-2">
              <button type="button" className="g-btn g-btn-secondary flex-1" onClick={() => setConfirmarAnular(false)}>No</button>
              <button type="button" className="g-btn g-btn-danger flex-1" disabled={!!haciendo} onClick={() => hacer("resumen_anular")}>{haciendo === "resumen_anular" ? "Anulando…" : "Sí, anular"}</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="g-btn g-btn-secondary flex-1" onClick={pdf}>📄 PDF</button>
            <button type="button" className="g-btn g-btn-primary flex-1" disabled={!!haciendo || !t.ordenes} onClick={() => hacer("resumen_mandar")}>
              {haciendo === "resumen_mandar" ? "Abriendo…" : resumen.estado === "enviado" ? "📲 Mandar el link de nuevo" : "📲 Invitar al CFO"}
            </button>
            <button type="button" className="g-btn g-btn-secondary flex-1" onClick={() => setConfirmarAnular(true)}>🚫 Anular</button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ─── A quién se le manda ────────────────────────────────────────────── */

function DatosCfo({ cfo, onCerrar, onGuardado }) {
  const [nombre, setNombre] = useState(cfo?.nombre || "");
  const [telefono, setTelefono] = useState(cfo?.telefono || "");
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  async function guardar() {
    setGuardando(true);
    try {
      await postPagos({ accion: "cfo", nombre, telefono });
      onGuardado();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onCerrar} title="¿Quién aprueba los pagos?" maxWidth={440}>
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] text-gypi-dim">El link de cada orden se le manda por WhatsApp a esta persona. No necesita usuario en Gypi.</p>
        {campo("Nombre", <input className="g-input w-full" aria-label="Nombre del CFO" value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} />)}
        {campo("WhatsApp", <input className="g-input w-full" aria-label="WhatsApp del CFO" inputMode="tel" placeholder="351 555 1234" value={telefono} maxLength={30} onChange={(e) => setTelefono(e.target.value)} />)}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Pantalla ───────────────────────────────────────────────────────── */

/** Lee lo que necesita la orden de pago (también lo usa la ficha del proveedor). */
export async function leerDatosPagos(anuladas = false) {
  const res = await apiFetch(`/api/finanzas/pagos${anuladas ? "?anuladas=1" : ""}`);
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "No se pudieron cargar las órdenes de pago");
  return d;
}

/**
 * Cuánto se pagó de cada orden de compra (11/11, conexión del plan Finanzas
 * e Inventario): lo facturado de la OC, lo pagado y lo que falta.
 */
export function SaldoPorOc({ buscar = "" }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [todas, setTodas] = useState(false);
  useEffect(() => {
    let vivo = true;
    apiFetch("/api/finanzas/proveedores")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "No se pudieron leer las compras");
        if (vivo) setFilas(saldosPorOc(d.operaciones || [], new Set(d.cuentas_proveedores || []), d.proveedores || []));
      })
      .catch((e) => { if (vivo) setError(e.message); });
    return () => { vivo = false; };
  }, []);
  if (error) return <p role="alert" className="m-0 text-[14px] text-gypi-red">⚠ {error}</p>;
  if (!filas) return <div className="py-6 flex justify-center"><Spinner /></div>;
  const b = normal(buscar);
  const visibles = filas.filter((x) => (todas || x.falta > 0.009) && (!b || normal(`${x.numero} ${x.proveedor}`).includes(b)));
  const falta = visibles.reduce((s, x) => s + x.falta, 0);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2 text-[13px] text-gypi-dim">
        <span className="flex-1 min-w-[200px]">Lo facturado de cada orden de compra, lo pagado y lo que falta. Los pagos al proveedor se aplican a sus compras más viejas primero.</span>
        <label className="flex items-center gap-1"><input type="checkbox" checked={todas} onChange={(e) => setTodas(e.target.checked)} /> Ver también las pagadas</label>
      </div>
      {visibles.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] border-collapse" aria-label="Saldo por orden de compra">
            <thead>
              <tr className="text-gypi-dim text-left">
                <th className="font-semibold py-1">Orden de compra</th>
                <th className="font-semibold py-1 text-right">Facturado</th>
                <th className="font-semibold py-1 text-right">Pagado</th>
                <th className="font-semibold py-1 text-right">Falta</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((x) => (
                <tr key={`${x.clave}|${x.numero}`} className="border-t border-gypi-border">
                  <td className="py-1"><b>OC N° {x.numero}</b> · {x.proveedor} <span className="block text-[12px] text-gypi-dim">Factura del {fechaCorta(x.desde)}</span></td>
                  <td className="py-1 text-right font-mono">{plata(x.facturado, "ARS")}</td>
                  <td className="py-1 text-right font-mono">{plata(x.pagado, "ARS")}</td>
                  <td className={`py-1 text-right font-mono font-semibold ${x.falta > 0.009 ? "" : "text-gypi-green"}`}>{x.falta > 0.009 ? plata(x.falta, "ARS") : "✅ Pagada"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="m-0 mt-2 text-[13px]">Falta pagar: <b>{plata(falta, "ARS")}</b></p>
        </div>
      ) : (
        <p className="m-0 text-[13px] text-gypi-dim">{filas.length ? "Todas las órdenes de compra facturadas están pagadas." : "Todavía no hay facturas de órdenes de compra en Finanzas."}</p>
      )}
    </div>
  );
}

const FILTROS = {
  pendientes: { nombre: "Sin pagar", estados: SIN_PAGAR },
  pagada: { nombre: "Pagadas", estados: ["pagada"] },
  todas: { nombre: "Todas", estados: null },
};

export default function FinanzasPagos() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [filtro, setFiltro] = useState("pendientes");
  const [buscar, setBuscar] = useState("");
  const [anuladas, setAnuladas] = useState(false);
  const [nueva, setNueva] = useState(false);
  const [abierta, setAbierta] = useState(null);
  const [cfo, setCfo] = useState(false);
  const [porOc, setPorOc] = useState(false);
  const [verResumenes, setVerResumenes] = useState(false);
  const [nuevoResumen, setNuevoResumen] = useState(false);
  const [resumenAbierto, setResumenAbierto] = useState(null);

  const cargar = useCallback(async () => {
    try {
      setDatos(await leerDatosPagos(anuladas));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [anuladas]);
  useEffect(() => { cargar(); }, [cargar]);

  const lista = useMemo(() => {
    const b = normal(buscar);
    const est = FILTROS[filtro].estados;
    return (datos?.ordenes || []).filter((o) => (!est || est.includes(o.estado)) && (!b || normal(`${o.numero} ${o.proveedor_nombre}`).includes(b)));
  }, [datos, filtro, buscar]);

  if (error) return <p role="alert" className="m-[18px] text-[14px] text-gypi-red">⚠ {error}</p>;
  if (!datos) return <div className="flex-1 flex items-center justify-center py-10"><Spinner /></div>;
  const cuantas = (f) => (datos.ordenes || []).filter((o) => !FILTROS[f].estados || FILTROS[f].estados.includes(o.estado)).length;
  const orden = abierta ? datos.ordenes.find((o) => o.id === abierta) : null;
  const resumenes = datos.resumenes || [];
  const resumen = resumenAbierto ? resumenes.find((r) => r.id === resumenAbierto) : null;
  const otraVista = porOc || verResumenes;

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <p className="m-0 text-[13px] text-gypi-dim flex-1 min-w-[200px]">
          CFO (solo le avisamos): <b className="text-gypi-text">{datos.cfo?.nombre || "sin cargar"}</b>{datos.cfo?.telefono ? ` · ${datos.cfo.telefono}` : ""}{" "}
          <button type="button" className="bg-transparent border-none p-0 text-gypi-amber-ink font-semibold cursor-pointer" onClick={() => setCfo(true)}>Cambiar</button>
        </p>
        {!datos.falta_186 && <button type="button" className="g-btn g-btn-secondary" onClick={() => setNuevoResumen(true)}>📋 Resumen para el CFO</button>}
        <button type="button" className="g-btn g-btn-primary" onClick={() => setNueva(true)}>+ Orden de pago</button>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {Object.entries(FILTROS).map(([k, f]) => <Chip key={k} active={!otraVista && filtro === k} onClick={() => { setPorOc(false); setVerResumenes(false); setFiltro(k); }}>{f.nombre} ({cuantas(k)})</Chip>)}
        {!datos.falta_186 && <Chip active={verResumenes} onClick={() => { setPorOc(false); setVerResumenes(true); }}>📋 Resúmenes ({resumenes.length})</Chip>}
        <Chip active={porOc} onClick={() => { setVerResumenes(false); setPorOc(true); }}>📄 Saldo por orden de compra</Chip>
        <input className="g-input flex-1 min-w-[160px]" aria-label="Buscar orden" placeholder="Buscar proveedor o N°" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        {!otraVista && (
          <label className="flex items-center gap-1 text-[13px] text-gypi-dim">
            <input type="checkbox" checked={anuladas} onChange={(e) => setAnuladas(e.target.checked)} /> Ver anuladas
          </label>
        )}
      </div>
      {porOc ? <SaldoPorOc buscar={buscar} /> : verResumenes ? (
        <ul className="list-none m-0 p-0 flex flex-col gap-1.5" aria-label="Resúmenes de órdenes de pago">
          {resumenes.map((r) => {
            const de = (datos.ordenes || []).filter((o) => o.resumen_id === r.id);
            const t = totalesResumen(de);
            const est = ESTADOS_RESUMEN[r.estado] || { nombre: r.estado, icono: "" };
            return (
              <li key={r.id}>
                <button type="button" onClick={() => setResumenAbierto(r.id)}
                  className="w-full text-left min-h-[48px] px-3 py-2 rounded-lg border border-gypi-border bg-gypi-surface cursor-pointer">
                  <span className="flex items-baseline gap-2 text-[14px] text-gypi-text">
                    <span className="font-mono text-[12px] text-gypi-dim">N° {r.numero}</span>
                    <span className="font-semibold flex-1 min-w-0 truncate">Resumen · {t.ordenes} {t.ordenes === 1 ? "orden" : "órdenes"}</span>
                    <span className="font-mono font-semibold">{plata(t.total, "ARS")}</span>
                  </span>
                  <span className="block text-[12px] text-gypi-dim">
                    {est.icono} {est.nombre} · {fechaCorta(r.fecha)} · ⚡ {plata(t.inmediato, "ARS")} · 🧾 {plata(t.cheques, "ARS")} · {t.pagadas} de {t.ordenes} pagadas · 👍 {t.vistas} vistas
                  </span>
                </button>
              </li>
            );
          })}
          {!resumenes.length && <li className="text-[13px] text-gypi-dim">Todavía no hay resúmenes. Armá uno con &quot;📋 Resumen para el CFO&quot;.</li>}
        </ul>
      ) : (<>
      <ul className="list-none m-0 p-0 flex flex-col gap-1.5" aria-label="Órdenes de pago">
        {lista.map((o) => {
          const est = ESTADOS_ORDEN[o.estado] || { nombre: o.estado, icono: "" };
          return (
            <li key={o.id}>
              <button type="button" onClick={() => setAbierta(o.id)}
                className="w-full text-left min-h-[48px] px-3 py-2 rounded-lg border border-gypi-border bg-gypi-surface cursor-pointer">
                <span className="flex items-baseline gap-2 text-[14px] text-gypi-text">
                  <span className="font-mono text-[12px] text-gypi-dim">N° {o.numero}</span>
                  <span className="font-semibold flex-1 min-w-0 truncate">{o.proveedor_nombre}</span>
                  <span className="font-mono font-semibold">{plata(o.total, "ARS")}</span>
                </span>
                <span className={`block text-[12px] ${o.estado === "pagada" ? "text-gypi-green font-semibold" : "text-gypi-dim"}`}>
                  {est.icono} {est.nombre}{o.estado === "pagada" && vistaPorCfo(o) ? " · 👍 vista por el CFO" : ""} · {fechaCorta(o.fecha)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!lista.length && (
        <p className="mt-2 text-[13px] text-gypi-dim">
          {(datos.ordenes || []).length ? "Ninguna orden con ese filtro." : "Todavía no hay órdenes de pago. Armá la primera con \"+ Orden de pago\" o desde la ficha del proveedor (💸 Pagar)."}
        </p>
      )}
      </>)}

      {nueva && <NuevaOrden datos={datos} onCerrar={() => setNueva(false)} onGuardada={(o) => { setNueva(false); setAbierta(o.id); cargar(); }} />}
      {orden && <Detalle orden={orden} datos={datos} url={datos.links?.[orden.id]} onCerrar={() => setAbierta(null)} onCambio={cargar} />}
      {nuevoResumen && <NuevoResumen datos={datos} onCerrar={() => setNuevoResumen(false)} onGuardado={(r) => { setNuevoResumen(false); setVerResumenes(true); setPorOc(false); setResumenAbierto(r.id); cargar(); }} />}
      {resumen && !orden && <DetalleResumen resumen={resumen} datos={datos} url={datos.links_resumen?.[resumen.id]} onCerrar={() => setResumenAbierto(null)} onCambio={cargar} onAbrirOrden={setAbierta} />}
      {cfo && <DatosCfo cfo={datos.cfo} onCerrar={() => setCfo(false)} onGuardado={() => { setCfo(false); cargar(); }} />}
    </div>
  );
}
