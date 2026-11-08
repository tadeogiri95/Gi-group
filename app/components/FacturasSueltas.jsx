'use client';
// app/components/FacturasSueltas.jsx — Compras → 📄 Facturas sueltas (costo de
// OT, parte D; /api/facturas-sueltas). Facturas que no pasaron por una orden
// de compra: a mano o subiendo un PDF o una foto que lee la IA, siempre con
// vista previa. Cada renglón se reconoce con un artículo del MRP; lo que no,
// queda "Sin asociar" hasta elegirlo, y Gypi lo recuerda para ese proveedor.
// Solo suman precio a la lista de precios: no mueven stock.
import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, sbGetAll } from "../lib/supabase";
import { sugerirArticulos, cantidadTexto } from "../lib/stock";
import { fotoBase64 } from "../lib/foto";
import { textoPrecio } from "../lib/preciosArticulos";
import { COMO_ASOCIADO, MAX_ARCHIVO_B64, netoFactura } from "../lib/facturasSueltas";
import { useToast } from "./ui/Toast";

const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
const fechaCorta = (f) => (f ? String(f).split("-").reverse().join("/") : "");
const renglonVacio = () => ({ descripcion: "", codigo: "", cantidad: "", precio: "", sku: null, manual: false });
const facturaVacia = () => ({ proveedor: "", numero: "", fecha: hoy(), moneda: "ARS", tipo_cambio: "", observacion: "", carga: "manual", renglones: [renglonVacio()] });
const num = (v) => {
  const t = String(v ?? "").trim();
  if (!t) return 0;
  const n = t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
  return Number.isFinite(n) ? n : 0;
};

async function leerArchivo(file) {
  if (file.type === "application/pdf") {
    const dataUrl = await new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = mal; r.readAsDataURL(file); });
    return { base64: String(dataUrl).split(",")[1], tipo: "application/pdf" };
  }
  return fotoBase64(file);
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

