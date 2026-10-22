'use client';
// app/components/MovimientosStock.jsx — Movimientos de stock en Planta →
// Stock (Stock, parte 14; ítem 40). La oficina ve lo que se retiró y
// devolvió desde la app, carga ingresos de compras y ajustes de inventario, y
// anula lo que se cargó mal. La planilla MRP los trae sola (parte 15). Un
// artículo que no está en la planilla se carga como nuevo (124).
import { useCallback, useEffect, useMemo, useState } from "react";
import { sb, apiFetch } from "../lib/supabase";
import { sugerirArticulos } from "../lib/stock";
import PlanillaMrpConexion from "./PlanillaMrpConexion";
import ArticuloNuevo from "./ArticuloNuevo";
import { TIPOS_MOVIMIENTO, leerCantidadMovimiento, puedeAnular, textoMovimiento } from "../lib/movimientosStock";

const CUANTOS = 100;
const VACIO = { tipo: "ingreso", texto: "", articulo: null, cantidad: "", ot: "", proveedor: "", comprobante: "", precio: "", notas: "" };

function fechaHora(iso) {
  return iso ? new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "";
}

export default function MovimientosStock({ usuario, articulos = [], onArticuloNuevo }) {
  const [movs, setMovs] = useState(null);
  const [creando, setCreando] = useState(false);
  const puedeCrear = usuario?.rol === "gerencial" || usuario?.rol === "administrativo";
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

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

  const sugeridos = useMemo(
    () => (form && !form.articulo && form.texto.trim() ? sugerirArticulos(articulos, form.texto) : { lista: [], resto: 0 }),
    [form, articulos]
  );
  const cambiar = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  const guardar = async () => {
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
        }),
      });
      const data = await res.json().catch(() => ({}));
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
      {(usuario?.rol === "gerencial" || usuario?.rol === "administrativo") && <PlanillaMrpConexion />}

      {!form ? (
        <button onClick={() => { setForm({ ...VACIO }); setError(null); }} className="g-btn g-btn-primary w-full mb-3">＋ Cargar ingreso, ajuste o devolución</button>
      ) : (
        <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
          <div className="flex gap-1.5 flex-wrap mb-3" role="group" aria-label="Tipo de movimiento">
            {Object.values(TIPOS_MOVIMIENTO).map((t) => (
              <button key={t.id} onClick={() => setForm((f) => ({ ...f, tipo: t.id }))} aria-pressed={form.tipo === t.id}
                className={`min-h-[44px] px-3 rounded-lg border text-[13px] font-bold cursor-pointer ${form.tipo === t.id ? "bg-gypi-amber/15 border-gypi-amber text-gypi-amber-ink" : "bg-gypi-bg border-gypi-border text-gypi-dim"}`}>
                {t.icono} {t.nombre}
              </button>
            ))}
          </div>

          <label className="g-label" htmlFor="mov-articulo">Artículo</label>
          {form.articulo ? (
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
              {puedeCrear && form.texto.trim() && (creando ? (
                <ArticuloNuevo articulos={articulos} nombreInicial={form.texto.trim()} onCancelar={() => setCreando(false)}
                  onCreado={(a) => { setCreando(false); onArticuloNuevo?.(a); setForm((f) => ({ ...f, articulo: a })); }} />
              ) : (
                <button onClick={() => setCreando(true)} className="min-h-[44px] mb-2 px-0 bg-transparent border-none text-[13px] font-semibold text-gypi-amber-ink cursor-pointer">
                  ➕ No está: cargarlo como artículo nuevo
                </button>
              ))}
            </>
          )}

          <label className="g-label" htmlFor="mov-cantidad">Cantidad{form.articulo?.unidad ? ` (${form.articulo.unidad})` : ""}{form.tipo === "ajuste" ? ". Con signo menos si resta" : ""}</label>
          <input id="mov-cantidad" className="g-input w-full mb-2" inputMode="decimal" value={form.cantidad} onChange={cambiar("cantidad")} placeholder={form.tipo === "ajuste" ? "Ej: -3 o 2,5" : "Ej: 10"} />

          {form.tipo === "ingreso" && (
            <>
              <label className="g-label" htmlFor="mov-proveedor">Proveedor</label>
              <input id="mov-proveedor" className="g-input w-full mb-2" value={form.proveedor} onChange={cambiar("proveedor")} maxLength={120} />
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
          {(form.tipo === "consumo" || form.tipo === "devolucion") && (
            <>
              <label className="g-label" htmlFor="mov-ot">OT (opcional)</label>
              <input id="mov-ot" className="g-input w-full mb-2" value={form.ot} onChange={cambiar("ot")} placeholder="Ej: M-7495" maxLength={40} />
            </>
          )}
          <label className="g-label" htmlFor="mov-notas">Notas (opcional)</label>
          <input id="mov-notas" className="g-input w-full mb-3" value={form.notas} onChange={cambiar("notas")} maxLength={300} />

          {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
          <div className="flex gap-2">
            <button onClick={() => setForm(null)} className="g-btn g-btn-secondary flex-1">Cancelar</button>
            <button onClick={guardar} disabled={enviando} className="g-btn g-btn-primary flex-1">{enviando ? "Guardando…" : "Guardar"}</button>
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
                <div className={`text-[14px] font-semibold truncate ${m.anulado ? "line-through" : ""}`}>{textoMovimiento(m)}</div>
                <div className="text-[12px] text-gypi-dim truncate">{m.nombre || m.sku} · {m.empleado_nombre || (m.legajo ? `Legajo ${m.legajo}` : "—")} · {fechaHora(m.created_at)}{m.anulado ? " · Anulado" : ""}</div>
              </div>
              {puedeAnular(m, { rol: usuario?.rol, empleadoId: usuario?.id }) && (
                <button onClick={() => anular(m)} aria-label={`Anular ${textoMovimiento(m)} de ${m.nombre || m.sku}`}
                  className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-red cursor-pointer">Anular</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
