'use client';
// app/components/LogisticaTablero.jsx — Logística → Tablero (Logística, parte 6;
// migración 208; pedido de Tadeo, 23/11).
// Lo que mira el dueño: los viajes en camino con su última ubicación (la que
// manda el celular del chofer con Gypi abierto, o la de la última parada),
// los viajes del día por chofer y por vehículo, las entregas sin firma
// (para reenviar el link), si las paradas se hicieron el día planeado y las
// incidencias (parciales, rechazos y paradas a las que no se fue).
import { useCallback, useEffect, useMemo, useState } from "react";
import { sbGetAll } from "../lib/supabase";
import { faltaTabla } from "../lib/compras";
import { hoyArg } from "../lib/dates";
import { linkGoogleMaps } from "../lib/ubicacion";
import {
  AVISO_MIGRACION_VIAJES, ESTADOS_VIAJE, avanceViaje, entregasATiempo, estadoParada, firmasPendientes, haceCuanto,
  incidencias, tipoViaje, ultimaUbicacion, viajesPor,
} from "../lib/logistica";
import RemitoParada from "./RemitoParada";

const sumarDias = (f, n) => {
  const d = new Date(`${f}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fechaCorta = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : "");
const fechaLarga = (f) => new Date(`${f}T12:00:00Z`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const DIAS_A_TIEMPO = 30;

function Bloque({ titulo, children, etiqueta }) {
  return (
    <section aria-label={etiqueta || titulo} className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
      <h3 className="m-0 mb-2 text-[15px] font-bold">{titulo}</h3>
      {children}
    </section>
  );
}

function Numero({ valor, texto }) {
  return (
    <div className="flex-1 min-w-[72px] p-2 rounded-[10px] bg-gypi-bg border border-gypi-border text-center">
      <div className="text-[20px] font-extrabold font-heading">{valor}</div>
      <div className="text-[12px] text-gypi-dim">{texto}</div>
    </div>
  );
}

export default function LogisticaTablero({ empresaId }) {
  const [fecha, setFecha] = useState(hoyArg());
  const [viajes, setViajes] = useState(null);
  const [paradas, setParadas] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [vehiculos, setVehiculos] = useState([]);
  const [error, setError] = useState(null);
  const [remito, setRemito] = useState(null);
  const [ahora, setAhora] = useState(() => Date.now());
  const hoy = hoyArg();

  const cargar = useCallback(async () => {
    if (!empresaId) return;
    try {
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
    const [em, ve] = await Promise.all([
      sbGetAll("empleados?select=id,nombre&order=nombre.asc,id.asc", { maxFilas: 5000 }).catch(() => ({ data: [] })),
      sbGetAll("vehiculos?select=id,patente,marca,modelo&order=patente.asc,id.asc", { maxFilas: 2000 }).catch(() => ({ data: [] })),
    ]);
    setEmpleados(em.data || []);
    setVehiculos(ve.data || []);
    setAhora(Date.now());
  }, [empresaId]);
  useEffect(() => { cargar(); }, [cargar]);
  // La ubicación llega cada 2 minutos: el tablero se pone al día solo
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState !== "hidden") cargar(); }, 60000);
    return () => clearInterval(t);
  }, [cargar]);

  const lista = useMemo(() => viajes || [], [viajes]);
  const nombre = (id) => empleados.find((e) => e.id === id)?.nombre;
  const patente = (id) => vehiculos.find((v) => v.id === id)?.patente;
  const viajeDe = (p) => lista.find((v) => v.id === p.viaje_id);
  const paradasDe = (id) => paradas.filter((p) => p.viaje_id === id).sort((a, b) => a.orden - b.orden);

  const delDia = lista.filter((v) => v.fecha === fecha && v.estado !== "cancelado");
  const avanceDia = avanceViaje(paradas.filter((p) => delDia.some((v) => v.id === p.viaje_id)));
  const enCamino = lista.filter((v) => v.estado === "en_camino");
  const porChofer = viajesPor(lista, paradas, fecha, "chofer_id");
  const porVehiculo = viajesPor(lista, paradas, fecha, "vehiculo_id");
  const sinFirma = firmasPendientes(paradas.filter((p) => viajeDe(p)?.estado !== "cancelado"));
  const tiempo = entregasATiempo(lista, paradas, { desde: sumarDias(hoy, -DIAS_A_TIEMPO), hoy });
  const malas = incidencias(paradas.filter((p) => viajeDe(p)?.estado !== "cancelado"));

  const filaViaje = (v) => {
    const a = avanceViaje(paradasDe(v.id));
    const est = ESTADOS_VIAJE[v.estado] || ESTADOS_VIAJE.planificado;
    return `${tipoViaje(v.tipo).emoji} Viaje ${v.numero} · ${est.label.toLowerCase()} · ${a.hechas} de ${a.total}`;
  };

  if (viajes === null) return <div className="flex-1 px-[18px] text-[14px] text-gypi-dim" role="status">Cargando el tablero…</div>;

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      <div className="flex gap-2 items-center mb-1">
        <button type="button" aria-label="Día anterior" className="g-btn g-btn-secondary !px-3" onClick={() => setFecha((f) => sumarDias(f, -1))}>◀</button>
        <input type="date" aria-label="Día" className="g-input flex-1 min-w-0" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />
        <button type="button" aria-label="Día siguiente" className="g-btn g-btn-secondary !px-3" onClick={() => setFecha((f) => sumarDias(f, 1))}>▶</button>
        {fecha !== hoy && <button type="button" className="g-btn g-btn-secondary" onClick={() => setFecha(hoy)}>Hoy</button>}
      </div>
      <div className="text-[13px] text-gypi-dim mb-2 first-letter:uppercase">{fechaLarga(fecha)}</div>

      <div role="group" aria-label="Resumen del día" className="flex flex-wrap gap-2 mb-3">
        <Numero valor={delDia.length} texto={delDia.length === 1 ? "viaje" : "viajes"} />
        <Numero valor={`${avanceDia.hechas}/${avanceDia.total}`} texto="paradas hechas" />
        <Numero valor={sinFirma.length} texto="sin firma" />
        <Numero valor={tiempo.porcentaje === null ? "—" : `${tiempo.porcentaje}%`} texto={`a tiempo (${DIAS_A_TIEMPO} días)`} />
      </div>

      <Bloque titulo={`🚚 En camino ahora (${enCamino.length})`} etiqueta="En camino ahora">
        {!enCamino.length ? <div className="text-[13px] text-gypi-dim">Ningún viaje en camino.</div> : (
          <ul className="list-none m-0 p-0 flex flex-col gap-2">
            {enCamino.map((v) => {
              const ps = paradasDe(v.id);
              const u = ultimaUbicacion(v, ps);
              const sigue = ps.find((p) => !p.estado || p.estado === "pendiente");
              return (
                <li key={v.id} className="text-[13px] border-b border-gypi-border pb-2 last:border-b-0 last:pb-0">
                  <div className="text-[14px] font-semibold">{filaViaje(v)}</div>
                  <div>{[nombre(v.chofer_id) || "Sin chofer", patente(v.vehiculo_id)].filter(Boolean).join(" · ")}{sigue ? ` · sigue: ${sigue.nombre}` : " · le falta terminarlo"}</div>
                  {u ? (
                    <div>
                      📍 {haceCuanto(u.at, ahora)} ({u.donde}){" "}
                      <a href={linkGoogleMaps(u)} target="_blank" rel="noopener noreferrer" className="font-semibold">Ver en el mapa</a>
                    </div>
                  ) : <div className="text-gypi-dim">📍 Todavía sin ubicación (llega cuando el chofer tiene Gypi abierto o cumple una parada).</div>}
                </li>
              );
            })}
          </ul>
        )}
      </Bloque>

      <Bloque titulo="👷 Por chofer" etiqueta="Viajes por chofer">
        {!porChofer.length ? <div className="text-[13px] text-gypi-dim">No hay viajes este día.</div> : (
          <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
            {porChofer.map((g) => (
              <li key={g.clave ?? "sin"} className="text-[13px]">
                <div className="text-[14px] font-semibold">{g.clave ? nombre(g.clave) || "Chofer" : "Sin chofer"} · {g.hechas} de {g.total} paradas</div>
                {g.viajes.map((v) => <div key={v.id} className="text-gypi-dim">{filaViaje(v)}{patente(v.vehiculo_id) ? ` · ${patente(v.vehiculo_id)}` : ""}</div>)}
              </li>
            ))}
          </ul>
        )}
      </Bloque>

      <Bloque titulo="🚐 Por vehículo" etiqueta="Viajes por vehículo">
        {!porVehiculo.length ? <div className="text-[13px] text-gypi-dim">No hay viajes este día.</div> : (
          <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
            {porVehiculo.map((g) => {
              const ve = vehiculos.find((x) => x.id === g.clave);
              return (
                <li key={g.clave ?? "sin"} className="text-[13px]">
                  <div className="text-[14px] font-semibold">{ve ? [ve.patente, [ve.marca, ve.modelo].filter(Boolean).join(" ")].filter(Boolean).join(" · ") : "Sin vehículo"} · {g.viajes.length} {g.viajes.length === 1 ? "viaje" : "viajes"}</div>
                  {g.viajes.map((v) => <div key={v.id} className="text-gypi-dim">{filaViaje(v)}{nombre(v.chofer_id) ? ` · ${nombre(v.chofer_id)}` : ""}</div>)}
                </li>
              );
            })}
          </ul>
        )}
      </Bloque>

      <Bloque titulo={`✍️ Entregas sin firma (${sinFirma.length})`} etiqueta="Entregas sin firma">
        {!sinFirma.length ? <div className="text-[13px] text-gypi-dim">Todas las entregas están firmadas.</div> : (
          <>
            <div className="text-[12px] text-gypi-dim mb-1.5">No había nadie para firmar: mandá el link del remito para que firmen desde el celular.</div>
            <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
              {sinFirma.slice(0, 15).map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-[13px]">
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold truncate">{p.nombre}{p.ots?.length ? ` · OT ${p.ots.join(", ")}` : ""}</span>
                    <span className="block text-gypi-dim">Viaje {viajeDe(p)?.numero} · {fechaCorta(viajeDe(p)?.fecha)}</span>
                  </span>
                  <button type="button" className="g-btn g-btn-secondary !min-h-[40px] text-[13px]" aria-label={`Mandar el remito de ${p.nombre}`} onClick={() => setRemito(p)}>📄 Mandar link</button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Bloque>

      <Bloque titulo="⏱️ ¿Se hizo el día planeado?" etiqueta="Entregas a tiempo">
        {tiempo.total === 0 && !tiempo.atrasadas.length ? <div className="text-[13px] text-gypi-dim">Todavía no hay paradas cumplidas en los últimos {DIAS_A_TIEMPO} días.</div> : (
          <>
            {tiempo.total > 0 && (
              <div className="text-[13px]">
                Últimos {DIAS_A_TIEMPO} días: <b>{tiempo.aTiempo} de {tiempo.total}</b> paradas el día planeado ({tiempo.porcentaje}%).
                {tiempo.tarde > 0 && ` ${tiempo.tarde} ${tiempo.tarde === 1 ? "fue otro día o no se fue" : "fueron otro día o no se fue"}.`}
              </div>
            )}
            {tiempo.atrasadas.length > 0 && (
              <div className="text-[13px] mt-1">
                ⚠️ {tiempo.atrasadas.length === 1 ? "1 parada quedó" : `${tiempo.atrasadas.length} paradas quedaron`} pendiente de días anteriores:{" "}
                {tiempo.atrasadas.slice(0, 5).map((p) => `${p.nombre} (viaje ${viajeDe(p)?.numero}, ${fechaCorta(viajeDe(p)?.fecha)})`).join("; ")}{tiempo.atrasadas.length > 5 ? "…" : ""}
              </div>
            )}
          </>
        )}
      </Bloque>

      <Bloque titulo={`⚠️ Incidencias (${malas.length})`} etiqueta="Incidencias">
        {!malas.length ? <div className="text-[13px] text-gypi-dim">Sin parciales, rechazos ni paradas sin ir.</div> : (
          <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
            {malas.map((p) => {
              const e = estadoParada(p.estado, p.accion);
              return (
                <li key={p.id} className="text-[13px]">
                  <div className="font-semibold">{e.emoji} {e.label} · {p.nombre}</div>
                  <div className="text-gypi-dim">Viaje {viajeDe(p)?.numero} · {fechaCorta(viajeDe(p)?.fecha)}{nombre(p.hecha_por) ? ` · ${nombre(p.hecha_por)}` : ""}</div>
                  {p.motivo && <div>{p.motivo}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </Bloque>

      {remito && <RemitoParada parada={remito} onCerrar={() => setRemito(null)} onCambio={cargar} />}
    </div>
  );
}
