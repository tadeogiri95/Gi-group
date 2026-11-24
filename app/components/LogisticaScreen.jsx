'use client';
// app/components/LogisticaScreen.jsx — Logística → Lugares y obras (Logística,
// parte 1; migración 203; pedido de Tadeo, 23/11).
//   📍 Lugares: planta, depósitos, proveedores, clientes y otros, cada uno con
//      su dirección y su pin. Se dan de baja, no se borran.
//   🏗️ Obras: las obras de las OT activas (una por nombre de obra) con su
//      dirección; se carga una vez y queda en todas las OT de esa obra.
// Con estos puntos se arman después los viajes y el recorrido en Google Maps.
// Cargan y editan el Dueño, los supervisores y Administración; los demás miran.
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, sbGetAll } from "../lib/supabase";
import { faltaTabla } from "../lib/compras";
import { AVISO_MIGRACION_LOGISTICA, TIPOS_LUGAR, obrasDeOts, puedeGestionarLogistica, textoUbicacion, tipoLugar } from "../lib/logistica";
import { coordsValidas, linkGoogleMaps } from "../lib/ubicacion";
import { Chip, FilaDeslizable } from "./ui";
import CampoUbicacion from "./CampoUbicacion";

export async function postLogistica(body) {
  const res = await apiFetch("/api/logistica", { method: "POST", body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo guardar");
  return data;
}

const vacioANull = (v) => (String(v ?? "").trim() ? String(v).trim() : null);
const LUGAR_VACIO = { nombre: "", tipo: "planta", direccion: "", lat: null, lng: null, proveedor_id: "", contacto: "", telefono: "", horario: "", notas: "" };

function Campo({ id, label, children }) {
  return (
    <div className="flex-1 min-w-0">
      <label className="g-label" htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

/** Botón chico que abre el punto en Google Maps (en el celular abre la app). */
function BotonMaps({ lugar, nombre }) {
  const link = linkGoogleMaps(lugar);
  if (!link) return null;
  return (
    <a href={link} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${nombre} en Google Maps`}
      className="shrink-0 flex items-center justify-center min-w-[44px] min-h-[44px] rounded-[10px] border border-gypi-border bg-gypi-bg text-[18px] no-underline">
      🗺️
    </a>
  );
}

export function FormLugar({ lugar = null, proveedores = [], onCancelar, onGuardado }) {
  const [form, setForm] = useState(() => (lugar
    ? { ...LUGAR_VACIO, ...Object.fromEntries(Object.entries(lugar).map(([k, v]) => [k, v ?? (k === "lat" || k === "lng" ? null : "")])) }
    : { ...LUGAR_VACIO }));
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const cambiar = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  const elegirProveedor = (e) => {
    const p = proveedores.find((x) => String(x.id) === e.target.value);
    setForm((f) => ({ ...f, proveedor_id: e.target.value, nombre: f.nombre || p?.nombre || "" }));
  };

  const guardar = async () => {
    if (!form.nombre.trim()) { setError("Poné el nombre del lugar"); return; }
    const pin = coordsValidas(form.lat, form.lng);
    if (!pin && !String(form.direccion || "").trim()) { setError("Poné la dirección o marcá el lugar en el mapa"); return; }
    setEnviando(true);
    setError(null);
    try {
      const data = await postLogistica({
        accion: "lugar_guardar",
        ...(lugar?.id ? { id: lugar.id } : {}),
        nombre: form.nombre.trim(), tipo: form.tipo, direccion: vacioANull(form.direccion),
        lat: pin ? Number(form.lat) : null, lng: pin ? Number(form.lng) : null,
        proveedor_id: form.tipo === "proveedor" && form.proveedor_id ? Number(form.proveedor_id) : null,
        contacto: vacioANull(form.contacto), telefono: vacioANull(form.telefono), horario: vacioANull(form.horario), notas: vacioANull(form.notas),
      });
      await onGuardado(data.lugar);
    } catch (e) {
      setError(e.message);
      setEnviando(false);
    }
  };

  return (
    <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
      <div className="text-[15px] font-bold mb-2">{lugar ? `Editar ${lugar.nombre}` : "Nuevo lugar"}</div>
      <div className="flex gap-2">
        <Campo id="lug-tipo" label="Tipo">
          <select id="lug-tipo" className="g-input w-full mb-2" value={form.tipo} onChange={cambiar("tipo")}>
            {TIPOS_LUGAR.map((t) => <option key={t.id} value={t.id}>{t.emoji} {t.label}</option>)}
          </select>
        </Campo>
        {form.tipo === "proveedor" && proveedores.length > 0 && (
          <Campo id="lug-proveedor" label="Proveedor de Compras">
            <select id="lug-proveedor" className="g-input w-full mb-2" value={form.proveedor_id || ""} onChange={elegirProveedor}>
              <option value="">Ninguno</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Campo>
        )}
      </div>
      <label className="g-label" htmlFor="lug-nombre">Nombre</label>
      <input id="lug-nombre" className="g-input w-full mb-2" value={form.nombre} onChange={cambiar("nombre")} maxLength={120} placeholder="Planta Pilar, Depósito, Maderera López…" />
      <CampoUbicacion id="lug" value={{ direccion: form.direccion, lat: form.lat, lng: form.lng }} onChange={(u) => setForm((f) => ({ ...f, ...u }))} />
      <div className="flex gap-2">
        <Campo id="lug-contacto" label="Contacto"><input id="lug-contacto" className="g-input w-full mb-2" value={form.contacto} onChange={cambiar("contacto")} maxLength={120} placeholder="Quién recibe" /></Campo>
        <Campo id="lug-telefono" label="Teléfono"><input id="lug-telefono" className="g-input w-full mb-2" value={form.telefono} onChange={cambiar("telefono")} maxLength={40} inputMode="tel" /></Campo>
      </div>
      <label className="g-label" htmlFor="lug-horario">Horario para recibir</label>
      <input id="lug-horario" className="g-input w-full mb-2" value={form.horario} onChange={cambiar("horario")} maxLength={120} placeholder="Lunes a viernes de 8 a 16" />
      <label className="g-label" htmlFor="lug-notas">Notas</label>
      <textarea id="lug-notas" className="g-input w-full mb-2" rows={2} value={form.notas} onChange={cambiar("notas")} maxLength={500} placeholder="Portón, dónde descargar, timbre…" />
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      <div className="flex gap-2">
        <button type="button" className="g-btn g-btn-secondary flex-1" onClick={onCancelar} disabled={enviando}>Cancelar</button>
        <button type="button" className="g-btn g-btn-primary flex-1" onClick={guardar} disabled={enviando}>{enviando ? "Guardando…" : "Guardar"}</button>
      </div>
    </div>
  );
}

function FormObra({ obra, onCancelar, onGuardado }) {
  const [ubic, setUbic] = useState({ direccion: obra.direccion || "", lat: obra.lat, lng: obra.lng });
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const muchas = obra.ots.length > 1;

  const guardar = async (borrar = false) => {
    const pin = coordsValidas(ubic.lat, ubic.lng);
    if (!borrar && !pin && !String(ubic.direccion || "").trim()) { setError("Poné la dirección o marcá la obra en el mapa"); return; }
    setEnviando(true);
    setError(null);
    try {
      await postLogistica({
        accion: "obra_direccion", ot_ids: obra.ids,
        direccion: borrar ? null : vacioANull(ubic.direccion),
        lat: !borrar && pin ? Number(ubic.lat) : null, lng: !borrar && pin ? Number(ubic.lng) : null,
      });
      await onGuardado();
    } catch (e) {
      setError(e.message);
      setEnviando(false);
    }
  };

  return (
    <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
      <div className="text-[15px] font-bold">🏗️ {obra.nombre}</div>
      <div className="text-[13px] text-gypi-dim mb-2">
        {obra.cliente ? `${obra.cliente} · ` : ""}{muchas ? `OT ${obra.ots.join(", ")}` : `OT ${obra.ots[0]}`}
      </div>
      <CampoUbicacion id="obra" value={ubic} onChange={setUbic} />
      {muchas && <div className="text-[13px] text-gypi-dim mb-2">La dirección queda en las {obra.ots.length} OT de esta obra.</div>}
      {obra.distintas && <div className="text-[13px] mb-2">⚠️ Las OT de esta obra tenían direcciones distintas: al guardar quedan todas con esta.</div>}
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      <div className="flex gap-2">
        <button type="button" className="g-btn g-btn-secondary flex-1" onClick={onCancelar} disabled={enviando}>Cancelar</button>
        <button type="button" className="g-btn g-btn-primary flex-1" onClick={() => guardar(false)} disabled={enviando}>{enviando ? "Guardando…" : "Guardar"}</button>
      </div>
      {obra.sinDireccion < obra.ots.length && (
        <button type="button" className="g-btn g-btn-secondary w-full mt-2" onClick={() => guardar(true)} disabled={enviando}>Borrar la dirección</button>
      )}
    </div>
  );
}

export default function LogisticaScreen({ empresaId, usuario = null }) {
  const [lugares, setLugares] = useState(null);
  const [proyectos, setProyectos] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [error, setError] = useState(null);
  const [vista, setVista] = useState("lugares");
  const [texto, setTexto] = useState("");
  const [verBajas, setVerBajas] = useState(false);
  const [editando, setEditando] = useState(null); // lugar, "nuevo" o null
  const [obraAbierta, setObraAbierta] = useState(null);
  const editable = puedeGestionarLogistica(usuario?.rol);

  const cargar = useCallback(async () => {
    if (!empresaId) return;
    try {
      const [l, p] = await Promise.all([
        sbGetAll("logistica_lugares?order=nombre.asc,id.asc", { maxFilas: 5000 }),
        sbGetAll("proyectos?estado=neq.cerrado&select=id,ot,cliente,obra,estado,direccion,lat,lng&order=id.desc", { maxFilas: 20000 }),
      ]);
      setLugares(l.data || []);
      setProyectos(p.data || []);
      setError(null);
    } catch (err) {
      setLugares([]);
      setError(faltaTabla(err, "logistica_lugares") || /direccion|lat|lng/.test(String(err?.message)) ? AVISO_MIGRACION_LOGISTICA : "No se pudieron leer los lugares");
    }
    // Proveedores de Compras (solo para ligar un lugar de tipo proveedor; sin Compras, nada)
    if (editable) {
      const pr = await sbGetAll("proveedores?activo=eq.true&select=id,nombre&order=nombre.asc", { maxFilas: 5000 }).catch(() => ({ data: [] }));
      setProveedores(pr.data || []);
    }
  }, [empresaId, editable]);
  useEffect(() => { cargar(); }, [cargar]);

  const filas = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return (lugares || [])
      .filter((l) => (verBajas ? !l.activo : l.activo))
      .filter((l) => !t || [l.nombre, l.direccion, l.contacto, tipoLugar(l.tipo).label].some((x) => String(x ?? "").toLowerCase().includes(t)))
      .sort((a, b) => TIPOS_LUGAR.findIndex((x) => x.id === a.tipo) - TIPOS_LUGAR.findIndex((x) => x.id === b.tipo) || a.nombre.localeCompare(b.nombre, "es"));
  }, [lugares, texto, verBajas]);
  const obras = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return obrasDeOts(proyectos).filter((o) => !t || [o.nombre, o.cliente, o.direccion, ...o.ots].some((x) => String(x ?? "").toLowerCase().includes(t)));
  }, [proyectos, texto]);
  const obrasSinDireccion = useMemo(() => obrasDeOts(proyectos).filter((o) => o.sinDireccion > 0).length, [proyectos]);

  const darDeBaja = async (l) => {
    try {
      await postLogistica({ accion: "lugar_baja", id: l.id, activo: !l.activo });
      setEditando(null);
      await cargar();
    } catch (e) {
      setError(e.message);
    }
  };

  if (editando) {
    const lugar = editando === "nuevo" ? null : editando;
    return (
      <div className="flex-1 overflow-y-auto px-[18px] pb-6">
        <FormLugar lugar={lugar} proveedores={proveedores} onCancelar={() => setEditando(null)}
          onGuardado={async () => { setEditando(null); await cargar(); }} />
        {lugar && (
          <button type="button" className="g-btn g-btn-secondary w-full" onClick={() => darDeBaja(lugar)}>
            {lugar.activo ? "Dar de baja este lugar" : "Volver a usar este lugar"}
          </button>
        )}
      </div>
    );
  }

  if (obraAbierta) {
    const obra = obrasDeOts(proyectos).find((o) => o.clave === obraAbierta);
    if (obra) {
      return (
        <div className="flex-1 overflow-y-auto px-[18px] pb-6">
          <FormObra obra={obra} onCancelar={() => setObraAbierta(null)} onGuardado={async () => { setObraAbierta(null); await cargar(); }} />
        </div>
      );
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      <FilaDeslizable role="group" aria-label="Ver" activa={vista} className="gap-1.5 mb-3">
        <Chip active={vista === "lugares"} onClick={() => setVista("lugares")}>📍 Lugares</Chip>
        <Chip active={vista === "obras"} onClick={() => setVista("obras")}>🏗️ Obras{obrasSinDireccion ? ` (${obrasSinDireccion} sin dirección)` : ""}</Chip>
      </FilaDeslizable>
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}

      {vista === "lugares" && (
        <>
          <div className="text-[13px] text-gypi-dim mb-2">La planta, los depósitos, los proveedores donde retiran y otros lugares fijos. Se cargan una vez y después se eligen al armar un viaje.</div>
          {editable && <button type="button" onClick={() => setEditando("nuevo")} className="g-btn g-btn-primary w-full mb-3">＋ Agregar lugar</button>}
          <div className="flex gap-2 mb-2 items-center">
            <input aria-label="Buscar lugar" className="g-input flex-1 min-w-0" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar nombre o dirección" />
            <label className="flex items-center gap-1 text-[13px] text-gypi-dim min-h-[44px]">
              <input type="checkbox" checked={verBajas} onChange={(e) => setVerBajas(e.target.checked)} /> Dados de baja
            </label>
          </div>
          {lugares === null ? (
            <div className="text-[14px] text-gypi-dim" role="status">Cargando los lugares…</div>
          ) : !filas.length ? (
            <div className="text-[14px] text-gypi-dim">
              {lugares.length ? "No hay lugares con ese filtro." : "Todavía no hay lugares. Empezá por la planta y los depósitos."}
            </div>
          ) : (
            <ul aria-label="Lugares" className="list-none m-0 p-0 lista-ancha flex flex-col gap-1.5">
              {filas.map((l) => {
                const t = tipoLugar(l.tipo);
                const datos = [t.label, l.contacto, l.telefono].filter(Boolean);
                return (
                  <li key={l.id} className="flex gap-1.5 items-stretch">
                    <button type="button" onClick={() => editable && setEditando(l)} disabled={!editable} aria-label={editable ? `Editar ${l.nombre}` : l.nombre}
                      className="flex-1 min-w-0 flex items-center gap-2.5 p-2.5 min-h-[44px] rounded-[10px] border border-gypi-border bg-gypi-surface text-left cursor-pointer font-body text-gypi-text">
                      <span className="text-[20px]" aria-hidden="true">{t.emoji}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[15px] font-bold truncate">{l.nombre}</span>
                        <span className="block text-[13px] truncate">{textoUbicacion(l)}{!coordsValidas(l.lat, l.lng) && l.direccion ? " · sin pin" : ""}</span>
                        <span className="block text-[12px] text-gypi-dim truncate">{datos.join(" · ")}</span>
                      </span>
                    </button>
                    <BotonMaps lugar={l} nombre={l.nombre} />
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {vista === "obras" && (
        <>
          <div className="text-[13px] text-gypi-dim mb-2">Las obras de las OT abiertas. La dirección se carga una vez por obra y queda en todas sus OT.</div>
          <input aria-label="Buscar obra" className="g-input w-full mb-2" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar obra, cliente u OT" />
          {lugares === null ? (
            <div className="text-[14px] text-gypi-dim" role="status">Cargando las obras…</div>
          ) : !obras.length ? (
            <div className="text-[14px] text-gypi-dim">{proyectos.length ? "No hay obras con ese filtro." : "No hay OT abiertas."}</div>
          ) : (
            <ul aria-label="Obras" className="list-none m-0 p-0 lista-ancha flex flex-col gap-1.5">
              {obras.map((o) => (
                <li key={o.clave} className="flex gap-1.5 items-stretch">
                  <button type="button" onClick={() => editable && setObraAbierta(o.clave)} disabled={!editable} aria-label={editable ? `Dirección de ${o.nombre}` : o.nombre}
                    className="flex-1 min-w-0 flex items-center gap-2.5 p-2.5 min-h-[44px] rounded-[10px] border border-gypi-border bg-gypi-surface text-left cursor-pointer font-body text-gypi-text">
                    <span className="text-[20px]" aria-hidden="true">{o.sinDireccion ? "⚪" : "🏗️"}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[15px] font-bold truncate">{o.nombre}</span>
                      <span className={`block text-[13px] truncate ${o.sinDireccion === o.ots.length ? "text-gypi-dim" : ""}`}>
                        {textoUbicacion(o)}{o.direccion && !o.conPin ? " · sin pin" : ""}
                      </span>
                      <span className="block text-[12px] text-gypi-dim truncate">
                        {[o.cliente, `OT ${o.ots.join(", ")}`].filter(Boolean).join(" · ")}
                        {o.sinDireccion > 0 && o.sinDireccion < o.ots.length ? ` · ${o.sinDireccion} OT sin dirección` : ""}
                      </span>
                    </span>
                  </button>
                  <BotonMaps lugar={o} nombre={o.nombre} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
