'use client';
// app/components/MaterialOt.jsx — Material de una OT en su detalle (Stock,
// parte 16; ítem 40): lo que necesita según la planilla MRP (necesidades_stock,
// 108) contra lo retirado desde la app (movimientos_stock, 107), para ver qué
// falta. Si la OT no tiene ni necesidades ni retiros, no muestra nada.
import { useEffect, useState } from "react";
import { sb } from "../lib/supabase";
import { cantidadTexto, materialOt } from "../lib/stock";

const MAX_VISIBLES = 60;

export default function MaterialOt({ ot, empresaId }) {
  const [material, setMaterial] = useState(null);
  const [verTodos, setVerTodos] = useState(false);

  useEffect(() => {
    if (!ot || !empresaId) return;
    let vivo = true;
    (async () => {
      const o = encodeURIComponent(ot);
      // Sin las migraciones 107 o 108 no hay tabla: el detalle sigue sin esto
      const [necesidades, movimientos] = await Promise.all([
        sb.get(`necesidades_stock?empresa_id=eq.${empresaId}&ot=eq.${o}&select=sku,nombre,cantidad,fecha`).catch(() => []),
        sb.get(`movimientos_stock?empresa_id=eq.${empresaId}&ot=eq.${o}&anulado=eq.false&tipo=in.(consumo,devolucion)&select=sku,nombre,unidad,cantidad,tipo,anulado`).catch(() => []),
      ]);
      const skus = [...new Set([...(necesidades || []), ...(movimientos || [])].map((r) => r.sku))].slice(0, 300);
      const articulos = skus.length
        // Comillas codificadas (%22): los SKU llevan puntos y /api/data no acepta comillas
        ? await sb.get(`articulos_stock?sku=in.(${skus.map((s) => `%22${encodeURIComponent(s)}%22`).join(",")})&select=sku,nombre,unidad`).catch(() => [])
        : [];
      if (vivo) setMaterial(materialOt(necesidades || [], movimientos || [], articulos || []));
    })();
    return () => { vivo = false; };
  }, [ot, empresaId]);

  if (!material?.filas.length) return null;
  const visibles = verTodos ? material.filas : material.filas.slice(0, MAX_VISIBLES);
  const resumen = [
    material.filas.length === 1 ? "1 artículo" : `${material.filas.length} artículos`,
    material.conFalta ? `${material.conFalta} con faltante` : null,
    material.completos ? `${material.completos} completos` : null,
    material.sinNecesidad ? `${material.sinNecesidad} no previstos` : null,
  ].filter(Boolean).join(" · ");

  return (
    <section aria-label="Material de la OT" className="mb-4">
      <div className="g-label mb-1">🧱 Material</div>
      <div className="text-xs text-gypi-dim mb-1.5">{resumen}</div>
      <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
        {visibles.map((f) => (
          <li key={f.sku} className="flex items-center gap-2 bg-gypi-surface rounded-xl p-3 border border-gypi-border">
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold truncate">{f.nombre || f.sku}</div>
              <div className="text-[11px] text-gypi-dim truncate">
                {f.conNecesidad
                  ? `Retirado ${cantidadTexto(f.retirado)} de ${cantidadTexto(f.necesario)}${f.unidad ? ` ${f.unidad}` : ""}`
                  : `Retirado ${cantidadTexto(f.retirado)}${f.unidad ? ` ${f.unidad}` : ""}`}
              </div>
            </div>
            {f.falta > 0 ? (
              <span className="text-[12px] font-bold text-gypi-red whitespace-nowrap">Falta {cantidadTexto(f.falta)}</span>
            ) : f.conNecesidad ? (
              <span className="text-[12px] font-bold text-gypi-green whitespace-nowrap">✅ Completo</span>
            ) : (
              <span className="text-[12px] text-gypi-dim whitespace-nowrap">No previsto</span>
            )}
          </li>
        ))}
      </ul>
      {material.filas.length > visibles.length && (
        <button onClick={() => setVerTodos(true)} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-amber-ink cursor-pointer">
          Ver los {material.filas.length}
        </button>
      )}
      <div className="text-[11px] text-gypi-dim mt-1">Lo necesario sale de la planilla MRP. Lo retirado es lo cargado en Gypi (retiros menos devoluciones); lo anotado a mano en la planilla no aparece acá.</div>
    </section>
  );
}
