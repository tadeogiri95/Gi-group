'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { sb, sbGetAll, apiFetch } from "./lib/supabase";
import { Tag, Chip, Modal } from "./components/ui";
import { getDivisionesConSinAsignar } from "./lib/constants";
import { useAuth } from "./context/AuthContext";
import { useToast } from "./components/ui/Toast";
import { useConfirm } from "./components/ui/ConfirmDialog";
import { imprimirTarjetas } from "./lib/tarjetasQR";
import { fechaCorta } from "./lib/ot";
import DetalleOp from "./components/DetalleOp";
import { puedeVerPrecios, leerPrecios } from "./lib/valorizacion";
import { fmtPesos } from "./lib/costo";
import TableroOt from "./components/TableroOt";
import GanttOt from "./components/GanttOt";
import NoConformidades from "./components/NoConformidades";
import SueltosOt from "./components/SueltosOt";
import CargaOt from "./components/CargaOt";
import ActaOt from "./components/ActaOt";
import EtiquetasModulos from "./components/EtiquetasModulos";
import PiezasOt from "./components/PiezasOt";
import { useCostoHora } from "./hooks/useCostoHora";
import { filasTablero, otEnCurso, contarPorDivision, nombreDivisionOt } from "./lib/avance";
import { leerAvanceYHoras } from "./lib/otEnCursoDatos";
import { avancePorOt } from "./lib/piezas";
import { hoyArg } from "./lib/dates";
import { AVISO_DEMORA_GOOGLE, linksPlanilla, valorLinks } from "./lib/csvProyectos";
import { CLAVE_FECHA_OBJETIVO, MODOS_FECHA_OBJETIVO, normalizarModo } from "./lib/semanaObjetivo";
import { useEscape } from "./hooks/useEscape";

const GREEN = "#16A34A";
const RED = "#DC2626";
const CYAN = "#0891B2";
const AMBER = "var(--color-empresa-primary, #F97316)";

