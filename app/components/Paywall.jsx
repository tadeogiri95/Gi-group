"use client";
import { PLANES } from "../lib/plans";

export default function Paywall({ planActual = "free", planRequerido = "starter", feature, mensaje, onClose, onUpgrade }) {
  const target = PLANES[planRequerido] || PLANES.starter;
  const actual = PLANES[planActual] || PLANES.free;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-[18px]">
      <div onClick={onClose} className="absolute inset-0 bg-black/70 backdrop-blur-[4px]" />
      <div className="relative w-full max-w-[420px] bg-gypi-bg rounded-3xl p-7 border border-gypi-amber/20" style={{ boxShadow: "0 24px 60px var(--color-empresa-primary, #F97316)20" }}>
        <div className="w-16 h-16 rounded-[18px] flex items-center justify-center mx-auto mb-4 text-[32px]" style={{ background: "linear-gradient(135deg, var(--color-empresa-primary, #F97316), #7C3AED)" }}>🔒</div>

        <h2 className="m-0 font-heading text-[22px] font-bold text-gypi-text text-center">Función bloqueada</h2>
        <p className="text-[13px] text-gypi-dim text-center leading-relaxed my-2.5 mb-5">
          {mensaje || (
            <>
              <b className="text-gypi-text">{feature || "Esta función"}</b> no está disponible en tu plan <b className="text-gypi-text">{actual.nombre}</b>.
              Actualizá a <b className="text-gypi-amber">{target.nombre}</b> para desbloquearla.
            </>
          )}
        </p>

        <div className="bg-gypi-surface rounded-[14px] p-4 border border-gypi-border mb-[18px]">
          <div className="flex justify-between items-center mb-2.5">
            <span className="text-sm font-bold text-gypi-amber">Plan {target.nombre}</span>
            <span className="text-base font-bold text-gypi-text font-heading">
              {target.precio ? `$${target.precio.toLocaleString("es-AR")}/mes` : "A convenir"}
            </span>
          </div>
          <div className="text-xs text-gypi-dim leading-relaxed">
            ✓ Hasta {target.max_empleados.toLocaleString("es-AR")} empleados<br />
            {target.geolocalizacion && <>✓ Geolocalización ({target.max_ubicaciones >= 999 ? "ilimitada" : target.max_ubicaciones + " ubicación"})<br /></>}
            {target.exportar_csv && <>✓ Exportación CSV<br /></>}
            {target.exportar_pdf && <>✓ Reportes PDF<br /></>}
            {target.calendario && <>✓ Calendario con notas<br /></>}
            {target.reglas_bot && <>✓ Bot con reglas personalizadas<br /></>}
            {target.soporte && <>✓ Soporte {target.soporte}<br /></>}
          </div>
        </div>

        <div className="flex gap-2.5">
          <button onClick={onClose} className="flex-1 py-3.5 rounded-xl border border-gypi-border bg-transparent text-gypi-dim text-sm font-semibold font-body cursor-pointer">
            Ahora no
          </button>
          <button onClick={onUpgrade} className="flex-[2] py-3.5 rounded-xl border-none bg-gypi-amber text-white text-sm font-bold font-heading cursor-pointer">
            🚀 Actualizar plan
          </button>
        </div>
      </div>
    </div>
  );
}
