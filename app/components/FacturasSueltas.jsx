'use client';
// app/components/FacturasSueltas.jsx — Compras → 🧾 Facturas y listas (costo
// de OT, parte D y migración 169; /api/facturas-sueltas). Facturas que no
// pasaron por una orden de compra y listas de precios de proveedores: a mano,
// subiendo un PDF o una foto que lee la IA, o un Excel/CSV que Gypi lee solo
// (app/lib/listasPrecios.js), siempre con vista previa. Cada renglón se
// reconoce con un artículo del MRP; lo que no, queda "Sin asociar" hasta
// elegirlo (Gypi lo recuerda para ese proveedor) o marcarlo "No es del MRP".
// Solo suman precio a la lista de precios: no mueven stock.
import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, sbGetAll } from "../lib/supabase";
import { sugerirArticulos, cantidadTexto } from "../lib/stock";
import { fotoBase64 } from "../lib/foto";
import { textoPrecio } from "../lib/preciosArticulos";
import { COMO_ASOCIADO, MAX_ARCHIVO_B64, TIPOS_DOCUMENTO, netoFactura } from "../lib/facturasSueltas";
import { detectarColumnas, letraColumna, parsearCsv, proveedorDeArchivo, renglonesDeGrilla, sacarIva, sugerirParecidos } from "../lib/listasPrecios";
import { useToast } from "./ui/Toast";
import ArticuloNuevo from "./ArticuloNuevo";

const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
const fechaCorta = (f) => (f ? String(f).split("-").reverse().join("/") : "");
const renglonVacio = () => ({ descripcion: "", codigo: "", cantidad: "", precio: "", sku: null, manual: false });
const facturaVacia = (tipo = "factura") => ({ tipo, proveedor: "", numero: "", fecha: hoy(), moneda: "ARS", tipo_cambio: "", iva: "", otros_impuestos: "", observacion: "", carga: "manual", renglones: [renglonVacio()] });
const num = (v) => {
  const t = String(v ?? "").trim();
  if (!t) return 0;
  const n = t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
  return Number.isFinite(n) ? n : 0;
};
// Más renglones que esto: vista previa sin editar uno por uno (una lista puede traer miles)
const MAX_EDITABLES = 60;
const POR_PAGINA = 50;
const ES_PLANILLA = /\.(xlsx|xlsm|csv|txt)$/i;

async function dataUrlDe(file) {
  return new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = mal; r.readAsDataURL(file); });
}

async function leerArchivo(file) {
  if (file.type === "application/pdf") return { base64: String(await dataUrlDe(file)).split(",")[1], tipo: "application/pdf" };
  return fotoBase64(file);
}

/** Un Excel o CSV como hojas de texto: [{ nombre, grilla, excel }]. */
async function leerPlanilla(file) {
  if (/\.csv$|\.txt$/i.test(file.name)) return [{ nombre: file.name, grilla: parsearCsv(await file.text()), excel: false }];
  const { hojasXlsx, leerHojaXlsx } = await import("../lib/leerXlsx");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return hojasXlsx(bytes)
    .map((nombre) => ({ nombre, grilla: leerHojaXlsx(bytes, nombre, { maxFilas: 8000, maxCols: 60 }) || [], excel: true }))
    .filter((h) => h.grilla.length);
}

/** Lo que va al editor con una hoja de la planilla. */
function borradorDePlanilla(hojas, indice, archivo) {
  const hoja = hojas[indice];
  const cols = detectarColumnas(hoja.grilla, { excel: hoja.excel });
  const { renglones, salteados, demas } = renglonesDeGrilla(hoja.grilla, cols, { excel: hoja.excel });
  return {
    ...facturaVacia("lista"),
    proveedor: proveedorDeArchivo(archivo),
    carga: "planilla",
    moneda: cols.moneda || "ARS",
    precios_con_iva: cols.conIva,
    renglones,
    planilla: { hojas, indice, cols, salteados, demas, archivo },
  };
}

/** Buscador de artículos del MRP (el mismo filtro que Pedir material). */
export function ElegirArticulo({ articulos, etiqueta, onElegir }) {
  const [texto, setTexto] = useState("");
  const { lista, resto } = useMemo(() => sugerirArticulos(articulos, texto, 8), [articulos, texto]);
  return (
    <div className="mt-1">
      <input aria-label={etiqueta} className="g-input w-full text-[13px]" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar artículo del MRP por nombre o código" />
      {lista.length > 0 && (
        <ul className="list-none m-0 p-0 mt-1 flex flex-col gap-1">
          {lista.map((a) => (
            <li key={a.sku}>
              <button type="button" onClick={() => { onElegir(a); setTexto(""); }}
                className="w-full text-left min-h-[40px] px-2.5 rounded-lg border border-gypi-border bg-gypi-bg cursor-pointer text-[13px] text-gypi-text">
                {a.nombre} <span className="text-xs text-gypi-dim">· {a.sku}</span>
              </button>
            </li>
          ))}
          {resto > 0 && <li className="text-xs text-gypi-dim">Hay {resto} más: escribí más letras.</li>}
        </ul>
      )}
    </div>
  );
}

