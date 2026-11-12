'use client';
// app/components/RemitosFoto.jsx — Ingreso al stock por foto del remito
// (parte 7 del plan Finanzas e Inventario, 11/11; migración 182; reglas en
// app/lib/remitosStock.js).
//
// Quien recibe la mercadería le saca una foto al remito; la IA lee proveedor,
// número, fecha y renglones, y Gypi reconoce el artículo de cada uno. Se
// corrige lo que haga falta y queda "para revisar" (como Mi caja). La oficina
// lo revisa y lo confirma: recién ahí entra al stock.
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { sugerirArticulos } from "../lib/stock";
import BotonFoto from "./BotonFoto";

const PARA_TEXTO = 6;

/** El remito (leído o guardado) como lo edita la pantalla. */
export function aEditor(r) {
  return {
    id: r.id || null,
    origen: r.origen === "ticket" ? "ticket" : "remito",
    foto_url: r.foto_url || null,
    proveedor: r.proveedor || "",
    numero: r.numero || "",
    fecha: r.fecha || "",
    notas: r.notas || "",
    cargado_por_nombre: r.cargado_por_nombre || null,
    renglones: (r.renglones || []).map((x) => ({
      descripcion: x.descripcion || "",
      codigo: x.codigo || "",
      cantidad: x.cantidad === null || x.cantidad === undefined || x.cantidad === "" ? "" : String(x.cantidad).replace(".", ","),
      sku: x.sku || null,
      texto: "",
    })),
  };
}

/** Lo que se manda al servidor. */
export function cuerpoRemito(ed) {
  return {
    proveedor: ed.proveedor,
    numero: ed.numero,
    fecha: ed.fecha || null,
    notas: ed.notas || null,
    foto_url: ed.foto_url || null,
    renglones: ed.renglones.map((r) => ({ descripcion: r.descripcion, codigo: r.codigo || null, cantidad: r.cantidad, sku: r.sku || null })),
  };
}

const fechaCorta = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString("es-AR", { dateStyle: "short" }) : "");
const titulo = (r) => [r.origen === "ticket" ? "🧾 Ticket de Mi caja" : null, r.proveedor || "Sin proveedor", r.numero ? `N° ${r.numero}` : null].filter(Boolean).join(" · ");
const cuantos = (n) => (n === 1 ? "1 artículo" : `${n} artículos`);

