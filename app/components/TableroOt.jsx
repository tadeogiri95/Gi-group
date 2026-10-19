'use client';
// app/components/TableroOt.jsx — Tablero de OT (Órdenes de Producción,
// parte 5; ítem 39). Como la pizarra de la planta: una fila por OT abierta,
// ordenadas por fecha de entrega, con la liberación y cada etapa de su ruta.
// El responsable toca una etapa para firmar su cierre, marcarla "no aplica"
// o reabrirla, y toca "Liberada" para el checklist y los puntos críticos.
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, sbGetAll } from "../lib/supabase";
import { filasTablero, ESTADO_INFO } from "../lib/avance";
import { esEtapaDeModulos, modulosHechos, textoModulos } from "../lib/calidad";
import { fechaCorta } from "../lib/ot";
import { hoyArg } from "../lib/dates";
import { estadoActa, NOMBRE_ESTADO_ACTA } from "../lib/acta";
import { avancePorOt, clavesEscaneadas, reglasPieza } from "../lib/piezas";

function claseCelda(estado) {
  switch (estado) {
    case "aprobada": return "bg-gypi-green/15 border-gypi-green text-gypi-green";
    case "terminada": return "bg-gypi-amber/15 border-gypi-green text-gypi-amber-ink";
    case "en_curso": return "bg-gypi-amber/15 border-gypi-amber text-gypi-amber-ink";
    case "no_aplica": return "bg-transparent border-dashed border-gypi-border text-gypi-dim line-through";
    default: return "bg-transparent border-gypi-border text-gypi-dim";
  }
}

function claseSemaforo(semaforo) {
  if (semaforo === "rojo") return "bg-gypi-red";
  if (semaforo === "amarillo") return "bg-gypi-amber";
  if (semaforo === "verde") return "bg-gypi-green";
  return "bg-gypi-border";
}

/** " 45%" en la celda de una etapa que se escanea por pieza y no está cerrada. */
function pctCelda(porEscaneo, ot, celda) {
  if (["terminada", "aprobada", "no_aplica"].includes(celda.estado)) return "";
  const e = porEscaneo.get(String(ot))?.etapas.find((x) => x.codigo === celda.codigo);
  return e ? ` ${e.porcentaje}%` : "";
}

function nombreEstado(estado) {
  return (ESTADO_INFO[estado] || ESTADO_INFO.pendiente).nombre;
}

