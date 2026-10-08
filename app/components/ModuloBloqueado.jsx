"use client";
// Aviso de una sección que la empresa no tiene contratada (ítem 36): qué es y
// cómo sumarla. Solo el dueño puede abrir Facturación; el resto ve a quién pedírselo.
import { MODULOS, comoSumarModulo } from "../lib/modulos";

export default function ModuloBloqueado({ modulo, empresa, rol, onVerPlanes }) {
  const m = MODULOS[modulo];
  const { error } = comoSumarModulo(empresa?.plan_activo || "free", modulo);
  const esDueno = rol === "gerencial";
  return (
    <div role="status" className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-[360px] w-full text-center bg-gypi-surface border border-gypi-border rounded-2xl p-6">
        <div aria-hidden="true" className="text-[32px] mb-2">🔒</div>
        <h2 className="m-0 font-heading text-lg font-bold text-gypi-text">{m?.nombre || "Esta sección"}</h2>
        {m?.descripcion && <p className="text-[13px] text-gypi-dim mt-1.5 mb-3 leading-relaxed">{m.descripcion}</p>}
        <p className="text-[13px] text-gypi-text mb-4 leading-relaxed">{error}</p>
        {esDueno && onVerPlanes ? (
          <button onClick={onVerPlanes} className="g-btn g-btn-primary w-full">Sumalo desde Facturación</button>
        ) : (
          <p className="text-xs text-gypi-dim m-0">Pedíselo al dueño de la cuenta.</p>
        )}
      </div>
    </div>
  );
}