export default function RemitosFoto({ articulos = [], onIngreso, onAbierto }) {
  const [datos, setDatos] = useState(null);
  const [falta, setFalta] = useState(null);
  const [ed, setEd] = useState(null);
  const [avisos, setAvisos] = useState([]);
  const [leyendo, setLeyendo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const [hecho, setHecho] = useState(null);
  const porSku = useMemo(() => new Map(articulos.map((a) => [a.sku, a])), [articulos]);

  const cargar = useCallback(async () => {
    try {
      const res = await apiFetch("/api/stock/remitos");
      const d = await res.json().catch(() => ({}));
      if (d.falta_migracion) { setFalta(d.falta_migracion); setDatos({ pendientes: [], revisados: [], puede_confirmar: false }); return; }
      if (!res.ok) throw new Error(d.error || "No se pudieron leer los remitos");
      setFalta(null);
      setDatos(d);
    } catch {
      setDatos({ pendientes: [], revisados: [], puede_confirmar: false });
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const abrir = (nuevo, lista = []) => { setEd(nuevo); setAvisos(lista); setError(null); setHecho(null); onAbierto?.(!!nuevo); };

  const leer = async (url) => {
    setLeyendo(true);
    setError(null);
    setHecho(null);
    try {
      const res = await apiFetch("/api/stock/remitos", { method: "POST", body: JSON.stringify({ accion: "leer", foto_url: url }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) {
        // Sin lectura se carga a mano con la foto adjunta
        abrir(aEditor({ foto_url: url, renglones: [] }));
        setError(d.error || "No se pudo leer el remito: cargalo a mano.");
      } else abrir(aEditor(d.borrador), d.avisos || []);
    } catch (e) {
      setError(e.message);
    }
    setLeyendo(false);
  };

  const cambiar = (campo) => (e) => setEd((x) => ({ ...x, [campo]: e.target.value }));
  const cambiarRenglon = (i, cambios) => setEd((x) => ({ ...x, renglones: x.renglones.map((r, j) => (j === i ? { ...r, ...cambios } : r)) }));
  const sacarRenglon = (i) => setEd((x) => ({ ...x, renglones: x.renglones.filter((_, j) => j !== i) }));
  const agregarRenglon = () => setEd((x) => ({ ...x, renglones: [...x.renglones, { descripcion: "", codigo: "", cantidad: "", sku: null, texto: "" }] }));

  const puedeConfirmar = !!datos?.puede_confirmar;
  const sinArticulo = ed ? ed.renglones.filter((r) => !r.sku).length : 0;

  const enviar = async (accion, forzar = false) => {
    setEnviando(true);
    setError(null);
    try {
      const cuerpo = accion === "confirmar"
        ? { accion: "confirmar", id: ed.id, ...cuerpoRemito(ed) }
        : { accion: "guardar", ...cuerpoRemito(ed), ...(accion === "guardar_confirmar" ? { confirmar: true } : {}) };
      const res = await apiFetch("/api/stock/remitos", { method: "POST", body: JSON.stringify({ ...cuerpo, ...(forzar ? { forzar: true } : {}) }) });
      const d = await res.json().catch(() => ({}));
      if (res.status === 409 && d.repetido) {
        setEnviando(false);
        if (window.confirm(`${d.error}\n\n¿Es otra entrega y la querés cargar igual?`)) await enviar(accion, true);
        else setError(`${d.error} Si es el mismo remito, descartalo.`);
        return;
      }
      if (!res.ok || !d.ok) throw new Error(d.error || "No se pudo guardar");
      abrir(null);
      setHecho(d.estado === "confirmado"
        ? `✅ Entró al stock: ${cuantos(d.cargados)}.`
        : "🕓 Quedó para revisar. La oficina lo confirma y entra al stock.");
      if (d.estado === "confirmado") onIngreso?.();
      await cargar();
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  const descartar = async (r) => {
    if (!window.confirm(`¿Descartar el remito ${titulo(r)}? No entra al stock.`)) return;
    setError(null);
    try {
      const res = await apiFetch("/api/stock/remitos", { method: "POST", body: JSON.stringify({ accion: "descartar", id: r.id }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || "No se pudo descartar");
      if (ed?.id === r.id) abrir(null);
      await cargar();
    } catch (e) {
      setError(e.message);
    }
  };

  if (falta) return <div role="alert" className="p-3 mb-3 rounded-[10px] bg-gypi-red/10 text-gypi-red text-[14px]">{falta}</div>;

  if (!ed) {
    const pendientes = datos?.pendientes || [];
    return (
      <div className="mb-3">
        <div className="flex flex-col">
          <BotonFoto label={leyendo ? "Leyendo el remito…" : "📷 Ingreso por foto del remito"} disabled={leyendo} onFoto={leer} />
        </div>
        {leyendo && <div role="status" className="text-[12px] text-gypi-dim mt-1">Gypi está leyendo el remito. Tarda unos segundos.</div>}
        {hecho && <div role="status" className="text-[13px] text-gypi-green mt-2">{hecho}</div>}
        {error && <div role="alert" className="text-[13px] text-gypi-red mt-2">{error}</div>}
        {pendientes.length > 0 && (
          <section aria-label="Remitos para revisar" className="mt-3 p-3 rounded-[10px] border border-gypi-amber bg-gypi-amber/10">
            <div className="text-[14px] font-bold mb-2">🕓 Remitos para revisar ({pendientes.length})</div>
            <ul className="list-none p-0 m-0 flex flex-col gap-1.5">
              {pendientes.map((r) => (
                <li key={r.id} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 p-2 rounded-lg border border-gypi-border bg-gypi-surface">
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold">{titulo(r)}</div>
                    <div className="text-[12px] text-gypi-dim">{cuantos((r.renglones || []).length)}{r.fecha ? ` · ${fechaCorta(r.fecha)}` : ""} · Cargó {r.cargado_por_nombre || "—"}</div>
                  </div>
                  <div className="flex gap-2">
                  <button onClick={() => abrir(aEditor(r))} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-amber-ink cursor-pointer">{puedeConfirmar ? "Revisar" : "Ver"}</button>
                  <button onClick={() => descartar(r)} aria-label={`Descartar ${titulo(r)}`} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-red cursor-pointer">Descartar</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  return (
    <section aria-label="Remito por foto" className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 text-[15px] font-bold">{ed.id ? (ed.origen === "ticket" ? "🕓 Ticket de Mi caja para revisar" : "🕓 Remito para revisar") : "📷 Remito leído"}</div>
        {ed.foto_url && <a href={ed.foto_url} target="_blank" rel="noopener noreferrer" className="text-[13px] font-semibold text-gypi-amber-ink">Ver foto</a>}
      </div>
      {ed.id && ed.cargado_por_nombre && <div className="text-[12px] text-gypi-dim mb-2">Lo cargó {ed.cargado_por_nombre}.</div>}
      {!ed.id && <div className="text-[12px] text-gypi-dim mb-2">Revisá lo que leyó Gypi y corregí lo que haga falta.</div>}
      {avisos.map((a) => <div key={a} role="alert" className="p-2 mb-2 rounded-lg bg-gypi-amber/15 text-gypi-amber-ink text-[13px]">⚠ {a}</div>)}

      <label className="g-label" htmlFor="rem-proveedor">Proveedor</label>
      <input id="rem-proveedor" className="g-input w-full mb-2" value={ed.proveedor} onChange={cambiar("proveedor")} maxLength={120} />
      <div className="flex gap-2">
        <div className="flex-1 min-w-0">
          <label className="g-label" htmlFor="rem-numero">N° de remito</label>
          <input id="rem-numero" className="g-input w-full mb-2" value={ed.numero} onChange={cambiar("numero")} maxLength={60} placeholder="Ej: 0001-00004567" />
        </div>
        <div className="flex-1 min-w-0">
          <label className="g-label" htmlFor="rem-fecha">Fecha</label>
          <input id="rem-fecha" type="date" className="g-input w-full mb-2" value={ed.fecha} onChange={cambiar("fecha")} />
        </div>
      </div>

      <div className="text-[13px] font-bold mt-1 mb-1">Artículos ({ed.renglones.length})</div>
      <ul aria-label="Renglones del remito" className="list-none p-0 m-0 mb-2 flex flex-col gap-2">
        {ed.renglones.map((r, i) => {
          const a = r.sku ? porSku.get(r.sku) : null;
          const sug = !r.sku && r.texto.trim() ? sugerirArticulos(articulos, r.texto, PARA_TEXTO) : { lista: [], resto: 0 };
          const nombre = r.descripcion || `Renglón ${i + 1}`;
          return (
            <li key={i} className={`p-2 rounded-lg border bg-gypi-bg ${r.sku ? "border-gypi-border" : "border-gypi-amber"}`}>
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <input aria-label={`Descripción del renglón ${i + 1}`} className="g-input w-full text-[13px]" value={r.descripcion} onChange={(e) => cambiarRenglon(i, { descripcion: e.target.value })} placeholder="Como figura en el remito" maxLength={200} />
                  {r.codigo && <div className="text-[12px] text-gypi-dim mt-0.5">Código del proveedor: {r.codigo}</div>}
                </div>
                <button onClick={() => sacarRenglon(i)} aria-label={`Sacar ${nombre}`} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-red cursor-pointer">Sacar</button>
              </div>
              <div className="md:flex md:items-start md:gap-3">
              <div className="md:flex-1 min-w-0">
              {r.sku ? (
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 min-w-0 text-[13px] truncate">📦 <b>{a?.nombre || r.sku}</b> <span className="text-gypi-dim">· {r.sku}</span></div>
                  <button onClick={() => cambiarRenglon(i, { sku: null, texto: "" })} aria-label={`Cambiar el artículo de ${nombre}`} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-amber-ink cursor-pointer">Cambiar</button>
                </div>
              ) : (
                <div className="mt-1">
                  <input aria-label={`Buscar el artículo de ${nombre}`} className="g-input w-full" value={r.texto} onChange={(e) => cambiarRenglon(i, { texto: e.target.value })} placeholder="Buscá el artículo del stock: nombre o código" />
                  {sug.lista.length > 0 && (
                    <ul aria-label="Artículos encontrados" className="list-none p-0 m-0 mt-1 flex flex-col gap-1">
                      {sug.lista.map((x) => (
                        <li key={x.sku}>
                          <button onClick={() => cambiarRenglon(i, { sku: x.sku, texto: "" })} className="w-full min-h-[44px] text-left bg-gypi-surface rounded-lg px-2 border border-gypi-border cursor-pointer font-body text-gypi-text text-[13px]">
                            <b>{x.nombre || x.sku}</b> <span className="text-gypi-dim">· {x.sku}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {sug.resto > 0 && <div className="text-[12px] text-gypi-dim mt-1">Hay {sug.resto} más: escribí otra palabra.</div>}
                  {!r.texto.trim() && <div className="text-[12px] text-gypi-amber-ink mt-1">Elegí el artículo, o sacá el renglón si no va al stock.</div>}
                </div>
              )}
              </div>
              <label className="flex flex-col gap-1 mt-1 md:w-48 md:shrink-0 text-[12px] font-semibold text-gypi-dim">Cantidad{a?.unidad ? ` (${a.unidad})` : ""}
                <input aria-label={`Cantidad de ${nombre}`} className="g-input w-full" inputMode="decimal" value={r.cantidad} onChange={(e) => cambiarRenglon(i, { cantidad: e.target.value })} placeholder="Ej: 10" />
              </label>
              </div>
            </li>
          );
        })}
      </ul>
      <button onClick={agregarRenglon} className="block min-h-[44px] mb-2 px-0 bg-transparent border-none text-[13px] font-semibold text-gypi-amber-ink cursor-pointer">＋ Agregar un renglón</button>

      <label className="g-label" htmlFor="rem-notas">Notas (opcional)</label>
      <input id="rem-notas" className="g-input w-full mb-3" value={ed.notas} onChange={cambiar("notas")} maxLength={300} />

      {puedeConfirmar && sinArticulo > 0 && (
        <div className="text-[12px] text-gypi-dim mb-2">Para confirmarlo, cada renglón tiene que tener su artículo ({sinArticulo === 1 ? "falta 1" : `faltan ${sinArticulo}`}).</div>
      )}
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => abrir(null)} className="g-btn g-btn-secondary flex-1">{ed.id ? "Volver" : "Cancelar"}</button>
        {ed.id ? (
          puedeConfirmar && <button onClick={() => enviar("confirmar")} disabled={enviando} className="g-btn g-btn-primary flex-1">{enviando ? "Guardando…" : "✅ Confirmar ingreso"}</button>
        ) : (
          <>
            <button onClick={() => enviar("guardar")} disabled={enviando} className={`g-btn flex-1 ${puedeConfirmar ? "g-btn-secondary" : "g-btn-primary"}`}>{enviando ? "Guardando…" : "🕓 Mandar a revisar"}</button>
            {puedeConfirmar && <button onClick={() => enviar("guardar_confirmar")} disabled={enviando} className="g-btn g-btn-primary flex-1">{enviando ? "Guardando…" : "✅ Confirmar ingreso"}</button>}
          </>
        )}
      </div>
    </section>
  );
}
