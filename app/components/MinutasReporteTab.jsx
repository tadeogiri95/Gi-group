'use client';
// app/components/MinutasReporteTab.jsx — Reportes → 📝 Minutas: el informe
// consolidado de las minutas de Buenos Días (Tadeo, 02/11), del día, de la
// semana o del mes, para leerlo de un vistazo: reunión, foco, OT terminadas
// con su valor, OT en curso con su estado y contingencias, pendientes con los
// días que llevan abiertos y feedback por tipo. La semana y el mes suman los
// informes de cada día. Solo gerencia con el módulo Minutas
// (app/lib/minutasReporte.js; la hoja para imprimir en app/lib/minutasInformePdf.js).
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyArg } from "../lib/dates";
import { fmtPesos } from "../lib/costo";
import { informeMinutas, rangoInforme, moverInforme, nombreInforme, HORA_REUNION } from "../lib/minutasReporte";
import { imprimirInformeMinutas, descargarPdfInformeMinutas, textoInformeMinutas } from "../lib/minutasInformePdf";
import { Chip } from "./ui";
import Stat from "./ui/Stat";

const MODOS = [
  { id: "dia", label: "Del día" },
  { id: "semana", label: "Semana" },
  { id: "mes", label: "Mes" },
];
const PUNTO = { verde: "🟢", amarillo: "🟡", rojo: "🔴" };
const RELLENO = { verde: "fill-gypi-green", amarillo: "fill-yellow-400", rojo: "fill-gypi-red", gris: "fill-gypi-border", marca: "fill-gypi-amber", violeta: "fill-gypi-violet", cyan: "fill-gypi-cyan" };
const COLOR_TIPO = { Error: "rojo", "Falta de dato": "violeta", Mejora: "cyan", Reconocimiento: "verde" };
const fmtDias = (d) => (d == null ? "—" : `${String(d).replace(".", ",")} ${d === 1 ? "día" : "días"}`);
const ddmm = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : "");
const nombreOt = (x) => [x.ot ? `OT ${x.ot}` : null, x.proyecto, x.cliente].filter(Boolean).join(" · ");

function Bloque({ titulo, children }) {
  return (
    <section aria-label={titulo} className="mb-5">
      <h3 className="m-0 mb-2 text-[15px] font-bold text-gypi-text font-heading">{titulo}</h3>
      {children}
    </section>
  );
}

const Vacio = ({ children }) => <div className="text-[13px] text-gypi-dim">{children}</div>;
const Grilla = ({ n = 2, children }) => <div className={`grid gap-2 mb-2 ${n === 3 ? "grid-cols-3" : n === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2"}`}>{children}</div>;

/** Barra horizontal con partes de colores (SVG: el ancho va en atributos, no en estilos). */
function Barra({ partes, max, etiqueta }) {
  const total = partes.reduce((s, p) => s + p.valor, 0);
  let x = 0;
  return (
    <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="w-full h-3.5 block" role="img" aria-label={etiqueta}>
      <rect x="0" y="0" width="100" height="10" rx="2" className="fill-gypi-surf-lo" />
      {max > 0 && total > 0 && partes.filter((p) => p.valor > 0).map((p, i) => {
        const w = (p.valor / max) * 100;
        const r = <rect key={i} x={x} y="0" width={w} height="10" className={RELLENO[p.color] || RELLENO.gris} />;
        x += w;
        return r;
      })}
    </svg>
  );
}

function FilaBarra({ nombre, partes, max, valor, detalle }) {
  return (
    <div className="py-1">
      <div className="flex items-baseline justify-between gap-2 text-[13px] mb-0.5">
        <span className="min-w-0 truncate">{nombre}</span>
        <span className="font-mono font-bold shrink-0">{valor}</span>
      </div>
      <Barra partes={partes} max={max} etiqueta={`${nombre}: ${valor}`} />
      {detalle && <div className="text-[12px] text-gypi-dim mt-0.5">{detalle}</div>}
    </div>
  );
}

