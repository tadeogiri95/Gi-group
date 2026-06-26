"use client";
import { useEffect, useRef } from "react";
import Script from "next/script";
import { planPermite } from "../lib/plans";

// AdSlot — banner de Google AdSense para el plan Free.
// Mismo molde que TrialBanner.jsx: se autocontiene, decide internamente
// si renderiza algo, no necesita wrapper condicional en el caller.
//
// Kill-switch: sin NEXT_PUBLIC_ADSENSE_CLIENT_ID/SLOT configurados, no
// renderiza nada — mismo patrón que Sentry/Firebase en este repo (sin
// config, la integración queda desactivada en silencio).
export default function AdSlot({ plan }) {
  const clientId = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;
  const slotId = process.env.NEXT_PUBLIC_ADSENSE_SLOT_DASHBOARD;
  const habilitado = planPermite(plan, "mostrar_publicidad") && !!clientId && !!slotId;

  // React StrictMode (dev) invoca los efectos dos veces sobre el mismo
  // <ins> real del DOM — sin este guard, el segundo push() tira
  // "All 'ins' elements... already have ads in them" (confirmado en
  // preview). El ref persiste entre las dos invocaciones de StrictMode
  // pero arranca en false en cada montaje real nuevo.
  const pusheado = useRef(false);

  useEffect(() => {
    if (!habilitado || pusheado.current) return;
    try {
      // Auto ads (anchor/vignette) se activan por cuenta, no por código — si
      // la cuenta de AdSense los tiene prendidos, este push de configuración
      // los desactiva para esta page view sin afectar el <ins> manual de
      // abajo. Sin esto, un anchor/vignette ad inyecta un overlay full-page
      // que traba el scroll de todo el shell SPA (persiste entre tabs hasta
      // un reload completo) — reportado como "no puedo scrollear en ninguna
      // pestaña" en la vista gerencial, la única que monta este componente.
      if (!window.__gypiPageLevelAdsDisabled) {
        (window.adsbygoogle = window.adsbygoogle || []).push({ google_ad_client: clientId, enable_page_level_ads: false });
        window.__gypiPageLevelAdsDisabled = true;
      }
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      pusheado.current = true;
    } catch {
      // adsbygoogle.js todavía no cargó o la cuenta no está aprobada —
      // no hay nada útil que hacer del lado del cliente.
    }
  }, [habilitado, clientId]);

  // Red de seguridad además del enable_page_level_ads:false de arriba — ese
  // push es un pedido, no una garantía (comportamiento de Google, no
  // documentado al 100% para SPA con navegación por pushState). Si de
  // todas formas se inyecta un overlay fuera del árbol de React (anchor o
  // vignette ad: siempre hijos directos de <body>, position fixed/absolute,
  // pensados para cubrir la pantalla completa), lo detectamos por geometría
  // —no por nombre de clase, que Google puede cambiar— y lo sacamos. Vive
  // para toda la sesión de la página (no solo mientras este componente está
  // montado): el overlay puede aparecer recien al navegar a otra pestaña,
  // mucho despues de que este efecto corrio una sola vez.
  useEffect(() => {
    if (!habilitado || window.__gypiAdWatchdog || typeof window.MutationObserver !== "function") return;
    window.__gypiAdWatchdog = true;

    const esOverlayFullScreen = (node) => {
      if (!(node instanceof window.HTMLElement) || node.parentElement !== document.body) return false;
      const pos = window.getComputedStyle(node).position;
      if (pos !== "fixed" && pos !== "absolute") return false;
      const r = node.getBoundingClientRect();
      return r.width >= window.innerWidth * 0.85 && r.height >= window.innerHeight * 0.85;
    };

    const observer = new window.MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (esOverlayFullScreen(node)) {
            console.warn("[AdSlot] overlay full-viewport inyectado fuera de React — removido para no trabar el scroll del shell", node);
            node.remove();
          }
        });
      }
    });
    observer.observe(document.body, { childList: true });
  }, [habilitado]);

  if (!habilitado) return null;

  return (
    <div className="rounded-xl mb-3.5 overflow-hidden bg-gypi-surface border border-gypi-border" style={{ minHeight: 100 }}>
      <div className="text-[10px] text-gypi-dim font-bold uppercase tracking-[0.06em] px-3 pt-2">Publicidad</div>
      <Script
        async
        strategy="afterInteractive"
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${clientId}`}
        crossOrigin="anonymous"
      />
      <ins
        className="adsbygoogle"
        style={{ display: "block", minHeight: 80 }}
        data-ad-client={clientId}
        data-ad-slot={slotId}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}
