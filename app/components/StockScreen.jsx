'use client';
// app/components/StockScreen.jsx — Pantalla Stock de gestión (Stock, parte
// 13; ítem 40). Los artículos y el stock vienen de la planilla MRP (la
// planilla manda): acá se configuran los links, se sincroniza, se busca y se
// imprimen las etiquetas con QR para pegar en estantes y pilas. Los dueños y
// administradores cargan acá los artículos que no están en la planilla
// (➕ Artículo nuevo, 124); el script de la planilla los anota en ARTICULOS.
import { useCallback, useEffect, useMemo, useState } from "react";
import { sb, sbGetAll, apiFetch } from "../lib/supabase";
import { Chip } from "./ui";
import { useToast } from "./ui/Toast";
import { TAMANOS_ETIQUETA } from "../lib/carga";
import {
  AVISO_DEMORA_GOOGLE, CLAVE_STOCK_CSV, MAX_ETIQUETAS_ARTICULO, cantidadTexto, divisionesDe, filtrarArticulos, imprimirEtiquetasArticulos, syncAtrasada,
} from "../lib/stock";
import FichaArticulo, { Semaforo } from "./FichaArticulo";
import MovimientosStock from "./MovimientosStock";
import ArticuloNuevo from "./ArticuloNuevo";

const GREEN = "#16A34A";
const RED = "#DC2626";
const AMBER = "var(--color-empresa-primary, #F97316)";
const MOSTRAR = 100;
const CLAVE_TAMANO = "gypi_tamano_etiqueta";

function leerTamano() {
  try { return localStorage.getItem(CLAVE_TAMANO) || TAMANOS_ETIQUETA[0].id; } catch { return TAMANOS_ETIQUETA[0].id; }
}

