'use client';
// app/components/FlotaScreen.jsx — Mantenimiento → Flota (Mantenimiento, parte 28;
// ítem 43; migración 126). Gerencia y Administración cargan los vehículos,
// su responsable (el chofer habitual) y sus papeles con vencimiento. Cada
// vehículo muestra su semáforo: 🔴 vencido, 🟡 vence pronto, ✅ al día. Solo
// avisa, no bloquea nada. Los checklists hechos y la plantilla del checklist
// son de la parte 29 (127). Las alertas (parte 30, 128) suman a los papeles
// cada cuánto se revisa cada aspecto y el último service; la pestaña 🔔 Alertas
// junta lo vencido y lo que vence pronto de toda la flota. La parte 31 (129)
// suma los arreglos pendientes (🔴 no puede circular), services y
// reparaciones, el historial de cada vehículo y la pestaña 💲 Costos.
import { useCallback, useEffect, useMemo, useState } from "react";
import { sbGetAll } from "../lib/supabase";
import { faltaTabla } from "../lib/compras";
import { hoyArg } from "../lib/dates";
import {
  AVISO_LICENCIA, SEMAFORO, estadoVencimiento, nombreTipoVehiculo, peorNivel, puedeEditarFlota, textoVencimiento,
} from "../lib/flota";
import { alertasVehiculo, textoAlerta, urgentes as soloUrgentes } from "../lib/alertasFlota";
import { costosFlota, nombreMes, textoCosto, ultimosMeses } from "../lib/arreglosFlota";
import { Chip, FilaDeslizable } from "./ui";
import FichaVehiculo, { FormVehiculo, FormLicencia } from "./FichaVehiculo";
import { ListaChecklists, VerChecklist } from "./ChecklistsVehiculo";
import PlantillaChecklist from "./PlantillaChecklist";

const ORDEN_NIVEL = { vencido: 0, pronto: 1, ok: 2 };
const AVISO_MIGRACION = "Para usar Flota falta correr la migración 126 en Supabase.";

