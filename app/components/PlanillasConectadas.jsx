'use client';
// app/components/PlanillasConectadas.jsx — Más → Planillas conectadas
// (auditoría 01/11, PR 3): todo lo de las planillas de Google en un solo
// lugar. Antes estaba repartido en OT → Más acciones → Sincronización
// automática, Stock → Planilla MRP y Stock → Movimientos.
//
// Lee y guarda exactamente la misma configuración que antes (no cambia nada
// de cómo sincronizan las planillas):
//   proyectos_csv_url       → links del Plan de trabajo (las OT)
//   CLAVE_FECHA_OBJETIVO    → de dónde sale la fecha objetivo (Gantt, atrasadas)
//   CLAVE_PLANILLA_PLAN     → script que pasa la SEMANA al Plan de trabajo
//   CLAVE_STOCK_CSV         → links del libro MRP (INVENTARIO, ARTICULOS…)
//   CLAVE_PLANILLA_MRP      → script que pasa los movimientos al MRP
//   CLAVE_PDF_OT            → script de la carpeta de Drive con los PDF de las OT (04/11)
import { useEffect, useState } from "react";
import { sb, apiFetch } from "../lib/supabase";
import { useToast } from "./ui/Toast";
import { tieneModulo } from "../lib/modulos";
import { linksPlanilla, valorLinks } from "../lib/csvProyectos";
import { CLAVE_FECHA_OBJETIVO, MODOS_FECHA_OBJETIVO, normalizarModo } from "../lib/semanaObjetivo";
import { CLAVE_PLANILLA_PLAN } from "../lib/semanaEditable";
import { AVISO_DEMORA_GOOGLE, CLAVE_STOCK_CSV } from "../lib/stock";
import PlanillaMrpConexion, { ConexionScript } from "./PlanillaMrpConexion";
import CarpetaPdfOt from "./CarpetaPdfOt";

const AMBER = "var(--color-empresa-primary, #F97316)";

async function guardarConfig(clave, valor) {
  const rows = await sb.get(`config_sistema?clave=eq.${clave}&select=valor&limit=1`);
  if (rows?.length) await sb.patch(`config_sistema?clave=eq.${clave}`, { valor: { ...rows[0].valor, ...valor } });
  else await sb.post("config_sistema", { clave, valor });
}

function Bloque({ titulo, detalle, children }) {
  return (
    <section aria-label={titulo} className="p-3.5 rounded-xl border border-gypi-border bg-gypi-surface flex flex-col gap-2">
      <h3 className="m-0 text-[16px] font-bold text-gypi-text">{titulo}</h3>
      {detalle && <p className="m-0 text-[13px] text-gypi-dim leading-relaxed">{detalle}</p>}
      {children}
    </section>
  );
}

