import { useState, useEffect, useCallback, useRef } from "react";
import { sb } from "./lib/supabase";
import { Tag, Chip } from "./components/ui";
import { passwordInicial } from "./lib/passwords";
import { getDivisionesConSinAsignar } from "./lib/constants";
import { useAuth } from "./context/AuthContext";
import { useToast } from "./components/ui/Toast";

const ROLES = ["operativo", "gerencial", "administrativo"];
const AREAS = ["produccion", "administracion", "logistica", "diseño"];
const V = {
  amber: "var(--color-empresa-primary, #F97316)",
  green: "#16A34A", red: "#DC2626", cyan: "#0891B2",
  dim: "var(--color-text-dim)", mute: "var(--color-text-muted)",
  surface: "var(--color-surface)", surfLo: "var(--color-surf-lo)",
  border: "var(--color-border)",
  greenS: "rgba(22,163,74,0.10)", redS: "rgba(220,38,38,0.10)",
};

/* ═══ PARSER CSV GENÉRICO ═══ */
function parseEmpleadosCSV(text) {
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
  const iNombre = headers.findIndex(h => h.includes("nombre"));
  const iLegajo = headers.findIndex(h => h.includes("legajo") || h.includes("dni"));
  const iDiv = headers.findIndex(h => h.includes("division") || h.includes("división"));
  const iRol = headers.findIndex(h => h.includes("rol"));
  const iArea = headers.findIndex(h => h.includes("area") || h.includes("área"));
  const iEmail = headers.findIndex(h => h.includes("email") || h.includes("correo"));
  if (iNombre < 0) return [];
  return lines.slice(1).map(line => {
    const c = parseRow(line);
    return {
      nombre: c[iNombre] || "",
      legajo: iLegajo >= 0 ? c[iLegajo] || "" : "",
      division: iDiv >= 0 ? c[iDiv] || "" : "",
      rol: iRol >= 0 ? c[iRol] || "operativo" : "operativo",
      area: iArea >= 0 ? c[iArea] || "produccion" : "produccion",
      email: iEmail >= 0 ? c[iEmail] || "" : "",
    };
  }).filter(r => r.nombre.length > 2);
}

function capitalizarNombre(str) {
  return str.split(" ").filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}
function generarApodo(nombre) {
  const p = nombre.split(" ").filter(Boolean);
  return p.length >= 2 ? p[1] : p[0];
}
function legajoProvisorio() {
  return Math.floor(Date.now() / 1000) % 900000 + 100000;
}

