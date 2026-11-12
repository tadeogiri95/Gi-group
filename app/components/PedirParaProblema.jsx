'use client';
// app/components/PedirParaProblema.jsx — "🛒 Pedir material" desde un
// pendiente de obra, una falla de máquina o un arreglo de vehículo (auditoría
// del 12/11, parte 8; migración 185). Se elige el artículo del stock o se
// escribe; el pedido va a Compras → A comprar con para qué es, y acá se ve en
// qué está. Lo piden los que pueden pedir material (no los operarios).
import { useContext, useEffect, useMemo, useState } from "react";
import { AuthContext } from "../context/AuthContext";
import { puedePedir } from "../lib/compras";
import { apiFetch, sbGetAll } from "../lib/supabase";
import { sugerirArticulos } from "../lib/stock";
import { notaDelProblema, textoPedidosProblema } from "../lib/pedidoProblema";

let articulosCache = null;
async function articulos() {
  if (!articulosCache) {
    articulosCache = sbGetAll("articulos_stock?activo=eq.true&order=nombre.asc&select=sku,nombre,unidad,division", { maxFilas: 20000 })
      .then((r) => r.data || [])
      .catch(() => { articulosCache = null; return []; });
  }
  return articulosCache;
}

/**
 * @param {{ origen: string, origenId: number, texto: string, ot?: string|null, pedidos?: object[], onPedido?: (p: object) => void }} props
 */
export default function PedirParaProblema(props) {
  const rol = useContext(AuthContext)?.usuario?.rol;
  if (!puedePedir(rol)) return null;
  return <Pedir {...props} />;
}

function Pedir({ origen, origenId, texto, ot = null, onPedido }) {
  const [pedidos, setPedidos] = useState([]);
  const [abierto, setAbierto] = useState(false);
  const [lista, setLista] = useState([]);
  const [busca, setBusca] = useState("");
  const [art, setArt] = useState(null);
  const [cantidad, setCantidad] = useState("");
  const [unidad, setUnidad] = useState("");
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [hechos, setHechos] = useState([]);

  // Los pedidos que ya salieron de este problema (sin la 185, ninguno)
  useEffect(() => {
    let vivo = true;
    sbGetAll(`pedidos_compra?origen=eq.${origen}&origen_id=eq.${Number(origenId)}&select=id,descripcion,estado&order=id.asc`, { maxFilas: 50 })
      .then((r) => { if (vivo) setPedidos(r.data || []); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [origen, origenId]);
  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    articulos().then((a) => { if (vivo) setLista(a); });
    return () => { vivo = false; };
  }, [abierto]);
  const sugeridos = useMemo(() => (art ? { lista: [], resto: 0 } : sugerirArticulos(lista, busca, 6)), [lista, busca, art]);
  const todos = [...pedidos, ...hechos];
  const resumen = textoPedidosProblema(todos);

  const pedir = async () => {
    const cant = Number(String(cantidad).replace(",", "."));
    if (!art && !busca.trim()) { setError("Elegí el artículo o escribí qué hace falta"); return; }
    if (!(cant > 0)) { setError("Poné la cantidad"); return; }
    setEnviando(true);
    setError(null);
    try {
      const res = await apiFetch("/api/compras", {
        method: "POST",
        body: JSON.stringify({
          accion: "pedido_crear", sku: art?.sku || null, descripcion: art ? null : busca.trim().slice(0, 200), cantidad: Math.round(cant * 1000) / 1000,
          ...(!art && unidad.trim() ? { unidad: unidad.trim().slice(0, 20) } : {}),
          ot: ot || null, notas: notaDelProblema(origen, texto), origen, origen_id: origenId,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || "No se pudo pedir");
      const p = d.pedido || { descripcion: art?.nombre || busca.trim(), estado: "pendiente" };
      setHechos((h) => [...h, p]);
      onPedido?.(p);
      setAbierto(false);
      setArt(null);
      setBusca("");
      setCantidad("");
      setUnidad("");
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  if (!abierto) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => { setAbierto(true); setError(null); }} className="g-btn g-btn-secondary">🛒 Pedir material</button>
        {resumen && <span className="text-[12px] text-gypi-dim" role="status">{resumen}</span>}
      </div>
    );
  }
  return (
    <div className="w-full p-2.5 rounded-[10px] border border-gypi-border bg-gypi-bg" aria-label="Pedir material para este problema">
      <div className="text-[13px] font-semibold mb-1">🛒 Pedir material{ot ? ` para la OT ${ot}` : ""}</div>
      {art ? (
        <div className="flex items-center gap-2 mb-2 text-[13px]">
          <span className="flex-1 min-w-0 font-semibold">{art.nombre} <span className="text-gypi-dim font-normal">({art.sku})</span></span>
          <button type="button" onClick={() => setArt(null)} className="g-btn g-btn-secondary">Cambiar</button>
        </div>
      ) : (
        <>
          <label className="g-label" htmlFor={`pp-busca-${origen}-${origenId}`}>Artículo del stock o qué hace falta</label>
          <input id={`pp-busca-${origen}-${origenId}`} className="g-input w-full mb-1" maxLength={200} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Ej: correa, bisagra, aceite" autoComplete="off" />
          {sugeridos.lista.length > 0 && (
            <ul aria-label="Artículos del stock" className="list-none m-0 p-0 mb-2 flex flex-col gap-1">
              {sugeridos.lista.map((a) => (
                <li key={a.sku}>
                  <button type="button" onClick={() => setArt(a)} className="w-full min-h-[40px] text-left bg-gypi-surface border border-gypi-border rounded-lg px-2 text-[13px] cursor-pointer font-body text-gypi-text">
                    {a.nombre} <span className="text-gypi-dim">· {a.sku}{a.unidad ? ` · ${a.unidad}` : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="flex gap-2 mb-2">
        <div className="flex-1">
          <label className="g-label" htmlFor={`pp-cant-${origen}-${origenId}`}>Cantidad{art?.unidad ? ` (${art.unidad})` : ""}</label>
          <input id={`pp-cant-${origen}-${origenId}`} className="g-input w-full" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
        </div>
        {!art && (
          <div className="flex-1">
            <label className="g-label" htmlFor={`pp-uni-${origen}-${origenId}`}>Unidad</label>
            <input id={`pp-uni-${origen}-${origenId}`} className="g-input w-full" maxLength={20} value={unidad} onChange={(e) => setUnidad(e.target.value)} placeholder="Ej: unidades, litros" />
          </div>
        )}
      </div>
      <div className="text-[12px] text-gypi-dim mb-2">Va a Compras → A comprar con la nota: “{notaDelProblema(origen, texto)}”.</div>
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      <div className="flex gap-2">
        <button type="button" onClick={() => setAbierto(false)} className="g-btn g-btn-secondary flex-1">Cancelar</button>
        <button type="button" onClick={pedir} disabled={enviando} className="g-btn g-btn-primary flex-1">{enviando ? "Pidiendo…" : "Pedir"}</button>
      </div>
    </div>
  );
}
