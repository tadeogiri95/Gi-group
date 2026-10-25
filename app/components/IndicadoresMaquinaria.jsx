'use client';
// app/components/IndicadoresMaquinaria.jsx — Mantenimiento → Maquinaria →
// 📊 Indicadores (parte 35; migración 134; solo gerencia y Administración).
// Del período elegido: cumplimiento del preventivo (lo bueno es más de 80 %),
// horas paradas, tiempo medio entre fallas (cuánto anda una máquina sin
// romperse), tiempo medio de arreglo (cuánto se tarda en volver a ponerla en
// marcha) y costo de mantenimiento por mes, junto con el de la flota. Si el
// tiempo entre fallas sube y el de arreglo baja, el mantenimiento funciona.
import { useEffect, useMemo, useState } from "react";
import { sbGetAll } from "../lib/supabase";
import { indicadoresMaquinaria, nivelCumplimiento, textoHoras } from "../lib/fallasMaquinaria";
import { nombreMes, ultimosMeses } from "../lib/arreglosFlota";
import { SEMAFORO } from "../lib/flota";
import { Chip, FilaDeslizable } from "./ui";

const PERIODOS = [
  { id: 1, nombre: "Este mes" },
  { id: 3, nombre: "3 meses" },
  { id: 6, nombre: "6 meses" },
  { id: 12, nombre: "12 meses" },
];
const pesos = (n) => `$ ${Math.round(n || 0).toLocaleString("es-AR")}`;
const pct = (c) => (c.pct == null ? "—" : `${SEMAFORO[nivelCumplimiento(c.pct)].emoji} ${c.pct} %`);
const dias = (d) => (d == null ? "—" : d < 1 ? textoHoras(d * 24) : `${Math.round(d)} días`);

function Dato({ titulo, valor, detalle }) {
  return (
    <div className="flex-1 min-w-[140px] p-2.5 rounded-[10px] border border-gypi-border bg-gypi-surface">
      <div className="text-[12px] text-gypi-dim">{titulo}</div>
      <div className="text-[18px] font-bold">{valor}</div>
      {detalle && <div className="text-[12px] text-gypi-dim">{detalle}</div>}
    </div>
  );
}

export default function IndicadoresMaquinaria({ maquinas = [], tareas = [], registros = [], fallas = [], hoy }) {
  const [meses, setMeses] = useState(1);
  const [flota, setFlota] = useState([]);
  const lista = useMemo(() => ultimosMeses(hoy, meses), [hoy, meses]);

  // El costo de la flota, para verlo junto (sin la 129 queda en cero)
  useEffect(() => {
    let vivo = true;
    sbGetAll("vehiculo_mantenimientos?select=fecha,costo&order=fecha.desc", { maxFilas: 5000 })
      .then((r) => { if (vivo) setFlota(r.data || []); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);

  const ind = useMemo(() => indicadoresMaquinaria({ maquinas, tareas, registros, fallas, meses: lista, hoy }), [maquinas, tareas, registros, fallas, lista, hoy]);
  const flotaMes = Object.fromEntries(lista.map((ym) => [ym, flota.filter((m) => String(m.fecha).slice(0, 7) === ym).reduce((a, m) => a + (Number(m.costo) || 0), 0)]));
  const flotaTotal = Object.values(flotaMes).reduce((a, b) => a + b, 0);
  const entreFallas = (() => {
    const con = ind.filas.filter((f) => f.entreFallasDias != null);
    return con.length ? con.reduce((a, f) => a + f.entreFallasDias, 0) / con.length : null;
  })();

  return (
    <div>
      <FilaDeslizable role="group" aria-label="Período" activa={meses} className="gap-1.5 mb-3">
        {PERIODOS.map((p) => <Chip key={p.id} active={meses === p.id} onClick={() => setMeses(p.id)}>{p.nombre}</Chip>)}
      </FilaDeslizable>

      <div className="flex gap-2 flex-wrap mb-3">
        <Dato titulo="Cumplimiento del preventivo" valor={pct(ind.total.cumplimiento)}
          detalle={ind.total.cumplimiento.tocaban ? `${ind.total.cumplimiento.hechas} de ${ind.total.cumplimiento.tocaban} tareas · lo bueno es más de 80 %` : "Todavía no tocaba ninguna tarea"} />
        <Dato titulo="Horas paradas" valor={textoHoras(ind.total.horasParada)} detalle={`${ind.total.fallas} falla${ind.total.fallas === 1 ? "" : "s"} avisada${ind.total.fallas === 1 ? "" : "s"}`} />
        <Dato titulo="Tiempo medio entre fallas" valor={dias(entreFallas)} detalle="Cuánto anda sin romperse" />
        <Dato titulo="Tiempo medio de arreglo" valor={textoHoras(ind.total.arregloHoras)} detalle="De que se avisa a que se arregla" />
      </div>

      <h3 className="m-0 mb-1.5 text-[16px] font-bold">Costo de mantenimiento</h3>
      <table className="w-full text-[13px] border-collapse mb-3">
        <thead><tr className="text-gypi-dim text-left"><th className="font-semibold py-1">Mes</th><th className="font-semibold py-1 text-right">Máquinas</th><th className="font-semibold py-1 text-right">Flota</th><th className="font-semibold py-1 text-right">Total</th></tr></thead>
        <tbody>
          {lista.map((ym) => (
            <tr key={ym} className="border-t border-gypi-border">
              <td className="py-1">{nombreMes(ym)} {ym.slice(0, 4)}</td>
              <td className="py-1 text-right">{pesos(ind.total.costoMes[ym])}</td>
              <td className="py-1 text-right">{pesos(flotaMes[ym])}</td>
              <td className="py-1 text-right font-semibold">{pesos(ind.total.costoMes[ym] + flotaMes[ym])}</td>
            </tr>
          ))}
          {lista.length > 1 && (
            <tr className="border-t border-gypi-border font-bold">
              <td className="py-1">Total</td>
              <td className="py-1 text-right">{pesos(ind.total.costo)}</td>
              <td className="py-1 text-right">{pesos(flotaTotal)}</td>
              <td className="py-1 text-right">{pesos(ind.total.costo + flotaTotal)}</td>
            </tr>
          )}
        </tbody>
      </table>

      <h3 className="m-0 mb-1.5 text-[16px] font-bold">Por máquina</h3>
      {!ind.filas.length ? (
        <div className="text-[14px] text-gypi-dim">Todavía no hay máquinas cargadas.</div>
      ) : (
        <ul aria-label="Indicadores por máquina" className="list-none m-0 p-0 flex flex-col gap-1.5">
          {ind.filas.map((f) => (
            <li key={f.maquina.id} className="p-2.5 rounded-[10px] border border-gypi-border bg-gypi-surface text-[13px]">
              <div className="text-[14px] font-bold">{f.maquina.codigo} · {f.maquina.nombre} <span className="font-normal text-gypi-dim">· Criticidad {f.maquina.criticidad}</span></div>
              <div className="text-gypi-dim">
                {[`Preventivo ${pct(f.cumplimiento)}`, `parada ${textoHoras(f.horasParada)}`, `${f.fallas} falla${f.fallas === 1 ? "" : "s"}`,
                  f.entreFallasDias != null ? `entre fallas ${dias(f.entreFallasDias)}` : null, f.arregloHoras != null ? `arreglo ${textoHoras(f.arregloHoras)}` : null,
                  f.costo ? pesos(f.costo) : null].filter(Boolean).join(" · ")}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
