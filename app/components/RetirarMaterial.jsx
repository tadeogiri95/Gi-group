'use client';
// app/components/RetirarMaterial.jsx — Retirar material del depósito (Stock,
// parte 14; ítem 40). El operario escanea el QR del artículo (o lo busca),
// elige la OT (escaneando su QR o de la lista, o "Sin OT") y pone la
// cantidad. Reemplaza al papel que después se pasaba a mano a la planilla.
// "Retirar otro" mantiene la OT, para cargar varios artículos seguidos.
// También sirve para devolver lo que sobró.
import { useCallback, useEffect, useMemo, useState } from "react";
import { sb, sbGetAll, apiFetch } from "../lib/supabase";
import Modal from "./ui/Modal";
import EscanerCodigo, { escanerDisponible } from "./EscanerCodigo";
import ElegirOtCarga from "./ElegirOtCarga";
import { Semaforo } from "./FichaArticulo";
import { filtrarArticulos, leerQrArticulo, cantidadTexto } from "../lib/stock";
import { leerCantidadMovimiento, puedeAnular, textoMovimiento } from "../lib/movimientosStock";

const MAX_VISIBLES = 30;
const SIN_OT = "";

export default function RetirarMaterial({ empresaId, usuario, skuInicial = null, onClose }) {
  const [articulo, setArticulo] = useState(null);
  const [ot, setOt] = useState(null); // null = falta elegir; SIN_OT = sin OT
  const [paso, setPaso] = useState(skuInicial ? "cargando" : "articulo");
  const [tipo, setTipo] = useState("consumo");
  const [cantidad, setCantidad] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const [hecho, setHecho] = useState(null);
  const [lista, setLista] = useState(null);
  const [texto, setTexto] = useState("");
  const [escaneando, setEscaneando] = useState(escanerDisponible());
  const [aviso, setAviso] = useState(null);
  const [mios, setMios] = useState([]);

  const cargarMios = useCallback(async () => {
    if (!usuario?.id) return;
    try {
      const rows = await sb.get(`movimientos_stock?empleado_id=eq.${usuario.id}&anulado=eq.false&order=created_at.desc&limit=5`);
      setMios(rows || []);
    } catch { /* sin la migración todavía */ }
  }, [usuario?.id]);
  useEffect(() => { cargarMios(); }, [cargarMios]);

  // Lista de artículos para buscar a mano (se baja recién al buscar)
  const asegurarLista = useCallback(async () => {
    if (lista) return lista;
    const { data } = await sbGetAll("articulos_stock?activo=eq.true&select=sku,nombre,unidad,division,familia,semaforo,disponible,stock,activo&order=sku.asc", { maxFilas: 20000 });
    setLista(data || []);
    return data || [];
  }, [lista]);

  const elegirArticulo = useCallback((a) => {
    setArticulo(a);
    setAviso(null);
    setEscaneando(false);
    setPaso(ot === null ? "ot" : "cantidad");
  }, [ot]);

  const buscarSku = useCallback(async (sku) => {
    try {
      const rows = await sb.get(`articulos_stock?sku=eq.${encodeURIComponent(sku)}&select=sku,nombre,unidad,division,familia,semaforo,disponible,stock,activo&limit=1`);
      const a = rows?.[0];
      if (!a) return null;
      return a;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!skuInicial) return;
    let vivo = true;
    buscarSku(skuInicial).then((a) => {
      if (!vivo) return;
      if (a) elegirArticulo(a);
      else { setPaso("articulo"); setAviso("No encontré ese artículo. Escaneá otro o buscalo por nombre."); }
    });
    return () => { vivo = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skuInicial]);

  const alEscanear = async (codigo) => {
    const sku = leerQrArticulo(codigo);
    if (!sku) { setAviso("Ese QR no es de un artículo."); return; }
    const a = await buscarSku(sku);
    if (!a) { setAviso(`El código ${sku} no está en el stock. Puede que falte sincronizar la planilla.`); return; }
    if (a.activo === false) { setAviso("Ese artículo ya no está en la planilla MRP."); return; }
    elegirArticulo(a);
  };

  const filtrados = useMemo(() => (texto.trim() ? filtrarArticulos(lista || [], { texto }) : []), [lista, texto]);

  const registrar = async () => {
    const n = leerCantidadMovimiento(cantidad);
    if (!n) { setError("Poné una cantidad mayor a cero"); return; }
    setEnviando(true);
    setError(null);
    try {
      const res = await apiFetch("/api/stock/movimientos", {
        method: "POST",
        body: JSON.stringify({ accion: "registrar", tipo, sku: articulo.sku, cantidad: n, ot: ot || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo registrar");
      setHecho(data.movimiento);
      setPaso("hecho");
      cargarMios();
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  const anular = async (mov) => {
    try {
      const res = await apiFetch("/api/stock/movimientos", { method: "POST", body: JSON.stringify({ accion: "anular", id: mov.id }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo anular");
      setMios((m) => m.filter((x) => x.id !== mov.id));
      if (hecho?.id === mov.id) setHecho({ ...hecho, anulado: true });
    } catch (e) {
      setError(e.message);
    }
  };

  const otroArticulo = () => {
    setArticulo(null);
    setCantidad("");
    setHecho(null);
    setError(null);
    setTexto("");
    setEscaneando(escanerDisponible());
    setPaso("articulo");
  };

  if (paso === "ot") {
    return (
      <ElegirOtCarga empresaId={empresaId} titulo="¿Para qué OT es?" verbo="Retirar para"
        onElegir={(o) => { setOt(String(o)); setPaso("cantidad"); }}
        onSinOt={() => { setOt(SIN_OT); setPaso("cantidad"); }}
        onClose={onClose} />
    );
  }

  const u = articulo?.unidad || "";
  const textoOt = ot ? `OT ${ot}` : "Sin OT";

  return (
    <Modal open onClose={onClose} title={tipo === "devolucion" ? "Devolver material" : "Retirar material"}>
      <div className="p-4 overflow-y-auto text-gypi-text">
        {paso === "cargando" && <div className="text-[14px] text-gypi-dim" role="status">Buscando el artículo…</div>}

        {paso === "articulo" && (
          <>
            {ot !== null && <div className="text-[13px] text-gypi-dim mb-2">Para: <b className="text-gypi-text">{textoOt}</b></div>}
            {escanerDisponible() && (
              <div className="mb-3">
                <button onClick={() => { setEscaneando(!escaneando); setAviso(null); }} aria-pressed={escaneando} className="g-btn g-btn-secondary w-full">
                  {escaneando ? "Cerrar la cámara" : "📷 Escanear el QR del artículo"}
                </button>
                {escaneando && <div className="mt-2"><EscanerCodigo onCodigo={alEscanear} ayuda="Apuntá a la etiqueta del estante o de la pila" /></div>}
              </div>
            )}
            {aviso && <div role="alert" className="text-[13px] text-gypi-red mb-2">{aviso}</div>}
            <input className="g-input w-full mb-2" value={texto} inputMode="search" aria-label="Buscar artículo"
              placeholder="O buscalo por nombre o código" onFocus={() => asegurarLista().catch(() => setAviso("No se pudo leer el stock."))}
              onChange={(e) => setTexto(e.target.value)} />
            {texto.trim() && lista === null && <div className="text-[13px] text-gypi-dim" role="status">Cargando artículos…</div>}
            {texto.trim() && lista !== null && !filtrados.length && <div className="text-[13px] text-gypi-dim">No hay artículos con ese nombre.</div>}
            {filtrados.length > 0 && (
              <ul aria-label="Artículos" className="list-none p-0 m-0 flex flex-col gap-1.5">
                {filtrados.slice(0, MAX_VISIBLES).map((a) => (
                  <li key={a.sku}>
                    <button onClick={() => elegirArticulo(a)} className="w-full min-h-[52px] text-left bg-gypi-surface rounded-xl px-3 py-2 border border-gypi-border cursor-pointer font-body text-gypi-text">
                      <div className="text-[14px] font-bold">{a.nombre || a.sku}</div>
                      <div className="text-[12px] text-gypi-dim">{a.sku}{a.unidad ? ` · ${a.unidad}` : ""}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {paso === "cantidad" && articulo && (
          <>
            <div className="p-3 rounded-xl bg-gypi-surface border border-gypi-border mb-3">
              <div className="text-[16px] font-bold">{articulo.nombre || articulo.sku}</div>
              <div className="text-[12px] text-gypi-dim">{articulo.sku}{articulo.division ? ` · ${articulo.division}` : ""}</div>
              <div className="flex items-center gap-2 mt-1 text-[13px]">
                <span>Disponible según la planilla: <b>{cantidadTexto(articulo.disponible ?? articulo.stock)} {u}</b></span>
                <Semaforo texto={articulo.semaforo} />
              </div>
            </div>
            <div className="flex items-center gap-2 mb-3 text-[14px]">
              <span className="flex-1">Para: <b>{textoOt}</b></span>
              <button onClick={() => setPaso("ot")} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-amber-ink cursor-pointer">Cambiar</button>
              <button onClick={otroArticulo} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-amber-ink cursor-pointer">Otro artículo</button>
            </div>
            <div className="flex gap-1.5 mb-3" role="group" aria-label="Qué hacés">
              {[["consumo", "📦 Retiro"], ["devolucion", "↩️ Devuelvo lo que sobró"]].map(([id, label]) => (
                <button key={id} onClick={() => setTipo(id)} aria-pressed={tipo === id}
                  className={`flex-1 min-h-[44px] rounded-lg border text-[13px] font-bold cursor-pointer ${tipo === id ? "bg-gypi-amber/15 border-gypi-amber text-gypi-amber-ink" : "bg-gypi-surface border-gypi-border text-gypi-dim"}`}>{label}</button>
              ))}
            </div>
            <label className="g-label" htmlFor="retiro-cantidad">Cantidad{u ? ` (${u})` : ""}</label>
            <input id="retiro-cantidad" className="g-input w-full mb-3 text-[20px]" inputMode="decimal" autoFocus value={cantidad}
              onChange={(e) => setCantidad(e.target.value)} placeholder="Ej: 2 o 1,5" />
            {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
            <button onClick={registrar} disabled={enviando || !cantidad.trim()} className="g-btn g-btn-primary w-full">
              {enviando ? "Registrando…" : tipo === "devolucion" ? "Registrar devolución" : "Registrar retiro"}
            </button>
          </>
        )}

        {paso === "hecho" && hecho && (
          <>
            <div role="status" className={`p-3 rounded-xl mb-3 text-[15px] font-semibold ${hecho.anulado ? "bg-gypi-surf-hi text-gypi-dim" : "bg-gypi-green/10 text-gypi-green"}`}>
              {hecho.anulado ? "Anulado." : "✅ Registrado:"} {textoMovimiento(hecho)} — {hecho.nombre || hecho.sku}
            </div>
            {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
            <button onClick={otroArticulo} className="g-btn g-btn-primary w-full mb-2">{ot ? `Retirar otro para la OT ${ot}` : "Retirar otro"}</button>
            <button onClick={onClose} className="g-btn g-btn-secondary w-full">Listo</button>
          </>
        )}

        {mios.length > 0 && paso !== "cantidad" && (
          <div className="mt-4">
            <div className="text-[13px] font-bold text-gypi-dim mb-1.5">Lo último que cargaste</div>
            <ul className="list-none p-0 m-0 flex flex-col gap-1">
              {mios.map((m) => (
                <li key={m.id} className="flex items-center gap-2 text-[13px]">
                  <span className="flex-1 min-w-0 truncate">{textoMovimiento(m)} · {m.nombre || m.sku}</span>
                  {puedeAnular(m, { rol: usuario?.rol, empleadoId: usuario?.id }) && (
                    <button onClick={() => anular(m)} aria-label={`Anular ${textoMovimiento(m)} de ${m.nombre || m.sku}`}
                      className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-red cursor-pointer">Anular</button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
