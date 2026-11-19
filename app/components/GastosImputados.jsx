'use client';
// app/components/GastosImputados.jsx — 💲 Lo que se imputó en Finanzas a un
// vehículo o a una máquina (19/11, punto 13; migración 200), en su ficha de
// Flota o de Maquinaria: combustible, seguros, patentes, repuestos… Solo lo
// ve el Dueño (Finanzas es suya); para el resto no se muestra nada.
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { esDuenoFinanzas } from "../lib/finanzas";
import { plata } from "../lib/finanzasOperaciones";

const VER = 10;
const fechaCorta = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : "");

/** @param {{ tipo: "vehiculo"|"maquina", id: number, usuario: object|null }} props */
export default function GastosImputados({ tipo, id, usuario }) {
  const dueno = esDuenoFinanzas(usuario);
  const [datos, setDatos] = useState(null);
  const [todos, setTodos] = useState(false);
  useEffect(() => {
    if (!dueno || !id) return undefined;
    let vivo = true;
    apiFetch(`/api/finanzas/operaciones?${tipo}=${id}`)
      .then(async (r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo) setDatos(d); })
      .catch(() => { if (vivo) setDatos(null); });
    return () => { vivo = false; };
  }, [dueno, tipo, id]);
  if (!dueno || !datos) return null;
  const ops = datos.operaciones || [];
  if (!ops.length && !datos.aviso) return null;
  const total = ops.reduce((s, o) => s + (Number(o.total_ars ?? o.total) || 0), 0);
  return (
    <section aria-label="Gastos imputados en Finanzas" className="mb-4">
      <h3 className="m-0 mb-1.5 text-[16px] font-bold">💲 Gastos en Finanzas</h3>
      {datos.aviso ? <p className="m-0 text-[13px] text-gypi-dim">{datos.aviso}</p> : (
        <>
          <p className="m-0 mb-1.5 text-[13px] text-gypi-dim">Lo imputado {tipo === "vehiculo" ? "a este vehículo" : "a esta máquina"} en Finanzas → Movimientos: <b className="text-gypi-text">{plata(total)}</b> en {ops.length} operaci{ops.length === 1 ? "ón" : "ones"}.</p>
          <ul className="list-none m-0 p-0 flex flex-col gap-1">
            {(todos ? ops : ops.slice(0, VER)).map((o) => (
              <li key={o.id} className="flex items-baseline gap-2 text-[13px] px-2 py-1.5 rounded-lg border border-gypi-border bg-gypi-surface">
                <span className="font-mono text-[12px] text-gypi-dim">{fechaCorta(o.fecha)}</span>
                <span className="flex-1 min-w-0 truncate">{o.tipo}{o.entidad ? ` · ${o.entidad}` : ""}{o.descripcion ? ` · ${o.descripcion}` : ""}</span>
                <span className="font-mono font-semibold">{plata(o.total, o.moneda)}</span>
              </li>
            ))}
          </ul>
          {ops.length > VER && (
            <button type="button" onClick={() => setTodos((v) => !v)} className="min-h-[40px] p-0 bg-transparent border-none text-[13px] font-semibold text-gypi-dim cursor-pointer">
              {todos ? "Ver menos" : `Ver las ${ops.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
