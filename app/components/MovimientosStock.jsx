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
import { TIPOS_MOVIMIENTO, leerCantidadMovimiento, puedeAnular, textoMovimiento, hoyMovimiento, fechaCorta, DIAS_ATRAS_MOVIMIENTO } from "../lib/movimientosStock";
import { useOts } from "../hooks/useOts";
import { textoOt } from "../lib/nombreOt";
import BotonNuevaPersona from "./AltaPersona";
import { proveedorDeLista } from "../lib/elegirDeLista";
import RemitosFoto from "./RemitosFoto";
import MovimientoCorregir, { HistorialMovimiento, historialMovimiento } from "./MovimientoCorregir";
import { renglonTanda, heredado, leerTandaPegada, renglonesParaGuardar, leerBorrador, guardarBorrador, borrarBorrador, MAX_TANDA } from "../lib/tandaMovimientos";

const CUANTOS = 100;
const VACIO = { tipo: "ingreso", texto: "", articulo: null, cantidad: "", ot: "", proveedor: "", comprobante: "", precio: "", notas: "", fecha: "", renglones: [], otTodos: "" };

/**
 * Retiros y devoluciones (11/11, parte 5): varios artículos juntos, cada uno
 * con su OT. 22/11 (carga por tanda): también los ingresos, cada renglón con
 * su proveedor, comprobante y precio, todos con la misma fecha.
 */
export const esVarios = (tipo) => tipo === "consumo" || tipo === "devolucion" || tipo === "ingreso";

/**
 * Agrega el artículo a la tanda con la OT de todos (consumo) o el proveedor y
 * comprobante del renglón de arriba (ingreso). El mismo artículo puede ir dos
 * veces (22/11: la misma placa para dos OT).
 */
export function agregarRenglon(form, articulo) {
  if (form.renglones.length >= MAX_TANDA) return { ...form, texto: "" };
  return { ...form, texto: "", renglones: [...form.renglones, renglonTanda(articulo, heredado(form))] };
}

/** Cambia la OT de todos: los renglones que tenían la de antes (o ninguna) pasan a la nueva. */
export function cambiarOtTodos(form, ot) {
  return { ...form, otTodos: ot, renglones: form.renglones.map((r) => (r.ot === form.otTodos || !r.ot ? { ...r, ot } : r)) };
}

/** Cambia el proveedor o el comprobante de todos (ingreso), igual que la OT de todos. */
export function cambiarTodos(form, campo, valor) {
  const leer = (x) => (campo === "proveedor" ? x.proveedor : x.comprobante);
  const poner = (x) => (campo === "proveedor" ? { ...x, proveedor: valor } : { ...x, comprobante: valor });
  const antes = leer(form);
  return { ...poner(form), renglones: form.renglones.map((r) => (leer(r) === antes || !leer(r) ? poner(r) : r)) };
}

/**
 * Los botones grandes para cargar (17/11, pedido de Tadeo: "más a la vista"):
 * 📥 Ingreso y 📤 Consumo, y debajo devolución o ajuste. El ingreso y el
 * ajuste son de la oficina.
 */
export function BotonesCargar({ puedeIngresar = true, onElegir }) {
  return (
    <div className="mb-3">
      <div className="grid grid-cols-2 gap-2">
        {puedeIngresar && (
          <button onClick={() => onElegir("ingreso")} className="g-btn g-btn-primary min-h-[52px] text-[15px] whitespace-nowrap">📥 Cargar ingreso</button>
        )}
        <button onClick={() => onElegir("consumo")} className={`g-btn g-btn-primary min-h-[52px] text-[15px] whitespace-nowrap ${puedeIngresar ? "" : "col-span-2"}`}>📤 Cargar consumo</button>
      </div>
      <div className="flex flex-wrap gap-x-3 mt-1 text-[13px]">
        <button onClick={() => onElegir("devolucion")} className="min-h-[40px] p-0 bg-transparent border-none font-semibold text-gypi-amber-ink cursor-pointer font-body">↩️ Devolución</button>
        {puedeIngresar && (
          <button onClick={() => onElegir("ajuste")} className="min-h-[40px] p-0 bg-transparent border-none font-semibold text-gypi-amber-ink cursor-pointer font-body">⚖️ Ajuste de inventario</button>
        )}
      </div>
    </div>
  );
}

