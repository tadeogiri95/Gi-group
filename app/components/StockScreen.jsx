'use client';
// app/components/StockScreen.jsx — Pantalla Stock de gestión (Stock, parte
// 13; ítem 40). Los artículos y el stock vienen de la planilla MRP (la
// planilla manda): los links se configuran en Más → Planillas conectadas
// (auditoría 01/11); acá se sincroniza, se busca y se
// imprimen las etiquetas con QR para pegar en estantes y pilas. Los dueños y
// administradores cargan acá los artículos que no están en la planilla
// (➕ Artículo nuevo, 124); el script de la planilla los anota en ARTICULOS.
// 27/11 (Tadeo): se ven todos los artículos (de a 100), la foto se pone desde
// el renglón (📷) con filtros Sin foto / Con foto, y los rótulos se imprimen
// también en hoja A4 de a ocho, eligiendo los que tienen foto, de a 300.
import { useCallback, useEffect, useMemo, useState } from "react";
import { sb, sbGetAll, apiFetch } from "../lib/supabase";
import { Chip } from "./ui";
import { useToast } from "./ui/Toast";
import { TAMANOS_ARTICULO } from "../lib/carga";
import {
  AVISO_DEMORA_GOOGLE, CLAVE_STOCK_CSV, MAX_ETIQUETAS_ARTICULO, cantidadTexto, divisionesDe, filtrarArticulos, imprimirEtiquetasArticulos, syncAtrasada,
} from "../lib/stock";
import FichaArticulo, { Semaforo, guardarFotoArticulo } from "./FichaArticulo";
import { subirImagen } from "../lib/foto";
import RecortarFoto from "./RecortarFoto";
import { BotonesCargar } from "./MovimientosStock";
import ArticuloNuevo from "./ArticuloNuevo";
import { textoFechaPrecio, textoPrecio, ultimosPrecios, veePrecios } from "../lib/preciosArticulos";

const GREEN = "#16A34A";
const RED = "#DC2626";
const AMBER = "var(--color-empresa-primary, #F97316)";
const MOSTRAR = 100;
const CLAVE_TAMANO = "gypi_tamano_etiqueta";

function leerTamano() {
  try { return localStorage.getItem(CLAVE_TAMANO) || TAMANOS_ARTICULO[0].id; } catch { return TAMANOS_ARTICULO[0].id; }
}

/** Botón 📷 del renglón: saca o elige la foto del artículo, la recorta y la guarda (27/11). */
function FotoRenglon({ articulo, onFoto }) {
  const toast = useToast();
  const [subiendo, setSubiendo] = useState(false);
  const [archivo, setArchivo] = useState(null);
  const nombre = articulo.nombre || articulo.sku;
  // Recortada en cuadrado, como sale en el rótulo (27/11, Tadeo)
  const guardar = async (imagen) => {
    setArchivo(null);
    setSubiendo(true);
    try {
      const url = await subirImagen(imagen);
      onFoto(articulo.sku, await guardarFotoArticulo(articulo.sku, url));
      toast.show(`📷 Foto guardada: ${nombre}`, GREEN);
    } catch (e) {
      toast.show(e.message, RED);
    }
    setSubiendo(false);
  };
  const label = articulo.foto_url ? `Cambiar la foto de ${nombre}` : `Poner la foto de ${nombre}`;
  return (
    <>
      <label title={label}
        className={`w-11 h-11 shrink-0 flex items-center justify-center rounded-[8px] border border-gypi-border cursor-pointer overflow-hidden ${articulo.foto_url ? "" : "border-dashed bg-gypi-surf-hi text-[20px]"}`}>
        {subiendo ? <span className="text-[12px] text-gypi-dim">…</span>
          : articulo.foto_url ? <img src={articulo.foto_url} alt="" loading="lazy" className="w-full h-full object-cover" /> : "📷"}
        <input type="file" accept="image/*" capture="environment" className="hidden" aria-label={label} disabled={subiendo}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) setArchivo(f); e.target.value = ""; }} />
      </label>
      {archivo && <RecortarFoto fuente={archivo} onListo={guardar} onCancelar={() => setArchivo(null)} />}
    </>
  );
}

