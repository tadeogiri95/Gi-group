'use client';
// app/components/ConsumoOt.jsx — 📋 Traer lo que necesita una OT (pedido de
// Tadeo, 27/11). Se elige la OT (escaneando su QR o de la lista) y aparecen
// sus herrajes y accesorios según la planilla MRP (sin placas, fondos ni
// cantos), con lo que ya se retiró. La cantidad a consumir arranca en lo que
// falta; se puede cambiar, igual que la necesidad (queda quién y cuándo,
// migración 213). Se juntan las cosas y se registra todo con un botón.
// Las reglas están en app/lib/consumoOt.js.
import { useCallback, useEffect, useMemo, useState } from "react";
import { sb, sbGetAll, apiFetch } from "../lib/supabase";
import Modal from "./ui/Modal";
import ElegirOtCarga from "./ElegirOtCarga";
import { useOts } from "../hooks/useOts";
import { otCompleta, textoOt } from "../lib/nombreOt";
import { cantidadTexto, filtrarArticulos } from "../lib/stock";
import { hoyMovimiento, fechaCorta, DIAS_ATRAS_MOVIMIENTO } from "../lib/movimientosStock";
import { renglonesConsumoOt, renglonExtra, cambiarNecesidad, necesidadCambiada, consumoOtParaGuardar, esHerrajeOAccesorio } from "../lib/consumoOt";

const MAX_SUGERIDOS = 20;
const COLS_ARTICULO = "sku,nombre,unidad,division,familia,disponible,stock,activo";

function fechaHora(iso) {
  return iso ? new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "";
}