function fechaHora(iso) {
  return iso ? new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "";
}

/** Cuándo fue el movimiento (19/11, 197): si se cargó otro día, las dos fechas. */
export function cuandoFue(m) {
  const cargado = m?.created_at ? hoyMovimiento(new Date(m.created_at)) : null;
  if (m?.fecha && m.fecha !== cargado) return `${fechaCorta(m.fecha)} · cargado ${fechaHora(m.created_at)}`;
  return fechaHora(m?.created_at);
}

export default function MovimientosStock({ usuario, articulos = [], onArticuloNuevo, tipoInicial = null }) {
  const porOt = useOts();
  const [movs, setMovs] = useState(null);
  const [creando, setCreando] = useState(false);
  const puedeCrear = usuario?.rol === "gerencial" || usuario?.rol === "administrativo";
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  // 17/11: 📥 Cargar ingreso y 📤 Cargar consumo de Stock e Inventario abren el formulario directo
  // 22/11: si había una tanda a medio cargar de ese tipo, se recupera
  const [form, setForm] = useState(() => {
    if (!tipoInicial || !TIPOS_MOVIMIENTO[tipoInicial]) return null;
    const b = esVarios(tipoInicial) ? leerBorrador(tipoInicial) : null;
    return b ? { ...VACIO, ...b, tipo: tipoInicial, texto: "" } : { ...VACIO, tipo: tipoInicial };
  });
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [conRemito, setConRemito] = useState(false);
  // 19/11 (punto 12): el movimiento que se está corrigiendo y el que muestra su historial
  const [corrigiendo, setCorrigiendo] = useState(null);
  const [verHistorial, setVerHistorial] = useState(null);
  // 22/11 (carga por tanda): pegar desde Excel, el borrador recuperado y lo que se guardó
  const [pegando, setPegando] = useState(false);
  const [textoPegado, setTextoPegado] = useState("");
  const [avisoPegado, setAvisoPegado] = useState(null);
  const [recuperado, setRecuperado] = useState(() => !!(form && form.renglones.length));
  const [guardados, setGuardados] = useState(null);

  /** Abre el formulario de ese tipo; si había una tanda a medio cargar, la recupera. */
  const abrir = useCallback((tipo) => {
    const b = esVarios(tipo) ? leerBorrador(tipo) : null;
    setForm(b ? { ...VACIO, ...b, tipo, texto: "" } : { ...VACIO, tipo });
    setRecuperado(!!b);
    setError(null);
    setGuardados(null);
    setAvisoPegado(null);
    setPegando(false);
  }, []);
  // Lo que se va cargando queda guardado en este navegador
  useEffect(() => { if (form && esVarios(form.tipo)) guardarBorrador(form); }, [form]);
  const cerrar = () => { if (form) borrarBorrador(form.tipo); setForm(null); setRecuperado(false); setPegando(false); setAvisoPegado(null); };

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

  const agregarPegado = () => {
    const leido = leerTandaPegada(textoPegado, articulos, form.tipo);
    const lugar = MAX_TANDA - form.renglones.length;
    const nuevos = leido.renglones.slice(0, Math.max(0, lugar)).map((r) => (form.tipo === "ingreso"
      ? { ...r, proveedor: r.proveedor || form.proveedor, comprobante: r.comprobante || form.comprobante }
      : { ...r, ot: r.ot || form.otTodos }));
    setForm((f) => ({ ...f, renglones: [...f.renglones, ...nuevos] }));
    const partes = [`Se agregaron ${nuevos.length} renglones.`];
    if (leido.noEncontrados.length) partes.push(`No encontré ${leido.noEncontrados.length}: ${leido.noEncontrados.slice(0, 5).join(", ")}${leido.noEncontrados.length > 5 ? "…" : ""}. Agregalos con el buscador.`);
    if (leido.sinCantidad.length) partes.push(`Sin cantidad: ${leido.sinCantidad.slice(0, 5).join(", ")}.`);
    if (leido.demasiados || nuevos.length < leido.renglones.length) partes.push(`Entran hasta ${MAX_TANDA} por tanda.`);
    setAvisoPegado(partes.join(" "));
    setTextoPegado("");
    setPegando(false);
  };

  const guardarVarios = async (forzar = false) => {
    if (!form.renglones.length) { setError("Agregá al menos un artículo"); return; }
    const { renglones, error: mal } = renglonesParaGuardar(form);
    if (mal) { setError(mal); return; }
    setEnviando(true);
    setError(null);
    try {
      const res = await apiFetch("/api/stock/movimientos", {
        method: "POST",
        body: JSON.stringify({ accion: "registrar_varios", tipo: form.tipo, renglones, notas: form.notas || null, fecha: form.fecha || null, ...(forzar ? { forzar: true } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.repetido) {
        setEnviando(false);
        if (window.confirm(`${data.error}\n\n¿Es otro ingreso y lo querés cargar igual?`)) await guardarVarios(true);
        else setError(`${data.error} Si es el mismo, no hace falta cargarlo de nuevo: sacá esos renglones.`);
        return;
      }
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo guardar");
      setGuardados({ cuantos: data.cargados || renglones.length, tipo: form.tipo, fecha: form.fecha || hoyMovimiento() });
      cerrar();
      await cargar();
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  const guardar = async (forzar = false) => {
    if (esVarios(form.tipo)) { await guardarVarios(forzar); return; }
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
          fecha: form.fecha || null,
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

      {/* Primero los botones grandes para cargar (17/11); debajo, el ingreso por
          foto del remito, para revisar (11/11, parte 7) */}
      {guardados && !form && (
        <div role="status" className="p-3 mb-3 rounded-[10px] bg-gypi-green/10 text-gypi-green text-[14px] font-semibold">
          ✓ Se cargaron {guardados.cuantos} {guardados.tipo === "ingreso" ? "ingresos" : guardados.tipo === "devolucion" ? "devoluciones" : "consumos"} del {fechaCorta(guardados.fecha)}.
        </div>
      )}
      {!form && !conRemito && <BotonesCargar puedeIngresar={puedeCrear} onElegir={abrir} />}
      {!form && <RemitosFoto articulos={articulos} onIngreso={cargar} onAbierto={setConRemito} />}
      {conRemito || !form ? null : (
        <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
          <div className="flex gap-1.5 flex-wrap mb-3" role="group" aria-label="Tipo de movimiento">
            {Object.values(TIPOS_MOVIMIENTO).filter((t) => puedeCrear || (t.id !== "ingreso" && t.id !== "ajuste")).map((t) => (
              <button key={t.id} onClick={() => setForm((f) => (esVarios(t.id) && f.articulo && !f.renglones.length
                ? { ...agregarRenglon({ ...f, articulo: null, tipo: t.id }, f.articulo), tipo: t.id }
                : { ...f, tipo: t.id }))} aria-pressed={form.tipo === t.id}
                className={`min-h-[44px] px-3 rounded-lg border text-[13px] font-bold cursor-pointer ${form.tipo === t.id ? "bg-gypi-amber/15 border-gypi-amber text-gypi-amber-ink" : "bg-gypi-bg border-gypi-border text-gypi-dim"}`}>
                {t.icono} {t.nombre}
              </button>
            ))}
          </div>

          {/* 19/11 (197): el día en que pasó. 22/11: arriba, una vez para toda la tanda */}
          <label className="g-label" htmlFor="mov-fecha">Fecha</label>
          <input id="mov-fecha" type="date" className="g-input w-full mb-1" value={form.fecha || hoyMovimiento()} onChange={cambiar("fecha")}
            max={hoyMovimiento()} min={hoyMovimiento(new Date(Date.now() - DIAS_ATRAS_MOVIMIENTO * 86400000))} />
          <div className="text-[12px] text-gypi-dim mb-3">
            {esVarios(form.tipo) ? "La misma fecha para todos los renglones de esta tanda." : "El día en que entró o se usó el material. Cambiala si lo cargás después."}
          </div>

          {recuperado && form.renglones.length > 0 && (
            <div role="status" className="p-2 mb-2 rounded-lg bg-gypi-amber/10 text-[13px] text-gypi-amber-ink">
              Recuperé los {form.renglones.length} renglones que estabas cargando.{" "}
              <button onClick={() => { setForm((f) => ({ ...VACIO, tipo: f.tipo })); setRecuperado(false); }} className="min-h-[32px] p-0 bg-transparent border-none font-semibold underline text-gypi-amber-ink cursor-pointer font-body">Empezar de nuevo</button>
            </div>
          )}

          {esVarios(form.tipo) && form.tipo !== "ingreso" && (
            <>
              <label className="g-label" htmlFor="mov-ot-todos">OT para todos (opcional)</label>
              <input id="mov-ot-todos" className="g-input w-full mb-1" list="mov-ots" value={form.otTodos} onChange={(e) => setForm((f) => cambiarOtTodos(f, e.target.value))} placeholder="Ej: M-7495" maxLength={40} />
              <div className="text-[12px] text-gypi-dim mb-2">Con OT, lo que se retira suma al costo de esa OT. Cada artículo puede ir a otra OT.</div>
            </>
          )}
          {form.tipo === "ingreso" && (
            <>
              <div className="flex gap-2">
                <div className="flex-1 min-w-0">
                  <label className="g-label" htmlFor="mov-proveedor">Proveedor para todos</label>
                  <input id="mov-proveedor" className="g-input w-full mb-1" list="mov-proveedores" value={form.proveedor} onChange={(e) => setForm((f) => cambiarTodos(f, "proveedor", e.target.value))} maxLength={120} placeholder="Escribí para buscar" />
                </div>
                <div className="flex-1 min-w-0">
                  <label className="g-label" htmlFor="mov-comprobante">N° de comprobante</label>
                  <input id="mov-comprobante" className="g-input w-full mb-1" value={form.comprobante} onChange={(e) => setForm((f) => cambiarTodos(f, "comprobante", e.target.value))} maxLength={60} />
                </div>
              </div>
              {!provConocido && (
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="text-[12px] text-gypi-amber-ink">No está en la lista de proveedores: elegilo de la lista o dalo de alta.</span>
                  <BotonNuevaPersona rol="proveedor" nombre={provEscrito}
                    onCreada={(p) => {
                      setProveedores((x) => [...x, { id: p.proveedor_id, nombre: p.nombre }]);
                      setForm((f) => cambiarTodos(f, "proveedor", p.nombre));
                    }}>➕ Dar de alta como proveedor</BotonNuevaPersona>
                </div>
              )}
              <div className="text-[12px] text-gypi-dim mb-2">Cada renglón puede tener otro proveedor o comprobante. Un renglón nuevo copia los del de arriba.</div>
            </>
          )}

          {esVarios(form.tipo) && (
            <>
              {form.renglones.length > 0 && (
                <ul aria-label="Artículos a cargar" className="list-none p-0 m-0 mb-2 flex flex-col gap-2">
                  {form.renglones.map((r, i) => {
                    const nombre = r.articulo.nombre || r.articulo.sku;
                    const provMal = form.tipo === "ingreso" && String(r.proveedor || "").trim() && proveedores.length > 0 && !proveedorDeLista({ nombre: r.proveedor.trim() }, proveedores);
                    return (
                      <li key={r.id || `${r.articulo.sku}-${i}`} className="p-2 rounded-lg border border-gypi-border bg-gypi-bg">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 min-w-0 text-[14px] font-semibold truncate"><span className="text-gypi-dim font-normal">{i + 1}.</span> {nombre} <span className="text-gypi-dim font-normal">· {r.articulo.sku}</span></div>
                          <button onClick={() => sacarRenglon(i)} aria-label={`Sacar ${nombre}`} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-red cursor-pointer">Sacar</button>
                        </div>
                        <div className="flex gap-2">
                          <label className="flex-1 min-w-0 flex flex-col gap-1 text-[12px] font-semibold text-gypi-dim">Cantidad{r.articulo.unidad ? ` (${r.articulo.unidad})` : ""}
                            <input aria-label={`Cantidad de ${nombre}`} className="g-input w-full" inputMode="decimal" value={r.cantidad} onChange={cambiarRenglon(i, "cantidad")} placeholder="Ej: 10" />
                          </label>
                          {form.tipo === "ingreso" ? (
                            <label className="flex-1 min-w-0 flex flex-col gap-1 text-[12px] font-semibold text-gypi-dim">Precio unitario (sin IVA)
                              <input aria-label={`Precio de ${nombre}`} className="g-input w-full" inputMode="decimal" value={r.precio} onChange={cambiarRenglon(i, "precio")} placeholder="Opcional" />
                            </label>
                          ) : (
                            <label className="flex-1 min-w-0 flex flex-col gap-1 text-[12px] font-semibold text-gypi-dim">OT (opcional)
                              <input aria-label={`OT de ${nombre}`} className="g-input w-full" list="mov-ots" value={r.ot} onChange={cambiarRenglon(i, "ot")} placeholder="Sin OT" maxLength={40} />
                            </label>
                          )}
                        </div>
                        {form.tipo === "ingreso" && (
                          <div className="flex gap-2 mt-1">
                            <label className="flex-1 min-w-0 flex flex-col gap-1 text-[12px] font-semibold text-gypi-dim">Proveedor
                              <input aria-label={`Proveedor de ${nombre}`} className="g-input w-full" list="mov-proveedores" value={r.proveedor} onChange={cambiarRenglon(i, "proveedor")} maxLength={120} />
                            </label>
                            <label className="flex-1 min-w-0 flex flex-col gap-1 text-[12px] font-semibold text-gypi-dim">Comprobante
                              <input aria-label={`Comprobante de ${nombre}`} className="g-input w-full" value={r.comprobante} onChange={cambiarRenglon(i, "comprobante")} maxLength={60} />
                            </label>
                          </div>
                        )}
                        {provMal && <div className="text-[12px] text-gypi-amber-ink mt-1">Ese proveedor no está en la lista: elegilo de la lista o dalo de alta arriba.</div>}
                      </li>
                    );
                  })}
                </ul>
              )}
              <datalist id="mov-ots">{[...porOt.values()].slice(0, 300).map((o) => <option key={o.ot} value={String(o.ot)}>{textoOt(o)}</option>)}</datalist>
            </>
          )}
          {form.tipo === "ingreso" && <datalist id="mov-proveedores">{proveedores.map((p) => <option key={p.id} value={p.nombre} />)}</datalist>}

          <label className="g-label" htmlFor="mov-articulo">{esVarios(form.tipo) ? (form.renglones.length ? "Agregar otro artículo" : "Artículo") : "Artículo"}</label>
          {form.articulo && !esVarios(form.tipo) ? (
            <div className="flex items-center gap-2 mb-2">
              <div className="flex-1 min-w-0 text-[14px] font-semibold truncate">{form.articulo.nombre || form.articulo.sku} <span className="text-gypi-dim font-normal">· {form.articulo.sku}</span></div>
              <button onClick={() => setForm((f) => ({ ...f, articulo: null }))} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-amber-ink cursor-pointer">Cambiar</button>
            </div>
          ) : esVarios(form.tipo) && form.renglones.length >= MAX_TANDA ? (
            <div role="status" className="text-[13px] text-gypi-amber-ink mb-2">Llegaste a {MAX_TANDA} renglones: guardá esta tanda y seguí con otra.</div>
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

          {/* 22/11: pegar la tanda desde Excel o la planilla */}
          {esVarios(form.tipo) && (pegando ? (
            <div className="p-2 mb-2 rounded-lg border border-gypi-border bg-gypi-bg">
              <label className="g-label" htmlFor="mov-pegar">Pegá las filas copiadas de Excel</label>
              <div className="text-[12px] text-gypi-dim mb-1">
                Columnas en este orden: {form.tipo === "ingreso" ? "código o nombre · cantidad · precio sin IVA · proveedor · comprobante" : "código o nombre · cantidad · OT"}. Las que no tengas, dejalas vacías.
              </div>
              <textarea id="mov-pegar" className="g-input w-full mb-2 min-h-[110px] font-mono text-[12px]" value={textoPegado} onChange={(e) => setTextoPegado(e.target.value)} />
              <div className="flex gap-2">
                <button onClick={() => { setPegando(false); setTextoPegado(""); }} className="g-btn g-btn-secondary flex-1">Cancelar</button>
                <button onClick={agregarPegado} disabled={!textoPegado.trim()} className="g-btn g-btn-primary flex-1">Agregar renglones</button>
              </div>
            </div>
          ) : (
            <button onClick={() => { setPegando(true); setAvisoPegado(null); }} className="min-h-[44px] mb-2 px-0 bg-transparent border-none text-[13px] font-semibold text-gypi-amber-ink cursor-pointer font-body">
              📋 Pegar desde Excel o la planilla
            </button>
          ))}
          {avisoPegado && <div role="status" className="text-[12px] text-gypi-dim mb-2">{avisoPegado}</div>}

          {!esVarios(form.tipo) && (<>
          <label className="g-label" htmlFor="mov-cantidad">Cantidad{form.articulo?.unidad ? ` (${form.articulo.unidad})` : ""}{form.tipo === "ajuste" ? ". Con signo menos si resta" : ""}</label>
          <input id="mov-cantidad" className="g-input w-full mb-2" inputMode="decimal" value={form.cantidad} onChange={cambiar("cantidad")} placeholder={form.tipo === "ajuste" ? "Ej: -3 o 2,5" : "Ej: 10"} />
          </>)}

          <label className="g-label" htmlFor="mov-notas">Notas (opcional)</label>
          <input id="mov-notas" className="g-input w-full mb-3" value={form.notas} onChange={cambiar("notas")} maxLength={300} />

          {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
          <div className="flex gap-2">
            <button onClick={cerrar} className="g-btn g-btn-secondary flex-1">Cancelar</button>
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
            <li key={m.id} className={`p-2 rounded-[10px] border border-gypi-border bg-gypi-surface ${m.anulado ? "opacity-60" : ""}`}>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className={`text-[14px] font-semibold ${m.anulado ? "line-through" : ""}`}>{textoMovimiento(m, porOt)}</div>
                  <div className="text-[12px] text-gypi-dim truncate">{m.nombre || m.sku} · {m.empleado_nombre || (m.legajo ? `Legajo ${m.legajo}` : "—")} · {cuandoFue(m)}{m.anulado ? " · Anulado" : ""}</div>
                </div>
                {historialMovimiento(m).some((h) => h.accion === "corregida") && (
                  <button onClick={() => setVerHistorial((v) => (v === m.id ? null : m.id))} aria-expanded={verHistorial === m.id}
                    aria-label={`Historial de ${textoMovimiento(m, porOt)}`}
                    className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-dim cursor-pointer">🕓</button>
                )}
                {puedeAnular(m, { rol: usuario?.rol, empleadoId: usuario?.id }) && corrigiendo !== m.id && (
                  <>
                    <button onClick={() => { setCorrigiendo(m.id); setError(null); }} aria-label={`Corregir ${textoMovimiento(m, porOt)} de ${m.nombre || m.sku}`}
                      className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-amber-ink cursor-pointer">✏ Corregir</button>
                    <button onClick={() => anular(m)} aria-label={`Anular ${textoMovimiento(m, porOt)} de ${m.nombre || m.sku}`}
                      className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-red cursor-pointer">Anular</button>
                  </>
                )}
              </div>
              {corrigiendo === m.id && (
                <MovimientoCorregir m={m} onCancelar={() => setCorrigiendo(null)}
                  onCorregido={async (d) => { setCorrigiendo(null); if (d.aviso) setError(d.aviso); await cargar(); }} />
              )}
              {verHistorial === m.id && <div className="mt-2"><HistorialMovimiento m={m} /></div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
