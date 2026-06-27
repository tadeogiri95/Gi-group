"use client";
import { planPermite } from "../lib/plans";

// AdSlot — banner de Google AdSense para el plan Free.
// Mismo molde que TrialBanner.jsx: se autocontiene, decide internamente
// si renderiza algo, no necesita wrapper condicional en el caller.
//
// Kill-switch: sin NEXT_PUBLIC_ADSENSE_CLIENT_ID/SLOT configurados, no
// renderiza nada — mismo patrón que Sentry/Firebase en este repo (sin
// config, la integración queda desactivada en silencio).
//
// El script de adsbygoogle.js corre dentro de public/ad-frame.html, en su
// propio iframe — no en este documento. Se probaron 6 capas de defensa
// distintas (gate por empresa?.id, enable_page_level_ads:false, watchdog de
// overlays vía MutationObserver, touch-action:manipulation, tope de un
// anuncio por sesión, mantener el dashboard montado para nunca remontar) y
// el scroll táctil se seguía trabando en producción — el script de Google,
// corriendo en EL MISMO document que el resto de la app, puede dejar
// listeners o estado roto que ninguna de esas defensas alcanza a prevenir.
// Un iframe le da a ese script su propio document/window: lo que rompa
// ahí adentro no puede tocar el scroll del shell.
export default function AdSlot({ plan }) {
  const clientId = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;
  const slotId = process.env.NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD;
  const habilitado = planPermite(plan, "mostrar_publicidad") && !!clientId && !!slotId;

  if (!habilitado) return null;

  const src = `/ad-frame.html?client=${encodeURIComponent(clientId)}&slot=${encodeURIComponent(slotId)}`;

  return (
    <div className="rounded-xl mb-3.5 overflow-hidden bg-gypi-surface border border-gypi-border" style={{ minHeight: 100 }}>
      <div className="text-[10px] text-gypi-dim font-bold uppercase tracking-[0.06em] px-3 pt-2">Publicidad</div>
      <iframe
        title="Publicidad"
        src={src}
        style={{ width: "100%", height: 100, border: "none", display: "block" }}
        loading="lazy"
      />
    </div>
  );
}