/* ═══ PARSER CSV ═══ */
function parseProyectosCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const parseRow = (line) => {
    const out = []; let cur = ""; let inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { out.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const headers = parseRow(lines[0]).map(h => h.toLowerCase().replace(/^﻿/, ""));
  const idx = (n) => headers.findIndex(h => h.includes(n));
  const iOt = idx("ot"), iCli = idx("cliente"), iObra = idx("obra"), iProy = idx("proyecto"), iDiv = idx("division") >= 0 ? idx("division") : idx("división");
  if (iOt < 0) return [];
  return lines.slice(1).map(line => {
    const c = parseRow(line);
    return {
      ot: c[iOt] || "",
      cliente: iCli >= 0 ? c[iCli] || "" : "",
      obra: iObra >= 0 ? c[iObra] || "" : "",
      proyecto: iProy >= 0 ? c[iProy] || "" : "",
      division: iDiv >= 0 ? c[iDiv] || "" : "",
    };
  }).filter(r => r.ot);
}

/* ═══ MODAL ═══ */
function ModalProyecto({ initial, divisiones, onClose, onSave, saving }) {
  useEscape(onClose);
  const [f, setF] = useState(initial || { ot: "", cliente: "", obra: "", proyecto: "", division: "" });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const modulosTexto = String(f.total_modulos ?? "").trim();
  const modulosValido = modulosTexto === "" || (/^\d{1,4}$/.test(modulosTexto));
  const valid = f.ot?.trim() && modulosValido;
  const editando = !!initial?.id;

  return (
    <div className="fixed inset-0 z-200 flex items-end justify-center">
      <div onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-[460px] bg-gypi-bg rounded-t-[20px] p-[20px_18px_30px] max-h-[85vh] overflow-y-auto border border-gypi-border">
        <div className="w-9 h-1 rounded-sm bg-gypi-mute mx-auto mb-4" />
        <h3 className="m-0 mb-4 font-heading text-lg font-bold text-gypi-text">{editando ? "Editar OT" : "Nueva OT"}</h3>

        <div className="mb-3">
          <label className="g-label">OT / Código *</label>
          <input value={f.ot} onChange={e => set("ot", e.target.value)} className="g-input" placeholder="Ej: 7450" />
        </div>
        <div className="mb-3">
          <label className="g-label">Cliente</label>
          <input value={f.cliente} onChange={e => set("cliente", e.target.value)} className="g-input" />
        </div>
        <div className="mb-3">
          <label className="g-label">Obra</label>
          <input value={f.obra} onChange={e => set("obra", e.target.value)} className="g-input" />
        </div>
        <div className="mb-3">
          <label className="g-label">Descripción</label>
          <input value={f.proyecto} onChange={e => set("proyecto", e.target.value)} className="g-input" />
        </div>
        <div className="mb-3">
          <label className="g-label" htmlFor="ot-modulos">Total de módulos</label>
          <input id="ot-modulos" value={f.total_modulos ?? ""} onChange={e => set("total_modulos", e.target.value)} className="g-input" inputMode="numeric" placeholder="Ej: 12 (si viene en la planilla, se completa solo)" />
          {!modulosValido && <div className="text-xs text-gypi-red mt-1">Un número entero, sin decimales.</div>}
        </div>
        <div className="mb-5">
          <label className="g-label">División</label>
          <select value={f.division || ""} onChange={e => set("division", e.target.value)} className="g-input cursor-pointer">
            {divisiones.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </div>

        <button
          onClick={() => onSave(f)}
          disabled={!valid || saving}
          className={`w-full py-3.5 rounded-xl border-none text-[15px] font-bold font-heading cursor-pointer ${valid && !saving ? "bg-gypi-green text-black" : "bg-gypi-surface text-gypi-mute cursor-default"}`}
        >
          {saving ? "Guardando..." : editando ? "Guardar cambios" : "Crear OT"}
        </button>
      </div>
    </div>
  );
}

/* ═══ MODAL CSV PREVIEW ═══ */
function ModalCSVPreview({ filas, onClose, onConfirm, saving, progreso }) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-200 flex items-end justify-center">
      <div onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-[460px] bg-gypi-bg rounded-t-[20px] p-[20px_18px_30px] max-h-[85vh] overflow-y-auto border border-gypi-border">
        <div className="w-9 h-1 rounded-sm bg-gypi-mute mx-auto mb-4" />
        <h3 className="m-0 mb-1.5 font-heading text-lg font-bold text-gypi-text">Vista previa CSV</h3>
        <p className="text-xs text-gypi-dim mb-3.5">{filas.length} OT detectadas. Revisá y confirmá.</p>

        <div className="max-h-80 overflow-y-auto mb-3.5 border border-gypi-border rounded-[10px]">
          {filas.slice(0, 50).map((r, i) => (
            <div key={i} className={`p-2.5 text-xs ${i < Math.min(filas.length, 50) - 1 ? "border-b border-gypi-border" : ""}`}>
              <div className="flex gap-2 items-center">
                <span className="font-mono font-bold text-gypi-amber-ink min-w-[60px]">{r.ot}</span>
                <span className="flex-1 text-gypi-text overflow-hidden text-ellipsis whitespace-nowrap">{r.cliente || r.proyecto || "—"}</span>
                {r.division && <Tag color={CYAN}>{r.division}</Tag>}
              </div>
              {r.obra && <div className="text-xs text-gypi-dim mt-0.5">{r.obra}</div>}
            </div>
          ))}
          {filas.length > 50 && <div className="p-2.5 text-center text-xs text-gypi-mute">+ {filas.length - 50} más</div>}
        </div>

        {saving && progreso && <div className="p-2.5 bg-gypi-amber/10 text-gypi-amber-ink rounded-[10px] text-xs mb-2.5 text-center">{progreso}</div>}

        <div className="flex gap-2">
          <button onClick={onClose} disabled={saving} className="g-btn g-btn-secondary flex-1">Cancelar</button>
          <button
            onClick={onConfirm}
            disabled={saving}
            className={`flex-2 py-3 rounded-xl border-none text-sm font-bold cursor-pointer ${saving ? "bg-gypi-surface text-gypi-dim cursor-default" : "bg-gypi-green text-black"}`}
          >
            {saving ? "Importando..." : `Importar ${filas.length} OT`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══ COMPONENTE PRINCIPAL ═══ */
export default function ProyectosScreen({ empresaId }) {
  const { divisiones: divisionesCtx, etapas: etapasCtx, causasParada, checklistLiberacion, checklistCarga, checklistInstalacion, defectos, empresa, updateEmpresa, usuario } = useAuth();
  // Costo de la hora: solo el dueño (OP parte 8)
  const costoHora = useCostoHora(usuario?.rol === "gerencial");
  // Precio de cada OT (142): solo Dueño y Administración
  const verPrecios = puedeVerPrecios(usuario);
  const [precios, setPrecios] = useState(() => new Map());
  useEffect(() => {
    if (!verPrecios || !empresaId) return;
    let vivo = true;
    leerPrecios().then((m) => { if (vivo) setPrecios(m); });
    return () => { vivo = false; };
  }, [verPrecios, empresaId]);
  const divisiones = getDivisionesConSinAsignar(divisionesCtx);
  const [proyectos, setProyectos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filtro, setFiltro] = useState("activo");
  const [search, setSearch] = useState("");
  const [filtroDiv, setFiltroDiv] = useState("");
  const [masAcciones, setMasAcciones] = useState(false);
  const [modal, setModal] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [sueltos, setSueltos] = useState(null);
  const [carga, setCarga] = useState(null);
  const [acta, setActa] = useState(null);
  const [etiquetas, setEtiquetas] = useState(null);
  const [piezasOt, setPiezasOt] = useState(null);
  // OT tocada en la lista: se abre con todos sus botones (auditoría 22/10)
  const [acciones, setAcciones] = useState(null);
  const [vista, setVista] = useState("lista");
  const [csvFilas, setCsvFilas] = useState(null);
  const [csvRawText, setCsvRawText] = useState(null);
  const [csvProgreso, setCsvProgreso] = useState("");
  const toast = useToast();
  const [confirmFn, ConfirmDialog] = useConfirm();
  const fileRef = useRef(null);
  const [syncCfg, setSyncCfg] = useState({ url: "", ultima_sync: null });
  const [syncLoading, setSyncLoading] = useState(false);
  const [showSyncPanel, setShowSyncPanel] = useState(false);
  // Cómo se cuenta la fecha objetivo de las OT (135): semana del año o entrega
  const [modoObjetivo, setModoObjetivo] = useState(normalizarModo());

  const showToast = (msg, color) => toast.show(msg, color);

  const cargar = useCallback(async () => {
    if (!empresaId) return;
    setLoading(true);
    try {
      // Todas las OT, no solo las primeras 500 (cada pedido trae hasta 1000)
      const { data } = await sbGetAll(`proyectos?empresa_id=eq.${empresaId}&order=created_at.desc,id.desc`, { maxFilas: 20000 });
      setProyectos(data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [empresaId]);

  const cargarSyncCfg = useCallback(async () => {
    if (!empresaId) return;
    try {
      const rows = await sb.get("config_sistema?clave=eq.proyectos_csv_url&select=valor&limit=1");
      const v = rows?.[0]?.valor;
      // Un link por renglón: el de la hoja PLAN y los de las hojas de cada obra
      if (v) setSyncCfg({ url: linksPlanilla(v).join("\n"), ultima_sync: v.ultima_sync || null });
    } catch {}
    try {
      const rows = await sb.get(`config_sistema?clave=eq.${CLAVE_FECHA_OBJETIVO}&select=valor&limit=1`);
      setModoObjetivo(normalizarModo(rows?.[0]?.valor?.modo));
    } catch {}
  }, [empresaId]);

  const guardarModoObjetivo = async (modo) => {
    const anterior = modoObjetivo;
    setModoObjetivo(modo);
    try {
      const rows = await sb.get(`config_sistema?clave=eq.${CLAVE_FECHA_OBJETIVO}&select=clave&limit=1`);
      if (rows?.length) await sb.patch(`config_sistema?clave=eq.${CLAVE_FECHA_OBJETIVO}`, { valor: { modo } });
      else await sb.post("config_sistema", { clave: CLAVE_FECHA_OBJETIVO, valor: { modo } });
      showToast("✅ Guardado. Apretá Sincronizar para que se aplique a las OT.", GREEN);
    } catch (e) {
      setModoObjetivo(anterior);
      showToast(`Error: ${e.message}`, RED);
    }
  };

  useEffect(() => { cargar(); cargarSyncCfg(); }, [cargar, cargarSyncCfg]);

  // OT en curso: abiertas con alguna etapa empezada y no todas cerradas
  const [avanceHoras, setAvanceHoras] = useState(null);
  useEffect(() => {
    if (!empresaId) return;
    let vivo = true;
    leerAvanceYHoras(empresaId).then((d) => { if (vivo) setAvanceHoras(d); }).catch(() => {});
    return () => { vivo = false; };
  }, [empresaId, proyectos]);
  const enCurso = useMemo(() => {
    if (!avanceHoras) return null;
    const abiertas = proyectos.filter(p => p.estado !== "cerrado");
    return otEnCurso(filasTablero(abiertas, { etapas: etapasCtx || [], divisiones: divisionesCtx || [], ...avanceHoras, hoy: hoyArg() }));
  }, [avanceHoras, proyectos, etapasCtx, divisionesCtx]);
  const otsEnCurso = useMemo(() => new Set((enCurso || []).map(f => String(f.proyecto.ot))), [enCurso]);
  // % de producción por escaneo de cada OT (parte 25)
  const pctEscaneo = useMemo(() => avancePorOt(avanceHoras?.piezas || []), [avanceHoras]);

  const guardar = async (form) => {
    setSaving(true);
    // Total de módulos (101): solo se manda si cambió, así la OT se puede
    // editar aunque la migración todavía no esté corrida
    const textoModulos = String(form.total_modulos ?? "").trim();
    const modulos = textoModulos === "" ? null : Number(textoModulos);
    const conModulos = modulos !== (modal?.total_modulos ?? null) ? { total_modulos: modulos } : {};
    try {
      if (modal?.id) {
        await sb.patch(`proyectos?id=eq.${modal.id}`, {
          ot: form.ot.trim(),
          cliente: form.cliente || null,
          obra: form.obra || null,
          proyecto: form.proyecto || null,
          division: form.division || null,
          ...conModulos,
        });
        showToast("✅ OT actualizada", GREEN);
      } else {
        await sb.post("proyectos", {
          ot: form.ot.trim(),
          cliente: form.cliente || null,
          obra: form.obra || null,
          proyecto: form.proyecto || null,
          division: form.division || null,
          estado: "activo",
          ...conModulos,
        });
        showToast("✅ OT creada", GREEN);
      }
      setModal(null);
      await cargar();
    } catch (e) {
      showToast(`Error: ${e.message?.includes("uq_proyectos") ? "OT ya existe" : e.message}`, RED);
    }
    setSaving(false);
  };

  const cerrarProyecto = async (id) => {
    if (!await confirmFn("¿Cerrar esta OT?", { title: "Cerrar OT", confirmLabel: "Cerrar" })) return;
    try {
      await sb.patch(`proyectos?id=eq.${id}`, { estado: "cerrado" });
      await cargar();
      showToast("OT cerrada", AMBER);
    } catch (e) { showToast(`Error: ${e.message}`, RED); }
  };

  const reabrir = async (id) => {
    try {
      await sb.patch(`proyectos?id=eq.${id}`, { estado: "activo" });
      await cargar();
      showToast("OT reactivada", GREEN);
    } catch (e) { showToast(`Error: ${e.message}`, RED); }
  };

  const onCsv = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const filas = parseProyectosCSV(reader.result);
      if (filas.length === 0) { showToast("CSV sin datos válidos. Verificá columnas: ot, cliente, obra, proyecto, division", RED); return; }
      setCsvFilas(filas);
      setCsvRawText(reader.result);
    };
    reader.readAsText(f);
    e.target.value = "";
  };

  const guardarSyncUrl = async () => {
    if (!syncCfg.url.trim()) return;
    setSyncLoading(true);
    try {
      const valor = valorLinks(syncCfg.url);
      const rows = await sb.get("config_sistema?clave=eq.proyectos_csv_url&select=clave&limit=1");
      if (rows?.length) {
        await sb.patch("config_sistema?clave=eq.proyectos_csv_url", { valor });
      } else {
        await sb.post("config_sistema", { clave: "proyectos_csv_url", valor });
      }
      const cuantos = 1 + valor.urls.length;
      showToast(cuantos > 1 ? `✅ ${cuantos} links guardados` : "✅ URL guardada", GREEN);
    } catch (e) { showToast(`Error: ${e.message}`, RED); }
    setSyncLoading(false);
  };

  const sincronizar = async () => {
    if (!syncCfg.url.trim()) { showToast("Guardá la URL primero", AMBER); return; }
    setSyncLoading(true);
    try {
      const res = await apiFetch("/api/proyectos/sync-csv", { method: "POST" });
      // Si el servidor se cortó (tardó demasiado) no vuelve JSON
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || "la sincronización no terminó. Esperá un minuto y probá de nuevo");
      const faltan = (data.total || 0) - (data.procesados || 0);
      const hojasMal = (data.errores || []).filter(e => e.startsWith("Hoja "));
      if (faltan > 0) {
        showToast(`⚠️ ${data.procesados} OT sincronizadas, ${faltan} no se pudieron guardar. Probá de nuevo.`, AMBER);
        console.warn("Errores sync OT:", data.errores);
      } else if (hojasMal.length) {
        // Una hoja de obra que no se pudo leer (link mal o sin publicar)
        showToast(`⚠️ ${data.procesados} OT sincronizadas. No se pudo leer: ${hojasMal.join("; ")}. Revisá ese link.`, AMBER);
      } else {
        const rep = data.repetidas ? ` (${data.repetidas} repetida${data.repetidas > 1 ? "s" : ""} en la planilla)` : "";
        showToast(`✅ ${data.procesados} OT sincronizadas${rep}`, GREEN);
      }
      await cargar(); await cargarSyncCfg();
    } catch (e) { showToast(`Error: ${e.message}`, RED); }
    setSyncLoading(false);
  };

  const importarCSV = async () => {
    if (!csvRawText) return;
    setSaving(true);
    setCsvProgreso(`Importando ${csvFilas.length} proyectos...`);
    try {
      const res = await apiFetch("/api/proyectos/import-csv", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: csvRawText,
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Error al importar");

      const erroresTxt = data.errors?.length ? ` · ${data.errors.length} con error` : "";
      showToast(`✅ ${data.created} importados · ${data.skipped} duplicados${erroresTxt}`, data.created > 0 ? GREEN : AMBER);
      if (data.errors?.length) console.warn("Errores import CSV proyectos:", data.errors);
    } catch (e) {
      showToast(`Error: ${e.message}`, RED);
    }
    setCsvProgreso("");
    setCsvFilas(null);
    setCsvRawText(null);
    setSaving(false);
    await cargar();
  };

  const filtrados = proyectos.filter(p => {
    if (filtro === "en_curso") { if (!otsEnCurso.has(String(p.ot))) return false; }
    else if (filtro !== "todos" && p.estado !== filtro) return false;
    if (filtroDiv && p.division !== filtroDiv) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return p.ot?.toLowerCase().includes(q) || p.cliente?.toLowerCase().includes(q) || p.obra?.toLowerCase().includes(q) || p.proyecto?.toLowerCase().includes(q) || p.descripcion?.toLowerCase().includes(q);
    }
    return true;
  });

  /* ── Escáner de OT (D8, ítem 20) ── */
  const [guardandoEscaner, setGuardandoEscaner] = useState(false);
  const cambiarEscaner = async () => {
    const nuevo = !empresa?.escaner_ot;
    setGuardandoEscaner(true);
    try {
      const res = await apiFetch("/api/empresa", { method: "PATCH", body: JSON.stringify({ escaner_ot: nuevo }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "No se pudo guardar");
      updateEmpresa?.({ escaner_ot: nuevo });
      showToast(nuevo ? "Escáner de OT activado" : "Escáner de OT desactivado", GREEN);
    } catch (e) {
      showToast(e.message, RED);
    }
    setGuardandoEscaner(false);
  };

  // Etiquetas con el QR de cada OT de la lista filtrada, para pegar en la orden o la pieza
  const imprimirEtiquetas = () => {
    const lista = filtrados.filter(p => p.ot);
    if (lista.length === 0) return;
    imprimirTarjetas({
      titulo: "Etiquetas de OT",
      empresa: empresa?.nombre_corto || empresa?.nombre || "",
      tarjetas: lista.map(p => ({
        nombre: `OT ${p.ot}`,
        detalle: [p.cliente, p.proyecto].filter(Boolean).join(" · "),
        link: String(p.ot),
        pie: "Escaneala en “Iniciar tarea” para elegir esta OT.",
      })),
    }).catch(e => showToast(e.message, RED));
  };

  // Obra, división y entrega en una línea, sin separadores sueltos si falta algo
  const lineaOt = (p) => [
    p.obra || p.proyecto,
    p.division && nombreDivisionOt(divisionesCtx || [], p.division),
    p.fecha_entrega && `Entrega ${fechaCorta(p.fecha_entrega)}`,
  ].filter(Boolean).join(" · ");

  // Abre una pantalla de la OT y cierra la ventana de acciones
  const abrir = (fn) => { const p = acciones; setAcciones(null); fn(p); };

  const activos = proyectos.filter(p => p.estado === "activo").length;
  const cerrados = proyectos.filter(p => p.estado === "cerrado").length;

  return (
    <div className="font-body flex-1 overflow-y-auto px-[18px] pb-[110px] relative">

      {modal && <ModalProyecto initial={modal} divisiones={divisiones} onClose={() => setModal(null)} onSave={guardar} saving={saving} />}
      {csvFilas && <ModalCSVPreview filas={csvFilas} onClose={() => { setCsvFilas(null); setCsvRawText(null); }} onConfirm={importarCSV} saving={saving} progreso={csvProgreso} />}

      {/* Métricas */}
      <div className="grid grid-cols-4 gap-2 mb-3.5">
        <div className="g-card text-center !p-3">
          <div className="font-heading text-[22px] font-bold text-gypi-green">{activos}</div>
          <div className="g-overline mt-0.5">Activos</div>
        </div>
        <button type="button" onClick={() => setFiltro("en_curso")} aria-label={`${enCurso ? enCurso.length : "—"} OT en curso: ver la lista`}
          className={`g-card text-center !p-3 cursor-pointer ${filtro === "en_curso" ? "!border-gypi-amber" : ""}`}>
          <div className="font-heading text-[22px] font-bold text-gypi-amber-ink">{enCurso ? enCurso.length : "—"}</div>
          <div className="g-overline mt-0.5">En curso</div>
        </button>
        <div className="g-card text-center !p-3">
          <div className="font-heading text-[22px] font-bold text-gypi-mute">{cerrados}</div>
          <div className="g-overline mt-0.5">Cerrados</div>
        </div>
        <div className="g-card text-center !p-3">
          <div className="font-heading text-[22px] font-bold text-gypi-amber-ink">{proyectos.length}</div>
          <div className="g-overline mt-0.5">Total</div>
        </div>
      </div>

      {enCurso && enCurso.length > 0 && (
        <div className="text-xs text-gypi-dim -mt-2 mb-3">
          En curso por división: {contarPorDivision(enCurso, divisionesCtx || []).map(d => `${d.nombre} ${d.cantidad}`).join(" · ")}
        </div>
      )}

      {/* Acciones de todos los días: grandes y con texto (revisión de la interfaz, 2026-10) */}
      <div className="flex gap-2 mb-3">
        <button onClick={() => setModal({})} className="flex-1 min-h-[48px] rounded-xl border-none bg-gypi-green/15 text-gypi-green text-[15px] font-bold cursor-pointer">+ Nueva OT</button>
        <button onClick={cargar} className="flex-1 min-h-[48px] rounded-xl border border-gypi-border bg-gypi-surface text-gypi-text text-[15px] font-bold cursor-pointer">🔄 Actualizar</button>
      </div>

      {/* Filtros en una sola fila */}
      <div className="flex gap-2 mb-2.5">
        <select value={filtro} onChange={e => setFiltro(e.target.value)} aria-label="Estado de las OT" className="g-input flex-1 min-h-[48px] text-[15px]">
          <option value="activo">Activas</option>
          <option value="en_curso">En curso</option>
          <option value="cerrado">Cerradas</option>
          <option value="todos">Todas</option>
        </select>
        <select value={filtroDiv} onChange={e => setFiltroDiv(e.target.value)} aria-label="División" className="g-input flex-1 min-h-[48px] text-[15px]">
          <option value="">Divisiones</option>
          {divisiones.filter(d => d.id).map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 OT, cliente u obra" className="g-input mb-3" />

      {/* Lo que se usa de vez en cuando: CSV, etiquetas, escáner y sincronización */}
      <div className="mb-3.5">
        <button onClick={() => setMasAcciones(v => !v)} aria-expanded={masAcciones}
          className="w-full min-h-[48px] px-3.5 rounded-xl border border-gypi-border bg-transparent text-gypi-text text-[15px] font-semibold cursor-pointer flex justify-between items-center">
          <span>⋯ Más acciones</span>
          <span aria-hidden="true" className="text-xs text-gypi-dim">{masAcciones ? "▲" : "▼"}</span>
        </button>
        {masAcciones && (
          <div className="mt-2 flex flex-col gap-2">
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onCsv} />
            <button onClick={() => fileRef.current?.click()} className="w-full min-h-[48px] rounded-xl border-none bg-gypi-cyan/15 text-gypi-cyan text-[15px] font-bold cursor-pointer">📤 Importar OT desde un CSV</button>
            {/* Escáner de OT con la cámara */}
            <div className="g-card !p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-gypi-dim">
                  <b className="text-gypi-text">Escanear OT con la cámara:</b> el operario escanea el código de la orden al iniciar una tarea.
                </div>
                <button
                  role="switch"
                  aria-checked={!!empresa?.escaner_ot}
                  aria-label="Escanear OT con la cámara"
                  onClick={cambiarEscaner}
                  disabled={guardandoEscaner}
                  className={`shrink-0 min-h-[40px] px-3 rounded-lg border-none text-xs font-bold cursor-pointer ${empresa?.escaner_ot ? "bg-gypi-green/15 text-gypi-green" : "bg-gypi-surface text-gypi-dim"}`}
                >
                  {empresa?.escaner_ot ? "Activado" : "Desactivado"}
                </button>
              </div>
              <button onClick={imprimirEtiquetas} disabled={!filtrados.some(p => p.ot)} className="g-btn g-btn-secondary text-xs font-bold disabled:opacity-50">
                Imprimir etiquetas QR de las OT de la lista
              </button>
            </div>
            {/* Panel de URL de sincronización */}
            <div>
              <button
                onClick={() => setShowSyncPanel(p => !p)}
                className="w-full py-2 px-3 rounded-[10px] border border-gypi-border bg-transparent text-gypi-dim text-xs font-semibold cursor-pointer flex justify-between items-center"
              >
                <span>🔗 Sincronización automática {syncCfg.url ? "· configurada" : ""}</span>
                <span className="text-xs">{showSyncPanel ? "▲" : "▼"}</span>
              </button>
              {showSyncPanel && (
                <div className="mt-1.5 p-3 bg-gypi-surface rounded-[10px] border border-gypi-border">
                  <div className="text-xs text-gypi-dim mb-2 leading-relaxed">
                    URL pública de CSV (Google Sheets, servidor, etc.). Se hace upsert por OT: las OT nuevas se crean y las existentes se actualizan.
                    {" "}{AVISO_DEMORA_GOOGLE}
                  </div>
                  {syncCfg.ultima_sync && (
                    <div className="text-xs text-gypi-green mb-2">
                      Última sync: {new Date(syncCfg.ultima_sync).toLocaleString("es-AR")}
                    </div>
                  )}
                  <label className="block text-xs font-semibold text-gypi-text mb-1" htmlFor="links-planilla">Links de la planilla, uno por renglón</label>
                  <div className="text-xs text-gypi-dim mb-1 leading-relaxed">
                    Primero el de la hoja PLAN. Si una obra tiene su hoja propia (OCAMPOURB, MALMÖ…), publicá esa hoja también como CSV y pegá su link en otro renglón.
                  </div>
                  <textarea
                    id="links-planilla"
                    value={syncCfg.url}
                    onChange={e => setSyncCfg(p => ({ ...p, url: e.target.value }))}
                    placeholder="https://docs.google.com/spreadsheets/d/…/export?format=csv"
                    rows={4}
                    className="g-input text-xs mb-2"
                  />
                  <label className="block text-xs font-semibold text-gypi-text mb-1" htmlFor="modo-objetivo">Fecha objetivo de las OT (Gantt y OT atrasadas)</label>
                  <select id="modo-objetivo" value={modoObjetivo} onChange={e => guardarModoObjetivo(e.target.value)} className="g-input text-xs mb-2">
                    {MODOS_FECHA_OBJETIVO.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <button
                      onClick={guardarSyncUrl}
                      disabled={syncLoading || !syncCfg.url.trim()}
                      className={`flex-1 py-2 rounded-lg border-none text-xs font-bold ${syncCfg.url.trim() ? "bg-gypi-amber/15 text-gypi-amber-ink cursor-pointer" : "bg-gypi-surface text-gypi-mute cursor-default"}`}
                    >
                      Guardar links
                    </button>
                    <button
                      onClick={sincronizar}
                      disabled={syncLoading || !syncCfg.url.trim()}
                      className={`flex-1 py-2 rounded-lg border-none text-xs font-bold ${syncCfg.url.trim() && !syncLoading ? "bg-gypi-green/15 text-gypi-green cursor-pointer" : "bg-gypi-surface text-gypi-mute cursor-default"}`}
                    >
                      {syncLoading ? "Sincronizando…" : "🔄 Sincronizar ahora"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-1.5 mb-3" role="group" aria-label="Cómo ver las OT">
        <Chip active={vista === "lista"} onClick={() => setVista("lista")}>Lista</Chip>
        <Chip active={vista === "tablero"} onClick={() => setVista("tablero")}>Tablero</Chip>
        <Chip active={vista === "gantt"} onClick={() => setVista("gantt")}>📅 Gantt</Chip>
        <Chip active={vista === "calidad"} onClick={() => setVista("calidad")}>No conformes</Chip>
      </div>

      {vista === "calidad" && !loading ? (
        <NoConformidades empresaId={empresaId} proyectos={proyectos} etapas={etapasCtx || []} defectos={defectos || []} />
      ) : vista === "gantt" && !loading ? (
        <GanttOt
          proyectos={filtrados.filter(p => p.estado !== "cerrado")}
          etapas={etapasCtx || []}
          divisiones={divisionesCtx || []}
          avanceHoras={avanceHoras}
          modo={modoObjetivo}
          onVerDetalle={setDetalle}
        />
      ) : vista === "tablero" && !loading ? (
        <TableroOt
          proyectos={filtrados.filter(p => p.estado !== "cerrado")}
          empresaId={empresaId}
          etapas={etapasCtx || []}
          divisiones={divisionesCtx || []}
          checklist={checklistLiberacion || []}
          onProyectoActualizado={(p) => setProyectos(prev => prev.map(x => x.id === p.id ? { ...x, ...p } : x))}
          onVerDetalle={setDetalle}
        />
      ) : loading ? (
        <div className="gypi-dots"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>
      ) : filtrados.length === 0 ? (
        <div className="g-card py-8 px-6 text-center">
          <div className="text-[28px] mb-2">📋</div>
          <div className="text-sm font-bold text-gypi-text mb-1">
            {search || filtroDiv ? "Sin resultados" : "Todavía no hay OT"}
          </div>
          <div className="text-xs text-gypi-dim">
            {search || filtroDiv ? "Probá con otro filtro o búsqueda." : "Creá la primera con + Nueva OT o importala desde Más acciones."}
          </div>
        </div>
      ) : (
        <div className="lista-ancha flex flex-col gap-2">
          {filtrados.map(p => {
            const divInfo = divisiones.find(d => d.id === p.division) || divisiones[0];
            const divColor = divInfo.color || AMBER;
            return (
              <button key={p.id} type="button" onClick={() => setAcciones(p)} aria-label={`OT ${p.ot}: ${p.cliente || p.proyecto || "sin cliente"}. Ver acciones`}
                className={`g-card !p-3 w-full text-left cursor-pointer flex items-center gap-2.5 min-h-[64px] ${p.estado === "cerrado" ? "opacity-60" : ""}`}>
                <div className="min-w-[60px] h-10 rounded-[10px] flex items-center justify-center font-mono text-sm font-bold px-2" style={{ background: `${divColor}22`, color: divColor }}>{p.ot}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-bold text-gypi-text overflow-hidden text-ellipsis whitespace-nowrap">{p.cliente || p.proyecto || "—"}</div>
                  <div className="text-[13px] text-gypi-dim mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">{lineaOt(p)}</div>
                </div>
                {verPrecios && precios.has(String(p.ot)) && <span className="text-xs font-bold text-gypi-dim whitespace-nowrap" aria-label={`Precio ${fmtPesos(precios.get(String(p.ot)))}`}>{fmtPesos(precios.get(String(p.ot)))}</span>}
                {p.estado !== "cerrado" && pctEscaneo.get(String(p.ot))?.porcentaje != null && <Tag color={AMBER}>🧩 {pctEscaneo.get(String(p.ot)).porcentaje}%</Tag>}
                {p.estado !== "cerrado" && otsEnCurso.has(String(p.ot)) && <Tag color={AMBER}>en curso</Tag>}
                {p.estado === "cerrado" && <Tag color="var(--color-text-muted)">cerrado</Tag>}
                {p.estado !== "cerrado" && p.terminado_planilla && <Tag color="var(--color-text-muted)">terminada en planilla</Tag>}
                <span aria-hidden="true" className="text-gypi-mute text-lg">›</span>
              </button>
            );
          })}
        </div>
      )}
      {carga && (
        <CargaOt ot={String(carga.ot)} empresaId={empresaId} empresa={empresa} usuario={usuario} checklist={checklistCarga || []}
          esGestion={usuario?.rol === "gerencial" || usuario?.rol === "administrativo"} onClose={() => setCarga(null)}
          onAbrirActa={() => { setActa(carga); setCarga(null); }} />
      )}
      {etiquetas && <EtiquetasModulos proyecto={etiquetas} empresa={empresa} onClose={() => setEtiquetas(null)} />}
      {piezasOt && (
        <PiezasOt proyecto={piezasOt} empresaId={empresaId} empresa={empresa} esGestion={usuario?.rol === "gerencial" || usuario?.rol === "administrativo"} onClose={() => setPiezasOt(null)} />
      )}
      {acta && (
        <ActaOt ot={String(acta.ot)} empresaId={empresaId} empresa={empresa} checklist={checklistInstalacion || []} etapas={etapasCtx || []} defectos={defectos || []}
          esGestion={usuario?.rol === "gerencial" || usuario?.rol === "administrativo"} onClose={() => setActa(null)} />
      )}
      {sueltos && (
        <SueltosOt proyecto={sueltos} empresaId={empresaId} esGestion={usuario?.rol === "gerencial" || usuario?.rol === "administrativo"} onClose={() => setSueltos(null)} />
      )}
      {detalle && (
        <DetalleOp proyecto={detalle} empresaId={empresaId} etapas={etapasCtx || []} divisiones={divisionesCtx || []} causas={causasParada || []} defectos={defectos || []} costoHora={costoHora} precio={verPrecios ? precios.get(String(detalle.ot)) : undefined} onClose={() => setDetalle(null)}
          onProyectoActualizado={(p) => setProyectos(prev => prev.map(x => x.id === p.id ? { ...x, ...p } : x))} />
      )}
      <Modal open={!!acciones} onClose={() => setAcciones(null)} title={acciones ? `OT ${acciones.ot}` : ""}>
        {acciones && (
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-[15px] font-bold text-gypi-text">{acciones.cliente || acciones.proyecto || "—"}</div>
              {[acciones.obra || acciones.proyecto, acciones.descripcion].filter(Boolean).length > 0 && (
                <div className="text-[13px] text-gypi-dim mt-0.5">{[acciones.obra || acciones.proyecto, acciones.descripcion].filter(Boolean).join(" · ")}</div>
              )}
              <div className="text-[13px] text-gypi-dim mt-0.5">
                {[acciones.division && nombreDivisionOt(divisionesCtx || [], acciones.division), acciones.fecha_entrega && `Entrega ${fechaCorta(acciones.fecha_entrega)}`, acciones.cantidad != null && `Cantidad ${acciones.cantidad}`].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <BotonOt onClick={() => abrir(setDetalle)}>📊 Detalle</BotonOt>
              <BotonOt onClick={() => abrir(setPiezasOt)}>🧩 Piezas</BotonOt>
              <BotonOt onClick={() => abrir(setSueltos)}>📦 Sueltos</BotonOt>
              <BotonOt onClick={() => abrir(setCarga)}>🚚 Carga</BotonOt>
              <BotonOt onClick={() => abrir(setEtiquetas)}>🏷 Módulos</BotonOt>
              <BotonOt onClick={() => abrir(setActa)}>✍️ Acta</BotonOt>
              <BotonOt tono="cyan" onClick={() => abrir(setModal)}>✏️ Editar</BotonOt>
              {acciones.estado === "activo" ? (
                <BotonOt onClick={() => abrir((p) => cerrarProyecto(p.id))}>Cerrar OT</BotonOt>
              ) : (
                <BotonOt tono="green" onClick={() => abrir((p) => reabrir(p.id))}>Reactivar</BotonOt>
              )}
            </div>
          </div>
        )}
      </Modal>
      {ConfirmDialog}
    </div>
  );
}

/** Botón grande de la ventana de una OT: se toca con guantes y se lee al sol. */
function BotonOt({ children, onClick, tono = "amber" }) {
  const colores = { amber: "bg-gypi-amber/10 text-gypi-amber-ink", cyan: "bg-gypi-cyan/10 text-gypi-cyan", green: "bg-gypi-green/10 text-gypi-green" };
  return (
    <button type="button" onClick={onClick} className={`min-h-[52px] px-3 rounded-xl border-none text-[15px] font-bold cursor-pointer ${colores[tono]}`}>
      {children}
    </button>
  );
}
