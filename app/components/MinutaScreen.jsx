"use client";
// app/components/MinutaScreen.jsx — Producción → 📝 Minuta (Minuta, parte M1;
// migración 150; diseño en notes/diseno-minuta-buenos-dias.md).
//
// La minuta de la reunión de Buenos Días con las secciones de la minuta v2 en
// papel. Cada renglón se elige de lo que ya está en Gypi: las OT (con su
// división, proyecto y cliente), las personas, los artículos del inventario,
// los proveedores y los vehículos. Siempre se puede escribir a mano lo que no
// está (un instalador de afuera, una obra sin OT). Solo Dueño / Gerencia.
// Se guarda por /api/minutas; se imprime o se baja en PDF con el formato v2.
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, sb, sbGetAll } from "../lib/supabase";
import { hoyArg } from "../lib/dates";
import {
  AREAS_DYT, AREAS_FEEDBACK, BLOQUES, CLAVE_CONFIG_MINUTA, ESTADOS_DYT, LISTO, SEMAFOROS, TIPOS_FEEDBACK, URGENCIAS,
  VECES_A_GERENCIA, datosDeOt, duracionMinutos, renglonQueSigue, seguimientoPendiente, textoSeguimiento, SECCIONES_SEGUIMIENTO, faltantesMinuta, hora, imprimirMinuta, participantesDe, renglonNuevo, renglonesParaGuardar, seccionesDe,
} from "../lib/minutas";
import { nombreDivisionOt } from "../lib/avance";
import { sugerenciasPendientes } from "../lib/minutasPrecarga";
import { useAuth } from "../context/AuthContext";
import { Chip, Modal, Spinner } from "./ui";
import { useToast } from "./ui/Toast";

