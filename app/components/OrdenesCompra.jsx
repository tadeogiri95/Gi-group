'use client';
// app/components/OrdenesCompra.jsx — Planta → Compras → Órdenes (Compras,
// parte 21; ítem 41). Las OC armadas en "A comprar": se revisan cantidades,
// precios sin IVA, moneda y fecha prometida, se mandan al proveedor (PDF +
// WhatsApp o email) y se marcan enviadas. Una enviada que pasó la fecha
// prometida aparece atrasada. Lo que llega se recibe en Compras → Recibir y
// la factura, que puede llegar después, se carga acá (parte 22).
import { useCallback, useEffect, useMemo, useState } from "react";
import { sb, apiFetch } from "../lib/supabase";
import { leerCantidadMovimiento } from "../lib/movimientosStock";
import { numeroWhatsapp } from "../lib/compras";
import {
  ESTADOS_OC, ESTADOS_OC_ABIERTA, MONEDAS, importeTexto, leerImporte, imprimirOrdenCompra, ocAtrasada, textoOrdenCompra, totalOrden,
  ALICUOTAS_IVA, IVA_POR_DEFECTO, cantidadFacturaInicial, renglonFactura, totalesFactura,
} from "../lib/ordenesCompra";
import { AVISO_MIGRACION_114 } from "./AComprar";

const numTexto = (n) => (n === null || n === undefined ? "" : String(n).replace(".", ","));
const fechaCorta = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");

