"use client";
// Reglas de asistencia de la empresa (tolerancia y bloqueos). Son reglas de
// cada fábrica, no del producto (decisión D5). Solo el dueño las edita;
// el servidor (/api/empresa) también lo exige.
import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/supabase";
import { normalizarReglasAsistencia } from "../lib/calc";

export default function ReglasAsistencia() {
  const { empresa, usuario, updateEmpresa } = useAuth();
  const inicial = normalizarReglasAsistencia(empresa?.reglas_asistencia);
  const [tolerancia, setTolerancia] = useState(inicial.tolerancia_min);
  const [bloqueoMin, setBloqueoMin] = useState(inicial.bloqueo_min);
  const [bloqueoTardanzas, setBloqueoTardanzas] = useState(inicial.bloqueo_tardanzas_mes);
  const [permisoSalida, setPermisoSalida] = useState(inicial.permiso_salida_anticipada);
  const [estado, setEstado] = useState(null); // null | "guardando" | "ok" | mensaje de error
  const esDueno = usuario?.rol === "gerencial";

  const num = (v, min, max) => {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? min : Math.min(max, Math.max(min, n));
  };

  const guardar = async () => {
    setEstado("guardando");
    const reglas = { tolerancia_min: tolerancia, bloqueo_min: bloqueoMin, bloqueo_tardanzas_mes: bloqueoTardanzas, permiso_salida_anticipada: permisoSalida };
    try {
      const res = await apiFetch("/api/empresa", { method: "PATCH", body: JSON.stringify({ reglas_asistencia: reglas }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || `Error ${res.status}`);
      updateEmpresa({ reglas_asistencia: reglas });
      setEstado("ok");
    } catch (e) {
      setEstado(e.message);
    }
  };

  const fila = "flex items-center justify-between gap-3 py-2.5 border-b border-gypi-border last:border-b-0";
  const inputNum = "g-input w-20 text-center";

  return (
    <div className="rounded-card p-4 border border-gypi-border mb-3.5 bg-gypi-surface">
      <div className="g-overline text-gypi-amber">REGLAS DE ASISTENCIA</div>
      <div className="text-xs text-gypi-dim mt-1 mb-2 leading-relaxed">
        Se aplican al fichar ingreso. {esDueno ? "" : "Solo el dueño de la cuenta puede cambiarlas."}
      </div>

      <div className={fila}>
        <label htmlFor="ra-tol" className="text-[13px] text-gypi-text">Minutos de tolerancia</label>
        <input id="ra-tol" type="number" min={0} max={120} disabled={!esDueno} className={inputNum}
          value={tolerancia} onChange={e => setTolerancia(num(e.target.value, 0, 120))} />
      </div>

      <div className={fila}>
        <label className="text-[13px] text-gypi-text flex items-center gap-2">
          <input type="checkbox" disabled={!esDueno} checked={bloqueoMin != null}
            onChange={e => setBloqueoMin(e.target.checked ? 15 : null)} />
          No dejar fichar si llega más de
        </label>
        <span className="flex items-center gap-1.5">
          <input type="number" min={1} max={600} disabled={!esDueno || bloqueoMin == null} className={inputNum}
            aria-label="Minutos máximos de tardanza"
            value={bloqueoMin ?? ""} onChange={e => setBloqueoMin(num(e.target.value, 1, 600))} />
          <span className="text-xs text-gypi-dim">min tarde</span>
        </span>
      </div>

      <div className={fila}>
        <label className="text-[13px] text-gypi-text flex items-center gap-2">
          <input type="checkbox" disabled={!esDueno} checked={bloqueoTardanzas != null}
            onChange={e => setBloqueoTardanzas(e.target.checked ? 3 : null)} />
          No dejar fichar en la tardanza n.º
        </label>
        <span className="flex items-center gap-1.5">
          <input type="number" min={1} max={31} disabled={!esDueno || bloqueoTardanzas == null} className={inputNum}
            aria-label="Tardanza del mes que bloquea"
            value={bloqueoTardanzas ?? ""} onChange={e => setBloqueoTardanzas(num(e.target.value, 1, 31))} />
          <span className="text-xs text-gypi-dim">del mes</span>
        </span>
      </div>

      <div className={fila}>
        <label className="text-[13px] text-gypi-text flex items-center gap-2">
          <input type="checkbox" disabled={!esDueno} checked={permisoSalida}
            onChange={e => setPermisoSalida(e.target.checked)} />
          Pedir permiso para retirarse antes del fin de la jornada
        </label>
      </div>

      <div className="text-[11px] text-gypi-dim mt-2 leading-relaxed">
        Cuando se bloquea, el empleado pide permiso desde el chat y gerencia lo aprueba. La tolerancia también vale para la salida.
      </div>

      {esDueno && (
        <div className="flex items-center gap-3 mt-3">
          <button onClick={guardar} disabled={estado === "guardando"} className="g-btn g-btn-primary text-xs">
            {estado === "guardando" ? "Guardando..." : "Guardar reglas"}
          </button>
          {estado === "ok" && <span className="text-xs text-gypi-green">Guardado</span>}
          {estado && estado !== "ok" && estado !== "guardando" && <span role="alert" className="text-xs text-gypi-red">{estado}</span>}
        </div>
      )}
    </div>
  );
}