function Hoja({ titulo, onClose, children }) {
  return (
    <div className="fixed inset-0 z-200 flex items-end justify-center" role="dialog" aria-label={titulo}>
      <div onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-[560px] bg-gypi-bg rounded-t-[20px] p-[20px_18px_30px] max-h-[90vh] overflow-y-auto border border-gypi-border text-gypi-text">
        <div className="flex items-start gap-3 mb-3">
          <h3 className="m-0 flex-1 font-heading text-lg font-bold">{titulo}</h3>
          <button onClick={onClose} aria-label="Cerrar" className="min-w-[44px] min-h-[44px] bg-transparent border-none text-2xl cursor-pointer text-gypi-text">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function TableroOt({ proyectos = [], empresaId, etapas = [], divisiones = [], checklist = [], onProyectoActualizado, onVerDetalle }) {
  const [avance, setAvance] = useState([]);
  const [horas, setHoras] = useState(new Set());
  const [modulos, setModulos] = useState(new Map()); // "OT|etapa" → módulos hechos (101)
  const [ncPendientes, setNcPendientes] = useState(new Map()); // OT → no conformidades sin decidir
  const [instalacion, setInstalacion] = useState(new Map()); // OT → estado del acta (105)
  const [escaneo, setEscaneo] = useState([]); // filas de v_avance_piezas (118)
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState(null);
  const [soloPorFirmar, setSoloPorFirmar] = useState(false);
  const [celda, setCelda] = useState(null); // { proyecto, codigo }
  const [liberando, setLiberando] = useState(null); // proyecto
  const [tildes, setTildes] = useState([]);
  const [puntos, setPuntos] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    if (!empresaId) return;
    setCargando(true);
    // Horas de los últimos 6 meses: alcanza para marcar las etapas "en curso"
    const desde = hoyArg(new Date(Date.now() - 183 * 86400000));
    const [av, hs, nc, actas, pendObra, pz] = await Promise.all([
      sbGetAll(`avance_etapas?empresa_id=eq.${empresaId}&select=ot,etapa,estado,terminada_at,aprobada_at`).catch(() => null),
      sbGetAll(`registro_actividades?empresa_id=eq.${empresaId}&etapa=gt.0&fecha=gte.${desde}&select=codigo_proyecto,etapa,cantidad`, { maxFilas: 20000 }).catch(() => ({ data: [] })),
      // Sin la migración 101 no hay tabla: el tablero sigue sin ese dato
      sbGetAll(`no_conformidades?empresa_id=eq.${empresaId}&decision=is.null&select=ot`).catch(() => ({ data: [] })),
      // Actas de instalación y pendientes abiertos (105); sin migración, sin dato
      sbGetAll(`actas_ot?empresa_id=eq.${empresaId}&firmada_at=not.is.null&select=ot,firmada_at`).catch(() => ({ data: [] })),
      sbGetAll(`pendientes_obra?empresa_id=eq.${empresaId}&resuelto=eq.false&select=ot,resuelto`).catch(() => ({ data: [] })),
      // Piezas escaneadas por OT y etapa (118); sin migración, sin %
      sbGetAll(`v_avance_piezas?empresa_id=eq.${empresaId}&select=ot,etapa,total,pasaron`, { maxFilas: 20000 }).catch(() => ({ data: [] })),
    ]);
    setAviso(av ? null : "No se pudo leer el avance (¿falta correr la migración 100?). Se muestran solo las horas.");
    setAvance(av?.data || []);
    // Una etapa con piezas escaneadas también está en curso
    setHoras(new Set([...(hs?.data || []).map((r) => `${r.codigo_proyecto}|${r.etapa}`), ...clavesEscaneadas(pz?.data)]));
    setEscaneo(pz?.data || []);
    setModulos(modulosHechos(hs?.data));
    const pend = new Map();
    for (const r of nc?.data || []) pend.set(String(r.ot), (pend.get(String(r.ot)) || 0) + 1);
    setNcPendientes(pend);
    const abiertos = new Map();
    for (const r of pendObra?.data || []) abiertos.set(String(r.ot), [...(abiertos.get(String(r.ot)) || []), r]);
    setInstalacion(new Map((actas?.data || []).map((a) => [String(a.ot), estadoActa({ acta: a, pendientes: abiertos.get(String(a.ot)) || [] }).estado])));
    setCargando(false);
  }, [empresaId]);

  useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect

  const hoy = hoyArg();
  const filas = useMemo(() => filasTablero(proyectos, { etapas, divisiones, avance, horas, hoy }), [proyectos, etapas, divisiones, avance, horas, hoy]);
  const porEscaneo = useMemo(() => avancePorOt(escaneo, reglasPieza(etapas).map((r) => r.codigo)), [escaneo, etapas]);
  const visibles = soloPorFirmar ? filas.filter((f) => f.porFirmar > 0) : filas;
  const porFirmar = filas.reduce((s, f) => s + f.porFirmar, 0);

  const enviar = async (body) => {
    setGuardando(true);
    setError(null);
    try {
      const r = await apiFetch("/api/avance", { method: "POST", body: JSON.stringify(body) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "No se pudo guardar");
      return data;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setGuardando(false);
    }
  };

  const accionEtapa = async (accion) => {
    const { proyecto, codigo } = celda;
    const data = await enviar({ accion, ot: String(proyecto.ot), etapa: codigo });
    if (!data) return;
    setAvance((prev) => {
      const resto = prev.filter((a) => !(String(a.ot) === String(proyecto.ot) && Number(a.etapa) === codigo));
      return data.avance ? [...resto, { ...data.avance, ot: String(proyecto.ot), etapa: codigo }] : resto;
    });
    setCelda(null);
  };

  const abrirLiberacion = (p) => {
    setLiberando(p);
    setTildes(Array.isArray(p.liberacion?.items) ? p.liberacion.items : []);
    setPuntos(p.puntos_criticos || "");
    setError(null);
  };

  const accionLiberacion = async (accion) => {
    const data = await enviar({ accion, ot: String(liberando.ot), liberacion: accion === "liberar" ? tildes : undefined, puntos_criticos: puntos.trim() || null });
    if (!data) return;
    onProyectoActualizado?.({ ...liberando, ...(data.proyecto || {}) });
    setLiberando(null);
  };

  const celdaInfo = celda ? filas.find((f) => f.proyecto.ot === celda.proyecto.ot)?.celdas.find((c) => c.codigo === celda.codigo) : null;
  const todoTildado = checklist.every((t) => tildes.includes(t));

  if (cargando) return <div className="gypi-dots py-6"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>;

  return (
    <div>
      {aviso && <div role="alert" className="text-[12px] text-gypi-red mb-2.5">{aviso}</div>}
      <div className="flex items-center gap-2 mb-2.5">
        <div className="flex-1 text-[12px] text-gypi-dim">
          {visibles.length} OT · ordenadas por entrega{porFirmar > 0 ? ` · ${porFirmar === 1 ? "1 etapa" : `${porFirmar} etapas`} por firmar` : ""}
        </div>
        {porFirmar > 0 && (
          <button onClick={() => setSoloPorFirmar(!soloPorFirmar)} aria-pressed={soloPorFirmar}
            className={`min-h-[44px] px-3 rounded-full text-xs font-bold cursor-pointer border ${soloPorFirmar ? "bg-gypi-amber text-gypi-on-amber border-gypi-amber" : "bg-gypi-surface text-gypi-dim border-gypi-border"}`}>
            Por firmar
          </button>
        )}
      </div>

      {visibles.length === 0 ? (
        <div className="text-sm text-gypi-dim py-4">No hay OT abiertas con estos filtros.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {visibles.map((f) => {
            const p = f.proyecto;
            return (
              <div key={p.id ?? p.ot} className="bg-gypi-surface rounded-xl p-3 border border-gypi-border">
                <button onClick={() => onVerDetalle?.(p)} className="w-full flex items-center gap-2 bg-transparent border-none p-0 text-left cursor-pointer text-gypi-text min-h-[44px]">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${claseSemaforo(f.semaforo)}`} aria-hidden="true" />
                  <span className="font-mono text-[13px] font-bold">{p.ot}</span>
                  <span className="flex-1 min-w-0 text-[12px] text-gypi-dim truncate">{p.cliente || p.proyecto || ""}</span>
                  {p.fecha_entrega && (
                    <span className={`text-[11px] font-bold ${f.semaforo === "rojo" ? "text-gypi-red" : f.semaforo === "amarillo" ? "text-gypi-amber-ink" : "text-gypi-dim"}`}>
                      {f.semaforo === "rojo" ? "Atrasada · " : ""}{fechaCorta(p.fecha_entrega)}
                    </span>
                  )}
                </button>
                {porEscaneo.get(String(p.ot))?.porcentaje != null && (
                  <div className="text-[11px] font-bold text-gypi-dim mb-1">🧩 Producción {porEscaneo.get(String(p.ot)).porcentaje}% por escaneo</div>
                )}
                {p.puntos_criticos && <div className="text-[11px] text-gypi-amber-ink truncate mb-1">⚠ {p.puntos_criticos}</div>}
                {instalacion.has(String(p.ot)) && (
                  <div className={`text-[11px] font-bold mb-1 ${instalacion.get(String(p.ot)) === "instalada" ? "text-gypi-green" : "text-gypi-amber-ink"}`}>{NOMBRE_ESTADO_ACTA[instalacion.get(String(p.ot))]}</div>
                )}
                {ncPendientes.get(String(p.ot)) > 0 && (
                  <div className="text-[11px] text-gypi-red font-bold mb-1">🟥 {ncPendientes.get(String(p.ot)) === 1 ? "1 pieza no conforme" : `${ncPendientes.get(String(p.ot))} piezas no conformes`} sin decidir</div>
                )}
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <button onClick={() => abrirLiberacion(p)} aria-label={`Liberación de la OT ${p.ot}: ${f.liberada ? "liberada" : "sin liberar"}`}
                    className={`min-h-[44px] px-2.5 rounded-lg border text-[11px] font-bold cursor-pointer ${f.liberada ? claseCelda("aprobada") : claseCelda("pendiente")}`}>
                    {f.liberada ? "✓ Liberada" : "Liberar"}
                  </button>
                  {f.celdas.map((c) => (
                    <button key={c.codigo} onClick={() => { setCelda({ proyecto: p, codigo: c.codigo }); setError(null); }}
                      aria-label={`${c.etapa.nombre} de la OT ${p.ot}: ${nombreEstado(c.estado)}`}
                      className={`min-h-[44px] px-2.5 rounded-lg border text-[11px] font-bold cursor-pointer ${claseCelda(c.estado)}`}>
                      {c.etapa.icon} {c.etapa.nombre}{esEtapaDeModulos(c.etapa) && (p.total_modulos || modulos.get(`${p.ot}|${c.codigo}`)) ? ` ${textoModulos(modulos.get(`${p.ot}|${c.codigo}`), p.total_modulos)}` : ""}{pctCelda(porEscaneo, p.ot, c)}{c.estado === "terminada" ? " ✓" : c.estado === "aprobada" ? " ✓✓" : ""}
                    </button>
                  ))}
                  {f.celdas.length === 0 && <span className="text-[11px] text-gypi-dim self-center">Sin ruta ni horas todavía</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="text-[11px] text-gypi-dim mt-3">Vacío: sin empezar · Amarillo: en curso · ✓: terminada, falta la firma · Verde ✓✓: firmada · Tachada: no aplica.</div>

      {celda && celdaInfo && (
        <Hoja titulo={`${celdaInfo.etapa.nombre} · OT ${celda.proyecto.ot}`} onClose={() => setCelda(null)}>
          <div className="text-sm mb-2"><b>Estado:</b> {nombreEstado(celdaInfo.estado)}</div>
          {(() => {
            const e = porEscaneo.get(String(celda.proyecto.ot))?.etapas.find((x) => x.codigo === celda.codigo);
            return e ? <div className="text-[12px] text-gypi-dim mb-1">🧩 {e.pasaron} de {e.total} piezas escaneadas ({e.porcentaje}%)</div> : null;
          })()}
          {celdaInfo.fila?.terminada_at && <div className="text-[12px] text-gypi-dim mb-1">Marcada como terminada el {fechaCorta(celdaInfo.fila.terminada_at.slice(0, 10))}</div>}
          {celdaInfo.fila?.aprobada_at && <div className="text-[12px] text-gypi-dim mb-1">Firmada el {fechaCorta(celdaInfo.fila.aprobada_at.slice(0, 10))}</div>}
          {celdaInfo.etapa.condicion_cierre && (
            <div className="text-[13px] bg-gypi-surface rounded-xl p-3 border border-gypi-border my-2.5"><b>Para firmar:</b> {celdaInfo.etapa.condicion_cierre}</div>
          )}
          {error && <div role="alert" className="text-[12px] text-gypi-red mb-2">{error}</div>}
          <div className="flex flex-col gap-2 mt-3">
            {celdaInfo.estado !== "aprobada" && (
              <button onClick={() => accionEtapa("aprobar")} disabled={guardando} className="g-btn g-btn-primary">✓ Firmar el cierre de la etapa</button>
            )}
            {celdaInfo.estado !== "no_aplica" && (
              <button onClick={() => accionEtapa("no_aplica")} disabled={guardando} className="g-btn g-btn-secondary">No aplica en esta OT</button>
            )}
            {celdaInfo.fila && (
              <button onClick={() => accionEtapa("reabrir")} disabled={guardando} className="g-btn g-btn-secondary">Reabrir (vuelve a pendiente)</button>
            )}
          </div>
        </Hoja>
      )}

      {liberando && (
        <Hoja titulo={`Liberación · OT ${liberando.ot}`} onClose={() => setLiberando(null)}>
          {liberando.liberada_at && <div className="text-[13px] text-gypi-green mb-2">✓ Liberada el {fechaCorta(liberando.liberada_at.slice(0, 10))}</div>}
          {checklist.length > 0 ? (
            <div className="flex flex-col gap-1.5 mb-3">
              {checklist.map((t) => (
                <label key={t} className="flex items-center gap-2.5 min-h-[44px] bg-gypi-surface rounded-xl px-3 border border-gypi-border text-[13px] cursor-pointer">
                  <input type="checkbox" className="w-5 h-5" checked={tildes.includes(t)}
                    onChange={(e) => setTildes(e.target.checked ? [...tildes, t] : tildes.filter((x) => x !== t))} />
                  <span className="flex-1">{t}</span>
                </label>
              ))}
            </div>
          ) : (
            <div className="text-[12px] text-gypi-dim mb-3">Tu empresa no tiene checklist de liberación. Lo podés armar en Configuración → Liberación.</div>
          )}
          <div className="g-label mb-1.5">Puntos críticos de la OT</div>
          <textarea className="g-input mb-1 min-h-[88px]" maxLength={2000} value={puntos} onChange={(e) => setPuntos(e.target.value)}
            aria-label="Puntos críticos de la OT" placeholder="Ej: piezas VER PLANO, cortes a 45°, madera lustrada" />
          <div className="text-[11px] text-gypi-dim mb-3">El operario los ve al elegir la OT y mientras trabaja en ella.</div>
          {error && <div role="alert" className="text-[12px] text-gypi-red mb-2">{error}</div>}
          <div className="flex flex-col gap-2">
            {!liberando.liberada_at && (
              <button onClick={() => accionLiberacion("liberar")} disabled={guardando || !todoTildado} className="g-btn g-btn-primary">
                {todoTildado ? "✓ Liberar la OT a producción" : "Tildá todo el checklist para liberar"}
              </button>
            )}
            <button onClick={() => accionLiberacion("puntos")} disabled={guardando} className="g-btn g-btn-secondary">Guardar puntos críticos</button>
            {liberando.liberada_at && (
              <button onClick={() => accionLiberacion("desliberar")} disabled={guardando} className="g-btn g-btn-secondary">Quitar la liberación</button>
            )}
          </div>
        </Hoja>
      )}
    </div>
  );
}
