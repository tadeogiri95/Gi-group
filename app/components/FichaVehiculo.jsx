'use client';
// app/components/FichaVehiculo.jsx — Ficha de un vehículo en Mantenimiento → Flota
// (Mantenimiento, parte 28; migración 126): sus datos, su responsable con la
// licencia, y sus papeles con el semáforo de cada uno. Renovar un papel agrega
// uno nuevo; el anterior queda en el historial. Parte 31 (129): arreglos
// pendientes, services y reparaciones, y el historial del vehículo.
import { useState } from "react";
import { apiFetch } from "../lib/supabase";
import {
  AVISO_LICENCIA, COMBUSTIBLES, RESULTADOS_ITV, SEMAFORO, TIPOS_PAPEL, TIPOS_VEHICULO,
  estadoVencimiento, nombrePapel, nombreTipoVehiculo, papelesVigentes, peorNivel, textoVencimiento, tipoPapel,
} from "../lib/flota";
import { Chip } from "./ui";
import BotonFoto from "./BotonFoto";
import ChecklistVehiculo from "./ChecklistVehiculo";
import { VerChecklist } from "./ChecklistsVehiculo";
import { FRECUENCIAS, alertasVehiculo } from "../lib/alertasFlota";
import { historialVehiculo, noCircula, pendientes } from "../lib/arreglosFlota";
import { FormArreglo, FormMantenimiento, Historial, ListaArreglos } from "./ArreglosVehiculo";
import AsignarMantenimiento from "./AsignarMantenimiento";
import { CAMPOS_VEHICULO, conResponsables } from "../lib/mantenimiento";

