'use client';
// app/components/ReportesCompras.jsx — Planta → Compras → Reportes (Compras,
// parte 23; ítem 41). Para quien compra: cuánto se compró por mes y por
// proveedor, órdenes atrasadas, pedidos de los jefes sin atender y cómo
// cambió el precio de un artículo.
import { useEffect, useMemo, useState } from "react";
import { sbGetAll } from "../lib/supabase";
import { textoPedido } from "../lib/compras";
import { importeTexto } from "../lib/ordenesCompra";
import { comprasPorMes, comprasPorProveedor, historialPrecio, nombreMes, ordenesAtrasadas, pedidosSinAtender } from "../lib/reportesCompras";
import { AVISO_MIGRACION_114 } from "./AComprar";

const fechaCorta = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");
const dias = (n) => `${n} día${n === 1 ? "" : "s"}`;

/** "$ 1.500 · US$ 200" (lo que haya) */
function importes(g) {
  const partes = [];
  if (g.ARS || !g.USD) partes.push(importeTexto(g.ARS, "ARS"));
  if (g.USD) partes.push(importeTexto(g.USD, "USD"));
  return partes.join(" · ");
}

function Seccion({ titulo, children }) {
  return (
    <section className="mb-4">
      <h3 className="text-[15px] font-bold m-0 mb-2">{titulo}</h3>
      {children}
    </section>
  );
}

const renglon = "p-2 mb-1.5 rounded-[10px] border border-gypi-border bg-gypi-surface text-[14px]";
const nada = (t) => <p className="m-0 text-[14px] text-gypi-dim">{t}</p>;

