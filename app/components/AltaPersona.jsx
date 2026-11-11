'use client';
// app/components/AltaPersona.jsx — "➕ Nuevo" cliente o proveedor sin cambiar
// de pantalla (parte 4 del plan Finanzas e Inventario, 11/11). Antes de crear
// nada, Gypi lo busca en la agenda (proveedores, clientes y hoja PERSONAS):
// si ya está, lo elige; si hay nombres parecidos, pregunta si es alguno.
// Reglas en app/lib/altaPersona.js y /api/agenda.
import { useState } from "react";
import { apiFetch } from "../lib/supabase";
import { olvidarAgenda } from "../lib/agendaCache";
import { Button, Chip, Modal } from "./ui";
import { useToast } from "./ui/Toast";

/** El value de la opción "➕ Nuevo proveedor…" en un <select> común. */
export const OPCION_NUEVA = "__nuevo__";

const nombreRol = (r) => (r === "cliente" ? "Cliente" : "Proveedor");
const titulo = (roles) => (roles.length > 1 ? "Nuevo cliente o proveedor" : `Nuevo ${roles[0]}`);

/**
 * La ventana de alta.
 * @param {{ abierta: boolean, onCerrar: () => void, rol?: "proveedor"|"cliente", roles?: string[], nombre?: string, cuit?: string,
 *   onCreada: (persona: { clave, nombre, cuit, proveedor_id, cliente_id }, rol: string) => void }} props
 */
export function VentanaAltaPersona({ abierta, ...props }) {
  // Se arma de cero cada vez que se abre: arranca con el nombre que se escribió
  return abierta ? <FormAlta {...props} /> : null;
}

function FormAlta({ onCerrar, rol = "proveedor", roles = [rol], nombre = "", cuit = "", onCreada }) {
  const toast = useToast();
  const [f, setF] = useState({ nombre, cuit, rol });
  const [parecidos, setParecidos] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setParecidos(null); setError(""); };

  const enviar = async (extra = {}) => {
    setEnviando(true);
    setError("");
    try {
      const res = await apiFetch("/api/agenda", { method: "POST", body: JSON.stringify({ nombre: f.nombre, cuit: f.cuit, rol: f.rol, ...extra }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo dar de alta");
      if (d.preguntar) { setParecidos(d.parecidos || []); return; }
      const p = d.persona;
      olvidarAgenda();
      const como = nombreRol(f.rol).toLowerCase();
      toast.success(d.ya_estaba ? `${p.nombre} ya estaba: quedó elegido` : d.era_de_agenda ? `${p.nombre} ya estaba en la agenda: ahora es ${como}` : `${p.nombre} quedó como ${como}`);
      onCreada?.(p, f.rol);
      onCerrar();
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  };

  const etiqueta = "flex flex-col gap-1 text-[13px] font-semibold text-gypi-text";
  return (
    <Modal open onClose={onCerrar} title={titulo(roles)} maxWidth={460}>
      <div className="flex flex-col gap-3">
        {roles.length > 1 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Es">
            {roles.map((r) => <Chip key={r} active={f.rol === r} onClick={() => { setF((x) => ({ ...x, rol: r })); setParecidos(null); }}>{nombreRol(r)}</Chip>)}
          </div>
        )}
        <label className={etiqueta}>Nombre o razón social
          <input className="g-input w-full" aria-label="Nombre" maxLength={120} placeholder="Ej.: Maderas Córdoba SA" value={f.nombre} onChange={set("nombre")} />
        </label>
        <label className={etiqueta}>CUIT (opcional)
          <input className="g-input w-full" aria-label="CUIT" inputMode="numeric" maxLength={13} placeholder="30-12345678-9" value={f.cuit} onChange={set("cuit")} />
        </label>
        <span className="text-[12px] text-gypi-dim">Antes de crearlo, Gypi se fija si ya está en la agenda (por CUIT o por nombre) para no repetirlo.</span>

        {parecidos && (
          <div className="flex flex-col gap-2 rounded-lg border border-gypi-border bg-gypi-surface p-3" role="group" aria-label="Parecidos">
            <span className="text-[14px] font-semibold text-gypi-text">¿Es alguno de estos?</span>
            {parecidos.map((p) => (
              <Button key={p.clave} variant="secondary" size="sm" disabled={enviando} onClick={() => enviar({ clave: p.clave })}>Sí, es {p.texto}</Button>
            ))}
            <Button variant="outline" size="sm" disabled={enviando} onClick={() => enviar({ es_otro: true })}>No, es otro: crear {f.nombre.trim()}</Button>
          </div>
        )}

        {error && <span className="text-[13px] text-gypi-red-ink" role="alert">{error}</span>}

        {!parecidos && (
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={onCerrar}>Cancelar</Button>
            <Button size="sm" loading={enviando} disabled={!f.nombre.trim()} onClick={() => enviar()}>Dar de alta</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * El botón "➕ Nuevo proveedor" (o cliente) con su ventana.
 * @param {{ rol?: string, roles?: string[], nombre?: string, cuit?: string, onCreada: Function, children?: any, className?: string, disabled?: boolean }} props
 */
export default function BotonNuevaPersona({ rol = "proveedor", roles = [rol], nombre = "", cuit = "", onCreada, children, className = "", disabled = false }) {
  const [abierta, setAbierta] = useState(false);
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => setAbierta(true)}
        className={`min-h-[44px] shrink-0 rounded-lg border border-gypi-border bg-gypi-surface px-3 text-[13px] font-semibold text-gypi-text cursor-pointer disabled:opacity-50 ${className}`}>
        {children || `➕ ${titulo(roles)}`}
      </button>
      <VentanaAltaPersona abierta={abierta} onCerrar={() => setAbierta(false)} rol={rol} roles={roles} nombre={nombre} cuit={cuit} onCreada={onCreada} />
    </>
  );
}
