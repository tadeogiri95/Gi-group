'use client';
// app/components/MiMantenimiento.jsx — "🔧 Mi mantenimiento" en el Inicio del
// operario (Mantenimiento, parte 34; migración 133). El responsable de
// mantenimiento (o el suplente) ve los vehículos y máquinas que tiene a cargo
// con su semáforo, lo vencido y lo de hoy arriba. Tocando un vehículo hace su
// checklist; tocando una tarea de una máquina, la registra (aviso de
// seguridad, puntos, horas, fotos y firma). Hacerla la pone al día.
import { useCallback, useEffect, useState } from "react";
import { sb } from "../lib/supabase";
import { hoyArg } from "../lib/dates";
import { SEMAFORO, textoVencimiento } from "../lib/flota";
import { textoAlerta } from "../lib/alertasFlota";
import { SEMAFORO_MAQUINA, textoEstadoTarea, tipoMaquina } from "../lib/maquinaria";
import { CAMPOS_MAQUINA, CAMPOS_VEHICULO, aCargoDe, miMantenimiento } from "../lib/mantenimiento";
import Modal from "./ui/Modal";
import ChecklistVehiculo from "./ChecklistVehiculo";
import RegistrarTarea from "./RegistrarTarea";

const enLista = (ids) => ids.join(",");

/**
 * Lo que tiene a cargo el empleado. Sin la 133 (o sin nada asignado) devuelve
 * una lista vacía. Devuelve { items, cargando, cargar }.
 */
export function useMiMantenimiento(empleadoId, { conFlota = false, conMaquinaria = false } = {}) {
  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    if (!empleadoId || (!conFlota && !conMaquinaria)) { setItems([]); setCargando(false); return; }
    const vacio = () => [];
    const [vehiculos, maquinas] = await Promise.all([
      conFlota ? sb.get("vehiculos?activo=eq.true&select=*&order=patente.asc").catch(vacio) : [],
      conMaquinaria ? sb.get("maquinas?activo=eq.true&select=*&order=codigo.asc").catch(vacio) : [],
    ]);
    const misV = (vehiculos || []).filter((v) => aCargoDe(v, empleadoId, CAMPOS_VEHICULO));
    const misM = (maquinas || []).filter((m) => aCargoDe(m, empleadoId, CAMPOS_MAQUINA));
    const idsV = misV.map((v) => v.id);
    const idsM = misM.map((m) => m.id);
    const [checklists, arreglos, tareas] = await Promise.all([
      idsV.length ? sb.get(`vehiculo_checklists?vehiculo_id=in.(${enLista(idsV)})&select=id,vehiculo_id,created_at,km,secciones&order=id.asc`).catch(vacio) : [],
      idsV.length ? sb.get(`vehiculo_arreglos?vehiculo_id=in.(${enLista(idsV)})&estado=eq.pendiente&select=id,vehiculo_id,descripcion,prioridad,estado&order=id.asc`).catch(vacio) : [],
      idsM.length ? sb.get(`maquina_tareas?maquina_id=in.(${enLista(idsM)})&activa=eq.true&order=orden.asc,id.asc`).catch(vacio) : [],
    ]);
    setItems(miMantenimiento(empleadoId, { vehiculos: misV, maquinas: misM, tareas: tareas || [], checklists: checklists || [], arreglos: arreglos || [], hoy: hoyArg() }));
    setCargando(false);
  }, [empleadoId, conFlota, conMaquinaria]);

  useEffect(() => { cargar(); }, [cargar]);
  return { items, cargando, cargar };
}

function Fila({ emoji, titulo, detalle, etiqueta, onClick }) {
  return (
    <button onClick={onClick} aria-label={etiqueta}
      className="w-full flex items-start gap-2.5 p-2.5 min-h-[44px] rounded-[10px] border border-gypi-border bg-gypi-surface text-left cursor-pointer font-body text-gypi-text">
      <span className="text-[18px]" aria-hidden="true">{emoji}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[14px] font-bold">{titulo}</span>
        {detalle && <span className="block text-[12px] text-gypi-dim">{detalle}</span>}
      </span>
    </button>
  );
}

export default function MiMantenimiento({ items, empresaNombre = "", onClose, onCambio }) {
  const [vehiculo, setVehiculo] = useState(null);
  const [tarea, setTarea] = useState(null); // { maquina, tarea }

  if (vehiculo) {
    return <ChecklistVehiculo vehiculos={[vehiculo]} empresaNombre={empresaNombre} onClose={() => setVehiculo(null)} onHecho={onCambio} />;
  }
  if (tarea) {
    return <RegistrarTarea maquina={tarea.maquina} tarea={tarea.tarea} onClose={() => setTarea(null)} onHecho={onCambio} />;
  }

  return (
    <Modal open onClose={onClose} title="🔧 Mi mantenimiento">
      <div className="p-4 overflow-y-auto text-gypi-text">
        {!items.length ? (
          <div className="text-[14px] text-gypi-dim">Todavía no tenés vehículos ni máquinas a cargo. Te los asigna la oficina desde Mantenimiento.</div>
        ) : (
          <ul aria-label="Lo que tenés a cargo" className="list-none m-0 p-0 flex flex-col gap-3">
            {items.map((x) => (
              <li key={x.id}>
                {x.tipo === "vehiculo" ? (
                  <>
                    <div className="text-[15px] font-bold mb-1">
                      {SEMAFORO[x.nivel]?.emoji || "✅"} 🚚 {x.vehiculo.patente}{x.vehiculo.marca || x.vehiculo.modelo ? ` · ${[x.vehiculo.marca, x.vehiculo.modelo].filter(Boolean).join(" ")}` : ""}
                      {x.rol === "suplente" && <span className="text-[12px] font-normal text-gypi-dim"> · como suplente</span>}
                    </div>
                    <Fila emoji="📋" titulo="Hacer el checklist" etiqueta={`Checklist de ${x.vehiculo.patente}`}
                      detalle={x.urgentes.length ? x.urgentes.slice(0, 3).map((a) => textoAlerta(a, textoVencimiento)).join(" · ") : "Al día"}
                      onClick={() => setVehiculo(x.vehiculo)} />
                  </>
                ) : (
                  <>
                    <div className="text-[15px] font-bold mb-1">
                      {SEMAFORO_MAQUINA[x.nivel]?.emoji} {tipoMaquina(x.maquina.tipo).emoji} {x.maquina.codigo} · {x.maquina.nombre}
                      {x.maquina.estado === "parada" && <span className="text-[12px] text-gypi-red"> · 🔴 Parada</span>}
                      {x.rol === "suplente" && <span className="text-[12px] font-normal text-gypi-dim"> · como suplente</span>}
                    </div>
                    {!x.tareas.length ? (
                      <div className="text-[13px] text-gypi-dim">{x.nivel === "fuera" ? "Fuera de servicio." : "Sin tareas en el plan."}</div>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {x.tareas.map((t) => (
                          <Fila key={t.tarea.id} emoji={SEMAFORO_MAQUINA[t.nivel].emoji} titulo={t.tarea.nombre} detalle={textoEstadoTarea(t)}
                            etiqueta={`${x.maquina.codigo}: ${t.tarea.nombre}`} onClick={() => setTarea({ maquina: x.maquina, tarea: t.tarea })} />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
