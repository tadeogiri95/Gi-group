'use client';
// app/components/LogisticaViajes.jsx — Logística → Viajes (Logística, parte 2;
// migración 204; pedido de Tadeo, 23/11).
// El Dueño, los supervisores y Administración arman cada viaje: tipo (entrega,
// abastecimiento, interno o devolución), día y hora, vehículo de Flota, chofer,
// de dónde sale y las paradas (lugares de la libreta u obras de las OT). Las
// paradas se ordenan solas por cercanía o a mano con ↑ ↓, y el recorrido se
// abre en Google Maps (gratis; con más de 9 paradas intermedias, en tramos).
// Se ven los viajes de un día; un viaje se cambia mientras está planificado
// y se cancela con el motivo. En la parte 3 el chofer los cumple desde su Inicio.
import { useCallback, useEffect, useMemo, useState } from "react";
import { sbGetAll } from "../lib/supabase";
import { faltaTabla } from "../lib/compras";
import { hoyArg } from "../lib/dates";
import { coordsValidas } from "../lib/ubicacion";
import {
  ACCIONES_PARADA, AVISO_MIGRACION_VIAJES, ESTADOS_VIAJE, MAX_PARADAS, TIPOS_LUGAR, TIPOS_VIAJE, accionParada, accionPorTipo,
  choquesDelDia, kmEnLineaRecta, moverParada, obrasDeOts, ordenarPorCercania, puedeGestionarLogistica,
  textoUbicacion, tipoLugar, tipoViaje, viajeEditable, avanceViaje, estadoParada, viajeEnCurso,
} from "../lib/logistica";
import { Chip, FilaDeslizable } from "./ui";
import { postLogistica } from "./LogisticaScreen";
import BotonesRecorrido from "./LogisticaRecorrido";
import MisViajes from "./MisViajes";
import FotoViewer from "./FotoViewer";

