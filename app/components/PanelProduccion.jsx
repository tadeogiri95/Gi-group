'use client';
// app/components/PanelProduccion.jsx — Producción → 📈 Panel de producción
// (Tadeo, 23/11): los indicadores de la planta con semáforo, la semana elegida
// contra las 4 anteriores. La cuenta está en app/lib/panelProduccion.js y la
// arma /api/reportes/panel.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyArg } from "../lib/dates";
import { METAS, semaforo, semaforoCarga } from "../lib/panelProduccion";
import { fmtPesos } from "../lib/costo";
import NombreOt from "./NombreOt";

const DIA = 86400000;
const sumarDias = (f, n) => new Date(Date.parse(`${f}T00:00:00Z`) + n * DIA).toISOString().slice(0, 10);
const corta = (f) => (f ? `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}` : "—");
const num = (n, d = 1) => (n == null ? "—" : Number(n).toLocaleString("es-AR", { maximumFractionDigits: d }));
const pctTxt = (n) => (n == null ? "—" : `${num(n)} %`);
const horasTxt = (h) => (h == null ? "—" : `${num(h)} h`);

/** Lo que les falta a las OT atrasadas y cuándo termina la última (Tadeo, 26/11). */
function textoPonerseAlDia(a) {
  if (!a?.cantidad || !(a.horasFalta > 0)) return null;
  const partes = [`Les faltan ${horasTxt(a.horasFalta)} de proceso`];
  if (a.masHoras) partes[0] += `, sobre todo ${a.masHoras.nombre} (${horasTxt(a.masHoras.horas)})`;
  if (a.ultimoFin) partes.push(`la última termina el ${corta(a.ultimoFin)}${a.semanasHastaUltima != null ? ` (en ${a.semanasHastaUltima} ${a.semanasHastaUltima === 1 ? "semana" : "semanas"})` : ""}`);
  return partes.join(" · ");
}

const TONO = {
  bien: { borde: "border-l-gypi-green", txt: "text-gypi-green", punto: "🟢", barra: "bg-gypi-green" },
  atencion: { borde: "border-l-gypi-amber", txt: "text-gypi-amber-ink", punto: "🟡", barra: "bg-gypi-amber" },
  mal: { borde: "border-l-gypi-red", txt: "text-gypi-red", punto: "🔴", barra: "bg-gypi-red" },
  normal: { borde: "border-l-gypi-border", txt: "text-gypi-text", punto: "", barra: "bg-gypi-dim" },
};
// Alturas fijas de las barritas de tendencia (sin estilos sueltos)
const ALTURAS = ["h-[3px]", "h-1.5", "h-2.5", "h-3.5", "h-[18px]", "h-[22px]", "h-[26px]", "h-[30px]"];

function Tendencia({ serie, tono }) {
  const valores = serie.map((x) => x.valor).filter((v) => v != null);
  if (valores.length < 2) return null;
  const max = Math.max(...valores, 0.0001);
  return (
    <div className="flex items-end gap-1 mt-2 h-[32px]" aria-label={`Semanas: ${serie.map((x) => `${x.label} ${x.texto}`).join(", ")}`} role="img">
      {serie.map((x, i) => {
        const alto = x.valor == null ? null : ALTURAS[Math.min(ALTURAS.length - 1, Math.round((x.valor / max) * (ALTURAS.length - 1)))];
        const ultima = i === serie.length - 1;
        return (
          <div key={x.label} className="flex-1 flex flex-col items-center justify-end h-full" title={`${x.label}: ${x.texto}`}>
            {alto ? <div className={`w-full rounded-sm ${alto} ${ultima ? TONO[tono || "normal"].barra : "bg-gypi-surf-hi"}`} /> : <div className="w-full h-[2px] bg-gypi-border" />}
          </div>
        );
      })}
    </div>
  );
}

