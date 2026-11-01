'use client';
// app/components/StockScreen.jsx — Pantalla Stock de gestión (Stock, parte
// 13; ítem 40). Los artículos y el stock vienen de la planilla MRP (la
// planilla manda): los links se configuran en Más → Planillas conectadas
// (auditoría 01/11); acá se sincroniza, se busca y se
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
import { esSupervisor } from "../lib/menuGestion";

const GREEN = "#16A34A";
const RED = "#DC2626";
const AMBER = "var(--color-empresa-primary, #F97316)";
const MOSTRAR = 100;
const CLAVE_TAMANO = "gypi_tamano_etiqueta";

function leerTamano() {
  try { return localStorage.getItem(CLAVE_TAMANO) || TAMANOS_ETIQUETA[0].id; } catch { return TAMANOS_ETIQUETA[0].id; }
}

export default function StockScreen({ empresa, empresaId, usuario = null, onPlanillas = null }) {
  const toast = useToast();
  const [articulos, setArticulos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  const [cfg, setCfg] = useState({ inventario: "", articulos: "", necesidades: "", tablas: "", ultima_sync: null });
  const [nuevo, setNuevo] = useState(false);
  const puedeCrear = usuario?.rol === "gerencial" || usuario?.rol === "administrativo";
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
      }
    } catch { /* sin config todavía */ }
  }, []);

  useEffect(() => { cargar(); cargarCfg(); }, [cargar, cargarCfg]);

  const divisiones = useMemo(() => divisionesDe(articulos), [articulos]);
  const filtrados = useMemo(() => filtrarArticulos(articulos, { texto, division, urgentes }), [articulos, texto, division, urgentes]);
  const urgentesTotal = useMemo(() => filtrarArticulos(articulos, { urgentes: true }).length, [articulos]);

  const sincronizar = async () => {
    if (!cfg.inventario.trim()) { toast.show("Falta conectar la planilla MRP: pegá el link de INVENTARIO en Más → Planillas conectadas", AMBER); onPlanillas?.(); return; }
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
      {/* Los links del libro MRP se configuran en Más → Planillas conectadas
          (auditoría 01/11, PR 3); el supervisor no los ve */}
      {!esSupervisor(usuario) && onPlanillas && (
        <button onClick={onPlanillas}
          className="w-full min-h-[44px] mb-3 flex items-center justify-between px-3 rounded-[10px] border border-gypi-border bg-gypi-surface text-[14px] font-semibold text-gypi-text cursor-pointer">
          <span>🔗 Planilla MRP {cfg.inventario ? "· conectada" : "· sin conectar"}</span>
          <span className="text-[12px] text-gypi-dim">Más → Planillas conectadas ›</span>
        </button>
      )}

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
