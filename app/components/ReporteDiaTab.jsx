'use client';
// app/components/ReporteDiaTab.jsx — Reportes → Del día (seguimiento de OT
// por escaneo, parte 26). Lo mismo que le llega por email al dueño a las
// 23 h: piezas escaneadas por OT con el % al empezar y al terminar el día,
// etapas terminadas o firmadas, reportes de instalación y OT atrasadas.
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyArg } from "../lib/dates";
import { fechaCorta } from "../lib/ot";
import Stat from "./ui/Stat";

const moverDia = (fecha, dias) => {
  const d = new Date(`${fecha}T12:00:00-03:00`);
  return hoyArg(new Date(d.getTime() + dias * 86400000));
};

function Tarjeta({ children }) {
  return <div className="bg-gypi-surface rounded-xl p-3 border border-gypi-border">{children}</div>;
}

function Seccion({ titulo, vacio, children, hay }) {
  return (
    <section aria-label={titulo} className="mb-4">
      <h3 className="m-0 mb-2 text-[14px] font-bold text-gypi-text font-heading">{titulo}</h3>
      {hay ? <div className="flex flex-col gap-1.5">{children}</div> : <div className="text-[13px] text-gypi-dim">{vacio}</div>}
    </section>
  );
}

const NombreOt = ({ o }) => (
  <>
    <span className="font-mono text-[13px] font-bold">OT {o.ot}</span>
    {o.cliente && <span className="text-[12px] text-gypi-dim truncate"> · {o.cliente}</span>}
  </>
);

export default function ReporteDiaTab() {
  const hoy = hoyArg();
  const [fecha, setFecha] = useState(hoy);
  const [estado, setEstado] = useState({ cargando: true, reporte: null, error: null });

  useEffect(() => {
    let vivo = true;
    setEstado((e) => ({ ...e, cargando: true, error: null })); // eslint-disable-line react-hooks/set-state-in-effect
    apiFetch(`/api/reportes/dia?fecha=${fecha}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || "No se pudo armar el reporte");
        if (vivo) setEstado({ cargando: false, reporte: data.reporte, error: null });
      })
      .catch((e) => { if (vivo) setEstado({ cargando: false, reporte: null, error: e.message }); });
    return () => { vivo = false; };
  }, [fecha]);

  const r = estado.reporte;
  return (
    <div>
      <div className="flex items-center justify-between py-2.5 px-3.5 bg-gypi-surface rounded-[14px] border border-gypi-border mb-3.5">
        <button onClick={() => setFecha(moverDia(fecha, -1))} aria-label="Día anterior" className="min-w-[48px] min-h-[48px] flex items-center justify-center bg-transparent border-none text-gypi-text cursor-pointer text-xl">←</button>
        <div className="text-sm font-bold text-gypi-text font-heading">{fecha === hoy ? "Hoy" : fechaCorta(fecha)}</div>
        <button onClick={() => setFecha(moverDia(fecha, 1))} disabled={fecha >= hoy} aria-label="Día siguiente" className="min-w-[48px] min-h-[48px] flex items-center justify-center bg-transparent border-none text-gypi-text cursor-pointer text-xl disabled:opacity-30">→</button>
      </div>
      <p className="text-[12px] text-gypi-dim mt-0 mb-3">Todos los días a las 23 h le llega este reporte por email al dueño de la cuenta (si ese día hubo movimiento).</p>

      {estado.cargando ? (
        <div className="gypi-dots" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>
      ) : estado.error ? (
        <div role="alert" className="text-[13px] text-gypi-red">{estado.error}</div>
      ) : r && (
        <>
          <section aria-label="Resumen del día" className="grid grid-cols-2 gap-2 mb-4">
            <Stat value={r.piezasHoy} label="Piezas escaneadas" />
            <Stat value={r.completadas.length} label="OT con producción terminada" tone={r.completadas.length ? "bien" : "normal"} />
            <Stat value={r.instalaciones.length} label="Reportes de instalación" />
            <Stat value={r.atrasadas.length} label="OT atrasadas" tone={r.atrasadas.length ? "mal" : "bien"} />
          </section>

          <Seccion titulo="Producción" hay={r.produccion.length > 0} vacio="Ese día no se escanearon piezas.">
            {r.produccion.map((o) => (
              <Tarjeta key={o.ot}>
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0 truncate"><NombreOt o={o} /></div>
                  <div className="text-[13px] font-bold text-gypi-amber-ink" aria-label={`De ${o.antes ?? 0}% a ${o.despues ?? 0}%`}>{o.antes ?? 0}% → {o.despues ?? 0}%</div>
                </div>
                <div className="text-[11px] text-gypi-dim mt-1">
                  {o.etapas.filter((e) => e.hoy > 0).map((e) => `${e.nombre}: ${e.hoy} ${e.hoy === 1 ? "pieza" : "piezas"} (${e.pasaron} de ${e.total})`).join(" · ")}
                </div>
              </Tarjeta>
            ))}
          </Seccion>

          <Seccion titulo="Etapas terminadas o firmadas" hay={r.etapasCerradas.length > 0} vacio="Ninguna etapa se marcó ni se firmó.">
            {r.etapasCerradas.map((x) => (
              <Tarjeta key={`${x.ot}-${x.codigo}-${x.que}`}>
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0 truncate"><NombreOt o={x} /> <span className="text-[12px]">· {x.nombre}</span></div>
                  <div className={`text-[12px] font-bold ${x.que === "firmada" ? "text-gypi-green" : "text-gypi-amber-ink"}`}>{x.que === "firmada" ? "Firmada" : "Falta la firma"}</div>
                </div>
              </Tarjeta>
            ))}
          </Seccion>

          <Seccion titulo="Instalación" hay={r.instalaciones.length > 0} vacio="No hubo reportes de instalación.">
            {r.instalaciones.map((i, n) => (
              <Tarjeta key={`${i.ot}-${n}`}>
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0 truncate"><NombreOt o={i} /></div>
                  {i.avance != null && <div className="text-[13px] font-bold text-gypi-amber-ink">{i.avance}%</div>}
                </div>
                <div className="text-[11px] text-gypi-dim mt-1">
                  {[i.quien, `${i.modulos} ${i.modulos === 1 ? "módulo colocado" : "módulos colocados"}`, i.comentario].filter(Boolean).join(" · ")}
                </div>
                {i.pendientes.length > 0 && <div className="text-[11px] text-gypi-amber-ink mt-0.5">Pendientes: {i.pendientes.join("; ")}</div>}
              </Tarjeta>
            ))}
          </Seccion>

          <Seccion titulo="Atrasadas contra la fecha de entrega" hay={r.atrasadas.length > 0} vacio="Ninguna OT atrasada.">
            {r.atrasadas.map((a) => (
              <Tarjeta key={a.ot}>
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0 truncate"><NombreOt o={a} /></div>
                  <div className="text-[12px] font-bold text-gypi-red">{a.dias === 1 ? "1 día" : `${a.dias} días`}{a.porcentaje != null ? ` · ${a.porcentaje}%` : ""}</div>
                </div>
                <div className="text-[11px] text-gypi-dim mt-1">Entrega {fechaCorta(a.entrega)}</div>
              </Tarjeta>
            ))}
          </Seccion>
        </>
      )}
    </div>
  );
}
