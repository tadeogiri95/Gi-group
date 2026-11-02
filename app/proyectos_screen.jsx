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
import { estadoOtLista, textoEntrega } from "./lib/otLista";
import { otSinMovimiento, enTandas, DIAS_SIN_MOVIMIENTO } from "./lib/otOrdenar";
import { COLUMNAS_OT, RANGOS_AVANCE, RANGOS_VALOR, estadosPresentes, filasTablaOt, siguienteOrden } from "./lib/otTabla";
import CerrarOtViejas from "./components/CerrarOtViejas";
import { conRegistroTareas } from "./lib/modulos";
import { leerAvanceYHoras } from "./lib/otEnCursoDatos";
import { avancePorOt } from "./lib/piezas";
import { hoyArg } from "./lib/dates";
import { AVISO_DEMORA_GOOGLE, linksPlanilla } from "./lib/csvProyectos";
import { CLAVE_FECHA_OBJETIVO, normalizarModo } from "./lib/semanaObjetivo";
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
export default function ProyectosScreen({ empresaId, onPlanillas = null }) {
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

  // 🔄 Refrescar del Gantt: vuelve a leer las OT sin el cartel de "cargando"
  // (así no se cierra la pantalla completa); el avance se relee solo
  const refrescarOts = useCallback(async () => {
    if (!empresaId) return;
    const { data } = await sbGetAll(`proyectos?empresa_id=eq.${empresaId}&order=created_at.desc,id.desc`, { maxFilas: 20000 });
    setProyectos(data || []);
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
  const filaEnCurso = useMemo(() => new Map((enCurso || []).map(f => [String(f.proyecto.ot), f])), [enCurso]);
  // % de producción por escaneo de cada OT (parte 25)
  const pctEscaneo = useMemo(() => avancePorOt(avanceHoras?.piezas || []), [avanceHoras]);
  // OT activas sin piezas escaneadas hace más de 30 días (auditoría 01/11, PR 6)
  const quietas = useMemo(() => (avanceHoras ? new Set(otSinMovimiento(proyectos, avanceHoras.piezasEscaneo || [], { hoy: hoyArg() }).map((x) => String(x.p.ot))) : null), [avanceHoras, proyectos]);
  const [limpiar, setLimpiar] = useState(false);

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

  // 🧹 Cerrar OT viejas en lote (PR 6): solo el estado en Gypi; la planilla no se toca
  const cerrarVarias = async (ids) => {
    if (!ids.length) return;
    try {
      for (const tanda of enTandas(ids)) await sb.patch(`proyectos?id=in.(${tanda.join(",")})`, { estado: "cerrado" });
      setLimpiar(false);
      await cargar();
      showToast(`${ids.length} OT cerradas`, AMBER);
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

  // Un solo botón a la vista: trae lo nuevo de la planilla (si hay links
  // guardados) y vuelve a cargar la lista. Sin planilla, solo actualiza.
  const sincronizar = async () => {
    if (!syncCfg.url.trim()) { await cargar(); return; }
    setSyncLoading(true);
    try {
      const res = await apiFetch("/api/proyectos/sync-csv", { method: "POST" });
      // Si el servidor se cortó (tardó demasiado) no vuelve JSON
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || "la sincronización no terminó. Esperá un minuto y probá de nuevo");
      // Recién sincronizada por otra persona (menos de 5 minutos): solo actualiza
      if (data.omitido) { await cargar(); setSyncLoading(false); return; }
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
    } catch (e) { showToast(`Error: ${e.message}`, RED); await cargar(); }
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
    if (filtro === "en_curso") { if (!filaEnCurso.has(String(p.ot))) return false; }
    else if (filtro === "quietas") { if (!quietas?.has(String(p.ot))) return false; }
    else if (filtro !== "todos" && p.estado !== filtro) return false;
    if (filtroDiv && p.division !== filtroDiv) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return p.ot?.toLowerCase().includes(q) || p.cliente?.toLowerCase().includes(q) || p.obra?.toLowerCase().includes(q) || p.proyecto?.toLowerCase().includes(q) || p.descripcion?.toLowerCase().includes(q);
    }
    return true;
  });

  // Tabla de la computadora: ordenar y filtrar por columna (Tadeo, 02/11)
  const [ordenTabla, setOrdenTabla] = useState(null);
  const [filtrosTabla, setFiltrosTabla] = useState({});
  const columnasTabla = COLUMNAS_OT.filter((c) => !c.soloPrecios || verPrecios);
  const filasBase = useMemo(() => filtrados.map((p) => {
    const pct = p.estado !== "cerrado" ? pctEscaneo.get(String(p.ot))?.porcentaje ?? null : null;
    return {
      p, pct,
      estado: estadoOtLista(p, { enCurso: filaEnCurso.get(String(p.ot)) || null, porcentaje: pct }),
      entrega: textoEntrega(p, modoObjetivo).replace(/^Entrega /, ""),
      obra: [p.obra || p.proyecto, p.division && nombreDivisionOt(divisionesCtx || [], p.division)].filter(Boolean).join(" · "),
      valor: verPrecios && precios.has(String(p.ot)) ? Number(precios.get(String(p.ot))) : null,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [filtrados, pctEscaneo, filaEnCurso, modoObjetivo, divisionesCtx, verPrecios, precios]);
  const filasTabla = useMemo(() => filasTablaOt(filasBase, { orden: ordenTabla, filtros: filtrosTabla }), [filasBase, ordenTabla, filtrosTabla]);
  const hayFiltrosTabla = Object.values(filtrosTabla).some(Boolean);

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
        pie: "Código QR de la OT.",
      })),
    }).catch(e => showToast(e.message, RED));
  };

  // Abre una pantalla de la OT y cierra la ventana de acciones
  const abrir = (fn) => { const p = acciones; setAcciones(null); fn(p); };

  const activos = proyectos.filter(p => p.estado === "activo").length;
  const cerrados = proyectos.filter(p => p.estado === "cerrado").length;

  return (
    <div className="font-body flex-1 overflow-y-auto px-[18px] pb-[110px] relative">

      {modal && <ModalProyecto initial={modal} divisiones={divisiones} onClose={() => setModal(null)} onSave={guardar} saving={saving} />}
      {csvFilas && <ModalCSVPreview filas={csvFilas} onClose={() => { setCsvFilas(null); setCsvRawText(null); }} onConfirm={importarCSV} saving={saving} progreso={csvProgreso} />}

      {/* Resumen en una línea que también filtra (auditoría 01/11, PR 4: antes
          eran 4 tarjetas grandes y un selector de estado aparte) */}
      <div className="flex items-center gap-x-1 gap-y-1 flex-wrap mb-2.5 text-[14px]" role="group" aria-label="Estado de las OT">
        {[
          { id: "en_curso", texto: `${enCurso ? enCurso.length : "—"} en curso`, fuerte: true },
          { id: "activo", texto: `${activos} activas` },
          { id: "cerrado", texto: `${cerrados} cerradas` },
          { id: "todos", texto: `Todas (${proyectos.length})` },
          quietas?.size > 0 && { id: "quietas", texto: `⏸ ${quietas.size} sin movimiento (${DIAS_SIN_MOVIMIENTO} días)`, fuerte: true },
        ].filter(Boolean).map((f, i) => (
          <span key={f.id} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden="true" className="text-gypi-mute">·</span>}
            <button type="button" onClick={() => setFiltro(f.id)} aria-pressed={filtro === f.id}
              className={`min-h-[36px] px-1.5 rounded-lg border-none bg-transparent cursor-pointer ${filtro === f.id ? "text-gypi-text font-extrabold underline underline-offset-4 decoration-2 decoration-gypi-amber" : f.fuerte ? "text-gypi-amber-ink font-bold" : "text-gypi-dim font-semibold"}`}>
              {f.texto}
            </button>
          </span>
        ))}
        <select value={filtroDiv} onChange={e => setFiltroDiv(e.target.value)} aria-label="División" className="g-input ml-auto !w-auto min-h-[36px] !py-1 text-[14px]">
          <option value="">Todas las divisiones</option>
          {divisiones.filter(d => d.id).map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      </div>

      {filtro === "en_curso" && enCurso && enCurso.length > 0 && (
        <div className="text-xs text-gypi-dim -mt-1 mb-2.5">
          En curso por división: {contarPorDivision(enCurso, divisionesCtx || []).map(d => `${d.nombre} ${d.cantidad}`).join(" · ")}
        </div>
      )}

      {/* Acciones de todos los días: grandes y con texto (revisión de la interfaz, 2026-10) */}
      <div className="flex gap-2 mb-2.5">
        <button onClick={() => setModal({})} className="flex-1 min-h-[48px] rounded-xl border-none bg-gypi-green/15 text-gypi-green text-[15px] font-bold cursor-pointer">+ Nueva OT</button>
        <button onClick={sincronizar} disabled={syncLoading} title={AVISO_DEMORA_GOOGLE} className="flex-1 min-h-[48px] rounded-xl border border-gypi-border bg-gypi-surface text-gypi-text text-[15px] font-bold cursor-pointer disabled:opacity-60">
          {syncLoading ? "Sincronizando…" : "🔄 Actualizar y sincronizar"}
        </button>
      </div>

      {/* Lo que se usa de vez en cuando: CSV, etiquetas, escáner y sincronización */}
      <div className="mb-3">
        <div className="flex gap-2">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 OT, cliente u obra" aria-label="Buscar OT" className="g-input flex-1 min-w-0" />
          <button onClick={() => setMasAcciones(v => !v)} aria-expanded={masAcciones} aria-label="Más acciones"
            className="shrink-0 min-h-[48px] px-3 rounded-xl border border-gypi-border bg-transparent text-gypi-text text-[15px] font-semibold cursor-pointer">
            ⋯ Más
          </button>
        </div>
        {masAcciones && (
          <div className="mt-2 flex flex-col gap-2">
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onCsv} />
            <button onClick={() => fileRef.current?.click()} className="w-full min-h-[48px] rounded-xl border-none bg-gypi-cyan/15 text-gypi-cyan text-[15px] font-bold cursor-pointer">📤 Importar OT desde un CSV</button>
            <button onClick={() => setLimpiar(true)} disabled={!avanceHoras} className="w-full min-h-[48px] rounded-xl border border-gypi-border bg-transparent text-gypi-text text-[15px] font-bold cursor-pointer disabled:opacity-50">🧹 Cerrar OT viejas en lote</button>
            {/* Escáner de OT con la cámara: solo sirve con el registro de tareas
                ("Iniciar tarea"), que GI no usa (auditoría 01/11) */}
            <div className="g-card !p-3 flex flex-col gap-2">
              {conRegistroTareas(empresa) && <div className="flex items-center justify-between gap-2">
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
              </div>}
              <button onClick={imprimirEtiquetas} disabled={!filtrados.some(p => p.ot)} className="g-btn g-btn-secondary text-xs font-bold disabled:opacity-50">
                Imprimir etiquetas QR de las OT de la lista
              </button>
            </div>
            {/* Links de la planilla y script del Plan de trabajo: en Más →
                Planillas conectadas (auditoría 01/11, PR 3) */}
            {onPlanillas && (
              <button onClick={onPlanillas}
                className="w-full py-2 px-3 rounded-[10px] border border-gypi-border bg-transparent text-gypi-dim text-xs font-semibold cursor-pointer flex justify-between items-center">
                <span>🔗 Links de la planilla {syncCfg.url ? "· configurada" : ""}</span>
                <span className="text-xs">Más → Planillas conectadas ›</span>
              </button>
            )}
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
          empresaId={empresaId}
          puedeReordenar={usuario?.rol === "gerencial"}
          puedeAjustar={usuario?.rol === "gerencial" || usuario?.rol === "administrativo"}
          usuarioNombre={usuario?.nombre || null}
          onVerDetalle={setDetalle}
          onRefrescar={refrescarOts}
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
      ) : (<>
        {/* Computadora: tabla con columnas; tocar una fila abre el detalle al costado (auditoría 01/11, PR 5) */}
        <div className="solo-pc">
          <table className="w-full border-collapse text-[13px] bg-gypi-surface rounded-xl overflow-hidden border border-gypi-border" aria-label="Órdenes de trabajo">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gypi-dim">
                {columnasTabla.map((c) => {
                  const dir = ordenTabla?.col === c.id ? ordenTabla.dir : null;
                  return (
                    <th key={c.id} scope="col" aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
                      className={`px-3 py-2.5 font-bold ${c.id === "avance" ? "w-[170px]" : ""} ${c.id === "valor" ? "text-right" : ""}`}>
                      <button type="button" onClick={() => setOrdenTabla((o) => siguienteOrden(o, c.id))}
                        aria-label={`Ordenar por ${c.label}${dir === "asc" ? " (de menor a mayor)" : dir === "desc" ? " (de mayor a menor)" : ""}`}
                        className="bg-transparent border-none p-0 cursor-pointer uppercase tracking-wide font-bold text-xs text-gypi-dim hover:text-gypi-text inline-flex items-center gap-1 min-h-[32px]">
                        {c.label}<span aria-hidden="true" className={dir ? "text-gypi-text" : "opacity-40"}>{dir === "asc" ? "▲" : dir === "desc" ? "▼" : "↕"}</span>
                      </button>
                    </th>
                  );
                })}
                <th scope="col" className="px-3 py-2.5 text-right">
                  {hayFiltrosTabla ? (
                    <button type="button" onClick={() => setFiltrosTabla({})} className="bg-transparent border-none p-0 cursor-pointer text-xs font-semibold text-gypi-cyan normal-case tracking-normal min-h-[32px]">Limpiar filtros</button>
                  ) : <span className="sr-only">Acciones</span>}
                </th>
              </tr>
              <tr className="border-t border-gypi-border">
                {columnasTabla.map((c) => (
                  <td key={c.id} className="px-2 py-1.5">
                    {c.filtro === "texto" ? (
                      <input className="g-input !min-h-[32px] !py-1 !text-xs w-full" aria-label={`Filtrar ${c.label}`} placeholder="Filtrar…"
                        value={filtrosTabla[c.id] || ""} onChange={(e) => setFiltrosTabla((f) => ({ ...f, [c.id]: e.target.value }))} />
                    ) : (
                      <select className="g-input !min-h-[32px] !py-1 !text-xs w-full" aria-label={`Filtrar ${c.label}`}
                        value={filtrosTabla[c.id] || ""} onChange={(e) => setFiltrosTabla((f) => ({ ...f, [c.id]: e.target.value }))}>
                        <option value="">Todos</option>
                        {(c.filtro === "lista" ? estadosPresentes(filasBase).map((t) => ({ id: t, label: t })) : c.filtro === "rango" ? RANGOS_AVANCE : RANGOS_VALOR)
                          .map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                      </select>
                    )}
                  </td>
                ))}
                <td />
              </tr>
            </thead>
            <tbody>
              {filasTabla.length === 0 && (
                <tr className="border-t border-gypi-border"><td colSpan={columnasTabla.length + 1} className="px-3 py-6 text-center text-gypi-dim">Ninguna OT cumple esos filtros.</td></tr>
              )}
              {filasTabla.map(({ p, pct, estado, obra }) => {
                const divInfo = divisiones.find(d => d.id === p.division) || divisiones[0];
                return (
                  <tr key={p.id} onClick={() => setDetalle(p)} className={`border-t border-gypi-border cursor-pointer hover:bg-gypi-bg ${p.estado === "cerrado" ? "opacity-60" : ""}`}>
                    <td className="px-3 py-2.5">
                      <button type="button" onClick={(e) => { e.stopPropagation(); setDetalle(p); }} aria-label={`Ver el detalle de la OT ${p.ot}`}
                        className="bg-transparent border-none p-0 cursor-pointer font-mono text-[14px] font-bold" style={{ color: divInfo.color || AMBER }}>{p.ot}</button>
                    </td>
                    <td className="px-3 py-2.5 max-w-[320px]">
                      <div className="font-bold text-gypi-text truncate">{p.cliente || p.proyecto || "—"}</div>
                      {obra && <div className="text-xs text-gypi-dim truncate">{obra}</div>}
                    </td>
                    <td className="px-3 py-2.5"><Tag color={estado.tono === "amber" ? AMBER : estado.tono === "green" ? GREEN : "var(--color-text-muted)"}>{estado.texto}</Tag></td>
                    <td className="px-3 py-2.5">
                      {pct != null ? (
                        <div className="flex items-center gap-2">
                          <progress max={100} value={Math.min(100, Math.max(0, pct))} aria-hidden="true"
                            className={`flex-1 h-2 rounded-full overflow-hidden appearance-none [&::-webkit-progress-bar]:bg-gypi-border [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-value]:rounded-full ${pct >= 100 ? "[&::-webkit-progress-value]:bg-gypi-green [&::-moz-progress-bar]:bg-gypi-green" : "[&::-webkit-progress-value]:bg-gypi-amber [&::-moz-progress-bar]:bg-gypi-amber"} bg-gypi-border`} />
                          <span className="font-mono text-xs w-10 text-right">{pct} %</span>
                        </div>
                      ) : <span className="text-gypi-mute">—</span>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-gypi-dim">{textoEntrega(p, modoObjetivo).replace(/^Entrega /, "") || "—"}</td>
                    {verPrecios && <td className="px-3 py-2.5 text-right font-mono whitespace-nowrap">{precios.has(String(p.ot)) ? fmtPesos(precios.get(String(p.ot))) : "—"}</td>}
                    <td className="px-2 py-1.5 text-right">
                      <button type="button" onClick={(e) => { e.stopPropagation(); setAcciones(p); }} aria-label={`Acciones de la OT ${p.ot}`}
                        className="min-h-[36px] px-2.5 rounded-lg border border-gypi-border bg-transparent text-gypi-text cursor-pointer font-semibold">⋯</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs text-gypi-dim mt-2 mb-0">
            {filasTabla.length !== filasBase.length ? `${filasTabla.length} de ${filasBase.length} OT. ` : ""}Tocá un título para ordenar (▲ de menor a mayor, ▼ de mayor a menor) y filtrá con las cajas de abajo. Tocá una fila para ver el detalle al costado; con ⋯ están las piezas, la carga, el acta y editar.
          </p>
        </div>
        <div className="solo-cel">
        <div className="lista-ancha flex flex-col gap-2">
          {filtrados.map(p => {
            const divInfo = divisiones.find(d => d.id === p.division) || divisiones[0];
            const divColor = divInfo.color || AMBER;
            // Avance, estado con la etapa y entrega a la vista (auditoría 01/11, PR 4)
            const pct = p.estado !== "cerrado" ? pctEscaneo.get(String(p.ot))?.porcentaje ?? null : null;
            const estado = estadoOtLista(p, { enCurso: filaEnCurso.get(String(p.ot)) || null, porcentaje: pct });
            const entrega = textoEntrega(p, modoObjetivo);
            const obra = [p.obra || p.proyecto, p.division && nombreDivisionOt(divisionesCtx || [], p.division)].filter(Boolean).join(" · ");
            return (
              <button key={p.id} type="button" onClick={() => setAcciones(p)} aria-label={`OT ${p.ot}: ${p.cliente || p.proyecto || "sin cliente"}. ${estado.texto}${pct != null ? `, ${pct} %` : ""}. Ver acciones`}
                className={`g-card !p-3.5 w-full text-left cursor-pointer flex flex-col gap-1 ${p.estado === "cerrado" ? "opacity-60" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[15px] font-bold" style={{ color: divColor }}>{p.ot}</span>
                  <Tag color={estado.tono === "amber" ? AMBER : estado.tono === "green" ? GREEN : "var(--color-text-muted)"}>{estado.texto}</Tag>
                </div>
                <div className="text-[16px] font-bold text-gypi-text overflow-hidden text-ellipsis whitespace-nowrap">{p.cliente || p.proyecto || "—"}</div>
                {obra && <div className="text-[13px] text-gypi-dim overflow-hidden text-ellipsis whitespace-nowrap">{obra}</div>}
                {pct != null && (
                  <progress max={100} value={Math.min(100, Math.max(0, pct))} aria-hidden="true"
                    className={`w-full h-2 mt-1 rounded-full overflow-hidden appearance-none [&::-webkit-progress-bar]:bg-gypi-border [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-value]:rounded-full ${pct >= 100 ? "[&::-webkit-progress-value]:bg-gypi-green [&::-moz-progress-bar]:bg-gypi-green" : "[&::-webkit-progress-value]:bg-gypi-amber [&::-moz-progress-bar]:bg-gypi-amber"} bg-gypi-border`} />
                )}
                {(pct != null || entrega || (verPrecios && precios.has(String(p.ot)))) && (
                  <div className="flex items-center justify-between gap-2 text-[13px] text-gypi-dim">
                    <span>{pct != null ? `🧩 ${pct} %` : ""}{verPrecios && precios.has(String(p.ot)) ? `${pct != null ? " · " : ""}${fmtPesos(precios.get(String(p.ot)))}` : ""}</span>
                    <span className="whitespace-nowrap">{entrega}</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
        </div>
      </>)}
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
        <DetalleOp proyecto={detalle} empresaId={empresaId} etapas={etapasCtx || []} divisiones={divisionesCtx || []} causas={causasParada || []} defectos={defectos || []} costoHora={costoHora} precio={verPrecios ? precios.get(String(detalle.ot)) : undefined}
          modoObjetivo={modoObjetivo} puedeCambiarSemana={usuario?.rol === "gerencial" || usuario?.rol === "administrativo"} onClose={() => setDetalle(null)}
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
      {limpiar && (
        <CerrarOtViejas abierto={limpiar} proyectos={proyectos} piezas={avanceHoras?.piezasEscaneo || []} hoy={hoyArg()}
          onCerrar={cerrarVarias} onClose={() => setLimpiar(false)} />
      )}
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
