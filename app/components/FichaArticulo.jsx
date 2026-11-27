'use client';
// app/components/FichaArticulo.jsx — Ficha de un artículo del stock (Stock,
// parte 13; ítem 40). Se abre desde la lista de Stock o escaneando el QR de
// la etiqueta (?articulo=SKU), para cualquiera de la empresa. Los números son
// los que calculó la planilla MRP en la última sincronización. Desde la ficha
// se puede retirar o devolver ese artículo (parte 14). Dueño y Administración
// ven además el último precio y el historial de precios con fecha (costo de
// OT, parte A; 164). También ponen la foto del artículo (211), la que sale en
// el rótulo con QR que se imprime desde la lista de Stock.
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { sb, apiFetch } from "../lib/supabase";
import BotonFoto from "./BotonFoto";
import RecortarFoto from "./RecortarFoto";
import { Button } from "./ui";
import { subirImagen } from "../lib/foto";
import { cantidadTexto, nivelSemaforo } from "../lib/stock";
import { useEscape } from "../hooks/useEscape";
import { ORIGENES_PRECIO, historialPrecios, textoFechaPrecio, textoPrecio, ultimosPrecios, veePrecios } from "../lib/preciosArticulos";

const RetirarMaterial = dynamic(() => import("./RetirarMaterial"), { ssr: false });

const COLOR_NIVEL = {
  rojo: "bg-gypi-red/10 text-gypi-red",
  amarillo: "bg-gypi-amber/10 text-gypi-amber-ink",
  verde: "bg-gypi-green/10 text-gypi-green",
};