async function postFlota(body) {
  const res = await apiFetch("/api/flota", { method: "POST", body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo guardar");
  return data;
}

const vacioANull = (v) => (String(v ?? "").trim() ? String(v).trim() : null);
const numeroONull = (v) => (String(v ?? "").trim() === "" ? null : Number(String(v).replace(/\./g, "")));
const fechaCorta = (f) => (f ? f.split("-").reverse().join("/") : "");

function Campo({ id, label, children }) {
  return (
    <div className="flex-1 min-w-0">
      <label className="g-label" htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

const VEHICULO_VACIO = { patente: "", tipo: "utilitario", marca: "", modelo: "", anio: "", color: "", motor: "", chasis: "", km: "", combustible: "", foto_url: null, division: "", responsable_id: "", notas: "", service_fecha: "", service_km: "" };

/** Lo que la empresa cambió de las frecuencias de fábrica, como texto para el formulario. */
function frecuenciasForm(propias) {
  const p = propias && typeof propias === "object" ? propias : {};
  return Object.fromEntries(FRECUENCIAS.map((f) => [f.id, { dias: p[f.id]?.dias ?? "", km: p[f.id]?.km ?? "" }]));
}

/** Solo lo que difiere de fábrica (vacío = la de fábrica). Devuelve { frecuencias } o { error }. */
function frecuenciasParaGuardar(form) {
  const out = {};
  for (const f of FRECUENCIAS) {
    const dias = numeroONull(form[f.id]?.dias);
    const km = numeroONull(form[f.id]?.km);
    if (dias !== null && !(Number.isInteger(dias) && dias >= 1 && dias <= 3650)) return { error: `${f.nombre}: los días van de 1 a 3650` };
    if (km !== null && !(Number.isInteger(km) && km >= 1 && km <= 1000000)) return { error: `${f.nombre}: los kilómetros van en números enteros` };
    const propia = {};
    if (dias !== null && dias !== f.dias) propia.dias = dias;
    if (km !== null && km !== f.km) propia.km = km;
    if (Object.keys(propia).length) out[f.id] = propia;
  }
  return { frecuencias: out };
}

export function FormVehiculo({ vehiculo = null, empleados, divisiones, onCancelar, onGuardado }) {
  const [form, setForm] = useState(() => (vehiculo ? { ...VEHICULO_VACIO, ...Object.fromEntries(Object.entries(vehiculo).map(([k, v]) => [k, v ?? ""])) } : { ...VEHICULO_VACIO }));
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const cambiar = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));
  const [frec, setFrec] = useState(() => frecuenciasForm(vehiculo?.frecuencias));
  const [verFrec, setVerFrec] = useState(false);

  const guardar = async () => {
    if (!form.patente.trim()) { setError("Poné la patente"); return; }
    const serviceKm = numeroONull(form.service_km);
    if (serviceKm !== null && !(Number.isInteger(serviceKm) && serviceKm >= 0)) { setError("Los kilómetros del último service van en números enteros"); return; }
    const fr = frecuenciasParaGuardar(frec);
    if (fr.error) { setError(fr.error); setVerFrec(true); return; }
    const anio = numeroONull(form.anio);
    if (anio !== null && !(Number.isInteger(anio) && anio >= 1950 && anio <= 2100)) { setError("El año va con 4 números, por ejemplo 2019"); return; }
    const km = numeroONull(form.km);
    if (km !== null && !(Number.isInteger(km) && km >= 0)) { setError("Los kilómetros van en números enteros"); return; }
    setEnviando(true);
    setError(null);
    try {
      const data = await postFlota({
        accion: "vehiculo_guardar",
        ...(vehiculo?.id ? { id: vehiculo.id } : {}),
        patente: form.patente,
        tipo: form.tipo,
        marca: vacioANull(form.marca),
        modelo: vacioANull(form.modelo),
        anio,
        color: vacioANull(form.color),
        motor: vacioANull(form.motor),
        chasis: vacioANull(form.chasis),
        km,
        combustible: form.combustible || null,
        foto_url: form.foto_url || null,
        division: vacioANull(form.division),
        responsable_id: form.responsable_id || null,
        notas: vacioANull(form.notas),
        service_fecha: form.service_fecha || null,
        service_km: serviceKm,
        frecuencias: fr.frecuencias,
      });
      await onGuardado(data.vehiculo);
    } catch (e) {
      setError(e.message);
      setEnviando(false);
    }
  };

  return (
    <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
      <div className="text-[15px] font-bold mb-2">{vehiculo ? `Editar ${vehiculo.patente}` : "Nuevo vehículo"}</div>
      <div className="flex gap-2">
        <Campo id="veh-patente" label="Patente">
          <input id="veh-patente" className="g-input w-full mb-2 uppercase" value={form.patente} onChange={cambiar("patente")} maxLength={20} placeholder="AB 123 CD" />
        </Campo>
        <Campo id="veh-tipo" label="Tipo">
          <select id="veh-tipo" className="g-input w-full mb-2" value={form.tipo} onChange={cambiar("tipo")}>
            {TIPOS_VEHICULO.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </Campo>
      </div>
      <div className="flex gap-2">
        <Campo id="veh-marca" label="Marca"><input id="veh-marca" className="g-input w-full mb-2" value={form.marca} onChange={cambiar("marca")} maxLength={60} /></Campo>
        <Campo id="veh-modelo" label="Modelo"><input id="veh-modelo" className="g-input w-full mb-2" value={form.modelo} onChange={cambiar("modelo")} maxLength={80} /></Campo>
      </div>
      <div className="flex gap-2">
        <Campo id="veh-anio" label="Año"><input id="veh-anio" className="g-input w-full mb-2" inputMode="numeric" value={form.anio} onChange={cambiar("anio")} maxLength={4} /></Campo>
        <Campo id="veh-color" label="Color"><input id="veh-color" className="g-input w-full mb-2" value={form.color} onChange={cambiar("color")} maxLength={40} /></Campo>
      </div>
      <div className="flex gap-2">
        <Campo id="veh-km" label="Kilómetros"><input id="veh-km" className="g-input w-full mb-2" inputMode="numeric" value={form.km} onChange={cambiar("km")} /></Campo>
        <Campo id="veh-combustible" label="Combustible">
          <select id="veh-combustible" className="g-input w-full mb-2" value={form.combustible} onChange={cambiar("combustible")}>
            <option value="">—</option>
            {COMBUSTIBLES.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </Campo>
      </div>
      <div className="flex gap-2">
        <Campo id="veh-motor" label="N° de motor"><input id="veh-motor" className="g-input w-full mb-2" value={form.motor} onChange={cambiar("motor")} maxLength={40} /></Campo>
        <Campo id="veh-chasis" label="N° de chasis"><input id="veh-chasis" className="g-input w-full mb-2" value={form.chasis} onChange={cambiar("chasis")} maxLength={40} /></Campo>
      </div>
      <div className="flex gap-2">
        <Campo id="veh-responsable" label="Chofer habitual">
          <select id="veh-responsable" className="g-input w-full mb-2" value={form.responsable_id} onChange={cambiar("responsable_id")}>
            <option value="">Sin chofer habitual</option>
            {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </Campo>
        <Campo id="veh-division" label="División">
          <input id="veh-division" className="g-input w-full mb-2" list="veh-divisiones" value={form.division} onChange={cambiar("division")} maxLength={60} />
          <datalist id="veh-divisiones">{divisiones.map((d) => <option key={d} value={d} />)}</datalist>
        </Campo>
      </div>
      <div className="flex gap-2">
        <Campo id="veh-service-fecha" label="Último service (fecha)"><input id="veh-service-fecha" type="date" className="g-input w-full mb-2" value={form.service_fecha} onChange={cambiar("service_fecha")} /></Campo>
        <Campo id="veh-service-km" label="Último service (km)"><input id="veh-service-km" className="g-input w-full mb-2" inputMode="numeric" value={form.service_km} onChange={cambiar("service_km")} /></Campo>
      </div>
      <label className="g-label" htmlFor="veh-notas">Notas</label>
      <input id="veh-notas" className="g-input w-full mb-2" value={form.notas} onChange={cambiar("notas")} maxLength={500} />
      <button type="button" onClick={() => setVerFrec(!verFrec)} aria-expanded={verFrec} className="min-h-[44px] bg-transparent border-none p-0 text-[13px] font-semibold text-gypi-dim cursor-pointer font-body">
        {verFrec ? "▾" : "▸"} Cada cuánto se revisa
      </button>
      {verFrec && (
        <div className="mb-2">
          <div className="text-[12px] text-gypi-dim mb-1.5">Lo que pase primero. Vacío = lo de siempre (entre paréntesis).</div>
          <table className="w-full text-[13px] border-collapse">
            <thead><tr className="text-gypi-dim text-left"><th className="font-semibold py-1">Qué</th><th className="font-semibold py-1">Días</th><th className="font-semibold py-1">Km</th></tr></thead>
            <tbody>
              {FRECUENCIAS.map((f) => (
                <tr key={f.id}>
                  <td className="py-1 pr-2">{f.nombre}</td>
                  <td className="py-1 pr-2"><input className="g-input w-full" inputMode="numeric" aria-label={`${f.nombre}: cada cuántos días`} placeholder={f.dias ? `(${f.dias})` : "—"}
                    value={frec[f.id].dias} onChange={(e) => setFrec((x) => ({ ...x, [f.id]: { ...x[f.id], dias: e.target.value } }))} /></td>
                  <td className="py-1"><input className="g-input w-full" inputMode="numeric" aria-label={`${f.nombre}: cada cuántos km`} placeholder={f.km ? `(${f.km.toLocaleString("es-AR")})` : "—"}
                    value={frec[f.id].km} onChange={(e) => setFrec((x) => ({ ...x, [f.id]: { ...x[f.id], km: e.target.value } }))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex gap-2 items-center mb-3">
        <BotonFoto label={form.foto_url ? "📷 Cambiar foto" : "📷 Foto del vehículo"} disabled={enviando} onFoto={(url) => setForm((f) => ({ ...f, foto_url: url }))} />
        {form.foto_url && <img src={form.foto_url} alt="Foto del vehículo" className="h-12 w-16 object-cover rounded-[6px]" />}
      </div>
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      <div className="flex gap-2">
        <button onClick={onCancelar} className="g-btn g-btn-secondary flex-1">Cancelar</button>
        <button onClick={guardar} disabled={enviando} className="g-btn g-btn-primary flex-1">{enviando ? "Guardando…" : "Guardar"}</button>
      </div>
    </div>
  );
}

export function FormPapel({ vehiculo, papel = null, tipoInicial = "seguro", renovar = null, onCancelar, onGuardado }) {
  // renovar: el papel anterior; el nuevo arranca con sus datos fijos (compañía, cobertura, nombre)
  const base = papel || (renovar ? { tipo: renovar.tipo, nombre: renovar.nombre, compania: renovar.compania, cobertura: renovar.cobertura, numero: renovar.tipo === "seguro" ? renovar.numero : "" } : { tipo: tipoInicial });
  const [form, setForm] = useState(() => ({
    tipo: base.tipo, nombre: base.nombre ?? "", numero: base.numero ?? "", fecha: base.fecha ?? "", vencimiento: base.vencimiento ?? "",
    compania: base.compania ?? "", cobertura: base.cobertura ?? "", resultado: base.resultado ?? "", detalle: base.detalle ?? "", fotos: papel?.fotos ?? [],
  }));
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const cambiar = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));
  const t = form.tipo;

  const guardar = async () => {
    if (t === "otro" && !form.nombre.trim()) { setError("Poné el nombre del papel"); return; }
    if (form.fecha && form.vencimiento && form.vencimiento < form.fecha) { setError("El vencimiento no puede ser antes de la fecha"); return; }
    setEnviando(true);
    setError(null);
    try {
      await postFlota({
        accion: "papel_guardar",
        ...(papel?.id ? { id: papel.id } : {}),
        vehiculo_id: vehiculo.id,
        tipo: t,
        nombre: t === "otro" ? form.nombre.trim() : null,
        numero: vacioANull(form.numero),
        fecha: form.fecha || null,
        vencimiento: form.vencimiento || null,
        compania: t === "seguro" ? vacioANull(form.compania) : null,
        cobertura: t === "seguro" ? vacioANull(form.cobertura) : null,
        resultado: t === "itv" ? form.resultado || null : null,
        detalle: vacioANull(form.detalle),
        fotos: form.fotos,
      });
      await onGuardado();
    } catch (e) {
      setError(e.message);
      setEnviando(false);
    }
  };

  const etiquetaFecha = t === "itv" ? "Fecha de la revisión" : t === "seguro" ? "Vigente desde" : "Fecha";
  const etiquetaVenc = t === "itv" ? "Vence la oblea" : t === "patente" ? "Vence la próxima cuota" : t === "matafuego" ? "Vence la carga" : "Vence";

  return (
    <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
      <div className="text-[15px] font-bold mb-2">
        {papel ? `Corregir ${nombrePapel(papel).toLowerCase()}` : renovar ? `Renovar ${nombrePapel(renovar).toLowerCase()}` : "Agregar papel"} · {vehiculo.patente}
      </div>
      {!papel && !renovar && (
        <div className="flex gap-1.5 flex-wrap mb-2" role="group" aria-label="Qué papel">
          {TIPOS_PAPEL.map((tp) => <Chip key={tp.id} active={t === tp.id} onClick={() => setForm((f) => ({ ...f, tipo: tp.id }))}>{tp.emoji} {tp.nombre}</Chip>)}
        </div>
      )}
      {t === "otro" && (
        <>
          <label className="g-label" htmlFor="papel-nombre">Qué papel es</label>
          <input id="papel-nombre" className="g-input w-full mb-2" value={form.nombre} onChange={cambiar("nombre")} maxLength={80} placeholder="Ej: RUTA, permiso de carga" disabled={Boolean(renovar)} />
        </>
      )}
      {t === "seguro" && (
        <div className="flex gap-2">
          <Campo id="papel-compania" label="Compañía"><input id="papel-compania" className="g-input w-full mb-2" value={form.compania} onChange={cambiar("compania")} maxLength={80} /></Campo>
          <Campo id="papel-cobertura" label="Cobertura"><input id="papel-cobertura" className="g-input w-full mb-2" value={form.cobertura} onChange={cambiar("cobertura")} maxLength={120} placeholder="Ej: terceros completo" /></Campo>
        </div>
      )}
      {t === "itv" && (
        <div className="flex gap-1.5 flex-wrap mb-2" role="group" aria-label="Resultado">
          {RESULTADOS_ITV.map((r) => <Chip key={r.id} active={form.resultado === r.id} onClick={() => setForm((f) => ({ ...f, resultado: f.resultado === r.id ? "" : r.id }))}>{r.nombre}</Chip>)}
        </div>
      )}
      {t === "itv" && form.resultado === "condicional" && <div className="text-[12px] text-gypi-dim mb-2">Condicional: hay 60 días desde la revisión para arreglar lo que marcaron y volver.</div>}
      {t === "itv" && form.resultado === "rechazado" && <div className="text-[12px] text-gypi-dim mb-2">Rechazado: no puede circular; hay 30 días desde la revisión para arreglar y volver.</div>}
      <div className="flex gap-2">
        <Campo id="papel-fecha" label={etiquetaFecha}><input id="papel-fecha" type="date" className="g-input w-full mb-2" value={form.fecha} onChange={cambiar("fecha")} /></Campo>
        {t !== "titulo" && <Campo id="papel-vencimiento" label={etiquetaVenc}><input id="papel-vencimiento" type="date" className="g-input w-full mb-2" value={form.vencimiento} onChange={cambiar("vencimiento")} /></Campo>}
      </div>
      <label className="g-label" htmlFor="papel-numero">{t === "seguro" ? "N° de póliza" : t === "itv" ? "N° de certificado" : "Número"}</label>
      <input id="papel-numero" className="g-input w-full mb-2" value={form.numero} onChange={cambiar("numero")} maxLength={60} />
      <label className="g-label" htmlFor="papel-detalle">{t === "cedula" ? "A quién está autorizada" : "Nota"}</label>
      <input id="papel-detalle" className="g-input w-full mb-2" value={form.detalle} onChange={cambiar("detalle")} maxLength={300} />
      <div className="flex gap-2 items-center flex-wrap mb-3">
        {form.fotos.length < 4 && <BotonFoto label="📷 Foto del papel" disabled={enviando} onFoto={(url) => setForm((f) => ({ ...f, fotos: [...f.fotos, url].slice(0, 4) }))} />}
        {form.fotos.map((url, i) => (
          <button key={url} onClick={() => setForm((f) => ({ ...f, fotos: f.fotos.filter((u) => u !== url) }))} aria-label={`Sacar la foto ${i + 1}`}
            className="p-0 border-none bg-transparent cursor-pointer">
            <img src={url} alt={`Foto ${i + 1}`} className="h-12 w-16 object-cover rounded-[6px]" />
          </button>
        ))}
      </div>
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      <div className="flex gap-2">
        <button onClick={onCancelar} className="g-btn g-btn-secondary flex-1">Cancelar</button>
        <button onClick={guardar} disabled={enviando} className="g-btn g-btn-primary flex-1">{enviando ? "Guardando…" : "Guardar"}</button>
      </div>
    </div>
  );
}

export function FormLicencia({ empleado, onCancelar, onGuardado }) {
  const [categoria, setCategoria] = useState(empleado.licencia_categoria ?? "");
  const [vencimiento, setVencimiento] = useState(empleado.licencia_vencimiento ?? "");
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const guardar = async () => {
    setEnviando(true);
    setError(null);
    try {
      await postFlota({ accion: "licencia_guardar", empleado_id: empleado.id, categoria: vacioANull(categoria), vencimiento: vencimiento || null });
      await onGuardado();
    } catch (e) {
      setError(e.message);
      setEnviando(false);
    }
  };
  return (
    <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
      <div className="text-[15px] font-bold mb-2">Licencia de conducir de {empleado.nombre}</div>
      <div className="flex gap-2">
        <Campo id="lic-categoria" label="Categoría"><input id="lic-categoria" className="g-input w-full mb-2" value={categoria} onChange={(e) => setCategoria(e.target.value)} maxLength={30} placeholder="Ej: B1, C1, D1" /></Campo>
        <Campo id="lic-vencimiento" label="Vence"><input id="lic-vencimiento" type="date" className="g-input w-full mb-2" value={vencimiento} onChange={(e) => setVencimiento(e.target.value)} /></Campo>
      </div>
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      <div className="flex gap-2">
        <button onClick={onCancelar} className="g-btn g-btn-secondary flex-1">Cancelar</button>
        <button onClick={guardar} disabled={enviando} className="g-btn g-btn-primary flex-1">{enviando ? "Guardando…" : "Guardar"}</button>
      </div>
    </div>
  );
}

function Semaforo({ nivel, children }) {
  return <span className="text-[12px] font-semibold whitespace-nowrap">{SEMAFORO[nivel]?.emoji} {children}</span>;
}

export default function FichaVehiculo({ vehiculo, papeles, empleados, divisiones, checklists = [], arreglos = [], mantenimientos = [], empresaNombre = "", editable, oficina = editable, hoy, onVolver, onCambio }) {
  const [editando, setEditando] = useState(false);
  const [papelForm, setPapelForm] = useState(null); // { papel } | { renovar } | { tipo }
  const [licencia, setLicencia] = useState(false);
  const [verHistorial, setVerHistorial] = useState(false);
  const [haciendo, setHaciendo] = useState(false);
  const [verChecklist, setVerChecklist] = useState(null);
  const [arregloForm, setArregloForm] = useState(null); // { ...inicial } (parte 31)
  const [resolver, setResolver] = useState(null);
  const [mantForm, setMantForm] = useState(null); // "service" | "reparacion"
  const [error, setError] = useState(null);
  const responsable = empleados.find((e) => e.id === vehiculo.responsable_id) || null;
  const avisos = alertasVehiculo(vehiculo, { papeles, checklists, arreglos, responsable, hoy });
  const abiertos = pendientes(arreglos);
  const sinCircular = noCircula(arreglos);
  const nivel = peorNivel(avisos);
  const revisiones = avisos.filter((a) => a.tipo === "revision");
  const vigentes = papelesVigentes(papeles);
  const idsVigentes = new Set(vigentes.map((p) => p.id));
  const historial = papeles.filter((p) => !idsVigentes.has(p.id));
  const faltan = avisos.filter((a) => a.falta);
  const estadoLic = responsable ? estadoVencimiento(responsable.licencia_vencimiento, AVISO_LICENCIA, hoy) : null;
  const listo = async () => { setPapelForm(null); setLicencia(false); setEditando(false); setArregloForm(null); setResolver(null); setMantForm(null); await onCambio(); };

  const accion = async (body) => {
    setError(null);
    try {
      await postFlota(body);
      await onCambio();
    } catch (e) {
      setError(e.message);
    }
  };

  if (editando) return <FormVehiculo vehiculo={vehiculo} empleados={empleados} divisiones={divisiones} onCancelar={() => setEditando(false)} onGuardado={listo} />;
  if (papelForm) return <FormPapel vehiculo={vehiculo} papel={papelForm.papel} renovar={papelForm.renovar} tipoInicial={papelForm.tipo} onCancelar={() => setPapelForm(null)} onGuardado={listo} />;
  if (arregloForm) return <FormArreglo vehiculo={vehiculo} empleados={empleados} inicial={arregloForm} onCancelar={() => setArregloForm(null)} onGuardado={listo} />;
  if (resolver) return <FormMantenimiento vehiculo={vehiculo} arreglo={resolver} onCancelar={() => setResolver(null)} onGuardado={listo} />;
  if (mantForm) return <FormMantenimiento vehiculo={vehiculo} tipoInicial={mantForm} onCancelar={() => setMantForm(null)} onGuardado={listo} />;
  if (verChecklist) {
    // Desde un ⚠️ Revisar se puede anotar un arreglo (los ❌ Mal ya lo tienen)
    const conArreglo = new Set(arreglos.filter((a) => a.checklist_id === verChecklist.id).map((a) => a.punto_nombre));
    return (
      <VerChecklist checklist={verChecklist} vehiculo={vehiculo} empresaNombre={empresaNombre} onVolver={() => setVerChecklist(null)}
        conArreglo={conArreglo}
        onArreglo={editable ? (i) => { setVerChecklist(null); setArregloForm({ checklist_id: verChecklist.id, seccion_nombre: i.seccion_nombre, punto_nombre: i.nombre, descripcion: `${i.nombre}${i.nota ? `: ${i.nota}` : ""}`.slice(0, 300), foto: i.foto }); } : null} />
    );
  }
  if (licencia && responsable) return <FormLicencia empleado={responsable} onCancelar={() => setLicencia(false)} onGuardado={listo} />;

  const datos = [
    ["Tipo", nombreTipoVehiculo(vehiculo.tipo)],
    ["Marca y modelo", [vehiculo.marca, vehiculo.modelo].filter(Boolean).join(" ")],
    ["Año", vehiculo.anio],
    ["Color", vehiculo.color],
    ["Kilómetros", vehiculo.km != null ? `${vehiculo.km.toLocaleString("es-AR")} km${vehiculo.km_at ? ` (al ${fechaCorta(vehiculo.km_at.slice(0, 10))})` : ""}` : null],
    ["Combustible", COMBUSTIBLES.find((c) => c.id === vehiculo.combustible)?.nombre],
    ["N° de motor", vehiculo.motor],
    ["N° de chasis", vehiculo.chasis],
    ["División", vehiculo.division],
    ["Notas", vehiculo.notas],
  ].filter(([, v]) => v !== null && v !== undefined && v !== "");

  return (
    <div>
      <button onClick={onVolver} className="min-h-[44px] bg-transparent border-none p-0 text-[14px] font-semibold text-gypi-dim cursor-pointer font-body">← Flota</button>
      <div className="flex items-center gap-3 mb-3">
        {vehiculo.foto_url && <img src={vehiculo.foto_url} alt={`Foto de ${vehiculo.patente}`} className="h-16 w-20 object-cover rounded-[8px]" />}
        <div className="flex-1 min-w-0">
          <div className="text-[20px] font-extrabold tracking-wide">{vehiculo.patente}{!vehiculo.activo && <span className="text-[13px] font-semibold text-gypi-dim"> · dado de baja</span>}</div>
          <Semaforo nivel={nivel}>{SEMAFORO[nivel].texto}</Semaforo>
        </div>
      </div>
      {sinCircular.length > 0 && (
        <div className="p-2.5 mb-3 rounded-[10px] bg-gypi-red/10 text-[14px] font-semibold text-gypi-red">
          🔴 No puede circular: {sinCircular.map((a) => a.descripcion).join(" · ")}
        </div>
      )}
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
      {editable && vehiculo.activo && <button onClick={() => setHaciendo(true)} className="g-btn g-btn-primary w-full mb-3">📋 Hacer checklist</button>}
      {haciendo && <ChecklistVehiculo vehiculos={[vehiculo]} empresaNombre={empresaNombre} onClose={() => setHaciendo(false)} onHecho={onCambio} />}

      <div className="text-[13px] font-bold uppercase tracking-wide text-gypi-dim mb-1.5">Arreglos pendientes{abiertos.length ? ` (${abiertos.length})` : ""}</div>
      <ListaArreglos arreglos={abiertos} empleados={empleados} editable={editable} onResolver={setResolver} onCambio={onCambio} />
      {editable && (
        <div className="flex gap-2 mb-3">
          <button onClick={() => setArregloForm({})} className="g-btn g-btn-secondary flex-1">＋ Anotar arreglo</button>
          <button onClick={() => setMantForm("service")} className="g-btn g-btn-secondary flex-1">🔧 Service o reparación</button>
        </div>
      )}

      <div className="text-[13px] font-bold uppercase tracking-wide text-gypi-dim mb-1.5">Papeles</div>
      {faltan.map((a) => (
        <div key={a.clave} className="flex items-center gap-2 p-2.5 mb-1.5 rounded-[10px] border border-dashed border-gypi-border">
          <span className="flex-1 text-[14px]">🟡 {a.texto}</span>
          {editable && <button onClick={() => setPapelForm({ tipo: a.falta })} className="g-btn g-btn-secondary">Cargar</button>}
        </div>
      ))}
      <ul aria-label="Papeles vigentes" className="list-none m-0 p-0 flex flex-col gap-1.5 mb-2">
        {vigentes.map((p) => {
          const a = avisos.find((x) => x.papel?.id === p.id);
          const extra = [p.compania, p.cobertura, p.tipo === "itv" && p.resultado ? RESULTADOS_ITV.find((r) => r.id === p.resultado)?.nombre : null, p.numero ? `N° ${p.numero}` : null, p.detalle].filter(Boolean);
          return (
            <li key={p.id} className="p-2.5 rounded-[10px] border border-gypi-border bg-gypi-surface">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold">{tipoPapel(p.tipo).emoji} {nombrePapel(p)}</div>
                  {extra.length > 0 && <div className="text-[12px] text-gypi-dim">{extra.join(" · ")}</div>}
                  <Semaforo nivel={a.nivel}>{textoVencimiento(a, a.vencimiento)}</Semaforo>
                </div>
                {editable && (
                  <div className="flex flex-col gap-1">
                    <button onClick={() => setPapelForm({ renovar: p })} className="g-btn g-btn-secondary">Renovar</button>
                    <button onClick={() => setPapelForm({ papel: p })} className="min-h-[36px] bg-transparent border-none text-[12px] font-semibold text-gypi-dim cursor-pointer">Corregir</button>
                  </div>
                )}
              </div>
              {p.fotos?.length > 0 && (
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  {p.fotos.map((url, i) => <a key={url} href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt={`${nombrePapel(p)}, foto ${i + 1}`} className="h-12 w-16 object-cover rounded-[6px]" /></a>)}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {editable && <button onClick={() => setPapelForm({ tipo: "seguro" })} className="g-btn g-btn-secondary w-full mb-2">＋ Agregar papel</button>}
      {historial.length > 0 && (
        <>
          <button onClick={() => setVerHistorial(!verHistorial)} aria-expanded={verHistorial} className="min-h-[44px] bg-transparent border-none p-0 text-[13px] font-semibold text-gypi-dim cursor-pointer font-body">
            {verHistorial ? "▾" : "▸"} Papeles anteriores ({historial.length})
          </button>
          {verHistorial && (
            <ul aria-label="Papeles anteriores" className="list-none m-0 p-0 flex flex-col gap-1 mb-2">
              {historial.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-[13px] text-gypi-dim">
                  <span className="flex-1 min-w-0 truncate">{nombrePapel(p)}{p.vencimiento ? ` · venció el ${fechaCorta(p.vencimiento)}` : ""}{p.compania ? ` · ${p.compania}` : ""}</span>
                  {editable && <button onClick={() => accion({ accion: "papel_borrar", id: p.id })} aria-label={`Borrar ${nombrePapel(p)} anterior`} className="min-h-[36px] bg-transparent border-none text-[12px] text-gypi-dim cursor-pointer">Borrar</button>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Parte 34 (133): quién le hace el mantenimiento; el chofer sigue para su licencia */}
      {conResponsables(vehiculo, CAMPOS_VEHICULO) && (
        <>
          <div className="text-[13px] font-bold uppercase tracking-wide text-gypi-dim mt-3 mb-1.5">Mantenimiento a cargo de</div>
          <AsignarMantenimiento key={`${vehiculo.mant_responsable_id}-${vehiculo.mant_suplente_id}`} responsableId={vehiculo.mant_responsable_id} suplenteId={vehiculo.mant_suplente_id}
            empleados={empleados} editable={editable}
            onGuardar={async (r) => { await postFlota({ accion: "mantenimiento_asignar", vehiculo_id: vehiculo.id, ...r }); await onCambio(); }} />
        </>
      )}

      <div className="text-[13px] font-bold uppercase tracking-wide text-gypi-dim mt-3 mb-1.5">Chofer habitual</div>
      <div className="p-2.5 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface flex items-center gap-2">
        {responsable ? (
          <>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold">{responsable.nombre}</div>
              <div className="text-[12px] text-gypi-dim">
                {responsable.licencia_categoria ? `Licencia categoría ${responsable.licencia_categoria} · ` : "Licencia · "}
                {estadoLic.nivel === "sin_fecha" ? "falta cargar el vencimiento" : <Semaforo nivel={estadoLic.nivel}>{textoVencimiento(estadoLic, responsable.licencia_vencimiento).toLowerCase()}</Semaforo>}
              </div>
            </div>
            {oficina && <button onClick={() => setLicencia(true)} className="g-btn g-btn-secondary">Licencia</button>}
          </>
        ) : (
          <div className="flex-1 text-[14px] text-gypi-dim">Sin chofer habitual. Elegilo en Editar datos.</div>
        )}
      </div>

      <div className="text-[13px] font-bold uppercase tracking-wide text-gypi-dim mb-1.5">Revisiones</div>
      <ul aria-label="Revisiones" className="list-none m-0 p-0 flex flex-col gap-1 mb-3">
        {revisiones.map((a) => (
          <li key={a.clave} className="flex items-center gap-2 text-[14px]">
            <span className="flex-1 min-w-0">{a.texto}{a.ultima?.fecha ? <span className="text-[12px] text-gypi-dim"> · última el {fechaCorta(a.ultima.fecha)}{a.ultima.km != null ? ` a los ${a.ultima.km.toLocaleString("es-AR")} km` : ""}</span> : null}</span>
            {a.detalle ? <Semaforo nivel={a.nivel}>{a.detalle}</Semaforo> : <Semaforo nivel={a.nivel}>Pendiente</Semaforo>}
          </li>
        ))}
      </ul>

      <div className="text-[13px] font-bold uppercase tracking-wide text-gypi-dim mb-1.5">Historial</div>
      <Historial eventos={historialVehiculo({ checklists, arreglos, mantenimientos, papeles, nombrePapel })} editable={oficina} onVerChecklist={setVerChecklist} onCambio={onCambio} />

      <div className="text-[13px] font-bold uppercase tracking-wide text-gypi-dim mb-1.5">Datos</div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[14px] m-0 mb-3">
        {datos.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-gypi-dim">{k}</dt>
            <dd className="m-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {editable && (
        <div className="flex gap-2">
          <button onClick={() => setEditando(true)} className="g-btn g-btn-secondary flex-1">✏ Editar datos</button>
          <button onClick={() => accion({ accion: "vehiculo_baja", id: vehiculo.id, activo: !vehiculo.activo })} className="g-btn g-btn-secondary flex-1">
            {vehiculo.activo ? "Dar de baja" : "Reactivar"}
          </button>
        </div>
      )}
    </div>
  );
}