export default function ReportesCompras({ empresaId }) {
  const [datos, setDatos] = useState(null);
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  const [mes, setMes] = useState("");
  const [buscar, setBuscar] = useState("");

  useEffect(() => {
    if (!empresaId) return;
    let vivo = true;
    Promise.all([
      sbGetAll("ordenes_compra?select=id,numero,proveedor_nombre,moneda,estado,fecha_prometida,enviada_at,created_at&order=id.asc", { maxFilas: 20000 }),
      sbGetAll("ordenes_compra_items?select=orden_id,sku,descripcion,cantidad,precio_unitario&order=id.asc", { maxFilas: 50000 }),
      sbGetAll("pedidos_compra?estado=eq.pendiente&select=id,sku,descripcion,unidad,cantidad,ot,division,empleado_nombre,created_at&order=created_at.asc,id.asc", { maxFilas: 5000 }),
    ])
      .then(([o, i, p]) => { if (vivo) setDatos({ ordenes: o.data || [], items: i.data || [], pedidos: p.data || [] }); })
      .catch((e) => {
        if (!vivo) return;
        setDatos({ ordenes: [], items: [], pedidos: [] });
        if (String(e?.message).includes("ordenes_compra")) setFaltaMigracion(true);
      });
    return () => { vivo = false; };
  }, [empresaId]);

  const porMes = useMemo(() => (datos ? comprasPorMes(datos.ordenes, datos.items) : []), [datos]);
  const porProveedor = useMemo(() => (datos ? comprasPorProveedor(datos.ordenes, datos.items, mes || null) : []), [datos, mes]);
  const atrasadas = useMemo(() => (datos ? ordenesAtrasadas(datos.ordenes) : []), [datos]);
  const sinAtender = useMemo(() => (datos ? pedidosSinAtender(datos.pedidos) : []), [datos]);
  const precios = useMemo(() => (datos ? historialPrecio(datos.ordenes, datos.items, buscar) : []), [datos, buscar]);

  if (!datos) return <div className="text-[14px] text-gypi-dim" role="status">Cargando…</div>;

  return (
    <div>
      {faltaMigracion && <div role="alert" className="p-3 mb-3 rounded-[10px] bg-gypi-red/10 text-gypi-red text-[14px]">{AVISO_MIGRACION_114}</div>}
      <p className="m-0 mb-3 text-[13px] text-gypi-dim">Importes sin IVA, de las órdenes mandadas al proveedor (no cuentan borradores ni anuladas).</p>

      <Seccion titulo="📅 Compras por mes">
        {porMes.length ? porMes.map((g) => (
          <div key={g.mes} className={`${renglon} flex justify-between gap-2`}>
            <span>{nombreMes(g.mes)} · {g.ordenes} {g.ordenes === 1 ? "orden" : "órdenes"}</span>
            <b className="text-right">{importes(g)}</b>
          </div>
        )) : nada("Todavía no hay órdenes mandadas.")}
        {porMes.some((g) => g.sinPrecio) && <p className="m-0 text-[12px] text-gypi-dim">Hay renglones sin precio: no suman hasta que cargues la factura.</p>}
      </Seccion>

      <Seccion titulo="🏭 Compras por proveedor">
        <select aria-label="Mes" className="g-input w-full mb-2" value={mes} onChange={(e) => setMes(e.target.value)}>
          <option value="">Todos los meses</option>
          {porMes.map((g) => <option key={g.mes} value={g.mes}>{nombreMes(g.mes)}</option>)}
        </select>
        {porProveedor.length ? porProveedor.map((g) => (
          <div key={g.proveedor} className={`${renglon} flex justify-between gap-2`}>
            <span>{g.proveedor} · {g.ordenes} {g.ordenes === 1 ? "orden" : "órdenes"}</span>
            <b className="text-right">{importes(g)}</b>
          </div>
        )) : nada("Sin compras en ese período.")}
      </Seccion>

      <Seccion titulo={`⚠️ Órdenes atrasadas (${atrasadas.length})`}>
        {atrasadas.length ? atrasadas.map((oc) => (
          <div key={oc.id} className={`${renglon} border-gypi-red`}>
            <b>N° {oc.numero} · {oc.proveedor_nombre}</b>
            <div className="text-[12px] text-gypi-dim">Prometida el {fechaCorta(oc.fecha_prometida)} · {dias(oc.dias_atraso)} de atraso</div>
          </div>
        )) : nada("Ninguna: todo lo mandado llegó a tiempo o no tiene fecha prometida vencida.")}
      </Seccion>

      <Seccion titulo={`🕓 Pedidos sin atender (${sinAtender.length})`}>
        {sinAtender.length ? sinAtender.map((p) => (
          <div key={p.id} className={renglon}>
            <b>{textoPedido(p)}</b>
            <div className="text-[12px] text-gypi-dim">{p.empleado_nombre || "—"}{p.division ? ` · ${p.division}` : ""} · pedido el {fechaCorta(p.created_at)} · esperando {dias(p.dias_espera)}</div>
          </div>
        )) : nada("Ninguno: todos los pedidos ya están en una orden.")}
      </Seccion>

      <Seccion titulo="💲 Precio de un artículo">
        <input aria-label="Buscar artículo" className="g-input w-full mb-2" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Código (SKU) o parte del nombre" />
        {buscar.trim().length >= 2 && (precios.length ? precios.map((f, i) => (
          <div key={`${f.numero}-${i}`} className={`${renglon} flex justify-between gap-2`}>
            <span>
              {f.descripcion || f.sku}
              <span className="block text-[12px] text-gypi-dim">{fechaCorta(f.fecha)} · N° {f.numero} · {f.proveedor}</span>
            </span>
            <span className="text-right">
              <b>{importeTexto(f.precio, f.moneda)}</b>
              {f.cambio !== null && (
                <span className={`block text-[12px] ${f.cambio > 0 ? "text-gypi-red" : f.cambio < 0 ? "text-gypi-green" : "text-gypi-dim"}`}>
                  {f.cambio > 0 ? "▲" : f.cambio < 0 ? "▼" : "="} {Math.abs(f.cambio).toLocaleString("es-AR")}%
                </span>
              )}
            </span>
          </div>
        )) : nada("No encontré compras con precio de ese artículo."))}
      </Seccion>
    </div>
  );
}