export default function StockScreen({ empresa, empresaId, usuario = null }) {
  const toast = useToast();
  const [articulos, setArticulos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  const [cfg, setCfg] = useState({ inventario: "", articulos: "", necesidades: "", tablas: "", ultima_sync: null });
  const [nuevo, setNuevo] = useState(false);
  const puedeCrear = usuario?.rol === "gerencial" || usuario?.rol === "administrativo";
  const [verConfig, setVerConfig] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [texto, setTexto] = useState("");
  const [division, setDivision] = useState("");
  const [urgentes, setUrgentes] = useState(false);
  const [elegidos, setElegidos] = useState(() => new Set());
  const [tamano, setTamano] = useState(leerTamano);
  const [ficha, setFicha] = useState(null);
  const [vista, setVista] = useState("articulos");

  const cargar = useCallback(async () => {
    if (!empresaId) return;
    setCargando(true);
    try {
      const { data } = await sbGetAll("articulos_stock?activo=eq.true&order=sku.asc", { maxFilas: 20000 });
      setArticulos(data || []);
      setFaltaMigracion(false);
    } catch (e) {
      if (String(e?.message).includes("articulos_stock")) setFaltaMigracion(true);
      else console.error(e);
    }
    setCargando(false);
  }, [empresaId]);

  const cargarCfg = useCallback(async () => {
    try {
      const rows = await sb.get(`config_sistema?clave=eq.${CLAVE_STOCK_CSV}&select=valor&limit=1`);
      const v = rows?.[0]?.valor;
      if (v) {
        setCfg({ inventario: v.inventario || "", articulos: v.articulos || "", necesidades: v.necesidades || "", tablas: v.tablas || "", ultima_sync: v.ultima_sync || null });
      } else {
        setVerConfig(true);
      }
    } catch { /* sin config todavía */ }
  }, []);

  useEffect(() => { cargar(); cargarCfg(); }, [cargar, cargarCfg]);

  const divisiones = useMemo(() => divisionesDe(articulos), [articulos]);
  const filtrados = useMemo(() => filtrarArticulos(articulos, { texto, division, urgentes }), [articulos, texto, division, urgentes]);
  const urgentesTotal = useMemo(() => filtrarArticulos(articulos, { urgentes: true }).length, [articulos]);

  const guardarCfg = async () => {
    const valor = { inventario: cfg.inventario.trim(), articulos: cfg.articulos.trim() || null, necesidades: cfg.necesidades.trim() || null, tablas: cfg.tablas.trim() || null };
    if (!valor.inventario) { toast.show("Pegá el link de la hoja INVENTARIO", AMBER); return; }
    try {
      const rows = await sb.get(`config_sistema?clave=eq.${CLAVE_STOCK_CSV}&select=valor&limit=1`);
      if (rows?.length) await sb.patch(`config_sistema?clave=eq.${CLAVE_STOCK_CSV}`, { valor: { ...rows[0].valor, ...valor } });
      else await sb.post("config_sistema", { clave: CLAVE_STOCK_CSV, valor });
      toast.show("✅ Links guardados", GREEN);
      return true;
    } catch (e) {
      toast.show(`Error: ${e.message}`, RED);
      return false;
    }
  };

  const sincronizar = async () => {
    if (!cfg.inventario.trim()) { toast.show("Pegá y guardá el link de la hoja INVENTARIO", AMBER); setVerConfig(true); return; }
    setSincronizando(true);
    try {
      const res = await apiFetch("/api/stock/sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || "No se pudo sincronizar");
      if (data.errores?.length) toast.show(`⚠️ ${data.articulos} artículos leídos, pero algunos no se guardaron. Probá de nuevo.`, AMBER);
      else if (data.avisoNecesidades || data.avisoTablas) toast.show(`⚠️ ${data.articulos} artículos sincronizados. ${data.avisoNecesidades || data.avisoTablas}`, AMBER);
      else toast.show(`✅ ${data.articulos} artículos sincronizados${data.desactivados ? ` (${data.desactivados} ya no están en la planilla)` : ""}`, GREEN);
      setCfg((c) => ({ ...c, ultima_sync: new Date().toISOString() }));
      await cargar();
    } catch (e) {
      toast.show(e.message, RED);
    }
    setSincronizando(false);
  };

  const alternar = (sku) => setElegidos((prev) => {
    const s = new Set(prev);
    if (s.has(sku)) s.delete(sku); else s.add(sku);
    return s;
  });
  const elegirFiltrados = () => setElegidos(new Set(filtrados.slice(0, MAX_ETIQUETAS_ARTICULO).map((a) => a.sku)));

  const imprimir = async () => {
    const t = TAMANOS_ETIQUETA.find((x) => x.id === tamano) || TAMANOS_ETIQUETA[0];
    try { localStorage.setItem(CLAVE_TAMANO, t.id); } catch { /* sin almacenamiento */ }
    try {
      await imprimirEtiquetasArticulos({
        empresa: empresa?.nombre_corto || empresa?.nombre || "",
        articulos: articulos.filter((a) => elegidos.has(a.sku)),
        origen: window.location.origin,
        slug: empresa?.slug || "",
        tamano: t,
      });
    } catch (e) {
      toast.show(e.message, RED);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-28 text-gypi-text">
      <div className="flex gap-1.5 mb-3" role="group" aria-label="Ver">
        <Chip active={vista === "articulos"} onClick={() => setVista("articulos")}>Artículos</Chip>
        <Chip active={vista === "movimientos"} onClick={() => setVista("movimientos")}>Movimientos</Chip>
      </div>
      {vista === "movimientos" ? <MovimientosStock usuario={usuario} articulos={articulos} onArticuloNuevo={(n) => setArticulos((prev) => [...prev.filter((x) => x.sku !== n.sku), n])} /> : (<>
      {/* Planilla MRP */}
      <div className="mb-3">
        <button onClick={() => setVerConfig((v) => !v)} aria-expanded={verConfig}
          className="w-full min-h-[44px] flex items-center justify-between px-3 rounded-[10px] border border-gypi-border bg-gypi-surface text-[14px] font-semibold text-gypi-text cursor-pointer">
          <span>🔗 Planilla MRP {cfg.inventario ? "· conectada" : "· sin conectar"}</span>
          <span className="text-[12px]">{verConfig ? "▲" : "▼"}</span>
        </button>
        {verConfig && (
          <div className="mt-1.5 p-3 bg-gypi-surface rounded-[10px] border border-gypi-border">
            <div className="text-[13px] text-gypi-dim mb-2 leading-relaxed">
              La planilla manda: Gypi copia los artículos y el stock calculado. En Google Sheets: Archivo → Compartir → Publicar en la web, elegí la hoja, formato CSV y copiá el link.
            </div>
            <label className="g-label" htmlFor="stock-inv">Link de la hoja INVENTARIO</label>
            <input id="stock-inv" value={cfg.inventario} onChange={(e) => setCfg((c) => ({ ...c, inventario: e.target.value }))}
              placeholder="https://docs.google.com/spreadsheets/d/e/…/pub?gid=…&output=csv" className="g-input w-full text-[13px] mb-2" />
            <label className="g-label" htmlFor="stock-art">Link de la hoja ARTICULOS (opcional: suma unidad, familia y marca)</label>
            <input id="stock-art" value={cfg.articulos} onChange={(e) => setCfg((c) => ({ ...c, articulos: e.target.value }))}
              placeholder="https://docs.google.com/spreadsheets/d/e/…/pub?gid=…&output=csv" className="g-input w-full text-[13px] mb-2" />
            <label className="g-label" htmlFor="stock-nec">Link de la hoja fact_necesidades_stock (opcional: material de cada OT)</label>
            <input id="stock-nec" value={cfg.necesidades} onChange={(e) => setCfg((c) => ({ ...c, necesidades: e.target.value }))}
              placeholder="https://docs.google.com/spreadsheets/d/e/…/pub?gid=…&output=csv" className="g-input w-full text-[13px] mb-2" />
            <label className="g-label" htmlFor="stock-tab">Link de la hoja TABLAS (opcional: listas para cargar artículos nuevos)</label>
            <input id="stock-tab" value={cfg.tablas} onChange={(e) => setCfg((c) => ({ ...c, tablas: e.target.value }))}
              placeholder="https://docs.google.com/spreadsheets/d/e/…/pub?gid=…&output=csv" className="g-input w-full text-[13px] mb-2" />
            <button onClick={async () => { if (await guardarCfg()) sincronizar(); }} disabled={sincronizando || !cfg.inventario.trim()}
              className="g-btn g-btn-primary w-full">Guardar y sincronizar</button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 text-[13px] text-gypi-dim">
          {cfg.ultima_sync ? `Sincronizado el ${new Date(cfg.ultima_sync).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}. Se actualiza solo cada mañana.` : "Todavía no se sincronizó."}
          {syncAtrasada(cfg.ultima_sync) && (
            <div className="text-gypi-amber-ink font-bold">⚠️ Hace más de un día que no se sincroniza: tocá Sincronizar.</div>
          )}
          <div>{AVISO_DEMORA_GOOGLE}</div>
        </div>
        <button onClick={sincronizar} disabled={sincronizando}
          className="min-h-[44px] px-3 rounded-lg border-none bg-gypi-green/15 text-gypi-green text-[13px] font-bold cursor-pointer">
          {sincronizando ? "Sincronizando…" : "🔄 Sincronizar"}
        </button>
      </div>

      {faltaMigracion && (
        <div role="alert" className="p-3 mb-3 rounded-[10px] bg-gypi-red/10 text-gypi-red text-[14px]">Para ver el stock falta correr la migración 106 en Supabase.</div>
      )}

      {puedeCrear && (nuevo ? (
        <ArticuloNuevo articulos={articulos} nombreInicial={texto} onCancelar={() => setNuevo(false)}
          onCreado={(a) => { setNuevo(false); setArticulos((prev) => [...prev.filter((x) => x.sku !== a.sku), a]); setTexto(a.nombre || a.sku); }} />
      ) : (
        <button onClick={() => setNuevo(true)} className="g-btn g-btn-secondary w-full mb-3">➕ Artículo nuevo (no está en la planilla)</button>
      ))}

      <input type="search" value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Buscar artículo"
        placeholder="Buscar por nombre, código o familia" className="g-input w-full mb-2" />
      <div className="flex gap-1.5 flex-wrap mb-3" role="group" aria-label="Filtros">
        <Chip active={urgentes} onClick={() => setUrgentes((u) => !u)}>🔴 Urgentes ({urgentesTotal})</Chip>
        <Chip active={!division} onClick={() => setDivision("")}>Todas</Chip>
        {divisiones.map((d) => <Chip key={d} active={division === d} onClick={() => setDivision(division === d ? "" : d)}>{d}</Chip>)}
      </div>

      {/* Etiquetas */}
      <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
        <div className="flex items-center gap-2 mb-2">
          <div className="flex-1 text-[14px] font-semibold">🏷 Etiquetas con QR {elegidos.size ? `· ${elegidos.size} elegidas` : ""}</div>
          {elegidos.size > 0 && <button onClick={() => setElegidos(new Set())} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] text-gypi-dim cursor-pointer">Ninguna</button>}
          <button onClick={elegirFiltrados} disabled={!filtrados.length}
            className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-amber-ink cursor-pointer">
            Elegir {Math.min(filtrados.length, MAX_ETIQUETAS_ARTICULO)} de la lista
          </button>
        </div>
        <div className="flex gap-2">
          <select aria-label="Tamaño de la etiqueta" className="g-input flex-1" value={tamano} onChange={(e) => setTamano(e.target.value)}>
            {TAMANOS_ETIQUETA.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
          <button onClick={imprimir} disabled={!elegidos.size} className="g-btn g-btn-primary flex-1">🖨 Imprimir</button>
        </div>
        <div className="text-[12px] text-gypi-dim mt-2">El QR abre la ficha del artículo. El operario lo escanea para registrar lo que retira.</div>
      </div>

      {cargando ? (
        <div className="text-[14px] text-gypi-dim">Cargando artículos…</div>
      ) : !articulos.length ? (
        <div className="text-[14px] text-gypi-dim">Todavía no hay artículos. Conectá la planilla MRP y tocá Sincronizar.</div>
      ) : (
        <>
          <div className="text-[13px] text-gypi-dim mb-2" role="status">
            {filtrados.length === articulos.length ? `${articulos.length} artículos` : `${filtrados.length} de ${articulos.length} artículos`}
            {filtrados.length > MOSTRAR ? `. Se muestran los primeros ${MOSTRAR}: buscá para ver otros.` : ""}
          </div>
          <ul className="list-none m-0 p-0 lista-ancha flex flex-col gap-1.5">
            {filtrados.slice(0, MOSTRAR).map((a) => (
              <li key={a.sku} className="flex items-center gap-2 p-2 rounded-[10px] border border-gypi-border bg-gypi-surface">
                <input type="checkbox" checked={elegidos.has(a.sku)} onChange={() => alternar(a.sku)}
                  aria-label={`Etiqueta de ${a.nombre || a.sku}`} className="w-6 h-6 shrink-0 cursor-pointer" />
                <button onClick={() => setFicha(a)} className="flex-1 min-w-0 min-h-[44px] text-left bg-transparent border-none p-0 cursor-pointer text-gypi-text font-body">
                  <div className="text-[14px] font-semibold truncate">{a.nombre || a.sku}</div>
                  <div className="text-[12px] text-gypi-dim truncate">{a.origen === "gypi" ? "🆕 Nuevo, falta pasar a la planilla · " : ""}{a.sku}{a.division ? ` · ${a.division}` : ""}</div>
                </button>
                <div className="text-right shrink-0">
                  <div className="text-[14px] font-bold">{cantidadTexto(a.disponible ?? a.stock)} <span className="text-[12px] font-semibold text-gypi-dim">{a.unidad || ""}</span></div>
                  <Semaforo texto={a.semaforo} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      </>)}
      {ficha && <FichaArticulo sku={ficha.sku} articulo={ficha} usuario={usuario} empresaId={empresaId} onClose={() => setFicha(null)} />}
    </div>
  );
}
