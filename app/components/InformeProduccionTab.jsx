'use client';
// app/components/InformeProduccionTab.jsx — Reportes → 🏭 Producción
// (Tadeo, 29/10; migración 146; app/lib/informeProduccion.js). Los informes
// que salen solos cada noche quedan guardados acá, y con "Armar informe" se
// pide uno parcial del día, la semana o el mes cuando haga falta.
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyArg } from "../lib/dates";
import { fechaCorta } from "../lib/ot";
import { TIPOS_INFORME, periodoDe, explicacionNota } from "../lib/informeProduccion";
import { imprimirInforme } from "../lib/informePdf";
import { Chip } from "./ui";

const DIA = 86400000;
const coma = (n) => String(n ?? "—").replace(".", ",");
const sumarDias = (f, n) => new Date(Date.parse(`${f}T00:00:00Z`) + n * DIA).toISOString().slice(0, 10);
const NOMBRE_TIPO = { dia: "Día", semana: "Semana", mes: "Mes" };

/** El mismo día de la semana o del mes anterior / siguiente. */
function moverPeriodo(tipo, fecha, n) {
  if (tipo === "dia") return sumarDias(fecha, n);
  if (tipo === "semana") return sumarDias(fecha, 7 * n);
  const [y, m] = fecha.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

export function textoPeriodo(p) {
  if (!p) return "";
  if (p.tipo === "dia") return fechaCorta(p.desde);
  return `Del ${fechaCorta(p.desde)} al ${fechaCorta(p.hasta)}`;
}

/** Barra de 0 a 100 en SVG (ancho exacto sin estilos sueltos). */
function Tira({ pct, color = "fill-gypi-amber" }) {
  const v = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="block w-full h-2 rounded-full overflow-hidden" aria-hidden="true">
      <rect x="0" y="0" width="100" height="8" className="fill-gypi-border" />
      <rect x="0" y="0" width={v} height="8" className={color} />
    </svg>
  );
}

const tonoNota = (n) => (n == null ? "text-gypi-text" : n >= 7 ? "text-gypi-green" : n >= 5 ? "text-gypi-amber-ink" : "text-gypi-red");

/** Barra de 0 a 100 con su número (un medidor por cada parte de la nota). */
function Medidor({ label, valor, peso }) {
  const v = valor == null ? 0 : Math.max(0, Math.min(100, valor));
  return (
    <div className="mb-2">
      <div className="flex items-baseline gap-2 text-[13px]">
        <span className="flex-1 min-w-0">{label} <span className="text-gypi-dim">· pesa {peso}</span></span>
        <span className="font-bold">{valor == null ? "—" : `${coma(valor)} %`}</span>
      </div>
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v}><Tira pct={v} /></div>
    </div>
  );
}

/** Gráfico por OT: planificado (gris) y hecho (naranja) en el período. */
function BarrasOt({ o }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-0.5 my-1">
      <Tira pct={o.planificado} color="fill-gypi-dim" />
      <Tira pct={o.hecho} />
    </div>
  );
}

