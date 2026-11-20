// app/components/RescateFci.jsx — "A rescatar del FCI" (20/11, Tadeo): lo que
// hay que sacar del FCI para hacer todas las operaciones de una orden de pago
// o de un resumen = transferencias + plazos fijos a constituir (los que calzan
// los e-cheq). Lo usan las páginas del CFO y Finanzas → 💸 Pagos. Sin estado:
// sirve en páginas del servidor y del navegador. Las sumas salen de
// sumasPagos / totalesResumen (app/lib/finanzasPagos.js).
import { plata } from "../lib/finanzasOperaciones";

/**
 * @param {{ transferencia?: number, plazos?: number, cantidadPlazos?: number, rescatar?: number, compacto?: boolean }} props
 *   transferencia: si no viene, se calcula como rescatar − plazos.
 */
export default function RescateFci({ transferencia, plazos = 0, cantidadPlazos = 0, rescatar = 0, compacto = false }) {
  if (!(rescatar > 0)) return null;
  const trans = transferencia ?? Math.round((rescatar - plazos) * 100) / 100;
  return (
    <section aria-label="A rescatar del FCI" className={`rounded-[14px] border-2 border-gypi-green bg-gypi-surface flex flex-col gap-1 ${compacto ? "p-3 text-[14px]" : "p-4 text-[15px]"}`}>
      <div className="text-[13px] font-bold text-gypi-dim">Plata para hacer todas las operaciones</div>
      <div className="flex items-baseline gap-2"><span className="flex-1">⚡ Transferencias</span><span className="font-mono font-semibold">{plata(trans, "ARS")}</span></div>
      <div className="flex items-baseline gap-2"><span className="flex-1">🏦 Plazos fijos a constituir{cantidadPlazos ? ` (${cantidadPlazos})` : ""}</span><span className="font-mono font-semibold">{plata(plazos, "ARS")}</span></div>
      <div className="flex items-baseline gap-2 border-t border-gypi-border pt-1">
        <span className="flex-1 font-bold">💰 A rescatar del FCI</span>
        <span className={`font-mono font-bold ${compacto ? "text-[17px]" : "text-[20px]"}`}>{plata(rescatar, "ARS")}</span>
      </div>
    </section>
  );
}
