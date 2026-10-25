'use client';
// app/components/MaquinariaScreen.jsx — Mantenimiento → Maquinaria
// (Mantenimiento, parte 33; ítem 43; migración 132). Gerencia y
// Administración cargan las máquinas con su criticidad y su plan de
// mantenimiento (de una plantilla por tipo o a mano). Cada máquina muestra su
// semáforo: 🔴 vencida o parada, 🟡 toca pronto, ✅ al día. La pestaña
// 🔔 Alertas junta lo vencido y lo que toca pronto de todas, primero las A.
// Solo avisa, no bloquea nada.
import { useCallback, useEffect, useMemo, useState } from "react";
import { sbGetAll } from "../lib/supabase";
import { faltaTabla } from "../lib/compras";
import { hoyArg } from "../lib/dates";
import { SEMAFORO_MAQUINA, alertasMaquinaria, estadoMaquina, puedeEditarMaquinaria, textoEstadoTarea, tipoMaquina } from "../lib/maquinaria";
import { Chip, FilaDeslizable } from "./ui";
import FichaMaquina, { FormMaquina } from "./FichaMaquina";

const ORDEN_NIVEL = { vencido: 0, pronto: 1, ok: 2, fuera: 3 };
const AVISO_MIGRACION = "Para usar Maquinaria falta correr la migración 132 en Supabase.";

