"use client";
// app/components/AvisoMigraciones.jsx — Aviso al dueño en el Inicio si falta
// correr alguna migración en Supabase (auditoría 01/11, PR 7). Si está todo
// al día, o no se pudo revisar, no muestra nada.
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { textoFaltantes } from "../lib/esquemaMigraciones";

export default function AvisoMigraciones() {
  const [faltan, setFaltan] = useState([]);
  useEffect(() => {
    let vivo = true;
    apiFetch("/api/esquema")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo && Array.isArray(d?.faltan)) setFaltan(d.faltan); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);
  if (!faltan.length) return null;
  const una = faltan.length === 1;
  return (
    <div role="alert" aria-label="Falta correr migraciones" className="mx-[18px] mb-3 p-3 rounded-xl border-[1.5px] bg-gypi-amber/10 border-gypi-amber/25 text-[13px] text-gypi-text">
      <div className="font-bold text-gypi-amber-ink mb-1">⚠ Falta preparar la base de datos</div>
      <div>
        {una ? "Falta correr la migración " : "Faltan correr las migraciones "}
        <span className="font-semibold">{textoFaltantes(faltan)}</span> en Supabase.
        Hasta que {una ? "se corra" : "se corran"}, esa parte de Gypi puede dar error.
      </div>
      <div className="text-xs text-gypi-dim mt-1">
        Archivos en supabase/migrations: {faltan.map((m) => m.archivo).join(", ")}. Si no sabés cómo, avisá a soporte de Gypi.
      </div>
    </div>
  );
}
