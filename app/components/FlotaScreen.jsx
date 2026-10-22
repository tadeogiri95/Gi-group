'use client';
// app/components/FlotaScreen.jsx — Planta → Flota (Mantenimiento, parte 28;
// ítem 43; migración 126). Gerencia y Administración cargan los vehículos,
// su responsable (el chofer habitual) y sus papeles con vencimiento. Cada
// vehículo muestra su semáforo: 🔴 vencido, 🟡 vence pronto, ✅ al día. Solo
// avisa, no bloquea nada. Los checklists, las alertas y los arreglos vienen en
// las partes 29 a 31.
import { useCallback, useEffect, useMemo, useState } from "react";
import { sbGetAll } from "../lib/supabase";
import { faltaTabla } from "../lib/compras";
import { hoyArg } from "../lib/dates";
import {
  AVISO_LICENCIA, SEMAFORO, avisosVehiculo, estadoVencimiento, nombreTipoVehiculo, peorNivel, puedeEditarFlota, textoVencimiento,
} from "../lib/flota";
import { Chip } from "./ui";
import FichaVehiculo, { FormVehiculo, FormLicencia } from "./FichaVehiculo";

const ORDEN_NIVEL = { vencido: 0, pronto: 1, ok: 2 };
const AVISO_MIGRACION = "Para usar Flota falta correr la migración 126 en Supabase.";

export default function FlotaScreen({ empresaId, usuario = null }) {
  const [vehiculos, setVehiculos] = useState(null);
  const [papeles, setPapeles] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [error, setError] = useState(null);
  const [vista, setVista] = useState("vehiculos");
  const [verBajas, setVerBajas] = useState(false);
  const [texto, setTexto] = useState("");
  const [fichaId, setFichaId] = useState(null);
  const [nuevo, setNuevo] = useState(false);
  const [licencia, setLicencia] = useState(null);
  const editable = puedeEditarFlota(usuario?.rol);
  const hoy = hoyArg();

  const cargar = useCallback(async () => {
    if (!empresaId) return;
    try {
      const [v, p, e] = await Promise.all([
        sbGetAll("vehiculos?order=patente.asc,id.asc", { maxFilas: 2000 }),
        sbGetAll("vehiculo_papeles?order=created_at.desc,id.desc", { maxFilas: 20000 }),
        sbGetAll("empleados?activo=eq.true&select=id,nombre,division,licencia_categoria,licencia_vencimiento&order=nombre.asc,id.asc", { maxFilas: 5000 }),
      ]);
      setVehiculos(v.data || []);
      setPapeles(p.data || []);
      setEmpleados(e.data || []);
      setError(null);
    } catch (err) {
      setVehiculos([]);
      setError(["vehiculos", "vehiculo_papeles", "licencia_"].some((t) => faltaTabla(err, t)) ? AVISO_MIGRACION : "No se pudo leer la flota");
    }
  }, [empresaId]);
  useEffect(() => { cargar(); }, [cargar]);

  const porId = useMemo(() => new Map(empleados.map((e) => [e.id, e])), [empleados]);
  const filas = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return (vehiculos || [])
      .filter((v) => (verBajas ? !v.activo : v.activo))
      .filter((v) => !t || [v.patente, v.marca, v.modelo, porId.get(v.responsable_id)?.nombre].some((x) => String(x ?? "").toLowerCase().includes(t)))
      .map((v) => {
        const avisos = avisosVehiculo(v, papeles, porId.get(v.responsable_id), hoy);
        const nivel = peorNivel(avisos);
        const urgentes = avisos.filter((a) => a.nivel === "vencido" || a.nivel === "pronto")
          .sort((a, b) => (a.nivel === b.nivel ? (a.dias ?? 0) - (b.dias ?? 0) : a.nivel === "vencido" ? -1 : 1));
        return { v, nivel, urgentes };
      })
      .sort((a, b) => ORDEN_NIVEL[a.nivel] - ORDEN_NIVEL[b.nivel] || a.v.patente.localeCompare(b.v.patente));
  }, [vehiculos, papeles, porId, texto, verBajas, hoy]);

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
          editable={editable} hoy={hoy} onVolver={() => setFichaId(null)} onCambio={cargar} />
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
      <div className="flex gap-1.5 mb-3 flex-wrap" role="group" aria-label="Ver">
        <Chip active={vista === "vehiculos"} onClick={() => setVista("vehiculos")}>🚚 Vehículos</Chip>
        <Chip active={vista === "choferes"} onClick={() => setVista("choferes")}>🪪 Choferes</Chip>
      </div>
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
            <ul aria-label="Vehículos" className="list-none m-0 p-0 flex flex-col gap-1.5">
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
                            {urgentes.slice(0, 2).map((a) => (a.falta ? a.texto : `${a.texto}: ${textoVencimiento(a, a.vencimiento).toLowerCase()}`)).join(" · ")}
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

      {vista === "choferes" && (
        <>
          <div className="text-[13px] text-gypi-dim mb-2">Los responsables de cada vehículo y su licencia de conducir. Gypi avisa {AVISO_LICENCIA} días antes de que venza.</div>
          {!choferes.length ? (
            <div className="text-[14px] text-gypi-dim">Todavía no hay choferes. Elegí el responsable en la ficha de cada vehículo.</div>
          ) : (
            <ul aria-label="Choferes" className="list-none m-0 p-0 flex flex-col gap-1.5">
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
