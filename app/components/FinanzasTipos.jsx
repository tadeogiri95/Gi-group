'use client';
// app/components/FinanzasTipos.jsx — Finanzas → 🧾 Configuración → 🏷 Tipos
// de operación nuevos (/api/finanzas/tipos; lista y equivalencias en
// app/lib/finanzasTipos.js).
//
// Muestra qué cambia (cada tipo viejo a cuál nuevo, con cuántas operaciones)
// y lo hace al apretar el botón. El libro hace lo mismo con su script, con
// copia de respaldo.
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { fechaCorta } from "../lib/finanzasPagos";
import { Modal, Spinner } from "./ui";
import { useToast } from "./ui/Toast";

const miles = (n) => Math.round(Number(n) || 0).toLocaleString("es-AR");

function PasarTipos({ onCerrar, onPasado }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [pasando, setPasando] = useState(false);

  useEffect(() => {
    apiFetch("/api/finanzas/tipos")
      .then(async (res) => {
        const x = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(x.error || "No se pudo leer");
        setD(x);
      })
      .catch((e) => setError(e.message || "No se pudo leer"));
  }, []);

  async function pasar() {
    setPasando(true);
    setError(null);
    try {
      const res = await apiFetch("/api/finanzas/tipos", { method: "POST", body: JSON.stringify({ accion: "pasar" }) });
      const x = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(x.error || "No se pudo pasar");
      toast.success(`Listo: ${miles(x.operaciones)} operaciones con el tipo nuevo`);
      onPasado();
    } catch (e) {
      setError(`${e.message}. Lo que ya cambió quedó; volvé a apretar el botón y sigue.`);
      setPasando(false);
    }
  }

  const grupos = d ? [...new Set(d.lista.map((t) => t.grupo))] : [];
  const nada = d && !d.operaciones && !d.crear.length && !d.desactivar.length && !d.proveedores.length;

  return (
    <Modal open onClose={pasando ? () => {} : onCerrar} title="Tipos de operación nuevos" maxWidth={680}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px] text-gypi-dim">
          El tipo dice en qué renglón del flujo de caja va cada operación. La forma de pago (efectivo, transferencia, cheque) ya no va en el tipo: sale sola de la caja o el banco. La cuenta del plan de cuentas sigue siendo la del Estado de Resultados y no cambia.
        </p>
        {!d && !error && <Spinner size={18} />}
        {d && (
          <>
            {d.pasado && <p className="m-0 text-[13px] font-semibold">✅ Ya se pasó el {fechaCorta(d.pasado.slice(0, 10))}. Si aparecen tipos viejos de nuevo, se puede volver a pasar.</p>}
            <ul className="m-0 pl-5 flex flex-col gap-1 text-[13px]" aria-label="Qué cambia">
              <li><b>{miles(d.operaciones)}</b> operaciones pasan al tipo nuevo.</li>
              {d.adivinadas > 0 && <li><b>{miles(d.adivinadas)}</b> no tenían tipo y lo toman por sus cuentas (compra, sueldo, pago o cobro).</li>}
              {d.sin_tipo > 0 && <li>{miles(d.sin_tipo)} siguen sin tipo: no se puede saber por sus cuentas.</li>}
              {d.proveedores.length > 0 && <li><b>{miles(d.proveedores.reduce((s, p) => s + p.n, 0))}</b> proveedores cambian su tipo de compra.</li>}
              {d.crear.length > 0 && <li><b>{d.crear.length}</b> tipos se crean o se completan; <b>{d.desactivar.length}</b> viejos se apagan (no se borran).</li>}
            </ul>
            {d.cambios.length > 0 && (
              <div className="max-h-[240px] overflow-y-auto border border-gypi-border rounded-lg">
                <table className="w-full border-collapse text-[13px]" aria-label="Equivalencias">
                  <thead>
                    <tr className="bg-gypi-surface">
                      <th className="text-left px-2 py-1">Tipo viejo</th>
                      <th className="text-left px-2 py-1">Tipo nuevo</th>
                      <th className="text-right px-2 py-1">Operaciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.cambios.map((c) => (
                      <tr key={c.viejo} className="border-t border-gypi-border">
                        <td className="px-2 py-1">{c.viejo}</td>
                        <td className="px-2 py-1 font-semibold">{c.nuevo}</td>
                        <td className="px-2 py-1 text-right font-mono">{miles(c.operaciones)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <details className="text-[13px]">
              <summary className="cursor-pointer font-semibold">Ver la lista de tipos nuevos ({d.lista.length})</summary>
              <div className="flex flex-col gap-2 mt-2">
                {grupos.map((g) => (
                  <div key={g}>
                    <p className="m-0 text-[12px] font-bold text-gypi-dim">{g}</p>
                    <p className="m-0">{d.lista.filter((t) => t.grupo === g).map((t) => t.nombre).join(" · ")}</p>
                  </div>
                ))}
              </div>
            </details>
            <p className="m-0 text-[13px] text-gypi-dim">
              En el libro: generá un código nuevo en 🔗 Pasar Gypi al libro (más arriba) y pegalo en lugar del anterior. La primera vez que corra después de apretar este botón hace una copia de respaldo de T-OPERACIONES, dim_tipos_op, dim_flujo y FLUJO_V2, y cambia los tipos de T-OPERACIONES igual que acá.
            </p>
          </>
        )}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" disabled={pasando} onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={!d || pasando || nada} onClick={pasar}>
            {pasando ? "Pasando…" : "Pasar a los tipos nuevos"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function FinanzasTipos({ onPasado }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <section aria-label="Tipos de operación nuevos" className="mb-3 p-3 border border-gypi-border rounded-lg">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[220px]">
          <h3 className="m-0 text-[14px] font-bold text-gypi-text">🏷 Tipos de operación nuevos</h3>
          <p className="m-0 text-[13px] text-gypi-dim">Unos 40 tipos en lugar de 61: uno por renglón del flujo de caja, sin la forma de pago en el nombre.</p>
        </div>
        <button type="button" className="g-btn g-btn-secondary" onClick={() => setAbierto(true)}>Ver y pasar</button>
      </div>
      {abierto && <PasarTipos onCerrar={() => setAbierto(false)} onPasado={() => { setAbierto(false); onPasado?.(); }} />}
    </section>
  );
}
