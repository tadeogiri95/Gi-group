"use client";
// Tipos de solicitud de la empresa (H9, ítem 23): cuáles ofrece el formulario
// del operario, con qué nombre, y tipos propios (p. ej. "Examen") sobre uno de
// base. Sin configurar, se ofrecen los de siempre.
import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/supabase";
import { TIPOS_BASE, MAX_TIPOS, tiposDeEmpresa } from "../lib/tiposSolicitud";

export default function TiposSolicitudConfig() {
  const { empresa, usuario, updateEmpresa } = useAuth();
  const puedeEditar = usuario?.rol === "gerencial" || usuario?.rol === "administrativo";
  const [tipos, setTipos] = useState(() => tiposDeEmpresa(empresa?.tipos_solicitud));
  const [estado, setEstado] = useState(null); // null | "guardando" | "ok" | mensaje de error

  const cambiar = (i, cambios) => setTipos((ts) => ts.map((t, j) => (j === i ? { ...t, ...cambios } : t)));
  const quitar = (i) => setTipos((ts) => ts.filter((_, j) => j !== i));
  const agregar = () => setTipos((ts) => [...ts, { clave: "", nombre: "", base: "permiso", multiDia: false }]);

  const guardar = async (lista) => {
    setEstado("guardando");
    const valor = lista === null ? null : lista.filter((t) => t.nombre.trim()).map(({ clave, nombre, base, multiDia }) => ({ ...(clave ? { clave } : {}), nombre: nombre.trim(), base, multiDia }));
    try {
      const res = await apiFetch("/api/empresa", { method: "PATCH", body: JSON.stringify({ tipos_solicitud: valor }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || `Error ${res.status}`);
      updateEmpresa({ tipos_solicitud: valor });
      setTipos(tiposDeEmpresa(valor));
      setEstado("ok");
    } catch (e) {
      setEstado(e.message);
    }
  };

  return (
    <div className="rounded-card p-4 border border-gypi-border mb-3.5 bg-gypi-surface">
      <div className="g-overline text-gypi-amber-ink">TIPOS DE SOLICITUD</div>
      <div className="text-xs text-gypi-dim mt-1 mb-3 leading-relaxed">
        Los que el operario puede elegir en “Nueva solicitud”. Podés renombrarlos, sacar los que no usan o crear los suyos (por ejemplo “Examen” o “Donación de sangre”).
      </div>

      <div className="flex flex-col gap-2">
        {tipos.map((t, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-gypi-bg border border-gypi-border">
            <input
              aria-label="Nombre del tipo"
              value={t.nombre}
              disabled={!puedeEditar}
              onChange={(e) => cambiar(i, { nombre: e.target.value.slice(0, 40), clave: t.clave && t.nombre === e.target.value ? t.clave : "" })}
              placeholder="Nombre"
              className="g-input flex-1 min-w-[140px] text-[13px]"
            />
            <select aria-label="Cuenta como" value={t.base} disabled={!puedeEditar} onChange={(e) => cambiar(i, { base: e.target.value })} className="g-input w-auto text-[12px]">
              {Object.entries(TIPOS_BASE).map(([b, info]) => <option key={b} value={b}>Cuenta como: {info.nombre}</option>)}
            </select>
            <label className="text-[12px] text-gypi-dim flex items-center gap-1">
              <input type="checkbox" checked={t.multiDia} disabled={!puedeEditar} onChange={(e) => cambiar(i, { multiDia: e.target.checked })} />
              Varios días
            </label>
            {puedeEditar && (
              <button onClick={() => quitar(i)} aria-label={`Quitar ${t.nombre || "tipo"}`} className="ml-auto px-2 py-1 rounded-md border-none bg-transparent text-gypi-red text-xs font-bold cursor-pointer">Quitar</button>
            )}
          </div>
        ))}
      </div>

      {puedeEditar && (
        <div className="flex flex-wrap gap-2 mt-3">
          <button onClick={agregar} disabled={tipos.length >= MAX_TIPOS} className="g-btn g-btn-secondary text-xs font-bold disabled:opacity-50">+ Agregar tipo</button>
          <button onClick={() => guardar(tipos)} disabled={estado === "guardando" || !tipos.some((t) => t.nombre.trim())} className="g-btn g-btn-primary text-xs font-bold disabled:opacity-50">
            {estado === "guardando" ? "Guardando..." : "Guardar tipos"}
          </button>
          <button onClick={() => guardar(null)} disabled={estado === "guardando"} className="text-xs text-gypi-dim bg-transparent border-none cursor-pointer underline">Volver a los de siempre</button>
        </div>
      )}
      {estado === "ok" && <div role="status" className="text-xs text-gypi-green mt-2">Guardado.</div>}
      {estado && estado !== "ok" && estado !== "guardando" && <div role="alert" className="text-xs text-gypi-red mt-2">{estado}</div>}
    </div>
  );
}
