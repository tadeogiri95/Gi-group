'use client';
// app/components/FinanzasLibroScript.jsx — Finanzas → 🧾 Configuración →
// 🔗 Pasar Gypi al libro (parte F2c; app/lib/finanzasLibro.js). El Dueño
// genera el código y lo pega una vez en Apps Script del libro contable. Desde
// ahí, cada 15 minutos, el script baja a T-OPERACIONES y R-CHEQUES lo que se
// cargó en Gypi.
import { useCallback, useEffect, useState } from "react";
import { sb, apiFetch } from "../lib/supabase";

// La misma que CLAVE_LIBRO_FIN de app/lib/finanzasLibro.js (ese archivo usa crypto: no va al navegador)
export const CLAVE_LIBRO_FIN = "finanzas_libro";

const fechaHora = (iso) => new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });

export default function FinanzasLibroScript() {
  const [cfg, setCfg] = useState(undefined);
  const [script, setScript] = useState(null);
  const [error, setError] = useState(null);
  const [generando, setGenerando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const rows = await sb.get(`config_sistema?clave=eq.${CLAVE_LIBRO_FIN}&select=valor&limit=1`);
      setCfg(rows?.[0]?.valor || null);
    } catch {
      setCfg(null);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const generar = async () => {
    if (cfg?.hash && !window.confirm("El código anterior va a dejar de andar y vas a tener que pegar el nuevo en Apps Script. ¿Seguimos?")) return;
    setGenerando(true);
    setError(null);
    try {
      const res = await apiFetch("/api/finanzas/libro", { method: "POST", body: JSON.stringify({}) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo generar el código");
      setScript(data.script);
      setCopiado(false);
      await cargar();
    } catch (e) {
      setError(e.message);
    }
    setGenerando(false);
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(script);
      setCopiado(true);
    } catch {
      setError("No se pudo copiar: seleccioná el texto y copialo a mano.");
    }
  };

  const estado = cfg === undefined ? "" : !cfg?.hash ? "Sin conectar."
    : cfg.ultima_lectura ? `Conectado: el libro leyó a Gypi el ${fechaHora(cfg.ultima_lectura)}.` : "Esperando que el script corra por primera vez.";

  return (
    <section aria-label="Pasar Gypi al libro" className="g-card p-4 mb-3 flex flex-col gap-2">
      <h2 className="m-0 text-[16px] font-bold text-gypi-text">🔗 Pasar Gypi al libro</h2>
      <p className="m-0 text-[13px] text-gypi-dim leading-relaxed">
        Un script en el libro contable baja cada 15 minutos lo que cargues en Gypi: las operaciones a <b>T-OPERACIONES</b> (con
        referencia GY-F-…) y los cheques a <b>R-CHEQUES</b> (GY-C-…). Si una operación se anula en Gypi, su renglón se borra; los
        renglones que cargaste a mano no se tocan. A los cheques que copiaste del libro solo les actualiza el estado.
      </p>
      {estado && <div className={`text-xs ${cfg?.ultima_lectura ? "text-gypi-green" : "text-gypi-dim"}`}>{estado}</div>}
      {!script ? (
        <button type="button" onClick={generar} disabled={generando} className="g-btn g-btn-primary w-full disabled:opacity-50">
          {generando ? "Generando…" : cfg?.hash ? "Generar un código nuevo" : "Generar el código"}
        </button>
      ) : (
        <>
          <ol className="m-0 pl-5 flex flex-col gap-1 text-[13px] leading-relaxed text-gypi-text">
            <li>Copiá el código.</li>
            <li>Abrí el libro contable y entrá a <b>Extensiones → Apps Script</b>.</li>
            <li>Creá un archivo nuevo (＋ al lado de Archivos), pegá el código y guardá. Si ya tenías el de Gypi, pegá este en su lugar.</li>
            <li>Arriba elegí la función <b>instalarLibroGypi</b>, tocá Ejecutar y dale los permisos. Se hace una sola vez. Después corre solo cada 15 minutos.</li>
          </ol>
          <textarea readOnly value={script} aria-label="Código para Apps Script" rows={6}
            className="g-input w-full font-mono text-xs" onFocus={(e) => e.target.select()} />
          <button type="button" onClick={copiar} className="g-btn g-btn-primary w-full">{copiado ? "✅ Copiado" : "📋 Copiar el código"}</button>
          <p className="m-0 text-[12px] text-gypi-dim">El código tiene una clave privada: no lo compartas. Se muestra una sola vez.</p>
        </>
      )}
      {error && <div role="alert" className="text-[13px] text-gypi-red">{error}</div>}
    </section>
  );
}