export function VistaInforme({ informe: r, guardado = null }) {
  const [abierta, setAbierta] = useState(null);
  const s = r.resumen;
  return (
    <div data-informe>
      <section aria-label="Nota del período" className="bg-gypi-surface rounded-xl p-3 border border-gypi-border mb-3">
        <div className="flex items-baseline gap-3 mb-2">
          <div className={`font-heading text-[40px] font-bold leading-none ${tonoNota(r.nota)}`} data-nota>{r.nota == null ? "Sin nota" : coma(r.nota)}</div>
          {r.nota != null && <div className="text-[15px] text-gypi-dim">sobre 10</div>}
          <div className="flex-1 text-right text-[13px] text-gypi-dim">{textoPeriodo(r.periodo)}{guardado ? " · guardado" : " · parcial"}</div>
        </div>
        <Medidor label="Cumplimiento de lo planificado" valor={s.cumplimiento} peso="70 %" />
        <Medidor label="OT que llegan a su semana" valor={s.enSemana} peso="20 %" />
        <Medidor label="Procesos sin correrse del plan" valor={s.sinCorrimiento} peso="10 %" />
        <p className="text-[12px] text-gypi-dim m-0 mt-2" data-explicacion>{explicacionNota(r)}</p>
      </section>

      <section aria-label="Por OT" className="mb-3">
        <h3 className="m-0 mb-1 text-[14px] font-bold font-heading">Por OT · {s.ots}</h3>
        <div className="text-[12px] text-gypi-dim mb-2">
          <span className="inline-block w-3 h-2 rounded-sm bg-gypi-dim mr-1" aria-hidden="true" />planificado en el período
          <span className="inline-block w-3 h-2 rounded-sm bg-gypi-amber ml-3 mr-1" aria-hidden="true" />hecho · primero las más atrasadas
        </div>
        {!r.ots.length && <div className="text-[13px] text-gypi-dim">No hubo nada planificado ni hecho en el período.</div>}
        {s.otsFueraDelPlan > 0 && (
          <div className="text-[13px] text-gypi-amber-ink font-bold mb-2" data-fuera-plan>
            🆕 {s.otsFueraDelPlan === 1 ? "1 OT tuvo producción" : `${s.otsFueraDelPlan} OT tuvieron producción`} sin estar planificada en el período: {r.ots.filter((o) => o.fueraDelPlan).map((o) => o.ot).join(", ")}
          </div>
        )}
        <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
          {r.ots.map((o) => (
            <li key={o.ot} className="bg-gypi-surface rounded-xl p-3 border border-gypi-border" data-ot={o.ot}>
              <button type="button" onClick={() => setAbierta(abierta === o.ot ? null : o.ot)} aria-expanded={abierta === o.ot}
                className="w-full bg-transparent border-0 p-0 text-left cursor-pointer text-gypi-text">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[14px] font-bold">OT {o.ot}</span>
                  <span className="flex-1 min-w-0 text-[12px] text-gypi-dim truncate">{[o.cliente, o.descripcion].filter(Boolean).join(" · ")}</span>
                  <span className={`text-[13px] font-bold ${o.desvio < 0 ? "text-gypi-red" : "text-gypi-green"}`} data-desvio>{o.desvio > 0 ? "+" : ""}{coma(o.desvio)} pts</span>
                </div>
                <BarrasOt o={o} />
                <div className="text-[12px] text-gypi-dim">
                  Planificado {coma(o.planificado)} % · hecho {coma(o.hecho)} % · va {coma(o.alFinal)} % de la OT
                  {o.tarde && <span className="text-gypi-red font-bold"> · ⚠ {o.diasTarde} d después de su semana</span>}
                  {o.diasCorrido > 0 && <span className="text-gypi-amber-ink font-bold"> · ↪ se corrió {o.diasCorrido} d</span>}
                  {o.fueraDelPlan && <span className="text-gypi-amber-ink font-bold"> · 🆕 fuera del plan{o.enOtroPlan ? " (planificada otro día)" : ""}</span>}
                </div>
              </button>
              {abierta === o.ot && (
                <table className="w-full mt-2 text-[12px] border-collapse">
                  <thead>
                    <tr className="text-gypi-dim text-left"><th className="font-normal">Proceso</th><th className="font-normal text-right">Planificado</th><th className="font-normal text-right">Hecho</th><th className="font-normal text-right">Desvío</th><th className="font-normal text-right">Va</th></tr>
                  </thead>
                  <tbody>
                    {o.procesos.map((q) => (
                      <tr key={q.etapa}>
                        <td>{q.nombre}{q.fueraDelPlan && <span className="text-gypi-amber-ink"> · 🆕 fuera del plan</span>}{q.fuente === "manual" && <span className="text-gypi-dim"> · ✋ a mano</span>}</td>
                        <td className="text-right">{coma(q.planificado)} %</td>
                        <td className="text-right">{coma(q.hecho)} %</td>
                        <td className={`text-right font-bold ${q.desvio < 0 ? "text-gypi-red" : "text-gypi-green"}`}>{q.desvio > 0 ? "+" : ""}{coma(q.desvio)}</td>
                        <td className="text-right">{coma(q.alFinal)} %</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// El reporte del día (piezas, etapas, instalación, atrasadas) va en el PDF del día; si falla, el PDF sale sin esa parte
const leerReporteDia = (fecha) => apiFetch(`/api/reportes/dia?fecha=${fecha}`)
  .then((r) => (r.ok ? r.json() : null)).then((d) => d?.reporte || null).catch(() => null);

export default function InformeProduccionTab({ empresa = null }) {
  const hoy = hoyArg();
  const [tipo, setTipo] = useState("dia");
  const [fecha, setFecha] = useState(hoy);
  const [ver, setVer] = useState(null); // { informe, guardado }
  const [estado, setEstado] = useState({ cargando: false, error: null });
  const [guardados, setGuardados] = useState(null);

  useEffect(() => {
    let vivo = true;
    apiFetch("/api/reportes/produccion?guardados=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo) setGuardados(d?.informes || []); })
      .catch(() => { if (vivo) setGuardados([]); });
    return () => { vivo = false; };
  }, []);

  const pedir = async (url, guardado = null) => {
    setEstado({ cargando: true, error: null });
    try {
      const r = await apiFetch(url);
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.informe) throw new Error(d.error || "No se pudo armar el informe");
      const reporteDia = d.informe.periodo?.tipo === "dia" ? await leerReporteDia(d.informe.periodo.desde) : null;
      setVer({ informe: d.informe, guardado: guardado || d.guardado || null, reporteDia });
      setEstado({ cargando: false, error: null });
    } catch (e) {
      setEstado({ cargando: false, error: e.message });
    }
  };
  const exportar = () => {
    try {
      imprimirInforme({ empresa: empresa || {}, informe: ver.informe, reporteDia: ver.reporteDia, guardado: ver.guardado });
    } catch (e) {
      setEstado({ cargando: false, error: e.message });
    }
  };
  const armar = () => pedir(`/api/reportes/produccion?tipo=${tipo}&fecha=${fecha}`);
  const periodo = periodoDe(tipo, fecha);
  const siguiente = moverPeriodo(tipo, fecha, 1);

  return (
    <div>
      <div className="flex gap-1.5 mb-2.5" role="group" aria-label="Período del informe">
        {TIPOS_INFORME.map((t) => <Chip key={t.id} active={tipo === t.id} onClick={() => { setTipo(t.id); setVer(null); }}>{t.label}</Chip>)}
      </div>
      <div className="flex items-center justify-between py-2.5 px-3.5 bg-gypi-surface rounded-[14px] border border-gypi-border mb-2.5">
        <button onClick={() => { setFecha(moverPeriodo(tipo, fecha, -1)); setVer(null); }} aria-label="Período anterior" className="min-w-[48px] min-h-[48px] flex items-center justify-center bg-transparent border-none text-gypi-text cursor-pointer text-xl">←</button>
        <div className="text-sm font-bold text-gypi-text font-heading text-center">{tipo === "dia" && fecha === hoy ? "Hoy" : textoPeriodo(periodo)}</div>
        <button onClick={() => { setFecha(siguiente > hoy ? hoy : siguiente); setVer(null); }} disabled={periodo.hasta >= hoy} aria-label="Período siguiente" className="min-w-[48px] min-h-[48px] flex items-center justify-center bg-transparent border-none text-gypi-text cursor-pointer text-xl disabled:opacity-30">→</button>
      </div>
      <button type="button" onClick={armar} disabled={estado.cargando} className="g-btn g-btn-primary w-full mb-1">
        {estado.cargando ? "Armando…" : `📊 Armar informe ${tipo === "dia" ? "del día" : tipo === "semana" ? "de la semana" : "del mes"}`}
      </button>
      <div className="text-[12px] text-gypi-dim mb-3">Cada noche sale solo el del día: se guarda acá, le llega por email a administración y al celular de gerencia. La parte de las OT que llegan a su semana y los corrimientos es la de ahora.</div>
      {estado.error && <div role="alert" className="text-[13px] text-gypi-red mb-3">{estado.error}</div>}

      {ver && (
        <>
          <button type="button" onClick={exportar} className="g-btn g-btn-secondary w-full mb-1">📄 Exportar PDF</button>
          <div className="text-[12px] text-gypi-dim mb-3">Se abre la hoja con los gráficos: elegí "Guardar como PDF" en la ventana de imprimir.</div>
          <VistaInforme informe={ver.informe} guardado={ver.guardado} />
        </>
      )}

      <section aria-label="Informes guardados" className="mt-4">
        <h3 className="m-0 mb-2 text-[14px] font-bold font-heading">🗂 Guardados</h3>
        {guardados === null ? (
          <div className="text-[13px] text-gypi-dim" role="status">Cargando…</div>
        ) : !guardados.length ? (
          <div className="text-[13px] text-gypi-dim">Todavía no hay informes guardados: el primero sale esta noche.</div>
        ) : (
          <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
            {guardados.map((g) => (
              <li key={g.id}>
                <button type="button" onClick={() => pedir(`/api/reportes/produccion?id=${g.id}`, g.created_at)}
                  className="w-full flex items-center gap-2 p-2.5 min-h-[44px] rounded-[10px] border border-gypi-border bg-gypi-surface text-left cursor-pointer text-gypi-text">
                  <span className="flex-1 min-w-0 text-[14px]">{NOMBRE_TIPO[g.tipo] || g.tipo} · {textoPeriodo(g)}</span>
                  <span className={`text-[15px] font-bold ${tonoNota(g.nota == null ? null : Number(g.nota))}`}>{g.nota == null ? "—" : coma(Number(g.nota))}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
