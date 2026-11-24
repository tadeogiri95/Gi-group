'use client';
// app/components/MisViajes.jsx — "🚚 Mis viajes" del chofer (Logística, parte 3;
// migración 205; pedido de Tadeo, 23/11).
// El chofer ve en su Inicio los viajes que tiene asignados. Abre uno, ve el
// recorrido en Google Maps, aprieta "Salir" y va cumpliendo cada parada:
// tilda lo que entregó (los bultos y sueltos de la OT o renglones a mano),
// saca de 1 a 5 fotos, le hace firmar con el dedo a quien recibe (o anota que
// no había nadie) y marca si se entregó todo, una parte, se rechazó o no se
// fue, con el motivo. Con todas las paradas cumplidas termina el viaje.
// El Dueño y los supervisores abren la misma pantalla desde la ficha del
// viaje, para cumplirlo si manejan ellos o cargarlo por el chofer.
import { useCallback, useEffect, useRef, useState } from "react";
import { sb } from "../lib/supabase";
import { faltaTabla } from "../lib/compras";
import { hoyArg } from "../lib/dates";
import { fotoBase64, subirImagen } from "../lib/foto";
import {
  AVISO_MIGRACION_VIAJES, ESTADOS_VIAJE, MAX_FOTOS, accionParada, avanceViaje, estadoParada, faltaParaCumplir,
  linkComoLlegar, misViajes, renglonesDeOts, resultadoDeRenglones, textoUbicacion, tipoViaje, viajeEnCurso, tieneRemito,
} from "../lib/logistica";
import RemitoParada from "./RemitoParada";
import { Chip } from "./ui";
import BotonesRecorrido from "./LogisticaRecorrido";
import FirmaDedo from "./FirmaDedo";
import FotoViewer from "./FotoViewer";
import { postLogistica } from "./LogisticaScreen";
import { useEscape } from "../hooks/useEscape";