function Editor({ inicial, articulos, onGuardada, onCancelar }) {
  const toast = useToast();
  const [f, setF] = useState(inicial);
  const [guardando, setGuardando] = useState(false);
  const nombres = useMemo(() => new Map(articulos.map((a) => [a.sku, a.nombre])), [articulos]);
  const cambiar = (campo) => (e) => setF((x) => ({ ...x, [campo]: e.target.value }));
  const cambiarRenglon = (i, cambios) => setF((x) => ({ ...x, renglones: x.renglones.map((r, j) => (j === i ? { ...r, ...cambios } : r)) }));
  const neto = netoFactura(f.renglones.map((r) => ({ cantidad: num(r.cantidad), precio: num(r.precio) })));

  const guardar = async () => {
    setGuardando(true);
    try {
      const res = await apiFetch("/api/facturas-sueltas", { method: "POST", body: JSON.stringify({ accion: "guardar", ...f }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) throw new Error(d.error || "No se pudo guardar la factura");
      toast.success(d.sinAsociar ? `✅ Factura guardada. ${d.sinAsociar} renglón(es) quedaron en Sin asociar.` : "✅ Factura guardada con todos los artículos");
      onGuardada(d);
    } catch (e) {
      toast.error(e.message);
    }
    setGuardando(false);
  };

  return (
    <section aria-label="Factura suelta" className="bg-gypi-surface rounded-xl border border-gypi-border p-3 mb-3">
      <div className="text-[14px] font-bold mb-1">{f.carga === "ia" ? "🤖 Revisá lo que leyó la IA antes de guardar" : "📄 Factura a mano"}</div>
      {f.precios_con_iva && <div role="alert" className="text-xs font-semibold text-gypi-red mb-2">⚠ La factura parece tener los precios con IVA incluido. Corregí cada precio unitario a sin IVA antes de guardar.</div>}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <label className="col-span-2 text-xs text-gypi-dim">Proveedor
          <input className="g-input w-full" value={f.proveedor} onChange={cambiar("proveedor")} />
        </label>
        <label className="text-xs text-gypi-dim">N° de factura
          <input className="g-input w-full" value={f.numero} onChange={cambiar("numero")} placeholder="0003-00012345" />
        </label>
        <label className="text-xs text-gypi-dim">Fecha
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
      <div className="g-label mb-1">Renglones (precio unitario sin IVA)</div>
      <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
        {f.renglones.map((r, i) => (
          <li key={i} className="p-2 rounded-lg border border-gypi-border bg-gypi-bg">
            <div className="flex gap-1.5">
              <input aria-label={`Descripción del renglón ${i + 1}`} className="g-input flex-1 min-w-0 text-[13px]" value={r.descripcion} placeholder="Descripción"
                onChange={(e) => cambiarRenglon(i, { descripcion: e.target.value })} />
              <button type="button" aria-label={`Quitar renglón ${i + 1}`} onClick={() => setF((x) => ({ ...x, renglones: x.renglones.filter((_, j) => j !== i) }))}
                className="min-w-[40px] min-h-[40px] rounded-lg border border-gypi-border bg-transparent cursor-pointer text-gypi-dim">✕</button>
            </div>
            <div className="grid grid-cols-3 gap-1.5 mt-1.5">
              <input aria-label={`Código del renglón ${i + 1}`} className="g-input text-[13px]" value={r.codigo} placeholder="Código" onChange={(e) => cambiarRenglon(i, { codigo: e.target.value })} />
              <input aria-label={`Cantidad del renglón ${i + 1}`} className="g-input text-[13px] text-right" inputMode="decimal" value={r.cantidad} placeholder="Cantidad" onChange={(e) => cambiarRenglon(i, { cantidad: e.target.value })} />
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
      <div className="flex items-baseline gap-2 mt-2">
        <span className="flex-1 text-[13px] font-semibold">Neto sin IVA</span>
        <span className="text-[15px] font-bold">{textoPrecio(neto, f.moneda)}</span>
      </div>
      <div className="flex gap-2 mt-2">
        <button type="button" onClick={guardar} disabled={guardando} className="g-btn g-btn-primary flex-1">{guardando ? "Guardando…" : "💾 Guardar factura"}</button>
        <button type="button" onClick={onCancelar} className="g-btn g-btn-secondary">Cancelar</button>
      </div>
    </section>
  );
}

function DetalleFactura({ id, articulos }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    let vivo = true;
    apiFetch(`/api/facturas-sueltas?id=${id}`).then((r) => (r.ok ? r.json() : null)).then((x) => { if (vivo) setD(x); }).catch(() => {});
    return () => { vivo = false; };
  }, [id]);
  const nombres = useMemo(() => new Map(articulos.map((a) => [a.sku, a.nombre])), [articulos]);
  if (!d?.ok) return <div className="text-xs text-gypi-dim mt-1">Cargando…</div>;
  return (
    <ul className="list-none m-0 p-0 mt-1.5 flex flex-col gap-1">
      {d.renglones.map((r) => (
        <li key={r.id} className="text-xs">
          <span className="font-semibold">{r.descripcion}</span> · {cantidadTexto(r.cantidad)} × {textoPrecio(Number(r.precio), d.factura.moneda)}
          <div className={r.sku ? "text-gypi-green" : "text-gypi-red"}>{r.sku ? `✓ ${nombres.get(r.sku) || r.sku}` : "Sin asociar"}</div>
        </li>
      ))}
    </ul>
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

  useEffect(() => {
    sbGetAll("articulos_stock?activo=eq.true&select=sku,nombre,unidad,division&order=sku.asc", { maxFilas: 20000 })
      .then(({ data }) => setArticulos(data || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let vivo = true;
    const url = vista === "sin" ? "/api/facturas-sueltas?vista=sin_asociar" : "/api/facturas-sueltas";
    apiFetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!vivo) return; if (vista === "sin") setSinAsociar(d); else setDatos(d); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [vista, version]);

  const subir = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setLeyendo(true);
    try {
      const { base64, tipo } = await leerArchivo(file);
      if (base64.length > MAX_ARCHIVO_B64) throw new Error("El archivo es muy grande: hasta 3 MB.");
      const res = await apiFetch("/api/facturas-sueltas", { method: "POST", body: JSON.stringify({ accion: "leer", archivo: base64, tipo }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) throw new Error(d.error || "No se pudo leer la factura");
      const b = d.borrador;
      setEditor({ ...facturaVacia(), ...b, fecha: b.fecha || hoy(), carga: "ia", renglones: b.renglones.length ? b.renglones.map((r) => ({ ...renglonVacio(), ...r })) : [renglonVacio()] });
    } catch (err) {
      toast.error(err.message);
    }
    setLeyendo(false);
  };

  const anular = async (f) => {
    if (!window.confirm(`¿Anular la factura de ${f.proveedor}${f.numero ? ` N° ${f.numero}` : ""}? Sus precios salen de la lista de precios.`)) return;
    try {
      const res = await apiFetch("/api/facturas-sueltas", { method: "POST", body: JSON.stringify({ accion: "anular", id: f.id }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) throw new Error(d.error || "No se pudo anular");
      setVersion((v) => v + 1);
    } catch (e) {
      toast.error(e.message);
    }
  };

  const asociar = async (r, a) => {
    try {
      const res = await apiFetch("/api/facturas-sueltas", { method: "POST", body: JSON.stringify({ accion: "asociar", renglon_id: r.id, sku: a.sku }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) throw new Error(d.error || "No se pudo asociar");
      toast.success(`✅ Asociado a ${a.nombre}. La próxima vez Gypi lo reconoce solo.`);
      setVersion((v) => v + 1);
    } catch (e) {
      toast.error(e.message);
    }
  };

  const falta = (vista === "sin" ? sinAsociar : datos)?.falta_migracion;
  if (falta) return <div role="alert" className="p-3 rounded-[10px] bg-gypi-red/10 text-gypi-red text-[14px]">{falta}</div>;

  return (
    <div>
      <div className="text-xs text-gypi-dim mb-2">Facturas que no pasaron por una orden de compra. Su precio entra a la lista de precios de cada artículo; no mueven stock.</div>
      {editor ? (
        <Editor key={editor.carga + editor.proveedor} inicial={editor} articulos={articulos}
          onGuardada={() => { setEditor(null); setVista("facturas"); setVersion((v) => v + 1); }} onCancelar={() => setEditor(null)} />
      ) : (
        <div className="flex flex-wrap gap-2 mb-3">
          <button type="button" onClick={() => setEditor(facturaVacia())} className="g-btn g-btn-secondary">➕ Nueva a mano</button>
          <button type="button" onClick={() => archivo.current?.click()} disabled={leyendo} className="g-btn g-btn-secondary">{leyendo ? "🤖 Leyendo la factura…" : "📎 Subir PDF o foto"}</button>
          <input ref={archivo} type="file" accept="application/pdf,image/*" className="hidden" aria-label="Archivo de la factura" onChange={subir} />
        </div>
      )}
      <div role="tablist" aria-label="Facturas sueltas" className="flex gap-1.5 mb-2">
        {[["facturas", "Facturas"], ["sin", `Sin asociar${datos?.sinAsociar ? ` (${datos.sinAsociar})` : ""}`]].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={vista === id} onClick={() => setVista(id)}
            className={`min-h-[40px] px-3 rounded-lg border text-[13px] font-semibold cursor-pointer ${vista === id ? "bg-gypi-amber/15 border-gypi-amber text-gypi-amber-ink" : "bg-gypi-bg border-gypi-border text-gypi-dim"}`}>
            {label}
          </button>
        ))}
      </div>
      {vista === "facturas" ? (
        !datos?.ok ? <div className="text-[13px] text-gypi-dim">Cargando…</div> : datos.facturas.length === 0 ? (
          <div className="text-[13px] text-gypi-dim">Todavía no hay facturas sueltas.</div>
        ) : (
          <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
            {datos.facturas.map((f) => {
              const rs = f.facturas_sueltas_renglones || [];
              const asociados = rs.filter((r) => r.sku).length;
              return (
                <li key={f.id} className={`p-2.5 rounded-xl border border-gypi-border bg-gypi-surface ${f.anulada_at ? "opacity-60" : ""}`}>
                  <div className="flex items-baseline gap-2">
                    <span className={`flex-1 text-[14px] font-semibold ${f.anulada_at ? "line-through" : ""}`}>{f.proveedor}{f.numero ? ` · N° ${f.numero}` : ""}</span>
                    <span className="text-[13px] font-bold">{textoPrecio(netoFactura(rs), f.moneda)}</span>
                  </div>
                  <div className="text-xs text-gypi-dim">
                    {fechaCorta(f.fecha)} · {f.carga === "ia" ? "🤖 leída por la IA" : "a mano"}{f.cargada_por_nombre ? ` · ${f.cargada_por_nombre}` : ""} ·{" "}
                    <span className={asociados < rs.length ? "text-gypi-red font-semibold" : "text-gypi-green"}>{asociados} de {rs.length} asociados</span>
                    {f.anulada_at ? ` · anulada${f.anulada_por_nombre ? ` por ${f.anulada_por_nombre}` : ""}` : ""}
                  </div>
                  <div className="flex gap-2 mt-1">
                    <button type="button" onClick={() => setAbierta(abierta === f.id ? null : f.id)} className="min-h-[36px] bg-transparent border-none cursor-pointer text-xs text-gypi-dim underline p-0">{abierta === f.id ? "Ocultar renglones" : "Ver renglones"}</button>
                    {!f.anulada_at && <button type="button" onClick={() => anular(f)} className="min-h-[36px] bg-transparent border-none cursor-pointer text-xs text-gypi-red underline p-0">Anular</button>}
                  </div>
                  {abierta === f.id && <DetalleFactura id={f.id} articulos={articulos} />}
                </li>
              );
            })}
          </ul>
        )
      ) : !sinAsociar?.ok ? <div className="text-[13px] text-gypi-dim">Cargando…</div> : sinAsociar.renglones.length === 0 ? (
        <div className="text-[13px] text-gypi-green">✅ No hay renglones sin asociar.</div>
      ) : (
        <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
          {sinAsociar.renglones.map((r) => (
            <li key={r.id} className="p-2.5 rounded-xl border border-gypi-red bg-gypi-red/10">
              <div className="text-[13px] font-semibold">{r.descripcion}{r.codigo ? <span className="text-xs text-gypi-dim"> · cód. {r.codigo}</span> : null}</div>
              <div className="text-xs text-gypi-dim">
                {r.facturas_sueltas?.proveedor}{r.facturas_sueltas?.numero ? ` · N° ${r.facturas_sueltas.numero}` : ""} · {fechaCorta(r.facturas_sueltas?.fecha)} · {cantidadTexto(r.cantidad)} × {textoPrecio(Number(r.precio), r.facturas_sueltas?.moneda)}
              </div>
              <ElegirArticulo articulos={articulos} etiqueta={`Artículo para ${r.descripcion}`} onElegir={(a) => asociar(r, a)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