/** Columnas apiladas: un punto por día (semana) o por semana (mes). */
function Columnas({ serie, partes, etiqueta }) {
  const max = Math.max(1, ...serie.map((p) => partes.reduce((s, c) => s + (p[c.clave] || 0), 0)));
  const ancho = 100 / Math.max(serie.length, 1);
  return (
    <div>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="w-full h-28 block" role="img" aria-label={etiqueta}>
        {serie.map((p, i) => {
          let y = 40;
          return partes.map((c) => {
            const h = ((p[c.clave] || 0) / max) * 38;
            y -= h;
            return h > 0 ? <rect key={`${p.clave}-${c.clave}`} x={i * ancho + ancho * 0.15} y={y} width={ancho * 0.7} height={h} className={RELLENO[c.color]} /> : null;
          });
        })}
        <line x1="0" y1="40" x2="100" y2="40" className="stroke-gypi-border" strokeWidth="0.5" />
      </svg>
      <div className="flex text-[12px] text-gypi-dim">
        {serie.map((p) => <div key={p.clave} className="flex-1 text-center truncate">{p.etiqueta}</div>)}
      </div>
      <div className="text-[12px] text-gypi-dim mt-1 flex flex-wrap gap-x-3">
        {partes.map((c) => <span key={c.clave}><Cuadrito color={c.color} /> {c.label}</span>)}
      </div>
    </div>
  );
}

function Cuadrito({ color }) {
  return <svg viewBox="0 0 10 10" className="inline-block w-2.5 h-2.5 align-middle" aria-hidden="true"><rect width="10" height="10" rx="2" className={RELLENO[color]} /></svg>;
}

function Renglon({ children, tono }) {
  const borde = tono === "rojo" ? "border-l-gypi-red" : tono === "amarillo" ? "border-l-yellow-400" : tono === "verde" ? "border-l-gypi-green" : "border-l-gypi-border";
  return <div className={`bg-gypi-surface rounded-xl p-2.5 border border-gypi-border border-l-4 ${borde} text-[13px]`}>{children}</div>;
}

const tonoDias = (p) => (p.resuelto ? "verde" : p.vencido || p.gerencia || (p.dias || 0) >= 3 ? "rojo" : "amarillo");

export default function MinutasReporteTab({ empresa = null }) {
  const hoy = hoyArg();
  const [modo, setModo] = useState("dia");
  const [fecha, setFecha] = useState(hoy);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const { desde, hasta } = rangoInforme(modo, fecha);
  const titulo = modo === "dia" && fecha === hoy ? `Hoy, ${nombreInforme(modo, fecha).toLowerCase()}` : nombreInforme(modo, fecha);

  useEffect(() => {
    let vivo = true;
    setDatos(null);
    setError(null);
    apiFetch(`/api/minutas?reporte=${desde}&hasta=${hasta}`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (vivo) (ok ? setDatos(j) : setError(j.error || "No se pudieron leer las minutas")); })
      .catch(() => { if (vivo) setError("No se pudieron leer las minutas"); });
    return () => { vivo = false; };
  }, [desde, hasta]);

  const inf = useMemo(() => (datos ? informeMinutas({ minutas: datos.minutas || [], items: datos.items || [], precios: datos.precios || {}, hoy, modo, hasta }) : null), [datos, hoy, modo, hasta]);
  const siguiente = moverInforme(modo, fecha, 1);
  const nombreEmpresa = empresa?.razon_social || empresa?.nombre || empresa?.nombre_corto || "";

  const [armandoPdf, setArmandoPdf] = useState(false);
  const imprimir = () => {
    try { imprimirInformeMinutas({ informe: inf, titulo, empresa: nombreEmpresa }); } catch (e) { setError(e.message); }
  };
  const descargar = async () => {
    setArmandoPdf(true);
    try { await descargarPdfInformeMinutas({ informe: inf, titulo, empresa: nombreEmpresa }); } catch { setError("No se pudo armar el PDF. Probá con 🖨 Imprimir."); } finally { setArmandoPdf(false); }
  };

  return (
    <div>
      <div className="flex gap-1.5 mb-2.5" role="group" aria-label="Período del informe">
        {MODOS.map((m) => <Chip key={m.id} active={modo === m.id} onClick={() => setModo(m.id)}>{m.label}</Chip>)}
      </div>
      <div className="flex items-center justify-between py-2.5 px-3.5 bg-gypi-surface rounded-[14px] border border-gypi-border mb-2.5">
        <button onClick={() => setFecha(moverInforme(modo, fecha, -1))} aria-label="Período anterior" className="min-w-[48px] min-h-[48px] flex items-center justify-center bg-transparent border-none text-gypi-text cursor-pointer text-xl">←</button>
        <div className="text-sm font-bold text-gypi-text font-heading text-center">{titulo}</div>
        <button onClick={() => setFecha(siguiente > hoy ? hoy : siguiente)} disabled={hasta >= hoy} aria-label="Período siguiente" className="min-w-[48px] min-h-[48px] flex items-center justify-center bg-transparent border-none text-gypi-text cursor-pointer text-xl disabled:opacity-30">→</button>
      </div>

      {error ? <div role="alert" className="text-[13px] text-gypi-red">{error}</div>
        : !inf ? <div className="gypi-dots" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>
          : !inf.reunion.cantidad ? <Vacio>No hay minutas guardadas {modo === "dia" ? "de este día" : modo === "semana" ? "en esta semana" : "en este mes"}.</Vacio>
            : (
              <>
                <button type="button" onClick={descargar} disabled={armandoPdf} className="g-btn g-btn-primary w-full mb-2">
                  {armandoPdf ? "Armando el PDF…" : "📄 Descargar PDF a color"}
                </button>
                <div className="flex gap-2 mb-4">
                  <button type="button" onClick={imprimir} className="g-btn g-btn-secondary flex-1">🖨 Imprimir</button>
                  <a href={`https://wa.me/?text=${encodeURIComponent(textoInformeMinutas(inf, titulo))}`} target="_blank" rel="noopener noreferrer" className="g-btn g-btn-secondary flex-1 text-center no-underline">💬 WhatsApp</a>
                </div>
                <Informe inf={inf} />
              </>
            )}
    </div>
  );
}

