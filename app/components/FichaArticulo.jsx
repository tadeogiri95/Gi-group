'use client';
// app/components/FichaArticulo.jsx — Ficha de un artículo del stock (Stock,
// parte 13; ítem 40). Se abre desde la lista de Stock o escaneando el QR de
// la etiqueta (?articulo=SKU), para cualquiera de la empresa. Los números son
// los que calculó la planilla MRP en la última sincronización.
import { useEffect, useState } from "react";
import { sb } from "../lib/supabase";
import { cantidadTexto, nivelSemaforo } from "../lib/stock";

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

export default function FichaArticulo({ sku, articulo: dado = null, onClose }) {
  const [articulo, setArticulo] = useState(dado);
  const [estado, setEstado] = useState(dado ? "listo" : "cargando");

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
            {(a.marca || a.color) && <div className="text-[13px] text-gypi-dim mb-3">{[a.marca, a.color].filter(Boolean).join(" · ")}</div>}
            <div className="text-[12px] text-gypi-dim">
              Datos de la planilla MRP{a.sincronizado_at ? `, copiados el ${new Date(a.sincronizado_at).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}` : ""}.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
