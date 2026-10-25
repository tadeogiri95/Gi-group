'use client';
// app/components/FichaMaquina.jsx — Ficha de una máquina en Mantenimiento →
// Maquinaria (Mantenimiento, parte 33; migración 132): sus datos, su
// horómetro, su plan (cada tarea con su semáforo, editable) y el historial de
// lo que se le hizo. Desde acá se registra una tarea hecha. Con la 133
// (parte 34) también su responsable de mantenimiento y el suplente. Con la
// 134 (parte 35), sus fallas sin arreglar, avisar una y la etiqueta con el QR
// para pegar en la máquina (escaneándolo cualquiera avisa una falla).
import { useState } from "react";
import { apiFetch } from "../lib/supabase";
import { idNuevo, resumenChecklist } from "../lib/checklistVehiculo";
import {
  CRITICIDADES, ESTADOS_MAQUINA, SEMAFORO_MAQUINA, TIPOS_MAQUINA, avisoDiasPorDefecto, avisoHorasPorDefecto,
  estadoMaquina, textoEstadoTarea, textoFrecuencia, tipoMaquina,
} from "../lib/maquinaria";
import { useConfirm } from "./ui/ConfirmDialog";
import BotonFoto from "./BotonFoto";
import RegistrarTarea from "./RegistrarTarea";
import AsignarMantenimiento from "./AsignarMantenimiento";
import { CAMPOS_MAQUINA, aCargoDe, conResponsables } from "../lib/mantenimiento";
import { ListaFallas, HistorialFallas } from "./FallasMaquina";
import AvisarFalla from "./AvisarFalla";
import { linkMaquina } from "../lib/fallasMaquinaria";
import { imprimirEtiquetasArticulos } from "../lib/stock";
import { TAMANOS_ETIQUETA } from "../lib/carga";