async function postCompras(body) {
  const res = await apiFetch("/api/compras", { method: "POST", body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo guardar");
  return data;
}

/**
 * Factura de la OC (parte 22; con IVA y otros impuestos, migración 122): puede
 * llegar después del material. Por renglón se carga cantidad, precio sin IVA e
 * IVA %; neto, IVA y total los calcula Gypi. Otros impuestos van una sola vez
 * para toda la factura. Si cambia el precio, los ingresos de stock se reemplazan.
 */
function FacturaOrden({ oc, items, onGuardada }) {
  const [numero, setNumero] = useState(oc.factura_numero || "");
  const [fecha, setFecha] = useState(oc.factura_fecha || "");
  const [tc, setTc] = useState(numTexto(oc.tipo_cambio));
  const [otros, setOtros] = useState(numTexto(oc.factura_otros_impuestos));
  const [renglones, setRenglones] = useState(() => Object.fromEntries(items.map((it) => [it.id, {
    cantidad: numTexto(cantidadFacturaInicial(it)),
    precio: numTexto(it.precio_unitario),
    iva: String(it.iva_alicuota === null || it.iva_alicuota === undefined ? IVA_POR_DEFECTO : Number(it.iva_alicuota)),
  }])));
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const usd = oc.moneda === "USD";
  const plata = (n) => importeTexto(n, oc.moneda);
  const cambiar = (id, campo, valor) => setRenglones((r) => ({ ...r, [id]: { ...r[id], [campo]: valor } }));

  // Lo que se ve calculado mientras se escribe
  const leidos = items.map((it) => {
    const r = renglones[it.id];
    return { it, cantidad: leerCantidadMovimiento(r.cantidad), precio: r.precio.trim() ? leerImporte(r.precio) : null, iva: Number(r.iva) };
  });
  const totales = totalesFactura(leidos, leerImporte(otros) || 0);

  const guardar = async () => {
    setError(null);
    setAviso(null);
    const cambios = [];
    const numeroO = (v) => (v === null || v === undefined ? null : Number(v));
    for (const { it, cantidad, precio, iva } of leidos) {
      const r = renglones[it.id];
      if (r.precio.trim() && precio === null) { setError(`Revisá el precio de ${it.descripcion}`); return; }
      if (r.cantidad.trim() && cantidad === null) { setError(`Revisá la cantidad de ${it.descripcion}`); return; }
      const nuevo = { precio_unitario: precio, cantidad_facturada: r.cantidad.trim() ? cantidad : null, iva_alicuota: iva };
      const difiere = Object.keys(nuevo).filter((k) => numeroO(it[k]) !== nuevo[k]);
      if (difiere.length) cambios.push({ item_id: it.id, ...Object.fromEntries(difiere.map((k) => [k, nuevo[k]])) });
    }
    const tipoCambio = usd && tc.trim() ? leerImporte(tc) : null;
    if (usd && tc.trim() && !tipoCambio) { setError("Revisá el tipo de cambio"); return; }
    const otrosImp = otros.trim() ? leerImporte(otros) : null;
    if (otros.trim() && otrosImp === null) { setError("Revisá otros impuestos"); return; }
    setEnviando(true);
    try {
      const data = await postCompras({
        accion: "oc_factura", id: oc.id, factura_numero: numero.trim() || null, factura_fecha: fecha || null,
        tipo_cambio: tipoCambio, otros_impuestos: otrosImp, ...(cambios.length ? { renglones: cambios } : {}),
      });
      setAviso(`Factura guardada${data.reemplazados ? `. Corregí ${data.reemplazados} ingreso${data.reemplazados === 1 ? "" : "s"} de stock con el precio nuevo` : ""}.`);
      await onGuardada();
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  return (
    <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
      <div className="text-[14px] font-bold mb-2">🧾 Factura</div>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="g-label" htmlFor="fac-numero">N° de factura</label>
          <input id="fac-numero" className="g-input w-full mb-2" value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={60} placeholder="Ej: A-0003-00001234" />
        </div>
        <div className="flex-1">
          <label className="g-label" htmlFor="fac-fecha">Fecha de factura</label>
          <input id="fac-fecha" type="date" className="g-input w-full mb-2" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
      </div>
      {usd && (
        <>
          <label className="g-label" htmlFor="fac-tc">Tipo de cambio (pesos por dólar)</label>
          <input id="fac-tc" className="g-input w-full mb-2" inputMode="decimal" value={tc} onChange={(e) => setTc(e.target.value)} placeholder="Ej: 1.050" />
        </>
      )}
      <div className="text-[12px] text-gypi-dim mb-2">Precio unitario sin IVA{usd ? " en dólares" : ""}. Si cambia, el ingreso de stock se corrige solo.</div>
      {leidos.map(({ it, cantidad, precio, iva }) => {
        const r = renglones[it.id];
        const calc = renglonFactura({ cantidad, precio, iva });
        return (
          <div key={it.id} className="py-2 border-t border-gypi-border">
            <div className="text-[13px] font-semibold mb-1">{it.descripcion}</div>
            <div className="flex gap-2 items-end">
              <div className="flex-1 min-w-0">
                <label className="g-label" htmlFor={`fac-cant-${it.id}`}>Cantidad{it.unidad ? ` (${it.unidad})` : ""}</label>
                <input id={`fac-cant-${it.id}`} aria-label={`Cantidad en la factura de ${it.descripcion}`} className="g-input w-full" inputMode="decimal"
                  value={r.cantidad} onChange={(e) => cambiar(it.id, "cantidad", e.target.value)} />
              </div>
              <div className="flex-1 min-w-0">
                <label className="g-label" htmlFor={`fac-precio-${it.id}`}>Precio s/IVA</label>
                <input id={`fac-precio-${it.id}`} aria-label={`Precio en la factura de ${it.descripcion}`} className="g-input w-full" inputMode="decimal"
                  value={r.precio} onChange={(e) => cambiar(it.id, "precio", e.target.value)} />
              </div>
              <div className="w-[86px] shrink-0">
                <label className="g-label" htmlFor={`fac-iva-${it.id}`}>IVA</label>
                <select id={`fac-iva-${it.id}`} aria-label={`IVA de ${it.descripcion}`} className="g-input w-full" value={r.iva} onChange={(e) => cambiar(it.id, "iva", e.target.value)}>
                  {ALICUOTAS_IVA.map((a) => <option key={a} value={String(a)}>{numTexto(a)}%</option>)}
                </select>
              </div>
            </div>
            <div className="text-[12px] text-gypi-dim mt-1">
              {calc ? `Neto ${plata(calc.neto)} · IVA ${plata(calc.iva)} · Total ${plata(calc.total)}` : "Falta cantidad o precio"}
            </div>
          </div>
        );
      })}
      <div className="pt-2 border-t border-gypi-border text-[13px]">
        <div className="flex justify-between mb-1"><span>Subtotal neto</span><span>{plata(totales.neto)}</span></div>
        <div className="flex justify-between mb-1"><span>IVA</span><span>{plata(totales.iva)}</span></div>
        <div className="flex items-center gap-2 mb-1">
          <label className="flex-1" htmlFor="fac-otros">Otros impuestos (percepciones, internos)</label>
          <div className="w-[120px] shrink-0">
            <input id="fac-otros" className="g-input w-full text-right" inputMode="decimal" value={otros} onChange={(e) => setOtros(e.target.value)} placeholder="0" />
          </div>
        </div>
        <div className="flex justify-between font-bold text-[14px]"><span>Total de la factura</span><span>{plata(totales.total)}</span></div>
        <div className="text-[12px] text-gypi-dim mt-1">Comparalo con el total del papel. Al stock entra el precio sin IVA.</div>
      </div>
      <button onClick={guardar} disabled={enviando} className="g-btn g-btn-secondary w-full mt-2">{enviando ? "Guardando…" : "Guardar factura"}</button>
      {aviso && <div role="status" className="text-[13px] mt-2">✅ {aviso}</div>}
      {error && <div role="alert" className="text-[13px] text-gypi-red mt-2">{error}</div>}
    </div>
  );
}

function DetalleOrden({ oc, empresa, onVolver, onCambio }) {
  const [items, setItems] = useState(null);
  const [proveedor, setProveedor] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const borrador = oc.estado === "borrador";
  const abierta = ESTADOS_OC_ABIERTA.includes(oc.estado);

  const cargar = useCallback(async () => {
    try {
      const [its, provs] = await Promise.all([
        sb.get(`ordenes_compra_items?orden_id=eq.${oc.id}&order=id.asc`),
        oc.proveedor_id ? sb.get(`proveedores?id=eq.${oc.proveedor_id}&limit=1`) : Promise.resolve([]),
      ]);
      setItems(its || []);
      setProveedor(provs?.[0] || null);
      setForm({
        moneda: oc.moneda,
        fecha_prometida: oc.fecha_prometida || "",
        notas: oc.notas || "",
        renglones: Object.fromEntries((its || []).map((it) => [it.id, { cantidad: numTexto(it.cantidad), precio: numTexto(it.precio_unitario), obs: it.observacion || "" }])),
        quitar: new Set(),
      });
    } catch {
      setItems([]);
      setError("No se pudieron leer los renglones");
    }
  }, [oc]);
  useEffect(() => { cargar(); }, [cargar]);

  // Los renglones como quedarían con lo que se está editando (para el total, el PDF y el texto)
  const vista = useMemo(() => (items || [])
    .filter((it) => !form?.quitar.has(it.id))
    .map((it) => {
      const r = form?.renglones[it.id];
      if (!r) return it;
      const cantidad = leerCantidadMovimiento(r.cantidad) ?? it.cantidad;
      const precio = r.precio.trim() ? leerImporte(r.precio) : null;
      return { ...it, cantidad, precio_unitario: r.precio.trim() ? precio ?? it.precio_unitario : null, observacion: r.obs.trim() || null };
    }), [items, form]);
  const ocVista = form ? { ...oc, moneda: form.moneda, fecha_prometida: form.fecha_prometida || null, notas: form.notas.trim() || null } : oc;
  const total = totalOrden(vista);
  const nombreEmpresa = empresa?.nombre || empresa?.nombre_corto || "";
  const texto = items ? textoOrdenCompra({ empresa: nombreEmpresa, oc: ocVista, items: vista, proveedor }) : "";
  const wa = numeroWhatsapp(proveedor?.whatsapp);

  const guardar = async ({ silencioso = false } = {}) => {
    setError(null);
    const body = { accion: "oc_guardar", id: oc.id, fecha_prometida: form.fecha_prometida || null, notas: form.notas.trim() || null };
    if (borrador) {
      const renglones = [];
      for (const it of items) {
        if (form.quitar.has(it.id)) continue;
        const r = form.renglones[it.id];
        const cantidad = leerCantidadMovimiento(r.cantidad);
        if (!cantidad) { setError(`Revisá la cantidad de ${it.descripcion}`); return false; }
        const precio = r.precio.trim() ? leerImporte(r.precio) : null;
        if (r.precio.trim() && precio === null) { setError(`Revisá el precio de ${it.descripcion}`); return false; }
        const observacion = r.obs.trim() || null;
        const cambioObs = observacion !== (it.observacion || null);
        if (cambioObs || cantidad !== Number(it.cantidad) || precio !== (it.precio_unitario === null ? null : Number(it.precio_unitario))) {
          renglones.push({ id: it.id, cantidad, precio_unitario: precio, ...(cambioObs ? { observacion } : {}) });
        }
      }
      if (form.quitar.size >= items.length) { setError("La OC tiene que tener al menos un renglón. Si no va, anulala."); return false; }
      body.moneda = form.moneda;
      if (renglones.length) body.items = renglones;
      if (form.quitar.size) body.quitar = [...form.quitar];
    }
    setEnviando(true);
    try {
      await postCompras(body);
      if (!silencioso) setAviso("Guardado.");
      await onCambio();
      await cargar();
      setEnviando(false);
      return true;
    } catch (e) {
      setError(e.message);
      setEnviando(false);
      return false;
    }
  };

  const accion = async (nombre, mensaje) => {
    setError(null);
    setEnviando(true);
    try {
      await postCompras({ accion: nombre, id: oc.id });
      setAviso(mensaje);
      await onCambio();
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  const pdf = () => {
    setError(null);
    try {
      imprimirOrdenCompra({ empresa, oc: ocVista, items: vista, proveedor });
    } catch (e) {
      setError(e.message);
    }
  };

  const est = ESTADOS_OC[oc.estado] || ESTADOS_OC.borrador;
  return (
    <div>
      <button onClick={onVolver} className="min-h-[44px] px-0 mb-1 bg-transparent border-none text-[13px] font-semibold text-gypi-amber-ink cursor-pointer">← Órdenes de compra</button>
      <div className="text-[16px] font-bold">OC N° {oc.numero} · {oc.proveedor_nombre}</div>
      <div className="text-[12px] text-gypi-dim mb-3">
        {est.icono} {est.nombre}{ocAtrasada(oc) ? " · ⚠️ Atrasada" : ""} · {oc.creada_por_nombre || "—"} · {fechaCorta(oc.created_at)}
        {proveedor?.condicion_pago ? ` · Pago: ${proveedor.condicion_pago}` : ""}
      </div>

      {items === null || !form ? (
        <div className="text-[14px] text-gypi-dim" role="status">Cargando…</div>
      ) : (
        <>
          <ul aria-label="Renglones de la orden" className="list-none m-0 p-0 flex flex-col gap-1.5 mb-2">
            {items.filter((it) => !form.quitar.has(it.id)).map((it) => (
              <li key={it.id} className="p-2 rounded-[10px] border border-gypi-border bg-gypi-surface">
                <div className="text-[14px] font-semibold">{it.descripcion}{it.sku && <span className="text-gypi-dim font-normal"> · {it.sku}</span>}{it.ot && <span className="text-gypi-dim font-normal"> · OT {it.ot}</span>}</div>
                {borrador ? (
                  <>
                    <div className="flex gap-2 mt-1 items-center">
                      <input aria-label={`Cantidad de ${it.descripcion}`} className="g-input w-[90px]" inputMode="decimal" value={form.renglones[it.id].cantidad}
                        onChange={(e) => setForm((f) => ({ ...f, renglones: { ...f.renglones, [it.id]: { ...f.renglones[it.id], cantidad: e.target.value } } }))} />
                      <span className="text-[13px] text-gypi-dim">{it.unidad || ""}</span>
                      <input aria-label={`Precio sin IVA de ${it.descripcion}`} className="g-input w-[110px]" inputMode="decimal" placeholder="Precio s/IVA" value={form.renglones[it.id].precio}
                        onChange={(e) => setForm((f) => ({ ...f, renglones: { ...f.renglones, [it.id]: { ...f.renglones[it.id], precio: e.target.value } } }))} />
                      <button onClick={() => setForm((f) => ({ ...f, quitar: new Set([...f.quitar, it.id]) }))} aria-label={`Quitar ${it.descripcion}`}
                        className="min-h-[44px] px-2 ml-auto bg-transparent border-none text-[13px] font-semibold text-gypi-red cursor-pointer">Quitar</button>
                    </div>
                    <input aria-label={`Observación para el proveedor de ${it.descripcion}`} className="g-input w-full mt-1" maxLength={300} placeholder="Observación para el proveedor (opcional)"
                      value={form.renglones[it.id].obs} onChange={(e) => setForm((f) => ({ ...f, renglones: { ...f.renglones, [it.id]: { ...f.renglones[it.id], obs: e.target.value } } }))} />
                  </>
                ) : (
                  <div className="text-[13px] text-gypi-dim">
                    {Number(it.cantidad).toLocaleString("es-AR", { maximumFractionDigits: 3 })} {it.unidad || ""}
                    {it.precio_unitario !== null ? ` · ${importeTexto(it.precio_unitario, oc.moneda)} c/u` : ""}
                    {Number(it.cantidad_recibida) > 0 ? ` · Recibido ${Number(it.cantidad_recibida).toLocaleString("es-AR")}` : ""}
                    {it.observacion && <div className="italic">Obs.: {it.observacion}</div>}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="text-[15px] font-bold text-right mb-3">Total sin IVA: {total !== null ? importeTexto(total, form.moneda) : "sin precios"}</div>

          {abierta && (
            <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="g-label" htmlFor="oc-moneda">Moneda</label>
                  <select id="oc-moneda" className="g-input w-full mb-2" value={form.moneda} disabled={!borrador} onChange={(e) => setForm((f) => ({ ...f, moneda: e.target.value }))}>
                    {Object.values(MONEDAS).map((m) => <option key={m.id} value={m.id}>{m.id === "ARS" ? "Pesos" : "Dólares"}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="g-label" htmlFor="oc-fecha">Fecha prometida</label>
                  <input id="oc-fecha" type="date" className="g-input w-full mb-2" value={form.fecha_prometida} onChange={(e) => setForm((f) => ({ ...f, fecha_prometida: e.target.value }))} />
                </div>
              </div>
              <label className="g-label" htmlFor="oc-notas">Notas para el proveedor</label>
              <input id="oc-notas" className="g-input w-full mb-2" value={form.notas} maxLength={500} onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))} placeholder="Ej: entregar en planta, de 8 a 16" />
              <button onClick={() => guardar()} disabled={enviando} className="g-btn g-btn-secondary w-full">Guardar cambios</button>
            </div>
          )}

          {!borrador && oc.estado !== "anulada" && items.length > 0 && <FacturaOrden key={`${oc.id}-${oc.updated_at}`} oc={oc} items={items} onGuardada={async () => { await onCambio(); await cargar(); }} />}

          <div className="flex gap-2 flex-wrap mb-2">
            <button onClick={pdf} className="g-btn g-btn-secondary flex-1">📄 PDF</button>
            <a href={wa ? `https://wa.me/${wa}?text=${encodeURIComponent(texto)}` : `https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noopener noreferrer"
              className="g-btn g-btn-secondary flex-1 no-underline text-center">💬 WhatsApp</a>
            {proveedor?.email && (
              <a href={`mailto:${proveedor.email}?subject=${encodeURIComponent(`Orden de compra N° ${oc.numero}${nombreEmpresa ? ` · ${nombreEmpresa}` : ""}`)}&body=${encodeURIComponent(texto)}`}
                className="g-btn g-btn-secondary flex-1 no-underline text-center">✉️ Email</a>
            )}
          </div>
          <div className="text-[12px] text-gypi-dim mb-3">El PDF se guarda desde la ventana de imprimir (Guardar como PDF) y se adjunta en el WhatsApp o el mail.</div>

          {borrador && (
            <button onClick={async () => { if (await guardar({ silencioso: true })) await accion("oc_enviar", "Marcada como enviada."); }} disabled={enviando} className="g-btn g-btn-primary w-full mb-2">📤 Marcar como enviada</button>
          )}
          {["borrador", "enviada"].includes(oc.estado) && (
            <button onClick={() => accion("oc_anular", "Orden anulada. Sus pedidos volvieron a pendientes.")} disabled={enviando}
              className="min-h-[44px] w-full bg-transparent border-none text-[13px] font-semibold text-gypi-red cursor-pointer">Anular orden de compra</button>
          )}
        </>
      )}
      {aviso && <div role="status" className="text-[13px] mt-2">✅ {aviso}</div>}
      {error && <div role="alert" className="text-[13px] text-gypi-red mt-2">{error}</div>}
    </div>
  );
}

export default function OrdenesCompra({ empresaId, empresa = null, abrirId = null }) {
  const [ordenes, setOrdenes] = useState(null);
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  const [filtro, setFiltro] = useState("abiertas");
  const [abierta, setAbierta] = useState(abrirId);

  const cargar = useCallback(async () => {
    if (!empresaId) return;
    try {
      const rows = await sb.get("ordenes_compra?order=numero.desc&limit=300");
      setOrdenes(rows || []);
      setFaltaMigracion(false);
    } catch (e) {
      setOrdenes([]);
      if (String(e?.message).includes("ordenes_compra")) setFaltaMigracion(true);
    }
  }, [empresaId]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { if (abrirId) setAbierta(abrirId); }, [abrirId]);

  const visibles = useMemo(() => (ordenes || []).filter((o) => {
    if (filtro === "abiertas") return ESTADOS_OC_ABIERTA.includes(o.estado);
    if (filtro === "atrasadas") return ocAtrasada(o);
    return !filtro || o.estado === filtro;
  }), [ordenes, filtro]);
  const actual = (ordenes || []).find((o) => o.id === abierta);

  if (actual) return <DetalleOrden key={actual.id} oc={actual} empresa={empresa} onVolver={() => setAbierta(null)} onCambio={cargar} />;

  return (
    <div>
      {faltaMigracion && <div role="alert" className="p-3 mb-3 rounded-[10px] bg-gypi-red/10 text-gypi-red text-[14px]">{AVISO_MIGRACION_114}</div>}
      <select aria-label="Qué órdenes ver" className="g-input w-full mb-2" value={filtro} onChange={(e) => setFiltro(e.target.value)}>
        <option value="abiertas">Abiertas</option>
        <option value="atrasadas">⚠️ Atrasadas</option>
        {Object.values(ESTADOS_OC).map((s) => <option key={s.id} value={s.id}>{s.icono} {s.nombre}</option>)}
        <option value="">Todas</option>
      </select>
      {ordenes === null ? (
        <div className="text-[14px] text-gypi-dim" role="status">Cargando órdenes…</div>
      ) : !visibles.length ? (
        <div className="text-[14px] text-gypi-dim">{ordenes.length ? "No hay órdenes con ese filtro." : "Todavía no hay órdenes de compra. Se arman desde A comprar."}</div>
      ) : (
        <ul aria-label="Órdenes de compra" className="list-none m-0 p-0 flex flex-col gap-1.5">
          {visibles.map((o) => {
            const est = ESTADOS_OC[o.estado] || ESTADOS_OC.borrador;
            return (
              <li key={o.id}>
                <button onClick={() => setAbierta(o.id)} className={`w-full text-left p-2 rounded-[10px] border bg-gypi-surface cursor-pointer font-body text-gypi-text ${ocAtrasada(o) ? "border-gypi-red" : "border-gypi-border"} ${o.estado === "anulada" ? "opacity-60" : ""}`}>
                  <div className="text-[14px] font-semibold">OC N° {o.numero} · {o.proveedor_nombre}</div>
                  <div className="text-[12px] text-gypi-dim">
                    {est.icono} {est.nombre}{ocAtrasada(o) ? " · ⚠️ Atrasada" : ""} · {fechaCorta(o.created_at)}
                    {o.fecha_prometida ? ` · Entrega ${fechaCorta(o.fecha_prometida)}` : ""}{o.moneda === "USD" ? " · Dólares" : ""}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
