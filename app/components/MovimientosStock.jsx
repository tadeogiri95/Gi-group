'use client';
// app/components/MovimientosStock.jsx — Movimientos de stock en Inventario →
// Stock (Stock, parte 14; ítem 40). La oficina ve lo que se retiró y
// devolvió desde la app, carga ingresos de compras y ajustes de inventario, y
// anula lo que se cargó mal. La planilla MRP los trae sola (parte 15). Un
// artículo que no está en la planilla se carga como nuevo (124).
import { useCallback, useEffect, useMemo, useState } from "react";
import { sb, sbGetAll, apiFetch } from "../lib/supabase";
import { sugerirArticulos } from "../lib/stock";
import ArticuloNuevo from "./ArticuloNuevo";
import { TIPOS_MOVIMIENTO, leerCantidadMovimiento, puedeAnular, textoMovimiento } from "../lib/movimientosStock";
import { useOts } from "../hooks/useOts";
import { textoOt } from "../lib/nombreOt";
import BotonNuevaPersona from "./AltaPersona";
import { proveedorDeLista } from "../lib/elegirDeLista";
import RemitosFoto from "./RemitosFoto";

const CUANTOS = 100;
const VACIO = { tipo: "ingreso", texto: "", articulo: null, cantidad: "", ot: "", proveedor: "", comprobante: "", precio: "", notas: "", renglones: [], otTodos: "" };

/** Retiros y devoluciones (11/11, parte 5): varios artículos juntos, cada uno con su OT. */
export const esVarios = (tipo) => tipo === "consumo" || tipo === "devolucion";

/** Agrega el artículo a la lista (si ya estaba, no lo repite) con la OT de todos. */
export function agregarRenglon(form, articulo) {
  if (form.renglones.some((r) => r.articulo.sku === articulo.sku)) return { ...form, texto: "" };
  return { ...form, texto: "", renglones: [...form.renglones, { articulo, cantidad: "", ot: form.otTodos }] };
}

/** Cambia la OT de todos: los renglones que tenían la de antes (o ninguna) pasan a la nueva. */
export function cambiarOtTodos(form, ot) {
  return { ...form, otTodos: ot, renglones: form.renglones.map((r) => (r.ot === form.otTodos || !r.ot ? { ...r, ot } : r)) };
}

function fechaHora(iso) {
  return iso ? new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "";
}