const MAX_SUGERENCIAS = 8;
const normal = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Caja de texto que sugiere de una lista y deja escribir lo que no está. */
function Sugerencias({ label, value, onChange, opciones, onElegir, placeholder = "", disabled = false }) {
  const [abierto, setAbierto] = useState(false);
  const lista = useMemo(() => {
    const q = normal(value).trim();
    if (!q) return [];
    return opciones.filter((o) => normal(`${o.label} ${o.detalle || ""}`).includes(q)).slice(0, MAX_SUGERENCIAS);
  }, [value, opciones]);
  return (
    <div className="relative">
      <input
        className="g-input w-full"
        aria-label={label}
        placeholder={placeholder || label}
        value={value || ""}
        disabled={disabled}
        onChange={(e) => { onChange(e.target.value); setAbierto(true); }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
      />
      {abierto && lista.length > 0 && (
        <ul role="listbox" aria-label={`Sugerencias de ${label}`} className="absolute z-20 left-0 right-0 mt-1 max-h-64 overflow-auto rounded-lg border border-gypi-border bg-gypi-bg shadow-lg list-none p-1 m-0">
          {lista.map((o) => (
            <li key={o.valor} role="option" aria-selected="false">
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onElegir(o); setAbierto(false); }}
                className="w-full text-left bg-transparent border-none cursor-pointer px-2 py-2 rounded-md text-gypi-text text-[14px] min-h-[44px] hover:bg-gypi-surf-hi">
                <span className="font-semibold">{o.label}</span>
                {o.detalle && <span className="block text-[12px] text-gypi-mute">{o.detalle}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Con un botón adentro va como div: un <label> le pondría su texto de nombre
function Campo({ label, children, ancho = false, div = false }) {
  const Tag = div ? "div" : "label";
  return (
    <Tag className={`flex flex-col gap-1 text-[12px] text-gypi-mute ${ancho ? "sm:col-span-2" : ""}`}>
      <span>{label}</span>
      {children}
    </Tag>
  );
}

/** Los tres colores del estado. */
function Semaforo({ value, onChange, disabled }) {
  return (
    <div role="group" aria-label="Estado" className="flex gap-1">
      {SEMAFOROS.map((s) => (
        <button key={s.id} type="button" disabled={disabled} aria-pressed={value === s.id} aria-label={s.label}
          onClick={() => onChange(value === s.id ? null : s.id)}
          className={`min-h-[44px] flex-1 rounded-lg border text-[13px] cursor-pointer ${value === s.id ? "border-gypi-text bg-gypi-surf-hi font-bold" : "border-gypi-border bg-transparent"}`}>
          {s.punto} {s.label}
        </button>
      ))}
    </div>
  );
}

/** Un renglón de una sección, con los campos que lleva esa sección. */
function Renglon({ s, it, cambiar, sacar, listas, disabled, resolver = null }) {
  const c = (campo) => s.campos.includes(campo);
  const datos = (k, v) => cambiar({ datos: { ...it.datos, [k]: v } });
  const textoOt = it.ot ? `OT ${it.ot}${it.proyecto ? ` · ${it.proyecto}` : ""}` : it.proyecto || "";
  const falta = (campo) => s.obligatorios?.includes(campo) && !it[campo === "fecha" ? "fecha_objetivo" : campo] && (it.ot || it.proyecto || it.texto);
  return (
    <div className={`g-card p-3 mb-2 ${it.resuelto_at ? "opacity-60" : ""}`}>
      {(textoSeguimiento(it) || it.datos?.gerencia || it.resuelto_at) && (
        <div className="flex flex-wrap gap-2 mb-2 text-[12px]">
          {textoSeguimiento(it) && <span className="text-gypi-amber-ink font-semibold">{textoSeguimiento(it)}</span>}
          {it.datos?.gerencia && <span className="text-gypi-red-ink font-semibold">🔴 {VECES_A_GERENCIA} días seguidos: lo toma Gerencia</span>}
          {it.resuelto_at && <span className="text-gypi-green-ink font-semibold">✓ Resuelto</span>}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {c("articulo") && (
          <Campo label={s.texto} ancho>
            <Sugerencias label={s.texto} value={it.texto} disabled={disabled} opciones={listas.articulos}
              onChange={(v) => cambiar({ texto: v, datos: { ...it.datos, sku: null } })}
              onElegir={(o) => cambiar({ texto: o.label, datos: { ...it.datos, sku: o.valor } })} placeholder="Artículo del inventario o texto libre" />
          </Campo>
        )}
        {c("area") && s.id === "dyt" && (
          <Campo label="Estado">
            <select className="g-input w-full" aria-label="Estado del ítem" value={it.tipo || ""} disabled={disabled} onChange={(e) => cambiar({ tipo: e.target.value || null })}>
              {ESTADOS_DYT.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </Campo>
        )}
        {c("ot") && (
          <Campo label={s.id === "compra" ? "Para proyecto" : "OT o proyecto"} ancho={s.id !== "dyt" && s.id !== "compra"}>
            <Sugerencias label={s.id === "compra" ? "Para proyecto" : "OT o proyecto"} value={textoOt} disabled={disabled} opciones={listas.ots}
              onChange={(v) => cambiar({ ot: null, proyecto: v })}
              onElegir={(o) => cambiar(datosDeOt(o.dato))} placeholder="Buscá la OT, el cliente o la obra" />
            {it.ot ? (
              <span className="text-[12px] text-gypi-mute">{[it.division, it.cliente].filter(Boolean).join(" · ")}</span>
            ) : s.id !== "dyt" && s.id !== "compra" && (it.proyecto || "") !== "" ? (
              <input className="g-input w-full" aria-label="Cliente" placeholder="Cliente" value={it.cliente || ""} disabled={disabled} onChange={(e) => cambiar({ cliente: e.target.value })} />
            ) : null}
          </Campo>
        )}
        {c("semaforo") && (
          <Campo label="Estado" ancho div><Semaforo value={it.semaforo} disabled={disabled} onChange={(v) => cambiar({ semaforo: v })} /></Campo>
        )}
        {s.id === "feedback" && (
          <>
            <Campo label="Tipo">
              <select className="g-input w-full" aria-label="Tipo de feedback" value={it.tipo || ""} disabled={disabled} onChange={(e) => cambiar({ tipo: e.target.value || null })}>
                <option value="">Elegí</option>
                {TIPOS_FEEDBACK.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Campo>
            <Campo label="Feedback para">
              <select className="g-input w-full" aria-label="Feedback para" value={it.area || ""} disabled={disabled} onChange={(e) => cambiar({ area: e.target.value || null })}>
                <option value="">Elegí</option>
                {AREAS_FEEDBACK.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Campo>
          </>
        )}
        {c("proveedor") && (
          <Campo label="Proveedor">
            <Sugerencias label="Proveedor" value={it.datos?.proveedor} disabled={disabled} opciones={listas.proveedores}
              onChange={(v) => datos("proveedor", v)} onElegir={(o) => datos("proveedor", o.label)} />
          </Campo>
        )}
        {s.id === "compra" && (
          <Campo label="Urgencia">
            <select className="g-input w-full" aria-label="Urgencia" value={it.tipo || "normal"} disabled={disabled} onChange={(e) => cambiar({ tipo: e.target.value })}>
              {URGENCIAS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
            </select>
          </Campo>
        )}
        {c("texto") && (
          <Campo label={s.texto} ancho>
            <input className="g-input w-full" aria-label={s.texto} value={it.texto || ""} maxLength={1000} disabled={disabled} onChange={(e) => cambiar({ texto: e.target.value })} />
          </Campo>
        )}
        {c("desde") && (
          <>
            <Campo label="Desde"><input className="g-input w-full" aria-label="Desde" value={it.datos?.desde || ""} disabled={disabled} onChange={(e) => datos("desde", e.target.value)} /></Campo>
            <Campo label="Hasta"><input className="g-input w-full" aria-label="Hasta" value={it.datos?.hasta || ""} disabled={disabled} onChange={(e) => datos("hasta", e.target.value)} /></Campo>
          </>
        )}
        {c("listo") && (
          <Campo label="¿Planilla y material?">
            <select className="g-input w-full" aria-label="¿Planilla y material?" value={it.datos?.listo || ""} disabled={disabled} onChange={(e) => datos("listo", e.target.value || null)}>
              <option value="">Sin revisar</option>
              {LISTO.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </Campo>
        )}
        {c("responsable") && (
          <Campo label={`${s.responsable || "Responsable"}${s.obligatorios?.includes("responsable") ? " *" : ""}`}>
            <Sugerencias label={s.responsable || "Responsable"} value={it.responsable} disabled={disabled} opciones={listas.personas}
              onChange={(v) => cambiar({ responsable: v })} onElegir={(o) => cambiar({ responsable: o.label })} placeholder="Persona de Gypi o nombre" />
            {falta("responsable") && <span className="text-[12px] text-gypi-red-ink">Sin responsable no se registra</span>}
          </Campo>
        )}
        {c("vehiculo") && (
          <Campo label="Vehículo">
            <select className="g-input w-full" aria-label="Vehículo" value={it.datos?.vehiculo || ""} disabled={disabled} onChange={(e) => datos("vehiculo", e.target.value || null)}>
              <option value="">Sin vehículo</option>
              {listas.vehiculos.map((v) => <option key={v.valor} value={v.label}>{v.label}</option>)}
            </select>
          </Campo>
        )}
        {c("fecha") && (
          <Campo label={`${s.fecha || "Fecha objetivo"}${s.obligatorios?.includes("fecha") ? " *" : ""}`}>
            <input type="date" className="g-input w-full" aria-label={s.fecha || "Fecha objetivo"} value={it.fecha_objetivo || ""} disabled={disabled} onChange={(e) => cambiar({ fecha_objetivo: e.target.value || null })} />
            {falta("fecha") && <span className="text-[12px] text-gypi-red-ink">Sin fecha objetivo no se registra</span>}
          </Campo>
        )}
        {c("donde") && (
          <Campo label="Dónde"><input className="g-input w-full" aria-label="Dónde" value={it.datos?.donde || ""} disabled={disabled} onChange={(e) => datos("donde", e.target.value)} /></Campo>
        )}
      </div>
      {(resolver || !disabled) && (
        <div className="flex justify-end gap-2 mt-1">
          {resolver && (
            <button type="button" onClick={resolver} aria-pressed={!!it.resuelto_at}
              className="min-h-[44px] px-3 bg-transparent border-none text-gypi-green-ink cursor-pointer text-[13px] font-semibold">
              {it.resuelto_at ? "↺ Reabrir" : "✓ Resuelto"}
            </button>
          )}
          {!disabled && <button type="button" onClick={sacar} className="min-h-[44px] px-3 bg-transparent border-none text-gypi-red-ink cursor-pointer text-[13px]">🗑 Sacar renglón</button>}
        </div>
      )}
    </div>
  );
}

const fechaCorta = (f) => (f ? `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}` : "");

/**
 * Renglones para agregar con un toque: lo que Gypi sugiere (parte M2) o lo que
 * sigue abierto de minutas anteriores (parte M3).
 * opciones: [{ clave, nombre, detalle, valor }]
 */
function ParaAgregar({ titulo, label, opciones, onAgregar, alerta = false }) {
  const [abierto, setAbierto] = useState(true);
  if (!opciones.length) return null;
  return (
    <div className={`rounded-lg border border-dashed p-2 mb-2 ${alerta ? "border-gypi-amber" : "border-gypi-border"}`} aria-label={label} role="group">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="bg-transparent border-none cursor-pointer text-left text-[13px] font-semibold text-gypi-text min-h-[44px] px-1"
          aria-expanded={abierto} onClick={() => setAbierto((x) => !x)}>
          {titulo} ({opciones.length}) {abierto ? "▾" : "▸"}
        </button>
        {opciones.length > 1 && <button type="button" className="g-btn g-btn-secondary" onClick={() => onAgregar(opciones.map((o) => o.valor))}>＋ Agregar todos</button>}
      </div>
      {abierto && (
        <ul className="list-none m-0 p-0">
          {opciones.map((o) => (
            <li key={o.clave} className="flex items-center gap-2 py-1 border-t border-gypi-border first:border-t-0">
              <span className="flex-1 min-w-0 text-[13px]">
                <span className="font-semibold">{o.nombre}</span>
                {o.detalle && <span className="block text-[12px] text-gypi-mute">{o.detalle}</span>}
              </span>
              <button type="button" className="g-btn g-btn-secondary" aria-label={`Agregar ${o.nombre}`} onClick={() => onAgregar([o.valor])}>＋</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Texto de una sugerencia de Gypi: "40 % · arranca hoy · Todo listo · entrega 6/11". */
function detalleSugerencia(x, s, hoy) {
  return [
    x.datos?.avance != null ? `${x.datos.avance} %` : "",
    x.datos?.arranca ? (x.datos.arranca === hoy ? "arranca hoy" : `arranca el ${fechaCorta(x.datos.arranca)}`) : "",
    x.datos?.listo ? LISTO.find((l) => l.id === x.datos.listo)?.label : "",
    x.texto || "",
    x.fecha_objetivo ? `${s.id === "prod_a_iniciar" ? "entrega" : "fecha"} ${fechaCorta(x.fecha_objetivo)}` : "",
  ].filter(Boolean).join(" · ");
}

/**
 * Revisión del jueves (parte M3): el feedback de la última semana junto, por
 * área, para revisarlo entre todos. ✓ Revisado lo deja anotado.
 */
function RevisionFeedback({ abierto, hasta, onCerrar }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  useEffect(() => {
    if (!abierto) return;
    setItems(null);
    const desde = new Date(Date.parse(`${hasta}T12:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
    apiFetch(`/api/minutas?feedback=${desde}`).then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => setItems(ok ? j.items || [] : []))
      .catch(() => setItems([]));
  }, [abierto, hasta]);
  async function revisar(it) {
    const r = await apiFetch("/api/minutas", { method: "POST", body: JSON.stringify({ accion: "resolver", id: it.id, resuelto: !it.resuelto_at }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error(j.error || "No se pudo marcar"); return; }
    setItems((l) => l.map((x) => (x.id === it.id ? { ...x, resuelto_at: j.item?.resuelto_at ?? null } : x)));
  }
  const areas = [...new Set((items || []).map((it) => it.area || "Sin área"))];
  return (
    <Modal open={abierto} onClose={onCerrar} title="Revisión del jueves: feedback de la semana" maxWidth={640}>
      {items === null ? <div className="flex justify-center py-6"><Spinner /></div> : items.length === 0 ? (
        <p className="text-[14px] text-gypi-mute">No hubo feedback en los últimos 7 días.</p>
      ) : areas.map((area) => {
        const deArea = items.filter((it) => (it.area || "Sin área") === area);
        return (
          <section key={area} className="mb-3" aria-label={`Feedback para ${area}`}>
            <h3 className="text-[14px] font-bold m-0 mb-1">{area} <span className="font-normal text-gypi-mute text-[12px]">{deArea.filter((it) => it.resuelto_at).length} de {deArea.length} revisados</span></h3>
            {deArea.map((it) => (
              <div key={it.id} className={`flex items-center gap-2 py-2 border-t border-gypi-border ${it.resuelto_at ? "opacity-60" : ""}`}>
                <span className="flex-1 min-w-0 text-[13px]">
                  <span className="font-semibold">{[it.tipo, it.ot ? `OT ${it.ot}` : it.proyecto, it.cliente].filter(Boolean).join(" · ")}</span>
                  <span className="block">{it.texto}</span>
                  <span className="block text-[12px] text-gypi-mute">{[fechaCorta(it.fecha), it.responsable ? `lo trajo ${it.responsable}` : ""].filter(Boolean).join(" · ")}</span>
                </span>
                <button type="button" className="g-btn g-btn-secondary whitespace-nowrap" aria-pressed={!!it.resuelto_at} onClick={() => revisar(it)}>
                  {it.resuelto_at ? "✓ Revisado" : "Revisar"}
                </button>
              </div>
            ))}
          </section>
        );
      })}
      <button type="button" className="g-btn g-btn-secondary w-full mt-2" onClick={onCerrar}>Cerrar</button>
    </Modal>
  );
}

/** Lista de participantes que se tildan en Asistencia y se eligen en Modera / Registra. */
function EditarParticipantes({ abierto, inicial, onCerrar, onGuardar }) {
  const [lista, setLista] = useState(inicial);
  useEffect(() => { if (abierto) setLista(inicial.length ? inicial : [{ nombre: "", area: "" }]); }, [abierto, inicial]);
  const cambiar = (i, campo, v) => setLista((l) => l.map((p, j) => (j === i ? { ...p, [campo]: v } : p)));
  return (
    <Modal open={abierto} onClose={onCerrar} title="Participantes de la reunión" maxWidth={560}>
      <p className="text-[13px] text-gypi-mute mt-0">Los que se tildan en Asistencia. El área es lo que cada uno cuenta (por ejemplo, Prod. muebles).</p>
      {lista.map((p, i) => (
        <div key={i} className="flex gap-2 mb-2">
          <input className="g-input w-full" aria-label={`Nombre ${i + 1}`} placeholder="Nombre" value={p.nombre} maxLength={80} onChange={(e) => cambiar(i, "nombre", e.target.value)} />
          <input className="g-input w-full" aria-label={`Área ${i + 1}`} placeholder="Área" value={p.area} maxLength={60} onChange={(e) => cambiar(i, "area", e.target.value)} />
          <button type="button" aria-label={`Sacar ${p.nombre || i + 1}`} onClick={() => setLista((l) => l.filter((_, j) => j !== i))}
            className="min-h-[44px] min-w-[44px] bg-transparent border-none text-gypi-red-ink cursor-pointer">✕</button>
        </div>
      ))}
      <button type="button" className="g-btn g-btn-secondary mb-3" onClick={() => setLista((l) => [...l, { nombre: "", area: "" }])}>＋ Agregar persona</button>
      <div className="flex gap-2">
        <button type="button" className="g-btn g-btn-secondary flex-1" onClick={onCerrar}>Cancelar</button>
        <button type="button" className="g-btn g-btn-primary flex-1" onClick={() => onGuardar(participantesDe({ participantes: lista }))}>Guardar</button>
      </div>
    </Modal>
  );
}

const MINUTA_VACIA = { inicio: null, cierre: null, modera: "", registra: "", asistentes: [], notas: "", estado: "abierta" };

export default function MinutaScreen({ empresa = null }) {
  const toast = useToast();
  const [fecha, setFecha] = useState(hoyArg());
  const [minuta, setMinuta] = useState(MINUTA_VACIA);
  const [items, setItems] = useState([]);
  const [historial, setHistorial] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [cambios, setCambios] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [participantes, setParticipantes] = useState([]);
  const [editarGente, setEditarGente] = useState(false);
  const [otsCrudas, setOtsCrudas] = useState([]);
  const [sugeridos, setSugeridos] = useState(null);
  const [abiertos, setAbiertos] = useState([]);
  const [revision, setRevision] = useState(false);
  const [otrasListas, setOtrasListas] = useState({ personas: [], articulos: [], proveedores: [], vehiculos: [] });
  const { divisiones } = useAuth();
  // La división de la OT se guarda con su nombre (en proyectos puede estar el id)
  const listas = useMemo(() => ({
    ...otrasListas,
    ots: otsCrudas.map((p) => {
      const division = p.division ? nombreDivisionOt(divisiones || [], p.division) : null;
      const dato = { ...p, division };
      return { valor: p.ot, label: `OT ${p.ot}`, detalle: [p.descripcion || p.proyecto, p.cliente || p.obra, division, p.estado === "cerrado" ? "cerrada" : ""].filter(Boolean).join(" · "), dato };
    }),
  }), [otsCrudas, otrasListas, divisiones]);

  // Lo que se elige en los buscadores: si alguna lista no se puede leer, se escribe a mano
  useEffect(() => {
    const leer = (p, o) => sbGetAll(p, o).then((r) => r.data || []).catch(() => []);
    Promise.all([
      leer("proyectos?select=ot,cliente,obra,proyecto,descripcion,division,estado&order=ot.desc", { maxFilas: 5000 }),
      leer("empleados?activo=eq.true&select=id,nombre,division&order=nombre.asc", { maxFilas: 2000 }),
      leer("articulos_stock?select=sku,nombre,unidad&order=nombre.asc", { maxFilas: 20000 }),
      leer("proveedores?select=id,nombre&order=nombre.asc", { maxFilas: 2000 }),
      leer("vehiculos?activo=eq.true&select=id,patente,marca,modelo&order=patente.asc", { maxFilas: 200 }),
      sb.get(`config_sistema?clave=eq.${CLAVE_CONFIG_MINUTA}&select=valor&limit=1`).catch(() => []),
    ]).then(([ots, personas, articulos, proveedores, vehiculos, config]) => {
      // Las cerradas van al final: lo de hoy son casi siempre las abiertas
      const orden = [...ots].sort((a, b) => (a.estado === "cerrado") - (b.estado === "cerrado"));
      setOtsCrudas(orden);
      setOtrasListas({
        personas: personas.map((e) => ({ valor: e.id, label: e.nombre, detalle: e.division || "" })),
        articulos: articulos.map((a) => ({ valor: a.sku, label: a.nombre || a.sku, detalle: [a.sku, a.unidad].filter(Boolean).join(" · ") })),
        proveedores: proveedores.map((p) => ({ valor: String(p.id), label: p.nombre })),
        vehiculos: vehiculos.map((v) => ({ valor: String(v.id), label: [v.patente, v.marca, v.modelo].filter(Boolean).join(" ") })),
      });
      setParticipantes(participantesDe(config?.[0]?.valor));
    });
  }, []);

  const cargarHistorial = useCallback(async () => {
    const r = await apiFetch("/api/minutas").catch(() => null);
    const j = await r?.json().catch(() => null);
    if (r?.ok) setHistorial(j.minutas || []);
  }, []);

  const cargar = useCallback(async (dia) => {
    setCargando(true);
    try {
      const r = await apiFetch(`/api/minutas?fecha=${dia}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "No se pudo leer la minuta");
      setMinuta(j.minuta ? { ...MINUTA_VACIA, ...j.minuta, modera: j.minuta.modera || "", registra: j.minuta.registra || "", notas: j.minuta.notas || "" } : MINUTA_VACIA);
      setItems((j.items || []).map((it) => ({ ...it, texto: it.texto || "", responsable: it.responsable || "", datos: it.datos || {} })));
      setCambios(false);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(fecha); }, [fecha, cargar]);
  // Lo que Gypi sugiere para ese día (parte M2); si no se puede leer, la minuta anda igual
  useEffect(() => {
    let vivo = true;
    setSugeridos(null);
    apiFetch(`/api/minutas?precarga=${fecha}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setSugeridos(j?.sugeridos || {}); })
      .catch(() => { if (vivo) setSugeridos({}); });
    // Lo que sigue abierto de minutas anteriores (parte M3)
    setAbiertos([]);
    apiFetch(`/api/minutas?seguimiento=${fecha}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setAbiertos(j?.items || []); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [fecha]);
  useEffect(() => { cargarHistorial(); }, [cargarHistorial]);

  const cerrada = minuta.estado === "cerrada";
  const cambiarMinuta = (c) => { setMinuta((m) => ({ ...m, ...c })); setCambios(true); };
  const cambiarItem = (id, c) => { setItems((l) => l.map((it) => (it.id === id ? { ...it, ...c } : it))); setCambios(true); };
  const sacarItem = (id) => { setItems((l) => l.filter((it) => it.id !== id)); setCambios(true); };
  const agregar = (seccionId, extra = {}) => {
    setItems((l) => [...l, renglonNuevo(seccionId, seccionId === "compra" ? { tipo: "normal", ...extra } : extra)]);
    setCambios(true);
  };
  const otDe = (ot) => listas.ots.find((o) => o.valor === ot)?.dato || null;
  const agregarSugeridos = (seccionId, lista) => {
    setItems((l) => [...l, ...lista.map((x) => {
      const p = otDe(x.ot);
      return renglonNuevo(seccionId, {
        ...(p ? datosDeOt(p) : { ot: x.ot }),
        texto: x.texto || "", semaforo: x.semaforo || null, fecha_objetivo: x.fecha_objetivo || null, datos: { ...(x.datos || {}) },
      });
    })]);
    setCambios(true);
  };
  const agregarQueSiguen = (lista) => {
    setItems((l) => [...l, ...lista.map((it) => renglonQueSigue(it, it.fecha))]);
    setCambios(true);
  };
  // ✓ Resuelto: se anota en el momento (también con la minuta cerrada); no pasa más al día siguiente
  async function resolver(it) {
    const resuelto = !it.resuelto_at;
    const r = await apiFetch("/api/minutas", { method: "POST", body: JSON.stringify({ accion: "resolver", id: it.id, resuelto }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error(j.error || "No se pudo marcar"); return; }
    setItems((l) => l.map((x) => (x.id === it.id ? { ...x, resuelto_at: j.item?.resuelto_at ?? null } : x)));
    toast.success(resuelto ? "✓ Marcado como resuelto" : "Vuelve a quedar abierto");
  }
  const asistio = (nombre) => cambiarMinuta({ asistentes: minuta.asistentes.includes(nombre) ? minuta.asistentes.filter((n) => n !== nombre) : [...minuta.asistentes, nombre] });

  const elegirFecha = (dia) => {
    if (!dia || dia === fecha) return;
    if (cambios && !window.confirm("Hay cambios sin guardar en esta minuta. ¿Cambiar de día igual?")) return;
    setFecha(dia);
  };

  async function guardar({ cerrar = false } = {}) {
    const faltan = faltantesMinuta(items);
    if (faltan.length) { toast.error(faltan[0]); return; }
    setGuardando(true);
    try {
      const body = {
        accion: "guardar", fecha, cerrar,
        minuta: {
          inicio: minuta.inicio ? hora(minuta.inicio) : null, cierre: minuta.cierre ? hora(minuta.cierre) : null,
          modera: minuta.modera || null, registra: minuta.registra || null, asistentes: minuta.asistentes, notas: minuta.notas || null,
        },
        items: renglonesParaGuardar(items),
      };
      const r = await apiFetch("/api/minutas", { method: "POST", body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "No se pudo guardar");
      setMinuta({ ...MINUTA_VACIA, ...j.minuta, modera: j.minuta.modera || "", registra: j.minuta.registra || "", notas: j.minuta.notas || "" });
      setItems((j.items || []).map((it) => ({ ...it, texto: it.texto || "", responsable: it.responsable || "", datos: it.datos || {} })));
      setCambios(false);
      toast.success(cerrar ? "✅ Minuta cerrada" : "✅ Minuta guardada");
      cargarHistorial();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function reabrir() {
    const r = await apiFetch("/api/minutas", { method: "POST", body: JSON.stringify({ accion: "reabrir", fecha }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error(j.error || "No se pudo reabrir"); return; }
    setMinuta((m) => ({ ...m, estado: "abierta" }));
    toast.success("La minuta quedó abierta para corregirla");
  }

  async function guardarParticipantes(lista) {
    try {
      const rows = await sb.get(`config_sistema?clave=eq.${CLAVE_CONFIG_MINUTA}&select=valor&limit=1`);
      const valor = { ...(rows?.[0]?.valor || {}), participantes: lista };
      if (rows?.length) await sb.patch(`config_sistema?clave=eq.${CLAVE_CONFIG_MINUTA}`, { valor });
      else await sb.post("config_sistema", { clave: CLAVE_CONFIG_MINUTA, valor });
      setParticipantes(lista);
      setEditarGente(false);
      toast.success("✅ Participantes guardados");
    } catch (e) {
      toast.error(`No se pudo guardar: ${e.message}`);
    }
  }

  const imprimir = () => {
    try {
      imprimirMinuta({ empresa: empresa?.nombre || "", minuta: { ...minuta, fecha }, items: renglonesParaGuardar(items), participantes });
    } catch (e) { toast.error(e.message); }
  };

  const presentes = [...participantes.map((p) => p.nombre), ...minuta.asistentes.filter((n) => !participantes.some((p) => p.nombre === n))];
  const duracion = duracionMinutos(minuta.inicio && hora(minuta.inicio), minuta.cierre && hora(minuta.cierre));
  const de = (id) => items.filter((it) => it.seccion === id);

  if (error) {
    return <div className="flex-1 p-4"><div className="g-card p-4 text-[14px]" role="alert">{error}</div></div>;
  }

  const listaSeccion = (s) => (
    <div key={s.id} className="mb-3">
      {s.letra && <h3 className="text-[14px] font-bold m-0 mt-2">{s.letra}. {s.titulo}</h3>}
      {s.ayuda && <p className="text-[12px] text-gypi-mute m-0 mb-2">{s.ayuda}</p>}
      {s.id === "prod_en_curso" && (
        <p className="text-[13px] m-0 mb-2">Proyectos en producción hoy: <b>{sugeridos?.prod_en_curso ? Math.max(sugeridos.prod_en_curso.length, de(s.id).length) : de(s.id).length}</b> en total.</p>
      )}
      {!cerrada && (
        <ParaAgregar titulo={`↩ Sigue abierto de minutas anteriores`} label={`Sigue abierto en ${s.titulo}`} alerta
          opciones={seguimientoPendiente(abiertos, items, s.id).map((it) => ({
            clave: it.id,
            nombre: [it.ot ? `OT ${it.ot}` : "", it.proyecto, it.cliente].filter(Boolean).join(" · ") || it.texto || "Sin detalle",
            detalle: [`del ${fechaCorta(it.fecha)}`, it.texto, it.responsable, it.fecha_objetivo ? `fecha ${fechaCorta(it.fecha_objetivo)}` : ""].filter(Boolean).join(" · "),
            valor: it,
          }))}
          onAgregar={agregarQueSiguen} />
      )}
      {!cerrada && sugeridos && (
        <ParaAgregar titulo="✨ Gypi sugiere" label={`Gypi sugiere para ${s.titulo}`}
          opciones={sugerenciasPendientes(sugeridos, items, s.id).map((x) => {
            const p = datosDeOt(otDe(x.ot));
            return { clave: x.clave, nombre: [`OT ${x.ot}`, p.proyecto, p.cliente].filter(Boolean).join(" · "), detalle: detalleSugerencia(x, s, fecha), valor: x };
          })}
          onAgregar={(l) => agregarSugeridos(s.id, l)} />
      )}
      {de(s.id).map((it) => (
        <Renglon key={it.id} s={s} it={it} listas={listas} disabled={cerrada} cambiar={(c) => cambiarItem(it.id, c)} sacar={() => sacarItem(it.id)}
          resolver={SECCIONES_SEGUIMIENTO.includes(s.id) && it.created_at ? () => resolver(it) : null} />
      ))}
      {!cerrada && <button type="button" className="g-btn g-btn-secondary" onClick={() => agregar(s.id)} aria-label={`Agregar a ${s.titulo}`}>＋ Agregar</button>}
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto p-4 pb-28">
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <Campo label="Día de la minuta">
            <input type="date" className="g-input w-full" aria-label="Día de la minuta" value={fecha} onChange={(e) => elegirFecha(e.target.value)} />
          </Campo>
          {historial.length > 0 && (
            <Campo label="Minutas anteriores">
              <select className="g-input w-full" aria-label="Minutas anteriores" value="" onChange={(e) => elegirFecha(e.target.value)}>
                <option value="">Elegí un día</option>
                {historial.map((m) => (
                  <option key={m.id} value={m.fecha}>{String(m.fecha).split("-").reverse().join("/")}{m.estado === "cerrada" ? " · cerrada" : " · abierta"}</option>
                ))}
              </select>
            </Campo>
          )}
          {cerrada && <span className="text-[13px] font-semibold text-gypi-green-ink py-3">✅ Cerrada{minuta.modera ? ` · firmó ${minuta.modera}` : ""}</span>}
        </div>

        {cargando ? <div className="flex justify-center py-10"><Spinner /></div> : (
          <>
            <section className="g-card p-3 mb-3" aria-label="Cabecera">
              <h2 className="text-[16px] font-bold m-0 mb-2">Minuta — Reunión de Buenos Días <span className="text-[13px] font-normal text-gypi-mute">8:45 a 9:05 hs</span></h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                <Campo label="Inicio" div>
                  {minuta.inicio ? <span className="text-[16px] font-bold text-gypi-text py-2">{hora(minuta.inicio)}</span> : (
                    <button type="button" className="g-btn g-btn-primary" disabled={cerrada} onClick={() => cambiarMinuta({ inicio: hora(new Date()) })}>▶ Empezar</button>
                  )}
                </Campo>
                <Campo label="Cierre" div>
                  <span className="text-[16px] font-bold text-gypi-text py-2">{minuta.cierre ? `${hora(minuta.cierre)}${duracion != null ? ` · ${duracion} min` : ""}` : "—"}</span>
                </Campo>
                <Campo label="Modera">
                  <Sugerencias label="Modera" value={minuta.modera} disabled={cerrada} opciones={participantes.map((p) => ({ valor: p.nombre, label: p.nombre, detalle: p.area }))}
                    onChange={(v) => cambiarMinuta({ modera: v })} onElegir={(o) => cambiarMinuta({ modera: o.label })} />
                </Campo>
                <Campo label="Registra">
                  <Sugerencias label="Registra" value={minuta.registra} disabled={cerrada} opciones={participantes.map((p) => ({ valor: p.nombre, label: p.nombre, detalle: p.area }))}
                    onChange={(v) => cambiarMinuta({ registra: v })} onElegir={(o) => cambiarMinuta({ registra: o.label })} />
                </Campo>
              </div>
            </section>

            <section className="g-card p-3 mb-3" aria-label="Asistencia">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h2 className="text-[15px] font-bold m-0">Asistencia</h2>
                <button type="button" className="g-btn g-btn-secondary" onClick={() => setEditarGente(true)}>⚙ Participantes</button>
              </div>
              {presentes.length === 0 ? (
                <p className="text-[13px] text-gypi-mute m-0">Armá la lista de los que participan con ⚙ Participantes.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {presentes.map((n) => {
                    const area = participantes.find((p) => p.nombre === n)?.area;
                    return <Chip key={n} active={minuta.asistentes.includes(n)} disabled={cerrada} onClick={() => asistio(n)}>{minuta.asistentes.includes(n) ? "✓ " : ""}{n}{area ? ` · ${area}` : ""}</Chip>;
                  })}
                </div>
              )}
            </section>

            {BLOQUES.map((b) => (
              <section key={b.id} className="g-card p-3 mb-3" aria-label={b.titulo}>
                <h2 className="text-[15px] font-bold m-0">{b.numero ? `${b.numero} · ` : ""}{b.titulo} {b.horario && <span className="text-[12px] font-normal text-gypi-mute">{b.horario}</span>}</h2>
                {b.ayuda && <p className="text-[12px] text-gypi-mute m-0 mb-2">{b.ayuda}</p>}
                {b.id === "feedback" && <button type="button" className="g-btn g-btn-secondary mb-2" onClick={() => setRevision(true)}>🗂 Revisión del jueves</button>}
                {b.id === "dyt" ? AREAS_DYT.map((a) => {
                  const s = seccionesDe("dyt")[0];
                  const deArea = de("dyt").filter((it) => it.area === a.id);
                  return (
                    <div key={a.id} className="mb-3">
                      <h3 className="text-[14px] font-bold m-0 mt-2">{a.label} <span className="font-normal text-[12px] text-gypi-mute">{a.detalle}</span></h3>
                      {deArea.length === 0 && <p className="text-[12px] text-gypi-mute m-0 mb-1">Sin cambios</p>}
                      {deArea.map((it) => <Renglon key={it.id} s={s} it={it} listas={listas} disabled={cerrada} cambiar={(c) => cambiarItem(it.id, c)} sacar={() => sacarItem(it.id)} />)}
                      {!cerrada && <button type="button" className="g-btn g-btn-secondary" aria-label={`Agregar a ${a.label}`} onClick={() => agregar("dyt", { area: a.id, tipo: "en_curso" })}>＋ Agregar</button>}
                    </div>
                  );
                }) : seccionesDe(b.id).map(listaSeccion)}
              </section>
            ))}

            <section className="g-card p-3 mb-3" aria-label="Notas libres">
              <h2 className="text-[15px] font-bold m-0 mb-2">Notas libres <span className="text-[12px] font-normal text-gypi-mute">opcional</span></h2>
              <textarea className="g-input w-full min-h-[96px]" aria-label="Notas libres" value={minuta.notas || ""} maxLength={4000} disabled={cerrada}
                onChange={(e) => cambiarMinuta({ notas: e.target.value })} placeholder="Cualquier cosa que no entre arriba." />
            </section>
          </>
        )}
      </div>

      {!cargando && (
        <div className="sticky bottom-0 border-t border-gypi-border bg-gypi-bg px-3 py-2">
          <div className="max-w-5xl mx-auto flex gap-2">
            {cerrada ? (
              <button type="button" className="g-btn g-btn-secondary flex-1 whitespace-nowrap" onClick={reabrir}>✏ Reabrir</button>
            ) : (
              <>
                <button type="button" className="g-btn g-btn-primary flex-1 whitespace-nowrap" disabled={guardando} onClick={() => guardar()}>{guardando ? "Guardando…" : cambios ? "💾 Guardar" : "💾 Guardado"}</button>
                <button type="button" className="g-btn g-btn-secondary flex-1 whitespace-nowrap" disabled={guardando}
                  onClick={() => { if (window.confirm("¿Cerrar la minuta? Queda anotada la hora de cierre y firmada por el moderador.")) guardar({ cerrar: true }); }}>■ Cerrar</button>
              </>
            )}
            <button type="button" className="g-btn g-btn-secondary flex-1 whitespace-nowrap" onClick={imprimir} aria-label="Imprimir o PDF">🖨 PDF</button>
          </div>
        </div>
      )}

      <RevisionFeedback abierto={revision} hasta={fecha} onCerrar={() => setRevision(false)} />
      <EditarParticipantes abierto={editarGente} inicial={participantes} onCerrar={() => setEditarGente(false)} onGuardar={guardarParticipantes} />
    </div>
  );
}
