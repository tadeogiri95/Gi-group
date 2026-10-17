'use client';
// app/components/ComprasScreen.jsx — Planta → Compras (Compras, parte 20;
// ítem 41). Los jefes de taller, gerencia, dueños y Administración piden
// material (🛒 Pedir material) y ven en qué quedó cada pedido. Administración
// (sin división asignada) y gerencia ven todos los pedidos y manejan los
// proveedores; con eso arman las órdenes de compra en la parte 21.
import { useCallback, useEffect, useMemo, useState } from "react";
import { sb, sbGetAll, apiFetch } from "../lib/supabase";
import { filtrarArticulos } from "../lib/stock";
import { leerCantidadMovimiento } from "../lib/movimientosStock";
import { ESTADOS_PEDIDO, filtrarPedidos, puedeAnularPedido, textoPedido } from "../lib/compras";
import ProveedoresCompras from "./ProveedoresCompras";

const CUANTOS = 300;
const VACIO = { texto: "", articulo: null, descripcion: "", unidad: "", cantidad: "", ot: "", para_fecha: "", notas: "" };
export const AVISO_MIGRACION_113 = "Para usar Compras falta correr la migración 113 en Supabase.";

function fecha(iso) {
  if (!iso) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

function PedirMaterial({ articulos, ots, onListo, onCancelar }) {
  const [form, setForm] = useState({ ...VACIO });
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState(null);
  const cambiar = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));
  const sugeridos = useMemo(
    () => (!form.articulo && form.texto.trim() ? filtrarArticulos(articulos, { texto: form.texto }).slice(0, 8) : []),
    [form.articulo, form.texto, articulos]
  );

  const guardar = async () => {
    const cantidad = leerCantidadMovimiento(form.cantidad);
    const descripcion = form.articulo ? null : form.texto.trim();
    if (!form.articulo && !descripcion) { setError("Elegí el artículo o escribí qué necesitás"); return; }
    if (!cantidad) { setError("Poné una cantidad mayor a cero"); return; }
    setEnviando(true);
    setError(null);
    try {
      const res = await apiFetch("/api/compras", {
        method: "POST",
        body: JSON.stringify({
          accion: "pedido_crear",
          sku: form.articulo?.sku || null,
          descripcion,
          unidad: form.articulo ? null : form.unidad.trim() || null,
          cantidad,
          ot: form.ot.trim() || null,
          para_fecha: form.para_fecha || null,
          notas: form.notas.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo guardar el pedido");
      setHecho(data.pedido);
      onListo();
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  if (hecho) {
    return (
      <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
        <div role="status" className="text-[14px] font-semibold mb-3">✅ Pedido cargado: {textoPedido(hecho)}. Administración lo ve en Compras.</div>
        <div className="flex gap-2">
          <button onClick={onCancelar} className="g-btn g-btn-secondary flex-1">Listo</button>
          <button onClick={() => { setHecho(null); setForm({ ...VACIO, ot: form.ot, para_fecha: form.para_fecha }); }} className="g-btn g-btn-primary flex-1">Pedir otro</button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
      <div className="text-[15px] font-bold mb-2">🛒 Pedir material</div>
      <label className="g-label" htmlFor="ped-articulo">Material</label>
      {form.articulo ? (
        <div className="flex items-center gap-2 mb-2">
          <div className="flex-1 min-w-0 text-[14px] font-semibold truncate">{form.articulo.nombre || form.articulo.sku} <span className="text-gypi-dim font-normal">· {form.articulo.sku}</span></div>
          <button onClick={() => setForm((f) => ({ ...f, articulo: null }))} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-amber-ink cursor-pointer">Cambiar</button>
        </div>
      ) : (
        <>
          <input id="ped-articulo" className="g-input w-full mb-1" value={form.texto} onChange={cambiar("texto")} maxLength={200} placeholder="Buscá por nombre o código, o escribilo si no está" />
          {sugeridos.length > 0 && (
            <ul aria-label="Artículos encontrados" className="list-none p-0 m-0 mb-2 flex flex-col gap-1">
              {sugeridos.map((a) => (
                <li key={a.sku}>
                  <button onClick={() => setForm((f) => ({ ...f, articulo: a }))} className="w-full min-h-[44px] text-left bg-gypi-bg rounded-lg px-2 border border-gypi-border cursor-pointer font-body text-gypi-text text-[13px]">
                    <b>{a.nombre || a.sku}</b> <span className="text-gypi-dim">· {a.sku}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {form.texto.trim() && (
            <div className="text-[12px] text-gypi-dim mb-2">Si no está en la lista, se pide así como lo escribiste.</div>
          )}
        </>
      )}

      <div className="flex gap-2">
        <div className="flex-1">
          <label className="g-label" htmlFor="ped-cantidad">Cantidad{form.articulo?.unidad ? ` (${form.articulo.unidad})` : ""}</label>
          <input id="ped-cantidad" className="g-input w-full mb-2" inputMode="decimal" value={form.cantidad} onChange={cambiar("cantidad")} placeholder="Ej: 10" />
        </div>
        {!form.articulo && (
          <div className="flex-1">
            <label className="g-label" htmlFor="ped-unidad">Unidad</label>
            <input id="ped-unidad" className="g-input w-full mb-2" value={form.unidad} onChange={cambiar("unidad")} maxLength={20} placeholder="Ej: placas, kg, u" />
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <div className="flex-1">
          <label className="g-label" htmlFor="ped-ot">OT (opcional)</label>
          <input id="ped-ot" className="g-input w-full mb-2" list="ped-ots" value={form.ot} onChange={cambiar("ot")} maxLength={40} placeholder="Ej: M-7495" />
          <datalist id="ped-ots">{ots.map((o) => <option key={o} value={o} />)}</datalist>
        </div>
        <div className="flex-1">
          <label className="g-label" htmlFor="ped-fecha">Para cuándo</label>
          <input id="ped-fecha" type="date" className="g-input w-full mb-2" value={form.para_fecha} onChange={cambiar("para_fecha")} />
        </div>
      </div>

      <label className="g-label" htmlFor="ped-notas">Notas (opcional)</label>
      <input id="ped-notas" className="g-input w-full mb-3" value={form.notas} onChange={cambiar("notas")} maxLength={300} placeholder="Medida, color, marca…" />

      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      <div className="flex gap-2">
        <button onClick={onCancelar} className="g-btn g-btn-secondary flex-1">Cancelar</button>
        <button onClick={guardar} disabled={enviando} className="g-btn g-btn-primary flex-1">{enviando ? "Guardando…" : "Pedir"}</button>
      </div>
    </div>
  );
}

export default function ComprasScreen({ empresaId, usuario = null }) {
  const [permisos, setPermisos] = useState(null);
  const [vista, setVista] = useState("pedidos");
  const [pedidos, setPedidos] = useState(null);
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  const [articulos, setArticulos] = useState([]);
  const [ots, setOts] = useState([]);
  const [pidiendo, setPidiendo] = useState(false);
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState("pendiente");
  const [error, setError] = useState(null);
  const comprador = Boolean(permisos?.comprador);

  useEffect(() => {
    let vivo = true;
    apiFetch("/api/compras")
      .then((r) => r.json().catch(() => ({})))
      .then((d) => { if (vivo) setPermisos({ comprador: Boolean(d.comprador), puede_pedir: Boolean(d.puede_pedir) }); })
      .catch(() => { if (vivo) setPermisos({ comprador: false, puede_pedir: false }); });
    return () => { vivo = false; };
  }, []);

  const cargar = useCallback(async () => {
    if (!empresaId || !permisos) return;
    const soloMios = !permisos.comprador && usuario?.id ? `&empleado_id=eq.${usuario.id}` : "";
    try {
      const rows = await sb.get(`pedidos_compra?order=created_at.desc,id.desc&limit=${CUANTOS}${soloMios}`);
      setPedidos(rows || []);
      setFaltaMigracion(false);
    } catch (e) {
      setPedidos([]);
      if (String(e?.message).includes("pedidos_compra")) setFaltaMigracion(true);
    }
  }, [empresaId, permisos, usuario?.id]);
  useEffect(() => { cargar(); }, [cargar]);

  // Catálogo y OT para el formulario, solo cuando se abre
  useEffect(() => {
    if (!pidiendo || articulos.length) return;
    sbGetAll("articulos_stock?activo=eq.true&select=sku,nombre,unidad,division&order=sku.asc", { maxFilas: 20000 })
      .then(({ data }) => setArticulos(data || []))
      .catch(() => {});
    sb.get("proyectos?select=ot&estado=eq.activo&order=id.desc&limit=300")
      .then((rows) => setOts([...new Set((rows || []).map((p) => p.ot).filter(Boolean))]))
      .catch(() => {});
  }, [pidiendo, articulos.length]);

  const visibles = useMemo(() => filtrarPedidos(pedidos, { texto, estado }), [pedidos, texto, estado]);

  const anular = async (p) => {
    setError(null);
    try {
      const res = await apiFetch("/api/compras", { method: "POST", body: JSON.stringify({ accion: "pedido_anular", id: p.id }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo anular");
      await cargar();
    } catch (e) {
      setError(e.message);
    }
  };

  if (!permisos) return <div className="p-[18px] text-[14px] text-gypi-dim" role="status">Cargando…</div>;

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      {comprador && (
        <div role="tablist" aria-label="Compras" className="flex gap-1.5 mb-3">
          {[["pedidos", "🛒 Pedidos"], ["proveedores", "🏭 Proveedores"]].map(([id, label]) => (
            <button key={id} role="tab" aria-selected={vista === id} onClick={() => setVista(id)}
              className={`min-h-[44px] px-3 rounded-lg border text-[13px] font-bold cursor-pointer ${vista === id ? "bg-gypi-amber/15 border-gypi-amber text-gypi-amber-ink" : "bg-gypi-bg border-gypi-border text-gypi-dim"}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {faltaMigracion && (
        <div role="alert" className="p-3 mb-3 rounded-[10px] bg-gypi-red/10 text-gypi-red text-[14px]">{AVISO_MIGRACION_113}</div>
      )}

      {vista === "proveedores" && comprador ? (
        <ProveedoresCompras empresaId={empresaId} />
      ) : (
        <>
          {permisos.puede_pedir && (pidiendo ? (
            <PedirMaterial articulos={articulos} ots={ots} onListo={cargar} onCancelar={() => setPidiendo(false)} />
          ) : (
            <button onClick={() => { setPidiendo(true); setError(null); }} className="g-btn g-btn-primary w-full mb-3">🛒 Pedir material</button>
          ))}

          <div className="flex gap-2 mb-2">
            <input aria-label="Buscar pedidos" className="g-input flex-1 min-w-0" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar material, OT o quién pidió" />
            <select aria-label="Estado" className="g-input w-auto" value={estado} onChange={(e) => setEstado(e.target.value)}>
              <option value="">Todos</option>
              {Object.values(ESTADOS_PEDIDO).map((s) => <option key={s.id} value={s.id}>{s.icono} {s.nombre}</option>)}
            </select>
          </div>
          {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}

          {pedidos === null ? (
            <div className="text-[14px] text-gypi-dim" role="status">Cargando pedidos…</div>
          ) : !visibles.length ? (
            <div className="text-[14px] text-gypi-dim">
              {pedidos.length ? "No hay pedidos con ese filtro." : comprador ? "Todavía no hay pedidos de material." : "Todavía no hiciste pedidos de material."}
            </div>
          ) : (
            <ul aria-label="Pedidos de material" className="list-none m-0 p-0 flex flex-col gap-1.5">
              {visibles.map((p) => {
                const est = ESTADOS_PEDIDO[p.estado] || ESTADOS_PEDIDO.pendiente;
                return (
                  <li key={p.id} className={`flex items-center gap-2 p-2 rounded-[10px] border border-gypi-border bg-gypi-surface ${p.estado === "anulado" ? "opacity-60" : ""}`}>
                    <div className="flex-1 min-w-0">
                      <div className={`text-[14px] font-semibold truncate ${p.estado === "anulado" ? "line-through" : ""}`}>{textoPedido(p)}</div>
                      <div className="text-[12px] text-gypi-dim truncate">
                        {est.icono} {est.nombre} · {p.empleado_nombre || "—"} · {fecha(p.created_at)}
                        {p.para_fecha ? ` · Para el ${fecha(p.para_fecha)}` : ""}
                        {p.notas ? ` · ${p.notas}` : ""}
                      </div>
                    </div>
                    {puedeAnularPedido(p, { comprador, empleadoId: usuario?.id }) && (
                      <button onClick={() => anular(p)} aria-label={`Anular pedido de ${textoPedido(p)}`}
                        className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-red cursor-pointer">Anular</button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
