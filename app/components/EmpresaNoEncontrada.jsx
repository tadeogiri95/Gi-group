"use client";
// Pantalla "Empresa no encontrada" con salidas (F4-17): antes solo decía que el
// link no era válido y el operario quedaba trabado.
import { useEffect, useState } from "react";
import { ultimaEmpresa, normalizarCodigo } from "../lib/ultimaEmpresa";

export default function EmpresaNoEncontrada({ slugActual }) {
  const [ultima, setUltima] = useState(null);
  const [codigo, setCodigo] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const u = ultimaEmpresa();
    if (u && u.slug !== slugActual) setUltima(u);
  }, [slugActual]);

  const buscar = async (e) => {
    e.preventDefault();
    const slug = normalizarCodigo(codigo);
    if (slug.length < 2) { setError("Escribí el código de tu empresa (el que va después de gypi.app/)."); return; }
    setBuscando(true); setError("");
    try {
      const r = await fetch(`/api/empresa?slug=${encodeURIComponent(slug)}`);
      if (r.ok) { window.location.href = `/${slug}`; return; }
      setError(r.status === 403 ? "Esa empresa está desactivada. Consultá con tu supervisor." : "No encontramos ninguna empresa con ese código. Revisalo con tu supervisor.");
    } catch {
      setError("Sin conexión. Probá de nuevo cuando tengas señal.");
    }
    setBuscando(false);
  };

  return (
    <div className="flex flex-col min-h-dvh items-center justify-center p-8 text-center bg-gypi-bg">
      <div className="text-[44px] mb-3" aria-hidden="true">🔍</div>
      <h1 className="font-heading text-2xl text-gypi-text m-0">Empresa no encontrada</h1>
      <p className="text-gypi-dim text-sm mt-2 mb-6 max-w-[320px]">El link no es válido o la empresa fue desactivada.</p>

      <div className="w-full max-w-[340px] flex flex-col gap-3">
        {ultima && (
          <a href={`/${ultima.slug}`} className="w-full py-3.5 rounded-[14px] font-bold text-[15px] no-underline text-black flex items-center justify-center" style={{ minHeight: 52, background: "var(--color-empresa-primary, #F97316)" }}>
            Ir a {ultima.nombre}
          </a>
        )}

        <form onSubmit={buscar} className="flex flex-col gap-2 text-left">
          <label htmlFor="codigo-empresa" className="text-[12px] font-bold text-gypi-dim uppercase tracking-[0.06em]">
            Código de tu empresa
          </label>
          <input
            id="codigo-empresa"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="por ejemplo: mi-empresa"
            autoCapitalize="none"
            autoCorrect="off"
            className="g-input w-full text-base py-3.5 px-4 rounded-xl"
          />
          {error && <div role="alert" className="text-[13px] text-gypi-red">{error}</div>}
          <button type="submit" disabled={buscando} className="w-full py-3.5 rounded-[14px] border border-gypi-border bg-gypi-surface text-gypi-text font-bold text-[15px] cursor-pointer" style={{ minHeight: 52 }}>
            {buscando ? "Buscando…" : "Buscar mi empresa"}
          </button>
        </form>

        <a href="/" className="text-[13px] text-gypi-dim underline mt-2">Ir a la página de Gypi</a>
      </div>
    </div>
  );
}