export default function FlotaScreen({ empresaId, empresa = null, usuario = null, vistaInicial = "vehiculos" }) {
  const [vehiculos, setVehiculos] = useState(null);
  const [papeles, setPapeles] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [error, setError] = useState(null);
  const [vista, setVista] = useState(vistaInicial);
  const [verBajas, setVerBajas] = useState(false);
  const [texto, setTexto] = useState("");
  const [fichaId, setFichaId] = useState(null);
  const [nuevo, setNuevo] = useState(false);
  const [licencia, setLicencia] = useState(null);
  const [checklists, setChecklists] = useState([]);
  const [verChecklist, setVerChecklist] = useState(null);
  const [arreglos, setArreglos] = useState([]);
  const [mantenimientos, setMantenimientos] = useState([]);
  const editable = puedeEditarFlota(usuario?.rol);
  const hoy = hoyArg();

  const cargar = useCallback(async () => {
    if (!empresaId) return;
    try {
      const [v, p, e] = await Promise.all([
        sbGetAll("vehiculos?order=patente.asc,id.asc", { maxFilas: 2000 }),
        sbGetAll("vehiculo_papeles?order=created_at.desc,id.desc", { maxFilas: 20000 }),
        // Con la 133 viene la casilla "Responsable de mantenimiento" (parte 34)
        sbGetAll("empleados?activo=eq.true&select=id,nombre,division,licencia_categoria,licencia_vencimiento,es_mantenimiento&order=nombre.asc,id.asc", { maxFilas: 5000 })
          .catch(() => sbGetAll("empleados?activo=eq.true&select=id,nombre,division,licencia_categoria,licencia_vencimiento&order=nombre.asc,id.asc", { maxFilas: 5000 })),
      ]);
      setVehiculos(v.data || []);
      setPapeles(p.data || []);
      setEmpleados(e.data || []);
      setError(null);
      // Sin la migración 127 la flota anda igual; el checklist avisa al abrirlo
      const c = await sbGetAll("vehiculo_checklists?order=created_at.desc,id.desc", { maxFilas: 2000 }).catch(() => ({ data: [] }));
      setChecklists(c.data || []);
      // Ídem sin la 129: sin arreglos ni services
      const [a, m] = await Promise.all([
        sbGetAll("vehiculo_arreglos?order=created_at.desc,id.desc", { maxFilas: 5000 }).catch(() => ({ data: [] })),
        sbGetAll("vehiculo_mantenimientos?order=fecha.desc,id.desc", { maxFilas: 5000 }).catch(() => ({ data: [] })),
      ]);
      setArreglos(a.data || []);
      setMantenimientos(m.data || []);
    } catch (err) {
      setVehiculos([]);
      setError(["vehiculos", "vehiculo_papeles", "licencia_"].some((t) => faltaTabla(err, t)) ? AVISO_MIGRACION : "No se pudo leer la flota");
    }
  }, [empresaId]);
  useEffect(() => { cargar(); }, [cargar]);

  const porId = useMemo(() => new Map(empleados.map((e) => [e.id, e])), [empleados]);
  // Alertas de cada vehículo: papeles, licencia, revisiones y service
  const alertas = useMemo(() => new Map((vehiculos || []).map((v) => [v.id, alertasVehiculo(v, {
    papeles: papeles.filter((p) => p.vehiculo_id === v.id), checklists, arreglos, responsable: porId.get(v.responsable_id), hoy,
  })])), [vehiculos, papeles, checklists, arreglos, porId, hoy]);
  // Pestaña 💲 Costos: los últimos 6 meses
  const meses = useMemo(() => ultimosMeses(hoy, 6), [hoy]);
  const costos = useMemo(() => costosFlota({ vehiculos: (vehiculos || []).filter((v) => v.activo || mantenimientos.some((m) => m.vehiculo_id === v.id)), mantenimientos, checklists, meses }), [vehiculos, mantenimientos, checklists, meses]);
  const filas = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return (vehiculos || [])
      .filter((v) => (verBajas ? !v.activo : v.activo))
      .filter((v) => !t || [v.patente, v.marca, v.modelo, porId.get(v.responsable_id)?.nombre].some((x) => String(x ?? "").toLowerCase().includes(t)))
      .map((v) => {
        const avisos = alertas.get(v.id) || [];
        return { v, nivel: peorNivel(avisos), urgentes: soloUrgentes(avisos) };
      })
      .sort((a, b) => ORDEN_NIVEL[a.nivel] - ORDEN_NIVEL[b.nivel] || a.v.patente.localeCompare(b.v.patente));
  }, [vehiculos, alertas, porId, texto, verBajas]);
  // Pestaña 🔔 Alertas: una fila por alerta de los vehículos activos, lo más urgente primero
  const todasUrgentes = useMemo(() => soloUrgentes((vehiculos || []).filter((v) => v.activo)
    .flatMap((v) => (alertas.get(v.id) || []).map((a) => ({ ...a, vehiculo: v })))), [vehiculos, alertas]);

  const choferes = useMemo(() => {
    const responsables = new Set((vehiculos || []).filter((v) => v.activo && v.responsable_id).map((v) => v.responsable_id));
    return empleados
      .filter((e) => responsables.has(e.id) || e.licencia_vencimiento || e.licencia_categoria)
      .map((e) => ({ e, estado: estadoVencimiento(e.licencia_vencimiento, AVISO_LICENCIA, hoy), patentes: (vehiculos || []).filter((v) => v.activo && v.responsable_id === e.id).map((v) => v.patente) }));
  }, [empleados, vehiculos, hoy]);

  const ficha = fichaId ? (vehiculos || []).find((v) => v.id === fichaId) : null;
  const divisiones = useMemo(() => [...new Set(empleados.map((e) => e.division).filter(Boolean))].sort(), [empleados]);

  if (nuevo) {
    return (
      <div className="flex-1 overflow-y-auto px-[18px] pb-6">
        <FormVehiculo empleados={empleados} divisiones={divisiones} onCancelar={() => setNuevo(false)}
          onGuardado={async (v) => { setNuevo(false); await cargar(); if (v?.id) setFichaId(v.id); }} />
      </div>
    );
  }

  if (ficha) {
    return (
      <div className="flex-1 overflow-y-auto px-[18px] pb-6">
        <FichaVehiculo vehiculo={ficha} papeles={papeles.filter((p) => p.vehiculo_id === ficha.id)} empleados={empleados} divisiones={divisiones}
          checklists={checklists.filter((c) => c.vehiculo_id === ficha.id)} empresaNombre={empresa?.nombre || ""}
          arreglos={arreglos.filter((a) => a.vehiculo_id === ficha.id)} mantenimientos={mantenimientos.filter((m) => m.vehiculo_id === ficha.id)}
          editable={editable} hoy={hoy} onVolver={() => setFichaId(null)} onCambio={cargar} />
      </div>
    );
  }

  if (verChecklist) {
    return (
      <div className="flex-1 overflow-y-auto px-[18px] pb-6">
        <VerChecklist checklist={verChecklist} vehiculo={(vehiculos || []).find((v) => v.id === verChecklist.vehiculo_id)} empresaNombre={empresa?.nombre || ""} onVolver={() => setVerChecklist(null)} />
      </div>
    );
  }

  if (licencia) {
    return (
      <div className="flex-1 overflow-y-auto px-[18px] pb-6">
        <FormLicencia empleado={licencia} onCancelar={() => setLicencia(null)} onGuardado={async () => { setLicencia(null); await cargar(); }} />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      <FilaDeslizable role="group" aria-label="Ver" activa={vista} className="gap-1.5 mb-3">
        <Chip active={vista === "vehiculos"} onClick={() => setVista("vehiculos")}>🚚 Vehículos</Chip>
        <Chip active={vista === "alertas"} onClick={() => setVista("alertas")}>🔔 Alertas{todasUrgentes.length ? ` (${todasUrgentes.length})` : ""}</Chip>
        <Chip active={vista === "checklists"} onClick={() => setVista("checklists")}>📋 Checklists</Chip>
        <Chip active={vista === "choferes"} onClick={() => setVista("choferes")}>🪪 Choferes</Chip>
        {editable && <Chip active={vista === "costos"} onClick={() => setVista("costos")}>💲 Costos</Chip>}
        {editable && <Chip active={vista === "plantilla"} onClick={() => setVista("plantilla")}>⚙ Checklist</Chip>}
      </FilaDeslizable>
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}

      {vista === "vehiculos" && (
        <>
          {editable && <button onClick={() => setNuevo(true)} className="g-btn g-btn-primary w-full mb-3">＋ Agregar vehículo</button>}
          <div className="flex gap-2 mb-2 items-center">
            <input aria-label="Buscar vehículo" className="g-input flex-1 min-w-0" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar patente, marca o chofer" />
            <label className="flex items-center gap-1 text-[13px] text-gypi-dim min-h-[44px]">
              <input type="checkbox" checked={verBajas} onChange={(e) => setVerBajas(e.target.checked)} /> Dados de baja
            </label>
          </div>
          {vehiculos === null ? (
            <div className="text-[14px] text-gypi-dim" role="status">Cargando la flota…</div>
          ) : !filas.length ? (
            <div className="text-[14px] text-gypi-dim">
              {vehiculos.length ? "No hay vehículos con ese filtro." : "Todavía no hay vehículos. Agregá el primero con su patente, su responsable y sus papeles."}
            </div>
          ) : (
            <ul aria-label="Vehículos" className="list-none m-0 p-0 lista-ancha flex flex-col gap-1.5">
              {filas.map(({ v, nivel, urgentes }) => {
                const resp = porId.get(v.responsable_id);
                const datos = [nombreTipoVehiculo(v.tipo), [v.marca, v.modelo].filter(Boolean).join(" "), resp?.nombre].filter(Boolean);
                return (
                  <li key={v.id}>
                    <button onClick={() => setFichaId(v.id)} aria-label={`Ver ${v.patente}`}
                      className="w-full flex items-center gap-2.5 p-2.5 min-h-[44px] rounded-[10px] border border-gypi-border bg-gypi-surface text-left cursor-pointer font-body text-gypi-text">
                      <span className="text-[20px]" aria-label={SEMAFORO[nivel].texto}>{SEMAFORO[nivel].emoji}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[15px] font-bold tracking-wide">{v.patente}</span>
                        <span className="block text-[12px] text-gypi-dim truncate">{datos.join(" · ")}</span>
                        {urgentes.length > 0 && (
                          <span className="block text-[12px] font-semibold truncate">
                            {urgentes.slice(0, 2).map((a) => textoAlerta(a, textoVencimiento)).join(" · ")}
                            {urgentes.length > 2 ? ` · y ${urgentes.length - 2} más` : ""}
                          </span>
                        )}
                      </span>
                      {v.km != null && <span className="text-[12px] text-gypi-dim whitespace-nowrap">{v.km.toLocaleString("es-AR")} km</span>}
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
          <div className="text-[13px] text-gypi-dim mb-2">Lo vencido y lo que vence pronto de toda la flota. Gypi avisa una vez por día al celular del responsable y de gerencia cuando aparece algo nuevo. Solo avisa: no bloquea nada.</div>
          {vehiculos === null ? (
            <div className="text-[14px] text-gypi-dim" role="status">Cargando la flota…</div>
          ) : !todasUrgentes.length ? (
            <div className="text-[14px] text-gypi-dim">✅ Toda la flota está al día.</div>
          ) : (
            <ul aria-label="Alertas de la flota" className="list-none m-0 p-0 lista-ancha flex flex-col gap-1.5">
              {todasUrgentes.map((a) => (
                <li key={`${a.vehiculo.id}-${a.clave}`}>
                  <button onClick={() => setFichaId(a.vehiculo.id)} aria-label={`${a.vehiculo.patente}: ${textoAlerta(a, textoVencimiento)}`}
                    className="w-full flex items-center gap-2.5 p-2.5 min-h-[44px] rounded-[10px] border border-gypi-border bg-gypi-surface text-left cursor-pointer font-body text-gypi-text">
                    <span className="text-[20px]">{SEMAFORO[a.nivel].emoji}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[14px] font-semibold">{textoAlerta(a, textoVencimiento)}</span>
                      <span className="block text-[12px] text-gypi-dim truncate">{[a.vehiculo.patente, porId.get(a.vehiculo.responsable_id)?.nombre].filter(Boolean).join(" · ")}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {vista === "checklists" && <ListaChecklists checklists={checklists.slice(0, 200)} vehiculos={vehiculos || []} onVer={setVerChecklist} />}
      {vista === "plantilla" && editable && <PlantillaChecklist />}

      {vista === "costos" && editable && (
        <>
          <div className="text-[13px] text-gypi-dim mb-2">Lo gastado en services, reparaciones y arreglos de los últimos 6 meses, y los kilómetros recorridos (según los checklists y services).</div>
          {!costos.filas.length ? (
            <div className="text-[14px] text-gypi-dim">Todavía no hay vehículos.</div>
          ) : (
            <div className="overflow-x-auto">
              <table aria-label="Costos de la flota" className="w-full text-[13px] border-collapse">
                <thead>
                  <tr className="text-gypi-dim text-left">
                    <th className="py-1.5 pr-2 font-semibold">Vehículo</th>
                    {meses.map((m) => <th key={m} className="py-1.5 px-1 font-semibold text-right">{nombreMes(m)}</th>)}
                    <th className="py-1.5 px-1 font-semibold text-right">Total</th>
                    <th className="py-1.5 pl-1 font-semibold text-right">Km</th>
                  </tr>
                </thead>
                <tbody>
                  {costos.filas.map((f) => (
                    <tr key={f.vehiculo.id} className="border-t border-gypi-border">
                      <td className="py-1.5 pr-2 font-semibold whitespace-nowrap">
                        <button onClick={() => setFichaId(f.vehiculo.id)} className="p-0 bg-transparent border-none font-semibold text-[13px] text-gypi-text cursor-pointer font-body">{f.vehiculo.patente}</button>
                      </td>
                      {meses.map((m) => <td key={m} className="py-1.5 px-1 text-right whitespace-nowrap">{f.porMes[m] ? textoCosto(f.porMes[m]) : "–"}</td>)}
                      <td className="py-1.5 px-1 text-right font-semibold whitespace-nowrap">{f.total ? textoCosto(f.total) : "–"}</td>
                      <td className="py-1.5 pl-1 text-right whitespace-nowrap">{f.km != null ? f.km.toLocaleString("es-AR") : "–"}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-gypi-border font-bold">
                    <td className="py-1.5 pr-2">Total</td>
                    {meses.map((m) => <td key={m} className="py-1.5 px-1 text-right whitespace-nowrap">{costos.totalMes[m] ? textoCosto(costos.totalMes[m]) : "–"}</td>)}
                    <td className="py-1.5 px-1 text-right whitespace-nowrap">{textoCosto(costos.total)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {vista === "choferes" && (
        <>
          <div className="text-[13px] text-gypi-dim mb-2">Los responsables de cada vehículo y su licencia de conducir. Gypi avisa {AVISO_LICENCIA} días antes de que venza.</div>
          {!choferes.length ? (
            <div className="text-[14px] text-gypi-dim">Todavía no hay choferes. Elegí el responsable en la ficha de cada vehículo.</div>
          ) : (
            <ul aria-label="Choferes" className="list-none m-0 p-0 lista-ancha flex flex-col gap-1.5">
              {choferes.map(({ e, estado, patentes }) => {
                const nivel = estado.nivel === "sin_fecha" ? "pronto" : estado.nivel;
                return (
                  <li key={e.id}>
                    <button onClick={() => editable && setLicencia(e)} disabled={!editable} aria-label={`Licencia de ${e.nombre}`}
                      className="w-full flex items-center gap-2.5 p-2.5 min-h-[44px] rounded-[10px] border border-gypi-border bg-gypi-surface text-left cursor-pointer font-body text-gypi-text disabled:cursor-default">
                      <span className="text-[20px]">{SEMAFORO[nivel].emoji}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[14px] font-semibold truncate">{e.nombre}</span>
                        <span className="block text-[12px] text-gypi-dim truncate">
                          {[patentes.join(", "), e.licencia_categoria ? `Categoría ${e.licencia_categoria}` : null,
                            estado.nivel === "sin_fecha" ? "Falta cargar la licencia" : `Licencia: ${textoVencimiento(estado, e.licencia_vencimiento).toLowerCase()}`].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