function Indicador({ id, titulo, valor, tono = null, detalle = null, meta = null, serie = null, ayuda = null }) {
  const t = TONO[tono || "normal"];
  return (
    <div className={`bg-gypi-surface border border-gypi-border border-l-4 ${t.borde} rounded-xl p-3 flex flex-col`} data-indicador={id} data-tono={tono || "normal"}>
      <div className="text-[13px] font-semibold text-gypi-dim leading-tight">{titulo}</div>
      <div className={`font-heading text-[24px] font-bold leading-tight tabular-nums mt-1 ${t.txt}`}>
        {t.punto && <span className="text-[14px] mr-1 align-middle" aria-hidden="true">{t.punto}</span>}{valor}
      </div>
      {detalle && <div className="text-xs text-gypi-dim mt-0.5">{detalle}</div>}
      {meta && <div className="text-xs text-gypi-mute mt-0.5">{meta}</div>}
      {serie && <Tendencia serie={serie} tono={tono} />}
      {ayuda && (
        <details className="mt-1.5 text-xs text-gypi-dim">
          <summary className="cursor-pointer select-none">¿Cómo se calcula?</summary>
          <p className="m-0 mt-1 leading-snug">{ayuda}</p>
        </details>
      )}
    </div>
  );
}

function Bloque({ titulo, children, nota = null }) {
  return (
    <section aria-label={titulo} className="mb-5">
      <h3 className="m-0 mb-1 text-[15px] font-bold text-gypi-text font-heading">{titulo}</h3>
      {nota && <p className="text-xs text-gypi-dim mt-0 mb-2">{nota}</p>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">{children}</div>
    </section>
  );
}

function Lista({ titulo, vacio, filas, render }) {
  return (
    <div className="bg-gypi-surface border border-gypi-border rounded-xl p-3 mb-2">
      <div className="text-[13px] font-bold text-gypi-text mb-1">{titulo}</div>
      {filas.length === 0 ? <div className="text-[13px] text-gypi-dim">{vacio}</div> : (
        <ul className="m-0 p-0 list-none flex flex-col gap-1">
          {filas.map((f, i) => <li key={f.ot || f.motivo || f.cod || f.codigo || i} className="text-[13px]">{render(f)}</li>)}
        </ul>
      )}
    </div>
  );
}

/** Serie de las semanas para la tendencia: valor y cómo se lee. */
const serieDe = (semanas, leer, texto = pctTxt) => semanas.filter((s) => !s.futura).map((s) => ({ label: corta(s.desde), valor: leer(s), texto: texto(leer(s)) }));

export default function PanelProduccion() {
  const hoy = hoyArg();
  const [fecha, setFecha] = useState(hoy);
  const [panel, setPanel] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  const leer = useCallback(async (f) => {
    setCargando(true);
    try {
      const r = await apiFetch(`/api/reportes/panel?fecha=${f}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "No se pudo armar el panel.");
      setPanel(j.panel);
      setError(null);
    } catch (err) {
      console.error(err);
      setError(err.message || "No se pudo armar el panel.");
    }
    setCargando(false);
  }, []);
  useEffect(() => { leer(fecha); }, [leer, fecha]);

  const semanas = panel?.semanas || [];
  const s = semanas[semanas.length - 1];
  const previas = semanas.slice(0, -1);
  const delLunes = s?.desde || fecha;
  const esActual = !!s && hoy >= s.desde && hoy <= s.hasta;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3" data-panel-produccion>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h2 className="m-0 text-[17px] font-bold text-gypi-text font-heading mr-auto">📈 Panel de control de producción</h2>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Semana anterior" onClick={() => setFecha(sumarDias(delLunes, -7))} disabled={cargando}
            className="min-h-[40px] min-w-[40px] rounded-lg border border-gypi-border bg-transparent text-gypi-text cursor-pointer">◀</button>
          <span className="text-[13px] font-semibold text-gypi-text px-1" data-semana>{s ? `Semana del ${corta(s.desde)} al ${corta(s.hasta)}` : "…"}</span>
          <button type="button" aria-label="Semana siguiente" onClick={() => setFecha(sumarDias(delLunes, 7) > hoy ? hoy : sumarDias(delLunes, 7))} disabled={cargando || esActual}
            className="min-h-[40px] min-w-[40px] rounded-lg border border-gypi-border bg-transparent text-gypi-text cursor-pointer disabled:opacity-40">▶</button>
        </div>
        <button type="button" onClick={() => leer(fecha)} disabled={cargando}
          className="min-h-[40px] rounded-lg border border-gypi-border bg-transparent px-3 text-xs font-semibold text-gypi-text cursor-pointer">
          {cargando ? "Actualizando…" : "🔄 Actualizar"}
        </button>
      </div>
      <p className="text-xs text-gypi-dim mt-0 mb-3">
        🟢 bien · 🟡 atención · 🔴 hay que actuar. Las barritas son esta semana y las {previas.length || 4} anteriores. Todo sale de lo que ya se carga en Gypi
        (escaneos, % a mano, plan confirmado, actas, retrabajos, fallas y fichadas); las horas son de jornada, sin noches, fines de semana, feriados ni pausas.
      </p>

      {error && <div role="alert" className="text-[13px] text-gypi-red mb-3">{error}</div>}
      {!panel && !error && <div className="gypi-dots" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>}

      {panel && s && (
        <>
          <Bloque titulo="1. Entregas" nota="Lo que ve el cliente: si llegamos a la fecha que le prometimos.">
            <Indicador id="entregas" titulo="Entregas a tiempo" valor={pctTxt(s.entregas.pct)} tono={semaforo(s.entregas.pct, METAS.entregas)}
              detalle={s.entregas.entregadas ? `${s.entregas.aTiempo} de ${s.entregas.conFecha} OT con fecha${s.entregas.sinFecha ? ` · ${s.entregas.sinFecha} sin fecha objetivo` : ""}` : "Ninguna OT se entregó esta semana"}
              meta={METAS.entregas.texto} serie={serieDe(semanas, (x) => x.entregas.pct)}
              ayuda="OT entregadas en la semana (acta firmada, o cerrada con toda la producción hecha) que llegaron hasta su fecha objetivo (la SEMANA del Plan de trabajo o la fecha de entrega). Las OT sin fecha objetivo no entran en el porcentaje." />
            <Indicador id="entregadas" titulo="OT entregadas" valor={num(s.entregas.entregadas, 0)}
              detalle={s.entregas.tarde.length ? `${s.entregas.tarde.length} tarde` : null} serie={serieDe(semanas, (x) => x.entregas.entregadas, (v) => num(v, 0))}
              ayuda="OT con acta firmada en la semana, o cerradas en la planilla con toda la producción hecha." />
            <Indicador id="atrasadas" titulo="OT que van tarde según el plan" valor={num(panel.ahora.atrasadas.cantidad, 0)}
              tono={panel.ahora.atrasadas.cantidad ? (panel.ahora.atrasadas.cantidad / Math.max(1, panel.ahora.atrasadas.abiertas) > 0.25 ? "mal" : "atencion") : "bien"}
              detalle={panel.ahora.atrasadas.cantidad ? `de ${panel.ahora.atrasadas.abiertas} en el plan · ${num(panel.ahora.atrasadas.diasPromedio)} días tarde en promedio` : `${panel.ahora.atrasadas.abiertas} OT en el plan, todas en fecha`}
              meta={textoPonerseAlDia(panel.ahora.atrasadas)}
              ayuda="Hoy, con el plan vivo (el del Gantt): OT que, al ritmo que vienen, terminan la producción después de su fecha límite. Es lo mismo que ⏰ OT atrasadas. Abajo: las horas de proceso que todavía les faltan (horas de máquina, y en Armado el tiempo que lleva armarlas), el proceso donde se junta la mayor parte, y cuándo termina la última según el plan vivo." />
            <Indicador id="pausa" titulo="OT en pausa" valor={num(panel.ahora.pausadas.cantidad, 0)} tono={panel.ahora.pausadas.cantidad ? "atencion" : null}
              detalle={panel.ahora.pausadas.motivos.slice(0, 2).map((m) => `${m.motivo} (${m.cantidad})`).join(" · ") || null}
              ayuda="OT puestas en ⏸ pausa hoy, con el motivo. Mientras están en pausa no cuentan en el lead time ni en el plan." />
          </Bloque>

          <Bloque titulo="2. Plan y capacidad" nota="Si hacemos lo que planificamos y cuánto de la planta usa el plan.">
            <Indicador id="cumplimiento" titulo="Cumplimiento del plan" valor={pctTxt(s.plan.cumplimiento)} tono={semaforo(s.plan.cumplimiento, METAS.cumplimiento)}
              detalle={s.plan.procesosPlanificados ? `${s.plan.procesosCumplidos} de ${s.plan.procesosPlanificados} procesos planificados cumplidos` : "No había nada planificado"}
              meta={METAS.cumplimiento.texto} serie={serieDe(semanas, (x) => x.plan.cumplimiento)}
              ayuda="Lo mismo que el informe de producción: de lo que el plan confirmado ponía para la semana, qué % se avanzó (escaneo o % a mano), sumando los procesos y sin que adelantar otra OT compense." />
            <Indicador id="carga" titulo="Carga de la planta" valor={pctTxt(s.plan.carga.pct)} tono={semaforoCarga(s.plan.carga.pct)}
              detalle={s.plan.carga.cuello
                ? `La que frena: ${s.plan.carga.cuello.nombre}, ${horasTxt(s.plan.carga.cuello.horas)} planificadas de ${horasTxt(s.plan.carga.cuello.disponibles)} que puede hacer (${s.plan.carga.cuello.que})`
                : s.plan.carga.disponibles != null ? `${horasTxt(s.plan.carga.horas)} del plan confirmado de ${horasTxt(s.plan.carga.disponibles)} de la grilla (semana entera)` : `${horasTxt(s.plan.carga.horas)} planificadas`}
              meta="Bien entre 70 y 100 %" serie={serieDe(semanas, (x) => x.plan.carga.pct)}
              ayuda="Qué tan llena está la planta según el plan CONFIRMADO, la semana ENTERA de lunes a domingo. El plan va como una fila: cada máquina hace una OT a la vez y Armado arma pocas OT a la vez con un máximo de armadores, así que no toda la gente puede trabajar al mismo tiempo. Por eso cada proceso se mide contra lo que puede hacer a la vez (horas que la planta está abierta × las personas que entran en ese proceso), y la carga de la planta es la del proceso más lleno, el que frena. Si está cerca de 100 % y hay OT atrasadas, más gente no alcanza: hace falta más horas en ese proceso (horas extra, otro turno o otra máquina). Si está bajo y hay OT atrasadas, el plan confirmado tiene poco trabajo: revisá qué OT están tildadas en Planificación. Menos de 70 % es planta ociosa; más de 100 % pide horas extra." />
            {s.plan.carga.gente && (
              <Indicador id="carga-gente" titulo="Gente con trabajo en el plan" valor={pctTxt(s.plan.carga.gente.pct)}
                detalle={s.plan.carga.gente.disponibles != null ? `${horasTxt(s.plan.carga.gente.horas)} del plan de ${horasTxt(s.plan.carga.gente.disponibles)} de la grilla${s.plan.carga.gente.personas ? ` (${s.plan.carga.gente.personas} operarios)` : ""}` : null}
                serie={serieDe(semanas, (x) => x.plan.carga.gente?.pct)}
                ayuda="Qué parte de las horas de TODOS los operarios de la división que se planifica (sin instaladores ni otra línea, sin feriados ni vacaciones o ausencias aprobadas) usa el plan confirmado en la semana. Lo que falta para 100 % es gente que el plan no puede poner a trabajar porque las máquinas y Armado ya están ocupados: se puede pasar a un segundo turno del proceso que frena, o a otras tareas. En Planificación, el paso ③ mira el plan que estás armando y solo desde hoy, por eso los números pueden no coincidir." />
            )}
            {s.plan.carga.porEtapa.map((q) => (
              <Indicador key={q.etapa} id={`carga-${q.etapa}`} titulo={`${q.nombre} planificado`} valor={q.pct != null ? pctTxt(q.pct) : horasTxt(q.horas)}
                tono={q.pct != null && q.horas > 0 ? semaforoCarga(q.pct) : null}
                detalle={q.pct != null
                  ? `${horasTxt(q.horas)} de ${horasTxt(q.disponibles)} que puede hacer (${q.que})`
                  : s.plan.carga.horas > 0 ? `${num((q.horas / s.plan.carga.horas) * 100, 0)} % de lo planificado en la semana` : null}
                ayuda={`Horas de ${q.nombre} que el plan confirmado puso en esta semana (no son horas trabajadas ni avance de las OT), contra las que ${q.nombre} puede hacer en la semana: las horas que la planta está abierta × ${q.aLaVez ?? 1} ${q.aLaVez === 1 ? "persona" : "personas"} a la vez. Lo que se hizo de verdad está en Cumplimiento del plan.`} />
            ))}
          </Bloque>

          <Bloque titulo="3. Velocidad" nota="Cuánto tardan las OT y cuánto sale de la planta.">
            <Indicador id="lead-produccion" titulo="Lead time de producción" valor={horasTxt(s.produccion.leadTime)}
              detalle={s.produccion.ots ? `promedio de ${s.produccion.ots} OT` : "Ninguna OT terminó la producción"}
              serie={serieDe(semanas, (x) => x.produccion.leadTime, horasTxt)}
              ayuda="OT que terminaron la producción en la semana: horas de jornada desde el primer avance (escaneo o % a mano) hasta que el último proceso llegó al 100 %. Cuanto más bajo, mejor." />
            <Indicador id="lead-ot" titulo="Lead time de la OT completa" valor={horasTxt(s.entregas.leadTime)}
              detalle={s.entregas.entregadas ? `promedio de ${s.entregas.entregadas} OT entregadas` : null}
              serie={serieDe(semanas, (x) => x.entregas.leadTime, horasTxt)}
              ayuda="OT entregadas en la semana: horas de jornada desde el primer avance hasta el acta firmada (incluye la espera y la instalación)." />
            <Indicador id="producidas" titulo="OT con la producción terminada" valor={num(s.produccion.ots, 0)}
              detalle={`${num(s.produccion.piezas, 0)} piezas escaneadas`} serie={serieDe(semanas, (x) => x.produccion.ots, (v) => num(v, 0))}
              ayuda="OT cuyo último proceso de producción llegó al 100 % en la semana, y piezas escaneadas en la semana en cualquier proceso." />
            {panel.conPrecios && (
              <Indicador id="valor" titulo="$ producidos" valor={fmtPesos(s.produccion.valor || 0)}
                detalle={[
                  s.produccion.valorEstimado > 0 && `≈ ${fmtPesos(s.produccion.valorEstimado)} estimado`,
                  panel.ahora.enProceso.valor != null && `${fmtPesos(panel.ahora.enProceso.valor)} en proceso hoy${panel.ahora.enProceso.valorEstimado > 0 ? ` (≈ ${fmtPesos(panel.ahora.enProceso.valorEstimado)} estimado)` : ""}`,
                ].filter(Boolean).join(" · ") || null}
                serie={serieDe(semanas, (x) => x.produccion.valor, (v) => fmtPesos(v || 0))}
                ayuda="Valor de las OT que terminaron la producción en la semana: la columna PRECIO del Plan de trabajo o, si no tiene, estimado por sus materiales (costo de materiales ÷ el % de materiales de Finanzas). En proceso: el de las OT que hoy están en alguna etapa o esperando." />
            )}
            <Indicador id="en-proceso" titulo="OT en proceso hoy" valor={num(panel.ahora.enProceso.ots, 0)}
              detalle={`${panel.ahora.enProceso.esperando} esperando entre etapas`}
              ayuda="OT que hoy están en una etapa (en curso) o terminaron una y no empezaron la siguiente (esperando). Lo mismo que el 🗂️ Trello de OT." />
            <Indicador id="cuello" titulo="Cuello de botella" valor={panel.ahora.enProceso.cuello?.nombre || "Ninguno"}
              tono={panel.ahora.enProceso.cuello ? (panel.ahora.enProceso.cuello.esperando >= 3 ? "mal" : "atencion") : "bien"}
              detalle={panel.ahora.enProceso.cuello ? `${panel.ahora.enProceso.cuello.esperando} OT esperando · ${horasTxt(panel.ahora.enProceso.cuello.horasEspera)} de espera` : "Ninguna OT espera entre etapas"}
              ayuda="La etapa de producción (Corte, Canteado, Mecanizado o Armado) donde hoy más OT esperan para empezar (si empatan, la de más horas de espera). Ahí se frena la planta: conviene reforzarla." />
          </Bloque>

          <Bloque titulo="4. Calidad" nota="Lo que sale bien a la primera y lo que hay que volver a hacer.">
            <Indicador id="sin-retrabajo" titulo="OT sin retrabajo" valor={pctTxt(s.calidad.sinRetrabajo)} tono={semaforo(s.calidad.sinRetrabajo, METAS.sinRetrabajo)}
              detalle={s.calidad.producidas ? `de ${s.calidad.producidas} OT terminadas` : "Ninguna OT terminó la producción"}
              meta={METAS.sinRetrabajo.texto} serie={serieDe(semanas, (x) => x.calidad.sinRetrabajo)}
              ayuda="De las OT que terminaron la producción en la semana, cuántas nunca tuvieron retrabajo cargado: salieron bien a la primera." />
            <Indicador id="retrabajo" titulo="Horas de retrabajo" valor={horasTxt(s.calidad.horasRetrabajo)} tono={s.calidad.horasRetrabajo > 0 ? "atencion" : "bien"}
              detalle={s.calidad.motivos[0] ? `Más común: ${s.calidad.motivos[0].motivo}` : null}
              serie={serieDe(semanas, (x) => x.calidad.horasRetrabajo, horasTxt)}
              ayuda="Horas de retrabajo cargadas en la semana en cualquier OT (sin las eliminadas), con su motivo." />
            <Indicador id="no-conformidades" titulo="No conformidades" valor={num(s.calidad.noConformidades, 0)} tono={s.calidad.noConformidades > 0 ? "atencion" : "bien"}
              detalle={s.calidad.defectos[0] ? `Más común: ${s.calidad.defectos[0].nombre}` : null}
              serie={serieDe(semanas, (x) => x.calidad.noConformidades, (v) => num(v, 0))}
              ayuda="Piezas o módulos con defecto registrados en la semana, por tipo de defecto." />
            <Indicador id="pendientes" titulo="Pendientes de obra" valor={num(panel.ahora.pendientesAbiertos, 0)} tono={panel.ahora.pendientesAbiertos > 0 ? "atencion" : "bien"}
              detalle={`${s.calidad.pendientesNuevos} nuevos en la semana`} serie={serieDe(semanas, (x) => x.calidad.pendientesNuevos, (v) => num(v, 0))}
              ayuda="Pendientes de instalación sin resolver hoy (lo que hay que volver a hacer en la obra), y cuántos se anotaron en la semana." />
          </Bloque>

          <Bloque titulo="5. Máquinas" nota="Si las máquinas andan.">
            <Indicador id="maquina-parada" titulo="Horas de máquina parada" valor={horasTxt(s.maquinas.horasParada)} tono={s.maquinas.horasParada > 0 ? (s.maquinas.horasParada > 8 ? "mal" : "atencion") : "bien"}
              detalle={`${s.maquinas.fallas} ${s.maquinas.fallas === 1 ? "falla nueva" : "fallas nuevas"}`} serie={serieDe(semanas, (x) => x.maquinas.horasParada, horasTxt)}
              ayuda="Horas en que alguna máquina estuvo parada por una falla avisada, desde el aviso hasta el arreglo (sumando todas las máquinas)." />
            <Indicador id="preventivo" titulo="Preventivo del mes" valor={pctTxt(panel.maquinasMes?.preventivo)} tono={semaforo(panel.maquinasMes?.preventivo, METAS.preventivo)}
              detalle={panel.maquinasMes?.tocaban ? `${panel.maquinasMes.hechas} de ${panel.maquinasMes.tocaban} tareas hechas` : "Sin tareas de mantenimiento en el mes"}
              meta={METAS.preventivo.texto}
              ayuda="Tareas de mantenimiento preventivo de las máquinas que tocaban en el mes y se hicieron. También: tiempo medio entre fallas (cuánto anda una máquina sin romperse) y tiempo medio de arreglo." />
            <Indicador id="entre-fallas" titulo="Tiempo entre fallas / de arreglo" valor={panel.maquinasMes?.entreFallasDias != null ? `${num(panel.maquinasMes.entreFallasDias)} días` : "—"}
              detalle={panel.maquinasMes?.arregloHoras != null ? `Arreglo promedio: ${horasTxt(panel.maquinasMes.arregloHoras)}` : "Sin fallas arregladas en el mes"}
              ayuda="Del mes: cuántos días anda en promedio una máquina entre una falla y la siguiente (más alto es mejor), y cuántas horas se tarda en arreglar (más bajo es mejor)." />
          </Bloque>

          <section aria-label="Detalle" className="mb-6">
            <h3 className="m-0 mb-2 text-[15px] font-bold text-gypi-text font-heading">Detalle</h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-3">
              <div className="bg-gypi-surface border border-gypi-border rounded-xl p-3 mb-2 lg:col-span-2 overflow-x-auto">
                <div className="text-[13px] font-bold text-gypi-text mb-1">OT en proceso por etapa (hoy)</div>
                <table className="w-full border-collapse text-[13px]" aria-label="OT en proceso por etapa">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-gypi-dim">
                      <th scope="col" className="py-1.5 pr-2">Etapa</th>
                      <th scope="col" className="py-1.5 pr-2 text-right">En curso</th>
                      <th scope="col" className="py-1.5 pr-2 text-right">Esperando</th>
                      <th scope="col" className="py-1.5 text-right">Espera promedio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {panel.ahora.enProceso.etapas.map((e) => (
                      <tr key={e.id} className="border-t border-gypi-border" data-etapa={e.id}>
                        <td className="py-1.5 pr-2 font-semibold">{e.nombre}{panel.ahora.enProceso.cuello?.id === e.id ? " · 🚧 cuello de botella" : ""}</td>
                        <td className="py-1.5 pr-2 text-right">{e.enCurso}</td>
                        <td className="py-1.5 pr-2 text-right">{e.esperando}</td>
                        <td className="py-1.5 text-right">{horasTxt(e.esperaPromedio)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Lista titulo="Entregadas tarde esta semana" vacio="Ninguna." filas={s.entregas.tarde}
                render={(f) => <><NombreOt proyecto={f} /> · <b>{f.diasTarde} {f.diasTarde === 1 ? "día" : "días"} tarde</b> (meta {corta(f.objetivo)})</>} />
              <Lista titulo="Van tarde según el plan (hoy)" vacio="Ninguna." filas={panel.ahora.atrasadas.ots.slice(0, 10)}
                render={(f) => <><NombreOt proyecto={f} /> · <b>{f.diasTarde} {f.diasTarde === 1 ? "día" : "días"}</b></>} />
              <Lista titulo="En pausa (hoy)" vacio="Ninguna." filas={panel.ahora.pausadas.ots}
                render={(f) => <><NombreOt proyecto={f} /> · {f.motivo}</>} />
              <Lista titulo="Motivos de retrabajo esta semana" vacio="Sin retrabajo." filas={s.calidad.motivos}
                render={(f) => <>{f.motivo} · <b>{horasTxt(f.horas)}</b></>} />
              <Lista titulo="No conformidades esta semana" vacio="Ninguna." filas={s.calidad.defectos}
                render={(f) => <>{f.nombre} · <b>{f.cantidad}</b></>} />
              <Lista titulo="Máquinas paradas esta semana" vacio="Ninguna." filas={s.maquinas.porMaquina}
                render={(f) => <>{f.codigo}{f.nombre ? ` · ${f.nombre}` : ""} · <b>{horasTxt(f.horas)}</b></>} />
            </div>
          </section>
          <p className="text-xs text-gypi-mute mt-0 mb-4">
            Para medir el aprovechamiento de las máquinas (OEE), la productividad por hora-hombre o el desperdicio de placa hace falta registrar las paradas cortas, las horas por OT y el material que se tira; hoy no se cargan.
          </p>
        </>
      )}
    </div>
  );
}
