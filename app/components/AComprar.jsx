'use client';
// app/components/AComprar.jsx — Planta → Compras → A comprar (Compras, parte
// 21; ítem 41). Administración ve juntos los pedidos pendientes de los jefes
// de taller y lo que la planilla MRP marca para comprar, elige el proveedor
// de cada renglón y Gypi arma una orden de compra por proveedor.
import { useCallback, useEffect, useMemo, useState } from "react";
import { sb, sbGetAll, apiFetch } from "../lib/supabase";
import { leerCantidadMovimiento } from "../lib/movimientosStock";
import { ESTADOS_OC_ABIERTA, MONEDAS, agruparPorProveedor, leerImporte, lineasAComprar } from "../lib/ordenesCompra";
import { faltaTabla } from "../lib/compras";
import { Chip } from "./ui";

const MOSTRAR = 100;
const COLUMNAS_ARTICULO = "sku,nombre,unidad,semaforo,sugerido,proxima_necesidad,activo";
const COLUMNAS_114 = ",multiplo,ultimo_precio,proveedor_principal";
export const AVISO_MIGRACION_114 = "Para las órdenes de compra falta correr la migración 114 en Supabase.";

// Filtro de la lista: todo junto, solo lo que pidió el personal o solo lo que sugiere la planilla
const FILTROS = [
  { id: "todo", texto: "Todo" },
  { id: "pedido", texto: "🛒 Pedidos del personal" },
  { id: "mrp", texto: "🔴 Según MRP" },
];

const numTexto = (n) => (n === null || n === undefined ? "" : String(n).replace(".", ","));

