"use client";
// Cuenta sin plan vigente (D20): terminó la prueba de 30 días o se canceló la
// suscripción. El dueño elige un plan; el resto del equipo ve un aviso.
import { useState } from "react";
import dynamic from "next/dynamic";

const BillingScreen = dynamic(() => import("./BillingScreen"), { ssr: false });

export default function CuentaEnPausa({ usuario, empresa, onLogout }) {
  const [planes, setPlanes] = useState(false);
  const esDueno = usuario?.rol === "gerencial";
  const nombre = empresa?.nombre_corto || empresa?.nombre || "tu empresa";

  return (
    <div className="app-shell bg-gypi-bg">
      <main className="flex-1 overflow-y-auto px-6 py-12 flex flex-col items-center text-center font-body">
        <div aria-hidden="true" className="text-[44px] mb-3">⏸️</div>
        <h1 className="m-0 mb-2 font-heading text-[22px] font-bold text-gypi-text">La cuenta de {nombre} está en pausa</h1>
        {esDueno ? (
          <>
            <p className="text-sm text-gypi-dim max-w-[360px] mb-6">
              Terminó la prueba gratuita o la suscripción no está activa. Tus datos siguen guardados: elegí un plan y tu equipo vuelve a fichar y cargar tareas al instante.
            </p>
            <button onClick={() => setPlanes(true)} className="w-full max-w-[320px] min-h-[48px] rounded-xl border-none bg-gypi-amber text-black text-[15px] font-bold cursor-pointer mb-3">
              Elegir un plan
            </button>
          </>
        ) : (
          <p className="text-sm text-gypi-dim max-w-[360px] mb-6">
            Por ahora no se puede fichar ni cargar tareas desde Gypi. Avisale a tu encargado para que active la cuenta.
          </p>
        )}
        <button onClick={onLogout} className="w-full max-w-[320px] min-h-[44px] rounded-xl border border-gypi-border bg-transparent text-gypi-text text-sm font-semibold cursor-pointer">
          Salir
        </button>
      </main>
      {planes && <BillingScreen onClose={() => setPlanes(false)} />}
    </div>
  );
}
