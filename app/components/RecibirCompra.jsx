'use client';
// app/components/RecibirCompra.jsx — Planta → Compras → Recibir (Compras,
// parte 22; ítem 41). Cuando llega el material, el jefe de taller o
// Administración abre la orden de compra, pone cuánto llegó de cada renglón y
// el N° de remito (y si quiere una foto del remito). Cada renglón de un
// artículo de la planilla entra solo como ingreso de stock. Administración
// puede anular una recepción mal cargada.
import { useCallback, useEffect, useMemo, useState } from "react";
import { sb, apiFetch } from "../lib/supabase";
import { fotoBase64, subirImagen } from "../lib/foto";
import { leerCantidadMovimiento } from "../lib/movimientosStock";
import { ESTADOS_OC, ESTADOS_OC_RECIBIBLE, ocAtrasada, pendienteItem } from "../lib/ordenesCompra";

const numTexto = (n) => (n === null || n === undefined ? "" : String(n).replace(".", ","));
const cantTexto = (n) => Number(n).toLocaleString("es-AR", { maximumFractionDigits: 3 });
const fechaCorta = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");
export const AVISO_MIGRACION_115 = "Para recibir con remito falta correr la migración 115 en Supabase.";

async function postCompras(body) {
  const res = await apiFetch("/api/compras", { method: "POST", body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo guardar");
  return data;
}

function RecibirOrden({ oc, comprador, onVolver, onCambio }) {
  const [items, setItems] = useState(null);
  const [recepciones, setRecepciones] = useState([]);
  const [cantidades, setCantidades] = useState({});
  const [remito, setRemito] = useState("");
  const [notas, setNotas] = useState("");
  const [foto, setFoto] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const recibible = ESTADOS_OC_RECIBIBLE.includes(oc.estado);

  const cargar = useCallback(async () => {
    try {
      const [its, recs] = await Promise.all([
        sb.get(`ordenes_compra_items?orden_id=eq.${oc.id}&order=id.asc`),
        sb.get(`recepciones_compra?orden_id=eq.${oc.id}&order=created_at.desc`).catch((e) => {
          if (String(e?.message).includes("recepciones_compra")) setError(AVISO_MIGRACION_115);
          return [];
        }),
      ]);
      setItems(its || []);
      setRecepciones(recs || []);
      // Arranca con todo lo que falta: lo común es que llegue completo
      setCantidades(Object.fromEntries((its || []).map((it) => [it.id, numTexto(pendienteItem(it) || "")])));
    } catch {
      setItems([]);
      setError("No se pudieron leer los renglones");
    }
  }, [oc.id]);
  useEffect(() => { cargar(); }, [cargar]);

  const subirFoto = async (file) => {
    if (!file) return;
    setEnviando(true);
    setError(null);
    try {
      setFoto(await subirImagen(await fotoBase64(file)));
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  const registrar = async () => {
    setError(null);
    setAviso(null);
    if (!remito.trim()) { setError("Poné el N° de remito"); return; }
    const lineas = [];
    for (const it of items) {
      const t = String(cantidades[it.id] ?? "").trim();
      if (!t) continue;
      const cantidad = leerCantidadMovimiento(t);
      if (!cantidad) { setError(`Revisá la cantidad de ${it.descripcion}`); return; }
      lineas.push({ item_id: it.id, cantidad });
    }
    if (!lineas.length) { setError("Poné cuánto llegó de al menos un renglón"); return; }
    setEnviando(true);
    try {
      const data = await postCompras({ accion: "recepcion_crear", orden_id: oc.id, remito: remito.trim(), foto_url: foto, notas: notas.trim() || null, items: lineas });
      setAviso(`Recepción guardada${data.ingresos ? ` y ${data.ingresos} ingreso${data.ingresos === 1 ? "" : "s"} de stock cargado${data.ingresos === 1 ? "" : "s"}` : ""}. ${data.estado === "recibida" ? "La orden quedó recibida completa." : "La orden quedó recibida en parte."}`);
      setRemito("");
      setNotas("");
      setFoto(null);
      await onCambio();
      await cargar();
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  const anular = async (r) => {
    setError(null);
    setAviso(null);
    try {
      await postCompras({ accion: "recepcion_anular", id: r.id });
      setAviso(`Recepción del remito ${r.remito} anulada, con sus ingresos de stock.`);
      await onCambio();
      await cargar();
    } catch (e) {
      setError(e.message);
    }
  };

  const est = ESTADOS_OC[oc.estado] || ESTADOS_OC.enviada;
  return (
    <div>
      <button onClick={onVolver} className="min-h-[44px] px-0 mb-1 bg-transparent border-none text-[13px] font-semibold text-gypi-amber-ink cursor-pointer">← Órdenes para recibir</button>
      <div className="text-[16px] font-bold">OC N° {oc.numero} · {oc.proveedor_nombre}</div>
      <div className="text-[12px] text-gypi-dim mb-3">{est.icono} {est.nombre}{oc.fecha_prometida ? ` · Entrega ${fechaCorta(oc.fecha_prometida)}` : ""}</div>

      {items === null ? (
        <div className="text-[14px] text-gypi-dim" role="status">Cargando…</div>
      ) : (
        <>
          <ul aria-label="Renglones para recibir" className="list-none m-0 p-0 flex flex-col gap-1.5 mb-3">
            {items.map((it) => {
              const falta = pendienteItem(it);
              return (
                <li key={it.id} className="p-2 rounded-[10px] border border-gypi-border bg-gypi-surface">
                  <div className="text-[14px] font-semibold">{it.descripcion}{it.ot && <span className="text-gypi-dim font-normal"> · OT {it.ot}</span>}</div>
                  <div className="text-[12px] text-gypi-dim">
                    Pedido {cantTexto(it.cantidad)} {it.unidad || ""} · Llegó {cantTexto(it.cantidad_recibida || 0)}{falta > 0 ? ` · Falta ${cantTexto(falta)}` : " · ✅ Completo"}
                  </div>
                  {recibible && (
                    <div className="flex items-center gap-2 mt-1">
                      <label className="text-[13px]" htmlFor={`rec-${it.id}`}>Llegó ahora</label>
                      <input id={`rec-${it.id}`} aria-label={`Llegó ahora de ${it.descripcion}`} className="g-input w-[100px]" inputMode="decimal"
                        value={cantidades[it.id] ?? ""} onChange={(e) => setCantidades((c) => ({ ...c, [it.id]: e.target.value }))} placeholder="0" />
                      <span className="text-[13px] text-gypi-dim">{it.unidad || ""}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {recibible && (
            <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
              <label className="g-label" htmlFor="rec-remito">N° de remito</label>
              <input id="rec-remito" className="g-input w-full mb-2" value={remito} onChange={(e) => setRemito(e.target.value)} maxLength={60} placeholder="Ej: 0004-00012345" />
              <label className="g-label" htmlFor="rec-notas">Notas (opcional)</label>
              <input id="rec-notas" className="g-input w-full mb-2" value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={300} placeholder="Ej: vino una placa golpeada" />
              {foto && <a href={foto} target="_blank" rel="noreferrer" className="text-[13px] text-gypi-cyan block mb-1.5">📷 Ver la foto del remito</a>}
              <label className="g-btn g-btn-secondary w-full text-center cursor-pointer block mb-2">
                {foto ? "Cambiar la foto" : "📷 Foto del remito (opcional)"}
                <input type="file" accept="image/*" capture="environment" className="hidden" aria-label="Foto del remito" disabled={enviando} onChange={(e) => subirFoto(e.target.files?.[0])} />
              </label>
              <button onClick={registrar} disabled={enviando} className="g-btn g-btn-primary w-full">{enviando ? "Guardando…" : "📦 Registrar lo que llegó"}</button>
            </div>
          )}

          {recepciones.length > 0 && (
            <>
              <div className="text-[14px] font-bold mb-1">Recepciones</div>
              <ul aria-label="Recepciones" className="list-none m-0 p-0 flex flex-col gap-1.5">
                {recepciones.map((r) => (
                  <li key={r.id} className={`flex items-center gap-2 p-2 rounded-[10px] border border-gypi-border bg-gypi-surface ${r.anulada ? "opacity-60" : ""}`}>
                    <div className="flex-1 min-w-0">
                      <div className={`text-[14px] font-semibold ${r.anulada ? "line-through" : ""}`}>Remito {r.remito}</div>
                      <div className="text-[12px] text-gypi-dim">
                        {r.empleado_nombre || "—"} · {fechaCorta(r.created_at)}{r.notas ? ` · ${r.notas}` : ""}{r.anulada ? " · Anulada" : ""}
                        {r.foto_url && <> · <a href={r.foto_url} target="_blank" rel="noreferrer" className="text-gypi-cyan">foto</a></>}
                      </div>
                    </div>
                    {comprador && !r.anulada && (
                      <button onClick={() => anular(r)} aria-label={`Anular recepción del remito ${r.remito}`}
                        className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-red cursor-pointer">Anular</button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {aviso && <div role="status" className="text-[13px] mt-2">✅ {aviso}</div>}
      {error && <div role="alert" className="text-[13px] text-gypi-red mt-2">{error}</div>}
    </div>
  );
}

export default function RecibirCompra({ empresaId, comprador = false }) {
  const [ordenes, setOrdenes] = useState(null);
  const [falta, setFalta] = useState(false);
  const [texto, setTexto] = useState("");
  const [abierta, setAbierta] = useState(null);

  const cargar = useCallback(async () => {
    if (!empresaId) return;
    try {
      const rows = await sb.get(`ordenes_compra?estado=in.(${ESTADOS_OC_RECIBIBLE.join(",")})&order=numero.desc&limit=300`);
      setOrdenes(rows || []);
      setFalta(false);
    } catch (e) {
      setOrdenes([]);
      if (String(e?.message).includes("ordenes_compra")) setFalta(true);
    }
  }, [empresaId]);
  useEffect(() => { cargar(); }, [cargar]);

  const visibles = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return (ordenes || []).filter((o) => !t || String(o.proveedor_nombre).toLowerCase().includes(t) || String(o.numero) === t.replace(/\D/g, ""));
  }, [ordenes, texto]);
  const actual = (ordenes || []).find((o) => o.id === abierta);

  if (actual) return <RecibirOrden key={actual.id} oc={actual} comprador={comprador} onVolver={() => setAbierta(null)} onCambio={cargar} />;

  return (
    <div>
      {falta && <div role="alert" className="p-3 mb-3 rounded-[10px] bg-gypi-red/10 text-gypi-red text-[14px]">Para las órdenes de compra falta correr la migración 114 en Supabase.</div>}
      <div className="text-[13px] text-gypi-dim mb-2">Cuando llega material, abrí su orden de compra y anotá lo que vino con el N° de remito. Lo que es del stock entra solo.</div>
      <input aria-label="Buscar orden para recibir" className="g-input w-full mb-2" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar proveedor o N° de OC" />
      {ordenes === null ? (
        <div className="text-[14px] text-gypi-dim" role="status">Cargando órdenes…</div>
      ) : !visibles.length ? (
        <div className="text-[14px] text-gypi-dim">{ordenes.length ? "No hay órdenes con esa búsqueda." : "No hay órdenes de compra esperando material."}</div>
      ) : (
        <ul aria-label="Órdenes para recibir" className="list-none m-0 p-0 flex flex-col gap-1.5">
          {visibles.map((o) => {
            const est = ESTADOS_OC[o.estado] || ESTADOS_OC.enviada;
            return (
              <li key={o.id}>
                <button onClick={() => setAbierta(o.id)} className={`w-full text-left p-2 rounded-[10px] border bg-gypi-surface cursor-pointer font-body text-gypi-text ${ocAtrasada(o) ? "border-gypi-red" : "border-gypi-border"}`}>
                  <div className="text-[14px] font-semibold">OC N° {o.numero} · {o.proveedor_nombre}</div>
                  <div className="text-[12px] text-gypi-dim">{est.icono} {est.nombre}{ocAtrasada(o) ? " · ⚠️ Atrasada" : ""}{o.fecha_prometida ? ` · Entrega ${fechaCorta(o.fecha_prometida)}` : ""}</div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