export default function AComprar({ empresaId, onCreadas }) {
  const [lineas, setLineas] = useState(null);
  const [proveedores, setProveedores] = useState([]);
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  const [elegidas, setElegidas] = useState(() => new Set());
  const [cambios, setCambios] = useState({});
  const [filtro, setFiltro] = useState("todo");
  const [texto, setTexto] = useState("");
  const [moneda, setMoneda] = useState("ARS");
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => {
    if (!empresaId) return;
    try {
      let articulos;
      let sin114 = false;
      try {
        ({ data: articulos } = await sbGetAll(`articulos_stock?activo=eq.true&select=${COLUMNAS_ARTICULO}${COLUMNAS_114}&order=sku.asc`, { maxFilas: 20000 }));
      } catch (e) {
        if (!/multiplo|ultimo_precio|proveedor_principal/.test(String(e?.message))) throw e;
        sin114 = true;
        ({ data: articulos } = await sbGetAll(`articulos_stock?activo=eq.true&select=${COLUMNAS_ARTICULO}&order=sku.asc`, { maxFilas: 20000 }));
      }
      const [pedidos, provs] = await Promise.all([
        sb.get("pedidos_compra?estado=eq.pendiente&order=created_at.asc&limit=1000"),
        sbGetAll("proveedores?activo=eq.true&select=id,nombre&order=nombre.asc", { maxFilas: 5000 }).then((r) => r.data || []),
      ]);
      // Lo que ya está en una OC abierta no se vuelve a sugerir; el último proveedor de cada SKU se propone
      const skusEnOc = new Set();
      const ultimoPorSku = new Map();
      if (!sin114) {
        try {
          const ordenes = (await sb.get("ordenes_compra?estado=neq.anulada&select=id,proveedor_id,estado&order=id.desc&limit=1000")) || [];
          if (ordenes.length) {
            const porId = new Map(ordenes.map((o) => [o.id, o]));
            const items = (await sb.get(`ordenes_compra_items?orden_id=in.(${ordenes.map((o) => o.id).join(",")})&sku=not.is.null&select=sku,orden_id&order=id.desc&limit=5000`)) || [];
            for (const it of items) {
              const o = porId.get(it.orden_id);
              if (!o) continue;
              if (ESTADOS_OC_ABIERTA.includes(o.estado)) skusEnOc.add(it.sku);
              if (o.proveedor_id && !ultimoPorSku.has(it.sku)) ultimoPorSku.set(it.sku, o.proveedor_id);
            }
          }
        } catch (e) {
          if (!faltaTabla(e, "ordenes_compra")) throw e;
          sin114 = true;
        }
      }
      setFaltaMigracion(sin114);
      setProveedores(provs);
      setLineas(lineasAComprar({ pedidos: pedidos || [], articulos: articulos || [], proveedores: provs, skusEnOc, ultimoPorSku }));
      setElegidas(new Set());
      setCambios({});
    } catch (e) {
      setLineas([]);
      setError(faltaTabla(e, "pedidos_compra") || faltaTabla(e, "proveedores")
        ? "Para usar Compras falta correr la migración 113 en Supabase."
        : "No se pudo armar la lista. Probá de nuevo.");
    }
  }, [empresaId]);
  useEffect(() => { cargar(); }, [cargar]);

  const conCambios = useMemo(() => (lineas || []).map((l) => ({ ...l, ...cambios[l.clave] })), [lineas, cambios]);
  const conTexto = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return conCambios.filter((l) => !t || [l.descripcion, l.sku, l.ot, l.detalle].some((v) => String(v ?? "").toLowerCase().includes(t)));
  }, [conCambios, texto]);
  const cuantos = (id) => (id === "todo" ? conTexto.length : conTexto.filter((l) => l.origen === id).length);
  const visibles = useMemo(() => conTexto.filter((l) => filtro === "todo" || l.origen === filtro), [conTexto, filtro]);
  const elegidasLista = conCambios.filter((l) => elegidas.has(l.clave));
  const grupos = agruparPorProveedor(elegidasLista);
  const nombreProveedor = (id) => proveedores.find((p) => p.id === id)?.nombre || "";

  const cambiar = (clave, campo, valor) => setCambios((c) => ({ ...c, [clave]: { ...c[clave], [campo]: valor } }));
  const tildar = (clave) => setElegidas((s) => {
    const n = new Set(s);
    if (n.has(clave)) n.delete(clave); else n.add(clave);
    return n;
  });

  const armar = async () => {
    setError(null);
    if (!elegidasLista.length) { setError("Tildá lo que querés comprar"); return; }
    const sinProveedor = elegidasLista.filter((l) => !l.proveedor_id);
    if (sinProveedor.length) { setError(`Elegí el proveedor de: ${sinProveedor.slice(0, 3).map((l) => l.descripcion).join(", ")}${sinProveedor.length > 3 ? "…" : ""}`); return; }
    const payload = [];
    for (const l of elegidasLista) {
      const cantidad = typeof l.cantidad === "number" ? l.cantidad : leerCantidadMovimiento(l.cantidad);
      if (!cantidad) { setError(`Poné la cantidad de ${l.descripcion}`); return; }
      let precio = l.precio_unitario;
      if (typeof precio === "string") {
        precio = precio.trim() ? leerImporte(precio) : null;
        if (l.precio_unitario.trim() && precio === null) { setError(`Revisá el precio de ${l.descripcion}`); return; }
      }
      payload.push({
        proveedor_id: Number(l.proveedor_id), sku: l.sku, descripcion: String(l.descripcion).slice(0, 200), unidad: l.unidad,
        cantidad, precio_unitario: precio ?? null, pedido_id: l.pedido_id, ot: l.ot,
      });
    }
    setEnviando(true);
    try {
      const res = await apiFetch("/api/compras", { method: "POST", body: JSON.stringify({ accion: "oc_crear", moneda, lineas: payload }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudieron armar las órdenes de compra");
      await cargar();
      onCreadas?.(data.ordenes || []);
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  if (lineas === null) return <div className="text-[14px] text-gypi-dim" role="status">Armando la lista…</div>;

  return (
    <div>
      {faltaMigracion && <div role="alert" className="p-3 mb-3 rounded-[10px] bg-gypi-red/10 text-gypi-red text-[14px]">{AVISO_MIGRACION_114}</div>}
      <div className="text-[13px] text-gypi-dim mb-2">
        Tildá lo que vas a comprar y elegí el proveedor. Se arma una orden de compra por proveedor, con el último precio sin IVA.
      </div>
      {!proveedores.length && (
        <div role="alert" className="text-[13px] text-gypi-red mb-2">No hay proveedores cargados. Cargalos en la pestaña Proveedores.</div>
      )}
      <div role="group" aria-label="Qué mostrar" className="flex gap-1.5 mb-2 flex-wrap">
        {FILTROS.map((f) => (
          <Chip key={f.id} type="button" aria-pressed={filtro === f.id} active={filtro === f.id} onClick={() => setFiltro(f.id)}>{f.texto} ({cuantos(f.id)})</Chip>
        ))}
      </div>
      <div className="flex gap-2 mb-2 items-center">
        <input aria-label="Buscar en A comprar" className="g-input flex-1 min-w-0" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar material u OT" />
      </div>

      {!visibles.length ? (
        <div className="text-[14px] text-gypi-dim">
          {lineas.length ? "No hay nada con ese filtro." : "No hay pedidos pendientes ni sugeridos de la planilla para comprar."}
        </div>
      ) : (
        <ul aria-label="A comprar" className="list-none m-0 p-0 flex flex-col gap-1.5 mb-3">
          {visibles.slice(0, MOSTRAR).map((l) => (
            <li key={l.clave} className={`p-2 rounded-[10px] border bg-gypi-surface ${elegidas.has(l.clave) ? "border-gypi-amber" : "border-gypi-border"}`}>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" className="mt-1 w-5 h-5" checked={elegidas.has(l.clave)} onChange={() => tildar(l.clave)} aria-label={`Comprar ${l.descripcion}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold">
                    {l.origen === "pedido" ? "🛒 " : l.nivel === "rojo" ? "🔴 " : "🟡 "}{l.descripcion}
                    {l.sku && <span className="text-gypi-dim font-normal"> · {l.sku}</span>}
                    {l.ot && <span className="text-gypi-dim font-normal"> · OT {l.ot}</span>}
                  </div>
                  {l.detalle && <div className="text-[12px] text-gypi-dim">{l.detalle}</div>}
                </div>
              </label>
              {elegidas.has(l.clave) && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  <select aria-label={`Proveedor de ${l.descripcion}`} className="g-input flex-1 min-w-[140px]" value={l.proveedor_id || ""}
                    onChange={(e) => cambiar(l.clave, "proveedor_id", e.target.value ? Number(e.target.value) : null)}>
                    <option value="">Elegí proveedor…</option>
                    {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                  <input aria-label={`Cantidad de ${l.descripcion}`} className="g-input w-[90px]" inputMode="decimal"
                    value={typeof l.cantidad === "number" ? numTexto(l.cantidad) : l.cantidad ?? ""} onChange={(e) => cambiar(l.clave, "cantidad", e.target.value)} />
                  <input aria-label={`Precio sin IVA de ${l.descripcion}`} className="g-input w-[110px]" inputMode="decimal" placeholder="Precio s/IVA"
                    value={typeof l.precio_unitario === "number" ? numTexto(l.precio_unitario) : l.precio_unitario ?? ""} onChange={(e) => cambiar(l.clave, "precio_unitario", e.target.value)} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {visibles.length > MOSTRAR && <div className="text-[12px] text-gypi-dim mb-3">Mostrando {MOSTRAR} de {visibles.length}. Buscá para ver el resto.</div>}

      {elegidas.size > 0 && (
        <div className="sticky bottom-0 p-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
          <div className="text-[13px] mb-2">
            {elegidas.size} {elegidas.size === 1 ? "renglón" : "renglones"}
            {grupos.length ? ` · ${grupos.length} ${grupos.length === 1 ? "orden" : "órdenes"} de compra: ${grupos.map((g) => nombreProveedor(g.proveedor_id)).join(", ")}` : ""}
          </div>
          <div className="flex gap-2 items-center">
            <select aria-label="Moneda" className="g-input w-auto" value={moneda} onChange={(e) => setMoneda(e.target.value)}>
              {Object.values(MONEDAS).map((m) => <option key={m.id} value={m.id}>{m.id === "ARS" ? "Pesos" : "Dólares"}</option>)}
            </select>
            <button onClick={armar} disabled={enviando} className="g-btn g-btn-primary flex-1">{enviando ? "Armando…" : "Armar órdenes de compra"}</button>
          </div>
        </div>
      )}
      {error && <div role="alert" className="text-[13px] text-gypi-red mt-2">{error}</div>}
    </div>
  );
}