/* ═══ MODAL EMPLEADO ═══ */
function ModalEmpleado({ mode, initialData, divisiones, onClose, onSave, saving }) {
  const [form, setForm] = useState(initialData);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const valid = form.nombre?.trim();
  const titulo = mode === "alta" ? "Alta de empleado" : "Editar empleado";
  const btnLabel = mode === "editar" ? "Guardar cambios" : "Dar de alta";
  const btnColor = mode === "editar" ? V.amber : V.green;

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center" role="dialog" aria-modal="true" aria-label={titulo}>
      <div onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-[460px] bg-gypi-bg rounded-t-[20px] px-[18px] pt-5 pb-[30px] max-h-[85vh] overflow-y-auto border border-gypi-border">
        <div className="w-9 h-1 rounded-sm bg-gypi-mute mx-auto mb-4" aria-hidden="true" />
        <h3 className="m-0 mb-4 font-heading text-lg font-bold text-gypi-text">{titulo}</h3>

        {[["Nombre completo", "nombre"], ["Legajo / DNI", "legajo"], ["Apodo", "apodo"], ["Email", "email"]].map(([label, key]) => (
          <div key={key} className="mb-3">
            <label className="block text-[11px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">{label}</label>
            <input value={form[key] || ""} onChange={e => set(key, e.target.value)} placeholder={key === "legajo" ? "Opcional — se asigna uno provisorio" : ""} className="w-full py-[11px] px-3.5 rounded-[10px] bg-gypi-surface border border-gypi-border text-gypi-text text-sm font-body outline-none box-border" />
          </div>
        ))}

        <div className="grid grid-cols-2 gap-2.5 mb-3">
          <div>
            <label className="block text-[11px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">Área</label>
            <select value={form.area || "produccion"} onChange={e => set("area", e.target.value)} className="w-full py-[11px] px-2.5 rounded-[10px] bg-gypi-surface border border-gypi-border text-gypi-text text-[13px] font-body outline-none box-border cursor-pointer">
              {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">División</label>
            <select value={form.division || ""} onChange={e => set("division", e.target.value)} className="w-full py-[11px] px-2.5 rounded-[10px] bg-gypi-surface border border-gypi-border text-gypi-text text-[13px] font-body outline-none box-border cursor-pointer">
              {divisiones.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </div>
        </div>

        <div className="mb-5">
          <label className="block text-[11px] font-bold text-gypi-dim uppercase tracking-[0.06em] mb-1.5">Rol</label>
          <div className="flex gap-1.5">
            {ROLES.map(r => (
              <button key={r} onClick={() => set("rol", r)} className="flex-1 py-[9px] rounded-[10px] border-none cursor-pointer text-[11px] font-bold font-body" style={{ background: form.rol === r ? `${V.amber}22` : V.surface, color: form.rol === r ? V.amber : V.dim }}>{r}</button>
            ))}
          </div>
        </div>

        {mode === "alta" && (
          <div className="mb-4 p-3 rounded-[10px]" style={{ background: `${V.cyan}10`, border: `1px solid ${V.cyan}30` }}>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={!!form.pre_cargado} onChange={e => set("pre_cargado", e.target.checked)} className="w-[18px] h-[18px] mt-0.5" style={{ accentColor: V.cyan }} />
              <div>
                <div className="text-[13px] font-bold text-gypi-text">Pre-cargar (pendiente de activación)</div>
                <div className="text-[11px] text-gypi-dim mt-0.5">El empleado activa su cuenta con el link de invitación.</div>
              </div>
            </label>
          </div>
        )}

        <button onClick={() => onSave(form)} disabled={!valid || saving} className="w-full py-3.5 rounded-xl border-none text-[15px] font-bold font-heading" style={{ background: valid && !saving ? btnColor : V.surface, color: valid && !saving ? "#000" : V.mute, cursor: valid && !saving ? "pointer" : "default" }}>
          {saving ? "Guardando..." : btnLabel}
        </button>
      </div>
    </div>
  );
}

/* ═══ MODAL CSV PREVIEW ═══ */
function ModalCSVPreview({ filas, empleadosExistentes, divisiones, onClose, onConfirm, saving, progreso }) {
  const legajosExistentes = new Set(empleadosExistentes.map(e => String(e.legajo)));
  const nombresExistentes = new Set(empleadosExistentes.map(e => (e.nombre || "").toUpperCase().trim()));
  const filasConEstado = filas.map(r => {
    const legExiste = r.legajo && legajosExistentes.has(String(r.legajo).trim());
    const nomExiste = nombresExistentes.has(r.nombre.toUpperCase().trim());
    return { ...r, duplicado: legExiste || nomExiste };
  });
  const nuevos = filasConEstado.filter(r => !r.duplicado);
  const duplicados = filasConEstado.filter(r => r.duplicado);

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Vista previa CSV">
      <div onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-[460px] bg-gypi-bg rounded-t-[20px] px-[18px] pt-5 pb-[30px] max-h-[85vh] overflow-y-auto border border-gypi-border">
        <div className="w-9 h-1 rounded-sm bg-gypi-mute mx-auto mb-4" aria-hidden="true" />
        <h3 className="m-0 mb-1 font-heading text-lg font-bold text-gypi-text">Vista previa CSV</h3>
        <p className="text-xs text-gypi-dim mb-3.5">
          <Tag color={V.green}>{nuevos.length} nuevos</Tag> <Tag color={V.mute}>{duplicados.length} duplicados (se omiten)</Tag>
        </p>

        <div className="max-h-[320px] overflow-y-auto mb-3.5 border border-gypi-border rounded-[10px]">
          {filasConEstado.slice(0, 100).map((r, i) => {
            const divInfo = divisiones.find(d => d.id === r.division);
            return (
              <div key={i} className="p-2.5 text-xs" style={{ borderBottom: i < Math.min(filasConEstado.length, 100) - 1 ? `1px solid ${V.border}` : "none", opacity: r.duplicado ? 0.5 : 1 }}>
                <div className="flex gap-2 items-center">
                  <span className="font-mono font-bold min-w-[60px] text-[11px]" style={{ color: r.duplicado ? V.mute : V.green }}>{r.legajo || "auto"}</span>
                  <span className="flex-1 text-gypi-text truncate">{capitalizarNombre(r.nombre)}</span>
                  {divInfo && r.division && <Tag color={divInfo.color || V.cyan}>{divInfo.label}</Tag>}
                  {r.duplicado && <Tag color={V.amber}>dup</Tag>}
                </div>
              </div>
            );
          })}
          {filasConEstado.length > 100 && <div className="p-2.5 text-center text-[11px] text-gypi-mute">+ {filasConEstado.length - 100} más</div>}
        </div>

        {saving && progreso && <div className="p-2.5 rounded-[10px] text-xs mb-2.5 text-center" style={{ background: `${V.amber}15`, color: V.amber }}>{progreso}</div>}

        <div className="flex gap-2">
          <button onClick={onClose} disabled={saving} className="flex-1 py-3 rounded-xl border border-gypi-border bg-transparent text-gypi-dim text-sm font-semibold" style={{ cursor: saving ? "default" : "pointer" }}>Cancelar</button>
          <button onClick={() => onConfirm(nuevos)} disabled={saving || nuevos.length === 0} className="flex-[2] py-3 rounded-xl border-none text-sm font-bold" style={{ background: saving || nuevos.length === 0 ? V.surface : V.green, color: saving || nuevos.length === 0 ? V.dim : "#000", cursor: saving || nuevos.length === 0 ? "default" : "pointer" }}>
            {saving ? "Importando..." : `Importar ${nuevos.length} empleados`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══ MODAL CONFIRMAR BAJA ═══ */
function ModalConfirmarBaja({ empleado, onClose, onConfirm, saving }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Confirmar baja de empleado">
      <div onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-[460px] bg-gypi-bg rounded-t-[20px] px-[18px] pt-5 pb-[30px] border border-gypi-border">
        <div className="w-9 h-1 rounded-sm bg-gypi-mute mx-auto mb-4" aria-hidden="true" />
        <h3 className="m-0 mb-2 font-heading text-lg font-bold text-gypi-text">Confirmar baja</h3>
        <p className="text-sm text-gypi-dim mb-4">
          ¿Dar de baja a <strong className="text-gypi-text">{empleado.nombre}</strong> (L-{empleado.legajo})? Se desactivará su cuenta y no podrá fichar.
        </p>
        <div className="flex gap-2">
          <button onClick={onClose} disabled={saving} className="flex-1 py-3 rounded-xl border border-gypi-border bg-transparent text-gypi-dim text-sm font-semibold" style={{ cursor: saving ? "default" : "pointer" }}>Cancelar</button>
          <button onClick={onConfirm} disabled={saving} className="flex-[2] py-3 rounded-xl border-none text-sm font-bold" style={{ background: saving ? V.surface : V.red, color: saving ? V.dim : "#fff", cursor: saving ? "default" : "pointer" }}>
            {saving ? "Procesando..." : "Dar de baja"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══ MODAL LINK INVITACIÓN ═══ */
function ModalInvitacion({ link, onClose }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Link de invitación">
      <div onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-[460px] bg-gypi-bg rounded-t-[20px] px-[18px] pt-5 pb-[30px] border border-gypi-border">
        <div className="w-9 h-1 rounded-sm bg-gypi-mute mx-auto mb-4" aria-hidden="true" />
        <h3 className="m-0 mb-2 font-heading text-lg font-bold text-gypi-text">Link de invitación</h3>
        <p className="text-xs text-gypi-dim mb-3">Compartí este link con los empleados pre-cargados para que activen su cuenta.</p>
        <div className="bg-gypi-surface border border-gypi-border rounded-[10px] p-3 mb-3 flex items-center gap-2">
          <span className="flex-1 text-xs font-mono text-gypi-text truncate">{link}</span>
          <button onClick={handleCopy} className="px-3 py-1.5 rounded-lg border-none text-xs font-bold cursor-pointer" style={{ background: copied ? V.greenS : `${V.cyan}22`, color: copied ? V.green : V.cyan }}>
            {copied ? "Copiado ✓" : "Copiar"}
          </button>
        </div>
        <button onClick={onClose} className="w-full py-3 rounded-xl border border-gypi-border bg-transparent text-gypi-dim text-sm font-semibold cursor-pointer">Cerrar</button>
      </div>
    </div>
  );
}

/* ═══ MAIN COMPONENT ═══ */
export default function GestionPersonalScreen({ empresaId, slug }) {
  const { divisiones: divisionesCtx } = useAuth();
  const DIVISIONES = getDivisionesConSinAsignar(divisionesCtx);
  const [empleados, setEmpleados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filtroDiv, setFiltroDiv] = useState("todas");
  const [filtroRol, setFiltroRol] = useState("todos");
  const [filtroEstado, setFiltroEstado] = useState("activos");
  const [modalAlta, setModalAlta] = useState(null);
  const [modalEditar, setModalEditar] = useState(null);
  const [modalBaja, setModalBaja] = useState(null);
  const [modalCSV, setModalCSV] = useState(null);
  const [modalInvitacion, setModalInvitacion] = useState(null);
  const [saving, setSaving] = useState(false);
  const [progresoCSV, setProgresoCSV] = useState("");
  const fileRef = useRef(null);
  const toast = useToast();

  /* ── Cargar empleados ── */
  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const data = await sb.get(`empleados?empresa_id=eq.${empresaId}&order=nombre.asc`);
      setEmpleados(data || []);
    } catch (err) {
      console.error("Error cargando empleados:", err);
    } finally {
      setLoading(false);
    }
  }, [empresaId]);

  useEffect(() => { cargar(); }, [cargar]);

  /* ── Filtrado ── */
  const filtrados = empleados.filter(e => {
    if (filtroEstado === "activos" && e.activo === false) return false;
    if (filtroEstado === "inactivos" && e.activo !== false) return false;
    if (filtroDiv !== "todas" && e.division !== filtroDiv) return false;
    if (filtroRol !== "todos" && e.rol !== filtroRol) return false;
    if (search) {
      const q = search.toLowerCase();
      return (e.nombre || "").toLowerCase().includes(q) || String(e.legajo).includes(q) || (e.apodo || "").toLowerCase().includes(q);
    }
    return true;
  });

  /* ── Métricas ── */
  const totalActivos = empleados.filter(e => e.activo !== false).length;
  const totalInactivos = empleados.filter(e => e.activo === false).length;
  const preCargados = empleados.filter(e => e.pre_cargado && e.activo !== false).length;
  const porDiv = {};
  empleados.filter(e => e.activo !== false).forEach(e => {
    const d = e.division || "sin_asignar";
    porDiv[d] = (porDiv[d] || 0) + 1;
  });

  /* ── Alta ── */
  const handleAlta = async (form) => {
    setSaving(true);
    try {
      const nombre = capitalizarNombre(form.nombre.trim());
      const apodo = form.apodo?.trim() || generarApodo(nombre);
      const legajo = form.legajo?.trim() || String(legajoProvisorio());
      const payload = {
        empresa_id: empresaId,
        nombre,
        apodo,
        legajo,
        division: form.division || null,
        rol: form.rol || "operativo",
        area: form.area || "produccion",
        email: form.email?.trim() || null,
        activo: true,
        pre_cargado: !!form.pre_cargado,
        password: passwordInicial(legajo),
      };
      await sb.post("empleados", payload);
      setModalAlta(null);
      cargar();
    } catch (err) {
      console.error("Error en alta:", err);
      toast.error("Error al dar de alta: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  /* ── Editar ── */
  const handleEditar = async (form) => {
    setSaving(true);
    try {
      const nombre = capitalizarNombre(form.nombre.trim());
      const payload = {
        nombre,
        apodo: form.apodo?.trim() || generarApodo(nombre),
        legajo: String(form.legajo ?? "").trim() || form.legajo,
        division: form.division || null,
        rol: form.rol || "operativo",
        area: form.area || "produccion",
        email: form.email?.trim() || null,
      };
      await sb.patch(`empleados?id=eq.${form.id}`, payload);
      setModalEditar(null);
      cargar();
    } catch (err) {
      console.error("Error editando:", err);
      toast.error("Error al editar: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  /* ── Baja ── */
  const handleBaja = async () => {
    if (!modalBaja) return;
    setSaving(true);
    try {
      await sb.patch(`empleados?id=eq.${modalBaja.id}`, { activo: false });
      setModalBaja(null);
      cargar();
    } catch (err) {
      console.error("Error en baja:", err);
      toast.error("Error al dar de baja: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  /* ── CSV import ── */
  const handleCSVFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      const filas = parseEmpleadosCSV(text);
      if (filas.length === 0) {
        toast.error("No se encontraron registros válidos en el CSV. Verificá que tenga al menos una columna 'nombre'.");
        return;
      }
      setModalCSV(filas);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleCSVConfirm = async (nuevos) => {
    setSaving(true);
    let ok = 0;
    try {
      for (let i = 0; i < nuevos.length; i++) {
        const r = nuevos[i];
        setProgresoCSV(`Importando ${i + 1} de ${nuevos.length}...`);
        const nombre = capitalizarNombre(r.nombre.trim());
        const legajo = r.legajo?.trim() || String(legajoProvisorio());
        const payload = {
          empresa_id: empresaId,
          nombre,
          apodo: generarApodo(nombre),
          legajo,
          division: r.division || null,
          rol: r.rol || "operativo",
          area: r.area || "produccion",
          email: r.email?.trim() || null,
          activo: true,
          pre_cargado: true,
          password: passwordInicial(legajo),
        };
        try {
          await sb.post("empleados", payload);
          ok++;
        } catch (err) {
          console.warn(`Error importando ${nombre}:`, err);
        }
      }
      setModalCSV(null);
      setProgresoCSV("");
      cargar();
      if (ok < nuevos.length) toast.warning(`Se importaron ${ok} de ${nuevos.length}. Algunos fallaron (puede haber legajos duplicados).`);
    } catch (err) {
      console.error("Error en importación CSV:", err);
    } finally {
      setSaving(false);
    }
  };

  /* ── Link invitación ── */
  const generarLinkInvitacion = () => {
    const base = typeof window !== "undefined" ? window.location.origin : "";
    setModalInvitacion(`${base}/${slug}/unirse`);
  };

  /* ── Iniciales avatar ── */
  const iniciales = (nombre) => (nombre || "").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();

  /* ═══ RENDER ═══ */
  return (
    <section aria-label="Gestión de personal" className="font-body flex-1 overflow-y-auto px-[18px] pb-[110px]">
      {/* Métricas */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-gypi-surface rounded-[14px] p-3 border border-gypi-border text-center">
          <div className="text-[10px] font-bold text-gypi-dim uppercase tracking-[0.08em]">Activos</div>
          <div className="font-heading text-[26px] font-bold text-gypi-green mt-0.5">{totalActivos}</div>
        </div>
        <div className="bg-gypi-surface rounded-[14px] p-3 border border-gypi-border text-center">
          <div className="text-[10px] font-bold text-gypi-dim uppercase tracking-[0.08em]">Inactivos</div>
          <div className="font-heading text-[26px] font-bold text-gypi-mute mt-0.5">{totalInactivos}</div>
        </div>
        <div className="bg-gypi-surface rounded-[14px] p-3 border border-gypi-border text-center">
          <div className="text-[10px] font-bold text-gypi-dim uppercase tracking-[0.08em]">Pre-carga</div>
          <div className="font-heading text-[26px] font-bold text-gypi-cyan mt-0.5">{preCargados}</div>
        </div>
      </div>

      {/* Filtro división */}
      <div className="flex gap-1.5 mb-2 overflow-x-auto pb-1">
        <Chip active={filtroDiv === "todas"} onClick={() => setFiltroDiv("todas")} color={V.amber}>Todas</Chip>
        {DIVISIONES.map(d => (
          <Chip key={d.id} active={filtroDiv === d.id} onClick={() => setFiltroDiv(d.id)} color={d.color || V.cyan}>
            {d.icon ? `${d.icon} ` : ""}{d.label}
          </Chip>
        ))}
      </div>

      {/* Filtro rol */}
      <div className="flex gap-1.5 mb-2 overflow-x-auto pb-1">
        {[["todos", "Todos", V.dim], ...ROLES.map(r => [r, r, V.amber])].map(([key, label, color]) => (
          <Chip key={`rol-${key}`} active={filtroRol === key} onClick={() => setFiltroRol(key)} color={color}>{label}</Chip>
        ))}
      </div>

      {/* Filtro estado */}
      <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
        {[["activos", "Activos", V.green], ["inactivos", "Inactivos", V.mute], ["todos", "Todos", V.dim]].map(([key, label, color]) => (
          <Chip key={key} active={filtroEstado === key} onClick={() => setFiltroEstado(key)} color={color}>{label}</Chip>
        ))}
      </div>

      {/* Buscador */}
      <div className="mb-3">
        <label htmlFor="search-personal" className="sr-only">Buscar empleado</label>
        <input
          id="search-personal"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nombre, legajo o apodo..."
          className="w-full py-[11px] px-3.5 rounded-[10px] bg-gypi-surface border border-gypi-border text-gypi-text text-sm font-body outline-none box-border"
        />
      </div>

      {/* Botones de acción */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setModalAlta({ nombre: "", legajo: "", apodo: "", email: "", division: "", rol: "operativo", area: "produccion", pre_cargado: false })}
          className="flex-1 py-2.5 rounded-xl border-none text-xs font-bold font-heading cursor-pointer"
          style={{ background: V.green, color: "#000" }}
        >
          + Alta
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="flex-1 py-2.5 rounded-xl border border-gypi-border bg-transparent text-xs font-bold font-heading cursor-pointer text-gypi-text"
        >
          📄 CSV
        </button>
        <button
          onClick={generarLinkInvitacion}
          className="flex-1 py-2.5 rounded-xl border-none text-xs font-bold font-heading cursor-pointer"
          style={{ background: `${V.cyan}22`, color: V.cyan }}
        >
          🔗 Invitar
        </button>
        <input ref={fileRef} type="file" accept=".csv" onChange={handleCSVFile} className="hidden" />
      </div>

      {/* Tip CSV */}
      <div className="text-[10px] text-gypi-mute mb-3 text-center">
        CSV: columnas <span className="font-mono text-gypi-dim">nombre</span> (obligatorio), <span className="font-mono text-gypi-dim">legajo, division, rol, area, email</span> (opcionales)
      </div>

      {/* Lista empleados */}
      {loading && empleados.length === 0 ? (
        <div className="gypi-dots"><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /><span style={{ background: "var(--color-empresa-primary, #F97316)" }} /></div>
      ) : filtrados.length === 0 ? (
        <div className="bg-gypi-surface rounded-2xl p-10 text-center border border-gypi-border">
          <div className="text-[32px] mb-3">👥</div>
          <div className="text-sm font-bold text-gypi-text">Sin resultados</div>
          <div className="text-xs text-gypi-dim mt-1.5">
            {search ? "No se encontraron empleados con ese criterio." : "No hay empleados cargados aún."}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtrados.map(emp => {
            const divInfo = DIVISIONES.find(d => d.id === emp.division);
            const isInactivo = emp.activo === false;
            return (
              <div key={emp.id} className="bg-gypi-surface rounded-[14px] p-3.5 border border-gypi-border" style={{ opacity: isInactivo ? 0.5 : 1 }}>
                <div className="flex items-center gap-2.5">
                  {/* Avatar iniciales */}
                  <div className="w-[38px] h-[38px] rounded-[10px] flex items-center justify-center font-heading text-xs font-bold" style={{
                    background: isInactivo ? V.surfLo : (divInfo?.color ? `${divInfo.color}22` : V.surfLo),
                    color: isInactivo ? V.mute : (divInfo?.color || V.dim),
                  }}>
                    {iniciales(emp.nombre)}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold text-gypi-text truncate">{emp.nombre}</div>
                    <div className="text-[11px] text-gypi-dim mt-px truncate">
                      {divInfo?.label || "Sin división"} · {emp.area || "produccion"} · {emp.rol || "operativo"}
                    </div>
                  </div>

                  {/* Tags */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {divInfo && emp.division && <Tag color={divInfo.color || V.cyan}>{divInfo.label}</Tag>}
                    {emp.pre_cargado && <Tag color={V.cyan}>pre</Tag>}
                    {isInactivo && <Tag color={V.red}>baja</Tag>}
                  </div>
                </div>

                {/* Acciones */}
                {!isInactivo && (
                  <div className="flex gap-2 mt-2.5 pt-2.5 border-t border-gypi-border">
                    <button
                      onClick={() => setModalEditar({ ...emp })}
                      className="flex-1 py-2 rounded-lg border border-gypi-border bg-transparent text-[11px] font-bold text-gypi-dim cursor-pointer"
                    >
                      ✏️ Editar
                    </button>
                    <button
                      onClick={() => setModalBaja(emp)}
                      className="flex-1 py-2 rounded-lg border-none text-[11px] font-bold cursor-pointer"
                      style={{ background: V.redS, color: V.red }}
                    >
                      Dar de baja
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modales */}
      {modalAlta && (
        <ModalEmpleado
          mode="alta"
          initialData={modalAlta}
          divisiones={DIVISIONES}
          onClose={() => setModalAlta(null)}
          onSave={handleAlta}
          saving={saving}
        />
      )}
      {modalEditar && (
        <ModalEmpleado
          mode="editar"
          initialData={modalEditar}
          divisiones={DIVISIONES}
          onClose={() => setModalEditar(null)}
          onSave={handleEditar}
          saving={saving}
        />
      )}
      {modalBaja && (
        <ModalConfirmarBaja
          empleado={modalBaja}
          onClose={() => setModalBaja(null)}
          onConfirm={handleBaja}
          saving={saving}
        />
      )}
      {modalCSV && (
        <ModalCSVPreview
          filas={modalCSV}
          empleadosExistentes={empleados}
          divisiones={DIVISIONES}
          onClose={() => setModalCSV(null)}
          onConfirm={handleCSVConfirm}
          saving={saving}
          progreso={progresoCSV}
        />
      )}
      {modalInvitacion && (
        <ModalInvitacion
          link={modalInvitacion}
          onClose={() => setModalInvitacion(null)}
        />
      )}
    </section>
  );
}
