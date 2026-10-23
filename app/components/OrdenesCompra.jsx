'use client';
// app/components/OrdenesCompra.jsx — Planta → Compras → Órdenes (Compras,
// parte 21; ítem 41). Las OC armadas en "A comprar": se revisan cantidades,
// precios sin IVA, moneda y fecha prometida, se mandan al proveedor (PDF +
// WhatsApp o email) y se marcan enviadas. Una enviada que pasó la fecha
// prometida aparece atrasada. Lo que llega se recibe en Compras → Recibir y
// la factura, que puede llegar después, se carga acá (parte 22). Una orden
// "A cotizar" (sin proveedor) se manda a cotizar a varios proveedores, se
// anota lo que contestó cada uno y se elige al ganador (125).
import { useCallback, useEffect, useMemo, useState } from "react";
import { sb, sbGetAll, apiFetch } from "../lib/supabase";
import { leerCantidadMovimiento } from "../lib/movimientosStock";
import { faltaTabla, numeroWhatsapp } from "../lib/compras";
import {
  ESTADOS_OC, ESTADOS_OC_ABIERTA, ESTADOS_OC_CERRABLE, MONEDAS, pendienteItem, importeTexto, leerImporte, imprimirOrdenCompra, ocAtrasada, textoOrdenCompra, totalOrden,
  ALICUOTAS_IVA, IVA_POR_DEFECTO, cantidadFacturaInicial, renglonFactura, totalesFactura,
  ocACotizar, estadoOcVisible, cotizacionMasBarata, textoCotizacion,
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

const AVISO_MIGRACION_125 = "Para pedir cotizaciones falta correr la migración 125 en Supabase.";
const formCotizacion = (c) => ({ total: numTexto(c.total), plazo: c.plazo_dias === null || c.plazo_dias === undefined ? "" : String(c.plazo_dias), nota: c.nota || "" });

/**
 * Orden "A cotizar" (125): se elige a qué proveedores pedirle precio, a cada
 * uno se le manda el pedido de cotización (PDF, WhatsApp o email, sin
 * precios), se anota lo que contestó (total sin IVA, plazo y nota) y al
 * elegir al ganador la orden pasa a ser suya.
 */
function CotizacionesOrden({ oc, ocVista, items, empresa, onCambio }) {
  const [cotizaciones, setCotizaciones] = useState(null);
  const [proveedores, setProveedores] = useState([]);
  const [forms, setForms] = useState({});
  const [elegido, setElegido] = useState("");
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const nombreEmpresa = empresa?.nombre || empresa?.nombre_corto || "";

  const cargar = useCallback(async () => {
    try {
      const [cots, provs] = await Promise.all([
        sb.get(`ordenes_compra_cotizaciones?orden_id=eq.${oc.id}&order=id.asc`).catch((e) => {
          if (faltaTabla(e, "ordenes_compra_cotizaciones")) { setFaltaMigracion(true); return []; }
          throw e;
        }),
        sbGetAll("proveedores?activo=eq.true&select=id,nombre,contacto,whatsapp,email,cuit,condicion_pago&order=nombre.asc", { maxFilas: 5000 }).then((r) => r.data || []),
      ]);
      setCotizaciones(cots || []);
      setProveedores(provs);
      setForms(Object.fromEntries((cots || []).map((c) => [c.id, formCotizacion(c)])));
    } catch {
      setCotizaciones([]);
      setError("No se pudieron leer las cotizaciones");
    }
  }, [oc.id]);
  useEffect(() => { cargar(); }, [cargar]);

  const hacer = async (body, mensaje, { recargarOrden = false } = {}) => {
    setError(null);
    setAviso(null);
    setEnviando(true);
    try {
      await postCompras(body);
      setAviso(mensaje);
      if (recargarOrden) await onCambio();
      else await cargar();
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  const agregar = () => {
    if (!elegido) { setError("Elegí el proveedor al que le querés pedir cotización"); return; }
    setElegido("");
    hacer({ accion: "oc_cotizacion_pedir", id: oc.id, proveedores: [Number(elegido)] }, "Proveedor agregado. Mandale el pedido por WhatsApp, email o PDF.");
  };

  const guardar = (c) => {
    const f = forms[c.id];
    const total = f.total.trim() ? leerImporte(f.total) : null;
    if (f.total.trim() && total === null) { setError(`Revisá el total de ${c.proveedor_nombre}`); return; }
    const plazo = f.plazo.trim() ? Number(f.plazo.trim()) : null;
    if (f.plazo.trim() && !(Number.isInteger(plazo) && plazo >= 0 && plazo <= 3650)) { setError(`El plazo de ${c.proveedor_nombre} va en días`); return; }
    hacer({ accion: "oc_cotizacion_guardar", id: c.id, total, plazo_dias: plazo, nota: f.nota.trim() || null }, `Cotización de ${c.proveedor_nombre} guardada.`);
  };

  const pdf = (prov) => {
    setError(null);
    try {
      imprimirOrdenCompra({ empresa, oc: ocVista, items, proveedor: prov, cotizacion: true });
    } catch (e) {
      setError(e.message);
    }
  };

  const cambiar = (id, campo, valor) => setForms((f) => ({ ...f, [id]: { ...f[id], [campo]: valor } }));
  const pedidos = new Set((cotizaciones || []).map((c) => c.proveedor_id));
  const masBarata = cotizacionMasBarata(cotizaciones);

  return (
    <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
      <div className="text-[14px] font-bold mb-1">📨 Pedir cotización</div>
      <div className="text-[13px] text-gypi-dim mb-2">
        Agregá los proveedores a los que les vas a pedir precio y mandale a cada uno el pedido (sale sin precios).
        Cuando contesten, anotá el total y el plazo, y elegí con quién comprás.
      </div>
      {faltaMigracion ? (
        <div role="alert" className="text-[13px] text-gypi-red">{AVISO_MIGRACION_125}</div>
      ) : cotizaciones === null ? (
        <div className="text-[14px] text-gypi-dim" role="status">Cargando…</div>
      ) : (
        <>
          <div className="flex gap-2 mb-2">
            <select aria-label="Proveedor para pedir cotización" className="g-input flex-1 min-w-0" value={elegido} onChange={(e) => setElegido(e.target.value)}>
              <option value="">Elegí proveedor…</option>
              {proveedores.filter((p) => !pedidos.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
            <button onClick={agregar} disabled={enviando} className="g-btn g-btn-secondary">Agregar</button>
          </div>
          {!cotizaciones.length ? (
            <div className="text-[13px] text-gypi-dim">Todavía no le pediste cotización a nadie.</div>
          ) : (
            <ul aria-label="Cotizaciones" className="list-none m-0 p-0 flex flex-col gap-2">
              {cotizaciones.map((c) => {
                const prov = proveedores.find((p) => p.id === c.proveedor_id) || { id: c.proveedor_id, nombre: c.proveedor_nombre };
                const texto = textoCotizacion({ empresa: nombreEmpresa, oc: ocVista, items, proveedor: prov });
                const wa = numeroWhatsapp(prov.whatsapp);
                const f = forms[c.id] || formCotizacion(c);
                return (
                  <li key={c.id} className={`p-2 rounded-[10px] border ${c.id === masBarata ? "border-gypi-amber" : "border-gypi-border"}`}>
                    <div className="text-[14px] font-semibold">
                      {c.proveedor_nombre}
                      {c.id === masBarata && <span className="font-normal"> · 💲 Más barato</span>}
                    </div>
                    <div className="text-[12px] text-gypi-dim mb-1">
                      Pedida el {fechaCorta(c.created_at)}{c.pedida_por_nombre ? ` por ${c.pedida_por_nombre}` : ""}
                      {c.total !== null && c.total !== undefined ? ` · ${importeTexto(c.total, oc.moneda)} sin IVA` : " · Sin respuesta"}
                      {c.plazo_dias !== null && c.plazo_dias !== undefined ? ` · ${c.plazo_dias} días` : ""}
                    </div>
                    <div className="flex gap-2 flex-wrap mb-2">
                      <button onClick={() => pdf(prov)} className="g-btn g-btn-secondary flex-1">📄 PDF</button>
                      <a href={wa ? `https://wa.me/${wa}?text=${encodeURIComponent(texto)}` : `https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noopener noreferrer"
                        aria-label={`WhatsApp a ${c.proveedor_nombre}`} className="g-btn g-btn-secondary flex-1 no-underline text-center">💬 WhatsApp</a>
                      {prov.email && (
                        <a href={`mailto:${prov.email}?subject=${encodeURIComponent(`Pedido de cotización N° ${oc.numero}${nombreEmpresa ? ` · ${nombreEmpresa}` : ""}`)}&body=${encodeURIComponent(texto)}`}
                          aria-label={`Email a ${c.proveedor_nombre}`} className="g-btn g-btn-secondary flex-1 no-underline text-center">✉️ Email</a>
                      )}
                    </div>
                    <div className="flex gap-2 mb-1">
                      <input aria-label={`Total sin IVA de ${c.proveedor_nombre}`} className="g-input flex-1 min-w-0" inputMode="decimal" placeholder="Total s/IVA"
                        value={f.total} onChange={(e) => cambiar(c.id, "total", e.target.value)} />
                      <input aria-label={`Plazo en días de ${c.proveedor_nombre}`} className="g-input w-[90px]" inputMode="numeric" placeholder="Días"
                        value={f.plazo} onChange={(e) => cambiar(c.id, "plazo", e.target.value)} />
                    </div>
                    <input aria-label={`Nota de ${c.proveedor_nombre}`} className="g-input w-full mb-2" maxLength={300} placeholder="Nota (ej: pago a 30 días, sin flete)"
                      value={f.nota} onChange={(e) => cambiar(c.id, "nota", e.target.value)} />
                    <div className="flex gap-2 flex-wrap">
                      <button onClick={() => guardar(c)} disabled={enviando} className="g-btn g-btn-secondary flex-1">Guardar respuesta</button>
                      <button onClick={() => hacer({ accion: "oc_adjudicar", id: c.id }, `La orden ahora es de ${c.proveedor_nombre}.`, { recargarOrden: true })} disabled={enviando}
                        className="g-btn g-btn-primary flex-1">✅ Elegir este proveedor</button>
                    </div>
                    <button onClick={() => hacer({ accion: "oc_cotizacion_quitar", id: c.id }, `${c.proveedor_nombre} quitado.`)} disabled={enviando} aria-label={`Quitar a ${c.proveedor_nombre}`}
                      className="min-h-[44px] w-full bg-transparent border-none text-[13px] font-semibold text-gypi-red cursor-pointer">Quitar</button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
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
  const aCotizar = ocACotizar(oc);
  const abierta = ESTADOS_OC_ABIERTA.includes(oc.estado);
  const cerrada = oc.estado === "cerrada_faltantes";
  const [cerrando, setCerrando] = useState(false);
  const [motivo, setMotivo] = useState("");

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
  const subtotalRenglon = (id) => {
    const v = vista.find((x) => x.id === id);
    return v && v.precio_unitario !== null && v.precio_unitario !== undefined ? Number(v.cantidad) * Number(v.precio_unitario) : null;
  };
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

  const cerrarConFaltantes = async () => {
    setError(null);
    if (!motivo.trim()) { setError("Escribí por qué se cierra (ej: el proveedor no tenía stock)"); return; }
    setEnviando(true);
    try {
      const r = await postCompras({ accion: "oc_cerrar_faltantes", id: oc.id, motivo: motivo.trim() });
      setCerrando(false);
      setAviso(r?.vuelven ? `Orden cerrada. ${r.vuelven === 1 ? "Un pedido volvió" : `${r.vuelven} pedidos volvieron`} a "A comprar" por lo que faltó.` : "Orden cerrada con faltantes.");
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

  const est = estadoOcVisible(oc);
  return (
    <div>
      <button onClick={onVolver} className="min-h-[44px] px-0 mb-1 bg-transparent border-none text-[13px] font-semibold text-gypi-amber-ink cursor-pointer">← Órdenes de compra</button>
      <div className="text-[16px] font-bold">OC N° {oc.numero} · {oc.proveedor_nombre}</div>
      <div className="text-[12px] text-gypi-dim mb-3">
        {est.icono} {est.nombre}{ocAtrasada(oc) ? " · ⚠️ Atrasada" : ""} · {oc.creada_por_nombre || "—"} · {fechaCorta(oc.created_at)}
        {proveedor?.condicion_pago ? ` · Pago: ${proveedor.condicion_pago}` : ""}
      </div>
      {cerrada && (
        <div role="note" className="p-2 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface text-[13px]">
          🔒 Cerrada con faltantes{oc.cerrada_por_nombre ? ` por ${oc.cerrada_por_nombre}` : ""}{oc.cerrada_at ? ` el ${fechaCorta(oc.cerrada_at)}` : ""}.
          {oc.cerrada_motivo ? ` Motivo: ${oc.cerrada_motivo}.` : ""} Lo que faltó no va a llegar.
        </div>
      )}

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
                    <div className="flex gap-2 mt-1 items-end">
                      <div className="flex-1 min-w-0">
                        <label className="g-label" htmlFor={`oc-cant-${it.id}`}>Cantidad{it.unidad ? ` (${it.unidad})` : ""}</label>
                        <input id={`oc-cant-${it.id}`} aria-label={`Cantidad de ${it.descripcion}`} className="g-input" inputMode="decimal" value={form.renglones[it.id].cantidad}
                          onChange={(e) => setForm((f) => ({ ...f, renglones: { ...f.renglones, [it.id]: { ...f.renglones[it.id], cantidad: e.target.value } } }))} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <label className="g-label" htmlFor={`oc-precio-${it.id}`}>Precio unitario {form.moneda === "USD" ? "US$" : "$"} sin IVA</label>
                        <input id={`oc-precio-${it.id}`} aria-label={`Precio sin IVA de ${it.descripcion}`} className="g-input" inputMode="decimal" placeholder="Por cada unidad" value={form.renglones[it.id].precio}
                          onChange={(e) => setForm((f) => ({ ...f, renglones: { ...f.renglones, [it.id]: { ...f.renglones[it.id], precio: e.target.value } } }))} />
                      </div>
                      <button onClick={() => setForm((f) => ({ ...f, quitar: new Set([...f.quitar, it.id]) }))} aria-label={`Quitar ${it.descripcion}`}
                        className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-red cursor-pointer">Quitar</button>
                    </div>
                    {subtotalRenglon(it.id) !== null && (
                      <div className="text-[12px] text-gypi-dim mt-1">Subtotal del renglón: {importeTexto(subtotalRenglon(it.id), form.moneda)} sin IVA</div>
                    )}
                    <input aria-label={`Observación para el proveedor de ${it.descripcion}`} className="g-input w-full mt-1" maxLength={300} placeholder="Observación para el proveedor (opcional)"
                      value={form.renglones[it.id].obs} onChange={(e) => setForm((f) => ({ ...f, renglones: { ...f.renglones, [it.id]: { ...f.renglones[it.id], obs: e.target.value } } }))} />
                  </>
                ) : (
                  <div className="text-[13px] text-gypi-dim">
                    {Number(it.cantidad).toLocaleString("es-AR", { maximumFractionDigits: 3 })} {it.unidad || ""}
                    {it.precio_unitario !== null ? ` · ${importeTexto(it.precio_unitario, oc.moneda)} c/u` : ""}
                    {Number(it.cantidad_recibida) > 0 ? ` · Recibido ${Number(it.cantidad_recibida).toLocaleString("es-AR")}` : ""}
                    {cerrada && pendienteItem(it) > 0 ? ` · No llegó ${pendienteItem(it).toLocaleString("es-AR")}` : ""}
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

          {aCotizar && <CotizacionesOrden oc={oc} ocVista={ocVista} items={vista} empresa={empresa} onCambio={onCambio} />}

          {!aCotizar && (<>
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
          </>)}

          {borrador && !aCotizar && (
            <button onClick={async () => { if (await guardar({ silencioso: true })) await accion("oc_enviar", "Marcada como enviada."); }} disabled={enviando} className="g-btn g-btn-primary w-full mb-2">📤 Marcar como enviada</button>
          )}
          {ESTADOS_OC_CERRABLE.includes(oc.estado) && !cerrando && (
            <button onClick={() => { setCerrando(true); setError(null); setAviso(null); }} disabled={enviando} className="g-btn g-btn-secondary w-full mb-2">🔒 Cerrar con faltantes</button>
          )}
          {ESTADOS_OC_CERRABLE.includes(oc.estado) && cerrando && (
            <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
              <div className="text-[14px] font-semibold mb-1">Cerrar con faltantes</div>
              <div className="text-[13px] text-gypi-dim mb-1">Esto no va a llegar. Lo que era de un pedido vuelve a &quot;A comprar&quot; para pedírselo a otro proveedor.</div>
              <ul aria-label="Lo que no llegó" className="m-0 mb-2 pl-5 text-[13px]">
                {items.filter((it) => pendienteItem(it) > 0).map((it) => (
                  <li key={it.id}>{it.descripcion}: faltan {pendienteItem(it).toLocaleString("es-AR", { maximumFractionDigits: 3 })} {it.unidad || ""}</li>
                ))}
              </ul>
              <label className="g-label" htmlFor="oc-motivo-cierre">Motivo</label>
              <input id="oc-motivo-cierre" className="g-input w-full mb-2" maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: el proveedor no tenía stock" />
              <div className="flex gap-2">
                <button onClick={() => setCerrando(false)} disabled={enviando} className="g-btn g-btn-secondary flex-1">Cancelar</button>
                <button onClick={cerrarConFaltantes} disabled={enviando} className="g-btn g-btn-primary flex-1">{enviando ? "Cerrando…" : "Cerrar orden"}</button>
              </div>
            </div>
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
    if (filtro === "a_cotizar") return ocACotizar(o);
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
        <option value="a_cotizar">📨 A cotizar</option>
        {Object.values(ESTADOS_OC).map((s) => <option key={s.id} value={s.id}>{s.icono} {s.nombre}</option>)}
        <option value="">Todas</option>
      </select>
      {ordenes === null ? (
        <div className="text-[14px] text-gypi-dim" role="status">Cargando órdenes…</div>
      ) : !visibles.length ? (
        <div className="text-[14px] text-gypi-dim">{ordenes.length ? "No hay órdenes con ese filtro." : "Todavía no hay órdenes de compra. Se arman desde A comprar."}</div>
      ) : (
        <ul aria-label="Órdenes de compra" className="list-none m-0 p-0 lista-ancha flex flex-col gap-1.5">
          {visibles.map((o) => {
            const est = estadoOcVisible(o);
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
