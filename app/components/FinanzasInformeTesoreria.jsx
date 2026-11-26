'use client';
// app/components/FinanzasInformeTesoreria.jsx — Finanzas → Informes → 🏧
// Informe de tesorería (pedido de Tadeo del 19/11; reglas en
// app/lib/finanzasInformeTesoreria.js). Sin migración: usa lo que ya devuelven
// Cajas y bancos, Inversiones, Plazos fijos y Cheques. Siempre a hoy.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { plata } from "../lib/finanzasOperaciones";
import { COLOR_REPARTO, DIAS_CALCE, SEMANAS_CALCE, exportarInformeTesoreria, geometriaColumnas, informeTesoreria, repartoFondos, serieCalce, serieCobrar } from "../lib/finanzasInformeTesoreria";
import { Chip, Spinner } from "./ui";
import BotonesExportar from "./FinanzasExportar";

async function leer(url, error) {
  const res = await apiFetch(url);
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || error);
  return d;
}

const dma = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : "");
const tono = (n) => (n < -0.005 ? "text-gypi-red" : n > 0.005 ? "text-gypi-green" : "text-gypi-text");
const guion = (n, m) => (Math.abs(n) >= 0.005 ? plata(n, m) : "–");

function Seccion({ titulo, children }) {
  return (
    <section aria-label={titulo} className="flex flex-col gap-2 rounded-xl border border-gypi-border p-3">
      <h2 className="m-0 text-[16px] font-bold text-gypi-text">{titulo}</h2>
      {children}
    </section>
  );
}

