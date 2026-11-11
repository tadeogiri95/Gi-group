'use client';
// app/components/FinanzasElegirProveedor.jsx — el desplegable de proveedor de
// Finanzas (pagos, cheques) con la agenda de personas (parte 4 del plan del
// 11/11). Muestra los proveedores de Gypi y, abajo, la gente de la agenda que
// todavía no es proveedor: al elegir a alguien de ahí, Gypi lo da de alta como
// proveedor y queda elegido.
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { SelectBuscable } from "./ui";
import { useToast } from "./ui/Toast";

let agendaGuardada = null;
let pedido = null;

/** Se olvida la agenda leída (después de cambiar algo en 📇 Personas). */
export function olvidarAgenda() {
  agendaGuardada = null;
  pedido = null;
}

/** La agenda de personas (se lee una vez por pantalla abierta). */
export function useAgenda() {
  const [agenda, setAgenda] = useState(agendaGuardada || []);
  useEffect(() => {
    if (agendaGuardada) return undefined;
    let vivo = true;
    pedido = pedido || apiFetch("/api/finanzas/personas")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (Array.isArray(d?.agenda) ? d.agenda : []))
      .catch(() => []);
    pedido.then((a) => { agendaGuardada = a; if (vivo) setAgenda(a); });
    return () => { vivo = false; };
  }, []);
  return agenda;
}

const AGENDA = "a:";

/**
 * @param {{ value: string, onChange: (e: { target: { value: string } }) => void, proveedores: { id, nombre, activo? }[], vacio?: string, disabled?: boolean, "aria-label"?: string }} props
 */
export default function ElegirProveedor({ value, onChange, proveedores = [], vacio = "Elegí el proveedor", disabled = false, ...rest }) {
  const toast = useToast();
  const agenda = useAgenda();
  const [extra, setExtra] = useState([]);
  const [creando, setCreando] = useState(false);
  const lista = [...proveedores, ...extra.filter((x) => !proveedores.some((p) => Number(p.id) === Number(x.id)))];
  const deAgenda = agenda.filter((e) => !e.proveedor_id);

  const elegir = async (e) => {
    const v = String(e.target.value || "");
    if (!v.startsWith(AGENDA)) { onChange(e); return; }
    const entrada = agenda.find((x) => x.clave === v.slice(AGENDA.length));
    if (!entrada) return;
    setCreando(true);
    try {
      const res = await apiFetch("/api/finanzas/personas", { method: "POST", body: JSON.stringify({ accion: "proveedor", clave: entrada.clave }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.proveedor_id) throw new Error(d.error || "No se pudo dar de alta el proveedor");
      setExtra((x) => [...x, { id: d.proveedor_id, nombre: entrada.nombre, activo: true }]);
      olvidarAgenda();
      toast.success(`${entrada.nombre} quedó como proveedor`);
      onChange({ target: { value: String(d.proveedor_id) } });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCreando(false);
    }
  };

  return (
    <SelectBuscable className="g-input w-full" {...rest} value={value} disabled={disabled || creando} onChange={elegir}>
      <option value="">{creando ? "Dando de alta…" : vacio}</option>
      <optgroup label="Proveedores">
        {lista.filter((p) => p.activo !== false || String(p.id) === String(value)).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </optgroup>
      {deAgenda.length > 0 && (
        <optgroup label="De la agenda (se da de alta como proveedor)">
          {deAgenda.map((e) => <option key={e.clave} value={`${AGENDA}${e.clave}`}>{e.nombre}{e.cliente_id ? " (cliente)" : ""}</option>)}
        </optgroup>
      )}
    </SelectBuscable>
  );
}
