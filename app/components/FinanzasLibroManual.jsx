'use client';
// app/components/FinanzasLibroManual.jsx — Finanzas → Contabilidad → 📗 Libro
// de Google (etapa 7 de la auditoría de Finanzas integrada, 14/11;
// /api/finanzas/libro/manuales; reglas en app/lib/finanzasLibroManual.js).
//
// Gypi es el libro oficial: el libro de Google es una copia que el script
// actualiza cada 15 minutos. Lo que alguien cargue a mano en el libro aparece
// acá (y allá queda en amarillo) para incorporarlo a Gypi o ignorarlo.
// Solo el rol Dueño.
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { plata } from "../lib/finanzasOperaciones";
import { fechaCorta } from "../lib/finanzasPagos";
import { Spinner } from "./ui";
import { useToast } from "./ui/Toast";

const hora = (iso) => (iso ? new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");

export default function FinanzasLibroManual() {
  const toast = useToast();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [tc, setTc] = useState({});
  const [elegidas, setElegidas] = useState(() => new Set());
  const [trabajando, setTrabajando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await apiFetch("/api/finanzas/libro/manuales");
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo leer lo del libro");
      setDatos(d);
      setError(null);
      setElegidas(new Set());
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const pendientes = useMemo(() => datos?.pendientes || [], [datos]);
  const nombre = (c) => datos?.cuentas?.[c] || c;
  const faltaTc = (o) => o.moneda === "USD" && !(Number(String(tc[o.origen_id] || "").replace(",", ".")) > 0);

  async function hacer(accion, claves) {
    if (!claves.length) return;
    const sinTc = accion === "incorporar" ? pendientes.filter((o) => claves.includes(o.origen_id) && faltaTc(o)) : [];
    if (sinTc.length) { toast.error(`Poné el tipo de cambio de ${sinTc.length === 1 ? "el renglón en dólares" : `los ${sinTc.length} renglones en dólares`}`); return; }
    setTrabajando(true);
    try {
      const numTc = Object.fromEntries(Object.entries(tc).map(([k, v]) => [k, Number(String(v).replace(",", "."))]));
      const res = await apiFetch("/api/finanzas/libro/manuales", { method: "POST", body: JSON.stringify({ accion, claves, tc: numTc }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo");
      toast.success(accion === "incorporar" ? `Listo: ${d.incorporadas} ${d.incorporadas === 1 ? "operación cargada" : "operaciones cargadas"} en Gypi` : "Listo: no se vuelven a mostrar");
      await cargar();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setTrabajando(false);
    }
  }

  const alternar = (k) => setElegidas((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const todas = pendientes.length > 0 && elegidas.size === pendientes.length;

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      <div className="g-card p-3 mb-3 max-w-[860px]">
        <p className="m-0 text-[14px] text-gypi-text">
          <b>Gypi es el libro oficial.</b> El libro de Google es una copia: cada 15 minutos recibe todo lo que se carga en Gypi. Si alguien carga algo a mano en el libro, no entra solo: aparece acá y en el libro queda en amarillo con la nota «No viene de Gypi». Incorporalo para que entre a Gypi, o ignoralo.
        </p>
        {datos?.revisado_at && <p className="m-0 mt-1 text-[12px] text-gypi-dim">Última revisión del libro: {hora(datos.revisado_at)}{datos.desde ? ` · se miran los renglones desde el ${fechaCorta(datos.desde)}` : ""}{datos.ignorados ? ` · ${datos.ignorados} ignorados` : ""}</p>}
      </div>
      {error && <p role="alert" className="m-0 mb-2 text-[14px] text-gypi-red">⚠ {error}</p>}
      {!datos && !error && <div className="flex justify-center py-10"><Spinner /></div>}
      {datos && !datos.conectado && <p className="m-0 text-[14px] text-gypi-text">El libro de Google no está conectado. Conectalo en Finanzas → Configuración → 🔗 Pasar Gypi al libro.</p>}
      {datos?.conectado && !datos.revisado_at && <p className="m-0 text-[14px] text-gypi-text">Todavía no hubo una vuelta del script con esta versión. Generá el código nuevo en Configuración → 🔗 Pasar Gypi al libro, pegalo en Apps Script y ejecutá instalarLibroGypi.</p>}
      {datos?.conectado && datos.revisado_at && !datos.desde && <p className="m-0 text-[14px] text-gypi-text">Primero pasá el histórico del libro una vez (Configuración → Pasar el histórico). Desde esa fecha, lo que se cargue a mano aparece acá.</p>}
      {datos?.error && <p role="alert" className="m-0 mb-2 text-[13px] text-gypi-red">⚠ {datos.error}</p>}
      {datos?.faltan_cuentas?.length > 0 && <p role="alert" className="m-0 mb-2 text-[13px] text-gypi-amber-ink">⚠ Estas cuentas del libro no están en el plan de cuentas de Gypi: {datos.faltan_cuentas.join(", ")}. Hasta que estén, esos renglones no se pueden incorporar.</p>}
      {datos?.desde && pendientes.length === 0 && !datos.error && <p className="m-0 text-[14px] text-gypi-green">✓ No hay nada cargado a mano en el libro que falte en Gypi.</p>}
      {pendientes.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <p className="m-0 text-[14px] font-bold text-gypi-text flex-1 min-w-[200px]">
              {datos.total === 1 ? "1 renglón cargado a mano en el libro" : `${datos.total} renglones cargados a mano en el libro`}
              {datos.total > pendientes.length ? ` (se muestran los primeros ${pendientes.length})` : ""}
            </p>
            <button type="button" className="g-btn g-btn-secondary" disabled={trabajando || !elegidas.size} onClick={() => hacer("ignorar", [...elegidas])}>Ignorar elegidos</button>
            <button type="button" className="g-btn g-btn-primary" disabled={trabajando || !elegidas.size} onClick={() => hacer("incorporar", [...elegidas])}>
              {trabajando ? "Cargando…" : `Incorporar elegidos${elegidas.size ? ` (${elegidas.size})` : ""}`}
            </button>
          </div>
          <label className="flex items-center gap-2 mb-1 text-[13px] text-gypi-text">
            <input type="checkbox" checked={todas} onChange={() => setElegidas(todas ? new Set() : new Set(pendientes.map((o) => o.origen_id)))} />
            Elegir todos
          </label>
          <ul className="m-0 p-0 list-none flex flex-col gap-2">
            {pendientes.map((o) => (
              <li key={o.origen_id} className="g-card p-3">
                <div className="flex flex-wrap items-start gap-2">
                  <input type="checkbox" aria-label={`Elegir renglón ${o.fila}`} className="mt-1" checked={elegidas.has(o.origen_id)} onChange={() => alternar(o.origen_id)} />
                  <div className="flex-1 min-w-[220px]">
                    <p className="m-0 text-[13px] text-gypi-dim">Renglón {o.fila} del libro · {fechaCorta(o.fecha)} · {o.tipo}</p>
                    <p className="m-0 text-[14px] font-semibold text-gypi-text">{o.entidad || o.descripcion || "Sin detalle"}</p>
                    {o.entidad && o.descripcion && <p className="m-0 text-[13px] text-gypi-text">{o.descripcion}</p>}
                    <p className="m-0 text-[12px] text-gypi-dim">Debe: {nombre(o.cuenta_debe)} · Haber: {nombre(o.cuenta_haber)}</p>
                  </div>
                  <div className="text-right">
                    <p className="m-0 font-mono text-[15px] font-bold text-gypi-text">{plata(o.total, o.moneda)}</p>
                    {o.moneda === "USD" && (
                      <label className="flex items-center gap-1 justify-end mt-1 text-[12px] text-gypi-text">
                        Tipo de cambio
                        <input type="text" inputMode="decimal" className="g-input !w-[90px]" aria-label={`Tipo de cambio del renglón ${o.fila}`} value={tc[o.origen_id] || ""} onChange={(e) => setTc((t) => ({ ...t, [o.origen_id]: e.target.value }))} />
                      </label>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 justify-end mt-2">
                  <button type="button" className="g-btn g-btn-secondary" disabled={trabajando} onClick={() => hacer("ignorar", [o.origen_id])}>Ignorar</button>
                  <button type="button" className="g-btn g-btn-primary" disabled={trabajando} onClick={() => hacer("incorporar", [o.origen_id])}>Incorporar a Gypi</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