/** Columnas de la planilla: Gypi las elige solo y se pueden cambiar. */
function ColumnasPlanilla({ planilla, onCambiar }) {
  const hoja = planilla.hojas[planilla.indice];
  const titulos = planilla.cols.titulos >= 0 ? hoja.grilla[planilla.cols.titulos] || [] : [];
  const ancho = Math.max(0, ...hoja.grilla.slice(0, 60).map((f) => f.length));
  const opciones = Array.from({ length: ancho }, (_, i) => [i, `${letraColumna(i)}${titulos[i] ? ` · ${String(titulos[i]).slice(0, 30)}` : ""}`]);
  const elegir = (campo) => (e) => onCambiar({ ...planilla.cols, [campo]: Number(e.target.value) });
  return (
    <div className="p-2 rounded-lg border border-gypi-border bg-gypi-bg mb-2">
      <div className="text-xs text-gypi-dim mb-1.5">
        📊 {planilla.archivo}: {planilla.cols.porTitulos ? `Gypi encontró los títulos en la fila ${planilla.cols.titulos + 1}.` : "no encontré títulos; elegí las columnas si no son estas."}
      </div>
      {planilla.hojas.length > 1 && (
        <label className="block text-xs text-gypi-dim mb-1.5">Hoja
          <select className="g-input w-full" value={planilla.indice} onChange={(e) => onCambiar(null, Number(e.target.value))}>
            {planilla.hojas.map((h, i) => <option key={h.nombre} value={i}>{h.nombre}</option>)}
          </select>
        </label>
      )}
      <div className="grid grid-cols-3 gap-1.5">
        {[["descripcion", "Descripción"], ["codigo", "Código"], ["precio", "Precio"]].map(([campo, label]) => (
          <label key={campo} className="text-xs text-gypi-dim">{label}
            <select aria-label={`Columna de ${label.toLowerCase()}`} className="g-input w-full text-[13px]" value={planilla.cols[campo]} onChange={elegir(campo)}>
              <option value={-1}>—</option>
              {opciones.map(([i, t]) => <option key={i} value={i}>{t}</option>)}
            </select>
          </label>
        ))}
      </div>
      {(planilla.salteados > 0 || planilla.demas > 0) && (
        <div className="text-xs text-gypi-dim mt-1.5">
          {planilla.salteados > 0 ? `Salteé ${planilla.salteados} fila(s) sin descripción o sin precio (títulos de rubro, vacías). ` : ""}
          {planilla.demas > 0 ? `Quedaron afuera ${planilla.demas} renglón(es): hasta 5000 por lista.` : ""}
        </div>
      )}
    </div>
  );
}