const horaDe = (ts) => (ts ? new Date(ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires" }) : "");
const cantTexto = (n) => String(Math.round(Number(n || 0) * 100) / 100).replace(".", ",");

/** Cómo terminó una parada (parte 3): lo entregado, el motivo, las fotos y la firma. */
function ResultadoParada({ p, empleados }) {
  const [viendo, setViendo] = useState(null);
  if (!p.estado || p.estado === "pendiente") return null;
  const e = estadoParada(p.estado, p.accion);
  const quien = empleados.find((x) => x.id === p.hecha_por)?.nombre;
  const rs = p.renglones || [];
  const incompletos = rs.filter((r) => Number(r.hecha) < Number(r.cantidad));
  return (
    <span className="block mt-1 pt-1 border-t border-gypi-border">
      <span className="block text-[13px] font-semibold">{e.emoji} {e.label}{p.hecha_at ? ` · ${horaDe(p.hecha_at)}` : ""}{quien ? ` · ${quien}` : ""}</span>
      {p.motivo && <span className="block text-[12px]">{p.motivo}</span>}
      {rs.length > 0 && (
        <span className="block text-[12px] text-gypi-dim">
          {rs.length - incompletos.length} de {rs.length} renglones completos
          {incompletos.length > 0 && `. Faltó: ${incompletos.slice(0, 4).map((r) => `${r.texto}${Number(r.cantidad) > 1 ? ` (${cantTexto(r.hecha)} de ${cantTexto(r.cantidad)})` : ""}`).join("; ")}${incompletos.length > 4 ? "…" : ""}`}
        </span>
      )}
      {(p.fotos?.length > 0 || p.firma_url) && (
        <span className="flex flex-wrap gap-1.5 mt-1">
          {(p.fotos || []).map((u, i) => (
            <button key={u} type="button" aria-label={`Ver foto ${i + 1} de ${p.nombre}`} onClick={() => setViendo(i)} className="p-0 border-none bg-transparent cursor-pointer">
              <img src={u} alt={`Foto ${i + 1}`} className="w-[56px] h-[56px] object-cover rounded-md border border-gypi-border" />
            </button>
          ))}
          {p.firma_url && <img src={p.firma_url} alt={`Firma de ${p.firma_nombre || "quien recibió"}`} className="h-[56px] bg-white rounded-md border border-gypi-border" />}
        </span>
      )}
      {p.firma_url && (p.firma_nombre || p.firma_dni) && <span className="block text-[12px] text-gypi-dim">Firmó {[p.firma_nombre, p.firma_dni && `DNI ${p.firma_dni}`].filter(Boolean).join(", ")}</span>}
      {p.sin_firma && <span className="block text-[12px]">✍️ Sin firma: no había nadie para firmar</span>}
      {viendo !== null && <FotoViewer fotos={p.fotos} index={viendo} onClose={() => setViendo(null)} onNav={setViendo} />}
    </span>
  );
}

const sumarDias = (f, n) => {
  const d = new Date(`${f}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fechaLarga = (f) => new Date(`${f}T12:00:00Z`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const hhmm = (h) => (h ? String(h).slice(0, 5) : "");
const nombreVehiculo = (v) => (v ? [v.patente, [v.marca, v.modelo].filter(Boolean).join(" ")].filter(Boolean).join(" · ") : "");
let claveSiguiente = 1;
const conClave = (p) => ({ ...p, clave: p.clave || `p${claveSiguiente++}` });

/** Buscador para sumar una parada: obras de las OT abiertas y lugares de la libreta. */
function ElegirParada({ obras, lugares, yaElegidas, onElegir, onCerrar }) {
  const [texto, setTexto] = useState("");
  const t = texto.trim().toLowerCase();
  const coincide = (...xs) => !t || xs.some((x) => String(x ?? "").toLowerCase().includes(t));
  const obrasF = obras.filter((o) => coincide(o.nombre, o.cliente, o.direccion, ...o.ots)).slice(0, 30);
  const lugaresF = lugares.filter((l) => l.activo && coincide(l.nombre, l.direccion, tipoLugar(l.tipo).label)).slice(0, 30);
  const fila = "w-full flex items-center gap-2.5 p-2.5 min-h-[44px] rounded-[10px] border border-gypi-border bg-gypi-bg text-left cursor-pointer font-body text-gypi-text";
  return (
    <div className="p-3 mb-2 rounded-[10px] border border-gypi-border bg-gypi-surface">
      <div className="flex gap-2 mb-2">
        <input aria-label="Buscar parada" autoFocus className="g-input flex-1 min-w-0" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar obra, cliente, OT o lugar" />
        <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cerrar</button>
      </div>
      {lugaresF.length > 0 && <div className="text-[12px] font-bold uppercase tracking-wide text-gypi-dim mb-1">Lugares</div>}
      <ul aria-label="Lugares para agregar" className="list-none m-0 p-0 flex flex-col gap-1 mb-2">
        {lugaresF.map((l) => (
          <li key={`l${l.id}`}>
            <button type="button" className={fila} onClick={() => onElegir({ lugar_id: l.id, ot_ids: [], nombre: l.nombre, cliente: null, direccion: l.direccion, lat: l.lat, lng: l.lng, ots: [] })}>
              <span aria-hidden="true">{tipoLugar(l.tipo).emoji}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-[14px] font-semibold truncate">{l.nombre}{yaElegidas.has(`l${l.id}`) ? " (ya está)" : ""}</span>
                <span className="block text-[12px] text-gypi-dim truncate">{textoUbicacion(l)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {obrasF.length > 0 && <div className="text-[12px] font-bold uppercase tracking-wide text-gypi-dim mb-1">Obras de las OT</div>}
      <ul aria-label="Obras para agregar" className="list-none m-0 p-0 flex flex-col gap-1">
        {obrasF.map((o) => (
          <li key={o.clave}>
            <button type="button" className={fila} onClick={() => onElegir({ lugar_id: null, ot_ids: o.ids, nombre: o.nombre, cliente: o.cliente || null, direccion: o.direccion, lat: o.lat, lng: o.lng, ots: o.ots })}>
              <span aria-hidden="true">🏗️</span>
              <span className="flex-1 min-w-0">
                <span className="block text-[14px] font-semibold truncate">{o.nombre}{yaElegidas.has(o.clave) ? " (ya está)" : ""}</span>
                <span className="block text-[12px] text-gypi-dim truncate">{[`OT ${o.ots.join(", ")}`, textoUbicacion(o)].join(" · ")}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {!lugaresF.length && !obrasF.length && <div className="text-[14px] text-gypi-dim">No encontré nada con ese nombre. Los lugares fijos se cargan en Lugares y obras.</div>}
    </div>
  );
}

function FormViaje({ viaje = null, paradasViaje = [], fechaInicial, lugares, proyectos, vehiculos, empleados, viajes, onCancelar, onGuardado }) {
  const plantas = lugares.filter((l) => l.activo && l.tipo === "planta");
  const [form, setForm] = useState(() => ({
    tipo: viaje?.tipo || "distribucion",
    fecha: viaje?.fecha || fechaInicial,
    hora: hhmm(viaje?.hora),
    vehiculo_id: viaje?.vehiculo_id ? String(viaje.vehiculo_id) : "",
    chofer_id: viaje?.chofer_id || "",
    origen_id: viaje ? (viaje.origen_id ? String(viaje.origen_id) : "") : (plantas[0] ? String(plantas[0].id) : ""),
    vuelve: viaje ? !!viaje.vuelve : true,
    notas: viaje?.notas || "",
  }));
  // Paradas de un viaje armado: las OT vuelven a sus ids (las cerradas también)
  const [paradas, setParadas] = useState(() => paradasViaje.map((p) => conClave({
    ...p, ot_ids: (p.ots || []).map((ot) => proyectos.find((x) => String(x.ot) === String(ot))?.id).filter(Boolean),
  })));
  const [eligiendo, setEligiendo] = useState(paradasViaje.length === 0);
  const [aviso, setAviso] = useState(null);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const cambiar = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));
  const origen = lugares.find((l) => String(l.id) === form.origen_id) || null;
  const obras = useMemo(() => obrasDeOts(proyectos), [proyectos]);
  const yaElegidas = new Set(paradas.map((p) => (p.lugar_id ? `l${p.lugar_id}` : obrasDeOts(proyectos.filter((x) => p.ot_ids.includes(x.id)).map((x) => ({ ...x, estado: "activo" })))[0]?.clave)));
  const choques = choquesDelDia({ id: viaje?.id, fecha: form.fecha, vehiculo_id: Number(form.vehiculo_id) || null, chofer_id: form.chofer_id || null }, viajes);
  const km = kmEnLineaRecta(origen, paradas, form.vuelve);

  const elegirVehiculo = (e) => {
    const v = vehiculos.find((x) => String(x.id) === e.target.value);
    // Sin chofer elegido, el chofer habitual del vehículo
    setForm((f) => ({ ...f, vehiculo_id: e.target.value, chofer_id: f.chofer_id || v?.responsable_id || "" }));
  };
  const cambiarTipo = (tipo) => {
    setForm((f) => ({ ...f, tipo }));
    // Las paradas que seguían con la acción del tipo anterior toman la del nuevo
    setParadas((ps) => ps.map((p) => (p.accion === accionPorTipo(form.tipo) ? { ...p, accion: accionPorTipo(tipo) } : p)));
  };
  const agregar = (p) => {
    if (paradas.length >= MAX_PARADAS) { setAviso(`Hasta ${MAX_PARADAS} paradas por viaje.`); return; }
    setParadas((ps) => [...ps, conClave({ ...p, accion: accionPorTipo(form.tipo), notas: "" })]);
    setAviso(null);
    setEligiendo(false);
  };
  const ordenar = () => {
    const r = ordenarPorCercania(origen, paradas);
    setParadas(r.paradas);
    setAviso(r.sinPin
      ? `Listo. ${r.sinPin === 1 ? "Una parada no tiene" : `${r.sinPin} paradas no tienen`} pin en el mapa y ${r.sinPin === 1 ? "quedó" : "quedaron"} al final: movelas a mano.`
      : `Listo: ordenadas por cercanía${origen ? ` saliendo de ${origen.nombre}` : ""}. Podés moverlas con ↑ ↓.`);
  };

  const guardar = async () => {
    if (!form.fecha) { setError("Elegí el día"); return; }
    if (!paradas.length) { setError("Agregá al menos una parada"); return; }
    setEnviando(true);
    setError(null);
    try {
      const data = await postLogistica({
        accion: "viaje_guardar",
        ...(viaje?.id ? { id: viaje.id } : {}),
        tipo: form.tipo, fecha: form.fecha, hora: form.hora || null,
        vehiculo_id: form.vehiculo_id ? Number(form.vehiculo_id) : null,
        chofer_id: form.chofer_id || null,
        origen_id: form.origen_id ? Number(form.origen_id) : null,
        vuelve: !!form.vuelve, notas: form.notas.trim() || null,
        paradas: paradas.map((p) => ({ lugar_id: p.lugar_id || null, ot_ids: p.lugar_id ? [] : p.ot_ids, accion: p.accion, notas: String(p.notas || "").trim() || null })),
      });
      await onGuardado(data.viaje);
    } catch (e) {
      setError(e.message);
      setEnviando(false);
    }
  };

  return (
    <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
      <div className="text-[15px] font-bold mb-2">{viaje ? `Editar viaje ${viaje.numero}` : "Nuevo viaje"}</div>
      <div className="g-label">Tipo de viaje</div>
      <FilaDeslizable role="group" aria-label="Tipo de viaje" activa={form.tipo} className="gap-1.5 mb-1">
        {TIPOS_VIAJE.map((t) => <Chip key={t.id} active={form.tipo === t.id} onClick={() => cambiarTipo(t.id)}>{t.emoji} {t.label}</Chip>)}
      </FilaDeslizable>
      <div className="text-[12px] text-gypi-dim mb-2">{tipoViaje(form.tipo).ayuda}</div>
      <div className="flex gap-2">
        <div className="flex-1 min-w-0">
          <label className="g-label" htmlFor="via-fecha">Día</label>
          <input id="via-fecha" type="date" className="g-input w-full mb-2" value={form.fecha} onChange={cambiar("fecha")} />
        </div>
        <div className="flex-1 min-w-0">
          <label className="g-label" htmlFor="via-hora">Hora de salida</label>
          <input id="via-hora" type="time" className="g-input w-full mb-2" value={form.hora} onChange={cambiar("hora")} />
        </div>
      </div>
      <div className="flex gap-2">
        <div className="flex-1 min-w-0">
          <label className="g-label" htmlFor="via-vehiculo">Vehículo</label>
          <select id="via-vehiculo" className="g-input w-full mb-2" value={form.vehiculo_id} onChange={elegirVehiculo}>
            <option value="">Sin elegir</option>
            {vehiculos.map((v) => <option key={v.id} value={v.id}>{nombreVehiculo(v)}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-0">
          <label className="g-label" htmlFor="via-chofer">Chofer</label>
          <select id="via-chofer" className="g-input w-full mb-2" value={form.chofer_id} onChange={cambiar("chofer_id")}>
            <option value="">Sin elegir</option>
            {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </div>
      </div>
      {(choques.vehiculo.length > 0 || choques.chofer.length > 0) && (
        <div className="text-[13px] mb-2">
          {choques.vehiculo.length > 0 && <div>⚠️ Ese día el vehículo ya tiene el viaje {choques.vehiculo.map((v) => v.numero).join(", ")}.</div>}
          {choques.chofer.length > 0 && <div>⚠️ Ese día el chofer ya tiene el viaje {choques.chofer.map((v) => v.numero).join(", ")}.</div>}
        </div>
      )}
      <label className="g-label" htmlFor="via-origen">Sale de</label>
      <select id="via-origen" className="g-input w-full mb-1" value={form.origen_id} onChange={cambiar("origen_id")}>
        <option value="">Sin elegir</option>
        {TIPOS_LUGAR.map((t) => {
          const delTipo = lugares.filter((l) => l.activo && l.tipo === t.id);
          return delTipo.length ? (
            <optgroup key={t.id} label={t.label}>
              {delTipo.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
            </optgroup>
          ) : null;
        })}
      </select>
      {!lugares.some((l) => l.activo) && <div className="text-[12px] text-gypi-dim mb-1">Cargá la planta en Lugares y obras para que el recorrido arranque ahí.</div>}
      <label className="flex items-center gap-2 text-[14px] min-h-[44px] mb-1">
        <input type="checkbox" checked={form.vuelve} onChange={(e) => setForm((f) => ({ ...f, vuelve: e.target.checked }))} /> Vuelve al lugar de salida
      </label>

      <div className="flex items-center justify-between mt-1 mb-1.5">
        <div className="text-[13px] font-bold uppercase tracking-wide text-gypi-dim">Paradas ({paradas.length})</div>
        {paradas.length > 1 && <button type="button" className="g-btn g-btn-secondary" onClick={ordenar}>📍 Ordenar por cercanía</button>}
      </div>
      {aviso && <div role="status" className="text-[13px] mb-2">{aviso}</div>}
      {paradas.length > 0 && (
        <ol aria-label="Paradas del viaje" className="list-none m-0 p-0 flex flex-col gap-1.5 mb-2">
          {paradas.map((p, i) => (
            <li key={p.clave} className="p-2.5 rounded-[10px] border border-gypi-border bg-gypi-bg">
              <div className="flex items-start gap-2">
                <span className="shrink-0 w-7 h-7 rounded-full bg-gypi-surface border border-gypi-border flex items-center justify-center text-[13px] font-bold">{i + 1}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[14px] font-semibold truncate">{p.lugar_id ? tipoLugar(lugares.find((l) => l.id === p.lugar_id)?.tipo).emoji : "🏗️"} {p.nombre}</span>
                  <span className="block text-[12px] text-gypi-dim truncate">
                    {[p.ots?.length ? `OT ${p.ots.join(", ")}` : null, p.cliente].filter(Boolean).join(" · ")}
                  </span>
                  <span className="block text-[12px] truncate">{coordsValidas(p.lat, p.lng) || p.direccion ? textoUbicacion(p) : "⚠️ Sin dirección"}</span>
                </span>
                <span className="flex gap-1 shrink-0">
                  <button type="button" aria-label={`Subir ${p.nombre}`} disabled={i === 0} className="g-btn g-btn-secondary !px-2.5" onClick={() => setParadas((ps) => moverParada(ps, i, -1))}>↑</button>
                  <button type="button" aria-label={`Bajar ${p.nombre}`} disabled={i === paradas.length - 1} className="g-btn g-btn-secondary !px-2.5" onClick={() => setParadas((ps) => moverParada(ps, i, 1))}>↓</button>
                  <button type="button" aria-label={`Sacar ${p.nombre}`} className="g-btn g-btn-secondary !px-2.5" onClick={() => setParadas((ps) => ps.filter((x) => x.clave !== p.clave))}>✕</button>
                </span>
              </div>
              <div className="flex gap-2 mt-1.5">
                <select aria-label={`Qué se hace en ${p.nombre}`} className="g-input flex-1 min-w-0" value={p.accion}
                  onChange={(e) => setParadas((ps) => ps.map((x) => (x.clave === p.clave ? { ...x, accion: e.target.value } : x)))}>
                  {ACCIONES_PARADA.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
                <input aria-label={`Nota de ${p.nombre}`} className="g-input flex-[2] min-w-0" value={p.notas || ""} maxLength={500} placeholder="Nota (qué llevar, a quién…)"
                  onChange={(e) => setParadas((ps) => ps.map((x) => (x.clave === p.clave ? { ...x, notas: e.target.value } : x)))} />
              </div>
            </li>
          ))}
        </ol>
      )}
      {eligiendo
        ? <ElegirParada obras={obras} lugares={lugares} yaElegidas={yaElegidas} onElegir={agregar} onCerrar={() => setEligiendo(false)} />
        : <button type="button" className="g-btn g-btn-secondary w-full mb-2" onClick={() => setEligiendo(true)}>＋ Agregar parada</button>}
      {paradas.length > 0 && <BotonesRecorrido origen={origen} paradas={paradas} vuelve={form.vuelve} />}
      {km > 0 && <div className="text-[12px] text-gypi-dim mb-2">Unos {km.toLocaleString("es-AR")} km en línea recta (por calle es más).</div>}
      <label className="g-label" htmlFor="via-notas">Notas del viaje</label>
      <textarea id="via-notas" className="g-input w-full mb-2" rows={2} value={form.notas} onChange={cambiar("notas")} maxLength={500} placeholder="Qué cargar, cuidados, ayudantes…" />
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      <div className="flex gap-2">
        <button type="button" className="g-btn g-btn-secondary flex-1" onClick={onCancelar} disabled={enviando}>Cancelar</button>
        <button type="button" className="g-btn g-btn-primary flex-1" onClick={guardar} disabled={enviando}>{enviando ? "Guardando…" : "Guardar viaje"}</button>
      </div>
    </div>
  );
}

function FichaViaje({ viaje, paradas, lugares, vehiculos, empleados, editable, usuarioId, onEditar, onVolver, onCambio }) {
  const [cancelando, setCancelando] = useState(false);
  const [haciendo, setHaciendo] = useState(false);
  const avance = avanceViaje(paradas);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const t = tipoViaje(viaje.tipo);
  const est = ESTADOS_VIAJE[viaje.estado] || ESTADOS_VIAJE.planificado;
  const origen = lugares.find((l) => l.id === viaje.origen_id) || null;
  const vehiculo = vehiculos.find((v) => v.id === viaje.vehiculo_id);
  const chofer = empleados.find((e) => e.id === viaje.chofer_id);

  const cancelar = async () => {
    if (!motivo.trim()) { setError("Poné el motivo"); return; }
    setEnviando(true);
    setError(null);
    try {
      await postLogistica({ accion: "viaje_cancelar", id: viaje.id, motivo: motivo.trim() });
      await onCambio();
    } catch (e) {
      setError(e.message);
      setEnviando(false);
    }
  };

  return (
    <div className="pb-4">
      <button type="button" className="g-btn g-btn-secondary mb-3" onClick={onVolver}>← Viajes</button>
      <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
        <div className="text-[17px] font-bold">{t.emoji} Viaje {viaje.numero} · {t.label}</div>
        <div className="text-[14px] mb-1">
          {est.emoji} {est.label}{viaje.estado === "cancelado" && viaje.motivo_cancelado ? `: ${viaje.motivo_cancelado}` : ""}
          {viaje.salida_at ? ` · salió ${horaDe(viaje.salida_at)}` : ""}{viaje.llegada_at ? ` · terminó ${horaDe(viaje.llegada_at)}` : ""}
          {viaje.estado !== "planificado" && viaje.estado !== "cancelado" ? ` · ${avance.hechas} de ${avance.total} paradas` : ""}
        </div>
        <div className="text-[13px] text-gypi-dim">
          {[fechaLarga(viaje.fecha), hhmm(viaje.hora) && `sale ${hhmm(viaje.hora)}`].filter(Boolean).join(" · ")}
        </div>
        <div className="text-[13px] text-gypi-dim">
          {[chofer ? `Chofer: ${chofer.nombre}` : "Sin chofer", vehiculo ? nombreVehiculo(vehiculo) : "Sin vehículo"].join(" · ")}
        </div>
        <div className="text-[13px] text-gypi-dim">Sale de {origen ? origen.nombre : "—"}{viaje.vuelve ? " y vuelve" : ""}</div>
        {viaje.notas && <div className="text-[13px] mt-1">📝 {viaje.notas}</div>}
      </div>
      <BotonesRecorrido origen={origen} paradas={paradas} vuelve={viaje.vuelve} />
      <ol aria-label="Paradas" className="list-none m-0 p-0 flex flex-col gap-1.5 mb-3">
        {paradas.map((p) => (
          <li key={p.id} className="flex items-start gap-2 p-2.5 rounded-[10px] border border-gypi-border bg-gypi-surface">
            <span className="shrink-0 w-7 h-7 rounded-full bg-gypi-bg border border-gypi-border flex items-center justify-center text-[13px] font-bold">{p.orden}</span>
            <span className="flex-1 min-w-0">
              <span className="block text-[14px] font-semibold">{p.nombre} · {accionParada(p.accion).label}</span>
              <span className="block text-[12px] text-gypi-dim">{[p.ots?.length ? `OT ${p.ots.join(", ")}` : null, p.cliente].filter(Boolean).join(" · ")}</span>
              <span className="block text-[12px]">{textoUbicacion(p)}</span>
              {p.notas && <span className="block text-[12px]">📝 {p.notas}</span>}
              <ResultadoParada p={p} empleados={empleados} />
            </span>
          </li>
        ))}
      </ol>
      {(editable || viaje.chofer_id === usuarioId) && viajeEnCurso(viaje) && (
        <button type="button" className="g-btn g-btn-primary w-full mb-2" onClick={() => setHaciendo(true)}>
          {viaje.chofer_id === usuarioId ? "🚚 Hacer el viaje" : "🚚 Cargar las paradas por el chofer"}
        </button>
      )}
      {haciendo && <MisViajes empleadoId={usuarioId} viajeId={viaje.id} onClose={() => { setHaciendo(false); onCambio(); }} onCambio={onCambio} />}
      {editable && viajeEditable(viaje) && <button type="button" className="g-btn g-btn-primary w-full mb-2" onClick={onEditar}>✏️ Cambiar el viaje</button>}
      {editable && ["planificado", "en_camino"].includes(viaje.estado) && (
        cancelando ? (
          <div className="p-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
            <label className="g-label" htmlFor="via-motivo">¿Por qué se cancela?</label>
            <input id="via-motivo" className="g-input w-full mb-2" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="Se pasó para mañana, el cliente no está…" />
            {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
            <div className="flex gap-2">
              <button type="button" className="g-btn g-btn-secondary flex-1" onClick={() => setCancelando(false)} disabled={enviando}>Volver</button>
              <button type="button" className="g-btn g-btn-primary flex-1" onClick={cancelar} disabled={enviando}>{enviando ? "Cancelando…" : "Cancelar el viaje"}</button>
            </div>
          </div>
        ) : <button type="button" className="g-btn g-btn-secondary w-full" onClick={() => setCancelando(true)}>Cancelar este viaje</button>
      )}
    </div>
  );
}

export default function LogisticaViajes({ empresaId, usuario = null }) {
  const [fecha, setFecha] = useState(hoyArg());
  const [viajes, setViajes] = useState(null);
  const [paradas, setParadas] = useState([]);
  const [lugares, setLugares] = useState([]);
  const [proyectos, setProyectos] = useState([]);
  const [vehiculos, setVehiculos] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [error, setError] = useState(null);
  const [abierto, setAbierto] = useState(null); // id del viaje
  const [editando, setEditando] = useState(null); // "nuevo" o el id
  const editable = puedeGestionarLogistica(usuario?.rol);
  const hoy = hoyArg();

  const cargar = useCallback(async () => {
    if (!empresaId) return;
    try {
      // Los viajes de 60 días para atrás en adelante: alcanza para ver el día y numerar
      const desde = sumarDias(hoyArg(), -60);
      const v = await sbGetAll(`logistica_viajes?fecha=gte.${desde}&order=fecha.asc,hora.asc.nullslast,numero.asc,id.asc`, { maxFilas: 5000 });
      const ids = (v.data || []).map((x) => x.id);
      const p = ids.length ? await sbGetAll(`logistica_paradas?viaje_id=in.(${ids.join(",")})&order=viaje_id.asc,orden.asc,id.asc`, { maxFilas: 20000 }) : { data: [] };
      setViajes(v.data || []);
      setParadas(p.data || []);
      setError(null);
    } catch (err) {
      setViajes([]);
      setError(["logistica_viajes", "logistica_paradas"].some((x) => faltaTabla(err, x)) ? AVISO_MIGRACION_VIAJES : "No se pudieron leer los viajes");
    }
    const [l, pr, ve, em] = await Promise.all([
      sbGetAll("logistica_lugares?order=nombre.asc,id.asc", { maxFilas: 5000 }).catch(() => ({ data: [] })),
      sbGetAll("proyectos?select=id,ot,cliente,obra,estado,direccion,lat,lng&order=id.desc", { maxFilas: 20000 }).catch(() => ({ data: [] })),
      sbGetAll("vehiculos?activo=eq.true&select=id,patente,marca,modelo,tipo,responsable_id&order=patente.asc,id.asc", { maxFilas: 2000 }).catch(() => ({ data: [] })),
      sbGetAll("empleados?activo=eq.true&select=id,nombre&order=nombre.asc,id.asc", { maxFilas: 5000 }).catch(() => ({ data: [] })),
    ]);
    setLugares(l.data || []);
    setProyectos(pr.data || []);
    setVehiculos(ve.data || []);
    setEmpleados(em.data || []);
  }, [empresaId]);
  useEffect(() => { cargar(); }, [cargar]);

  const delDia = useMemo(() => (viajes || []).filter((v) => v.fecha === fecha), [viajes, fecha]);
  const proximos = useMemo(() => (viajes || []).filter((v) => v.fecha > hoy && v.estado === "planificado").length, [viajes, hoy]);
  const paradasDe = (id) => paradas.filter((p) => p.viaje_id === id).sort((a, b) => a.orden - b.orden);
  const vehiculo = (id) => vehiculos.find((v) => v.id === id);
  const chofer = (id) => empleados.find((e) => e.id === id);

  if (editando) {
    const viaje = editando === "nuevo" ? null : (viajes || []).find((v) => v.id === editando);
    return (
      <div className="flex-1 overflow-y-auto px-[18px] pb-6">
        <FormViaje viaje={viaje} paradasViaje={viaje ? paradasDe(viaje.id) : []} fechaInicial={fecha} lugares={lugares} proyectos={proyectos}
          vehiculos={vehiculos} empleados={empleados} viajes={viajes || []} onCancelar={() => setEditando(null)}
          onGuardado={async (v) => { setEditando(null); if (v?.fecha) setFecha(v.fecha); await cargar(); if (v?.id) setAbierto(v.id); }} />
      </div>
    );
  }

  const ficha = abierto ? (viajes || []).find((v) => v.id === abierto) : null;
  if (ficha) {
    return (
      <div className="flex-1 overflow-y-auto px-[18px] pb-6">
        <FichaViaje viaje={ficha} paradas={paradasDe(ficha.id)} lugares={lugares} vehiculos={vehiculos} empleados={empleados} editable={editable} usuarioId={usuario?.id}
          onEditar={() => setEditando(ficha.id)} onVolver={() => setAbierto(null)} onCambio={async () => { await cargar(); }} />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      {editable && <button type="button" onClick={() => setEditando("nuevo")} className="g-btn g-btn-primary w-full mb-3">＋ Armar viaje</button>}
      <div className="flex gap-2 items-center mb-1">
        <button type="button" aria-label="Día anterior" className="g-btn g-btn-secondary !px-3" onClick={() => setFecha((f) => sumarDias(f, -1))}>◀</button>
        <input type="date" aria-label="Día" className="g-input flex-1 min-w-0" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />
        <button type="button" aria-label="Día siguiente" className="g-btn g-btn-secondary !px-3" onClick={() => setFecha((f) => sumarDias(f, 1))}>▶</button>
        {fecha !== hoy && <button type="button" className="g-btn g-btn-secondary" onClick={() => setFecha(hoy)}>Hoy</button>}
      </div>
      <div className="text-[13px] text-gypi-dim mb-2 first-letter:uppercase">
        {fechaLarga(fecha)}{proximos ? ` · ${proximos} ${proximos === 1 ? "viaje armado" : "viajes armados"} para los próximos días` : ""}
      </div>
      {viajes === null ? (
        <div className="text-[14px] text-gypi-dim" role="status">Cargando los viajes…</div>
      ) : !delDia.length ? (
        <div className="text-[14px] text-gypi-dim">No hay viajes este día.{editable ? " Armá uno con ＋ Armar viaje." : ""}</div>
      ) : (
        <ul aria-label="Viajes del día" className="list-none m-0 p-0 lista-ancha flex flex-col gap-1.5">
          {delDia.map((v) => {
            const t = tipoViaje(v.tipo);
            const est = ESTADOS_VIAJE[v.estado] || ESTADOS_VIAJE.planificado;
            const ps = paradasDe(v.id);
            return (
              <li key={v.id}>
                <button type="button" onClick={() => setAbierto(v.id)} aria-label={`Ver viaje ${v.numero}`}
                  className={`w-full flex items-start gap-2.5 p-2.5 min-h-[44px] rounded-[10px] border border-gypi-border bg-gypi-surface text-left cursor-pointer font-body text-gypi-text ${v.estado === "cancelado" ? "opacity-60" : ""}`}>
                  <span className="text-[20px]" aria-hidden="true">{t.emoji}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[15px] font-bold">Viaje {v.numero} · {t.label}{hhmm(v.hora) ? ` · ${hhmm(v.hora)}` : ""}</span>
                    <span className="block text-[13px] truncate">{ps.map((p) => p.nombre).join(" → ") || "Sin paradas"}</span>
                    <span className="block text-[12px] text-gypi-dim truncate">
                      {[chofer(v.chofer_id)?.nombre || "Sin chofer", vehiculo(v.vehiculo_id)?.patente || "sin vehículo", v.estado === "en_camino" || v.estado === "terminado" ? `${avanceViaje(ps).hechas} de ${ps.length} paradas` : `${ps.length} ${ps.length === 1 ? "parada" : "paradas"}`].join(" · ")}
                    </span>
                  </span>
                  <span className="text-[12px] whitespace-nowrap">{est.emoji} {est.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
