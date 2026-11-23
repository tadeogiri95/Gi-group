'use client';
// app/components/InventarioScreen.jsx — Materiales → 📊 Inventario (pedido de
// Tadeo 17/11; migración 196). Cada artículo del stock con su cantidad, su
// precio unitario sin IVA y su valor, y el total del inventario, a la fecha
// que se elija. Reglas en app/lib/inventarioValorizado.js; los datos los arma
// GET /api/stock/inventario. Solo la oficina (muestra precios).
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { Chip, Stat } from "./ui";
import { fmtPesos } from "../lib/costo";
import { cantidadTexto } from "../lib/stock";
import { filtrarInventario, inventarioXlsx, sumaValor } from "../lib/inventarioValorizado";
import { hoyAr } from "../lib/finanzasOperaciones";
import { BotonesCargar } from "./MovimientosStock";

const MOSTRAR = 200;
const dma = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : "");

/** De dónde sale la cantidad del día elegido, dicho simple. */
export function textoOrigen(inv) {
  if (!inv) return "";
  if (inv.desde === "hoy" && inv.fecha === inv.hoy) return "Stock de hoy, según la última sincronización con la planilla MRP.";
  if (inv.desde === "foto" && inv.foto_de === inv.fecha) return `Foto del stock guardada la noche del ${dma(inv.fecha)}.`;
  if (inv.desde === "foto") return `Foto del stock del ${dma(inv.foto_de)}, deshaciendo ${inv.movimientos_deshechos} movimientos cargados en Gypi después del ${dma(inv.fecha)}.`;
  return `Stock de hoy, deshaciendo ${inv.movimientos_deshechos} movimientos cargados en Gypi después del ${dma(inv.fecha)}. Lo cargado solo en la planilla no se puede deshacer.`;
}

