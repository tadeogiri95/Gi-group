'use client';
// app/components/FinanzasCierre.jsx — Finanzas → 🔍 Cierre (parte F6c;
// /api/finanzas/cierre; reglas en app/lib/finanzasCierre.js).
//
// Se elige el mes y se sube el libro (.xlsx, Archivo → Descargar → Microsoft
// Excel). Gypi lee T-OPERACIONES en el navegador y compara los saldos al
// último día del mes (cajas y bancos, proveedores, clientes) y las
// operaciones del mes: las cargadas a mano en el libro, las de Gypi que no
// bajaron y las que se cambiaron en el libro.
// Parte 9 del 11/11: al pie, el stock valorizado contra la contabilidad.
// Solo el rol Dueño (la pantalla ni aparece para los demás).
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyAr } from "../lib/finanzasOperaciones";
import { fechaCorta } from "../lib/finanzasPagos";
import { finDeMes, nombreMes } from "../lib/finanzasResultados";
import { compararCierre } from "../lib/finanzasCierre";
import { Spinner } from "./ui";
import { StockValorizado } from "./FinanzasIntegracion";

const normal = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z]/g, "");
const plata = (n, moneda = "ARS") => `${moneda === "USD" ? "US$" : "$"} ${(Number(n) || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const rojo = (n) => (n < 0 ? "text-gypi-red" : "");

async function leerOperacionesDelLibro(file) {
  const { hojasXlsx, leerHojaXlsx } = await import("../lib/leerXlsx");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hoja = hojasXlsx(bytes).find((n) => normal(n) === "TOPERACIONES");
  if (!hoja) return null;
  return leerHojaXlsx(bytes, hoja, { maxFilas: 60000, maxCols: 60 }) || [];
}

function Titulo({ children, cantidad }) {
  return (
    <h3 className="m-0 mt-4 mb-1 text-[15px] font-bold text-gypi-text">
      {cantidad ? "⚠ " : "✅ "}{children}
    </h3>
  );
}

function Saldos({ titulo, r, explicacion }) {
  return (
    <section aria-label={titulo}>
      <Titulo cantidad={r.filas.length}>{titulo}</Titulo>
      <p className="m-0 mb-1 text-[13px] text-gypi-dim">
        {r.filas.length ? `${r.filas.length} no dan igual` : "Todos dan igual"}{r.iguales ? ` · ${r.iguales} iguales` : ""}. {explicacion}
      </p>
      {r.filas.length > 0 && (
        <div className="overflow-x-auto border border-gypi-border rounded-lg">
          <table className="w-full border-collapse text-[13px]" aria-label={titulo}>
            <thead>
              <tr className="bg-gypi-surface">
                <th className="text-left px-2 py-1.5">Nombre</th>
                <th className="text-right px-2 py-1.5">Gypi</th>
                <th className="text-right px-2 py-1.5">Libro</th>
                <th className="text-right px-2 py-1.5">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {r.filas.map((f) => (
                <tr key={f.clave} className="border-t border-gypi-border text-gypi-text">
                  <td className="px-2 py-1">{f.nombre}</td>
                  <td className={`px-2 py-1 text-right font-mono whitespace-nowrap ${rojo(f.gypi)}`}>{plata(f.gypi, f.moneda)}</td>
                  <td className={`px-2 py-1 text-right font-mono whitespace-nowrap ${rojo(f.libro)}`}>{plata(f.libro, f.moneda)}</td>
                  <td className="px-2 py-1 text-right font-mono whitespace-nowrap font-semibold text-gypi-red">{plata(f.diferencia, f.moneda)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Operaciones({ titulo, filas, explicacion, cuenta, columnas }) {
  return (
    <section aria-label={titulo}>
      <Titulo cantidad={filas.length}>{titulo}</Titulo>
      <p className="m-0 mb-1 text-[13px] text-gypi-dim">{filas.length ? `${filas.length}. ` : "Ninguna. "}{explicacion}</p>
      {filas.length > 0 && (
        <div className="overflow-x-auto border border-gypi-border rounded-lg">
          <table className="w-full border-collapse text-[13px]" aria-label={titulo}>
            <thead>
              <tr className="bg-gypi-surface">{columnas.map((c) => <th key={c} className="text-left px-2 py-1.5 whitespace-nowrap">{c}</th>)}</tr>
            </thead>
            <tbody>{filas.map(cuenta)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const celda = "px-2 py-1 align-top";
const CAMBIO = { fecha: "la fecha", total: "el total", cuentas: "las cuentas" };

export default function FinanzasCierre() {
  const hoy = hoyAr();
  const [mes, setMes] = useState(hoy.slice(0, 7));
  const [gypi, setGypi] = useState(null);
  const [grilla, setGrilla] = useState(null);
  const [archivo, setArchivo] = useState("");
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [leyendo, setLeyendo] = useState(false);
  const desde = `${mes}-01`;
  const hasta = mes === hoy.slice(0, 7) ? hoy : finDeMes(mes);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await apiFetch(`/api/finanzas/cierre?desde=${desde}&hasta=${hasta}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo leer lo de Gypi");
      setGypi(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [desde, hasta]);
  useEffect(() => { cargar(); }, [cargar]);

  async function abrir(file) {
    if (!file) return;
    setLeyendo(true);
    try {
      const g = await leerOperacionesDelLibro(file);
      if (!g) throw new Error("El archivo no tiene la hoja T-OPERACIONES.");
      setGrilla(g);
      setArchivo(file.name);
      setError(null);
    } catch (e) {
      setError(e.message || "No se pudo leer el archivo");
    } finally {
      setLeyendo(false);
    }
  }

  const r = useMemo(() => (gypi && grilla && gypi.hasta === hasta ? compararCierre({ gypi, grilla, desde, hasta }) : null), [gypi, grilla, desde, hasta]);
  const nombreCuenta = (c) => gypi?.nombres_cuentas?.[c] || c || "—";

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      <h2 className="m-0 mb-1 text-[16px] font-bold text-gypi-text">Cierre: Gypi contra el libro</h2>
      <p className="m-0 mb-2 text-[13px] text-gypi-dim">
        Elegí el mes y subí el libro (en Google Sheets: Archivo → Descargar → Microsoft Excel). Se comparan los saldos al {fechaCorta(hasta)} y las operaciones del mes. El archivo no se guarda: se lee en tu navegador.
      </p>
      <div className="flex flex-wrap items-end gap-3 mb-2">
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">
          Mes
          <input type="month" className="g-input" aria-label="Mes" value={mes} max={hoy.slice(0, 7)} onChange={(e) => e.target.value && setMes(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">
          Libro (.xlsx)
          <input type="file" accept=".xlsx" aria-label="Libro (.xlsx)" className="text-[13px]" onChange={(e) => abrir(e.target.files?.[0])} />
        </label>
        {(cargando || leyendo) && <Spinner size={16} />}
      </div>
      {error && <p role="alert" className="m-0 mb-2 text-[14px] text-gypi-red">⚠ {error}</p>}
      {!grilla && !leyendo && <p className="m-0 text-[13px] text-gypi-dim">Subí el libro para ver la comparación de {nombreMes(mes)}.</p>}
      {archivo && <p className="m-0 mb-1 text-[13px] text-gypi-dim">Libro: {archivo}</p>}

      {r?.error && <p role="alert" className="m-0 text-[14px] text-gypi-red">⚠ {r.error}</p>}
      {r && !r.error && (
        <>
          <p className={`m-0 mt-2 p-2 rounded-lg text-[14px] font-semibold ${r.ok ? "bg-gypi-surface text-gypi-text" : "bg-gypi-surface text-gypi-amber-ink"}`}>
            {r.ok ? `✅ ${nombreMes(mes)}: Gypi y el libro dan igual.` : `⚠ ${nombreMes(mes)}: hay diferencias. Abajo está qué no coincide y por qué.`}
          </p>
          {gypi.para_revisar > 0 && (
            <p className="m-0 mt-1 text-[13px] text-gypi-dim">Hay {gypi.para_revisar} operaciones del mes para revisar en Gypi: no cuentan hasta que se confirmen (tampoco van al libro).</p>
          )}
          {r.corte && <p className="m-0 mt-1 text-[13px] text-gypi-dim">Los saldos iniciales de Gypi son del {fechaCorta(r.corte)}: lo del libro hasta ese día ya está adentro.</p>}

          <Saldos titulo="Cajas y bancos" r={r.cajas} explicacion="Saldo de cada caja y banco en su moneda." />
          <Saldos titulo="Proveedores" r={r.proveedores} explicacion="Lo que se les debe (negativo = saldo a favor)." />
          <Saldos titulo="Clientes" r={r.clientes} explicacion="Lo que nos deben (negativo = saldo a favor)." />

          <Operaciones
            titulo="Cargadas solo en el libro" filas={r.solo_libro}
            explicacion="Renglones confirmados del mes que no vienen de Gypi: alguien los cargó a mano en el libro. Hay que cargarlos en Gypi (y borrarlos del libro, que el script los baja solo)."
            columnas={["Renglón", "Fecha", "Tipo", "Entidad", "Total"]}
            cuenta={(f) => (
              <tr key={f.fila} className="border-t border-gypi-border text-gypi-text">
                <td className={`${celda} font-mono`}>{f.fila}</td>
                <td className={`${celda} font-mono whitespace-nowrap`}>{fechaCorta(f.fecha)}</td>
                <td className={celda}>{f.tipo || "—"}</td>
                <td className={celda}>{f.entidad || f.descripcion || "—"}</td>
                <td className={`${celda} text-right font-mono whitespace-nowrap`}>{plata(f.total, f.moneda)}</td>
              </tr>
            )}
          />
          <Operaciones
            titulo="De Gypi que no están en el libro" filas={r.solo_gypi}
            explicacion="El script del libro las baja cada 15 minutos. Si siguen faltando, revisá en el libro Extensiones → Apps Script que el script esté andando."
            columnas={["N°", "Fecha", "Tipo", "Entidad", "Total"]}
            cuenta={(o) => (
              <tr key={o.id} className="border-t border-gypi-border text-gypi-text">
                <td className={`${celda} font-mono`}>{o.id}</td>
                <td className={`${celda} font-mono whitespace-nowrap`}>{fechaCorta(o.fecha)}</td>
                <td className={celda}>{o.tipo}</td>
                <td className={celda}>{o.entidad || o.descripcion || "—"}</td>
                <td className={`${celda} text-right font-mono whitespace-nowrap`}>{plata(o.total, o.moneda)}</td>
              </tr>
            )}
          />
          <Operaciones
            titulo="Cambiadas en el libro" filas={r.distintas}
            explicacion="Vienen de Gypi pero en el libro tienen otra fecha, otro total u otras cuentas. Lo que vale es Gypi: corregilo acá si hace falta y el script vuelve a escribir el renglón."
            columnas={["Renglón", "Gypi", "Libro", "Qué cambió"]}
            cuenta={(d) => (
              <tr key={d.id} className="border-t border-gypi-border text-gypi-text">
                <td className={`${celda} font-mono`}>{d.fila}</td>
                <td className={celda}>{fechaCorta(d.gypi.fecha)} · {d.gypi.tipo} · {plata(d.gypi.total, d.gypi.moneda)}<br /><span className="text-gypi-dim">{nombreCuenta(d.gypi.cuenta_debe)} / {nombreCuenta(d.gypi.cuenta_haber)}</span></td>
                <td className={celda}>{fechaCorta(d.libro.fecha)} · {d.libro.tipo} · {plata(d.libro.total, d.libro.moneda)}<br /><span className="text-gypi-dim">{nombreCuenta(d.libro.debe)} / {nombreCuenta(d.libro.haber)}</span></td>
                <td className={celda}>{d.cambios.map((c) => CAMBIO[c]).join(", ")}</td>
              </tr>
            )}
          />
          {r.sin_confirmar_en_libro > 0 && (
            <p className="m-0 mt-3 text-[13px] text-gypi-amber-ink">⚠ {r.sin_confirmar_en_libro} renglones que vienen de Gypi no están como CONFIRMADO en el libro (columna estado), así que el libro no los suma.</p>
          )}
        </>
      )}
      <StockValorizado />
    </div>
  );
}
