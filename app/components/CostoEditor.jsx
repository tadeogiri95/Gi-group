'use client';
// app/components/CostoEditor.jsx — Costo de la hora de mano de obra
// (Órdenes de Producción, parte 8; ítem 39). Un solo valor para toda la
// fábrica. Solo lo ve y lo cambia el dueño.
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { fmtPesos } from "../lib/costo";

/** "12.500" → 12500; "12500,50" → 12500.5; "$ 9.000" → 9000. null si no es un número. */
export function leerPesos(texto) {
  let s = String(texto ?? "").replace(/[$\s]/g, "").slice(0, 20);
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else {
    // "12.500" es doce mil quinientos (punto de miles), no doce coma cinco
    const partes = s.split(".");
    if (partes.length > 1 && partes[0].length <= 3 && partes.slice(1).every((p) => p.length === 3)) s = partes.join("");
  }
  if (!/^[\d.]+$/.test(s) || s.split(".").length > 2 || s.startsWith(".") || s.endsWith(".")) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export default function CostoEditor({ avisar = () => {} }) {
  const [guardado, setGuardado] = useState(undefined);
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState(null);

  useEffect(() => {
    let vivo = true;
    apiFetch("/api/costo-hora")
      .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }))
      .then(({ ok, data }) => {
        if (!vivo) return;
        if (!ok) { setAviso(data.error || "No se pudo leer el costo de la hora."); setGuardado(null); return; }
        if (data.falta_migracion) setAviso("Para cargar el costo de la hora falta correr la migración 102 en Supabase.");
        setGuardado(data.costo_hora ?? null);
        if (data.costo_hora != null) setTexto(String(data.costo_hora).replace(".", ","));
      })
      .catch(() => { if (vivo) { setAviso("No se pudo leer el costo de la hora."); setGuardado(null); } });
    return () => { vivo = false; };
  }, []);

  const valor = leerPesos(texto);
  const valido = valor != null && valor >= 0 && valor <= 99999999;

  const guardar = async () => {
    if (!valido) return;
    setGuardando(true);
    try {
      const r = await apiFetch("/api/costo-hora", { method: "POST", body: JSON.stringify({ costo_hora: valor }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "No se pudo guardar el costo de la hora");
      setGuardado(data.costo_hora);
      setAviso(null);
      avisar("Costo de la hora guardado");
    } catch (err) {
      avisar(err.message, "error");
    } finally {
      setGuardando(false);
    }
  };

  if (guardado === undefined) return <div className="gypi-dots py-6" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>;

  return (
    <div className="g-card mb-3.5">
      <div className="text-[13px] text-gypi-dim mb-3 leading-normal">
        Cuánto te cuesta una hora de trabajo (sueldo más cargas), un solo valor para toda la fábrica. Con esto la app calcula el costo de mano de obra de cada OT, separado en fábrica, paradas e instalación. Solo lo ves vos: ni los supervisores ni los administrativos ven costos.
      </div>
      {aviso && <div role="alert" className="text-[12px] text-gypi-red mb-2.5">{aviso}</div>}
      <label htmlFor="costo-hora" className="g-label mb-1.5 block">Costo de la hora ($)</label>
      <input id="costo-hora" className="g-input w-full mb-1.5" inputMode="decimal" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ej: 9.500" />
      <div className="text-[11px] text-gypi-dim mb-3.5">
        {texto.trim() && !valido ? <span className="text-gypi-red">Escribí solo el número, por ejemplo 9.500.</span>
          : guardado != null ? `Ahora: ${fmtPesos(guardado)} por hora.` : "Todavía no lo cargaste."}
      </div>
      <div className="text-[11px] text-gypi-dim mb-3.5">
        Las horas de instalación salen de la etapa que se llama &quot;Instalación&quot; (Configuración → Etapas).
      </div>
      <button onClick={guardar} disabled={guardando || !valido || valor === guardado} className="g-btn g-btn-primary w-full">
        {guardando ? "Guardando…" : "Guardar costo"}
      </button>
    </div>
  );
}
