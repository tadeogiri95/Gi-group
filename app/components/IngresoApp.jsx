"use client";
// Inicio de la app de Google Play sin empresa elegida (ítem 34): en vez de la
// página comercial (con precios), pide el código de la empresa.
import { useState } from "react";
import { normalizarCodigo } from "../lib/ultimaEmpresa";

export default function IngresoApp({ irA = (u) => { window.location.href = u; } }) {
  const [codigo, setCodigo] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState("");

  const buscar = async (e) => {
    e.preventDefault();
    const slug = normalizarCodigo(codigo);
    if (slug.length < 2) { setError("Escribí el código de tu empresa (te lo da tu supervisor)."); return; }
    setBuscando(true);
    setError("");
    try {
      const r = await fetch(`/api/empresa?slug=${encodeURIComponent(slug)}`);
      if (r.ok) { irA(`/${slug}`); return; }
      setError(r.status === 403 ? "Esa empresa está desactivada. Consultá con tu supervisor." : "No encontramos ninguna empresa con ese código. Revisalo con tu supervisor.");
    } catch {
      setError("Sin conexión. Probá de nuevo cuando tengas señal.");
    }
    setBuscando(false);
  };

  return (
    <main className="flex flex-col min-h-dvh items-center justify-center p-8 text-center bg-gypi-bg">
      <img src="/icons/icon-192.png" alt="" width={72} height={72} className="rounded-2xl mb-4" />
      <h1 className="font-heading text-2xl text-gypi-text m-0">Entrá a tu empresa</h1>
      <p className="text-gypi-dim text-sm mt-2 mb-6 max-w-[320px]">Escribí el código de tu empresa o escaneá el QR que te dio tu supervisor con la cámara del celular.</p>
      <form onSubmit={buscar} className="w-full max-w-[340px] flex flex-col gap-2 text-left">
        <label htmlFor="codigo-app" className="text-[12px] font-bold text-gypi-dim uppercase tracking-[0.06em]">Código de tu empresa</label>
        <input id="codigo-app" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="por ejemplo: mi-empresa" autoCapitalize="none" autoCorrect="off" className="g-input w-full text-base py-3.5 px-4 rounded-xl" />
        {error && <div role="alert" className="text-[13px] text-gypi-red">{error}</div>}
        <button type="submit" disabled={buscando} className="w-full py-3.5 rounded-[14px] border-none bg-gypi-amber text-black font-bold text-[15px] cursor-pointer" style={{ minHeight: 52 }}>
          {buscando ? "Buscando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
