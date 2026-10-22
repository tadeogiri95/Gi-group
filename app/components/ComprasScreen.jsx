'use client';
// app/components/ComprasScreen.jsx — Planta → Compras (Compras, parte 20;
// ítem 41). Los jefes de taller, gerencia, dueños y Administración piden
// material (🛒 Pedir material) y ven en qué quedó cada pedido. Administración
// (sin división asignada) y gerencia ven todos los pedidos y manejan los
// proveedores; con eso arman las órdenes de compra (parte 21). Lo que llega
// lo reciben los jefes o Administración en Recibir (parte 22). Quien compra
// tiene además Reportes (parte 23). Un pedido pendiente se corrige con
// "Editar" y queda registro de quién lo corrigió (121). Desde la compu se
// piden varios materiales de una vez pegando renglones de la hoja INVENTARIO
// (📋 Pegar desde la planilla).
import { useCallback, useEffect, useMemo, useState } from "react";
import { sb, sbGetAll, apiFetch } from "../lib/supabase";
import { sugerirArticulos } from "../lib/stock";
import { leerCantidadMovimiento } from "../lib/movimientosStock";
import { leerPedidoPegado, MAX_PEGADO } from "../lib/pedidoPegado";
import { ESTADOS_PEDIDO, faltaTabla, filtrarPedidos, puedeAnularPedido, puedeEditarPedido, textoCambio, textoPedido } from "../lib/compras";
import ProveedoresCompras from "./ProveedoresCompras";
import AComprar from "./AComprar";
import OrdenesCompra from "./OrdenesCompra";
import RecibirCompra from "./RecibirCompra";
import ReportesCompras from "./ReportesCompras";

const CUANTOS = 300;
const VACIO = { texto: "", articulo: null, descripcion: "", unidad: "", cantidad: "", ot: "", para_fecha: "", notas: "" };
// Los jefes de taller piden y reciben; el comprador además arma las OC y maneja proveedores
const PESTANAS_JEFE = [["pedidos", "🛒 Pedidos"], ["recibir", "📦 Recibir"]];
const PESTANAS_COMPRADOR = [["pedidos", "🛒 Pedidos"], ["acomprar", "🧾 A comprar"], ["ordenes", "📄 Órdenes"], ["recibir", "📦 Recibir"], ["proveedores", "🏭 Proveedores"], ["reportes", "📊 Reportes"]];
export const AVISO_MIGRACION_113 = "Para usar Compras falta correr la migración 113 en Supabase.";

