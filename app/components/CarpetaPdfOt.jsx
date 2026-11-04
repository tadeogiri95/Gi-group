'use client';
// app/components/CarpetaPdfOt.jsx — Más → Planillas conectadas → 📄 PDF de
// las OT (04/11; app/lib/pdfOt.js). Gestión pega el link de la carpeta de
// Drive, genera el código y lo pega una vez en script.google.com. Desde ahí
// el script le pasa a Gypi la lista de PDF cada 15 minutos.
import { useCallback, useEffect, useState } from "react";
import { sb, apiFetch } from "../lib/supabase";
import { CLAVE_PDF_OT } from "../lib/pdfOt";

const fechaHora = (iso) => new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });

export default function CarpetaPdfOt() {
  const [cfg, setCfg] = useState(undefined);
  const [carpeta, setCarpeta] = useState("");
  const [script, setScript] = useState(null);
  const [error, setError] = useState(null);
  const [generando, setGenerando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const rows = await sb.get(`config_sistema?clave=eq.${CLAVE_PDF_OT}&select=valor&limit=1`);
      const v = rows?.[0]?.valor || null;
      setCfg(v);
      if (v?.carpeta) setCarpeta((c) => c || `https://drive.google.com/drive/folders/${v.carpeta}`);
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
      const res = await apiFetch("/api/proyectos/pdfs", { method: "POST", body: JSON.stringify({ carpeta }) });
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

  const cuantos = Array.isArray(cfg?.archivos) ? cfg.archivos.length : 0;
  const estado = cfg === undefined ? "" : !cfg?.hash ? "Sin conectar."
    : cfg.ultima_lectura ? `Conectada: ${cuantos} PDF, leídos el ${fechaHora(cfg.ultima_lectura)}.` : "Esperando que el script mande la lista.";

  return (
    <section aria-label="PDF de las OT" className="p-3.5 rounded-xl border border-gypi-border bg-gypi-surface flex flex-col gap-2">
      <h3 className="m-0 text-[16px] font-bold text-gypi-text">📄 PDF de las OT (carpeta de Drive)</h3>
      <p className="m-0 text-[13px] text-gypi-dim leading-relaxed">
        Cada OT muestra el botón 📄 PDF con el archivo de la carpeta cuyo nombre empieza con su número (por ejemplo <b>7498-36-CLIENTE-….pdf</b> para la OT M-7498-36).
        La carpeta tiene que estar compartida como <b>Cualquier persona con el enlace puede ver</b>, así el PDF se abre en el celular sin cuenta de Google.
      </p>
      {estado && <div className={`text-xs ${cfg?.ultima_lectura ? "text-gypi-green" : "text-gypi-dim"}`}>{estado}</div>}
      <label className="g-label" htmlFor="carpeta-pdf">Link de la carpeta de Drive</label>
      <input id="carpeta-pdf" value={carpeta} onChange={(e) => setCarpeta(e.target.value)}
        placeholder="https://drive.google.com/drive/folders/…" className="g-input w-full text-[13px]" />
      {!script ? (
        <button onClick={generar} disabled={generando || !carpeta.trim()} className="g-btn g-btn-primary w-full disabled:opacity-50">
          {generando ? "Generando…" : cfg?.hash ? "Generar un código nuevo" : "Generar el código"}
        </button>
      ) : (
        <>
          <ol className="m-0 pl-5 flex flex-col gap-1 text-[13px] leading-relaxed">
            <li>Copiá el código.</li>
            <li>Entrá a <b>script.google.com</b> con una cuenta que vea la carpeta y creá un script nuevo (botón ＋ arriba a la izquierda).</li>
            <li>Borrá lo que aparece, pegá el código y guardá. Si ya tenías el de Gypi, pegá este en su lugar.</li>
            <li>Arriba elegí la función <b>instalarPdfGypi</b>, tocá Ejecutar y dale los permisos. Se hace una sola vez. Después corre solo cada 15 minutos.</li>
          </ol>
          <textarea readOnly value={script} aria-label="Código para Apps Script" rows={6}
            className="g-input w-full font-mono text-xs" onFocus={(e) => e.target.select()} />
          <button onClick={copiar} className="g-btn g-btn-primary w-full">{copiado ? "✅ Copiado" : "📋 Copiar el código"}</button>
          <p className="m-0 text-[12px] text-gypi-dim">El código tiene una clave privada: no lo compartas. Se muestra una sola vez.</p>
        </>
      )}
      {error && <div role="alert" className="text-[13px] text-gypi-red">{error}</div>}
    </section>
  );
}
