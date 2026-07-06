"use client";
import { useState, useEffect } from "react";
import { planPermite } from "../lib/plans";

// AdSlot — banner de Google AdSense para el plan Free.
// Mismo molde que TrialBanner.jsx: se autocontiene, decide internamente
// si renderiza algo, no necesita wrapper condicional en el caller.
//
// Kill-switch: sin NEXT_PUBLIC_ADSENSE_CLIENT_ID/SLOT configurados, no
// renderiza nada — mismo patrón que Sentry/Firebase en este repo (sin
// config, la integración queda desactivada en silencio).
//
// El script de adsbygoogle.js corre en un iframe con srcdoc — no en este
// documento. srcdoc le da al script su propio document/window (el scroll
// táctil del shell no se puede trabar desde ahí) sin crear ninguna URL
// rastreable. Alternativa anterior (src=/ad-frame.html) fue descartada
// porque Google AdSense detectaba esa página como "anuncio sin contenido
// del editor" e informaba infracción de política.
export default function AdSlot({ plan }) {
  const clientId = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;
  const slotId = process.env.NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD;
  const habilitado = planPermite(plan, "mostrar_publicidad") && !!clientId && !!slotId;

  const [consent, setConsent] = useState(null);
  useEffect(() => {
    try { setConsent(localStorage.getItem("gypi_cookie_consent")); } catch {}
  }, []);

  if (!habilitado) return null;

  const personalized = consent === "1";
  const npaAttr = personalized ? "" : ' data-ad-request-nonpersonalized-ads="1"';
  const adScriptSrc = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(clientId)}`;
  const sc = "</" + "script>";
  const srcDoc =
    `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">` +
    `<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}</style></head><body>` +
    `<ins class="adsbygoogle" style="display:block" data-ad-client="${clientId}" data-ad-slot="${slotId}" data-ad-format="auto" data-full-width-responsive="true"${npaAttr}></ins>` +
    `<script async crossorigin="anonymous" src="${adScriptSrc}">${sc}` +
    `<script>(adsbygoogle=window.adsbygoogle||[]).push({})</` + `script>` +
    `</body></html>`;

  return (
    <div className="rounded-xl mb-3.5 overflow-hidden bg-gypi-surface border border-gypi-border" style={{ minHeight: 100 }}>
      <div className="text-[10px] text-gypi-dim font-bold uppercase tracking-[0.06em] px-3 pt-2">Publicidad</div>
      <iframe
        title="Publicidad"
        srcDoc={srcDoc}
        style={{ width: "100%", height: 100, border: "none", display: "block" }}
        loading="lazy"
      />
    </div>
  );
}
