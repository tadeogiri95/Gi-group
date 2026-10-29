"use client";
// app/components/AvanceManualOt.jsx — ✍ Checkeo manual de OT (Tadeo, 27/10;
// migración 141). Manda el escaneo de piezas; en los procesos sin escaneo,
// gestión carga a mano cuánto va cada uno. Se usa en el detalle de la OT y en
// Proyectos → Planificación. Lo guardado lo leen la carga de la planta, el
// Gantt y el % de las OT (app/lib/avanceManual.js).
import { useContext, useState } from "react";
import { sb } from "../lib/supabase";
import { AuthContext } from "../context/AuthContext";
import { normalizarAvanceManual, etapasDeOt, tieneEscaneo } from "../lib/avanceManual";
import { esGestion } from "../lib/cargaInicio";
import { fechaCorta } from "../lib/ot";

const AVISO_MIGRACION = "Para el checkeo manual falta correr la migración 141 en Supabase.";

/**
 * @param {{ proyecto: object, etapas: object[], divisiones: object[], piezas?: object[], onGuardado?: (valor: object) => void }} props
 *   piezas: filas de v_avance_piezas de la OT (solo escaneo)
 */
export default function AvanceManualOt({ proyecto, etapas = [], divisiones = [], piezas = [], onGuardado }) {
  // Sin sesión (p. ej. en pruebas sueltas) se ve solo lectura
  const { usuario } = useContext(AuthContext) || {};
  const puedeEditar = esGestion(usuario);
  const guardado = normalizarAvanceManual(proyecto?.avance_manual);
  const [activo, setActivo] = useState(guardado.activo);
  const [textos, setTextos] = useState(() => Object.fromEntries(Object.entries(guardado.etapas).map(([c, n]) => [c, String(n)])));
  const [estado, setEstado] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const procesos = etapasDeOt(proyecto, etapas, divisiones);
  const ot = proyecto?.ot;
  const escaneo = (codigo) => {
    const f = (piezas || []).find((x) => String(x.ot) === String(ot) && Number(x.etapa) === Number(codigo) && !x.manual);
    return f && Number(f.total) > 0 ? Math.round((Math.min(Number(f.pasaron) || 0, Number(f.total)) / Number(f.total)) * 100) : null;
  };
  const error = (txt) => {
    if (!String(txt ?? "").trim()) return null;
    const n = Number(String(txt).replace(",", "."));
    return Number.isFinite(n) && n >= 0 && n <= 100 ? null : "Entre 0 y 100";
  };
  const hayError = procesos.some((e) => error(textos[e.codigo]));

  if (!procesos.length) return null;
  if (!puedeEditar && !guardado.activo) return null;

  const guardar = async () => {
    if (hayError) return;
    setGuardando(true);
    setEstado(null);
    const etapasValor = {};
    for (const e of procesos) {
      const t = String(textos[e.codigo] ?? "").trim();
      if (t && !tieneEscaneo(piezas, ot, e.codigo)) etapasValor[String(e.codigo)] = Math.round(Number(t.replace(",", ".")));
    }
    const valor = { activo, etapas: etapasValor, por: usuario?.apodo || usuario?.nombre || null, at: new Date().toISOString() };
    try {
      await sb.patch(`proyectos?id=eq.${proyecto.id}`, { avance_manual: valor });
      // Historial (146) para saber cuánto se avanzó en cada período (informe de producción).
      // Solo lo que cambió; sin la migración, el checkeo se guarda igual.
      if (activo) {
        const cambios = Object.entries(etapasValor).filter(([c, n]) => guardado.etapas[c] !== n || !guardado.activo)
          .map(([c, n]) => ({ ot: String(ot), etapa: Number(c), pct: n }));
        for (const c of cambios) await sb.post("avance_manual_historial", c).catch(() => null);
      }
      onGuardado?.(valor);
      setEstado(activo ? "✅ Avance guardado" : "✅ Checkeo manual apagado: queda solo el escaneo");
    } catch (e) {
      setEstado(/avance_manual/.test(String(e.message)) ? AVISO_MIGRACION : `No se pudo guardar: ${e.message}`);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <section className="mb-4" aria-label={`Checkeo manual de la OT ${ot}`}>
      <div className="g-label mb-1.5">✍ Checkeo manual de OT</div>
      <div className="text-xs text-gypi-dim mb-2">
        Manda el escaneo de piezas. En los procesos sin escaneo podés cargar a mano cuánto van; se usa en la planificación, el Gantt y el % de la OT.
      </div>
      {puedeEditar && (
        <label className="flex items-center gap-2.5 cursor-pointer mb-2">
          <input type="checkbox" className="w-5 h-5" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
          <span className="text-[14px] font-bold">Usar checkeo manual en esta OT</span>
        </label>
      )}
      {activo && (
        <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
          {procesos.map((e) => {
            const pctEscaneo = escaneo(e.codigo);
            const conEscaneo = tieneEscaneo(piezas, ot, e.codigo);
            const id = `avance-${proyecto.id}-${e.codigo}`;
            return (
              <li key={e.codigo} className="flex items-center gap-2 bg-gypi-surface rounded-xl p-2.5 border border-gypi-border">
                {e.icon && <span className="text-lg">{e.icon}</span>}
                <label htmlFor={id} className="flex-1 min-w-0 text-[13px] font-bold truncate">{e.nombre}</label>
                {conEscaneo ? (
                  <span className="text-xs text-gypi-dim text-right">🧩 {pctEscaneo}% por escaneo<br />manda el escaneo</span>
                ) : puedeEditar ? (
                  <span className="flex items-center gap-1">
                    <input id={id} className="g-input w-[72px] text-right" inputMode="numeric" value={textos[e.codigo] ?? ""} placeholder="—"
                      aria-label={`Avance de ${e.nombre} en la OT ${ot}, en %`}
                      onChange={(ev) => setTextos({ ...textos, [e.codigo]: ev.target.value })} />
                    <span className="text-[13px]">%</span>
                  </span>
                ) : (
                  <span className="text-[13px] font-bold">{guardado.etapas[e.codigo] != null ? `${guardado.etapas[e.codigo]}%` : "—"}</span>
                )}
                {error(textos[e.codigo]) && <span role="alert" className="text-xs text-gypi-red">{error(textos[e.codigo])}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {guardado.activo && guardado.por && (
        <div className="text-xs text-gypi-dim mt-1.5">Cargado por {guardado.por}{guardado.at ? ` el ${fechaCorta(guardado.at.slice(0, 10))}` : ""}.</div>
      )}
      {estado && <div role="status" className="text-[13px] text-gypi-dim mt-1.5">{estado}</div>}
      {puedeEditar && (activo || guardado.activo) && (
        <button type="button" onClick={guardar} disabled={guardando || hayError} className="g-btn g-btn-primary w-full mt-2">
          {guardando ? "Guardando…" : "Guardar avance"}
        </button>
      )}
    </section>
  );
}