export async function postMaquinaria(body) {
  const res = await apiFetch("/api/maquinaria", { method: "POST", body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo guardar");
  return data;
}

const vacioANull = (v) => (String(v ?? "").trim() ? String(v).trim() : null);
const numeroONull = (v) => (String(v ?? "").trim() === "" ? null : Number(String(v).replace(/\./g, "")));
const fechaCorta = (f) => (f ? String(f).slice(0, 10).split("-").reverse().join("/") : "");
const entero = (n, min, max) => n === null || (Number.isInteger(n) && n >= min && n <= max);

function Campo({ id, label, children }) {
  return (
    <div className="flex-1 min-w-0">
      <label className="g-label" htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

const MAQUINA_VACIA = {
  codigo: "", nombre: "", tipo: "otra", marca: "", modelo: "", serie: "", anio: "", ubicacion: "", division: "", foto_url: null,
  manual_url: "", criticidad: "B", con_horometro: false, horas: "", servicio_tecnico: "", servicio_telefono: "", estado: "en_servicio", notas: "",
};

export function FormMaquina({ maquina = null, divisiones = [], onCancelar, onGuardado }) {
  const [form, setForm] = useState(() => (maquina
    ? { ...MAQUINA_VACIA, ...Object.fromEntries(Object.entries(maquina).map(([k, v]) => [k, v ?? ""])), con_horometro: !!maquina.con_horometro }
    : { ...MAQUINA_VACIA }));
  const [conPlantilla, setConPlantilla] = useState(true);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const cambiar = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));
  const plantilla = tipoMaquina(form.tipo);

  const elegirTipo = (e) => {
    const t = tipoMaquina(e.target.value);
    // Sin nombre todavía, el del tipo
    setForm((f) => ({ ...f, tipo: t.id, nombre: f.nombre || (t.id === "otra" ? "" : t.nombre) }));
  };

  const guardar = async () => {
    if (!form.codigo.trim()) { setError("Poné el código (por ejemplo SEC-01)"); return; }
    if (!form.nombre.trim()) { setError("Poné el nombre"); return; }
    const anio = numeroONull(form.anio);
    if (!entero(anio, 1950, 2100)) { setError("El año va con 4 números, por ejemplo 2019"); return; }
    const horas = form.con_horometro ? numeroONull(form.horas) : null;
    if (!entero(horas, 0, 9999999)) { setError("Las horas van en números enteros"); return; }
    const manual = vacioANull(form.manual_url);
    if (manual && !manual.startsWith("https://")) { setError("El link del manual tiene que empezar con https://"); return; }
    setEnviando(true);
    setError(null);
    try {
      const data = await postMaquinaria({
        accion: "maquina_guardar",
        ...(maquina?.id ? { id: maquina.id } : { con_plantilla: conPlantilla }),
        codigo: form.codigo, nombre: form.nombre, tipo: form.tipo, marca: vacioANull(form.marca), modelo: vacioANull(form.modelo),
        serie: vacioANull(form.serie), anio, ubicacion: vacioANull(form.ubicacion), division: vacioANull(form.division),
        foto_url: form.foto_url || null, manual_url: manual, criticidad: form.criticidad, con_horometro: !!form.con_horometro, horas,
        servicio_tecnico: vacioANull(form.servicio_tecnico), servicio_telefono: vacioANull(form.servicio_telefono),
        estado: form.estado, notas: vacioANull(form.notas),
      });
      await onGuardado(data.maquina);
    } catch (e) {
      setError(e.message);
      setEnviando(false);
    }
  };

  return (
    <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
      <div className="text-[15px] font-bold mb-2">{maquina ? `Editar ${maquina.codigo}` : "Nueva máquina"}</div>
      <div className="flex gap-2">
        <Campo id="maq-tipo" label="Tipo">
          <select id="maq-tipo" className="g-input w-full mb-2" value={form.tipo} onChange={elegirTipo}>
            {TIPOS_MAQUINA.map((t) => <option key={t.id} value={t.id}>{t.emoji} {t.nombre}</option>)}
          </select>
        </Campo>
        <Campo id="maq-codigo" label="Código">
          <input id="maq-codigo" className="g-input w-full mb-2 uppercase" value={form.codigo} onChange={cambiar("codigo")} maxLength={20} placeholder="SEC-01" />
        </Campo>
      </div>
      <label className="g-label" htmlFor="maq-nombre">Nombre</label>
      <input id="maq-nombre" className="g-input w-full mb-2" value={form.nombre} onChange={cambiar("nombre")} maxLength={80} placeholder="Seccionadora horizontal" />
      <div className="flex gap-2">
        <Campo id="maq-marca" label="Marca"><input id="maq-marca" className="g-input w-full mb-2" value={form.marca} onChange={cambiar("marca")} maxLength={60} /></Campo>
        <Campo id="maq-modelo" label="Modelo"><input id="maq-modelo" className="g-input w-full mb-2" value={form.modelo} onChange={cambiar("modelo")} maxLength={80} /></Campo>
      </div>
      <div className="flex gap-2">
        <Campo id="maq-serie" label="N° de serie"><input id="maq-serie" className="g-input w-full mb-2" value={form.serie} onChange={cambiar("serie")} maxLength={60} /></Campo>
        <Campo id="maq-anio" label="Año"><input id="maq-anio" className="g-input w-full mb-2" inputMode="numeric" value={form.anio} onChange={cambiar("anio")} maxLength={4} /></Campo>
      </div>
      <div className="flex gap-2">
        <Campo id="maq-ubicacion" label="Planta o sector"><input id="maq-ubicacion" className="g-input w-full mb-2" value={form.ubicacion} onChange={cambiar("ubicacion")} maxLength={80} /></Campo>
        <Campo id="maq-division" label="División">
          <input id="maq-division" className="g-input w-full mb-2" list="maq-divisiones" value={form.division} onChange={cambiar("division")} maxLength={60} />
          <datalist id="maq-divisiones">{divisiones.map((d) => <option key={d} value={d} />)}</datalist>
        </Campo>
      </div>
      <div className="flex gap-2">
        <Campo id="maq-criticidad" label="Criticidad">
          <select id="maq-criticidad" className="g-input w-full mb-2" value={form.criticidad} onChange={cambiar("criticidad")}>
            {CRITICIDADES.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </Campo>
        <Campo id="maq-estado" label="Estado">
          <select id="maq-estado" className="g-input w-full mb-2" value={form.estado} onChange={cambiar("estado")}>
            {ESTADOS_MAQUINA.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
          </select>
        </Campo>
      </div>
      <div className="text-[12px] text-gypi-dim mb-2">{CRITICIDADES.find((c) => c.id === form.criticidad)?.detalle}</div>
      <label className="flex items-center gap-2 text-[14px] min-h-[44px]">
        <input type="checkbox" checked={!!form.con_horometro} onChange={(e) => setForm((f) => ({ ...f, con_horometro: e.target.checked }))} />
        Tiene contador de horas (horómetro)
      </label>
      {form.con_horometro && (
        <>
          <label className="g-label" htmlFor="maq-horas">Horas que marca hoy</label>
          <input id="maq-horas" className="g-input w-full mb-2" inputMode="numeric" value={form.horas} onChange={cambiar("horas")} />
        </>
      )}
      <div className="flex gap-2">
        <Campo id="maq-servicio" label="Servicio técnico"><input id="maq-servicio" className="g-input w-full mb-2" value={form.servicio_tecnico} onChange={cambiar("servicio_tecnico")} maxLength={80} /></Campo>
        <Campo id="maq-telefono" label="Teléfono"><input id="maq-telefono" className="g-input w-full mb-2" inputMode="tel" value={form.servicio_telefono} onChange={cambiar("servicio_telefono")} maxLength={40} /></Campo>
      </div>
      <label className="g-label" htmlFor="maq-manual">Link al manual (PDF)</label>
      <input id="maq-manual" className="g-input w-full mb-2" value={form.manual_url} onChange={cambiar("manual_url")} maxLength={500} placeholder="https://" />
      <label className="g-label" htmlFor="maq-notas">Notas</label>
      <input id="maq-notas" className="g-input w-full mb-2" value={form.notas} onChange={cambiar("notas")} maxLength={500} />
      {!maquina && plantilla.tareas.length > 0 && (
        <label className="flex items-start gap-2 text-[14px] min-h-[44px] mb-1">
          <input type="checkbox" className="mt-1" checked={conPlantilla} onChange={(e) => setConPlantilla(e.target.checked)} />
          <span>Cargar el plan de {plantilla.nombre.toLowerCase()} ({plantilla.tareas.map((t) => t.nombre.toLowerCase()).join(", ")}). Después lo cambiás.</span>
        </label>
      )}
      <div className="flex gap-2 items-center mb-3">
        <BotonFoto label={form.foto_url ? "📷 Cambiar foto" : "📷 Foto de la máquina"} disabled={enviando} onFoto={(url) => setForm((f) => ({ ...f, foto_url: url }))} />
        {form.foto_url && <img src={form.foto_url} alt="Foto de la máquina" className="h-12 w-16 object-cover rounded-[6px]" />}
      </div>
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      <div className="flex gap-2">
        <button onClick={onCancelar} className="g-btn g-btn-secondary flex-1">Cancelar</button>
        <button onClick={guardar} disabled={enviando} className="g-btn g-btn-primary flex-1">{enviando ? "Guardando…" : "Guardar"}</button>
      </div>
    </div>
  );
}

const TAREA_VACIA = {
  nombre: "", cada_dias: "", cada_horas: "", aviso_dias: "", aviso_horas: "", quien: "interno", duracion_min: "",
  parar_maquina: true, seguridad: "Cortar la energía y bloquear el tablero antes de empezar", insumos: "", ultima_fecha: "", ultima_horas: "",
};

export function FormTarea({ maquina, tarea = null, onCancelar, onGuardado }) {
  const [form, setForm] = useState(() => (tarea
    ? { ...TAREA_VACIA, ...Object.fromEntries(Object.entries(tarea).filter(([k]) => k in TAREA_VACIA).map(([k, v]) => [k, v ?? ""])), parar_maquina: tarea.parar_maquina !== false }
    : { ...TAREA_VACIA }));
  const [puntos, setPuntos] = useState(() => (tarea?.checklist || []).map((p) => ({ ...p, valor: p.valor || "" })));
  const [nuevoPunto, setNuevoPunto] = useState("");
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const cambiar = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  const agregarPunto = () => {
    const nombre = nuevoPunto.trim();
    if (!nombre) return;
    setPuntos((ps) => [...ps, { id: idNuevo(nombre, ps.map((p) => p.id)), nombre, valor: "" }]);
    setNuevoPunto("");
  };

  const guardar = async () => {
    const cadaDias = numeroONull(form.cada_dias);
    const cadaHoras = numeroONull(form.cada_horas);
    if (!form.nombre.trim()) { setError("Poné el nombre de la tarea"); return; }
    if (cadaDias === null && cadaHoras === null) { setError("Poné cada cuántos días o cada cuántas horas"); return; }
    if (!entero(cadaDias, 1, 3650)) { setError("Los días van de 1 a 3650"); return; }
    if (!entero(cadaHoras, 1, 100000)) { setError("Las horas van en números enteros"); return; }
    if (cadaHoras !== null && !maquina.con_horometro) { setError("Para contar por horas, marcá en la ficha que la máquina tiene horómetro"); return; }
    const avisoDias = numeroONull(form.aviso_dias) ?? avisoDiasPorDefecto(cadaDias);
    const avisoHoras = numeroONull(form.aviso_horas) ?? avisoHorasPorDefecto(cadaHoras);
    if (!entero(avisoDias, 0, 365) || !entero(avisoHoras, 0, 100000)) { setError("El aviso va en números enteros"); return; }
    const duracion = numeroONull(form.duracion_min);
    if (!entero(duracion, 1, 10000)) { setError("La duración va en minutos"); return; }
    const ultimaHoras = numeroONull(form.ultima_horas);
    if (!entero(ultimaHoras, 0, 9999999)) { setError("Las horas de la última vez van en números enteros"); return; }
    const checklist = puntos.map((p) => ({ id: p.id, nombre: p.nombre.trim(), valor: vacioANull(p.valor) })).filter((p) => p.nombre);
    if (!checklist.length) { setError("Agregá al menos un punto para revisar"); return; }
    setEnviando(true);
    setError(null);
    try {
      await postMaquinaria({
        accion: "tarea_guardar", ...(tarea?.id ? { id: tarea.id } : {}), maquina_id: maquina.id,
        nombre: form.nombre.trim(), cada_dias: cadaDias, cada_horas: cadaHoras, aviso_dias: avisoDias, aviso_horas: avisoHoras,
        checklist, quien: form.quien, duracion_min: duracion, parar_maquina: !!form.parar_maquina,
        seguridad: vacioANull(form.seguridad), insumos: vacioANull(form.insumos),
        ultima_fecha: form.ultima_fecha || null, ultima_horas: ultimaHoras,
      });
      await onGuardado();
    } catch (e) {
      setError(e.message);
      setEnviando(false);
    }
  };

  return (
    <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
      <div className="text-[15px] font-bold mb-2">{tarea ? `Editar ${tarea.nombre}` : `Nueva tarea · ${maquina.codigo}`}</div>
      <label className="g-label" htmlFor="tar-nombre">Tarea</label>
      <input id="tar-nombre" className="g-input w-full mb-2" value={form.nombre} onChange={cambiar("nombre")} maxLength={80} placeholder="Cambio de correas" />
      <div className="text-[12px] text-gypi-dim mb-1">Cada cuánto (lo que pase primero)</div>
      <div className="flex gap-2">
        <Campo id="tar-dias" label="Días"><input id="tar-dias" className="g-input w-full mb-2" inputMode="numeric" value={form.cada_dias} onChange={cambiar("cada_dias")} placeholder="30" /></Campo>
        {maquina.con_horometro && <Campo id="tar-horas" label="Horas de uso"><input id="tar-horas" className="g-input w-full mb-2" inputMode="numeric" value={form.cada_horas} onChange={cambiar("cada_horas")} placeholder="500" /></Campo>}
      </div>
      <div className="flex gap-2">
        <Campo id="tar-aviso-dias" label="Avisar días antes">
          <input id="tar-aviso-dias" className="g-input w-full mb-2" inputMode="numeric" value={form.aviso_dias} onChange={cambiar("aviso_dias")} placeholder={String(avisoDiasPorDefecto(numeroONull(form.cada_dias)))} />
        </Campo>
        {maquina.con_horometro && (
          <Campo id="tar-aviso-horas" label="Avisar horas antes">
            <input id="tar-aviso-horas" className="g-input w-full mb-2" inputMode="numeric" value={form.aviso_horas} onChange={cambiar("aviso_horas")} placeholder={String(avisoHorasPorDefecto(numeroONull(form.cada_horas)))} />
          </Campo>
        )}
      </div>

      <div className="g-label mb-1">Qué se revisa</div>
      <ul aria-label="Puntos de la tarea" className="list-none m-0 p-0 flex flex-col gap-1.5 mb-2">
        {puntos.map((p, i) => (
          <li key={p.id} className="flex gap-1.5 items-center">
            <input className="g-input flex-1 min-w-0" aria-label={`Punto ${i + 1}`} value={p.nombre} maxLength={120}
              onChange={(e) => setPuntos((ps) => ps.map((x) => (x.id === p.id ? { ...x, nombre: e.target.value } : x)))} />
            <input className="g-input w-[70px]" aria-label={`Unidad de ${p.nombre}`} value={p.valor} maxLength={10} placeholder="unidad"
              onChange={(e) => setPuntos((ps) => ps.map((x) => (x.id === p.id ? { ...x, valor: e.target.value } : x)))} />
            <button onClick={() => setPuntos((ps) => ps.filter((x) => x.id !== p.id))} aria-label={`Sacar ${p.nombre}`}
              className="min-h-[44px] min-w-[44px] bg-transparent border-none text-gypi-red cursor-pointer text-[16px]">✕</button>
          </li>
        ))}
      </ul>
      <div className="flex gap-1.5 mb-1">
        <input className="g-input flex-1 min-w-0" aria-label="Punto nuevo" value={nuevoPunto} maxLength={120} placeholder="Agregar un punto"
          onChange={(e) => setNuevoPunto(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") agregarPunto(); }} />
        <button onClick={agregarPunto} className="g-btn g-btn-secondary">＋ Agregar</button>
      </div>
      <div className="text-[12px] text-gypi-dim mb-2">Con unidad (bar, °C, mm) se anota el valor al hacer la tarea.</div>

      <label className="g-label" htmlFor="tar-seguridad">Aviso de seguridad (hay que confirmarlo antes de empezar)</label>
      <input id="tar-seguridad" className="g-input w-full mb-2" value={form.seguridad} onChange={cambiar("seguridad")} maxLength={300} />
      <label className="g-label" htmlFor="tar-insumos">Repuestos o insumos</label>
      <input id="tar-insumos" className="g-input w-full mb-2" value={form.insumos} onChange={cambiar("insumos")} maxLength={300} placeholder="Aceite, grasa, filtros" />
      <div className="flex gap-2">
        <Campo id="tar-quien" label="Quién la hace">
          <select id="tar-quien" className="g-input w-full mb-2" value={form.quien} onChange={cambiar("quien")}>
            <option value="interno">Mantenimiento propio</option>
            <option value="externo">Servicio externo</option>
          </select>
        </Campo>
        <Campo id="tar-duracion" label="Minutos (aprox.)"><input id="tar-duracion" className="g-input w-full mb-2" inputMode="numeric" value={form.duracion_min} onChange={cambiar("duracion_min")} /></Campo>
      </div>
      <label className="flex items-center gap-2 text-[14px] min-h-[44px]">
        <input type="checkbox" checked={!!form.parar_maquina} onChange={(e) => setForm((f) => ({ ...f, parar_maquina: e.target.checked }))} />
        Hay que parar la máquina
      </label>
      {!tarea?.ultima_fecha && (
        <div className="flex gap-2">
          <Campo id="tar-ultima" label="Última vez que se hizo (si sabés)"><input id="tar-ultima" type="date" className="g-input w-full mb-2" value={form.ultima_fecha} onChange={cambiar("ultima_fecha")} /></Campo>
          {maquina.con_horometro && <Campo id="tar-ultima-horas" label="Con cuántas horas"><input id="tar-ultima-horas" className="g-input w-full mb-2" inputMode="numeric" value={form.ultima_horas} onChange={cambiar("ultima_horas")} /></Campo>}
        </div>
      )}
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      <div className="flex gap-2">
        <button onClick={onCancelar} className="g-btn g-btn-secondary flex-1">Cancelar</button>
        <button onClick={guardar} disabled={enviando} className="g-btn g-btn-primary flex-1">{enviando ? "Guardando…" : "Guardar"}</button>
      </div>
    </div>
  );
}

function FormHoras({ maquina, onCancelar, onGuardado }) {
  const [horas, setHoras] = useState("");
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const guardar = async () => {
    const n = numeroONull(horas);
    if (n === null || !entero(n, 0, 9999999)) { setError("Poné las horas en números enteros"); return; }
    setEnviando(true);
    setError(null);
    try {
      await postMaquinaria({ accion: "horas_guardar", id: maquina.id, horas: n });
      await onGuardado();
    } catch (e) {
      setError(e.message);
      setEnviando(false);
    }
  };
  return (
    <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
      <label className="g-label" htmlFor="maq-horas-nuevas">Horas que marca hoy</label>
      <input id="maq-horas-nuevas" className="g-input w-full mb-2" inputMode="numeric" value={horas} onChange={(e) => setHoras(e.target.value)}
        placeholder={maquina.horas != null ? `Antes: ${maquina.horas.toLocaleString("es-AR")}` : ""} />
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      <div className="flex gap-2">
        <button onClick={onCancelar} className="g-btn g-btn-secondary flex-1">Cancelar</button>
        <button onClick={guardar} disabled={enviando} className="g-btn g-btn-primary flex-1">{enviando ? "Guardando…" : "Guardar horas"}</button>
      </div>
    </div>
  );
}

/** La etiqueta con el QR de la máquina (100 × 50 mm): escaneándolo se avisa una falla. */
export async function imprimirEtiquetaMaquina(maquina, empresa) {
  const origen = window.location.origin;
  const slug = empresa?.slug || "";
  await imprimirEtiquetasArticulos({
    empresa: empresa?.nombre_corto || empresa?.nombre || "",
    articulos: [{ sku: maquina.codigo, nombre: maquina.nombre, unidad: "Escaneá para avisar una falla", division: maquina.ubicacion }],
    origen, slug, tamano: TAMANOS_ETIQUETA[0], titulo: `Etiqueta ${maquina.codigo}`,
    linkDe: () => linkMaquina(origen, slug, maquina.codigo),
  });
}

export default function FichaMaquina({ maquina, tareas = [], registros = [], fallas = [], divisiones = [], empleados = [], empresa = null, usuario = null, editable, hoy, onVolver, onCambio }) {
  const [editando, setEditando] = useState(false);
  const [tareaForm, setTareaForm] = useState(null); // null | "nueva" | tarea
  const [haciendo, setHaciendo] = useState(null);
  const [cargandoHoras, setCargandoHoras] = useState(false);
  const [error, setError] = useState(null);
  const [confirmar, ConfirmDialog] = useConfirm();
  const [avisando, setAvisando] = useState(false);
  const estado = estadoMaquina(maquina, tareas, hoy);
  const tipo = tipoMaquina(maquina.tipo);
  const criticidad = CRITICIDADES.find((c) => c.id === maquina.criticidad);
  const nombreEstado = ESTADOS_MAQUINA.find((x) => x.id === maquina.estado)?.nombre;

  const accion = async (body) => {
    setError(null);
    try { await postMaquinaria(body); await onCambio(); } catch (e) { setError(e.message); }
  };

  if (editando) {
    return <FormMaquina maquina={maquina} divisiones={divisiones} onCancelar={() => setEditando(false)} onGuardado={async () => { setEditando(false); await onCambio(); }} />;
  }
  if (tareaForm) {
    return <FormTarea maquina={maquina} tarea={tareaForm === "nueva" ? null : tareaForm} onCancelar={() => setTareaForm(null)} onGuardado={async () => { setTareaForm(null); await onCambio(); }} />;
  }

  return (
    <div>
      <button onClick={onVolver} className="min-h-[44px] -ml-1 px-1 bg-transparent border-none cursor-pointer text-[15px] font-semibold text-gypi-text">← Maquinaria</button>
      <div className="flex items-start gap-3 mb-3">
        {maquina.foto_url
          ? <img src={maquina.foto_url} alt={`Foto de ${maquina.nombre}`} className="h-16 w-20 object-cover rounded-[8px]" />
          : <span className="text-[34px]" aria-hidden="true">{tipo.emoji}</span>}
        <div className="flex-1 min-w-0">
          <h2 className="m-0 text-[20px] font-bold font-heading">{SEMAFORO_MAQUINA[estado.nivel].emoji} {maquina.codigo} · {maquina.nombre}</h2>
          <div className="text-[13px] text-gypi-dim">
            {[tipo.nombre, [maquina.marca, maquina.modelo].filter(Boolean).join(" "), maquina.anio, maquina.ubicacion, maquina.division].filter(Boolean).join(" · ")}
          </div>
          <div className="text-[13px] font-semibold">
            {criticidad?.nombre}{maquina.estado !== "en_servicio" ? ` · ${maquina.estado === "parada" ? "🔴 " : ""}${nombreEstado}` : ""}
            {!maquina.activo ? " · Dada de baja" : ""}
          </div>
        </div>
      </div>

      {(maquina.serie || maquina.servicio_tecnico || maquina.manual_url || maquina.notas) && (
        <div className="text-[13px] mb-3 flex flex-col gap-0.5">
          {maquina.serie && <div>N° de serie: {maquina.serie}</div>}
          {maquina.servicio_tecnico && <div>Servicio técnico: {maquina.servicio_tecnico}{maquina.servicio_telefono ? ` · ${maquina.servicio_telefono}` : ""}</div>}
          {maquina.manual_url && <a href={maquina.manual_url} target="_blank" rel="noopener noreferrer" className="text-gypi-text font-semibold">📘 Manual</a>}
          {maquina.notas && <div className="text-gypi-dim">{maquina.notas}</div>}
        </div>
      )}

      {conResponsables(maquina, CAMPOS_MAQUINA) && (
        <>
          <div className="text-[13px] font-bold uppercase tracking-wide text-gypi-dim mb-1.5">Mantenimiento a cargo de</div>
          <AsignarMantenimiento key={`${maquina.responsable_id}-${maquina.suplente_id}`} responsableId={maquina.responsable_id} suplenteId={maquina.suplente_id}
            empleados={empleados} editable={editable}
            onGuardar={async (r) => { await postMaquinaria({ accion: "responsables_guardar", maquina_id: maquina.id, ...r }); await onCambio(); }} />
        </>
      )}

      {maquina.con_horometro && (
        cargandoHoras
          ? <FormHoras maquina={maquina} onCancelar={() => setCargandoHoras(false)} onGuardado={async () => { setCargandoHoras(false); await onCambio(); }} />
          : (
            <div className="flex items-center gap-2 p-2.5 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
              <span className="flex-1 text-[14px]">
                ⏱️ <b>{maquina.horas != null ? `${maquina.horas.toLocaleString("es-AR")} h` : "Sin lectura"}</b>
                {maquina.horas_at ? <span className="text-gypi-dim"> · {fechaCorta(maquina.horas_at)}</span> : null}
              </span>
              {editable && <button onClick={() => setCargandoHoras(true)} className="g-btn g-btn-secondary">Cargar horas</button>}
            </div>
          )
      )}

      <div className="flex gap-2 mb-3">
        <button onClick={() => setAvisando(true)} className="g-btn g-btn-secondary flex-1">⚠️ Avisar falla</button>
        {editable && (
          <button onClick={() => imprimirEtiquetaMaquina(maquina, empresa).catch((e) => setError(e.message))} className="g-btn g-btn-secondary flex-1">🏷 Etiqueta QR</button>
        )}
      </div>
      {editable && (
        <div className="flex gap-2 mb-3">
          <button onClick={() => setEditando(true)} className="g-btn g-btn-secondary flex-1">✏ Editar</button>
          <button onClick={() => accion({ accion: "maquina_baja", id: maquina.id, activo: !maquina.activo })} className="g-btn g-btn-secondary flex-1">
            {maquina.activo ? "Dar de baja" : "Reactivar"}
          </button>
        </div>
      )}
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}

      {fallas.some((f) => f.estado === "pendiente") && (
        <>
          <h3 className="m-0 mb-1.5 text-[16px] font-bold">Fallas sin arreglar</h3>
          <ListaFallas fallas={fallas} maquinas={[maquina]} empleados={empleados} editable={editable} conMaquina={false}
            puedeArreglar={(f) => editable || aCargoDe(maquina, usuario?.id, CAMPOS_MAQUINA) || f.responsable_id === usuario?.id} onCambio={onCambio} />
        </>
      )}

      <div className="flex items-center gap-2 mb-1.5">
        <h3 className="flex-1 m-0 text-[16px] font-bold">Plan de mantenimiento</h3>
        {editable && <button onClick={() => setTareaForm("nueva")} className="min-h-[44px] px-2 bg-transparent border-none text-[14px] font-semibold text-gypi-text cursor-pointer">＋ Tarea</button>}
      </div>
      {!estado.tareas.length ? (
        <div className="text-[14px] text-gypi-dim mb-3">
          {maquina.estado === "fuera_de_servicio" ? "Está fuera de servicio: no avisa." : "Todavía no tiene tareas. Agregá la primera con cada cuánto se hace y qué se revisa."}
        </div>
      ) : (
        <ul aria-label="Tareas" className="list-none m-0 p-0 flex flex-col gap-1.5 mb-3">
          {estado.tareas.map((x) => (
            <li key={x.tarea.id} className="p-2.5 rounded-[10px] border border-gypi-border bg-gypi-surface">
              <div className="flex items-start gap-2">
                <span className="text-[18px]" aria-label={SEMAFORO_MAQUINA[x.nivel].texto}>{SEMAFORO_MAQUINA[x.nivel].emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-bold">{x.tarea.nombre}</div>
                  <div className="text-[12px] text-gypi-dim">
                    {[textoFrecuencia(x.tarea), `${(x.tarea.checklist || []).length} puntos`, x.tarea.quien === "externo" ? "Servicio externo" : null,
                      x.tarea.ultima_fecha ? `Última: ${fechaCorta(x.tarea.ultima_fecha)}` : "Sin registro"].filter(Boolean).join(" · ")}
                  </div>
                  <div className="text-[13px] font-semibold">{textoEstadoTarea(x)}</div>
                </div>
              </div>
              {editable && (
                <div className="flex gap-1.5 mt-2">
                  <button onClick={() => setHaciendo(x.tarea)} className="g-btn g-btn-primary flex-1">✔ Registrar hecha</button>
                  <button onClick={() => setTareaForm(x.tarea)} aria-label={`Editar ${x.tarea.nombre}`} className="g-btn g-btn-secondary">✏</button>
                  <button onClick={async () => {
                    const ok = await confirmar(`¿Sacar "${x.tarea.nombre}" del plan? Lo que ya se hizo queda en el historial.`, { title: "Sacar tarea", confirmLabel: "Sacar", destructive: true });
                    if (ok) accion({ accion: "tarea_borrar", id: x.tarea.id });
                  }}
                    aria-label={`Sacar ${x.tarea.nombre}`} className="g-btn g-btn-secondary">🗑</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3 className="m-0 mb-1.5 text-[16px] font-bold">Historial</h3>
      <HistorialFallas fallas={fallas} />
      {!registros.length ? (
        <div className="text-[14px] text-gypi-dim">Todavía no se registró ninguna tarea.</div>
      ) : (
        <ul aria-label="Historial de la máquina" className="list-none m-0 p-0 flex flex-col gap-1.5">
          {registros.map((r) => (
            <li key={r.id} className="p-2.5 rounded-[10px] border border-gypi-border bg-gypi-surface text-[13px]">
              <div className="font-semibold">{fechaCorta(r.fecha)} · {r.tarea_nombre}</div>
              <div className="text-gypi-dim">{[r.empleado_nombre, r.horas != null ? `${r.horas.toLocaleString("es-AR")} h` : null, resumenChecklist(r)].filter(Boolean).join(" · ")}</div>
              {(r.items || []).filter((i) => i.estado === "mal" || i.estado === "revisar").map((i) => (
                <div key={i.punto}>{i.estado === "mal" ? "❌" : "⚠️"} {i.nombre}{i.nota ? `: ${i.nota}` : ""}</div>
              ))}
              {r.observaciones && <div className="text-gypi-dim">{r.observaciones}</div>}
            </li>
          ))}
        </ul>
      )}

      {ConfirmDialog}
      {avisando && <AvisarFalla codigoInicial={maquina.codigo} onClose={async () => { setAvisando(false); await onCambio(); }} />}
      {haciendo && <RegistrarTarea maquina={maquina} tarea={haciendo} onClose={() => setHaciendo(null)} onHecho={onCambio} />}
    </div>
  );
}