function Editor({ inicial, articulos, onGuardada, onCancelar }) {
  const toast = useToast();
  const [f, setF] = useState(inicial);
  const [guardando, setGuardando] = useState(false);
  const nombres = useMemo(() => new Map(articulos.map((a) => [a.sku, a.nombre])), [articulos]);
  const esLista = f.tipo === "lista";
  const cambiar = (campo) => (e) => setF((x) => ({ ...x, [campo]: e.target.value }));
  const cambiarRenglon = (i, cambios) => setF((x) => ({ ...x, renglones: x.renglones.map((r, j) => (j === i ? { ...r, ...cambios } : r)) }));
  const neto = netoFactura(f.renglones.map((r) => ({ cantidad: esLista ? 1 : num(r.cantidad), precio: num(r.precio) })));
  const compacto = f.renglones.length > MAX_EDITABLES;

  const cambiarColumnas = (cols, indice) => setF((x) => {
    const p = x.planilla;
    const hojaIndice = indice ?? p.indice;
    const hoja = p.hojas[hojaIndice];
    const nuevas = cols || detectarColumnas(hoja.grilla, { excel: hoja.excel });
    const { renglones, salteados, demas } = renglonesDeGrilla(hoja.grilla, nuevas, { excel: hoja.excel });
    return { ...x, renglones, planilla: { ...p, indice: hojaIndice, cols: nuevas, salteados, demas } };
  });

  const guardar = async () => {
    setGuardando(true);
    try {
      const datos = { ...f };
      delete datos.planilla;
      delete datos.precios_con_iva;
      const res = await apiFetch("/api/facturas-sueltas", { method: "POST", body: JSON.stringify({ accion: "guardar", ...datos }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) throw new Error(d.error || "No se pudo guardar");
      const que = esLista ? "Lista guardada" : "Factura guardada";
      toast.success(d.sinAsociar ? `✅ ${que}: ${d.asociados} artículo(s) reconocidos y ${d.sinAsociar} en Sin asociar.` : `✅ ${que} con todos los artículos`);
      onGuardada(d);
    } catch (e) {
      toast.error(e.message);
    }
    setGuardando(false);
  };

  const titulo = f.carga === "ia" ? "🤖 Revisá lo que leyó la IA antes de guardar" : f.carga === "planilla" ? "📊 Revisá la lista antes de guardar" : esLista ? "📋 Lista de precios a mano" : "📄 Factura a mano";

  return (
    <section aria-label={esLista ? "Lista de precios" : "Factura suelta"} className="bg-gypi-surface rounded-xl border border-gypi-border p-3 mb-3">
      <div className="text-[14px] font-bold mb-1">{titulo}</div>
      <div role="radiogroup" aria-label="Tipo de documento" className="flex gap-1.5 mb-2">
        {Object.entries(TIPOS_DOCUMENTO).map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={f.tipo === id} onClick={() => setF((x) => ({ ...x, tipo: id }))}
            className={`min-h-[36px] px-2.5 rounded-lg border text-xs font-semibold cursor-pointer ${f.tipo === id ? "bg-gypi-amber/15 border-gypi-amber text-gypi-amber-ink" : "bg-gypi-bg border-gypi-border text-gypi-dim"}`}>
            {label}
          </button>
        ))}
      </div>
      {f.precios_con_iva && (
        <div role="alert" className="text-xs font-semibold text-gypi-red mb-2 flex flex-wrap items-center gap-2">
          <span className="flex-1">⚠ Los precios parecen tener IVA incluido. Tienen que quedar sin IVA.</span>
          <button type="button" onClick={() => setF((x) => ({ ...x, renglones: sacarIva(x.renglones, 21), precios_con_iva: false }))}
            className="min-h-[36px] px-2 rounded-lg border border-gypi-red bg-transparent cursor-pointer text-xs text-gypi-red font-semibold">➗ Sacar el IVA (21 %)</button>
        </div>
      )}
      {f.planilla && <ColumnasPlanilla planilla={f.planilla} onCambiar={cambiarColumnas} />}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <label className="col-span-2 text-xs text-gypi-dim">Proveedor
          <input className="g-input w-full" value={f.proveedor} onChange={cambiar("proveedor")} />
        </label>
        <label className="text-xs text-gypi-dim">{esLista ? "N° o nombre de la lista" : "N° de factura"}
          <input className="g-input w-full" value={f.numero} onChange={cambiar("numero")} placeholder={esLista ? "Lista noviembre" : "0003-00012345"} />
        </label>
        <label className="text-xs text-gypi-dim">{esLista ? "Fecha de la lista" : "Fecha"}
          <input type="date" className="g-input w-full" value={f.fecha} onChange={cambiar("fecha")} />
        </label>
        <label className="text-xs text-gypi-dim">Moneda
          <select className="g-input w-full" value={f.moneda} onChange={cambiar("moneda")}>
            <option value="ARS">Pesos</option>
            <option value="USD">Dólares</option>
          </select>
        </label>
        {f.moneda === "USD" && (
          <label className="text-xs text-gypi-dim">Tipo de cambio
            <input className="g-input w-full" inputMode="decimal" value={f.tipo_cambio} onChange={cambiar("tipo_cambio")} />
          </label>
        )}
      </div>
      <div className="g-label mb-1">{esLista ? `Artículos de la lista (precio sin IVA)${f.renglones.length ? ` · ${f.renglones.length}` : ""}` : "Renglones (precio unitario sin IVA)"}</div>
      {compacto ? (
        <div>
          <div className="text-xs text-gypi-dim mb-1">Son {f.renglones.length} renglones: Gypi reconoce los artículos al guardar y los que no pueda quedan en Sin asociar. Primeros 15:</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-gypi-dim text-left"><th className="py-1 pr-2">Descripción</th><th className="py-1 pr-2">Código</th><th className="py-1 text-right">Precio</th></tr>
              </thead>
              <tbody>
                {f.renglones.slice(0, 15).map((r, i) => (
                  <tr key={i} className="border-t border-gypi-border">
                    <td className="py-1 pr-2">{r.descripcion}{r.sku ? <span className="text-gypi-green"> · ✓ {nombres.get(r.sku) || r.sku}</span> : null}{r.detalle ? <div className="text-gypi-dim">{r.detalle}</div> : null}</td>
                    <td className="py-1 pr-2 text-gypi-dim">{r.codigo}</td>
                    <td className="py-1 text-right">{textoPrecio(num(r.precio), f.moneda)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <>
          <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
            {f.renglones.map((r, i) => (
              <li key={i} className="p-2 rounded-lg border border-gypi-border bg-gypi-bg">
                <div className="flex gap-1.5">
                  <input aria-label={`Descripción del renglón ${i + 1}`} className="g-input flex-1 min-w-0 text-[13px]" value={r.descripcion} placeholder="Descripción"
                    onChange={(e) => cambiarRenglon(i, { descripcion: e.target.value })} />
                  <button type="button" aria-label={`Quitar renglón ${i + 1}`} onClick={() => setF((x) => ({ ...x, renglones: x.renglones.filter((_, j) => j !== i) }))}
                    className="min-w-[40px] min-h-[40px] rounded-lg border border-gypi-border bg-transparent cursor-pointer text-gypi-dim">✕</button>
                </div>
                {r.detalle && <div className="text-xs text-gypi-dim mt-1">{r.detalle}</div>}
                <div className={`grid ${esLista ? "grid-cols-2" : "grid-cols-3"} gap-1.5 mt-1.5`}>
                  <input aria-label={`Código del renglón ${i + 1}`} className="g-input text-[13px]" value={r.codigo} placeholder="Código" onChange={(e) => cambiarRenglon(i, { codigo: e.target.value })} />
                  {!esLista && <input aria-label={`Cantidad del renglón ${i + 1}`} className="g-input text-[13px] text-right" inputMode="decimal" value={r.cantidad} placeholder="Cantidad" onChange={(e) => cambiarRenglon(i, { cantidad: e.target.value })} />}
                  <input aria-label={`Precio del renglón ${i + 1}`} className="g-input text-[13px] text-right" inputMode="decimal" value={r.precio} placeholder="Precio" onChange={(e) => cambiarRenglon(i, { precio: e.target.value })} />
                </div>
                {r.sku ? (
                  <div className="text-xs mt-1 flex items-center gap-1.5">
                    <span className="flex-1 text-gypi-green font-semibold">✓ {nombres.get(r.sku) || r.nombre_articulo || r.sku} <span className="text-gypi-dim font-normal">· {COMO_ASOCIADO[r.manual ? "manual" : r.como] || COMO_ASOCIADO.manual}</span></span>
                    <button type="button" onClick={() => cambiarRenglon(i, { sku: null, manual: false, como: null })} className="min-h-[36px] px-2 bg-transparent border-none cursor-pointer text-xs text-gypi-dim underline">Cambiar</button>
                  </div>
                ) : (
                  <>
                    <div className="text-xs text-gypi-dim mt-1">Sin artículo: Gypi lo intenta reconocer al guardar; si no puede, queda en Sin asociar.</div>
                    <ElegirArticulo articulos={articulos} etiqueta={`Artículo del renglón ${i + 1}`} onElegir={(a) => cambiarRenglon(i, { sku: a.sku, manual: true })} />
                  </>
                )}
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setF((x) => ({ ...x, renglones: [...x.renglones, renglonVacio()] }))} className="g-btn g-btn-secondary mt-2">➕ Agregar renglón</button>
        </>
      )}
      {!esLista && (
        <>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="flex-1 text-[13px] font-semibold">Neto sin IVA</span>
            <span className="text-[15px] font-bold">{textoPrecio(neto, f.moneda)}</span>
          </div>
          <div className="flex items-end gap-2 mt-2">
            <div className="flex-1 min-w-0">
              <label className="g-label" htmlFor="fs-iva">IVA</label>
              <input id="fs-iva" className="g-input w-full text-right" inputMode="decimal" value={f.iva ?? ""} placeholder="0" onChange={cambiar("iva")} />
            </div>
            <button type="button" className="g-btn g-btn-secondary" onClick={() => setF((x) => ({ ...x, iva: String(Math.round(neto * 21) / 100).replace(".", ",") }))}>21 %</button>
            <div className="flex-1 min-w-0">
              <label className="g-label" htmlFor="fs-otros">Otros impuestos</label>
              <input id="fs-otros" className="g-input w-full text-right" inputMode="decimal" value={f.otros_impuestos ?? ""} placeholder="0" onChange={cambiar("otros_impuestos")} />
            </div>
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="flex-1 text-[13px] font-semibold">Total</span>
            <span className="text-[15px] font-bold">{textoPrecio(neto + (num(f.iva) || 0) + (num(f.otros_impuestos) || 0), f.moneda)}</span>
          </div>
        </>
      )}
      <div className="flex gap-2 mt-2">
        <button type="button" onClick={guardar} disabled={guardando || !f.renglones.length} className="g-btn g-btn-primary flex-1">{guardando ? "Guardando…" : esLista ? "💾 Guardar lista" : "💾 Guardar factura"}</button>
        <button type="button" onClick={onCancelar} className="g-btn g-btn-secondary">Cancelar</button>
      </div>
    </section>
  );
}

function DetalleFactura({ id, articulos, onCambio }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let vivo = true;
    apiFetch(`/api/facturas-sueltas?id=${id}`).then((r) => (r.ok ? r.json() : null)).then((x) => { if (vivo) setD(x); }).catch(() => {});
    return () => { vivo = false; };
  }, [id, version]);
  const nombres = useMemo(() => new Map(articulos.map((a) => [a.sku, a.nombre])), [articulos]);
  const restaurar = async (r) => {
    try {
      const res = await apiFetch("/api/facturas-sueltas", { method: "POST", body: JSON.stringify({ accion: "restaurar", renglon_id: r.id }) });
      const x = await res.json().catch(() => ({}));
      if (!res.ok || x.error) throw new Error(x.error || "No se pudo deshacer");
      setVersion((v) => v + 1);
      onCambio?.();
    } catch (e) {
      toast.error(e.message);
    }
  };
  if (!d?.ok) return <div className="text-xs text-gypi-dim mt-1">Cargando…</div>;
  const esLista = d.factura.tipo === "lista";
  const visibles = d.renglones.slice(0, 300);
  return (
    <ul className="list-none m-0 p-0 mt-1.5 flex flex-col gap-1">
      {visibles.map((r) => (
        <li key={r.id} className="text-xs">
          <span className="font-semibold">{r.descripcion}</span>{r.codigo ? ` · cód. ${r.codigo}` : ""} · {esLista ? "" : `${cantidadTexto(r.cantidad)} × `}{textoPrecio(Number(r.precio), d.factura.moneda)}
          {r.detalle && <div className="text-gypi-dim">{r.detalle}</div>}
          {r.sku ? <div className="text-gypi-green">✓ {nombres.get(r.sku) || r.sku}</div>
            : r.asociado_como === "descartado" ? (
              <div className="text-gypi-dim">{COMO_ASOCIADO.descartado}{" "}
                <button type="button" onClick={() => restaurar(r)} className="min-h-[32px] bg-transparent border-none cursor-pointer text-xs text-gypi-dim underline p-0">Deshacer</button>
              </div>
            ) : <div className="text-gypi-red">Sin asociar</div>}
        </li>
      ))}
      {d.renglones.length > visibles.length && <li className="text-xs text-gypi-dim">y {d.renglones.length - visibles.length} renglones más.</li>}
    </ul>
  );
}

/** Un renglón sin artículo: sugerencias, buscador y "No es del MRP". */
function RenglonSinAsociar({ r, articulos, elegido, onTildar, onAsociar, onDescartar, onArticuloNuevo }) {
  const [creando, setCreando] = useState(false);
  // Si la descripción sola no se parece a nada (por ejemplo, es un código), se prueba con el resto de la fila
  const parecidos = useMemo(() => {
    const solo = sugerirParecidos(r.descripcion, articulos, 5);
    return solo.length || !r.detalle ? solo : sugerirParecidos(`${r.descripcion} ${r.detalle}`, articulos, 5);
  }, [r.descripcion, r.detalle, articulos]);
  const doc = r.facturas_sueltas || {};
  const esLista = doc.tipo === "lista";
  return (
    <li className={`p-2.5 rounded-xl border ${elegido ? "border-gypi-amber bg-gypi-amber/10" : "border-gypi-red bg-gypi-red/10"}`}>
      <div className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5 w-5 h-5 shrink-0" checked={elegido} onChange={() => onTildar(r.id)} aria-label={`Elegir ${r.descripcion}`} />
        <div className="text-[13px] font-semibold flex-1">{r.descripcion}{r.codigo ? <span className="text-xs text-gypi-dim"> · cód. {r.codigo}</span> : null}</div>
      </div>
      {r.detalle && <div className="text-xs text-gypi-text">{r.detalle}</div>}
      <div className="text-xs text-gypi-dim">
        {esLista ? "📋 " : "🧾 "}{doc.proveedor}{doc.numero ? ` · ${esLista ? "" : "N° "}${doc.numero}` : ""} · {fechaCorta(doc.fecha)} · {esLista ? "" : `${cantidadTexto(r.cantidad)} × `}{textoPrecio(Number(r.precio), doc.moneda)}
      </div>
      {parecidos.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {parecidos.slice(0, 3).map((a) => (
            <button key={a.sku} type="button" onClick={() => onAsociar(r, a)}
              className="min-h-[36px] px-2 rounded-lg border border-gypi-border bg-gypi-surface cursor-pointer text-xs text-gypi-text text-left">
              ¿Es {a.nombre}?
            </button>
          ))}
        </div>
      )}
      <ElegirArticulo articulos={articulos} etiqueta={`Artículo para ${r.descripcion}`} onElegir={(a) => onAsociar(r, a)} />
      <div className="flex flex-wrap gap-3 mt-1">
        <button type="button" onClick={() => onDescartar(r)} className="min-h-[36px] bg-transparent border-none cursor-pointer text-xs text-gypi-dim underline p-0">🚫 No es del MRP</button>
        {onArticuloNuevo && !creando && (
          <button type="button" onClick={() => setCreando(true)} className="min-h-[36px] bg-transparent border-none cursor-pointer text-xs text-gypi-text font-semibold underline p-0">➕ Cargar artículo nuevo en MRP</button>
        )}
      </div>
      {creando && (
        <div className="mt-2">
          <ArticuloNuevo articulos={articulos} nombreInicial={r.descripcion} inicial={doc.proveedor ? { proveedor_principal: doc.proveedor } : null}
            sugeridos={parecidos} aviso={`Para el renglón "${r.descripcion}". Al cargarlo queda asociado y su precio entra a la lista de precios.`}
            onCancelar={() => setCreando(false)} onCreado={(a) => { setCreando(false); onArticuloNuevo(r, a); }} />
        </div>
      )}
    </li>
  );
}

function SinAsociar({ datos, articulos, onAsociar, onDescartar, onDescartarDoc, onDescartarVarios, onArticuloNuevo }) {
  const [texto, setTexto] = useState("");
  const [elegidos, setElegidos] = useState(() => new Set());
  const [marcando, setMarcando] = useState(false);
  const [doc, setDoc] = useState("");
  const [paginas, setPaginas] = useState(1);
  const docs = useMemo(() => {
    const m = new Map();
    for (const r of datos.renglones) {
      const x = m.get(r.factura_id) || { id: r.factura_id, f: r.facturas_sueltas || {}, n: 0 };
      x.n++;
      m.set(r.factura_id, x);
    }
    return [...m.values()];
  }, [datos.renglones]);
  const filtrados = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return datos.renglones.filter((r) => (!doc || String(r.factura_id) === doc)
      && (!t || [r.descripcion, r.codigo, r.detalle, r.facturas_sueltas?.proveedor].some((v) => String(v || "").toLowerCase().includes(t))));
  }, [datos.renglones, texto, doc]);
  const visibles = filtrados.slice(0, paginas * POR_PAGINA);
  const elegido = docs.find((x) => String(x.id) === doc);
  // Los tildados que siguen en la lista (al recargar, los ya resueltos se van solos)
  const tildados = datos.renglones.filter((r) => elegidos.has(r.id)).map((r) => r.id);
  const tildar = (id) => setElegidos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const tildarVisibles = () => setElegidos(new Set([...tildados, ...visibles.map((r) => r.id)]));
  const descartarTildados = async () => {
    setMarcando(true);
    const ok = await onDescartarVarios(tildados);
    if (ok) setElegidos(new Set());
    setMarcando(false);
  };

  if (datos.renglones.length === 0) return <div className="text-[13px] text-gypi-green">✅ No hay renglones sin asociar.</div>;
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <input aria-label="Buscar en Sin asociar" className="g-input w-full text-[13px]" value={texto} onChange={(e) => { setTexto(e.target.value); setPaginas(1); }} placeholder="Buscar por texto, código o proveedor" />
        <select aria-label="Documento" className="g-input w-full text-[13px]" value={doc} onChange={(e) => { setDoc(e.target.value); setPaginas(1); }}>
          <option value="">Todos los documentos</option>
          {docs.map((x) => (
            <option key={x.id} value={String(x.id)}>{x.f.tipo === "lista" ? "📋" : "🧾"} {x.f.proveedor}{x.f.numero ? ` · ${x.f.numero}` : ""} · {fechaCorta(x.f.fecha)} ({x.n})</option>
          ))}
        </select>
      </div>
      {elegido && (
        <button type="button" onClick={() => onDescartarDoc(elegido)} className="g-btn g-btn-secondary mb-2">
          🚫 Los {elegido.n} que quedan de este documento no son del MRP
        </button>
      )}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <button type="button" onClick={tildarVisibles} className="min-h-[36px] bg-transparent border-none cursor-pointer text-xs text-gypi-dim underline p-0">☑ Tildar los {visibles.length} que se ven</button>
        {tildados.length > 0 && (
          <>
            <button type="button" onClick={descartarTildados} disabled={marcando} className="g-btn g-btn-secondary">{marcando ? "Marcando…" : `🚫 No es del MRP (${tildados.length})`}</button>
            <button type="button" onClick={() => setElegidos(new Set())} className="min-h-[36px] bg-transparent border-none cursor-pointer text-xs text-gypi-dim underline p-0">Destildar</button>
          </>
        )}
      </div>
      <div className="text-xs text-gypi-dim mb-1.5">{filtrados.length} renglón(es){filtrados.length !== datos.renglones.length ? ` de ${datos.renglones.length}` : ""}. Lo que elijas, Gypi lo recuerda para la próxima lista o factura de ese proveedor.</div>
      <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
        {visibles.map((r) => (
          <RenglonSinAsociar key={r.id} r={r} articulos={articulos} elegido={elegidos.has(r.id)} onTildar={tildar}
            onAsociar={onAsociar} onDescartar={onDescartar} onArticuloNuevo={onArticuloNuevo} />
        ))}
      </ul>
      {filtrados.length > visibles.length && (
        <button type="button" onClick={() => setPaginas((p) => p + 1)} className="g-btn g-btn-secondary mt-2">Ver {Math.min(POR_PAGINA, filtrados.length - visibles.length)} más</button>
      )}
    </div>
  );
}