/** Plan de trabajo: links de las hojas (PLAN y las de cada obra) y la fecha objetivo. */
export function PlanTrabajoLinks() {
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [ultima, setUltima] = useState(null);
  const [modo, setModo] = useState(normalizarModo());
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const rows = await sb.get("config_sistema?clave=eq.proyectos_csv_url&select=valor&limit=1");
        const v = rows?.[0]?.valor;
        if (vivo && v) { setUrl(linksPlanilla(v).join("\n")); setUltima(v.ultima_sync || null); }
      } catch { /* sin config todavía */ }
      try {
        const rows = await sb.get(`config_sistema?clave=eq.${CLAVE_FECHA_OBJETIVO}&select=valor&limit=1`);
        if (vivo) setModo(normalizarModo(rows?.[0]?.valor?.modo));
      } catch { /* por defecto */ }
    })();
    return () => { vivo = false; };
  }, []);

  // Mismo guardado que tenía OT → Más acciones: reemplaza el valor entero
  const guardarLinks = async () => {
    if (!url.trim()) return;
    setGuardando(true);
    try {
      const valor = valorLinks(url);
      const rows = await sb.get("config_sistema?clave=eq.proyectos_csv_url&select=clave&limit=1");
      if (rows?.length) await sb.patch("config_sistema?clave=eq.proyectos_csv_url", { valor });
      else await sb.post("config_sistema", { clave: "proyectos_csv_url", valor });
      const cuantos = 1 + valor.urls.length;
      toast.success(cuantos > 1 ? `✅ ${cuantos} links guardados` : "✅ Link guardado");
    } catch (e) { toast.error(`Error: ${e.message}`); }
    setGuardando(false);
  };

  const cambiarModo = async (nuevo) => {
    const anterior = modo;
    setModo(nuevo);
    try {
      const rows = await sb.get(`config_sistema?clave=eq.${CLAVE_FECHA_OBJETIVO}&select=clave&limit=1`);
      if (rows?.length) await sb.patch(`config_sistema?clave=eq.${CLAVE_FECHA_OBJETIVO}`, { valor: { modo: nuevo } });
      else await sb.post("config_sistema", { clave: CLAVE_FECHA_OBJETIVO, valor: { modo: nuevo } });
      toast.success("✅ Guardado. Apretá Sincronizar en Producción → OT para que se aplique a las OT.");
    } catch (e) {
      setModo(anterior);
      toast.error(`Error: ${e.message}`);
    }
  };

  return (
    <Bloque titulo="📋 Plan de trabajo (las OT)"
      detalle={<>Las OT nuevas se crean y las que ya están se actualizan. Para traer lo nuevo usá <b>🔄 Actualizar y sincronizar</b> en Producción → OT. {AVISO_DEMORA_GOOGLE}</>}>
      {ultima && <div className="text-xs text-gypi-green">Última sincronización: {new Date(ultima).toLocaleString("es-AR")}</div>}
      <label className="block text-[13px] font-semibold text-gypi-text" htmlFor="links-planilla">Links de la planilla, uno por renglón</label>
      <div className="text-xs text-gypi-dim leading-relaxed">
        Primero el de la hoja PLAN. Si una obra tiene su hoja propia (OCAMPOURB, MALMÖ…), publicá esa hoja también como CSV y pegá su link en otro renglón.
      </div>
      <textarea id="links-planilla" value={url} onChange={(e) => setUrl(e.target.value)}
        placeholder="https://docs.google.com/spreadsheets/d/…/export?format=csv" rows={4} className="g-input text-xs" />
      <button onClick={guardarLinks} disabled={guardando || !url.trim()} className="g-btn g-btn-primary w-full disabled:opacity-50">
        {guardando ? "Guardando…" : "Guardar links"}
      </button>
      <label className="block text-[13px] font-semibold text-gypi-text mt-1" htmlFor="modo-objetivo">Fecha objetivo de las OT (Gantt y OT atrasadas)</label>
      <select id="modo-objetivo" value={modo} onChange={(e) => cambiarModo(e.target.value)} className="g-input text-xs">
        {MODOS_FECHA_OBJETIVO.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
      </select>
      {/* SEMANA cambiada en Gypi → columna SEMANA del Plan de trabajo (144) */}
      <ConexionScript claveConfig={CLAVE_PLANILLA_PLAN} api="/api/proyectos/semanas-planilla" planilla="el Plan de trabajo" funcion="instalarSemanasGypi"
        titulo="📅 Pasar la SEMANA al Plan de trabajo" leyo="pidió las semanas" cada="cada 15 minutos"
        texto="Cuando cambiás la semana de una OT en Planificación o en el detalle de la OT, el Plan de trabajo la anota solo en la columna SEMANA, en todas las hojas donde está esa OT. Si alguien la cambió en la planilla después, gana la planilla (el cambio más reciente)." />
    </Bloque>
  );
}