export default function StockScreen({ empresa, empresaId, usuario = null, onPlanillas = null, onCargar = null }) {
  const toast = useToast();
  const [articulos, setArticulos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  const [cfg, setCfg] = useState({ inventario: "", articulos: "", necesidades: "", tablas: "", ingresos: "", ultima_sync: null });
  const [nuevo, setNuevo] = useState(false);
  const puedeCrear = usuario?.rol === "gerencial" || usuario?.rol === "administrativo";
  const [sincronizando, setSincronizando] = useState(false);
  const [texto, setTexto] = useState("");
  const [division, setDivision] = useState("");
  const [urgentes, setUrgentes] = useState(false);
  const [negativos, setNegativos] = useState(false);
  const [foto, setFoto] = useState("");
  const [mostrar, setMostrar] = useState(MOSTRAR);
  const [elegidos, setElegidos] = useState(() => new Set());
  const [tamano, setTamano] = useState(leerTamano);
  const [ficha, setFicha] = useState(null);
  // Último precio con fecha de cada artículo (solo Dueño, Supervisor y Administración)
  const conPrecios = veePrecios(usuario);
  const [precios, setPrecios] = useState([]);

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
        setCfg({ inventario: v.inventario || "", articulos: v.articulos || "", necesidades: v.necesidades || "", tablas: v.tablas || "", ingresos: v.ingresos || "", ultima_sync: v.ultima_sync || null });
      }
    } catch { /* sin config todavía */ }
  }, []);

  useEffect(() => { cargar(); cargarCfg(); }, [cargar, cargarCfg]);

  const cargarPrecios = useCallback(async () => {
    if (!conPrecios || !empresaId) return;
    try {
      // De la más nueva a la más vieja: si se corta, se pierden solo las viejas
      const { data } = await sbGetAll("v_precios_articulos?select=sku,fecha,precio,moneda,precio_ars,origen,proveedor&order=fecha.desc", { maxFilas: 20000 });
      setPrecios(data || []);
    } catch { /* sin la migración 164 o sin permiso: no se muestran */ }
  }, [conPrecios, empresaId]);
  useEffect(() => { cargarPrecios(); }, [cargarPrecios]);
  const ultimos = useMemo(() => (conPrecios ? ultimosPrecios(precios, articulos) : new Map()), [conPrecios, precios, articulos]);

  const divisiones = useMemo(() => divisionesDe(articulos), [articulos]);
  const filtrados = useMemo(() => filtrarArticulos(articulos, { texto, division, urgentes, negativos, foto }), [articulos, texto, division, urgentes, negativos, foto]);
  useEffect(() => { setMostrar(MOSTRAR); }, [texto, division, urgentes, negativos, foto]);
  const conFotoTotal = useMemo(() => filtrarArticulos(articulos, { foto: "con" }).length, [articulos]);
  const urgentesTotal = useMemo(() => filtrarArticulos(articulos, { urgentes: true }).length, [articulos]);
  const negativosTotal = useMemo(() => filtrarArticulos(articulos, { negativos: true }).length, [articulos]);

  const sincronizar = async () => {
    if (!cfg.inventario.trim()) { toast.show("Falta conectar la planilla MRP: pegá el link de INVENTARIO en Más → Planillas conectadas", AMBER); onPlanillas?.(); return; }
    setSincronizando(true);
    try {
      const res = await apiFetch("/api/stock/sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || "No se pudo sincronizar");
      if (data.errores?.length) toast.show(`⚠️ ${data.articulos} artículos leídos, pero algunos no se guardaron. Probá de nuevo.`, AMBER);
      else if (data.avisoNecesidades || data.avisoTablas || data.avisoPrecios) toast.show(`⚠️ ${data.articulos} artículos sincronizados. ${data.avisoNecesidades || data.avisoTablas || data.avisoPrecios}`, AMBER);
      else toast.show(`✅ ${data.articulos} artículos sincronizados${data.desactivados ? ` (${data.desactivados} ya no están en la planilla)` : ""}`, GREEN);
      setCfg((c) => ({ ...c, ultima_sync: new Date().toISOString() }));
      await cargar();
      cargarPrecios();
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
  // De a 300 (el tope de una impresión): los siguientes de la lista que todavía no se eligieron
  const siguientes = useMemo(() => {
    if (!elegidos.size) return [];
    const ultimo = filtrados.reduce((m, a, i) => (elegidos.has(a.sku) ? i : m), -1);
    return filtrados.slice(ultimo + 1, ultimo + 1 + MAX_ETIQUETAS_ARTICULO);
  }, [filtrados, elegidos]);
  const elegirSiguientes = () => setElegidos(new Set(siguientes.map((a) => a.sku)));
  const elegirConFoto = () => setElegidos(new Set(filtrarArticulos(filtrados, { foto: "con" }).slice(0, MAX_ETIQUETAS_ARTICULO).map((a) => a.sku)));
  const ponerFoto = (sku, foto_url) => setArticulos((lista) => lista.map((x) => (x.sku === sku ? { ...x, foto_url } : x)));

  const imprimir = async () => {
    const t = TAMANOS_ARTICULO.find((x) => x.id === tamano) || TAMANOS_ARTICULO[0];
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
      {/* 17/11: Movimientos tiene su pestaña en Materiales; cargar, a la vista */}
      {onCargar && <BotonesCargar puedeIngresar={puedeCrear} onElegir={onCargar} />}
      {/* Los links del libro MRP se configuran en Más → Planillas conectadas
          (auditoría 01/11, PR 3); el supervisor no los ve */}
      {/* Planilla y sincronización en una fila (11/11, revisión de interfaz): en el
          celular los artículos quedaban debajo de la pantalla */}
      <div className="flex items-center gap-2 mb-3 p-2 rounded-[10px] border border-gypi-border bg-gypi-surface">
        <div className="flex-1 min-w-0 text-[13px] text-gypi-dim">
          {onPlanillas ? (
            <button onClick={onPlanillas} className="p-0 bg-transparent border-none text-[13px] font-semibold text-gypi-text cursor-pointer font-body text-left">
              🔗 Planilla MRP {cfg.inventario ? "· conectada" : "· sin conectar"} ›
            </button>
          ) : <span className="font-semibold text-gypi-text">🔗 Planilla MRP</span>}
          <div>{cfg.ultima_sync ? `Sincronizado el ${new Date(cfg.ultima_sync).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}` : "Todavía no se sincronizó."}</div>
          {syncAtrasada(cfg.ultima_sync) && (
            <div className="text-gypi-amber-ink font-bold">⚠️ Hace más de un día que no se sincroniza: tocá Sincronizar.</div>
          )}
          {sincronizando && <div>{AVISO_DEMORA_GOOGLE}</div>}
        </div>
        <button onClick={sincronizar} disabled={sincronizando} title={AVISO_DEMORA_GOOGLE}
          className="min-h-[44px] px-3 rounded-lg border-none bg-gypi-green/15 text-gypi-green text-[13px] font-bold cursor-pointer shrink-0">
          {sincronizando ? "Sincronizando…" : "🔄 Sincronizar"}
        </button>
      </div>

      {faltaMigracion && (
        <div role="alert" className="p-3 mb-3 rounded-[10px] bg-gypi-red/10 text-gypi-red text-[14px]">Para ver el stock falta correr la migración 106 en Supabase.</div>
      )}

      {puedeCrear && nuevo && (
        <ArticuloNuevo articulos={articulos} nombreInicial={texto} onCancelar={() => setNuevo(false)}
          onCreado={(a) => { setNuevo(false); setArticulos((prev) => [...prev.filter((x) => x.sku !== a.sku), a]); setTexto(a.nombre || a.sku); }} />
      )}

      <div className="flex gap-2 mb-2">
        <input type="search" value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Buscar artículo"
          placeholder="Buscar por nombre, código o familia" className="g-input flex-1 min-w-0" />
        {puedeCrear && !nuevo && (
          <button onClick={() => setNuevo(true)} title="Artículo nuevo (no está en la planilla)" aria-label="Artículo nuevo (no está en la planilla)"
            className="g-btn g-btn-primary shrink-0">＋ Nuevo</button>
        )}
      </div>
      <div className="flex gap-1.5 flex-wrap mb-3" role="group" aria-label="Filtros">
        <Chip active={urgentes} onClick={() => { setUrgentes((u) => !u); setNegativos(false); }}>🔴 Urgentes ({urgentesTotal})</Chip>
        {negativosTotal > 0 && <Chip active={negativos} onClick={() => { setNegativos((n) => !n); setUrgentes(false); }}>⚠ Stock negativo ({negativosTotal})</Chip>}
        <Chip active={!division} onClick={() => setDivision("")}>Todas</Chip>
        {divisiones.map((d) => <Chip key={d} active={division === d} onClick={() => setDivision(division === d ? "" : d)}>{d}</Chip>)}
      </div>
      {articulos.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mb-3" role="group" aria-label="Fotos">
          <Chip active={foto === "sin"} onClick={() => setFoto(foto === "sin" ? "" : "sin")}>📷 Sin foto ({articulos.length - conFotoTotal})</Chip>
          <Chip active={foto === "con"} onClick={() => setFoto(foto === "con" ? "" : "con")}>🖼 Con foto ({conFotoTotal})</Chip>
        </div>
      )}

      {negativos && (
        <p className="m-0 mb-3 text-[13px] text-gypi-amber-ink">
          Estos artículos tienen stock negativo en la planilla MRP: falta cargar un ingreso o hay un consumo de más. No cuentan como urgentes;
          corregilos en la planilla y volvé a sincronizar.
        </p>
      )}

      {/* Etiquetas: aparecen al tildar un artículo (11/11, revisión de interfaz) */}
      {elegidos.size > 0 && (
      <div className="p-3 mb-3 rounded-[10px] border border-gypi-amber bg-gypi-surface">
        <div className="flex items-center gap-2 mb-2">
          <div className="flex-1 text-[14px] font-semibold">🏷 Rótulos con QR {elegidos.size ? `· ${elegidos.size} elegidos` : ""}</div>
          {elegidos.size > 0 && <button onClick={() => setElegidos(new Set())} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] text-gypi-dim cursor-pointer">Ninguno</button>}
        </div>
        <div className="flex flex-wrap gap-x-3 mb-2">
          <button onClick={elegirFiltrados} disabled={!filtrados.length}
            className="min-h-[40px] px-0 bg-transparent border-none text-[13px] font-semibold text-gypi-amber-ink cursor-pointer">
            Elegir los primeros {Math.min(filtrados.length, MAX_ETIQUETAS_ARTICULO)} de la lista
          </button>
          {siguientes.length > 0 && (
            <button onClick={elegirSiguientes}
              className="min-h-[40px] px-0 bg-transparent border-none text-[13px] font-semibold text-gypi-amber-ink cursor-pointer">
              Elegir los {siguientes.length} siguientes
            </button>
          )}
          {conFotoTotal > 0 && (
            <button onClick={elegirConFoto}
              className="min-h-[40px] px-0 bg-transparent border-none text-[13px] font-semibold text-gypi-amber-ink cursor-pointer">
              Elegir los que tienen foto
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <select aria-label="Tamaño de la etiqueta" className="g-input flex-1" value={tamano} onChange={(e) => setTamano(e.target.value)}>
            {TAMANOS_ARTICULO.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
          <button onClick={imprimir} disabled={!elegidos.size} className="g-btn g-btn-primary flex-1">🖨 Imprimir</button>
        </div>
        <div className="text-[12px] text-gypi-dim mt-2">
          El QR abre la ficha del artículo. El operario lo escanea para registrar lo que retira. Se imprimen hasta {MAX_ETIQUETAS_ARTICULO} por vez.
          {(TAMANOS_ARTICULO.find((x) => x.id === tamano) || TAMANOS_ARTICULO[0]).hoja ? " En la hoja A4 imprimí en tamaño real (100 %), sin márgenes." : ""}
        </div>
      </div>
      )}

      {cargando ? (
        <div className="text-[14px] text-gypi-dim">Cargando artículos…</div>
      ) : !articulos.length ? (
        <div className="text-[14px] text-gypi-dim">Todavía no hay artículos. Conectá la planilla MRP y tocá Sincronizar.</div>
      ) : (
        <>
          <div className="text-[13px] text-gypi-dim mb-2" role="status">
            {filtrados.length === articulos.length ? `${articulos.length} artículos` : `${filtrados.length} de ${articulos.length} artículos`}
            {filtrados.length > mostrar ? `. Se ven los primeros ${mostrar}.` : ""}
          </div>
          {!elegidos.size && (
            <div className="flex flex-wrap items-center gap-x-2 mb-2 text-[12px] text-gypi-dim">
              <span>🏷 Rótulos con QR (y la foto, si tiene): tildá los artículos, o</span>
              <button onClick={elegirFiltrados} disabled={!filtrados.length}
                className="min-h-[32px] p-0 bg-transparent border-none text-[12px] font-semibold text-gypi-amber-ink cursor-pointer">
                Elegir {Math.min(filtrados.length, MAX_ETIQUETAS_ARTICULO)} de la lista
              </button>
              {conFotoTotal > 0 && (
                <button onClick={elegirConFoto}
                  className="min-h-[32px] p-0 bg-transparent border-none text-[12px] font-semibold text-gypi-amber-ink cursor-pointer">
                  · Elegir los que tienen foto
                </button>
              )}
            </div>
          )}
          <ul className="list-none m-0 p-0 lista-ancha flex flex-col gap-1.5">
            {filtrados.slice(0, mostrar).map((a) => (
              <li key={a.sku} className="flex items-center gap-2 p-2 rounded-[10px] border border-gypi-border bg-gypi-surface">
                <input type="checkbox" checked={elegidos.has(a.sku)} onChange={() => alternar(a.sku)}
                  aria-label={`Etiqueta de ${a.nombre || a.sku}`} className="w-6 h-6 shrink-0 cursor-pointer" />
                {conPrecios ? <FotoRenglon articulo={a} onFoto={ponerFoto} />
                  : a.foto_url && <img src={a.foto_url} alt="" loading="lazy" className="w-11 h-11 shrink-0 object-cover rounded-[8px] border border-gypi-border" />}
                <button onClick={() => setFicha(a)} className="flex-1 min-w-0 min-h-[44px] text-left bg-transparent border-none p-0 cursor-pointer text-gypi-text font-body">
                  <div className="text-[14px] font-semibold truncate">{a.nombre || a.sku}</div>
                  <div className="text-[12px] text-gypi-dim truncate">{a.origen === "gypi" ? "🆕 Nuevo, falta pasar a la planilla · " : ""}{a.sku}{a.division ? ` · ${a.division}` : ""}</div>
                  {ultimos.has(a.sku) && (
                    <div className="text-[12px] text-gypi-dim truncate">
                      💲 <b className="text-gypi-text">{textoPrecio(ultimos.get(a.sku).precio)}</b> · {textoFechaPrecio(ultimos.get(a.sku))}
                    </div>
                  )}
                </button>
                <div className="text-right shrink-0">
                  <div className="text-[14px] font-bold">{cantidadTexto(a.disponible ?? a.stock)} <span className="text-[12px] font-semibold text-gypi-dim">{a.unidad || ""}</span></div>
                  <Semaforo texto={a.semaforo} />
                </div>
              </li>
            ))}
          </ul>
          {filtrados.length > mostrar && (
            <button onClick={() => setMostrar((m) => m + MOSTRAR)} className="g-btn g-btn-secondary w-full mt-3">
              Mostrar {Math.min(MOSTRAR, filtrados.length - mostrar)} más ({filtrados.length - mostrar} sin ver)
            </button>
          )}
        </>
      )}
      {ficha && <FichaArticulo sku={ficha.sku} articulo={ficha} usuario={usuario} empresaId={empresaId} onClose={() => setFicha(null)}
        onFoto={ponerFoto} />}
    </div>
  );
}
