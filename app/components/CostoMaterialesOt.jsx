'use client';
// app/components/CostoMaterialesOt.jsx — 💲 Costo de materiales en el detalle
// de la OT (costo de OT, parte B; /api/costo-ot). Solo Dueño y Supervisor.
// Un renglón por artículo: cantidad necesaria (y lo retirado al lado),
// precio unitario sin IVA, fecha y origen del precio, subtotal. Sin precio,
// en rojo. Mientras falte algún precio el total es "Provisorio".
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { cantidadTexto } from "../lib/stock";
import { fmtPesos } from "../lib/costo";
import { ORIGENES_PRECIO, textoPrecio } from "../lib/preciosArticulos";
import { useToast } from "./ui/Toast";

const MAX_VISIBLES = 40;
const fechaCorta = (f) => (f ? f.split("-").reverse().join("/") : "");

export default function CostoMaterialesOt({ ot }) {
  const toast = useToast();
  const [datos, setDatos] = useState(null);
  const [verTodos, setVerTodos] = useState(false);
  const [buscando, setBuscando] = useState(null);

  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!ot) return;
    let vivo = true;
    apiFetch(`/api/costo-ot?ot=${encodeURIComponent(ot)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => { if (vivo) setDatos(d); })
      .catch(() => { if (vivo) setDatos(null); });
    return () => { vivo = false; };
  }, [ot, version]);

  const rebuscar = async (sku) => {
    setBuscando(sku);
    try {
      const res = await apiFetch("/api/costo-ot", { method: "POST", body: JSON.stringify({ accion: "rebuscar", ot, sku }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) throw new Error(d.error || "No se pudo buscar el precio");
      toast.show(d.cambio ? "✅ Precio actualizado" : "Ya tenía el precio más cercano a la fecha de la OT");
      setVersion((v) => v + 1);
    } catch (e) {
      toast.error(e.message);
    }
    setBuscando(null);
  };

  if (datos?.falta_migracion) {
    return (
      <section aria-label="Costo de materiales" className="mb-4">
        <div className="g-label mb-1">💲 Costo de materiales</div>
        <div className="text-xs text-gypi-dim">{datos.falta_migracion}</div>
      </section>
    );
  }
  if (!datos?.ok || !datos.filas?.length) return null;
  const visibles = verTodos ? datos.filas : datos.filas.slice(0, MAX_VISIBLES);

  return (
    <section aria-label="Costo de materiales" className="mb-4">
      <div className="flex items-baseline gap-2 mb-1">
        <div className="g-label flex-1">💲 Costo de materiales (solo lo ven el dueño y los supervisores)</div>
      </div>
      <div className="bg-gypi-surface rounded-xl p-3 border border-gypi-border mb-1.5">
        <div className="flex items-baseline gap-2">
          <span className="flex-1 text-[14px] font-bold">Total sin IVA</span>
          <span className="text-[18px] font-bold">{fmtPesos(datos.total)}</span>
        </div>
        <div className="text-xs mt-0.5">
          {datos.provisorio
            ? <span className="font-bold text-gypi-red">Provisorio: faltan precios de {datos.sinPrecio === 1 ? "1 artículo" : `${datos.sinPrecio} artículos`}</span>
            : <span className="font-bold text-gypi-green">Completo: todos los artículos tienen precio</span>}
        </div>
        <div className="text-xs text-gypi-dim mt-0.5">
          Cada precio es el más cercano al {datos.fecha_ot ? fechaCorta(datos.fecha_ot) : "último cargado"}{datos.fecha_ot ? " (día en que la OT entró a Gypi)" : ""} y queda fijo en la OT aunque lleguen compras nuevas.
        </div>
      </div>
      <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
        {visibles.map((f) => {
          const o = ORIGENES_PRECIO[f.origen];
          return (
            <li key={f.sku} className={`rounded-xl p-3 border ${f.sinPrecio ? "border-gypi-red bg-gypi-red/10" : "border-gypi-border bg-gypi-surface"}`}>
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className={`text-[13px] font-bold truncate ${f.sinPrecio ? "text-gypi-red" : ""}`}>{f.nombre || f.sku}</div>
                  <div className="text-xs text-gypi-dim">
                    {cantidadTexto(f.cantidad)}{f.unidad ? ` ${f.unidad}` : ""}
                    {f.sinPrecio ? "" : ` × ${textoPrecio(f.precio)}`}
                    {f.retirado ? ` · retirado ${cantidadTexto(f.retirado)}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  {f.sinPrecio
                    ? <div className="text-[13px] font-bold text-gypi-red">Sin precio</div>
                    : <div className="text-[13px] font-bold">{fmtPesos(f.subtotal)}</div>}
                </div>
              </div>
              {!f.sinPrecio && (
                <div className="text-xs text-gypi-dim mt-1">
                  {o ? `${o.icono} ${o.texto}` : f.origen} · {fechaCorta(f.fecha)}
                  {f.proveedor ? ` · ${f.proveedor}` : ""}{f.comprobante ? ` · ${f.comprobante}` : ""}
                  {f.moneda === "USD" ? ` · ${textoPrecio(f.precioMoneda, "USD")} × ${f.tipoCambio}` : ""}
                  {f.cambiadoPor ? ` · buscado de nuevo por ${f.cambiadoPor}` : ""}
                </div>
              )}
              <button onClick={() => rebuscar(f.sku)} disabled={buscando === f.sku}
                className="mt-1.5 min-h-[36px] px-2.5 rounded-lg border border-gypi-border bg-transparent text-xs font-semibold text-gypi-text cursor-pointer disabled:opacity-50">
                {buscando === f.sku ? "Buscando…" : f.sinPrecio ? "🔄 Buscar precio" : "🔄 Volver a buscar precio"}
              </button>
            </li>
          );
        })}
      </ul>
      {datos.filas.length > MAX_VISIBLES && !verTodos && (
        <button onClick={() => setVerTodos(true)} className="mt-1.5 w-full min-h-[44px] rounded-xl border border-gypi-border bg-transparent text-[13px] font-semibold text-gypi-text cursor-pointer">
          Ver los {datos.filas.length} artículos
        </button>
      )}
    </section>
  );
}