/** Libro MRP: links de las hojas publicadas como CSV. */
export function PlanillaMrpLinks() {
  const toast = useToast();
  const [cfg, setCfg] = useState({ inventario: "", articulos: "", necesidades: "", tablas: "", ultima_sync: null });
  const [sincronizando, setSincronizando] = useState(false);

  useEffect(() => {
    let vivo = true;
    sb.get(`config_sistema?clave=eq.${CLAVE_STOCK_CSV}&select=valor&limit=1`).then((rows) => {
      const v = rows?.[0]?.valor;
      if (vivo && v) setCfg({ inventario: v.inventario || "", articulos: v.articulos || "", necesidades: v.necesidades || "", tablas: v.tablas || "", ultima_sync: v.ultima_sync || null });
    }).catch(() => { /* sin config todavía */ });
    return () => { vivo = false; };
  }, []);

  // Mismo guardado que tenía Stock → Planilla MRP: suma a lo que ya había
  const guardarYSincronizar = async () => {
    const valor = { inventario: cfg.inventario.trim(), articulos: cfg.articulos.trim() || null, necesidades: cfg.necesidades.trim() || null, tablas: cfg.tablas.trim() || null };
    if (!valor.inventario) { toast.show("Pegá el link de la hoja INVENTARIO", AMBER); return; }
    setSincronizando(true);
    try {
      await guardarConfig(CLAVE_STOCK_CSV, valor);
      const res = await apiFetch("/api/stock/sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || "Los links se guardaron, pero no se pudo sincronizar");
      if (data.errores?.length) toast.show(`⚠️ ${data.articulos} artículos leídos, pero algunos no se guardaron. Probá de nuevo.`, AMBER);
      else if (data.avisoNecesidades || data.avisoTablas) toast.show(`⚠️ ${data.articulos} artículos sincronizados. ${data.avisoNecesidades || data.avisoTablas}`, AMBER);
      else toast.success(`✅ Links guardados y ${data.articulos} artículos sincronizados`);
      setCfg((c) => ({ ...c, ultima_sync: new Date().toISOString() }));
    } catch (e) {
      toast.error(e.message);
    }
    setSincronizando(false);
  };

  const campo = (id, clave, label) => (
    <>
      <label className="g-label" htmlFor={id}>{label}</label>
      <input id={id} value={cfg[clave]} onChange={(e) => setCfg((c) => ({ ...c, [clave]: e.target.value }))}
        placeholder="https://docs.google.com/spreadsheets/d/e/…/pub?gid=…&output=csv" className="g-input w-full text-[13px]" />
    </>
  );

  return (
    <Bloque titulo="📦 Libro MRP (stock)"
      detalle="La planilla manda: Gypi copia los artículos y el stock calculado. En Google Sheets: Archivo → Compartir → Publicar en la web, elegí la hoja, formato CSV y copiá el link.">
      {cfg.ultima_sync && <div className="text-xs text-gypi-green">Última sincronización: {new Date(cfg.ultima_sync).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}</div>}
      {campo("stock-inv", "inventario", "Link de la hoja INVENTARIO")}
      {campo("stock-art", "articulos", "Link de la hoja ARTICULOS (opcional: suma unidad, familia y marca)")}
      {campo("stock-nec", "necesidades", "Link de la hoja fact_necesidades_stock (opcional: material de cada OT)")}
      {campo("stock-tab", "tablas", "Link de la hoja TABLAS (opcional: listas para cargar artículos nuevos)")}
      <button onClick={guardarYSincronizar} disabled={sincronizando || !cfg.inventario.trim()} className="g-btn g-btn-primary w-full disabled:opacity-50">
        {sincronizando ? "Sincronizando…" : "Guardar y sincronizar"}
      </button>
      <PlanillaMrpConexion />
    </Bloque>
  );
}

export default function PlanillasConectadas({ empresa }) {
  const conStock = tieneModulo(empresa, "stock");
  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-[110px] flex flex-col gap-4 text-gypi-text">
      <p className="m-0 text-[13px] text-gypi-dim leading-relaxed">
        Acá están todos los links de las planillas de Google y los códigos para pegar en Apps Script. Se configuran una vez; después se sincronizan solas.
      </p>
      <PlanTrabajoLinks />
      <CarpetaPdfOt />
      {conStock && <PlanillaMrpLinks />}
    </div>
  );
}