export default function FacturasSueltas() {
  const toast = useToast();
  const [vista, setVista] = useState("facturas");
  const [datos, setDatos] = useState(null);
  const [sinAsociar, setSinAsociar] = useState(null);
  const [articulos, setArticulos] = useState([]);
  const [editor, setEditor] = useState(null);
  const [leyendo, setLeyendo] = useState(false);
  const [abierta, setAbierta] = useState(null);
  const [version, setVersion] = useState(0);
  const archivo = useRef(null);
  const recargar = () => setVersion((v) => v + 1);

  useEffect(() => {
    sbGetAll("articulos_stock?activo=eq.true&select=sku,nombre,unidad,division,familia,tipo,marca,color,pack,proveedor_principal,multiplo,plazo_dias&order=sku.asc", { maxFilas: 20000 })
      .then(({ data }) => setArticulos(data || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let vivo = true;
    const urls = vista === "sin" ? ["/api/facturas-sueltas?vista=sin_asociar", "/api/facturas-sueltas"] : ["/api/facturas-sueltas"];
    Promise.all(urls.map((u) => apiFetch(u).then((r) => (r.ok ? r.json() : null))))
      .then(([a, b]) => {
        if (!vivo) return;
        if (vista === "sin") { setSinAsociar(a); setDatos(b); } else setDatos(a);
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [vista, version]);

  const subir = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setLeyendo(true);
    try {
      if (/\.xls$/i.test(file.name)) throw new Error("Ese Excel es del formato viejo (.xls): abrilo y guardalo como .xlsx, o subí un PDF.");
      if (ES_PLANILLA.test(file.name)) {
        const hojas = await leerPlanilla(file);
        if (!hojas.length) throw new Error("La planilla está vacía.");
        // La hoja donde se encuentran los títulos, o la primera
        const indice = Math.max(0, hojas.findIndex((h) => detectarColumnas(h.grilla, { excel: h.excel }).porTitulos));
        const b = borradorDePlanilla(hojas, indice, file.name);
        if (!b.renglones.length) toast.error("No encontré renglones con descripción y precio: elegí las columnas.");
        setEditor(b);
      } else {
        const { base64, tipo } = await leerArchivo(file);
        if (base64.length > MAX_ARCHIVO_B64) throw new Error("El archivo es muy grande: hasta 3 MB. Si es una lista de precios, subila en Excel.");
        const res = await apiFetch("/api/facturas-sueltas", { method: "POST", body: JSON.stringify({ accion: "leer", archivo: base64, tipo }) });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || d.error) throw new Error(d.error || "No se pudo leer el archivo");
        const b = d.borrador;
        setEditor({ ...facturaVacia(b.tipo), ...b, fecha: b.fecha || hoy(), carga: "ia", renglones: b.renglones.length ? b.renglones.map((r) => ({ ...renglonVacio(), ...r })) : [renglonVacio()] });
      }
    } catch (err) {
      toast.error(err.message || "No se pudo leer el archivo");
    }
    setLeyendo(false);
  };

  const post = async (cuerpo, error) => {
    const res = await apiFetch("/api/facturas-sueltas", { method: "POST", body: JSON.stringify(cuerpo) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.error) throw new Error(d.error || error);
    return d;
  };

  const anular = async (f) => {
    const que = f.tipo === "lista" ? "la lista" : "la factura";
    if (!window.confirm(`¿Anular ${que} de ${f.proveedor}${f.numero ? ` N° ${f.numero}` : ""}? Sus precios salen de la lista de precios.`)) return;
    try {
      await post({ accion: "anular", id: f.id }, "No se pudo anular");
      recargar();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const asociar = async (r, a) => {
    try {
      await post({ accion: "asociar", renglon_id: r.id, sku: a.sku }, "No se pudo asociar");
      toast.success(`✅ Asociado a ${a.nombre}. La próxima vez Gypi lo reconoce solo.`);
      recargar();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const descartar = async (r) => {
    try {
      await post({ accion: "descartar", renglon_ids: [r.id] }, "No se pudo marcar");
      recargar();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const descartarVarios = async (ids) => {
    if (!ids.length) return false;
    try {
      let total = 0;
      for (let i = 0; i < ids.length; i += 500) total += (await post({ accion: "descartar", renglon_ids: ids.slice(i, i + 500) }, "No se pudo marcar")).descartados || 0;
      toast.success(`✅ ${total} renglón(es) fuera de Sin asociar.`);
      recargar();
      return true;
    } catch (e) {
      toast.error(e.message);
      return false;
    }
  };

  // Artículo nuevo cargado desde Sin asociar: se suma a la lista y queda asociado a ese renglón
  const articuloNuevo = async (r, a) => {
    setArticulos((prev) => [...prev.filter((x) => x.sku !== a.sku), a]);
    await asociar(r, a);
  };

  const descartarDoc = async (x) => {
    if (!window.confirm(`¿Marcar los ${x.n} renglones sin asociar de ${x.f.proveedor} como "No es del MRP"? Se puede deshacer de a uno desde el documento.`)) return;
    try {
      const d = await post({ accion: "descartar", factura_id: x.id }, "No se pudo marcar");
      toast.success(`✅ ${d.descartados} renglón(es) fuera de Sin asociar.`);
      recargar();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const falta = (vista === "sin" ? sinAsociar : datos)?.falta_migracion;
  if (falta) return <div role="alert" className="p-3 rounded-[10px] bg-gypi-red/10 text-gypi-red text-[14px]">{falta}</div>;

  return (
    <div>
      <div className="text-xs text-gypi-dim mb-2">Facturas que no pasaron por una orden de compra y listas de precios de proveedores (PDF, foto o Excel). Su precio entra a la lista de precios de cada artículo; no mueven stock.</div>
      {editor ? (
        <Editor key={`${editor.carga}|${editor.proveedor}|${editor.planilla?.archivo || ""}`} inicial={editor} articulos={articulos}
          onGuardada={() => { setEditor(null); setVista("facturas"); recargar(); }} onCancelar={() => setEditor(null)} />
      ) : (
        <div className="flex flex-wrap gap-2 mb-3">
          <button type="button" onClick={() => setEditor(facturaVacia())} className="g-btn g-btn-secondary">➕ Factura a mano</button>
          <button type="button" onClick={() => archivo.current?.click()} disabled={leyendo} className="g-btn g-btn-secondary">{leyendo ? "🤖 Leyendo…" : "📎 Subir factura o lista (PDF, foto o Excel)"}</button>
          <input ref={archivo} type="file" accept="application/pdf,image/*,.xlsx,.xlsm,.xls,.csv,text/csv" className="hidden" aria-label="Archivo de la factura o lista" onChange={subir} />
        </div>
      )}
      <div role="tablist" aria-label="Facturas y listas" className="flex gap-1.5 mb-2">
        {[["facturas", "Documentos"], ["sin", `Sin asociar${datos?.sinAsociar ? ` (${datos.sinAsociar})` : ""}`]].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={vista === id} onClick={() => setVista(id)}
            className={`min-h-[40px] px-3 rounded-lg border text-[13px] font-semibold cursor-pointer ${vista === id ? "bg-gypi-amber/15 border-gypi-amber text-gypi-amber-ink" : "bg-gypi-bg border-gypi-border text-gypi-dim"}`}>
            {label}
          </button>
        ))}
      </div>
      {vista === "facturas" ? (
        !datos?.ok ? <div className="text-[13px] text-gypi-dim">Cargando…</div> : datos.facturas.length === 0 ? (
          <div className="text-[13px] text-gypi-dim">Todavía no hay facturas sueltas ni listas de precios.</div>
        ) : (
          <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
            {datos.facturas.map((f) => {
              const rs = f.facturas_sueltas_renglones || [];
              const asociados = rs.filter((r) => r.sku).length;
              const descartados = rs.filter((r) => !r.sku && r.asociado_como === "descartado").length;
              const pendientes = rs.length - asociados - descartados;
              const esLista = f.tipo === "lista";
              return (
                <li key={f.id} className={`p-2.5 rounded-xl border border-gypi-border bg-gypi-surface ${f.anulada_at ? "opacity-60" : ""}`}>
                  <div className="flex items-baseline gap-2">
                    <span className={`flex-1 text-[14px] font-semibold ${f.anulada_at ? "line-through" : ""}`}>{esLista ? "📋 " : "🧾 "}{f.proveedor}{f.numero ? ` · ${esLista ? "" : "N° "}${f.numero}` : ""}</span>
                    <span className="text-[13px] font-bold">{esLista ? `${rs.length} artículos` : textoPrecio(netoFactura(rs), f.moneda)}</span>
                  </div>
                  <div className="text-xs text-gypi-dim">
                    {fechaCorta(f.fecha)} · {f.carga === "ia" ? "🤖 leída por la IA" : f.carga === "planilla" ? "📊 desde Excel" : "a mano"}{f.cargada_por_nombre ? ` · ${f.cargada_por_nombre}` : ""} ·{" "}
                    <span className={pendientes > 0 ? "text-gypi-red font-semibold" : "text-gypi-green"}>{asociados} de {rs.length} asociados</span>
                    {descartados > 0 ? ` · ${descartados} no son del MRP` : ""}
                    {f.anulada_at ? ` · anulada${f.anulada_por_nombre ? ` por ${f.anulada_por_nombre}` : ""}` : ""}
                  </div>
                  <div className="flex gap-2 mt-1">
                    <button type="button" onClick={() => setAbierta(abierta === f.id ? null : f.id)} className="min-h-[36px] bg-transparent border-none cursor-pointer text-xs text-gypi-dim underline p-0">{abierta === f.id ? "Ocultar renglones" : "Ver renglones"}</button>
                    {!f.anulada_at && <button type="button" onClick={() => anular(f)} className="min-h-[36px] bg-transparent border-none cursor-pointer text-xs text-gypi-red underline p-0">Anular</button>}
                  </div>
                  {abierta === f.id && <DetalleFactura id={f.id} articulos={articulos} onCambio={recargar} />}
                </li>
              );
            })}
          </ul>
        )
      ) : !sinAsociar?.ok ? <div className="text-[13px] text-gypi-dim">Cargando…</div> : (
        <SinAsociar datos={sinAsociar} articulos={articulos} onAsociar={asociar} onDescartar={descartar} onDescartarDoc={descartarDoc}
          onDescartarVarios={descartarVarios} onArticuloNuevo={articuloNuevo} />
      )}
    </div>
  );
}