export default function InventarioScreen({ empresa = null, usuario = null, onCargar = null }) {
  const [fecha, setFecha] = useState(() => hoyAr());
  const [inv, setInv] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [texto, setTexto] = useState("");
  const [division, setDivision] = useState("");
  const [orden, setOrden] = useState("valor");

  const cargar = useCallback(async (f) => {
    setCargando(true);
    setError(null);
    try {
      const r = await apiFetch(`/api/stock/inventario?fecha=${encodeURIComponent(f)}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo armar el inventario");
      setInv(d);
    } catch (e) {
      setError(e.message);
    }
    setCargando(false);
  }, []);
  useEffect(() => { if (fecha) cargar(fecha); }, [fecha, cargar]);

  const divisiones = useMemo(() => [...new Set((inv?.filas || []).map((f) => f.division).filter(Boolean))].sort(), [inv]);
  const filtradas = useMemo(() => {
    const l = filtrarInventario(inv?.filas || [], { texto, division });
    if (orden === "nombre") return [...l].sort((a, b) => String(a.nombre || a.sku).localeCompare(String(b.nombre || b.sku), "es"));
    return l;
  }, [inv, texto, division, orden]);
  const hayFiltro = !!(texto.trim() || division);

  const bajarExcel = () => {
    if (!inv) return;
    const blob = new Blob([inventarioXlsx(inv, { empresa: empresa?.nombre_corto || empresa?.nombre || "" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventario-${inv.fecha}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const puedeIngresar = usuario?.rol === "gerencial" || usuario?.rol === "administrativo";

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-28 text-gypi-text">
      {onCargar && <BotonesCargar puedeIngresar={puedeIngresar} onElegir={onCargar} />}

      <div className="flex flex-wrap items-end gap-2 mb-3">
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-dim">Inventario al día
          <input type="date" className="g-input" value={fecha} max={inv?.hoy || undefined} onChange={(e) => setFecha(e.target.value)} aria-label="Fecha del inventario" />
        </label>
        {fecha !== hoyAr() && <button onClick={() => setFecha(hoyAr())} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-amber-ink cursor-pointer font-body">Hoy</button>}
        <div className="flex-1" />
        <button onClick={bajarExcel} disabled={!inv?.filas?.length} className="g-btn g-btn-secondary">⬇ Bajar a Excel</button>
      </div>

      {error && <div role="alert" className="p-3 mb-3 rounded-[10px] bg-gypi-red/10 text-gypi-red text-[14px]">{error}</div>}

      {cargando && !inv ? (
        <div className="text-[14px] text-gypi-dim">Calculando el inventario…</div>
      ) : inv && (
        <>
          <div className="grid grid-cols-2 gap-2 mb-2" aria-busy={cargando}>
            <div className="col-span-2 sm:col-span-1"><Stat value={fmtPesos(inv.total)} label={`Valor total al ${dma(inv.fecha)}`} /></div>
            <div className="col-span-2 sm:col-span-1"><Stat value={inv.articulos} label="Artículos con stock" /></div>
          </div>
          <p className="m-0 mb-1 text-[12px] text-gypi-dim">{textoOrigen(inv)} Precio unitario sin IVA: la última compra hasta ese día.</p>
          {inv.sin_fotos && <p className="m-0 mb-1 text-[12px] text-gypi-amber-ink">Para que los días pasados sean exactos falta correr la migración 196 (foto diaria del stock).</p>}
          {(inv.sin_precio > 0 || inv.negativos > 0) && (
            <p className="m-0 mb-2 text-[13px] text-gypi-amber-ink">
              {inv.sin_precio > 0 && `⚠ ${inv.sin_precio} ${inv.sin_precio === 1 ? "artículo sin precio no suma" : "artículos sin precio no suman"}. `}
              {inv.negativos > 0 && `⚠ ${inv.negativos} con stock negativo, no ${inv.negativos === 1 ? "suma" : "suman"}.`}
            </p>
          )}

          {inv.por_division.length > 1 && (
            <ul aria-label="Valor por división" className="list-none p-0 m-0 mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
              {inv.por_division.map((d) => <li key={d.division}><span className="text-gypi-dim">{d.division}:</span> <b>{fmtPesos(d.valor)}</b></li>)}
            </ul>
          )}

          <input type="search" value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Buscar artículo"
            placeholder="Buscar por nombre, código o familia" className="g-input w-full mb-2" />
          <div className="flex gap-1.5 flex-wrap mb-2" role="group" aria-label="Filtros">
            <Chip active={!division} onClick={() => setDivision("")}>Todas</Chip>
            {divisiones.map((d) => <Chip key={d} active={division === d} onClick={() => setDivision(division === d ? "" : d)}>{d}</Chip>)}
            <span className="w-px bg-gypi-border mx-1" aria-hidden="true" />
            <Chip active={orden === "valor"} onClick={() => setOrden("valor")}>Mayor valor</Chip>
            <Chip active={orden === "nombre"} onClick={() => setOrden("nombre")}>A-Z</Chip>
          </div>
          <div className="text-[13px] text-gypi-dim mb-2" role="status">
            {hayFiltro ? `${filtradas.length} de ${inv.filas.length} artículos · ${fmtPesos(sumaValor(filtradas))}` : `${inv.filas.length} artículos`}
            {filtradas.length > MOSTRAR ? `. Se muestran los primeros ${MOSTRAR}: buscá para ver otros (el Excel tiene todos).` : ""}
          </div>

          <div className="lista-ancha overflow-x-auto rounded-[10px] border border-gypi-border bg-gypi-surface">
            <table className="w-full text-[13px] border-collapse">
              <thead>
                <tr className="text-left text-gypi-dim">
                  <th scope="col" className="p-2 font-semibold">Artículo</th>
                  <th scope="col" className="p-2 font-semibold text-right">Cantidad</th>
                  <th scope="col" className="p-2 font-semibold text-right">Precio unit.</th>
                  <th scope="col" className="p-2 font-semibold text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.slice(0, MOSTRAR).map((f) => (
                  <tr key={f.sku} className="border-t border-gypi-border align-top">
                    <td className="p-2 min-w-[140px]">
                      <div className="font-semibold">{f.nombre || f.sku}</div>
                      <div className="text-[12px] text-gypi-dim">{f.sku}{f.division ? ` · ${f.division}` : ""}</div>
                    </td>
                    <td className={`p-2 text-right whitespace-nowrap tabular-nums ${f.negativo ? "text-gypi-red font-bold" : ""}`}>{cantidadTexto(f.cantidad)} <span className="text-[12px] text-gypi-dim">{f.unidad || ""}</span></td>
                    <td className="p-2 text-right whitespace-nowrap tabular-nums" title={f.origen_precio ? `${f.origen_precio}${f.fecha_precio ? ` del ${dma(f.fecha_precio)}` : ""}${f.proveedor ? ` · ${f.proveedor}` : ""}` : undefined}>
                      {f.precio === null ? <span className="text-gypi-amber-ink">Sin precio</span> : fmtPesos(f.precio)}
                    </td>
                    <td className="p-2 text-right whitespace-nowrap tabular-nums font-semibold">{f.valor === null ? "—" : fmtPesos(f.valor)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gypi-border">
                  <th scope="row" colSpan={3} className="p-2 text-left">{hayFiltro ? "Total de lo filtrado" : "Total del inventario"}</th>
                  <td className="p-2 text-right whitespace-nowrap tabular-nums font-bold">{fmtPesos(hayFiltro ? sumaValor(filtradas) : inv.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
