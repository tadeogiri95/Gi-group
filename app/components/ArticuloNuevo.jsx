'use client';
// app/components/ArticuloNuevo.jsx — Formulario de artículo nuevo, para lo que
// no está en la hoja ARTICULOS de la planilla MRP (Stock, ítem 40; migración
// 124). Solo dueños y administradores. Los campos son los de ARTICULOS; las
// listas salen de la hoja TABLAS. Gypi arma el SKU provisorio y el script de
// la planilla lo anota al final de ARTICULOS en su próxima vuelta.
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { CATEGORIAS, LISTAS_SKU, nombreNormalizado, parecidos } from "../lib/articulosNuevos";
import { leerCantidadMovimiento } from "../lib/movimientosStock";

const VACIO = {
  nombre_articulo: "", division: "", familia: "", tipo: "", marca: "", color: "", unidad: "", pack: "",
  categoria: "C", stock_seguridad: "", factor_tiempo: "", proveedor_principal: "", lote_minimo: "",
};
// Listas cortas con desplegable; las largas se escriben y se eligen de las sugerencias
const DESPLEGABLES = new Set(["division", "tipo", "unidad"]);

/**
 * @param {{ articulos?: object[], nombreInicial?: string, onCreado: (articulo: object) => void, onCancelar: () => void }} props
 */