function Informe({ inf }) {
  const dia = inf.modo === "dia";
  const { reunion, foco, terminado, enCurso, pendientes, feedback, compras, serie } = inf;
  const r0 = reunion.dias[0];
  const conProblemas = enCurso.items.filter((x) => x.semaforo !== "verde");
  const enVerde = enCurso.items.filter((x) => x.semaforo === "verde");
  const maxAsis = reunion.cantidad;
  const maxFoco = Math.max(1, ...foco.porOt.map((f) => f.dias));
  const maxTipo = Math.max(1, ...feedback.porTipo.map((t) => t.n));
  const abiertos = pendientes.items.filter((p) => !p.resuelto);
  const resueltos = pendientes.items.filter((p) => p.resuelto);
  const maxResp = Math.max(1, ...pendientes.porResponsable.map((p) => p.abiertos + p.resueltos));

  return (
    <div>
      {/* 1. Reunión */}
      <Bloque titulo="⏱ Reunión">
        {dia ? (
          <>
            <Grilla n={3}>
              <Stat value={r0?.inicio ? `${r0.inicio}${r0.cierre ? ` – ${r0.cierre}` : ""}` : "—"} label={`Horario (empieza ${HORA_REUNION})`} tone={r0?.aHorario === false ? "atencion" : "bien"} />
              <Stat value={r0?.duracion == null ? "—" : `${r0.duracion} min`} label="Duración" tone={r0?.duracion > 20 ? "atencion" : "normal"} />
              <Stat value={r0?.asistentes.length ?? 0} label="Presentes" />
            </Grilla>
            <div className="text-[12px] text-gypi-dim px-1">
              {[r0?.modera && `Modera ${r0.modera}`, r0?.registra && `registra ${r0.registra}`].filter(Boolean).join(" · ")}
              {r0?.asistentes.length ? `${r0?.modera || r0?.registra ? " · " : ""}Estuvieron: ${r0.asistentes.join(", ")}` : ""}
            </div>
          </>
        ) : (
          <>
            <Grilla n={4}>
              <Stat value={reunion.cantidad} label={reunion.cantidad === 1 ? "Reunión" : "Reuniones"} />
              <Stat value={reunion.conInicio ? `${reunion.aHorario} de ${reunion.conInicio}` : "—"} label={`Empezaron a horario (${HORA_REUNION})`}
                tone={reunion.conInicio && reunion.aHorario < reunion.conInicio ? "atencion" : "bien"} />
              <Stat value={reunion.duracionPromedio == null ? "—" : `${reunion.duracionPromedio} min`} label="Duración promedio" tone={reunion.duracionPromedio > 20 ? "atencion" : "normal"} />
              <Stat value={String(reunion.presentesPromedio).replace(".", ",")} label="Presentes en promedio" />
            </Grilla>
            {reunion.asistencia.length > 0 && (
              <div aria-label="Asistencia de cada uno">
                {reunion.asistencia.map((a) => (
                  <FilaBarra key={a.nombre} nombre={a.nombre} max={maxAsis} valor={`${a.veces} de ${reunion.cantidad} · ${a.pct} %`}
                    partes={[{ valor: a.veces, color: a.pct >= 80 ? "verde" : a.pct >= 50 ? "amarillo" : "rojo" }]} />
                ))}
              </div>
            )}
          </>
        )}
      </Bloque>

      {/* 2. Foco */}
      <Bloque titulo="🎯 Foco del día">
        {!foco.items.length ? <Vacio>No se anotó foco.</Vacio> : dia ? (
          <ol className="m-0 p-0 list-none flex flex-col gap-1.5">
            {foco.items.map((f, i) => (
              <li key={i}><Renglon><b>{i + 1}. {nombreOt(f) || "Sin OT"}</b>{f.texto && <div className="text-gypi-dim mt-0.5">{f.texto}</div>}</Renglon></li>
            ))}
          </ol>
        ) : (
          <div>
            {foco.porOt.slice(0, 10).map((f) => (
              <FilaBarra key={f.ot || f.texto} nombre={nombreOt(f) || f.texto} max={maxFoco} valor={fmtDias(f.dias)} partes={[{ valor: f.dias, color: "marca" }]} />
            ))}
          </div>
        )}
      </Bloque>

      {/* 3. Terminadas con su valor */}
      <Bloque titulo="✅ OT terminadas">
        <Grilla>
          <Stat value={terminado.produccion.cantidad} label={`En producción${terminado.produccion.valor ? ` · ${fmtPesos(terminado.produccion.valor)}` : ""}`} tone={terminado.produccion.cantidad ? "bien" : "normal"} />
          <Stat value={terminado.instalacion.cantidad} label={`Instaladas${terminado.instalacion.valor ? ` · ${fmtPesos(terminado.instalacion.valor)}` : ""}`} tone={terminado.instalacion.cantidad ? "bien" : "normal"} />
        </Grilla>
        {!dia && serie.length > 1 && terminado.items.length > 0 && (
          <Columnas serie={serie} etiqueta="OT terminadas por período" partes={[{ clave: "terminadas", color: "verde", label: "OT terminadas (producción e instalación)" }]} />
        )}
        {terminado.items.length > 0 && (
          <div className="flex flex-col gap-1.5 mt-2">
            {terminado.items.map((t, i) => (
              <Renglon key={i} tono="verde">
                <div className="flex justify-between gap-2">
                  <span className="min-w-0"><b>{nombreOt(t)}</b> <span className="text-gypi-dim">· {t.seccion === "prod_terminada" ? "producción" : "instalación"}{dia ? "" : ` · ${ddmm(t.fecha)}`}</span></span>
                  <span className="font-mono font-bold shrink-0">{t.valor == null ? "sin precio" : fmtPesos(t.valor)}</span>
                </div>
                {t.texto && <div className="text-gypi-dim mt-0.5">{t.texto}</div>}
              </Renglon>
            ))}
          </div>
        )}
        {terminado.items.some((t) => t.valor == null) && <div className="text-[12px] text-gypi-dim mt-1 px-1">El valor sale de la columna PRECIO del Plan de trabajo; las que dicen "sin precio" no lo tienen cargado.</div>}
      </Bloque>

      {/* 4. En curso */}
      <Bloque titulo="🚦 OT en curso">
        <Grilla n={3}>
          <Stat value={enCurso.verde} label="🟢 Verde" tone="bien" />
          <Stat value={enCurso.amarillo} label="🟡 Amarillo" tone={enCurso.amarillo ? "atencion" : "normal"} />
          <Stat value={enCurso.rojo} label="🔴 Rojo" tone={enCurso.rojo ? "mal" : "normal"} />
        </Grilla>
        {!dia && <div className="text-[12px] text-gypi-dim mb-2 px-1">Cómo quedó cada OT en la última minuta del período.</div>}
        {!dia && serie.length > 1 && (
          <Columnas serie={serie} etiqueta="Semáforo de las OT en curso por período"
            partes={[{ clave: "verde", color: "verde", label: "Verde" }, { clave: "amarillo", color: "amarillo", label: "Amarillo" }, { clave: "rojo", color: "rojo", label: "Rojo" }]} />
        )}
        {conProblemas.length > 0 && (
          <div className="flex flex-col gap-1.5 mt-2">
            {conProblemas.map((x, i) => (
              <Renglon key={i} tono={x.semaforo}>
                <div><b>{PUNTO[x.semaforo]} {nombreOt(x)}</b> <span className="text-gypi-dim">· {x.seccion === "prod_en_curso" ? "producción" : "instalación"}</span></div>
                {x.texto && <div className="mt-0.5">{x.texto}</div>}
                <div className="text-[12px] text-gypi-dim mt-0.5">
                  {[x.responsable && `👤 ${x.responsable}`, x.fecha_objetivo && `📅 ${ddmm(x.fecha_objetivo)}`, !dia && x.diasProblema ? `${fmtDias(x.diasProblema)} con problemas${x.diasRojo ? ` (${x.diasRojo} en rojo)` : ""}` : null].filter(Boolean).join(" · ")}
                </div>
              </Renglon>
            ))}
          </div>
        )}
        {enVerde.length > 0 && (
          <div className="text-[12px] text-gypi-dim mt-2 px-1">🟢 En verde: {enVerde.map((x) => (x.texto ? `${nombreOt(x)} (${x.texto})` : nombreOt(x))).join(" · ")}</div>
        )}
        {!enCurso.items.length && <Vacio>No se anotaron OT en curso.</Vacio>}
      </Bloque>

      {/* 5. Pendientes */}
      <Bloque titulo="📌 Pendientes a resolver">
        <Grilla n={3}>
          <Stat value={pendientes.abiertos} label="Abiertos" tone={pendientes.abiertos ? "atencion" : "bien"} />
          <Stat value={pendientes.vencidos} label="Vencidos" tone={pendientes.vencidos ? "mal" : "bien"} />
          <Stat value={pendientes.diasPromedioAbiertos == null ? "—" : fmtDias(pendientes.diasPromedioAbiertos)} label="Abiertos hace (promedio)" />
        </Grilla>
        {abiertos.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {abiertos.map((p, i) => (
              <Renglon key={i} tono={tonoDias(p)}>
                <div className="flex justify-between gap-2">
                  <span className="min-w-0"><b>{p.texto || nombreOt(p) || "Pendiente"}</b></span>
                  <span className="font-mono font-bold shrink-0" title="Días desde que surgió">🕒 {fmtDias(p.dias)}</span>
                </div>
                <div className="text-[12px] text-gypi-dim mt-0.5">
                  {[p.texto && nombreOt(p), `👤 ${p.responsable}`, p.desde && `desde el ${ddmm(p.desde)}`, p.fecha_objetivo && `${p.vencido ? "⏰ venció" : "📅 para"} el ${ddmm(p.fecha_objetivo)}`, p.gerencia && "lo toma Gerencia"].filter(Boolean).join(" · ")}
                </div>
              </Renglon>
            ))}
          </div>
        ) : <Vacio>No quedaron pendientes abiertos.</Vacio>}
        {resueltos.length > 0 && (
          <div className="text-[12px] text-gypi-dim mt-2 px-1">
            ✓ {resueltos.length} resuelto{resueltos.length !== 1 ? "s" : ""}{pendientes.diasPromedioResolver != null ? `, tardaron ${fmtDias(pendientes.diasPromedioResolver)} en promedio` : ""}: {resueltos.map((p) => `${p.texto || nombreOt(p)} (${fmtDias(p.dias)})`).join(" · ")}
          </div>
        )}
        {!dia && pendientes.porResponsable.length > 0 && (
          <div className="mt-3" aria-label="Pendientes por responsable">
            <div className="text-[13px] font-semibold mb-1">Por responsable</div>
            {pendientes.porResponsable.map((p) => (
              <FilaBarra key={p.responsable} nombre={p.responsable} max={maxResp}
                valor={`${p.abiertos} abierto${p.abiertos !== 1 ? "s" : ""}`}
                partes={[{ valor: p.vencidos, color: "rojo" }, { valor: p.abiertos - p.vencidos, color: "amarillo" }, { valor: p.resueltos, color: "verde" }]}
                detalle={[p.vencidos ? `⏰ ${p.vencidos} vencido${p.vencidos !== 1 ? "s" : ""}` : "", `${p.resueltos} resuelto${p.resueltos !== 1 ? "s" : ""}`, p.diasPromedio != null ? `tarda ${fmtDias(p.diasPromedio)} en promedio` : ""].filter(Boolean).join(" · ")} />
            ))}
          </div>
        )}
      </Bloque>

      {/* 6. Feedback */}
      <Bloque titulo="💬 Feedback">
        {feedback.total === 0 ? <Vacio>No hubo feedback.</Vacio> : (
          <>
            <div className="text-[13px] mb-1">{feedback.total} en total</div>
            {feedback.porTipo.map((t) => (
              <FilaBarra key={t.tipo} nombre={t.tipo} max={maxTipo} valor={t.n} partes={[{ valor: t.n, color: COLOR_TIPO[t.tipo] || "marca" }]} />
            ))}
            <div className="text-[12px] text-gypi-dim mt-1 px-1">Por área: {feedback.porArea.map((a) => `${a.area} ${a.total}`).join(" · ")}</div>
          </>
        )}
      </Bloque>

      {/* Compras */}
      {compras.total > 0 && (
        <Bloque titulo="🛒 Compras disparadas">
          <Grilla n={3}>
            <Stat value={compras.total} label="Compras" />
            <Stat value={compras.urgentes} label="Urgentes" tone={compras.urgentes ? "atencion" : "bien"} />
            <Stat value={compras.conPedido} label="Con pedido en Compras" />
          </Grilla>
        </Bloque>
      )}
    </div>
  );
}