const hhmm = (h) => (h ? String(h).slice(0, 5) : "");
const fechaCorta = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : "");
const horaDe = (ts) => (ts ? new Date(ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires" }) : "");
const sumarDias = (f, n) => {
  const d = new Date(`${f}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Dónde está el celular (si dio permiso), sin hacer esperar más de unos segundos. */
function ubicacionActual() {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve({ lat: null, lng: null });
  return new Promise((ok) => {
    const listo = setTimeout(() => ok({ lat: null, lng: null }), 5000);
    navigator.geolocation.getCurrentPosition(
      (pos) => { clearTimeout(listo); ok({ lat: Math.round(pos.coords.latitude * 1e6) / 1e6, lng: Math.round(pos.coords.longitude * 1e6) / 1e6 }); },
      () => { clearTimeout(listo); ok({ lat: null, lng: null }); },
      { enableHighAccuracy: true, timeout: 4500, maximumAge: 60000 },
    );
  });
}

/** Los viajes del chofer para el botón del Inicio. Sin la migración o sin viajes, lista vacía. */
export function useMisViajes(empleadoId, activo = true) {
  const [viajes, setViajes] = useState([]);
  const cargar = useCallback(async () => {
    if (!activo || !empleadoId) return;
    try {
      const desde = sumarDias(hoyArg(), -14);
      const v = await sb.get(`logistica_viajes?chofer_id=eq.${empleadoId}&fecha=gte.${desde}&estado=in.(planificado,en_camino,terminado)&select=id,numero,tipo,fecha,hora,estado,chofer_id&order=fecha.asc,numero.asc`);
      setViajes(misViajes(v || [], empleadoId, hoyArg()));
    } catch { /* sin la migración 204 o sin señal: sin botón */ }
  }, [activo, empleadoId]);
  useEffect(() => { cargar(); }, [cargar]);
  return { viajes, cargar };
}

/** Una cantidad escrita con coma o punto. */
const numero = (t) => {
  const n = Number(String(t ?? "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
};

/** Cumplir una parada: renglones, resultado, motivo, fotos y firma. */
function CumplirParada({ parada, lugar, onVolver, onGuardada }) {
  const accion = parada.accion || "entregar";
  const retiro = accion === "retirar";
  const [renglones, setRenglones] = useState(() => {
    if (parada.renglones?.length) return parada.renglones.map((r) => ({ ...r }));
    // Un retiro, o una parada sin OT, arranca sin renglones (se anotan a mano)
    return parada.ots?.length && !retiro ? null : [];
  });
  const [estado, setEstado] = useState(parada.estado && parada.estado !== "pendiente" ? parada.estado : null);
  const [elegidoAMano, setElegidoAMano] = useState(!!estado);
  const [motivo, setMotivo] = useState(parada.motivo || "");
  const [fotos, setFotos] = useState(parada.fotos || []);
  const [firmaUrl, setFirmaUrl] = useState(parada.firma_url || null);
  const [conTrazo, setConTrazo] = useState(false);
  const [firmaNombre, setFirmaNombre] = useState(parada.firma_nombre || "");
  const [firmaDni, setFirmaDni] = useState(parada.firma_dni || "");
  const [sinFirma, setSinFirma] = useState(!!parada.sin_firma);
  const [nuevo, setNuevo] = useState({ texto: "", cantidad: "1" });
  const [subiendo, setSubiendo] = useState(false);
  const [viendo, setViendo] = useState(null);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const firma = useRef(null);
  const comoLlegar = linkComoLlegar(parada);

  // Lo que va a esta obra: los bultos y sueltos de sus OT (si no se cargó antes)
  useEffect(() => {
    if (renglones !== null) return;
    let vivo = true;
    const ots = parada.ots.map((o) => `"${String(o).replace(/"/g, "")}"`).join(",");
    Promise.all([
      sb.get(`bultos_ot?ot=in.(${encodeURIComponent(ots)})&select=id,ot,numero,contenido&order=ot.asc,numero.asc`).catch(() => []),
      sb.get(`sueltos_ot?ot=in.(${encodeURIComponent(ots)})&select=id,ot,orden,codigo,descripcion,medida,cantidad&order=ot.asc,orden.asc,id.asc`).catch(() => []),
    ]).then(([bultos, sueltos]) => {
      if (vivo) setRenglones(renglonesDeOts({ ots: parada.ots, bultos: bultos || [], sueltos: sueltos || [] }));
    });
    return () => { vivo = false; };
  }, [parada.ots, renglones]);

  const cambiarRenglones = (nuevos) => {
    setRenglones(nuevos);
    // El resultado sale solo de lo tildado, salvo que lo hayan elegido a mano
    if (!elegidoAMano) setEstado(resultadoDeRenglones(nuevos));
  };
  const setHecha = (i, v) => cambiarRenglones(renglones.map((r, j) => (j === i ? { ...r, hecha: Math.min(numero(v), r.cantidad) } : r)));
  const sumarRenglon = () => {
    const texto = nuevo.texto.trim();
    const c = numero(nuevo.cantidad);
    if (!texto || c <= 0) { setError("Poné qué es y la cantidad"); return; }
    setError(null);
    cambiarRenglones([...(renglones || []), { origen: "mano", ref: null, ot: null, texto: texto.slice(0, 200), cantidad: c, hecha: c }]);
    setNuevo({ texto: "", cantidad: "1" });
  };
  const elegirEstado = (id) => {
    setElegidoAMano(true);
    setEstado(id);
    // "Entregado" deja todo completo; "Rechazado", todo en cero
    if (renglones?.length && id === "entregado") setRenglones(renglones.map((r) => ({ ...r, hecha: r.cantidad })));
    if (renglones?.length && id === "rechazado") setRenglones(renglones.map((r) => ({ ...r, hecha: 0 })));
  };

  const sumarFoto = async (file) => {
    if (!file) return;
    setSubiendo(true);
    setError(null);
    try {
      const url = await subirImagen(await fotoBase64(file));
      setFotos((f) => [...f, url].slice(0, MAX_FOTOS));
    } catch (e) {
      setError(e.message);
    }
    setSubiendo(false);
  };

  const pideFirma = estado === "entregado" || estado === "parcial";
  const guardar = async () => {
    setError(null);
    const quedaFirma = pideFirma && !sinFirma && (conTrazo || firmaUrl);
    const datos = {
      estado, accion, fotos, motivo, renglones: renglones || [],
      firma_url: quedaFirma ? firmaUrl || "pendiente" : null, sin_firma: pideFirma && sinFirma,
    };
    const falta = faltaParaCumplir(datos);
    if (falta) { setError(falta); return; }
    setEnviando(true);
    try {
      let url = pideFirma && !sinFirma ? firmaUrl : null;
      if (pideFirma && !sinFirma && conTrazo) url = await subirImagen({ base64: firma.current.png(), tipo: "image/png" });
      const { lat, lng } = await ubicacionActual();
      const r = await postLogistica({
        accion: "parada_cumplir", id: parada.id, estado,
        renglones: estado === "no_visitado" ? [] : (renglones || []).map(({ origen, ref, ot, texto, cantidad, hecha }) => ({ origen, ref: ref ?? null, ot: ot ?? null, texto, cantidad, hecha })),
        fotos: estado === "no_visitado" ? [] : fotos,
        firma_url: url, firma_nombre: url ? firmaNombre.trim() || null : null, firma_dni: url ? firmaDni.trim() || null : null,
        sin_firma: pideFirma && sinFirma, motivo: estado === "entregado" ? null : motivo.trim() || null, lat, lng,
      });
      await onGuardada(r.parada);
    } catch (e) {
      setError(e.message);
      setEnviando(false);
    }
  };

  const opciones = [
    { id: "entregado", label: retiro ? "✅ Retiré todo" : accion === "entregar_retirar" ? "✅ Hecho" : "✅ Entregué todo" },
    { id: "parcial", label: "🟠 Una parte" },
    { id: "rechazado", label: retiro ? "✖️ No me dieron nada" : "✖️ Lo rechazaron" },
    { id: "no_visitado", label: "⏭️ No fui" },
  ];

  return (
    <div className="pb-6">
      <button type="button" className="g-btn g-btn-secondary mb-3" onClick={onVolver} disabled={enviando}>← Paradas</button>
      <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
        <div className="text-[17px] font-bold">{parada.orden}. {parada.nombre}</div>
        <div className="text-[14px]">{accionParada(accion).label}{parada.ots?.length ? ` · OT ${parada.ots.join(", ")}` : ""}{parada.cliente ? ` · ${parada.cliente}` : ""}</div>
        <div className="text-[13px] text-gypi-dim">{textoUbicacion(parada)}</div>
        {parada.notas && <div className="text-[13px] mt-1">📝 {parada.notas}</div>}
        {(lugar?.contacto || lugar?.horario) && <div className="text-[13px] mt-1">{[lugar.contacto && `👤 ${lugar.contacto}`, lugar.horario && `🕒 ${lugar.horario}`].filter(Boolean).join(" · ")}</div>}
        <div className="flex flex-wrap gap-2 mt-2">
          {comoLlegar && <a href={comoLlegar} target="_blank" rel="noopener noreferrer" className="g-btn g-btn-secondary no-underline">🗺️ Cómo llegar</a>}
          {lugar?.telefono && <a href={`tel:${String(lugar.telefono).replace(/[^\d+]/g, "")}`} className="g-btn g-btn-secondary no-underline">📞 Llamar</a>}
        </div>
      </div>

      <h3 className="text-[15px] font-bold mt-0 mb-1">{retiro ? "Lo que retirás" : "Lo que llevás"}</h3>
      {renglones === null ? (
        <div className="text-[13px] text-gypi-dim mb-2" role="status">Buscando los bultos y sueltos de la OT…</div>
      ) : (
        <>
          {!renglones.length && <div className="text-[13px] text-gypi-dim mb-2">{parada.ots?.length && !retiro ? "La OT no tiene bultos ni sueltos cargados." : "Sin renglones."} Podés anotar a mano lo que va.</div>}
          <ul aria-label="Renglones" className="list-none m-0 p-0 flex flex-col gap-1 mb-2">
            {renglones.map((r, i) => {
              const completo = r.hecha >= r.cantidad;
              return (
                <li key={`${r.origen}-${r.ref ?? i}-${i}`} className="flex items-center gap-2 p-2 rounded-[10px] border border-gypi-border bg-gypi-surface">
                  <button type="button" aria-pressed={completo} aria-label={`${completo ? "Destildar" : "Tildar"} ${r.texto}`} onClick={() => setHecha(i, completo ? 0 : r.cantidad)}
                    className={`shrink-0 w-11 h-11 rounded-lg border text-[18px] font-bold cursor-pointer ${completo ? "bg-gypi-green/15 border-gypi-green text-gypi-green" : r.hecha > 0 ? "bg-gypi-amber/15 border-gypi-amber text-gypi-amber-ink" : "bg-transparent border-gypi-border text-gypi-dim"}`}>
                    {completo ? "✓" : r.hecha > 0 ? "🟠" : ""}
                  </button>
                  <span className="flex-1 min-w-0 text-[13px]">{r.texto}</span>
                  {r.cantidad > 1 ? (
                    <span className="flex items-center gap-1 text-[13px] whitespace-nowrap">
                      <input aria-label={`Cantidad de ${r.texto}`} inputMode="decimal" className="g-input !w-[64px] text-right" value={String(r.hecha)} onChange={(e) => setHecha(i, e.target.value)} />
                      de {r.cantidad}
                    </span>
                  ) : null}
                  {r.origen === "mano" && (
                    <button type="button" aria-label={`Sacar ${r.texto}`} className="g-btn g-btn-secondary !px-3" onClick={() => cambiarRenglones(renglones.filter((_, j) => j !== i))}>✕</button>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex gap-2 mb-3">
            <input aria-label="Renglón a mano" className="g-input flex-1 min-w-0" placeholder="Anotar a mano: 2 cajas de herrajes…" maxLength={200} value={nuevo.texto} onChange={(e) => setNuevo((x) => ({ ...x, texto: e.target.value }))} />
            <input aria-label="Cantidad del renglón" inputMode="decimal" className="g-input !w-[64px] text-right" value={nuevo.cantidad} onChange={(e) => setNuevo((x) => ({ ...x, cantidad: e.target.value }))} />
            <button type="button" className="g-btn g-btn-secondary" onClick={sumarRenglon}>＋</button>
          </div>
        </>
      )}

      <h3 className="text-[15px] font-bold mt-0 mb-1">¿Cómo terminó?</h3>
      <div role="group" aria-label="Cómo terminó la parada" className="flex flex-wrap gap-2 mb-2">
        {opciones.map((o) => <Chip key={o.id} active={estado === o.id} aria-pressed={estado === o.id} onClick={() => elegirEstado(o.id)}>{o.label}</Chip>)}
      </div>
      {estado && estado !== "entregado" && (
        <div className="mb-3">
          <label className="g-label" htmlFor="par-motivo">{estado === "no_visitado" ? "¿Por qué no fuiste?" : "¿Qué pasó?"}</label>
          <input id="par-motivo" className="g-input w-full" maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)}
            placeholder={estado === "no_visitado" ? "No llegué, cerrado, se pasó para mañana…" : "Faltó un mueble, llegó golpeado, no había lugar…"} />
        </div>
      )}

      {estado && estado !== "no_visitado" && (
        <>
          <h3 className="text-[15px] font-bold mt-0 mb-1">Fotos ({fotos.length} de {MAX_FOTOS}, al menos 1)</h3>
          <div className="flex flex-wrap gap-2 mb-3">
            {fotos.map((u, i) => (
              <span key={u} className="relative">
                <button type="button" aria-label={`Ver foto ${i + 1}`} onClick={() => setViendo(i)} className="p-0 border-none bg-transparent cursor-pointer">
                  <img src={u} alt={`Foto ${i + 1}`} className="w-[84px] h-[84px] object-cover rounded-lg border border-gypi-border" />
                </button>
                <button type="button" aria-label={`Sacar la foto ${i + 1}`} onClick={() => setFotos((f) => f.filter((x) => x !== u))}
                  className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-gypi-surface border border-gypi-border text-[13px] cursor-pointer">✕</button>
              </span>
            ))}
            {fotos.length < MAX_FOTOS && (
              <label className="g-btn g-btn-secondary text-center cursor-pointer w-[84px] h-[84px] flex flex-col items-center justify-center !p-1">
                <span aria-hidden="true" className="text-[22px]">📷</span>
                <span className="text-[12px]">{subiendo ? "Subiendo…" : "Sacar foto"}</span>
                <input type="file" accept="image/*" capture="environment" className="hidden" aria-label="Sacar foto" disabled={subiendo || enviando} onChange={(e) => { sumarFoto(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
            )}
          </div>
        </>
      )}

      {pideFirma && (
        <>
          <h3 className="text-[15px] font-bold mt-0 mb-1">{retiro ? "Firma de quien entrega (si quiere)" : "Firma de quien recibe"}</h3>
          <label className="flex items-center gap-2 min-h-[44px] text-[14px] mb-1 cursor-pointer">
            <input type="checkbox" checked={sinFirma} onChange={(e) => setSinFirma(e.target.checked)} />
            No hay nadie para firmar (se firma después)
          </label>
          {!sinFirma && (
            firmaUrl && !conTrazo ? (
              <div className="mb-2">
                <img src={firmaUrl} alt="Firma" className="w-full max-w-[320px] bg-white rounded-xl border border-gypi-border" />
                <button type="button" className="g-btn g-btn-secondary mt-1" onClick={() => setFirmaUrl(null)}>Firmar de nuevo</button>
              </div>
            ) : (
              <div className="mb-2"><FirmaDedo ref={firma} onCambio={setConTrazo} disabled={enviando} quien={retiro ? "quien entrega" : "quien recibe"} /></div>
            )
          )}
          {!sinFirma && (
            <div className="flex gap-2 mb-3">
              <input aria-label="Nombre de quien firma" className="g-input flex-1 min-w-0" maxLength={120} placeholder="Nombre de quien firma" value={firmaNombre} onChange={(e) => setFirmaNombre(e.target.value)} />
              <input aria-label="DNI de quien firma" inputMode="numeric" className="g-input !w-[120px]" maxLength={20} placeholder="DNI" value={firmaDni} onChange={(e) => setFirmaDni(e.target.value)} />
            </div>
          )}
        </>
      )}

      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      <button type="button" className="g-btn g-btn-primary w-full" onClick={guardar} disabled={enviando || subiendo || !estado}>
        {enviando ? "Guardando…" : "Guardar la parada"}
      </button>
      {viendo !== null && <FotoViewer fotos={fotos} index={viendo} onClose={() => setViendo(null)} onNav={setViendo} />}
    </div>
  );
}

/** Un viaje: recorrido, salir, las paradas y terminar. */
function ViajeChofer({ viaje, paradas, lugares, onVolver, onAbrirParada, onAbrirRemito, onCambio, volverLabel }) {
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const t = tipoViaje(viaje.tipo);
  const est = ESTADOS_VIAJE[viaje.estado] || ESTADOS_VIAJE.planificado;
  const origen = lugares.find((l) => l.id === viaje.origen_id) || null;
  const { total, hechas, faltan } = avanceViaje(paradas);
  const siguiente = paradas.find((p) => !p.estado || p.estado === "pendiente");

  const mandar = async (accion) => {
    setEnviando(true);
    setError(null);
    try {
      await postLogistica({ accion, id: viaje.id });
      await onCambio();
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  return (
    <div className="pb-6">
      {onVolver && <button type="button" className="g-btn g-btn-secondary mb-3" onClick={onVolver}>← {volverLabel}</button>}
      <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
        <div className="text-[17px] font-bold">{t.emoji} Viaje {viaje.numero} · {t.label}</div>
        <div className="text-[14px]">{est.emoji} {est.label}{viaje.salida_at ? ` · salió ${horaDe(viaje.salida_at)}` : ""}{viaje.llegada_at ? ` · terminó ${horaDe(viaje.llegada_at)}` : ""}</div>
        <div className="text-[13px] text-gypi-dim">{[viaje.fecha === hoyArg() ? "Hoy" : fechaCorta(viaje.fecha), hhmm(viaje.hora) && `sale ${hhmm(viaje.hora)}`, origen && `desde ${origen.nombre}`].filter(Boolean).join(" · ")}</div>
        {viaje.notas && <div className="text-[13px] mt-1">📝 {viaje.notas}</div>}
        <div className="text-[13px] mt-1 font-semibold">{hechas} de {total} {total === 1 ? "parada cumplida" : "paradas cumplidas"}</div>
      </div>
      <BotonesRecorrido origen={origen} paradas={paradas} vuelve={viaje.vuelve} />
      {viaje.estado === "planificado" && (
        <button type="button" className="g-btn g-btn-primary w-full mb-3" onClick={() => mandar("viaje_salir")} disabled={enviando}>{enviando ? "Un momento…" : "🚚 Salir"}</button>
      )}
      <ol aria-label="Paradas del viaje" className="list-none m-0 p-0 flex flex-col gap-1.5 mb-3">
        {paradas.map((p) => {
          const e = estadoParada(p.estado, p.accion);
          const proxima = viajeEnCurso(viaje) && siguiente?.id === p.id;
          return (
            <li key={p.id}>
              <button type="button" onClick={() => viajeEnCurso(viaje) && onAbrirParada(p.id)} disabled={!viajeEnCurso(viaje)} aria-label={`Parada ${p.orden}: ${p.nombre}`}
                className={`w-full flex items-start gap-2 p-2.5 min-h-[44px] rounded-[10px] border bg-gypi-surface text-left font-body text-gypi-text ${viajeEnCurso(viaje) ? "cursor-pointer" : ""} ${proxima ? "border-gypi-amber" : "border-gypi-border"}`}>
                <span className="shrink-0 w-7 h-7 rounded-full bg-gypi-bg border border-gypi-border flex items-center justify-center text-[13px] font-bold">{p.orden}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[14px] font-semibold">{p.nombre} · {accionParada(p.accion).label}</span>
                  <span className="block text-[12px] text-gypi-dim">{[p.ots?.length ? `OT ${p.ots.join(", ")}` : null, textoUbicacion(p)].filter(Boolean).join(" · ")}</span>
                  {p.motivo && <span className="block text-[12px]">{p.motivo}</span>}
                </span>
                <span className="text-[12px] whitespace-nowrap">{proxima ? "👉 Sigue" : `${e.emoji} ${e.label}`}</span>
              </button>
              {tieneRemito(p) && (
                <button type="button" className="g-btn g-btn-secondary !min-h-[40px] mt-1 ml-9 text-[13px]" onClick={() => onAbrirRemito(p.id)} aria-label={`Remito de la parada ${p.orden}`}>
                  📄 Remito{p.sin_firma && !p.firma_url ? " · falta firma" : ""}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      {viaje.estado === "en_camino" && (
        <>
          <button type="button" className="g-btn g-btn-primary w-full" onClick={() => mandar("viaje_terminar")} disabled={enviando || faltan > 0}>🏁 Terminar el viaje</button>
          {faltan > 0 && <div className="text-[12px] text-gypi-dim mt-1">Para terminar, marcá cómo terminó cada parada ({faltan === 1 ? "falta 1" : `faltan ${faltan}`}). Si no fuiste a alguna, elegí “No fui”.</div>}
        </>
      )}
      {viaje.estado === "terminado" && <div className="text-[14px] font-semibold" role="status">✅ Viaje terminado. ¡Gracias!</div>}
    </div>
  );
}

/**
 * Pantalla de Mis viajes. Con `viajeId` abre directo ese viaje (desde la
 * ficha del Dueño); si no, los viajes del chofer.
 */
export default function MisViajes({ empleadoId, viajeId = null, empresaNombre = "", onClose, onCambio }) {
  useEscape(onClose);
  const [viajes, setViajes] = useState(null);
  const [paradas, setParadas] = useState([]);
  const [lugares, setLugares] = useState([]);
  const [abierto, setAbierto] = useState(viajeId);
  const [parada, setParada] = useState(null);
  const [remitoDe, setRemitoDe] = useState(null);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const desde = sumarDias(hoyArg(), -14);
      const v = viajeId
        ? await sb.get(`logistica_viajes?id=eq.${viajeId}&select=*`)
        : misViajes(await sb.get(`logistica_viajes?chofer_id=eq.${empleadoId}&fecha=gte.${desde}&estado=in.(planificado,en_camino,terminado)&select=*&order=fecha.asc,numero.asc`) || [], empleadoId, hoyArg());
      const ids = (v || []).map((x) => x.id);
      const p = ids.length ? await sb.get(`logistica_paradas?viaje_id=in.(${ids.join(",")})&select=*&order=viaje_id.asc,orden.asc,id.asc`) : [];
      setViajes(v || []);
      setParadas(p || []);
      setError(null);
      const idsLugar = [...new Set([...(v || []).map((x) => x.origen_id), ...(p || []).map((x) => x.lugar_id)].filter(Boolean))];
      if (idsLugar.length) setLugares((await sb.get(`logistica_lugares?id=in.(${idsLugar.join(",")})&select=id,nombre,direccion,lat,lng,contacto,telefono,horario`).catch(() => [])) || []);
    } catch (err) {
      setViajes([]);
      setError(["logistica_viajes", "logistica_paradas"].some((x) => faltaTabla(err, x)) ? AVISO_MIGRACION_VIAJES : "No se pudieron leer tus viajes. Probá de nuevo con señal.");
    }
  }, [empleadoId, viajeId]);
  useEffect(() => { cargar(); }, [cargar]);

  const recargar = async () => { await cargar(); await onCambio?.(); };
  const paradasDe = (id) => paradas.filter((p) => p.viaje_id === id).sort((a, b) => a.orden - b.orden);
  const viaje = abierto ? (viajes || []).find((v) => v.id === abierto) : null;
  const laParada = parada ? paradas.find((p) => p.id === parada) : null;

  let cuerpo;
  if (viajes === null) cuerpo = <div className="text-[14px] text-gypi-dim" role="status">Cargando tus viajes…</div>;
  else if (laParada && viaje) {
    cuerpo = (
      <CumplirParada key={laParada.id} parada={laParada} lugar={lugares.find((l) => l.id === laParada.lugar_id)} onVolver={() => setParada(null)}
        onGuardada={async (guardada) => {
          setParada(null);
          await recargar();
          // Si no había nadie para firmar, el remito queda a mano para mandar el link
          if (guardada?.sin_firma && guardada?.id) setRemitoDe(guardada.id);
        }} />
    );
  } else if (viaje) {
    cuerpo = (
      <ViajeChofer viaje={viaje} paradas={paradasDe(viaje.id)} lugares={lugares} onAbrirParada={setParada} onAbrirRemito={setRemitoDe} onCambio={recargar}
        onVolver={viajeId ? null : () => setAbierto(null)} volverLabel="Mis viajes" />
    );
  } else if (!viajes.length) {
    cuerpo = <div className="text-[14px] text-gypi-dim">{error ? "" : "No tenés viajes asignados."}</div>;
  } else {
    cuerpo = (
      <ul aria-label="Mis viajes" className="list-none m-0 p-0 flex flex-col gap-1.5">
        {viajes.map((v) => {
          const t = tipoViaje(v.tipo);
          const est = ESTADOS_VIAJE[v.estado] || ESTADOS_VIAJE.planificado;
          const ps = paradasDe(v.id);
          const { hechas, total } = avanceViaje(ps);
          return (
            <li key={v.id}>
              <button type="button" onClick={() => setAbierto(v.id)} aria-label={`Abrir viaje ${v.numero}`}
                className={`w-full flex items-start gap-2.5 p-3 min-h-[64px] rounded-[14px] border-[1.5px] bg-gypi-surface text-left cursor-pointer font-body text-gypi-text ${v.estado === "en_camino" ? "border-gypi-amber" : "border-gypi-border"}`}>
                <span className="text-[24px]" aria-hidden="true">{t.emoji}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[16px] font-bold">Viaje {v.numero} · {t.label}</span>
                  <span className="block text-[13px]">{[v.fecha === hoyArg() ? "Hoy" : fechaCorta(v.fecha), hhmm(v.hora)].filter(Boolean).join(" · ")} · {hechas} de {total} paradas</span>
                  <span className="block text-[12px] text-gypi-dim truncate">{ps.map((p) => p.nombre).join(" → ")}</span>
                </span>
                <span className="text-[12px] whitespace-nowrap">{est.emoji} {est.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Mis viajes" className="fixed inset-0 z-[60] bg-gypi-bg flex flex-col">
      <div className="flex items-center gap-2 px-[18px] py-3 border-b border-gypi-border">
        <h2 className="flex-1 m-0 font-heading text-[19px] font-extrabold">🚚 {viajeId && viaje ? `Viaje ${viaje.numero}` : "Mis viajes"}</h2>
        <button type="button" className="g-btn g-btn-secondary" onClick={onClose}>Cerrar</button>
      </div>
      <div className="flex-1 overflow-y-auto px-[18px] pt-3 lista-ancha w-full mx-auto">
        {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
        {cuerpo}
      </div>
      {remitoDe && paradas.find((x) => x.id === remitoDe) && (
        <RemitoParada parada={paradas.find((x) => x.id === remitoDe)} empresaNombre={empresaNombre} onCerrar={() => setRemitoDe(null)} onCambio={recargar} />
      )}
    </div>
  );
}
