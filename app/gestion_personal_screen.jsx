import { useState, useEffect, useCallback, useRef } from "react";
import { sb, apiFetch } from "./lib/supabase";
import { imprimirTarjetas, linkPersonal } from "./lib/tarjetasQR";
import { activarKiosco } from "./lib/kioscoCliente";
import { Tag, Chip } from "./components/ui";
import { getDivisionesConSinAsignar } from "./lib/constants";
import { useAuth } from "./context/AuthContext";
import { ordenarPlantas, nombrePlanta } from "./lib/plantas";
import { useToast } from "./components/ui/Toast";

const ROLES = ["operativo", "gerencial", "administrativo"];
const AREAS = ["produccion", "administracion", "logistica", "diseño"];

const AMBER = "var(--color-empresa-primary, #F97316)";
const GREEN = "#16A34A";
const RED   = "#DC2626";
const CYAN  = "#0891B2";

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
function ModalEmpleado({ mode, initialData, divisiones, onClose, onSave, saving, rolesPermitidos = ROLES, puedeMarcarSupervisor = false, divisionBloqueada = false, plantas = [] }) {
  const [form, setForm] = useState(initialData);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const valid = form.nombre?.trim();
  const titulo = mode === "alta" ? "Alta de empleado" : "Editar empleado";
  const btnLabel = mode === "editar" ? "Guardar cambios" : "Dar de alta";
  const btnColor = mode === "editar" ? AMBER : GREEN;

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center" role="dialog" aria-modal="true" aria-label={titulo}>
      <div onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-[460px] bg-gypi-bg rounded-t-[20px] px-[18px] pt-5 pb-[30px] max-h-[85vh] overflow-y-auto border border-gypi-border">
        <div className="w-9 h-1 rounded-sm bg-gypi-mute mx-auto mb-4" aria-hidden="true" />
        <h3 className="m-0 mb-4 font-heading text-lg font-bold text-gypi-text">{titulo}</h3>

        {[["Nombre completo", "nombre"], ["Legajo / DNI", "legajo"], ["Apodo", "apodo"], ["Email", "email"]].map(([label, key]) => {
          // El legajo identifica las fichadas históricas — no se edita una vez creado.
          const bloqueado = key === "legajo" && mode === "editar";
          return (
            <div key={key} className="mb-3">
              <label className="g-label block mb-1.5">{label}{bloqueado ? " (no editable)" : ""}</label>
              <input value={form[key] || ""} onChange={e => set(key, e.target.value)} disabled={bloqueado} placeholder={key === "legajo" ? "Opcional — se asigna uno provisorio" : ""} className="g-input" style={bloqueado ? { opacity: 0.5, cursor: "not-allowed" } : undefined} />
            </div>
          );
        })}

        <div className="grid grid-cols-2 gap-2.5 mb-3">
          <div>
            <label className="g-label block mb-1.5">Area</label>
            <select value={form.area || "produccion"} onChange={e => set("area", e.target.value)} className="g-input cursor-pointer text-[13px]">
              {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="g-label block mb-1.5">Division{divisionBloqueada ? " (la tuya)" : ""}</label>
            <select value={form.division || ""} onChange={e => set("division", e.target.value)} disabled={divisionBloqueada} className="g-input cursor-pointer text-[13px] disabled:opacity-60">
              {divisiones.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </div>
        </div>

        {/* Planta (ítem 36): solo se pregunta cuando la empresa tiene más de una */}
        {plantas.length > 1 && (
          <div className="mb-3">
            <label htmlFor="empleado-planta" className="g-label block mb-1.5">¿En qué planta trabaja?{divisionBloqueada ? " (la elige el dueño)" : ""}</label>
            <select id="empleado-planta" value={form.planta_id || plantas[0].id} onChange={e => set("planta_id", e.target.value)} disabled={divisionBloqueada} className="g-input cursor-pointer text-[13px] disabled:opacity-60">
              {plantas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
        )}

        <div className="mb-5">
          <label className="g-label block mb-1.5">Rol</label>
          <div className="flex gap-1.5">
            {rolesPermitidos.map(r => (
              <button key={r} onClick={() => set("rol", r)} className="flex-1 py-[9px] rounded-[10px] border-none cursor-pointer text-[11px] font-bold font-body" style={{ background: form.rol === r ? `color-mix(in srgb, ${AMBER} 13%, transparent)` : "var(--color-surface)", color: form.rol === r ? AMBER : "var(--color-text-dim)" }}>{r}</button>
            ))}
          </div>
        </div>

        {/* Supervisor de división (D2): solo el dueño lo marca. Si la migración 075
            no se corrió, el dato no viene y la casilla no aparece. */}
        {mode === "editar" && puedeMarcarSupervisor && form.rol === "administrativo" && initialData.solo_su_division !== undefined && (
          <div className="mb-4 p-3 rounded-[10px] bg-gypi-surface border border-gypi-border">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={!!form.solo_su_division} onChange={e => set("solo_su_division", e.target.checked)} className="w-[18px] h-[18px] mt-0.5" />
              <div>
                <div className="text-[13px] font-bold text-gypi-text">Ve solo su división (supervisor)</div>
                <div className="text-[11px] text-gypi-dim mt-0.5">Solo va a ver y gestionar a los empleados de su división. Sin marcar, ve toda la empresa.</div>
              </div>
            </label>
          </div>
        )}

        {mode === "alta" && (
          <div className="mb-4 p-3 rounded-[10px]" style={{ background: `${CYAN}10`, border: `1px solid ${CYAN}30` }}>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={!!form.pre_cargado} onChange={e => set("pre_cargado", e.target.checked)} className="w-[18px] h-[18px] mt-0.5" style={{ accentColor: CYAN }} />
              <div>
                <div className="text-[13px] font-bold text-gypi-text">Pre-cargar (pendiente de activacion)</div>
                <div className="text-[11px] text-gypi-dim mt-0.5">El empleado activa su cuenta con el link de invitacion.</div>
              </div>
            </label>
          </div>
        )}

        <button onClick={() => onSave(form)} disabled={!valid || saving} className="w-full py-3.5 rounded-xl border-none text-[15px] font-bold font-heading" style={{ background: valid && !saving ? btnColor : "var(--color-surface)", color: valid && !saving ? "#000" : "var(--color-text-muted)", cursor: valid && !saving ? "pointer" : "default" }}>
          {saving ? "Guardando..." : btnLabel}
        </button>
      </div>
    </div>
  );
}

/* ═══ MODAL CSV PREVIEW ═══ */
function ModalCSVPreview({ filas, divisiones, onClose, onConfirm, saving, progreso }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Vista previa CSV">
      <div onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-[460px] bg-gypi-bg rounded-t-[20px] px-[18px] pt-5 pb-[30px] max-h-[85vh] overflow-y-auto border border-gypi-border">
        <div className="w-9 h-1 rounded-sm bg-gypi-mute mx-auto mb-4" aria-hidden="true" />
        <h3 className="m-0 mb-1 font-heading text-lg font-bold text-gypi-text">Vista previa CSV</h3>
        <p className="text-xs text-gypi-dim mb-3.5">{filas.length} empleados detectados. Revisá y confirmá.</p>

        <div className="max-h-[320px] overflow-y-auto mb-3.5 border border-gypi-border rounded-[10px]">
          {filas.slice(0, 100).map((r, i) => {
            const divInfo = divisiones.find(d => d.id === r.division);
            const sinLegajo = !/^\d+$/.test(String(r.legajo || "").trim());
            return (
              <div key={i} className="p-2.5 text-xs" style={{ borderBottom: i < Math.min(filas.length, 100) - 1 ? "1px solid var(--color-border)" : "none" }}>
                <div className="flex gap-2 items-center">
                  <span className="font-mono font-bold min-w-[60px] text-[11px]" style={{ color: sinLegajo ? RED : GREEN }}>{r.legajo || "sin legajo"}</span>
                  <span className="flex-1 text-gypi-text truncate">{capitalizarNombre(r.nombre)}</span>
                  {divInfo && r.division && <Tag color={divInfo.color || CYAN}>{divInfo.label}</Tag>}
                  {sinLegajo && <Tag color={RED}>sin legajo</Tag>}
                </div>
              </div>
            );
          })}
          {filas.length > 100 && <div className="p-2.5 text-center text-[11px] text-gypi-mute">+ {filas.length - 100} mas</div>}
        </div>

        {saving && progreso && <div className="p-2.5 rounded-[10px] text-xs mb-2.5 text-center" style={{ background: `color-mix(in srgb, ${AMBER} 8%, transparent)`, color: AMBER }}>{progreso}</div>}

        <div className="flex gap-2">
          <button onClick={onClose} disabled={saving} className="g-btn g-btn-secondary flex-1" style={{ cursor: saving ? "default" : "pointer" }}>Cancelar</button>
          <button onClick={onConfirm} disabled={saving} className="flex-[2] py-3 rounded-xl border-none text-sm font-bold" style={{ background: saving ? "var(--color-surface)" : GREEN, color: saving ? "var(--color-text-dim)" : "#000", cursor: saving ? "default" : "pointer" }}>
            {saving ? "Importando..." : `Importar ${filas.length} empleados`}
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
          Dar de baja a <strong className="text-gypi-text">{empleado.nombre}</strong> (L-{empleado.legajo})? Se desactivara su cuenta y no podra fichar.
        </p>
        <div className="flex gap-2">
          <button onClick={onClose} disabled={saving} className="g-btn g-btn-secondary flex-1" style={{ cursor: saving ? "default" : "pointer" }}>Cancelar</button>
          <button onClick={onConfirm} disabled={saving} className="flex-[2] py-3 rounded-xl border-none text-sm font-bold" style={{ background: saving ? "var(--color-surface)" : RED, color: saving ? "var(--color-text-dim)" : "#fff", cursor: saving ? "default" : "pointer" }}>
            {saving ? "Procesando..." : "Dar de baja"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══ MODAL CÓDIGOS DE ACCESO ═══ */
// Muestra los códigos de activación recién generados. Se ven UNA sola vez:
// el servidor guarda solo el hash. El empleado los usa en /{slug}/unirse.
function textoCodigo(c, vigencia) {
  return `Hola ${c.nombre}! Para entrar a Gypi abrí este link y creá tu contraseña: ${c.link || ""}\nTu código: ${c.codigo} (vence en ${vigencia} días)`;
}

function ModalCodigos({ codigos, vigencia, empresa, onClose }) {
  const [copiado, setCopiado] = useState(null);
  const copiar = (clave, texto) => {
    navigator.clipboard?.writeText(texto).then(() => {
      setCopiado(clave);
      setTimeout(() => setCopiado(null), 2000);
    }).catch(() => {});
  };
  const todos = codigos.map(c => `${c.legajo} · ${c.nombre} · ${c.codigo}${c.link ? ` · ${c.link}` : ""}`).join("\n");
  const [errorQR, setErrorQR] = useState("");
  // Tarjetas con el QR del link de activación (ítem 18): escanear = abrir el link con el código
  const conLink = codigos.filter(c => c.link);
  const imprimirQR = () => {
    setErrorQR("");
    imprimirTarjetas({
      titulo: "Códigos de acceso",
      empresa: empresa?.nombre_corto || empresa?.nombre || "",
      tarjetas: conLink.map(c => ({
        nombre: c.nombre,
        detalle: `Legajo ${c.legajo} · Código ${c.codigo}`,
        link: c.link,
        pie: `Escaneá con la cámara del celular y creá tu contraseña. Sirve una vez y vence en ${vigencia} días.`,
      })),
    }).catch(e => setErrorQR(e.message));
  };
  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Códigos de acceso">
      <div onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-[460px] max-h-[85dvh] overflow-y-auto bg-gypi-bg rounded-t-[20px] px-[18px] pt-5 pb-[30px] border border-gypi-border">
        <div className="w-9 h-1 rounded-sm bg-gypi-mute mx-auto mb-4" aria-hidden="true" />
        <h3 className="m-0 mb-2 font-heading text-lg font-bold text-gypi-text">
          {codigos.length === 1 ? "Código de acceso" : `Códigos de acceso (${codigos.length})`}
        </h3>
        <p className="text-xs text-gypi-dim mb-3">
          Entregá cada código a su empleado (en mano o por WhatsApp). Con el link y el código crea su contraseña.
          Sirve una sola vez y vence en {vigencia} días. <b>Anotalos ahora: no se pueden volver a ver</b>; si se pierde, generá uno nuevo.
        </p>
        <div className="flex flex-col gap-2 mb-3">
          {codigos.map((c, i) => (
            <div key={`${c.legajo}-${i}`} className="bg-gypi-surface border border-gypi-border rounded-[10px] p-3">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gypi-dim truncate">{c.legajo} · {c.nombre}</div>
                  <div className="font-mono text-lg font-bold tracking-[0.15em] text-gypi-text">{c.codigo}</div>
                </div>
                <button onClick={() => copiar(i, textoCodigo(c, vigencia))} className="px-3 py-1.5 rounded-lg border-none text-xs font-bold cursor-pointer" style={{ background: copiado === i ? "rgba(22,163,74,0.10)" : `${CYAN}22`, color: copiado === i ? GREEN : CYAN }}>
                  {copiado === i ? "Copiado" : "Copiar"}
                </button>
                <a href={`https://wa.me/?text=${encodeURIComponent(textoCodigo(c, vigencia))}`} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 rounded-lg text-xs font-bold no-underline" style={{ background: "rgba(22,163,74,0.10)", color: GREEN }}>
                  WhatsApp
                </a>
              </div>
            </div>
          ))}
        </div>
        {conLink.length > 0 && (
          <button onClick={imprimirQR} className="g-btn g-btn-secondary w-full mb-2">
            {conLink.length === 1 ? "Imprimir tarjeta con QR" : `Imprimir tarjetas con QR (${conLink.length})`}
          </button>
        )}
        {errorQR && <div role="alert" className="text-xs text-gypi-red mb-2">{errorQR}</div>}
        {codigos.length > 1 && (
          <button onClick={() => copiar("todos", todos)} className="g-btn g-btn-secondary w-full mb-2">
            {copiado === "todos" ? "Copiados" : "Copiar todos"}
          </button>
        )}
        <button onClick={onClose} className="g-btn g-btn-secondary w-full">Cerrar</button>
      </div>
    </div>
  );
}

/* ═══ MAIN COMPONENT ═══ */
export default function GestionPersonalScreen({ empresaId }) {
  const { divisiones: divisionesCtx, usuario: sesion, empresa, plantas: plantasCtx } = useAuth();
  const plantas = ordenarPlantas(plantasCtx);
  // Un administrativo no puede crear/asignar rol gerencial (misma regla que /api/empleados)
  // Supervisor de división (D2): da de alta solo operarios de su división y no cambia divisiones
  const soySupervisor = sesion?.rol === "administrativo" && !!sesion?.solo_su_division;
  const rolesPermitidos = sesion?.rol === "gerencial" ? ROLES : soySupervisor ? ["operativo"] : ROLES.filter(r => r !== "gerencial");
  const DIVISIONES = getDivisionesConSinAsignar(divisionesCtx);
  const [empleados, setEmpleados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filtroDiv, setFiltroDiv] = useState("todas");
  const [filtroRol, setFiltroRol] = useState("todos");
  const [filtroPlanta, setFiltroPlanta] = useState("todas");
  const [filtroEstado, setFiltroEstado] = useState("activos");
  const [modalAlta, setModalAlta] = useState(null);
  const [modalEditar, setModalEditar] = useState(null);
  const [modalBaja, setModalBaja] = useState(null);
  const [modalCSV, setModalCSV] = useState(null);
  const [modalCodigos, setModalCodigos] = useState(null); // { codigos: [...], vigencia }
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [progresoCSV, setProgresoCSV] = useState("");
  const [csvRawText, setCsvRawText] = useState(null);
  const fileRef = useRef(null);
  const toast = useToast();

  /* ── Cargar empleados ── */
  const cargar = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await sb.get(`empleados?empresa_id=eq.${empresaId}&order=nombre.asc`);
      setEmpleados(data || []);
    } catch (err) {
      console.error("Error cargando empleados:", err);
      setLoadError("No se pudo cargar el personal. Tocá para reintentar.");
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
    if (filtroPlanta !== "todas" && e.planta_id !== filtroPlanta) return false;
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

  /* ── Tarjetas con QR personal (ítem 18) ── */
  // Escanear abre el ingreso con PIN y el legajo cargado: solo operarios activos de la lista filtrada
  const operariosParaQR = filtrados.filter(e => e.activo !== false && e.rol === "operativo");
  const imprimirQRPersonales = () => {
    if (!empresa?.slug || operariosParaQR.length === 0) return;
    imprimirTarjetas({
      titulo: "Tarjetas de ingreso",
      empresa: empresa.nombre_corto || empresa.nombre || "",
      tarjetas: operariosParaQR.map(e => ({
        nombre: e.nombre,
        detalle: `Legajo ${e.legajo}`,
        link: linkPersonal(window.location.origin, empresa.slug, e.legajo),
        pie: "Escaneá con la cámara y poné tu PIN. ¿Sin PIN? Entrá con tu contraseña y crealo en el inicio.",
      })),
    }).catch(e => toast.error(e.message));
  };

  /* ── Modo kiosco (ítem 19) ── */
  // Este dispositivo pasa a ser un punto de fichaje: se cierra la sesión del
  // gerente acá (si no, cualquiera podría usarla) y se abre el kiosco.
  const activarKioscoAqui = async () => {
    if (!empresa?.slug) return;
    if (!window.confirm("Este dispositivo va a quedar como kiosco de fichaje y se va a cerrar tu sesión en él. ¿Seguir?")) return;
    try {
      await activarKiosco();
      await apiFetch("/api/logout", { method: "POST" }).catch(() => {});
      try { sessionStorage.removeItem("gi-session"); } catch {}
      window.location.href = `/${empresa.slug}/kiosco`;
    } catch (e) {
      toast.error(e.message);
    }
  };

  /* ── Alta ── */
  // Va por POST /api/empleados (no /api/data): hashea la contraseña inicial
  // server-side, valida legajo único (409), respeta el límite del plan,
  // registra auditoría y manda el email de invitación si corresponde.
  const handleAlta = async (form) => {
    setSaving(true);
    try {
      const nombre = capitalizarNombre(form.nombre.trim());
      const res = await apiFetch("/api/empleados", {
        method: "POST",
        body: JSON.stringify({
          nombre,
          apodo: form.apodo?.trim() || generarApodo(nombre),
          legajo: form.legajo?.trim() || String(legajoProvisorio()),
          division: form.division || null,
          rol: form.rol || "operativo",
          area: form.area || "produccion",
          email: form.email?.trim() || null,
          pre_cargado: !!form.pre_cargado,
          ...(plantas.length > 1 && form.planta_id ? { planta_id: form.planta_id } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setModalAlta(null);
      if (data.activacion?.codigo) {
        setModalCodigos({
          codigos: [{ nombre: data.nombre, legajo: data.legajo, codigo: data.activacion.codigo, link: data.activacion.link }],
          vigencia: data.activacion.vigencia_dias,
        });
      }
      cargar();
    } catch (err) {
      console.error("Error en alta:", err);
      toast.error("Error al dar de alta: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  /* ── Editar ── */
  // PATCH /api/empleados valida pertenencia a la empresa y solo permite
  // cambiar rol a usuarios gerenciales. El legajo no se edita (identifica
  // las fichadas históricas).
  const handleEditar = async (form) => {
    setSaving(true);
    try {
      const nombre = capitalizarNombre(form.nombre.trim());
      const res = await apiFetch(`/api/empleados?id=${encodeURIComponent(form.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          nombre,
          apodo: form.apodo?.trim() || generarApodo(nombre),
          division: form.division || null,
          rol: form.rol || "operativo",
          area: form.area || "produccion",
          email: form.email?.trim() || null,
          ...(plantas.length > 1 && form.planta_id && !soySupervisor ? { planta_id: form.planta_id } : {}),
          ...(sesion?.rol === "gerencial" && form.solo_su_division !== undefined
            ? { solo_su_division: form.rol === "administrativo" && !!form.solo_su_division }
            : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
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
  // DELETE /api/empleados hace el soft-delete con auditoría y bloquea
  // desactivarse a uno mismo.
  const handleBaja = async () => {
    if (!modalBaja) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/empleados?id=${encodeURIComponent(modalBaja.id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
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
      setCsvRawText(text);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleCSVConfirm = async () => {
    if (!csvRawText) return;
    setSaving(true);
    setProgresoCSV(`Importando ${modalCSV.length} empleados...`);
    try {
      const res = await apiFetch("/api/empleados/import-csv", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: csvRawText,
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Error al importar");

      const erroresTxt = data.errors?.length ? ` · ${data.errors.length} con error` : "";
      if (data.errors?.length) console.warn("Errores import CSV empleados:", data.errors);
      if (data.created > 0) {
        toast.success(`${data.created} importados · ${data.skipped} duplicados${erroresTxt}`);
      } else {
        toast.info(`0 importados · ${data.skipped} duplicados${erroresTxt}`);
      }
      if (data.activaciones?.length) {
        setModalCodigos({ codigos: data.activaciones, vigencia: data.vigencia_dias });
      }
    } catch (err) {
      console.error("Error en importación CSV:", err);
      toast.error("Error al importar: " + err.message);
    }
    setProgresoCSV("");
    setModalCSV(null);
    setCsvRawText(null);
    setSaving(false);
    await cargar();
  };

  /* ── Código de acceso ── */
  // Genera un código nuevo (invalida el anterior). Sirve para reenviar la
  // activación o para recuperar el acceso de quien no tiene email.
  // Un administrativo solo puede hacerlo para operativos (lo valida el server).
  const puedeGenerarCodigo = (emp) =>
    emp.id !== sesion?.id && (sesion?.rol === "gerencial" || (emp.rol || "operativo") === "operativo");

  const generarCodigo = async (emp) => {
    setSaving(true);
    try {
      const res = await apiFetch("/api/empleados/activacion", {
        method: "POST",
        body: JSON.stringify({ empleado_id: emp.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setModalCodigos({
        codigos: [{ nombre: data.nombre, legajo: data.legajo, codigo: data.activacion.codigo, link: data.activacion.link }],
        vigencia: data.activacion.vigencia_dias,
      });
    } catch (err) {
      toast.error("No se pudo generar el código: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  /* ── Iniciales avatar ── */
  const iniciales = (nombre) => (nombre || "").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();

  /* ═══ RENDER ═══ */
  return (
    <section aria-label="Gestión de personal" className="font-body flex-1 overflow-y-auto px-[18px] pb-[110px]">
      {/* Métricas */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="g-card text-center">
          <div className="g-overline">Activos</div>
          <div className="font-heading text-[26px] font-bold text-gypi-green mt-0.5">{totalActivos}</div>
        </div>
        <div className="g-card text-center">
          <div className="g-overline">Inactivos</div>
          <div className="font-heading text-[26px] font-bold text-gypi-mute mt-0.5">{totalInactivos}</div>
        </div>
        <div className="g-card text-center">
          <div className="g-overline">Pre-carga</div>
          <div className="font-heading text-[26px] font-bold text-gypi-cyan mt-0.5">{preCargados}</div>
        </div>
      </div>

      {/* Filtro planta: solo con más de una (ítem 36) */}
      {plantas.length > 1 && (
        <div className="flex gap-1.5 mb-2 overflow-x-auto pb-1" aria-label="Filtrar por planta">
          <Chip active={filtroPlanta === "todas"} onClick={() => setFiltroPlanta("todas")} color={AMBER}>Todas las plantas</Chip>
          {plantas.map(p => (
            <Chip key={p.id} active={filtroPlanta === p.id} onClick={() => setFiltroPlanta(p.id)} color={CYAN}>🏭 {p.nombre}</Chip>
          ))}
        </div>
      )}

      {/* Filtro división */}
      <div className="flex gap-1.5 mb-2 overflow-x-auto pb-1">
        <Chip active={filtroDiv === "todas"} onClick={() => setFiltroDiv("todas")} color={AMBER}>Todas</Chip>
        {DIVISIONES.map(d => (
          <Chip key={d.id} active={filtroDiv === d.id} onClick={() => setFiltroDiv(d.id)} color={d.color || CYAN}>
            {d.icon ? `${d.icon} ` : ""}{d.label}
          </Chip>
        ))}
      </div>

      {/* Filtro rol */}
      <div className="flex gap-1.5 mb-2 overflow-x-auto pb-1">
        {[["todos", "Todos", "var(--color-text-dim)"], ...ROLES.map(r => [r, r, AMBER])].map(([key, label, color]) => (
          <Chip key={`rol-${key}`} active={filtroRol === key} onClick={() => setFiltroRol(key)} color={color}>{label}</Chip>
        ))}
      </div>

      {/* Filtro estado */}
      <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
        {[["activos", "Activos", GREEN], ["inactivos", "Inactivos", "var(--color-text-muted)"], ["todos", "Todos", "var(--color-text-dim)"]].map(([key, label, color]) => (
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
          className="g-input"
        />
      </div>

      {/* Botones de acción */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setModalAlta({ nombre: "", legajo: "", apodo: "", email: "", division: "", rol: "operativo", area: "produccion", pre_cargado: false })}
          className="flex-1 py-2.5 rounded-xl border-none text-xs font-bold font-heading cursor-pointer"
          style={{ background: GREEN, color: "#000" }}
        >
          + Alta
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="g-btn g-btn-secondary flex-1 text-xs font-bold font-heading"
        >
          CSV
        </button>
        <input ref={fileRef} type="file" accept=".csv" onChange={handleCSVFile} className="hidden" />
        <button
          onClick={imprimirQRPersonales}
          disabled={operariosParaQR.length === 0 || !empresa?.slug}
          title="Imprimir una tarjeta con QR por operario (los de la lista filtrada)"
          className="g-btn g-btn-secondary flex-1 text-xs font-bold font-heading disabled:opacity-50"
        >
          Tarjetas QR
        </button>
      </div>

      {/* Modo kiosco */}
      <div className="g-card !p-3 mb-3 flex items-center justify-between gap-2">
        <div className="text-xs text-gypi-dim">
          <b className="text-gypi-text">Modo kiosco:</b> usá este dispositivo como punto de fichaje en la entrada (tarjeta QR o legajo + PIN).
        </div>
        <button onClick={activarKioscoAqui} disabled={!empresa?.slug} className="g-btn g-btn-secondary text-xs font-bold font-heading shrink-0 disabled:opacity-50">
          Activar acá
        </button>
      </div>

      {/* Tip CSV */}
      <div className="text-xs text-gypi-mute mb-3 text-center">
        CSV: columnas <span className="font-mono text-gypi-dim">legajo, nombre</span> (obligatorias), <span className="font-mono text-gypi-dim">division, rol, area, email</span> (opcionales)
      </div>

      {/* Lista empleados */}
      {loadError ? (
        <button onClick={cargar} className="w-full g-card text-center p-8 cursor-pointer border border-gypi-red/30">
          <div className="text-sm font-bold text-gypi-red">⚠ {loadError}</div>
        </button>
      ) : loading && empleados.length === 0 ? (
        <div className="gypi-dots"><span style={{ background: AMBER }} /><span style={{ background: AMBER }} /><span style={{ background: AMBER }} /></div>
      ) : filtrados.length === 0 ? (
        <div className="g-card text-center p-10">
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
              <div key={emp.id} className="g-card" style={{ opacity: isInactivo ? 0.5 : 1 }}>
                <div className="flex items-center gap-2.5">
                  {/* Avatar iniciales */}
                  <div className="w-[38px] h-[38px] rounded-[10px] flex items-center justify-center font-heading text-xs font-bold" style={{
                    background: isInactivo ? "var(--color-surf-lo)" : (divInfo?.color ? `${divInfo.color}22` : "var(--color-surf-lo)"),
                    color: isInactivo ? "var(--color-text-muted)" : (divInfo?.color || "var(--color-text-dim)"),
                  }}>
                    {iniciales(emp.nombre)}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold text-gypi-text truncate">{emp.nombre}</div>
                    <div className="text-[11px] text-gypi-dim mt-px truncate">
                      {divInfo?.label || "Sin división"} · {emp.area || "produccion"} · {emp.rol || "operativo"}
                      {plantas.length > 1 && nombrePlanta(plantas, emp.planta_id) ? ` · 🏭 ${nombrePlanta(plantas, emp.planta_id)}` : ""}
                    </div>
                  </div>

                  {/* Tags */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {divInfo && emp.division && <Tag color={divInfo.color || CYAN}>{divInfo.label}</Tag>}
                    {emp.pre_cargado && <Tag color={CYAN}>pre</Tag>}
                    {emp.estado_activacion === "pendiente_activacion" && !isInactivo && <Tag color={AMBER}>sin activar</Tag>}
                    {isInactivo && <Tag color={RED}>baja</Tag>}
                  </div>
                </div>

                {/* Acciones */}
                {!isInactivo && (
                  <div className="flex gap-2 mt-2.5 pt-2.5 border-t border-gypi-border">
                    <button
                      onClick={() => setModalEditar({ ...emp })}
                      className="g-btn g-btn-secondary flex-1 text-[11px]"
                    >
                      Editar
                    </button>
                    {puedeGenerarCodigo(emp) && (
                      <button
                        onClick={() => generarCodigo(emp)}
                        disabled={saving}
                        className="g-btn g-btn-secondary flex-1 text-[11px]"
                        title="Genera un código nuevo para activar la cuenta o recuperar el acceso"
                      >
                        Código de acceso
                      </button>
                    )}
                    <button
                      onClick={() => setModalBaja(emp)}
                      className="g-btn g-btn-danger flex-1 text-[11px]"
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
          initialData={soySupervisor ? { ...modalAlta, division: sesion.division || "" } : modalAlta}
          divisiones={DIVISIONES}
          divisionBloqueada={soySupervisor}
          rolesPermitidos={rolesPermitidos}
          plantas={plantas}
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
          puedeMarcarSupervisor={sesion?.rol === "gerencial"}
          divisionBloqueada={soySupervisor}
          rolesPermitidos={rolesPermitidos}
          plantas={plantas}
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
          divisiones={DIVISIONES}
          onClose={() => { setModalCSV(null); setCsvRawText(null); }}
          onConfirm={handleCSVConfirm}
          saving={saving}
          progreso={progresoCSV}
        />
      )}
      {modalCodigos && (
        <ModalCodigos
          codigos={modalCodigos.codigos}
          vigencia={modalCodigos.vigencia}
          empresa={empresa}
          onClose={() => setModalCodigos(null)}
        />
      )}
    </section>
  );
}
