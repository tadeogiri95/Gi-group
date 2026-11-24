'use client';
// app/components/RemitoParada.jsx — El remito de una parada cumplida, desde la
// app (Logística, parte 4; migración 206). La primera vez que se abre le da
// número correlativo y link. Desde acá se abre (para verlo o bajarlo en PDF),
// se manda el link por WhatsApp o mail (para que firme, si no había nadie) y
// se anotan el número del remito oficial (ARCA) y el COT.
import { useEffect, useState } from "react";
import { linkMail, linkRemito, linkWhatsapp, numeroRemito, puedeFirmarPorLink, textoRemito } from "../lib/logistica";
import { postLogistica } from "./LogisticaScreen";
import { useEscape } from "../hooks/useEscape";

export default function RemitoParada({ parada, empresaNombre = "", onCerrar, onCambio }) {
  useEscape(onCerrar);
  const [remito, setRemito] = useState(null);
  const [oficial, setOficial] = useState(parada.remito_oficial || "");
  const [cot, setCot] = useState(parada.cot || "");
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    postLogistica({ accion: "remito_preparar", id: parada.id })
      .then((r) => { if (vivo) setRemito(r.parada || {}); })
      .catch((e) => { if (vivo) setError(e.message); });
    return () => { vivo = false; };
  }, [parada.id]);
  const p = remito ? { ...parada, ...remito } : null;

  const origen = typeof window !== "undefined" ? window.location.origin : "";
  const url = p ? linkRemito(origen, p.token) : null;
  const firmar = puedeFirmarPorLink(parada);
  const texto = p && url ? textoRemito({ empresa: empresaNombre, numero: p.remito_numero, nombre: parada.nombre, url, firmar }) : "";

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setAviso("Link copiado");
    } catch {
      setAviso(url);
    }
  };
  const guardar = async () => {
    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      const r = await postLogistica({ accion: "remito_datos", id: parada.id, remito_oficial: oficial.trim() || null, cot: cot.trim() || null });
      setRemito((x) => ({ ...x, ...r.parada }));
      setAviso("Guardado");
      await onCambio?.();
    } catch (e) {
      setError(e.message);
    }
    setGuardando(false);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Remito" className="fixed inset-0 z-[70] bg-black/40 flex items-end sm:items-center justify-center">
      <div className="w-full max-w-[480px] max-h-[90dvh] overflow-y-auto bg-gypi-bg rounded-t-[18px] sm:rounded-[18px] p-4">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="flex-1 m-0 font-heading text-[18px] font-extrabold">📄 Remito{p?.remito_numero ? ` N° ${numeroRemito(p.remito_numero)}` : ""}</h2>
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cerrar</button>
        </div>
        <div className="text-[14px] mb-3">{parada.orden}. {parada.nombre}{parada.ots?.length ? ` · OT ${parada.ots.join(", ")}` : ""}</div>
        {!p && !error && <div className="text-[14px] text-gypi-dim" role="status">Preparando el remito…</div>}
        {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
        {p && url && (
          <>
            {firmar && <div className="p-2.5 mb-3 rounded-[10px] bg-gypi-amber/10 text-[13px]">✍️ Falta la firma de quien recibió: mandale el link y firma desde su celular.</div>}
            <div className="flex flex-col gap-2 mb-3">
              <a href={url} target="_blank" rel="noopener noreferrer" className="g-btn g-btn-primary no-underline text-center">📄 Ver el remito y bajarlo en PDF</a>
              <a href={linkWhatsapp(texto)} target="_blank" rel="noopener noreferrer" className="g-btn g-btn-secondary no-underline text-center">💬 Mandar por WhatsApp</a>
              <a href={linkMail({ asunto: `Remito N° ${numeroRemito(p.remito_numero)}${empresaNombre ? ` de ${empresaNombre}` : ""}`, cuerpo: texto })} className="g-btn g-btn-secondary no-underline text-center">✉️ Mandar por mail</a>
              <button type="button" className="g-btn g-btn-secondary" onClick={copiar}>🔗 Copiar el link</button>
            </div>
            <h3 className="text-[15px] font-bold mt-0 mb-1">Papeles oficiales (si hay)</h3>
            <div className="flex gap-2 mb-2">
              <input aria-label="N° de remito oficial" className="g-input flex-1 min-w-0" maxLength={40} placeholder="Remito oficial" value={oficial} onChange={(e) => setOficial(e.target.value)} />
              <input aria-label="N° de COT" className="g-input flex-1 min-w-0" maxLength={40} placeholder="N° de COT" value={cot} onChange={(e) => setCot(e.target.value)} />
            </div>
            <button type="button" className="g-btn g-btn-secondary w-full" onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar números"}</button>
          </>
        )}
        {aviso && <div role="status" className="text-[13px] mt-2 break-all">{aviso}</div>}
      </div>
    </div>
  );
}