function fecha(iso) {
  if (!iso) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

function fechaHora(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const numTexto = (n) => (n === null || n === undefined ? "" : String(Number(n)).replace(".", ","));

/** El formulario con los datos de un pedido guardado, para corregirlo. */
function formDePedido(p, articulos) {
  const articulo = p.sku ? articulos.find((a) => a.sku === p.sku) || { sku: p.sku, nombre: p.descripcion, unidad: p.unidad } : null;
  return {
    texto: articulo ? "" : p.descripcion || "",
    articulo,
    descripcion: "",
    unidad: articulo ? "" : p.unidad || "",
    cantidad: numTexto(p.cantidad),
    ot: p.ot || "",
    para_fecha: p.para_fecha || "",
    notas: p.notas || "",
  };
}

/** Pedir material o, con `pedido`, corregir uno pendiente. */
function PedirMaterial({ articulos, ots, onListo, onCancelar, pedido = null, onCorregido }) {
  const [form, setForm] = useState(() => (pedido ? formDePedido(pedido, articulos) : { ...VACIO }));
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState(null);
  const cambiar = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));
  const sugeridos = useMemo(
    () => (!form.articulo && form.texto.trim() ? sugerirArticulos(articulos, form.texto) : { lista: [], resto: 0 }),
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
          accion: pedido ? "pedido_editar" : "pedido_crear",
          ...(pedido ? { id: pedido.id } : {}),
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
      if (pedido) {
        onCorregido?.(data);
        return;
      }
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
      <div className="text-[15px] font-bold mb-2">{pedido ? "✏️ Corregir pedido" : "🛒 Pedir material"}</div>
      <label className="g-label" htmlFor="ped-articulo">Material</label>
      {form.articulo ? (
        <div className="flex items-center gap-2 mb-2">
          <div className="flex-1 min-w-0 text-[14px] font-semibold truncate">{form.articulo.nombre || form.articulo.sku} <span className="text-gypi-dim font-normal">· {form.articulo.sku}</span></div>
          <button onClick={() => setForm((f) => ({ ...f, articulo: null }))} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-amber-ink cursor-pointer">Cambiar</button>
        </div>
      ) : (
        <>
          <input id="ped-articulo" className="g-input w-full mb-1" value={form.texto} onChange={cambiar("texto")} maxLength={200} placeholder="Buscá por nombre o código, o escribilo si no está" />
          {sugeridos.lista.length > 0 && (
            <ul aria-label="Artículos encontrados" className="list-none p-0 m-0 mb-2 flex flex-col gap-1">
              {sugeridos.lista.map((a) => (
                <li key={a.sku}>
                  <button onClick={() => setForm((f) => ({ ...f, articulo: a }))} className="w-full min-h-[44px] text-left bg-gypi-bg rounded-lg px-2 border border-gypi-border cursor-pointer font-body text-gypi-text text-[13px]">
                    <b>{a.nombre || a.sku}</b> <span className="text-gypi-dim">· {a.sku}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {sugeridos.resto > 0 && (
            <div role="status" className="text-[12px] text-gypi-dim mb-2">Hay {sugeridos.resto} más. Escribí otra palabra del nombre o el código para encontrarlo.</div>
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

      <label className="g-label" htmlFor="ped-notas">Observación para el proveedor (opcional)</label>
      <input id="ped-notas" className="g-input w-full mb-3" value={form.notas} onChange={cambiar("notas")} maxLength={300} placeholder="Medida, color, marca…" />

      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      <div className="flex gap-2">
        <button onClick={onCancelar} className="g-btn g-btn-secondary flex-1">Cancelar</button>
        <button onClick={guardar} disabled={enviando} className="g-btn g-btn-primary flex-1">{enviando ? "Guardando…" : pedido ? "Guardar corrección" : "Pedir"}</button>
      </div>
    </div>
  );
}

/** Varios pedidos de una vez, pegando renglones de la hoja INVENTARIO. */
function PegarPedido({ articulos, ots, onListo, onCancelar }) {
  const [pegado, setPegado] = useState("");
  const [lista, setLista] = useState(null);
  const [leido, setLeido] = useState(null);
  const [comun, setComun] = useState({ ot: "", para_fecha: "", notas: "" });
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState(null);
  const cambiar = (campo) => (e) => setComun((c) => ({ ...c, [campo]: e.target.value }));

  const leer = () => {
    setError(null);
    if (!articulos.length) { setError("Todavía se están cargando los artículos. Probá de nuevo en un momento."); return; }
    const r = leerPedidoPegado(pegado, articulos);
    if (!r.reconocidos.length && !r.noEncontrados.length && !r.sinCantidad.length) { setError("No encontré renglones. Copiá desde la planilla, con la fila de títulos."); return; }
    setLeido(r);
    setLista(r.reconocidos.map((a) => ({ ...a, texto: String(a.cantidad).replace(".", ",") })));
  };

  const listos = (lista || []).map((a) => ({ ...a, cantidad: leerCantidadMovimiento(a.texto) }));
  const malCantidad = listos.filter((a) => !a.cantidad);

  const pedir = async () => {
    if (!listos.length) { setError("No queda ningún material para pedir"); return; }
    if (malCantidad.length) { setError(`Revisá la cantidad de ${malCantidad[0].nombre}`); return; }
    setEnviando(true);
    setError(null);
    try {
      const res = await apiFetch("/api/compras", {
        method: "POST",
        body: JSON.stringify({
          accion: "pedidos_crear",
          items: listos.map((a) => ({ sku: a.sku, cantidad: a.cantidad })),
          ot: comun.ot.trim() || null,
          para_fecha: comun.para_fecha || null,
          notas: comun.notas.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudieron guardar los pedidos");
      setHecho(data.creados || listos.length);
      onListo();
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  if (hecho) {
    return (
      <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
        <div role="status" className="text-[14px] font-semibold mb-3">✅ {hecho === 1 ? "Cargué 1 pedido" : `Cargué ${hecho} pedidos`}. Administración los ve en Compras.</div>
        <button onClick={onCancelar} className="g-btn g-btn-secondary w-full">Listo</button>
      </div>
    );
  }

  return (
    <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
      <div className="text-[15px] font-bold mb-2">📋 Pegar desde la planilla</div>
      {!lista ? (
        <>
          <div className="text-[13px] text-gypi-dim mb-2">
            En la hoja INVENTARIO seleccioná los renglones a comprar (desde la columna SKU hasta CANTIDAD SUGERIDA, mejor con la fila de títulos), copialos y pegalos acá.
            También sirven dos columnas: código o nombre, y cantidad.
          </div>
          <label className="g-label" htmlFor="pegar-pedido">Renglones copiados</label>
          <textarea id="pegar-pedido" className="g-input w-full min-h-[110px] font-mono text-[12px] mb-2" value={pegado} onChange={(e) => setPegado(e.target.value)}
            placeholder="Pegá acá lo copiado de la planilla" />
          {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
          <div className="flex gap-2">
            <button onClick={onCancelar} className="g-btn g-btn-secondary flex-1">Cancelar</button>
            <button onClick={leer} disabled={!pegado.trim()} className="g-btn g-btn-primary flex-1">Ver qué se pide</button>
          </div>
        </>
      ) : (
        <>
          {leido.demasiados && <div role="status" className="text-[13px] text-gypi-amber-ink mb-2">Leí los primeros {MAX_PEGADO} renglones. El resto pegalo en otra tanda.</div>}
          <div className="text-[13px] font-bold mb-1">✅ Se piden ({listos.length})</div>
          {!listos.length ? (
            <div className="text-[13px] text-gypi-dim mb-2">Ningún artículo reconocido con cantidad.</div>
          ) : (
            <ul aria-label="Materiales a pedir" className="list-none p-0 m-0 mb-2 flex flex-col gap-1">
              {lista.map((a, i) => (
                <li key={a.sku} className="flex items-center gap-2 bg-gypi-bg rounded-lg px-2 border border-gypi-border">
                  <div className="flex-1 min-w-0 text-[13px] py-1">
                    <div className="font-semibold truncate">{a.nombre}</div>
                    <div className="text-gypi-dim truncate">{a.sku}</div>
                  </div>
                  <input aria-label={`Cantidad de ${a.nombre}`} className="g-input w-[90px] text-right" inputMode="decimal" value={a.texto}
                    onChange={(e) => setLista((l) => l.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)))} />
                  <span className="text-[12px] text-gypi-dim w-[44px] truncate">{a.unidad || ""}</span>
                  <button onClick={() => setLista((l) => l.filter((_, j) => j !== i))} aria-label={`Quitar ${a.nombre}`}
                    className="min-h-[44px] px-1 bg-transparent border-none text-[13px] font-semibold text-gypi-red cursor-pointer">Quitar</button>
                </li>
              ))}
            </ul>
          )}
          {leido.noEncontrados.length > 0 && (
            <div className="mb-2">
              <div className="text-[13px] font-bold">⚠️ No los encontré en el stock ({leido.noEncontrados.length}), no se piden</div>
              <ul aria-label="No encontrados" className="list-disc pl-5 m-0 text-[12px] text-gypi-dim">
                {leido.noEncontrados.slice(0, 20).map((x, i) => <li key={i}>{x.texto}</li>)}
              </ul>
              {leido.noEncontrados.length > 20 && <div className="text-[12px] text-gypi-dim">Y {leido.noEncontrados.length - 20} más.</div>}
              <div className="text-[12px] text-gypi-dim">Si son artículos nuevos, sincronizá el stock (Planta → Stock) o pedilos de a uno escribiéndolos.</div>
            </div>
          )}
          {leido.sinCantidad.length > 0 && (
            <div className="text-[12px] text-gypi-dim mb-2">Sin cantidad, se saltean ({leido.sinCantidad.length}): {leido.sinCantidad.slice(0, 5).map((x) => x.texto).join(", ")}{leido.sinCantidad.length > 5 ? "…" : ""}</div>
          )}

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="g-label" htmlFor="pegar-ot">OT (opcional)</label>
              <input id="pegar-ot" className="g-input w-full mb-2" list="pegar-ots" value={comun.ot} onChange={cambiar("ot")} maxLength={40} placeholder="Ej: M-7495" />
              <datalist id="pegar-ots">{ots.map((o) => <option key={o} value={o} />)}</datalist>
            </div>
            <div className="flex-1">
              <label className="g-label" htmlFor="pegar-fecha">Para cuándo</label>
              <input id="pegar-fecha" type="date" className="g-input w-full mb-2" value={comun.para_fecha} onChange={cambiar("para_fecha")} />
            </div>
          </div>
          <label className="g-label" htmlFor="pegar-notas">Observación para el proveedor (opcional, para todos)</label>
          <input id="pegar-notas" className="g-input w-full mb-3" value={comun.notas} onChange={cambiar("notas")} maxLength={300} placeholder="Medida, color, marca…" />

          {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
          <div className="flex gap-2">
            <button onClick={() => { setLista(null); setLeido(null); setError(null); }} className="g-btn g-btn-secondary flex-1">Volver a pegar</button>
            <button onClick={pedir} disabled={enviando || !listos.length} className="g-btn g-btn-primary flex-1">
              {enviando ? "Guardando…" : listos.length === 1 ? "Pedir 1 material" : `Pedir ${listos.length} materiales`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function ComprasScreen({ empresaId, empresa = null, usuario = null }) {
  const [permisos, setPermisos] = useState(null);
  const [vista, setVista] = useState("pedidos");
  const [ordenNueva, setOrdenNueva] = useState(null);
  const [creadas, setCreadas] = useState(null);
  const [pedidos, setPedidos] = useState(null);
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  const [articulos, setArticulos] = useState([]);
  const [ots, setOts] = useState([]);
  const [pidiendo, setPidiendo] = useState(false);
  const [pegando, setPegando] = useState(false);
  const [editando, setEditando] = useState(null);
  const [historial, setHistorial] = useState(null);
  const [aviso, setAviso] = useState(null);
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
      if (faltaTabla(e, "pedidos_compra")) setFaltaMigracion(true);
    }
  }, [empresaId, permisos, usuario?.id]);
  useEffect(() => { cargar(); }, [cargar]);

  // Catálogo y OT para el formulario, cada vez que se abre: así aparecen los
  // artículos que trajo una sincronización hecha con Compras abierto
  useEffect(() => {
    if (!pidiendo && !pegando && !editando) return;
    sbGetAll("articulos_stock?activo=eq.true&select=sku,nombre,unidad,division&order=sku.asc", { maxFilas: 20000 })
      .then(({ data }) => setArticulos(data || []))
      .catch(() => {});
    sb.get("proyectos?select=ot&estado=eq.activo&order=id.desc&limit=300")
      .then((rows) => setOts([...new Set((rows || []).map((p) => p.ot).filter(Boolean))]))
      .catch(() => {});
  }, [pidiendo, pegando, editando]);

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

  const verHistorial = async (p) => {
    if (historial?.id === p.id) { setHistorial(null); return; }
    setHistorial({ id: p.id, cambios: null });
    try {
      const rows = await sb.get(`pedidos_compra_cambios?pedido_id=eq.${p.id}&order=created_at.desc&limit=50`);
      setHistorial({ id: p.id, cambios: rows || [] });
    } catch {
      setHistorial({ id: p.id, cambios: [], error: true });
    }
  };

  if (!permisos) return <div className="p-[18px] text-[14px] text-gypi-dim" role="status">Cargando…</div>;

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      {permisos.puede_pedir && (
        <div role="tablist" aria-label="Compras" className="flex gap-1.5 mb-3 flex-wrap">
          {(comprador ? PESTANAS_COMPRADOR : PESTANAS_JEFE).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={vista === id} onClick={() => { setVista(id); setOrdenNueva(null); setCreadas(null); }}
              className={`min-h-[44px] px-3 rounded-lg border text-[13px] font-bold cursor-pointer ${vista === id ? "bg-gypi-amber/15 border-gypi-amber text-gypi-amber-ink" : "bg-gypi-bg border-gypi-border text-gypi-dim"}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {faltaMigracion && (
        <div role="alert" className="p-3 mb-3 rounded-[10px] bg-gypi-red/10 text-gypi-red text-[14px]">{AVISO_MIGRACION_113}</div>
      )}

      {creadas?.length > 0 && vista === "ordenes" && (
        <div role="status" className="p-3 mb-3 rounded-[10px] bg-gypi-green/10 text-[14px]">
          ✅ Armé {creadas.length === 1 ? "la orden" : "las órdenes"} {creadas.map((o) => `N° ${o.numero} (${o.proveedor_nombre})`).join(", ")}. Revisalas y mandalas al proveedor.
        </div>
      )}
      {vista === "recibir" && permisos.puede_pedir ? (
        <RecibirCompra empresaId={empresaId} comprador={comprador} />
      ) : vista === "acomprar" && comprador ? (
        <AComprar empresaId={empresaId} onCreadas={(lista) => { setCreadas(lista); setOrdenNueva(lista.length === 1 ? lista[0].id : null); setVista("ordenes"); cargar(); }} />
      ) : vista === "ordenes" && comprador ? (
        <OrdenesCompra empresaId={empresaId} empresa={empresa} abrirId={ordenNueva} />
      ) : vista === "proveedores" && comprador ? (
        <ProveedoresCompras empresaId={empresaId} />
      ) : vista === "reportes" && comprador ? (
        <ReportesCompras empresaId={empresaId} />
      ) : (
        <>
          {editando ? (
            <PedirMaterial key={editando.id} pedido={editando} articulos={articulos} ots={ots} onListo={cargar} onCancelar={() => setEditando(null)}
              onCorregido={async (data) => {
                setEditando(null);
                setHistorial(null);
                setAviso(data.cambios?.length ? `Pedido corregido: ${textoPedido(data.pedido)}.` : "No había nada para cambiar.");
                await cargar();
              }} />
          ) : permisos.puede_pedir && (pidiendo ? (
            <PedirMaterial articulos={articulos} ots={ots} onListo={cargar} onCancelar={() => setPidiendo(false)} />
          ) : pegando ? (
            <PegarPedido articulos={articulos} ots={ots} onListo={cargar} onCancelar={() => setPegando(false)} />
          ) : (
            <div className="flex gap-2 mb-3">
              <button onClick={() => { setPidiendo(true); setError(null); }} className="g-btn g-btn-primary flex-1">🛒 Pedir material</button>
              <button onClick={() => { setPegando(true); setError(null); setAviso(null); }} className="g-btn g-btn-secondary flex-1">📋 Pegar desde la planilla</button>
            </div>
          ))}

          <div className="flex gap-2 mb-2">
            <input aria-label="Buscar pedidos" className="g-input flex-1 min-w-0" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar material, OT o quién pidió" />
            <select aria-label="Estado" className="g-input w-auto" value={estado} onChange={(e) => setEstado(e.target.value)}>
              <option value="">Todos</option>
              {Object.values(ESTADOS_PEDIDO).map((s) => <option key={s.id} value={s.id}>{s.icono} {s.nombre}</option>)}
            </select>
          </div>
          {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
          {aviso && <div role="status" className="text-[13px] mb-2">✅ {aviso}</div>}

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
                  <li key={p.id} className={`p-2 rounded-[10px] border border-gypi-border bg-gypi-surface ${p.estado === "anulado" ? "opacity-60" : ""}`}>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className={`text-[14px] font-semibold truncate ${p.estado === "anulado" ? "line-through" : ""}`}>{textoPedido(p)}</div>
                        <div className="text-[12px] text-gypi-dim truncate">
                          {est.icono} {est.nombre} · {p.empleado_nombre || "—"} · {fecha(p.created_at)}
                          {p.para_fecha ? ` · Para el ${fecha(p.para_fecha)}` : ""}
                          {p.notas ? ` · ${p.notas}` : ""}
                          {p.faltante_de ? ` · ↩ Faltó de la ${p.faltante_de}` : ""}
                        </div>
                      </div>
                      {puedeEditarPedido(p, { comprador, empleadoId: usuario?.id }) && (
                        <button onClick={() => { setEditando(p); setPidiendo(false); setPegando(false); setError(null); setAviso(null); }} aria-label={`Editar pedido de ${textoPedido(p)}`}
                          className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-amber-ink cursor-pointer">Editar</button>
                      )}
                      {puedeAnularPedido(p, { comprador, empleadoId: usuario?.id }) && (
                        <button onClick={() => anular(p)} aria-label={`Anular pedido de ${textoPedido(p)}`}
                          className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-red cursor-pointer">Anular</button>
                      )}
                    </div>
                    {p.editado_at && (
                      <button onClick={() => verHistorial(p)} aria-expanded={historial?.id === p.id}
                        className="min-h-[32px] p-0 bg-transparent border-none text-left text-[12px] font-semibold text-gypi-amber-ink cursor-pointer">
                        ✏️ Corregido por {p.editado_por_nombre || "—"} el {fecha(p.editado_at)}
                      </button>
                    )}
                    {historial?.id === p.id && (
                      <ul aria-label={`Correcciones de ${textoPedido(p)}`} className="list-none m-0 mt-1 p-2 rounded-lg bg-gypi-bg text-[12px] flex flex-col gap-1">
                        {historial.cambios === null ? <li role="status">Cargando…</li>
                          : historial.error ? <li>No se pudo leer el historial.</li>
                            : !historial.cambios.length ? <li>Sin correcciones guardadas.</li>
                              : historial.cambios.map((c) => (
                                <li key={c.id}>
                                  <b>{fechaHora(c.created_at)} · {c.empleado_nombre || "—"}</b>
                                  {(Array.isArray(c.cambios) ? c.cambios : []).map((x) => <div key={x.campo}>{textoCambio(x)}</div>)}
                                </li>
                              ))}
                      </ul>
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