export function Semaforo({ texto }) {
  if (!texto) return null;
  const nivel = nivelSemaforo(texto);
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[12px] font-bold whitespace-nowrap ${COLOR_NIVEL[nivel] || "bg-gypi-surf-hi text-gypi-dim"}`}>{texto}</span>
  );
}

function Dato({ label, valor, unidad }) {
  return (
    <div className="p-2.5 rounded-[10px] bg-gypi-surface border border-gypi-border">
      <div className="text-[12px] text-gypi-dim">{label}</div>
      <div className="text-[18px] font-bold">{cantidadTexto(valor)}{valor !== null && valor !== undefined && unidad ? <span className="text-[13px] font-semibold text-gypi-dim"> {unidad}</span> : null}</div>
    </div>
  );
}

const fechaCorta = (f) => (f ? f.split("-").reverse().join("/") : "");

/** Historial de precios del artículo (v_precios_articulos, 164). */
export function PreciosArticulo({ sku, ultimoPlanilla = null }) {
  const [precios, setPrecios] = useState(null);
  const [falla, setFalla] = useState(false);
  useEffect(() => {
    let vivo = true;
    sb.get(`v_precios_articulos?sku=eq.${encodeURIComponent(sku)}&select=fecha,precio,moneda,tipo_cambio,precio_ars,origen,proveedor,comprobante&order=fecha.desc&limit=30`)
      .then((rows) => { if (vivo) setPrecios(historialPrecios(rows || [])); })
      .catch(() => { if (vivo) setFalla(true); });
    return () => { vivo = false; };
  }, [sku]);
  if (falla) return null; // sin la migración 164 (o sin permiso) no se muestra
  const ultimo = precios === null ? null : ultimosPrecios(precios.map((p) => ({ ...p, sku })), [{ sku, ultimo_precio: ultimoPlanilla }]).get(sku) || null;
  return (
    <section aria-label="Precios" className="mb-3">
      <h4 className="m-0 mb-1.5 text-[14px] font-bold">💲 Precios (sin IVA)</h4>
      {precios === null && <div className="text-[13px] text-gypi-dim">Buscando precios…</div>}
      {ultimo && (
        <div className="p-2.5 mb-2 rounded-[10px] bg-gypi-surface border border-gypi-border" aria-label="Último precio">
          <div className="text-[12px] text-gypi-dim">Último precio</div>
          <div className="text-[18px] font-bold">{textoPrecio(ultimo.precio)}</div>
          <div className="text-[12px] text-gypi-dim">
            {ultimo.fecha ? `Del ${textoFechaPrecio(ultimo)}` : "Último precio de la planilla, sin fecha"}
            {ultimo.proveedor ? ` · ${ultimo.proveedor}` : ""}
            {ultimo.precio_usd !== null ? ` · ${textoPrecio(ultimo.precio_usd, "USD")}` : ""}
          </div>
        </div>
      )}
      {precios?.length === 0 && <div className="text-[13px] text-gypi-dim">Todavía no hay precios de este artículo. Salen de la hoja fact_ingresos_stock de la planilla MRP y de las facturas de las órdenes de compra.</div>}
      {precios?.length > 0 && (
        <ul className="m-0 p-0 list-none flex flex-col gap-1">
          {precios.map((p, i) => {
            const o = ORIGENES_PRECIO[p.origen] || { icono: "•", texto: p.origen };
            return (
              <li key={i} className="flex items-baseline gap-2 text-[13px] py-1 border-b border-gypi-border last:border-0">
                <span className="w-[74px] shrink-0 text-gypi-dim">{fechaCorta(p.fecha)}</span>
                <span className="flex-1 min-w-0">
                  <span title={o.texto}>{o.icono}</span> {p.proveedor || o.texto}
                  {p.comprobante ? <span className="text-gypi-dim"> · {p.comprobante}</span> : null}
                </span>
                <span className="text-right font-semibold whitespace-nowrap">
                  {textoPrecio(p.precio_ars)}
                  {p.moneda === "USD" && <span className="block text-[12px] font-normal text-gypi-dim">{textoPrecio(p.precio, "USD")}{p.tipo_cambio ? ` × ${p.tipo_cambio}` : " · sin tipo de cambio"}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Guarda (o saca, con null) la foto de un artículo (211). Devuelve la foto guardada. */
export async function guardarFotoArticulo(sku, foto_url) {
  const r = await apiFetch("/api/stock/articulos", { method: "PATCH", body: JSON.stringify({ sku, foto_url }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "No se pudo guardar la foto");
  return j.foto_url ?? null;
}

/** Foto del artículo (211): la ve cualquiera; dueños y administradores la ponen, cambian o sacan. */
export function FotoArticulo({ sku, nombre, foto, puedeEditar, onCambio }) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [recortando, setRecortando] = useState(false);
  if (!foto && !puedeEditar) return null;
  const guardar = async (foto_url) => {
    setGuardando(true);
    setError(null);
    try {
      onCambio(await guardarFotoArticulo(sku, foto_url));
    } catch (e) {
      setError(e.message);
    }
    setGuardando(false);
  };
  return (
    <section aria-label="Foto del artículo" className="flex items-center gap-3 mb-3">
      {foto && (
        <a href={foto} target="_blank" rel="noopener noreferrer" className="shrink-0">
          <img src={foto} alt={`Foto de ${nombre || sku}`} className="w-24 h-24 object-cover rounded-[10px] border border-gypi-border" />
        </a>
      )}
      {puedeEditar && (
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          <BotonFoto label={foto ? "📷 Cambiar la foto" : "📷 Foto del artículo"} disabled={guardando} onFoto={guardar} recortar />
          {/* 27/11 (Tadeo): recortar la que ya está, para que el artículo se vea bien en el rótulo */}
          {foto && <Button variant="secondary" disabled={guardando} onClick={() => setRecortando(true)}>✂️ Recortar la foto</Button>}
          {foto && (
            <button onClick={() => guardar(null)} disabled={guardando}
              className="min-h-[36px] p-0 bg-transparent border-none text-[13px] font-semibold text-gypi-red cursor-pointer text-left">Sacar la foto</button>
          )}
          {!foto && <div className="text-[12px] text-gypi-dim">Sale en el rótulo con QR que se imprime desde la lista de Stock.</div>}
          {guardando && <div className="text-[12px] text-gypi-dim" role="status">Guardando…</div>}
          {error && <div role="alert" className="text-[12px] text-gypi-red">{error}</div>}
        </div>
      )}
      {recortando && <RecortarFoto fuente={foto} onCancelar={() => setRecortando(false)}
        onListo={async (imagen) => { await guardar(await subirImagen(imagen)); setRecortando(false); }} />}
    </section>
  );
}

export default function FichaArticulo({ sku, articulo: dado = null, usuario = null, empresaId = null, onClose, onFoto = null }) {
  const [articulo, setArticulo] = useState(dado);
  const [retirando, setRetirando] = useState(false);
  const [estado, setEstado] = useState(dado ? "listo" : "cargando");
  // Retirando: la pantalla de retiro maneja su propio Escape
  useEscape(onClose, !retirando);

  useEffect(() => {
    if (dado) return;
    let vivo = true;
    sb.get(`articulos_stock?sku=eq.${encodeURIComponent(sku)}&select=*&limit=1`)
      .then((rows) => {
        if (!vivo) return;
        setArticulo(rows?.[0] || null);
        setEstado(rows?.[0] ? "listo" : "no_esta");
      })
      .catch(() => { if (vivo) setEstado("error"); });
    return () => { vivo = false; };
  }, [sku, dado]);

  if (retirando) return <RetirarMaterial empresaId={empresaId} usuario={usuario} skuInicial={sku} onClose={onClose} />;

  const a = articulo;
  const u = a?.unidad || "";
  return (
    <div className="fixed inset-0 z-200 flex items-end justify-center" role="dialog" aria-label={`Artículo ${sku}`}>
      <div onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-[560px] bg-gypi-bg rounded-t-[20px] p-[20px_18px_30px] max-h-[90vh] overflow-y-auto border border-gypi-border text-gypi-text">
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="g-overline text-gypi-amber-ink">Stock · {sku}</div>
            <h3 className="m-0 font-heading text-lg font-bold">{a?.nombre || (estado === "cargando" ? "Buscando…" : "Artículo")}</h3>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="min-w-[44px] min-h-[44px] bg-transparent border-none text-2xl cursor-pointer text-gypi-text">✕</button>
        </div>

        {estado === "no_esta" && (
          <div role="alert" className="text-[14px] text-gypi-dim">No encontré ese artículo. Puede que falte sincronizar la planilla MRP o que el código no sea de un artículo.</div>
        )}
        {estado === "error" && (
          <div role="alert" className="text-[14px] text-gypi-red">No se pudo leer el stock. Probá de nuevo en un rato.</div>
        )}

        {estado === "listo" && a && (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <Semaforo texto={a.semaforo} />
              {a.activo === false && <span className="text-[12px] font-bold text-gypi-red">Ya no está en la planilla</span>}
              {[a.division, a.familia, a.tipo].filter(Boolean).map((t) => (
                <span key={t} className="text-[12px] text-gypi-dim">{t}</span>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <Dato label="Stock" valor={a.stock} unidad={u} />
              <Dato label="Disponible" valor={a.disponible} unidad={u} />
              <Dato label="Necesitan las OT" valor={a.necesidad} unidad={u} />
              <Dato label="En camino (compras)" valor={a.en_transito} unidad={u} />
            </div>
            {(a.sugerido || a.punto_pedido || a.proxima_necesidad) && (
              <div className="text-[13px] text-gypi-dim flex flex-col gap-1 mb-3">
                {a.sugerido ? <div>Comprar sugerido: <b className="text-gypi-text">{cantidadTexto(a.sugerido)} {u}</b></div> : null}
                {a.punto_pedido ? <div>Punto de pedido: {cantidadTexto(a.punto_pedido)} {u}</div> : null}
                {a.proxima_necesidad ? <div>Próxima necesidad: {a.proxima_necesidad.split("-").reverse().join("/")}</div> : null}
              </div>
            )}
            <FotoArticulo sku={sku} nombre={a.nombre} foto={a.foto_url || null} puedeEditar={veePrecios(usuario)}
              onCambio={(foto_url) => { setArticulo((x) => ({ ...x, foto_url })); onFoto?.(sku, foto_url); }} />
            {(a.marca || a.color) && <div className="text-[13px] text-gypi-dim mb-3">{[a.marca, a.color].filter(Boolean).join(" · ")}</div>}
            {veePrecios(usuario) && <PreciosArticulo sku={sku} ultimoPlanilla={a.ultimo_precio ?? null} />}
            {usuario && a.activo !== false && (
              <button onClick={() => setRetirando(true)} className="g-btn g-btn-primary w-full mb-3">📦 Retirar o devolver</button>
            )}
            <div className="text-[12px] text-gypi-dim">
              Datos de la planilla MRP{a.sincronizado_at ? `, copiados el ${new Date(a.sincronizado_at).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}` : ""}.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
