"use client";
// 🧾 "Lleva IVA (21 %)" de una OT (migración 201; pedido de Tadeo 22/11).
// El PRECIO del Plan es sin IVA; con la casilla tildada la cuenta corriente,
// el estado de cuenta y la venta automática de Finanzas suman el 21 %.
// La ven y la cambian Dueño, Supervisor y Administración (los que ven precios).
// Se guarda por /api/data (queda en el 🕓 Historial de cambios de la OT).
import { useState } from "react";
import { sb } from "../lib/supabase";
import { AVISO_MIGRACION_201, textoIvaOt } from "../lib/finanzasOtClientes";

export default function IvaOt({ proyecto, precio, onGuardado, compacto = false }) {
  const [propio, setPropio] = useState(null); // lo guardado acá, sin volver a abrir
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState(null);
  if (!proyecto?.id) return null;
  const lleva = propio ?? Boolean(proyecto.lleva_iva);

  const cambiar = async (valor) => {
    setGuardando(true);
    setAviso(null);
    try {
      await sb.patch(`proyectos?id=eq.${proyecto.id}`, { lleva_iva: valor });
      setPropio(valor);
      onGuardado?.({ id: proyecto.id, lleva_iva: valor });
    } catch (e) {
      setAviso(/lleva_iva/.test(String(e?.message)) ? AVISO_MIGRACION_201 : `No se pudo guardar: ${e?.message || e}`);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className={compacto ? "" : "mt-1"}>
      <label className="inline-flex items-center gap-2 text-[13px] cursor-pointer">
        <input type="checkbox" checked={lleva} disabled={guardando} onChange={(e) => cambiar(e.target.checked)} />
        Lleva IVA (21 %)
      </label>
      {!compacto && precio > 0 && <div className="text-xs text-gypi-dim">{textoIvaOt(precio, lleva)}</div>}
      {propio !== null && !aviso && <div className="text-[12px] text-gypi-dim">Guardado. La venta en Finanzas se corrige en la próxima sincronización (o con 🔄 Revisar ahora en Finanzas → Clientes).</div>}
      {aviso && <div role="alert" className="text-xs text-gypi-red mt-0.5">{aviso}</div>}
    </div>
  );
}
