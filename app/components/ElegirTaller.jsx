'use client';
// app/components/ElegirTaller.jsx — El taller de un service, arreglo o falla
// sale de la lista de proveedores de Compras (auditoría del 12/11, parte 5;
// migración 183). Se escribe y se elige de la lista; si no está, queda como
// texto (Compras lo puede dar de alta después). Quien no ve los proveedores
// (no es de gestión) escribe el taller como antes.
import { useEffect, useMemo, useState } from "react";
import { sbGetAll } from "../lib/supabase";
import { clavePersona } from "../lib/finanzasPersonas";

/** El proveedor de la lista con ese nombre (sin importar tildes, puntos ni S.A.). */
export function proveedorDeTexto(texto, proveedores = []) {
  const k = clavePersona(texto);
  if (!k) return null;
  return proveedores.find((p) => clavePersona(p.nombre) === k) || null;
}

/**
 * @param {{ id: string, label?: string, valor: string, onCambio: (v: { taller: string, proveedor_id: number|null }) => void }} props
 */
export default function ElegirTaller({ id, label = "Taller", valor, onCambio }) {
  const [proveedores, setProveedores] = useState(null);
  useEffect(() => {
    let vivo = true;
    sbGetAll("proveedores?activo=eq.true&order=nombre.asc&select=id,nombre", { maxFilas: 5000 })
      .then(({ data }) => { if (vivo) setProveedores(data || []); })
      .catch(() => { if (vivo) setProveedores([]); });
    return () => { vivo = false; };
  }, []);
  const elegido = useMemo(() => proveedorDeTexto(valor, proveedores || []), [valor, proveedores]);
  const cambiar = (texto) => onCambio({ taller: texto, proveedor_id: proveedorDeTexto(texto, proveedores || [])?.id ?? null });

  return (
    <div className="flex-1 min-w-0">
      <label className="g-label" htmlFor={id}>{label}</label>
      <input id={id} className="g-input w-full" maxLength={120} value={valor} list={proveedores?.length ? `${id}-lista` : undefined}
        onChange={(e) => cambiar(e.target.value)} placeholder={proveedores?.length ? "Escribí y elegí de los proveedores" : ""} autoComplete="off" />
      {proveedores?.length > 0 && (
        <datalist id={`${id}-lista`}>
          {proveedores.map((p) => <option key={p.id} value={p.nombre} />)}
        </datalist>
      )}
      {proveedores?.length > 0 && String(valor).trim() !== "" && (
        <div className={`text-[12px] mt-0.5 ${elegido ? "text-gypi-green" : "text-gypi-dim"}`} role="status">
          {elegido ? `✓ ${elegido.nombre}, de la lista de proveedores` : "No está en la lista de proveedores: queda escrito así"}
        </div>
      )}
    </div>
  );
}