export default function MovimientosStock({ usuario, articulos = [], onArticuloNuevo }) {
  const porOt = useOts();
  const [movs, setMovs] = useState(null);
  const [creando, setCreando] = useState(false);
  const puedeCrear = usuario?.rol === "gerencial" || usuario?.rol === "administrativo";
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [conRemito, setConRemito] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const rows = await sb.get(`movimientos_stock?order=created_at.desc,id.desc&limit=${CUANTOS}`);
      setMovs(rows || []);
      setFaltaMigracion(false);
    } catch (e) {
      setMovs([]);
      if (String(e?.message).includes("movimientos_stock")) setFaltaMigracion(true);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  // Los proveedores de Compras, para elegir en el ingreso (11/11: ➕ Nuevo si no está)
  const [proveedores, setProveedores] = useState([]);
  const ingresando = form?.tipo === "ingreso";
  useEffect(() => {
    if (!ingresando || proveedores.length) return;
    sbGetAll("proveedores?activo=eq.true&select=id,nombre&order=nombre.asc", { maxFilas: 5000 }).then((r) => setProveedores(r.data || [])).catch(() => {});
  }, [ingresando, proveedores.length]);
  const provEscrito = (form?.proveedor || "").trim();
  // 14/11: el proveedor tiene que estar en la lista (misma regla que la Agenda: "STOM" = "STOM SAS")
  const provConocido = !provEscrito || !!proveedorDeLista({ nombre: provEscrito }, proveedores);

  const sugeridos = useMemo(
    () => (form && !form.articulo && form.texto.trim() ? sugerirArticulos(articulos, form.texto) : { lista: [], resto: 0 }),
    [form, articulos]
  );
  const cambiar = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  const cambiarRenglon = (i, campo) => (e) => setForm((f) => ({ ...f, renglones: f.renglones.map((r, j) => (j === i ? { ...r, [campo]: e.target.value } : r)) }));
  const sacarRenglon = (i) => setForm((f) => ({ ...f, renglones: f.renglones.filter((_, j) => j !== i) }));
  const elegirArticulo = (a) => setForm((f) => (esVarios(f.tipo) ? agregarRenglon(f, a) : { ...f, articulo: a }));

  const guardarVarios = async () => {
    if (!form.renglones.length) { setError("Agregá al menos un artículo"); return; }
    const renglones = form.renglones.map((r) => ({ sku: r.articulo.sku, cantidad: leerCantidadMovimiento(r.cantidad), ot: r.ot.trim() || null }));
    const sinCantidad = renglones.findIndex((r) => !r.cantidad);
    if (sinCantidad >= 0) { setError(`Poné la cantidad de ${form.renglones[sinCantidad].articulo.nombre || form.renglones[sinCantidad].articulo.sku}`); return; }
    setEnviando(true);
    setError(null);
    try {
      const res = await apiFetch("/api/stock/movimientos", { method: "POST", body: JSON.stringify({ accion: "registrar_varios", tipo: form.tipo, renglones, notas: form.notas || null }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo guardar");
      setForm(null);
      await cargar();
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  const guardar = async (forzar = false) => {
    if (esVarios(form.tipo)) { await guardarVarios(); return; }
    const esAjuste = form.tipo === "ajuste";
    const cantidad = leerCantidadMovimiento(form.cantidad, { conSigno: esAjuste });
    if (!form.articulo) { setError("Elegí el artículo"); return; }
    if (!cantidad) { setError(esAjuste ? "Poné la cantidad (con signo menos si resta)" : "Poné una cantidad mayor a cero"); return; }
    const precio = form.precio.trim() ? leerCantidadMovimiento(form.precio) : null;
    setEnviando(true);
    setError(null);
    try {
      const res = await apiFetch("/api/stock/movimientos", {
        method: "POST",
        body: JSON.stringify({
          accion: "registrar", tipo: form.tipo, sku: form.articulo.sku, cantidad,
          ot: form.ot.trim() || null,
          proveedor: form.tipo === "ingreso" ? form.proveedor : null,
          comprobante: form.tipo === "ingreso" ? form.comprobante : null,
          precio_unitario: form.tipo === "ingreso" ? precio : null,
          notas: form.notas || null,
          ...(forzar ? { forzar: true } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      // El comprobante ya entró (una recepción de OC, una factura u otro ingreso): se confirma antes de repetirlo
      if (res.status === 409 && data.repetido) {
        setEnviando(false);
        if (window.confirm(`${data.error}\n\n¿Es otro ingreso y lo querés cargar igual?`)) await guardar(true);
        else setError(`${data.error} Si es el mismo, no hace falta cargarlo de nuevo.`);
        return;
      }
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo guardar");
      setForm(null);
      await cargar();
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  const anular = async (m) => {
    setError(null);
    try {
      const res = await apiFetch("/api/stock/movimientos", { method: "POST", body: JSON.stringify({ accion: "anular", id: m.id }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo anular");
      await cargar();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div>
      {faltaMigracion && (
        <div role="alert" className="p-3 mb-3 rounded-[10px] bg-gypi-red/10 text-gypi-red text-[14px]">Para los movimientos falta correr la migración 107 en Supabase.</div>
      )}
      {/* El código para que la planilla MRP traiga los movimientos está en
          Más → Planillas conectadas (auditoría 01/11, PR 3) */}

      {/* Ingreso por foto del remito, para revisar (11/11, parte 7) */}
      {!form && <RemitosFoto articulos={articulos} onIngreso={cargar} onAbierto={setConRemito} />}
      {conRemito ? null : !form ? (
        <button onClick={() => { setForm({ ...VACIO }); setError(null); }} className="g-btn g-btn-primary w-full mb-3">＋ Cargar retiro, devolución, ingreso o ajuste</button>
      ) : (
        <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
          <div className="flex gap-1.5 flex-wrap mb-3" role="group" aria-label="Tipo de movimiento">
            {Object.values(TIPOS_MOVIMIENTO).map((t) => (
              <button key={t.id} onClick={() => setForm((f) => (esVarios(t.id) && f.articulo && !f.renglones.length
                ? { ...agregarRenglon({ ...f, articulo: null }, f.articulo), tipo: t.id, renglones: [{ articulo: f.articulo, cantidad: f.cantidad, ot: f.otTodos }] }
                : { ...f, tipo: t.id }))} aria-pressed={form.tipo === t.id}
                className={`min-h-[44px] px-3 rounded-lg border text-[13px] font-bold cursor-pointer ${form.tipo === t.id ? "bg-gypi-amber/15 border-gypi-amber text-gypi-amber-ink" : "bg-gypi-bg border-gypi-border text-gypi-dim"}`}>
                {t.icono} {t.nombre}
              </button>
            ))}
          </div>

          {esVarios(form.tipo) && (
            <>
              <label className="g-label" htmlFor="mov-ot-todos">OT para todos (opcional)</label>
              <input id="mov-ot-todos" className="g-input w-full mb-1" list="mov-ots" value={form.otTodos} onChange={(e) => setForm((f) => cambiarOtTodos(f, e.target.value))} placeholder="Ej: M-7495" maxLength={40} />
              <div className="text-[12px] text-gypi-dim mb-2">Con OT, lo que se retira suma al costo de esa OT. Cada artículo puede ir a otra OT.</div>
              {form.renglones.length > 0 && (
                <ul aria-label="Artículos a cargar" className="list-none p-0 m-0 mb-2 flex flex-col gap-2">
                  {form.renglones.map((r, i) => (
                    <li key={r.articulo.sku} className="p-2 rounded-lg border border-gypi-border bg-gypi-bg">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0 text-[14px] font-semibold truncate">{r.articulo.nombre || r.articulo.sku} <span className="text-gypi-dim font-normal">· {r.articulo.sku}</span></div>
                        <button onClick={() => sacarRenglon(i)} aria-label={`Sacar ${r.articulo.nombre || r.articulo.sku}`} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-red cursor-pointer">Sacar</button>
                      </div>
                      <div className="flex gap-2">
                        <label className="flex-1 min-w-0 flex flex-col gap-1 text-[12px] font-semibold text-gypi-dim">Cantidad{r.articulo.unidad ? ` (${r.articulo.unidad})` : ""}
                          <input aria-label={`Cantidad de ${r.articulo.nombre || r.articulo.sku}`} className="g-input w-full" inputMode="decimal" value={r.cantidad} onChange={cambiarRenglon(i, "cantidad")} placeholder="Ej: 10" />
                        </label>
                        <label className="flex-1 min-w-0 flex flex-col gap-1 text-[12px] font-semibold text-gypi-dim">OT (opcional)
                          <input aria-label={`OT de ${r.articulo.nombre || r.articulo.sku}`} className="g-input w-full" list="mov-ots" value={r.ot} onChange={cambiarRenglon(i, "ot")} placeholder="Sin OT" maxLength={40} />
                        </label>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <datalist id="mov-ots">{[...porOt.values()].slice(0, 300).map((o) => <option key={o.ot} value={String(o.ot)}>{textoOt(o)}</option>)}</datalist>
            </>
          )}

          <label className="g-label" htmlFor="mov-articulo">{esVarios(form.tipo) ? (form.renglones.length ? "Agregar otro artículo" : "Artículo") : "Artículo"}</label>
          {form.articulo && !esVarios(form.tipo) ? (
            <div className="flex items-center gap-2 mb-2">
              <div className="flex-1 min-w-0 text-[14px] font-semibold truncate">{form.articulo.nombre || form.articulo.sku} <span className="text-gypi-dim font-normal">· {form.articulo.sku}</span></div>
              <button onClick={() => setForm((f) => ({ ...f, articulo: null }))} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-amber-ink cursor-pointer">Cambiar</button>
            </div>
          ) : (
            <>
              <input id="mov-articulo" className="g-input w-full mb-1" value={form.texto} onChange={cambiar("texto")} placeholder="Nombre o código" />
              {sugeridos.lista.length > 0 && (
                <ul aria-label="Artículos encontrados" className="list-none p-0 m-0 mb-2 flex flex-col gap-1">
                  {sugeridos.lista.map((a) => (
                    <li key={a.sku}>
                      <button onClick={() => elegirArticulo(a)} className="w-full min-h-[44px] text-left bg-gypi-bg rounded-lg px-2 border border-gypi-border cursor-pointer font-body text-gypi-text text-[13px]">
                        <b>{a.nombre || a.sku}</b> <span className="text-gypi-dim">· {a.sku}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {sugeridos.resto > 0 && (
                <div role="status" className="text-[12px] text-gypi-dim mb-2">Hay {sugeridos.resto} más. Escribí otra palabra del nombre o el código para encontrarlo.</div>
              )}
              {puedeCrear && form.texto.trim() && (creando ? (
                <ArticuloNuevo articulos={articulos} nombreInicial={form.texto.trim()} onCancelar={() => setCreando(false)}
                  onCreado={(a) => { setCreando(false); onArticuloNuevo?.(a); elegirArticulo(a); }} />
              ) : (
                <button onClick={() => setCreando(true)} className="min-h-[44px] mb-2 px-0 bg-transparent border-none text-[13px] font-semibold text-gypi-amber-ink cursor-pointer">
                  ➕ No está: cargarlo como artículo nuevo
                </button>
              ))}
            </>
          )}

          {!esVarios(form.tipo) && (<>
          <label className="g-label" htmlFor="mov-cantidad">Cantidad{form.articulo?.unidad ? ` (${form.articulo.unidad})` : ""}{form.tipo === "ajuste" ? ". Con signo menos si resta" : ""}</label>
          <input id="mov-cantidad" className="g-input w-full mb-2" inputMode="decimal" value={form.cantidad} onChange={cambiar("cantidad")} placeholder={form.tipo === "ajuste" ? "Ej: -3 o 2,5" : "Ej: 10"} />
          </>)}

          {form.tipo === "ingreso" && (
            <>
              <label className="g-label" htmlFor="mov-proveedor">Proveedor</label>
              <input id="mov-proveedor" className="g-input w-full mb-2" list="mov-proveedores" value={form.proveedor} onChange={cambiar("proveedor")} maxLength={120} placeholder="Escribí para buscar" />
              <datalist id="mov-proveedores">{proveedores.map((p) => <option key={p.id} value={p.nombre} />)}</datalist>
              {!provConocido && (
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="text-[12px] text-gypi-amber-ink">No está en la lista de proveedores: elegilo de la lista o dalo de alta.</span>
                  <BotonNuevaPersona rol="proveedor" nombre={provEscrito}
                    onCreada={(p) => {
                      setProveedores((x) => [...x, { id: p.proveedor_id, nombre: p.nombre }]);
                      setForm((f) => ({ ...f, proveedor: p.nombre }));
                    }}>➕ Dar de alta como proveedor</BotonNuevaPersona>
                </div>
              )}
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="g-label" htmlFor="mov-comprobante">N° de comprobante</label>
                  <input id="mov-comprobante" className="g-input w-full mb-2" value={form.comprobante} onChange={cambiar("comprobante")} maxLength={60} />
                </div>
                <div className="flex-1">
                  <label className="g-label" htmlFor="mov-precio">Precio unitario (sin IVA)</label>
                  <input id="mov-precio" className="g-input w-full mb-2" inputMode="decimal" value={form.precio} onChange={cambiar("precio")} />
                </div>
              </div>
            </>
          )}
          <label className="g-label" htmlFor="mov-notas">Notas (opcional)</label>
          <input id="mov-notas" className="g-input w-full mb-3" value={form.notas} onChange={cambiar("notas")} maxLength={300} />

          {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
          <div className="flex gap-2">
            <button onClick={() => setForm(null)} className="g-btn g-btn-secondary flex-1">Cancelar</button>
            <button onClick={() => guardar()} disabled={enviando} className="g-btn g-btn-primary flex-1">{enviando ? "Guardando…" : esVarios(form.tipo) && form.renglones.length > 1 ? `Guardar los ${form.renglones.length}` : "Guardar"}</button>
          </div>
        </div>
      )}
      {!form && error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}

      {movs === null ? (
        <div className="text-[14px] text-gypi-dim" role="status">Cargando movimientos…</div>
      ) : !movs.length ? (
        <div className="text-[14px] text-gypi-dim">Todavía no hay movimientos cargados desde la app.</div>
      ) : (
        <ul aria-label="Movimientos" className="list-none m-0 p-0 flex flex-col gap-1.5">
          {movs.map((m) => (
            <li key={m.id} className={`flex items-center gap-2 p-2 rounded-[10px] border border-gypi-border bg-gypi-surface ${m.anulado ? "opacity-60" : ""}`}>
              <div className="flex-1 min-w-0">
                <div className={`text-[14px] font-semibold ${m.anulado ? "line-through" : ""}`}>{textoMovimiento(m, porOt)}</div>
                <div className="text-[12px] text-gypi-dim truncate">{m.nombre || m.sku} · {m.empleado_nombre || (m.legajo ? `Legajo ${m.legajo}` : "—")} · {fechaHora(m.created_at)}{m.anulado ? " · Anulado" : ""}</div>
              </div>
              {puedeAnular(m, { rol: usuario?.rol, empleadoId: usuario?.id }) && (
                <button onClick={() => anular(m)} aria-label={`Anular ${textoMovimiento(m, porOt)} de ${m.nombre || m.sku}`}
                  className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-red cursor-pointer">Anular</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
