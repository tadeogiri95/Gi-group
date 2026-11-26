"use client";
// app/components/ResumenMateriales.jsx — 🧮 Resumen de materiales (Tadeo,
// 26/11; antes "Material de varios días", 05/11). En el 📅 Plan del Tablero:
// se elige una semana (por defecto la que viene) o días sueltos y sale lo
// necesario y lo que falta, separado en Faplac, Egger, Herrajes y Cantos
// (más "Otros" si hay algo que no entra), cada uno para bajar en PDF o Excel
// y pasárselo al proveedor. Las cuentas están en app/lib/resumenMateriales.js.
import { useMemo, useState } from "react";
import { Chip } from "./ui";
import { fechaCorta } from "../lib/ot";
import { cantidadTexto } from "../lib/stock";
import { materialDelDia, otsDeLosDias } from "../lib/materialDia";
import { otCompleta, textoOt } from "../lib/nombreOt";
import { bajarArchivo } from "../lib/finanzasInformes";
import {
  armarResumenes, semanasDelPlan, semanaQueViene, textoPeriodo,
  resumenesXlsx, descargarPdfResumenes, nombreArchivo,
} from "../lib/resumenMateriales";

const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const nombreDia = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`).toLocaleDateString("es-AR", { weekday: "short", timeZone: "UTC" });
  return `${d.charAt(0).toUpperCase()}${d.slice(1).replace(".", "")} ${fechaCorta(iso)}`;
};

function Renglon({ f, porOt }) {
  return (
    <li className="text-[13px] flex flex-wrap items-center gap-x-2 border-t border-gypi-border pt-1">
      <span className="font-bold flex-1 min-w-0">{f.nombre}</span>
      <span className="text-gypi-dim">necesita {cantidadTexto(f.cantidad)}{f.unidad ? ` ${f.unidad}` : ""} · stock {cantidadTexto(f.stock)}</span>
      <span className={f.faltan > 0 ? "text-gypi-red font-bold" : "text-gypi-green"}>{f.faltan > 0 ? `faltan ${cantidadTexto(f.faltan)}` : "✅"}</span>
      <span className="w-full text-xs text-gypi-dim">{f.sku} · {f.ots.map((ot) => textoOt(otCompleta(ot, porOt))).join(" / ")}</span>
    </li>
  );
}

export default function ResumenMateriales({ dias, hoy, datos, porOt, modo, empresa = "" }) {
  const semanas = useMemo(() => semanasDelPlan(dias.map((d) => d.fecha), hoy, modo), [dias, hoy, modo]);
  const proxima = semanaQueViene(hoy, modo);
  const [elegidos, setElegidos] = useState(() => new Set(dias.map((d) => d.fecha).filter((f) => f >= proxima.desde && f <= proxima.hasta)));
  const [soloFalta, setSoloFalta] = useState(false);
  const [pestana, setPestana] = useState("faplac");
  const [aviso, setAviso] = useState(null);

  const todos = dias.length > 0 && elegidos.size === dias.length;
  const cambiar = (fechas) => setElegidos((prev) => {
    const n = new Set(prev);
    const quitar = fechas.every((f) => n.has(f));
    for (const f of fechas) { if (quitar) n.delete(f); else n.add(f); }
    return n;
  });

  const material = elegidos.size ? materialDelDia(otsDeLosDias(dias, elegidos), datos) : null;
  const resumenes = material ? armarResumenes(material.filas, { soloFalta }) : [];
  const visibles = resumenes.filter((r) => r.id !== "otros" || r.total > 0);
  const actual = visibles.find((r) => r.id === pestana) || visibles[0];
  const periodo = textoPeriodo([...elegidos], semanas);
  const datosArchivo = { periodo, empresa, fecha: fechaCorta(hoy) };
  const proximaEnPlan = semanas.some((s) => s.desde === proxima.desde);

  const bajarPdf = async (lista) => {
    setAviso(null);
    if (!lista.some((r) => r.filas.length)) { setAviso("No hay artículos para bajar."); return; }
    try { await descargarPdfResumenes(lista, datosArchivo); } catch { setAviso("No se pudo armar el PDF. Probá de nuevo."); }
  };
  const bajarExcel = (lista) => {
    setAviso(null);
    const bytes = resumenesXlsx(lista, datosArchivo);
    if (!bytes) { setAviso("No hay artículos para bajar."); return; }
    bajarArchivo(bytes, nombreArchivo(lista, periodo, "xlsx"), TIPO_XLSX);
  };

  return (
    <div className="mt-3 border-t border-gypi-border pt-2.5" data-material-varios>
      <div className="text-[14px] font-bold mb-1">🧮 Resumen de materiales</div>
      <div className="text-xs text-gypi-dim mb-1.5">Elegí una semana o tocá los días. Sale lo necesario y lo que falta, para pasar al proveedor.</div>
      {semanas.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5" role="group" aria-label="Semanas">
          {semanas.map((s) => (
            <Chip key={s.desde} type="button" active={s.fechas.every((f) => elegidos.has(f))} onClick={() => cambiar(s.fechas)}>
              Semana {s.numero}{s.desde === proxima.desde ? " · la que viene" : ""}
            </Chip>
          ))}
        </div>
      )}
      {!proximaEnPlan && (
        <div className="text-xs text-gypi-dim mb-1.5">La semana que viene (Semana {proxima.numero}) todavía no tiene nada en el plan confirmado.</div>
      )}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Días a sumar">
        <Chip type="button" active={todos} onClick={() => setElegidos(todos ? new Set() : new Set(dias.map((d) => d.fecha)))}>Todos</Chip>
        {dias.map((d) => (
          <Chip key={d.fecha} type="button" active={elegidos.has(d.fecha)} onClick={() => cambiar([d.fecha])}>
            {d.fecha === hoy ? "Hoy " : ""}{nombreDia(d.fecha)}
          </Chip>
        ))}
      </div>
      {material && !material.filas.length && (
        <div className="text-[14px] text-gypi-dim mt-1.5">Esos días no necesitan material (o ya se retiró todo).</div>
      )}
      {material && material.filas.length > 0 && actual && (
        <div className="mt-2" aria-live="polite">
          <div className={`text-[14px] font-bold ${material.conFalta ? "text-gypi-red" : "text-gypi-green"}`}>
            {periodo} · {material.conFalta
              ? `🔴 Faltan ${material.conFalta} de ${material.filas.length} ${material.filas.length === 1 ? "artículo" : "artículos"}`
              : `✅ Hay stock de ${material.filas.length === 1 ? "1 artículo" : `los ${material.filas.length} artículos`}`}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1.5" role="tablist" aria-label="Resúmenes">
            {visibles.map((r) => (
              <Chip key={r.id} type="button" role="tab" aria-selected={r.id === actual.id} active={r.id === actual.id} onClick={() => setPestana(r.id)}>
                {r.nombre} ({r.total}){r.conFalta ? " 🔴" : ""}
              </Chip>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[14px] mt-1.5 min-h-[44px] cursor-pointer">
            <input type="checkbox" checked={soloFalta} onChange={(e) => setSoloFalta(e.target.checked)} className="w-5 h-5" />
            Solo lo que falta pedir
          </label>
          <div role="tabpanel" aria-label={`Resumen de ${actual.nombre}`}>
            {!actual.filas.length && (
              <div className="text-[14px] text-gypi-dim">{actual.total ? `No falta nada de ${actual.nombre}.` : `Esos días no llevan ${actual.nombre}.`}</div>
            )}
            {actual.grupos.map((g) => (
              <div key={g.tipo || "todo"} className="mt-1">
                {actual.porTipo && <div className="text-[13px] font-bold text-gypi-dim uppercase mt-1.5">{g.tipo}</div>}
                <ul className="list-none m-0 p-0 flex flex-col gap-1">
                  {g.filas.map((f) => <Renglon key={f.sku} f={f} porOt={porOt} />)}
                </ul>
              </div>
            ))}
            <div className="flex flex-wrap gap-2 mt-2">
              <button type="button" className="g-btn g-btn-secondary flex-1" onClick={() => bajarPdf([actual])}>📄 PDF de {actual.nombre}</button>
              <button type="button" className="g-btn g-btn-secondary flex-1" onClick={() => bajarExcel([actual])}>📊 Excel de {actual.nombre}</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            <button type="button" className="g-btn g-btn-primary flex-1" onClick={() => bajarPdf(visibles)}>📄 Todos en un PDF</button>
            <button type="button" className="g-btn g-btn-primary flex-1" onClick={() => bajarExcel(visibles)}>📊 Todos en un Excel</button>
          </div>
          {aviso && <div role="alert" className="text-[14px] text-gypi-red mt-1.5">{aviso}</div>}
        </div>
      )}
    </div>
  );
}