function Tabla({ cab, children }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gypi-border">
      <table className="w-full text-[13px] text-gypi-text border-collapse">
        <thead>
          <tr className="bg-gypi-surface text-gypi-dim text-[12px]">
            {cab.map((c, i) => <th key={c} className={`px-2 py-1.5 whitespace-nowrap ${i === 0 ? "text-left" : "text-right"}`}>{c}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const Num = ({ children, className = "" }) => <td className={`px-2 py-1.5 text-right font-mono whitespace-nowrap ${className}`}>{children}</td>;

/** El renglón de un cheque o un plazo fijo, debajo de su semana o su día. */
function Item({ x, columnas }) {
  return (
    <tr className="border-t border-gypi-border bg-gypi-surface/50 text-[12px]">
      <td className="px-2 py-1 pl-6 text-gypi-dim" colSpan={columnas - 1}>
        {dma(x.fecha)} · {x.clase === "plazo" ? "🏦 Plazo fijo" : "🧾 Cheque"} {x.detalle}{x.quien ? ` · ${x.quien}` : ""}
      </td>
      <Num className="text-gypi-dim">{plata(x.importe, "ARS")}</Num>
    </tr>
  );
}

function TablaCalce({ filas, titulo }) {
  const [abiertos, setAbiertos] = useState(() => new Set());
  const alternar = (id) => setAbiertos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Tabla cab={[titulo, "Cheques a debitar", "Vencen plazos fijos", "Diferencia", "Acumulado"]}>
      {filas.map((t) => (
        <Fragment key={t.id}>
          <tr className="border-t border-gypi-border">
            <td className="px-2 py-1.5">
              {t.items.length ? (
                <button type="button" className="text-left text-gypi-text font-semibold bg-transparent border-0 p-0 cursor-pointer" aria-expanded={abiertos.has(t.id)} onClick={() => alternar(t.id)}>
                  {abiertos.has(t.id) ? "▾" : "▸"} {t.etiqueta}
                </button>
              ) : <span className="text-gypi-dim">{t.etiqueta}</span>}
            </td>
            <Num>{guion(t.cheques)}</Num>
            <Num>{guion(t.plazos)}</Num>
            <Num className={tono(t.diferencia)}>{guion(t.diferencia)}</Num>
            <Num className={`font-semibold ${tono(t.acumulado)}`}>{plata(t.acumulado, "ARS")}</Num>
          </tr>
          {abiertos.has(t.id) && t.items.map((x, i) => <Item key={`${t.id}-${i}`} x={x} columnas={5} />)}
        </Fragment>
      ))}
    </Tabla>
  );
}

/* Gráficos (19/11): los colores salen del tema de la app, así se ven bien en claro y en oscuro. */
const C = { rojo: "var(--color-red)", verde: "var(--color-green)", cyan: "var(--color-cyan)", linea: "var(--color-text-dim)", texto: "var(--color-text-dim)" };
// Colores bien distintos entre sí (19/11), los mismos que en el PDF
const COLOR_PARTE = COLOR_REPARTO;
const pctTxt = (n) => `${String(n).replace(".", ",")} %`;

function Leyenda({ items }) {
  return (
    <ul className="m-0 p-0 list-none flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-gypi-dim">
      {items.map(([color, texto]) => (
        <li key={texto} className="flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden="true"><rect width="10" height="10" rx="2" fill={color} /></svg>
          {texto}
        </li>
      ))}
    </ul>
  );
}

/** ¿Dónde está la plata?: una barra repartida por cajas, bancos, FCI, títulos y plazos fijos. */
function GraficoReparto({ r }) {
  const rep = repartoFondos(r);
  if (!rep.partes.length) return null;
  return (
    <figure className="m-0 flex flex-col gap-1.5" aria-label="Dónde está la plata en pesos">
      <svg viewBox="0 0 700 26" className="w-full h-auto rounded-md block" role="img" aria-label={rep.partes.map((p) => `${p.nombre} ${pctTxt(p.pct)}`).join(", ")}>
        {rep.partes.map((p) => (
          <g key={p.id}>
            <rect x={p.desde * 7} y="0" width={p.pct * 7} height="26" fill={COLOR_PARTE[p.id]}><title>{`${p.nombre} ${pctTxt(p.pct)}`}</title></rect>
            {p.pct >= 7 && <text x={(p.desde + p.pct / 2) * 7} y="17" textAnchor="middle" fontSize="12" fontWeight="700" fill="white">{`${Math.round(p.pct)} %`}</text>}
          </g>
        ))}
      </svg>
      <Leyenda items={rep.partes.map((p) => [COLOR_PARTE[p.id], `${p.nombre} ${pctTxt(p.pct)} · ${plata(p.valor, "ARS")}`])} />
    </figure>
  );
}

/** Columnas por tramo (una o dos) y, si hay, la línea del acumulado. */
function GraficoColumnas({ serie, H = 230, linea = false, nombres, colores, titulo }) {
  if (!serie.length) return null;
  const g = geometriaColumnas(serie, { linea, H });
  const Col = ({ c, color, nombre, et }) => (c && c.h > 0.4 ? <rect x={c.x} y={c.y} width={c.w} height={c.h} rx="2" fill={color}><title>{`${et} · ${nombre} ${plata(c.v, "ARS")}`}</title></rect> : null);
  return (
    <figure className="m-0 flex flex-col gap-1.5" aria-label={titulo}>
      <svg viewBox={`0 0 ${g.W} ${g.H}`} className="w-full h-auto block" role="img" aria-label={titulo}>
        <line x1={g.izq} x2={g.W - g.der} y1={g.cero} y2={g.cero} stroke={C.linea} />
        {g.cols.map((c, i) => (
          <g key={i}>
            <Col c={c.a} color={colores[0]} nombre={nombres[0]} et={c.etiqueta} />
            <Col c={c.b} color={colores[1]} nombre={nombres[1]} et={c.etiqueta} />
            {[[c.montoA, colores[0], "a"], [c.montoB, colores[1], "b"]].map(([m, color, k]) => (m ? <text key={k} x={m.x} y={m.y} textAnchor="middle" fontSize="10" fontWeight="700" fill={color}>{m.texto}</text> : null))}
            {c.mostrarEtiqueta && <text x={c.x} y={g.ejeY} textAnchor="middle" fontSize="11" fill={C.texto}>{c.etiqueta}</text>}
            {c.dif && <text x={c.x} y={g.difY} textAnchor="middle" fontSize="10" fontWeight="700" fill={c.dif.valor < 0 ? C.rojo : C.verde}>{c.dif.texto}</text>}
          </g>
        ))}
        {linea && (
          <>
            <polyline points={g.puntos} fill="none" stroke={C.cyan} strokeWidth="2.5" strokeLinejoin="round" />
            {g.cols.map((c, i) => <circle key={i} cx={c.x} cy={c.linea} r="3" fill={C.cyan} />)}
          </>
        )}
      </svg>
      <Leyenda items={[[colores[0], nombres[0]], ...(nombres[1] ? [[colores[1], nombres[1]]] : []), ...(linea ? [[C.cyan, "Acumulado (debajo de la raya, falta plata). Abajo de cada fecha, la diferencia"]] : [])]} />
    </figure>
  );
}

export default function FinanzasInformeTesoreria() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [vista, setVista] = useState("semanal");

  const cargar = useCallback(async () => {
    try {
      const [tes, inv, pf, ch] = await Promise.all([
        leer("/api/finanzas/tesoreria", "No se pudieron cargar las cajas y bancos"),
        leer("/api/finanzas/inversiones", "No se pudieron cargar las inversiones"),
        leer("/api/finanzas/plazos-fijos", "No se pudieron cargar los plazos fijos"),
        leer("/api/finanzas/cheques", "No se pudieron cargar los cheques"),
      ]);
      setDatos({ tes, inv, pf, ch });
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const r = useMemo(() => {
    if (!datos) return null;
    const { tes, inv, pf, ch } = datos;
    const prov = new Map((ch.proveedores || []).map((p) => [Number(p.id), p.nombre]));
    const quien = (c) => (c.clase === "propio" ? prov.get(Number(c.proveedor_id)) || c.beneficiario : c.recibido_de || c.librador) || "";
    return informeTesoreria({
      hoy: pf.hoy || inv.hoy, tesoreria: tes.tesoreria || [], operaciones: tes.operaciones || [], inversiones: inv,
      plazos: pf.plazos || [], cheques: ch.cheques || [], feriados: ch.feriados || null, quien,
    });
  }, [datos]);

  if (error) return <p role="alert" className="m-[18px] text-[14px] text-gypi-red">⚠ {error}</p>;
  if (!r) return <div className="flex-1 flex items-center justify-center py-10"><Spinner /></div>;
  const res = r.resumen;
  const kpis = [
    { label: "Pesos en cajas y bancos", valor: plata(res.pesos, "ARS") },
    { label: "Dólares en cajas y bancos", valor: plata(res.dolares, "USD") },
    { label: "Invertido", valor: plata(res.invertido_ars, "ARS") + (res.invertido_usd ? ` + ${plata(res.invertido_usd, "USD")}` : "") },
    { label: "Cheques a pagar", valor: plata(res.cheques_pagar, "ARS"), clase: "text-gypi-red" },
    { label: "Cheques a cobrar", valor: plata(res.cheques_cobrar, "ARS"), clase: "text-gypi-green" },
  ];

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="m-0 text-[13px] text-gypi-dim flex-1 min-w-[220px]">
          La plata de hoy en cajas, bancos e inversiones, si los plazos fijos alcanzan para los cheques que se debitan y lo que hay para cobrar. Siempre con los datos de hoy ({dma(r.hoy)}).
        </p>
        <button type="button" className="g-btn g-btn-secondary" onClick={() => { setDatos(null); cargar(); }}>🔄 Actualizar</button>
        <BotonesExportar nombre="el Reporte de Tesorería" informe={() => exportarInformeTesoreria(r)} />
      </div>

      <dl className="m-0 grid grid-cols-2 sm:grid-cols-5 gap-2">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg border border-gypi-border bg-gypi-surface px-3 py-2">
            <dt className="text-[12px] text-gypi-dim">{k.label}</dt>
            <dd className={`m-0 font-mono font-semibold text-[14px] break-words ${k.clase || "text-gypi-text"}`}>{k.valor}</dd>
          </div>
        ))}
      </dl>

      <Seccion titulo="¿Dónde está la plata? (en pesos)">
        <GraficoReparto r={r} />
        {!repartoFondos(r).partes.length && <p className="m-0 text-[13px] text-gypi-dim">No hay plata en pesos.</p>}
      </Seccion>

      <Seccion titulo="1. Cajas y bancos">
        {["ARS", "USD"].filter((m) => r.fondos[m].cajas.length).map((m) => (
          <Tabla key={m} cab={[m === "USD" ? "En dólares" : "En pesos", "Saldo"]}>
            {r.fondos[m].cajas.map((c) => (
              <tr key={c.cuenta} className="border-t border-gypi-border">
                <td className="px-2 py-1.5">{c.tipo === "caja" ? "💵" : "🏦"} {c.nombre}</td>
                <Num className={c.saldo < 0 ? "text-gypi-red" : ""}>{plata(c.saldo, m)}</Num>
              </tr>
            ))}
            <tr className="border-t-2 border-gypi-border font-bold"><td className="px-2 py-1.5">Total</td><Num>{plata(r.fondos[m].total, m)}</Num></tr>
          </Tabla>
        ))}
        {!r.fondos.ARS.cajas.length && !r.fondos.USD.cajas.length && <p className="m-0 text-[13px] text-gypi-dim">No hay cajas ni bancos.</p>}
      </Seccion>

      <Seccion titulo="2. Inversiones">
        {r.fci.length > 0 && (
          <Tabla cab={["Fondos comunes de inversión", "Saldo"]}>
            {r.fci.map((f) => <tr key={f.nombre} className="border-t border-gypi-border"><td className="px-2 py-1.5">{f.nombre}</td><Num>{plata(f.saldo, f.moneda)}</Num></tr>)}
          </Tabla>
        )}
        {r.titulos.especies.length > 0 && (
          <Tabla cab={["Títulos públicos y privados", "Láminas", "Cotización", "Valor"]}>
            {r.titulos.especies.map((e) => (
              <tr key={e.especie} className="border-t border-gypi-border">
                <td className="px-2 py-1.5">{e.especie}{e.nombre ? <span className="text-gypi-dim"> · {e.nombre}</span> : null}</td>
                <Num>{e.laminas.toLocaleString("es-AR")}</Num>
                <Num>{plata(e.cotizacion, e.moneda)}</Num>
                <Num>{plata(e.valor, e.moneda)}</Num>
              </tr>
            ))}
            <tr className="border-t-2 border-gypi-border font-bold"><td className="px-2 py-1.5" colSpan={3}>Total en pesos{r.titulos.tipo_cambio ? ` (dólar a ${plata(r.titulos.tipo_cambio, "ARS")})` : ""}</td><Num>{plata(r.titulos.valor, "ARS")}</Num></tr>
          </Tabla>
        )}
        {r.titulos.falta_tc && <p className="m-0 text-[13px] text-gypi-red">⚠ Falta el tipo de cambio en Inversiones: lo que está en dólares no suma en el total.</p>}
        {r.plazos.length > 0 && (
          <Tabla cab={["Plazos fijos vigentes", "Vence", "Capital", "Devuelve"]}>
            {r.plazos.map((p) => (
              <tr key={p.certificado} className="border-t border-gypi-border">
                <td className="px-2 py-1.5">N° {p.certificado}{p.vencido && <span className="text-gypi-red"> · vencido sin registrar</span>}</td>
                <Num>{dma(p.vencimiento)}</Num>
                <Num>{plata(p.depositado, p.moneda)}</Num>
                <Num>{plata(p.reembolsar, p.moneda)}</Num>
              </tr>
            ))}
          </Tabla>
        )}
        {!r.fci.length && !r.titulos.especies.length && !r.plazos.length && <p className="m-0 text-[13px] text-gypi-dim">No hay inversiones cargadas.</p>}
      </Seccion>

      <Seccion titulo="3. Calce de cheques a pagar y plazos fijos">
        <p className="m-0 text-[13px] text-gypi-dim">
          Solo cheques propios contra plazos fijos en pesos, sin contar la plata de los bancos. Diferencia = lo que entra por plazos fijos menos lo que se debita. En rojo, falta plata. Tocá una semana o un día para ver cada cheque y cada plazo fijo.
        </p>
        {r.calce.faltante && <p className="m-0 text-[13px] font-semibold text-gypi-red">⚠ En algún momento de las próximas {SEMANAS_CALCE} semanas los plazos fijos no alcanzan para los cheques.</p>}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Ver el calce">
          <Chip active={vista === "semanal"} onClick={() => setVista("semanal")}>Por semana ({SEMANAS_CALCE} semanas)</Chip>
          <Chip active={vista === "diario"} onClick={() => setVista("diario")}>Por día (próximos {DIAS_CALCE} días)</Chip>
        </div>
        <GraficoColumnas
          key={vista}
          serie={serieCalce(vista === "semanal" ? r.calce.semanal : r.calce.diario)}
          linea nombres={["Cheques a debitar", "Vencen plazos fijos"]} colores={[C.rojo, C.verde]}
          titulo={vista === "semanal" ? "Calce por semana" : "Calce por día"}
        />
        {vista === "semanal"
          ? <TablaCalce key="semanal" filas={r.calce.semanal} titulo="Semana" />
          : <TablaCalce key="diario" filas={r.calce.diario} titulo="Día" />}
        {r.calce.pf_usd.length > 0 && <p className="m-0 text-[12px] text-gypi-dim">Los plazos fijos en dólares no entran en el calce (los cheques son en pesos).</p>}
      </Seccion>

      <Seccion titulo="4. Cheques a cobrar">
        {r.cobrar.length > 0 && <GraficoColumnas serie={serieCobrar(r).map((t) => ({ etiqueta: t.etiqueta, a: t.total }))} H={160} nombres={["Cheques que se acreditan"]} colores={[C.verde]} titulo="Cheques a cobrar por semana" />}
        {r.cobrar.length ? (
          <Tabla cab={["Se acredita", "Importe"]}>
            {r.cobrar.map((t) => (
              <Fragment key={t.id}>
                <tr className="border-t border-gypi-border font-semibold">
                  <td className={`px-2 py-1.5 ${t.id === "vencidos" ? "text-gypi-red" : ""}`}>{t.etiqueta} · {t.items.length} {t.items.length === 1 ? "cheque" : "cheques"}</td>
                  <Num>{plata(t.total, "ARS")}</Num>
                </tr>
                {t.items.map((x, i) => <Item key={`${t.id}-${i}`} x={x} columnas={2} />)}
              </Fragment>
            ))}
            <tr className="border-t-2 border-gypi-border font-bold"><td className="px-2 py-1.5">Total a cobrar</td><Num>{plata(res.cheques_cobrar, "ARS")}</Num></tr>
          </Tabla>
        ) : <p className="m-0 text-[13px] text-gypi-dim">No hay cheques de terceros en cartera.</p>}
      </Seccion>
    </div>
  );
}
