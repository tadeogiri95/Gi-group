"use client";
// ═══════════════════════════════════════════════════════════
// [slug]/page.js — SHELL CON URL ROUTING
//
// ENTREGA 2F: screen ahora se lee/escribe via ?screen= param.
// - /mi-empresa → home
// - /mi-empresa?screen=solicitudes → inbox
// - /mi-empresa?screen=chat → bot
// - Browser back/forward navega entre pantallas
// - Deep links funcionan (compartir URL abre la pantalla correcta)
//
// Cambios vs 2D:
//   - screen ya no es useState("home") → useSearchParams
//   - setScreen hace router.push con el param
//   - Suspense boundary requerido por useSearchParams en Next.js
// ═══════════════════════════════════════════════════════════

import { Suspense } from "react";
import HomeContent from "./HomeContent";

// Next.js requiere Suspense boundary para useSearchParams
export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}