export default function ConsumoOt({ empresaId, usuario, otInicial = null, onClose, onGuardado }) {
  const porOt = useOts();
  const [ot, setOt] = useState(otInicial ? String(otInicial) : null);
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState(null);
  const [fecha, setFecha] = useState("");
  const [motivo, setMotivo] = useState("");
  const [texto, setTexto] = useState("");
  const [lista, setLista] = useState(null);

  const cargar = useCallback(async (laOt) => {
    setFilas(null);
    setError(null);
    const o = encodeURIComponent(laOt);
    const e = empresaId ? `empresa_id=eq.${empresaId}&` : "";
    const [necesidades, cambios, movimientos] = await Promise.all([
      sb.get(`necesidades_stock?${e}ot=eq.${o}&select=sku,nombre,cantidad`).catch(() => []),
      // Sin la migración 213 no hay cambios: vale lo de la planilla
      sb.get(`necesidades_cambios?${e}ot=eq.${o}&select=id,sku,nombre,cantidad,cantidad_antes,motivo,empleado_nombre,created_at&order=created_at.asc`).catch(() => []),
      sb.get(`movimientos_stock?${e}ot=eq.${o}&anulado=eq.false&tipo=in.(consumo,devolucion)&select=sku,cantidad,tipo,anulado`).catch(() => []),
    ]);
    const skus = [...new Set([...(necesidades || []), ...(cambios || [])].map((r) => r.sku))].slice(0, 300);
    const articulos = skus.length
      // Comillas codificadas (%22): los SKU llevan puntos y /api/data no acepta comillas
      ? await sb.get(`articulos_stock?sku=in.(${skus.map((s) => `%22${encodeURIComponent(s)}%22`).join(",")})&select=${COLS_ARTICULO}`).catch(() => [])
      : [];
    setFilas(renglonesConsumoOt({ necesidades: necesidades || [], cambios: cambios || [], movimientos: movimientos || [], articulos: articulos || [] }));
  }, [empresaId]);

  useEffect(() => {
    if (!ot) return;
    let vivo = true;
    cargar(ot).catch(() => { if (vivo) { setFilas([]); setError("No se pudo leer el material de la OT. Probá de nuevo."); } });
    return () => { vivo = false; };
  }, [ot, cargar]);

  // Artículos para agregar algo no previsto (se bajan recién al buscar)
  const asegurarLista = useCallback(async () => {
    if (lista) return;
    const { data } = await sbGetAll(`articulos_stock?activo=eq.true&select=${COLS_ARTICULO}&order=sku.asc`, { maxFilas: 20000 });
    setLista((data || []).filter(esHerrajeOAccesorio));
  }, [lista]);
  const sugeridos = useMemo(() => {
    if (!texto.trim() || !lista) return [];
    const ya = new Set((filas || []).map((f) => f.sku));
    return filtrarArticulos(lista, { texto }).filter((a) => !ya.has(String(a.sku))).slice(0, MAX_SUGERIDOS);
  }, [texto, lista, filas]);

  const cambiarFila = (sku, fn) => setFilas((fs) => fs.map((f) => (f.sku === sku ? fn(f) : f)));
  const agregar = (a) => { setFilas((fs) => [...fs, renglonExtra(a)]); setTexto(""); };

  const marcados = (filas || []).filter((f) => f.incluir);
  const hayCambios = (filas || []).some(necesidadCambiada);
  const textoDeLaOt = ot ? textoOt(otCompleta(ot, porOt)) : "";

  const guardar = async () => {
    const { renglones, necesidades, error: mal } = consumoOtParaGuardar(filas || []);
    if (mal) { setError(mal); return; }
    setEnviando(true);
    setError(null);
    try {
      const res = await apiFetch("/api/stock/movimientos", {
        method: "POST",
        body: JSON.stringify({ accion: "consumir_ot", ot, renglones, necesidades, motivo: motivo.trim() || null, fecha: fecha || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo guardar");
      setHecho({ cargados: data.cargados ?? renglones.length, necesidades: data.necesidades ?? necesidades.length, fecha: fecha || hoyMovimiento() });
      onGuardado?.();
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  if (!ot) {
    return (
      <ElegirOtCarga empresaId={empresaId} titulo="¿De qué OT juntás el material?" verbo="Juntar para"
        onElegir={(o) => setOt(String(o))} onClose={onClose} />
    );
  }

  return (
    <Modal open onClose={onClose} title={`Material de la OT ${ot}`}>
      <div className="p-4 overflow-y-auto text-gypi-text">
        <div className="flex items-center gap-2 mb-3 text-[14px]">
          <span className="flex-1 min-w-0">OT: <b>{textoDeLaOt}</b></span>
          {!hecho && (
            <button onClick={() => { setOt(null); setFilas(null); setMotivo(""); }} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-amber-ink cursor-pointer">Cambiar</button>
          )}
        </div>

        {hecho ? (
          <>
            <div role="status" className="p-3 rounded-xl mb-3 text-[15px] font-semibold bg-gypi-green/10 text-gypi-green">
              ✅ {hecho.cargados ? `Se registraron ${hecho.cargados} consumos del ${fechaCorta(hecho.fecha)} para la OT ${ot}.` : "No se registraron consumos."}
              {hecho.necesidades ? ` Se cambió la necesidad de ${hecho.necesidades} ${hecho.necesidades === 1 ? "artículo" : "artículos"}.` : ""}
            </div>
            <div className="text-[13px] text-gypi-dim mb-3">Quedan a nombre de {usuario?.nombre || "quien cargó"}, con fecha y hora.</div>
            <button onClick={onClose} className="g-btn g-btn-primary w-full">Listo</button>
          </>
        ) : filas === null ? (
          <div className="text-[14px] text-gypi-dim" role="status">Buscando lo que necesita la OT…</div>
        ) : (
          <>
            <label className="g-label" htmlFor="consumo-ot-fecha">Fecha</label>
            <input id="consumo-ot-fecha" type="date" className="g-input w-full mb-3" value={fecha || hoyMovimiento()} onChange={(e) => setFecha(e.target.value)}
              max={hoyMovimiento()} min={hoyMovimiento(new Date(Date.now() - DIAS_ATRAS_MOVIMIENTO * 86400000))} />

            {!filas.length && (
              <div className="p-3 mb-3 rounded-lg bg-gypi-surface border border-gypi-border text-[13px] text-gypi-dim">
                La planilla MRP no tiene herrajes ni accesorios para esta OT. Podés agregarlos con el buscador de abajo.
              </div>
            )}
            {filas.length > 0 && (
              <div className="text-[12px] text-gypi-dim mb-2">
                Marcá lo que juntaste. La cantidad viene con lo que falta; cambiala si llevás otra. Si cambió lo que lleva la OT, cambiá la necesidad.
              </div>
            )}
            <ul aria-label="Herrajes y accesorios de la OT" className="list-none p-0 m-0 flex flex-col gap-1.5 mb-3">
              {filas.map((f) => {
                const cambiada = necesidadCambiada(f);
                return (
                  <li key={f.sku} className={`p-3 rounded-xl border ${f.incluir ? "bg-gypi-surface border-gypi-amber" : "bg-gypi-bg border-gypi-border"}`}>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input type="checkbox" className="mt-1 w-5 h-5" checked={f.incluir} aria-label={`Consumir ${f.nombre}`}
                        onChange={(e) => cambiarFila(f.sku, (x) => ({ ...x, incluir: e.target.checked }))} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[14px] font-bold">{f.nombre}</span>
                        <span className="block text-[12px] text-gypi-dim">
                          {f.sku} · Ya retirado {cantidadTexto(f.retirado)}{f.unidad ? ` ${f.unidad}` : ""}
                          {f.disponible != null ? ` · Hay ${cantidadTexto(f.disponible)}` : ""}
                          {f.extra ? " · No previsto" : ""}
                        </span>
                      </span>
                    </label>
                    <div className="flex gap-2 mt-2">
                      <div className="flex-1 min-w-0">
                        <label className="g-label" htmlFor={`nec-${f.sku}`}>Necesidad{f.unidad ? ` (${f.unidad})` : ""}</label>
                        <input id={`nec-${f.sku}`} className={`g-input w-full ${cambiada ? "border-gypi-amber" : ""}`} inputMode="decimal" value={f.necesidad}
                          aria-label={`Necesidad de ${f.nombre}`} placeholder={f.extra ? "Opcional" : "0"}
                          onChange={(e) => cambiarFila(f.sku, (x) => cambiarNecesidad(x, e.target.value))} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <label className="g-label" htmlFor={`cons-${f.sku}`}>Consumir ahora</label>
                        <input id={`cons-${f.sku}`} className="g-input w-full" inputMode="decimal" value={f.cantidad}
                          aria-label={`Cantidad de ${f.nombre}`} placeholder="0"
                          onChange={(e) => cambiarFila(f.sku, (x) => ({ ...x, cantidad: e.target.value, cantidadTocada: true, incluir: e.target.value.trim() !== "" ? true : x.incluir }))} />
                      </div>
                    </div>
                    {cambiada && (
                      <div className="text-[12px] text-gypi-amber-ink mt-1">
                        Cambia la necesidad: antes {f.necesidadAntes == null ? "no estaba" : cantidadTexto(f.necesidadAntes)}.
                      </div>
                    )}
                    {!cambiada && f.cambio && (
                      <div className="text-[12px] text-gypi-dim mt-1">
                        Necesidad cambiada por {f.cambio.empleado_nombre || "la oficina"} el {fechaHora(f.cambio.created_at)}
                        {f.mrp != null ? ` (la planilla dice ${cantidadTexto(f.mrp)})` : ""}{f.cambio.motivo ? ` · ${f.cambio.motivo}` : ""}.
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            <label className="g-label" htmlFor="consumo-ot-agregar">Agregar algo que no estaba previsto</label>
            <input id="consumo-ot-agregar" className="g-input w-full mb-2" value={texto} inputMode="search" placeholder="Buscalo por nombre o código"
              onFocus={() => asegurarLista().catch(() => setError("No se pudo leer el stock."))} onChange={(e) => setTexto(e.target.value)} />
            {texto.trim() && lista === null && <div className="text-[13px] text-gypi-dim mb-2" role="status">Cargando artículos…</div>}
            {sugeridos.length > 0 && (
              <ul aria-label="Artículos para agregar" className="list-none p-0 m-0 flex flex-col gap-1 mb-3">
                {sugeridos.map((a) => (
                  <li key={a.sku}>
                    <button onClick={() => agregar(a)} className="w-full min-h-[44px] text-left bg-gypi-surface rounded-lg px-3 py-2 border border-gypi-border cursor-pointer font-body text-gypi-text">
                      <span className="text-[14px] font-bold">{a.nombre || a.sku}</span>
                      <span className="text-[12px] text-gypi-dim"> · {a.sku}{a.unidad ? ` · ${a.unidad}` : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {hayCambios && (
              <>
                <label className="g-label" htmlFor="consumo-ot-motivo">Motivo del cambio de necesidad (opcional)</label>
                <input id="consumo-ot-motivo" className="g-input w-full mb-1" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300}
                  placeholder="Ej: el cliente cambió las bisagras" />
                <div className="text-[12px] text-gypi-dim mb-3">Queda asentado quién la cambió, con fecha y hora. La planilla MRP no se modifica.</div>
              </>
            )}

            {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
            <button onClick={guardar} disabled={enviando || (!marcados.length && !hayCambios)} className="g-btn g-btn-primary w-full mb-2">
              {enviando ? "Guardando…" : marcados.length
                ? `Registrar consumo de ${marcados.length} ${marcados.length === 1 ? "artículo" : "artículos"}`
                : "Guardar el cambio de necesidad"}
            </button>
            <button onClick={onClose} className="g-btn g-btn-secondary w-full">Cancelar</button>
          </>
        )}
      </div>
    </Modal>
  );
}
