"use client";
// app/components/AvanceManualOt.jsx — ✍ Checkeo manual de OT (Tadeo, 27/10;
// migración 141). Manda el escaneo de piezas; en los procesos sin escaneo,
// gestión carga a mano cuánto va cada uno. Se usa en el detalle de la OT y en
// Proyectos → Planificación. Lo guardado lo leen la carga de la planta, el
// Gantt y el % de las OT (app/lib/avanceManual.js).
// Completar a mano (Tadeo, 27/11): en un proceso con escaneo empezado,
// gestión puede tildar "Completar a mano" (p. ej. el mueble se fue sin
// escanear): queda al 100 % y la etapa se marca terminada (/api/avance), así
// deja de figurar en curso en la Lista, el Trello y el Gantt.
import { useContext, useState } from "react";
import { sb, apiFetch } from "../lib/supabase";
import { AuthContext } from "../context/AuthContext";
import { normalizarAvanceManual, etapasDeOt, tieneEscaneo, pctEscaneo, valorEtapasManual } from "../lib/avanceManual";
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
  const escaneo = (codigo) => pctEscaneo(piezas, ot, codigo);
  // Procesos con escaneo que ya estaban completados a mano (100 guardado)
  const completadosAntes = guardado.activo
    ? procesos.filter((e) => tieneEscaneo(piezas, ot, e.codigo) && guardado.etapas[String(e.codigo)] >= 100).map((e) => String(e.codigo))
    : [];
  const [completar, setCompletar] = useState(() => new Set(completadosAntes));
  const tildar = (codigo, si) => {
    const n = new Set(completar);
    if (si) n.add(String(codigo)); else n.delete(String(codigo));
    setCompletar(n);
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
    const etapasValor = valorEtapasManual(procesos, textos, completar, piezas, ot);
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
      // La etapa completada a mano queda terminada (falta la firma, como con el
      // último escaneo); la que se destildó vuelve a seguir el escaneo.
      const ahora = activo ? procesos.filter((e) => tieneEscaneo(piezas, ot, e.codigo) && completar.has(String(e.codigo))).map((e) => String(e.codigo)) : [];
      const nuevos = ahora.filter((c) => !completadosAntes.includes(c));
      const sacados = completadosAntes.filter((c) => !ahora.includes(c));
      let fallo = false;
      for (const [accion, lista] of [["terminar", nuevos], ["reabrir", sacados]]) {
        for (const c of lista) {
          const r = await apiFetch("/api/avance", { method: "POST", body: JSON.stringify({ accion, ot: String(ot), etapa: Number(c) }) }).catch(() => null);
          if (!r?.ok) fallo = true;
        }
      }
      onGuardado?.(valor);
      setEstado(fallo
        ? "⚠️ Avance guardado, pero no se pudo marcar la etapa como terminada. Probá de nuevo."
        : activo ? "✅ Avance guardado" : "✅ Checkeo manual apagado: queda solo el escaneo");
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
        Manda el escaneo de piezas. En los procesos sin escaneo podés cargar a mano cuánto van; se usa en la planificación, el Gantt y el % de la OT. Si un proceso con escaneo no se va a poder terminar escaneando, tildá «Completar a mano».
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
            const pctEsc = escaneo(e.codigo);
            const conEscaneo = tieneEscaneo(piezas, ot, e.codigo);
            const id = `avance-${proyecto.id}-${e.codigo}`;
            return (
              <li key={e.codigo} className="flex items-center gap-2 bg-gypi-surface rounded-xl p-2.5 border border-gypi-border">
                {e.icon && <span className="text-lg">{e.icon}</span>}
                <label htmlFor={id} className="flex-1 min-w-0 text-[13px] font-bold truncate">{e.nombre}</label>
                {conEscaneo ? (
                  <span className="flex flex-col items-end gap-1 text-right">
                    <span className="text-xs text-gypi-dim">🧩 {pctEsc}% por escaneo{completar.has(String(e.codigo)) ? "" : <><br />manda el escaneo</>}</span>
                    {puedeEditar && (pctEsc < 100 || completar.has(String(e.codigo))) ? (
                      <label className="flex items-center gap-1.5 cursor-pointer text-[13px] font-bold">
                        <input type="checkbox" className="w-4 h-4" checked={completar.has(String(e.codigo))}
                          aria-label={`Completar a mano ${e.nombre} en la OT ${ot}`}
                          onChange={(ev) => tildar(e.codigo, ev.target.checked)} />
                        ✔ Completar a mano
                      </label>
                    ) : !puedeEditar && completadosAntes.includes(String(e.codigo)) ? (
                      <span className="text-[13px] font-bold">✔ Completada a mano</span>
                    ) : null}
                  </span>
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