export default function ArticuloNuevo({ articulos = [], nombreInicial = "", onCreado, onCancelar }) {
  const [form, setForm] = useState(() => ({ ...VACIO, nombre_articulo: nombreInicial }));
  const [listas, setListas] = useState(undefined);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState(null);

  useEffect(() => {
    let vivo = true;
    apiFetch("/api/stock/articulos")
      .then((r) => r.json().catch(() => ({})))
      .then((d) => { if (vivo) setListas(d.listas || null); })
      .catch(() => { if (vivo) setListas(null); });
    return () => { vivo = false; };
  }, []);

  const cambiar = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));
  const similares = useMemo(() => parecidos(articulos, form.nombre_articulo), [articulos, form.nombre_articulo]);
  const completo = LISTAS_SKU.every((l) => form[l.campo].trim()) && form.nombre_articulo.trim().length >= 2;
  const vistaNombre = completo ? nombreNormalizado(form) : null;

  const guardar = async () => {
    if (!completo) { setError("Completá el nombre y todas las listas"); return; }
    const numero = (texto) => (String(texto).trim() ? leerCantidadMovimiento(texto) : null);
    const lote = numero(form.lote_minimo);
    const seguridad = String(form.stock_seguridad).trim() ? Number(String(form.stock_seguridad).replace(",", ".")) : null;
    const demora = String(form.factor_tiempo).trim() ? Number(form.factor_tiempo) : null;
    if (seguridad !== null && !(seguridad >= 0)) { setError("El stock de seguridad tiene que ser un número"); return; }
    if (demora !== null && !(Number.isInteger(demora) && demora >= 0)) { setError("La demora va en días enteros"); return; }
    if (String(form.lote_minimo).trim() && !lote) { setError("El lote mínimo tiene que ser mayor a cero"); return; }
    setEnviando(true);
    setError(null);
    try {
      const res = await apiFetch("/api/stock/articulos", {
        method: "POST",
        body: JSON.stringify({
          nombre_articulo: form.nombre_articulo.trim(),
          ...Object.fromEntries(LISTAS_SKU.map((l) => [l.campo, form[l.campo].trim()])),
          categoria: form.categoria,
          stock_seguridad: seguridad,
          factor_tiempo: demora,
          proveedor_principal: form.proveedor_principal.trim() || null,
          lote_minimo: lote,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo cargar el artículo");
      setHecho(data.articulo);
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  if (hecho) {
    return (
      <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
        <div role="status" className="text-[14px] font-semibold mb-1">✅ Artículo cargado: {hecho.nombre}</div>
        <div className="text-[13px] text-gypi-dim mb-3">Código provisorio {hecho.sku}. Ya lo podés usar. La planilla lo anota en ARTICULOS en la próxima vuelta del script (cada hora); si su fórmula le da otro código, Gypi lo cambia solo.</div>
        <button onClick={() => onCreado(hecho)} className="g-btn g-btn-primary w-full">Listo</button>
      </div>
    );
  }

  return (
    <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
      <div className="text-[15px] font-bold mb-1">➕ Artículo nuevo</div>
      <div className="text-[12px] text-gypi-dim mb-2">Para lo que no está en la hoja ARTICULOS de la planilla MRP. Los mismos campos que allá.</div>

      {listas === undefined ? (
        <div role="status" className="text-[14px] text-gypi-dim mb-2">Cargando listas…</div>
      ) : !listas ? (
        <div role="alert" className="p-2 mb-2 rounded-lg bg-gypi-red/10 text-gypi-red text-[13px]">
          Falta conectar la hoja TABLAS de la planilla: en Stock → Planilla MRP pegá su link (publicada como CSV) y tocá Sincronizar.
        </div>
      ) : (
        <>
          <label className="g-label" htmlFor="an-nombre">Nombre del artículo</label>
          <input id="an-nombre" className="g-input w-full mb-1" value={form.nombre_articulo} onChange={cambiar("nombre_articulo")} maxLength={150} placeholder="Ej: ZOCALO EPS 10CM" />
          {similares.length > 0 && (
            <div role="status" className="text-[12px] text-gypi-amber-ink mb-2">
              Ya hay parecidos: {similares.map((a) => a.nombre || a.sku).join(" · ")}. Revisá que no esté cargado.
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-2">
            {LISTAS_SKU.map((l) => (
              <div key={l.campo}>
                <label className="g-label" htmlFor={`an-${l.campo}`}>{l.nombre}</label>
                {DESPLEGABLES.has(l.campo) ? (
                  <select id={`an-${l.campo}`} className="g-input w-full mb-2" value={form[l.campo]} onChange={cambiar(l.campo)}>
                    <option value="">Elegí…</option>
                    {(listas[l.campo] || []).map((x) => <option key={x.id} value={x.nombre}>{x.nombre}</option>)}
                  </select>
                ) : (
                  <>
                    <input id={`an-${l.campo}`} list={`an-lista-${l.campo}`} className="g-input w-full mb-2" value={form[l.campo]} onChange={cambiar(l.campo)} maxLength={80} placeholder="Escribí y elegí" />
                    <datalist id={`an-lista-${l.campo}`}>
                      {(listas[l.campo] || []).map((x) => <option key={x.id} value={x.nombre} />)}
                    </datalist>
                  </>
                )}
              </div>
            ))}
            <div>
              <label className="g-label" htmlFor="an-categoria">Categoría</label>
              <select id="an-categoria" className="g-input w-full mb-2" value={form.categoria} onChange={cambiar("categoria")}>
                {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="text-[13px] font-semibold mt-1 mb-1">Opcional</div>
          <div className="grid grid-cols-2 gap-x-2">
            <div>
              <label className="g-label" htmlFor="an-proveedor">Proveedor principal</label>
              <input id="an-proveedor" className="g-input w-full mb-2" value={form.proveedor_principal} onChange={cambiar("proveedor_principal")} maxLength={120} />
            </div>
            <div>
              <label className="g-label" htmlFor="an-lote">Lote mínimo / múltiplo</label>
              <input id="an-lote" className="g-input w-full mb-2" inputMode="decimal" value={form.lote_minimo} onChange={cambiar("lote_minimo")} />
            </div>
            <div>
              <label className="g-label" htmlFor="an-seguridad">Stock de seguridad</label>
              <input id="an-seguridad" className="g-input w-full mb-2" inputMode="decimal" value={form.stock_seguridad} onChange={cambiar("stock_seguridad")} />
            </div>
            <div>
              <label className="g-label" htmlFor="an-demora">Factor tiempo (días)</label>
              <input id="an-demora" className="g-input w-full mb-2" inputMode="numeric" value={form.factor_tiempo} onChange={cambiar("factor_tiempo")} />
            </div>
          </div>

          {vistaNombre && <div className="text-[13px] mb-2">Va a quedar como: <b>{vistaNombre}</b></div>}
        </>
      )}

      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      <div className="flex gap-2">
        <button onClick={onCancelar} className="g-btn g-btn-secondary flex-1">Cancelar</button>
        <button onClick={guardar} disabled={enviando || !listas} className="g-btn g-btn-primary flex-1">{enviando ? "Guardando…" : "Cargar artículo"}</button>
      </div>
    </div>
  );
}