export default function MaquinariaScreen({ empresaId, usuario = null, vistaInicial = "maquinas" }) {
  const [maquinas, setMaquinas] = useState(null);
  const [tareas, setTareas] = useState([]);
  const [registros, setRegistros] = useState([]);
  const [divisiones, setDivisiones] = useState([]);
  const [error, setError] = useState(null);
  const [vista, setVista] = useState(vistaInicial);
  const [verBajas, setVerBajas] = useState(false);
  const [texto, setTexto] = useState("");
  const [fichaId, setFichaId] = useState(null);
  const [nueva, setNueva] = useState(false);
  const editable = puedeEditarMaquinaria(usuario?.rol);
  const hoy = hoyArg();

  const cargar = useCallback(async () => {
    if (!empresaId) return;
    try {
      const [m, t, r] = await Promise.all([
        sbGetAll("maquinas?order=codigo.asc,id.asc", { maxFilas: 2000 }),
        sbGetAll("maquina_tareas?activa=eq.true&order=orden.asc,id.asc", { maxFilas: 20000 }),
        sbGetAll("maquina_registros?order=fecha.desc,id.desc", { maxFilas: 5000 }),
      ]);
      setMaquinas(m.data || []);
      setTareas(t.data || []);
      setRegistros(r.data || []);
      setError(null);
      const e = await sbGetAll("empleados?activo=eq.true&select=division&order=division.asc", { maxFilas: 5000 }).catch(() => ({ data: [] }));
      setDivisiones([...new Set((e.data || []).map((x) => x.division).filter(Boolean))].sort());
    } catch (err) {
      setMaquinas([]);
      setError(["maquinas", "maquina_tareas", "maquina_registros"].some((x) => faltaTabla(err, x)) ? AVISO_MIGRACION : "No se pudo leer la maquinaria");
    }
  }, [empresaId]);
  useEffect(() => { cargar(); }, [cargar]);

  const filas = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return (maquinas || [])
      .filter((m) => (verBajas ? !m.activo : m.activo))
      .filter((m) => !t || [m.codigo, m.nombre, m.marca, m.modelo, m.ubicacion].some((x) => String(x ?? "").toLowerCase().includes(t)))
      .map((m) => ({ m, ...estadoMaquina(m, tareas, hoy) }))
      .sort((a, b) => ORDEN_NIVEL[a.nivel] - ORDEN_NIVEL[b.nivel] || a.m.criticidad.localeCompare(b.m.criticidad) || a.m.codigo.localeCompare(b.m.codigo));
  }, [maquinas, tareas, hoy, texto, verBajas]);
  const alertas = useMemo(() => alertasMaquinaria(maquinas || [], tareas, hoy), [maquinas, tareas, hoy]);

  const ficha = fichaId ? (maquinas || []).find((m) => m.id === fichaId) : null;

  if (nueva) {
    return (
      <div className="flex-1 overflow-y-auto px-[18px] pb-6">
        <FormMaquina divisiones={divisiones} onCancelar={() => setNueva(false)}
          onGuardado={async (m) => { setNueva(false); await cargar(); if (m?.id) setFichaId(m.id); }} />
      </div>
    );
  }

  if (ficha) {
    return (
      <div className="flex-1 overflow-y-auto px-[18px] pb-6">
        <FichaMaquina maquina={ficha} tareas={tareas.filter((t) => t.maquina_id === ficha.id)} registros={registros.filter((r) => r.maquina_id === ficha.id)}
          divisiones={divisiones} editable={editable} hoy={hoy} onVolver={() => setFichaId(null)} onCambio={cargar} />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      <FilaDeslizable role="group" aria-label="Ver" activa={vista} className="gap-1.5 mb-3">
        <Chip active={vista === "maquinas"} onClick={() => setVista("maquinas")}>⚙️ Máquinas</Chip>
        <Chip active={vista === "alertas"} onClick={() => setVista("alertas")}>🔔 Alertas{alertas.length ? ` (${alertas.length})` : ""}</Chip>
      </FilaDeslizable>
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}

      {vista === "maquinas" && (
        <>
          {editable && <button onClick={() => setNueva(true)} className="g-btn g-btn-primary w-full mb-3">＋ Agregar máquina</button>}
          <div className="flex gap-2 mb-2 items-center">
            <input aria-label="Buscar máquina" className="g-input flex-1 min-w-0" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar código, nombre o marca" />
            <label className="flex items-center gap-1 text-[13px] text-gypi-dim min-h-[44px]">
              <input type="checkbox" checked={verBajas} onChange={(e) => setVerBajas(e.target.checked)} /> Dadas de baja
            </label>
          </div>
          {maquinas === null ? (
            <div className="text-[14px] text-gypi-dim" role="status">Cargando las máquinas…</div>
          ) : !filas.length ? (
            <div className="text-[14px] text-gypi-dim">
              {maquinas.length ? "No hay máquinas con ese filtro." : "Todavía no hay máquinas. Agregá la primera: elegí el tipo y Gypi le carga un plan de mantenimiento para empezar."}
            </div>
          ) : (
            <ul aria-label="Máquinas" className="list-none m-0 p-0 lista-ancha flex flex-col gap-1.5">
              {filas.map(({ m, nivel, tareas: ts }) => {
                const urgentes = ts.filter((x) => x.nivel !== "ok");
                const datos = [`Criticidad ${m.criticidad}`, [m.marca, m.modelo].filter(Boolean).join(" "), m.ubicacion].filter(Boolean);
                return (
                  <li key={m.id}>
                    <button onClick={() => setFichaId(m.id)} aria-label={`Ver ${m.codigo}`}
                      className="w-full flex items-center gap-2.5 p-2.5 min-h-[44px] rounded-[10px] border border-gypi-border bg-gypi-surface text-left cursor-pointer font-body text-gypi-text">
                      <span className="text-[20px]" aria-label={SEMAFORO_MAQUINA[nivel].texto}>{SEMAFORO_MAQUINA[nivel].emoji}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[15px] font-bold">{tipoMaquina(m.tipo).emoji} {m.codigo} · {m.nombre}</span>
                        <span className="block text-[12px] text-gypi-dim truncate">{datos.join(" · ")}</span>
                        {m.estado === "parada" && <span className="block text-[12px] font-semibold">🔴 Parada</span>}
                        {urgentes.length > 0 && (
                          <span className="block text-[12px] font-semibold truncate">
                            {urgentes.slice(0, 2).map((x) => `${x.tarea.nombre}: ${textoEstadoTarea(x).toLowerCase()}`).join(" · ")}
                            {urgentes.length > 2 ? ` · y ${urgentes.length - 2} más` : ""}
                          </span>
                        )}
                      </span>
                      {m.con_horometro && m.horas != null && <span className="text-[12px] text-gypi-dim whitespace-nowrap">{m.horas.toLocaleString("es-AR")} h</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {vista === "alertas" && (
        <>
          <div className="text-[13px] text-gypi-dim mb-2">Lo vencido y lo que toca pronto de todas las máquinas; primero las de criticidad A. Solo avisa: no bloquea nada.</div>
          {maquinas === null ? (
            <div className="text-[14px] text-gypi-dim" role="status">Cargando las máquinas…</div>
          ) : !alertas.length ? (
            <div className="text-[14px] text-gypi-dim">✅ Todas las máquinas están al día.</div>
          ) : (
            <ul aria-label="Alertas de la maquinaria" className="list-none m-0 p-0 lista-ancha flex flex-col gap-1.5">
              {alertas.map((a) => (
                <li key={a.clave}>
                  <button onClick={() => setFichaId(a.maquina.id)} aria-label={`${a.maquina.codigo}: ${a.texto}`}
                    className="w-full flex items-center gap-2.5 p-2.5 min-h-[44px] rounded-[10px] border border-gypi-border bg-gypi-surface text-left cursor-pointer font-body text-gypi-text">
                    <span className="text-[20px]">{SEMAFORO_MAQUINA[a.nivel].emoji}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[14px] font-semibold">{a.texto}</span>
                      <span className="block text-[12px] text-gypi-dim truncate">{a.maquina.codigo} · {a.maquina.nombre} · Criticidad {a.maquina.criticidad}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
