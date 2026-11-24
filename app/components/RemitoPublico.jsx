'use client';
// app/components/RemitoPublico.jsx — La página del remito por su link
// (/remito/<token>; Logística, parte 4; migración 206). Muestra el remito,
// lo baja en PDF o lo comparte (en el celular, el PDF mismo por WhatsApp o
// mail) y, si no había nadie para firmar al entregar, deja firmar con el dedo.
import { useRef, useState, useSyncExternalStore } from "react";
import { estadoParada, numeroRemito } from "../lib/logistica";
import { filasRemito, htmlRemito, fechaHora } from "../lib/logisticaRemito";
import { descargarPdfDeHtml } from "../lib/pdfDeHtml";
import FirmaDedo from "./FirmaDedo";

/** ¿El celular deja compartir un PDF (WhatsApp, mail…)? En el servidor, no. */
function compartirArchivos() {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function" || typeof File === "undefined") return false;
  try { return navigator.canShare({ files: [new File(["x"], "x.pdf", { type: "application/pdf" })] }); } catch { return false; }
}
const sinSuscripcion = () => () => {};

const cant = (n) => String(Math.round(Number(n || 0) * 100) / 100).replace(".", ",");

export default function RemitoPublico({ token, datos }) {
  const [d, setD] = useState(datos);
  const [nombre, setNombre] = useState("");
  const [dni, setDni] = useState("");
  const [conTrazo, setConTrazo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [armando, setArmando] = useState(false);
  const [error, setError] = useState(null);
  const firma = useRef(null);
  const { empresa, parada } = d;
  const est = estadoParada(parada.estado, parada.accion);
  const archivo = `Remito ${numeroRemito(parada.remito_numero)}.pdf`;

  const pdf = async (compartir) => {
    setError(null);
    setArmando(true);
    try {
      if (compartir) {
        const file = await descargarPdfDeHtml(htmlRemito(d), { archivo, comoArchivo: true });
        await navigator.share({ files: [file], title: archivo });
      } else {
        await descargarPdfDeHtml(htmlRemito(d), { archivo });
      }
    } catch (e) {
      if (e?.name !== "AbortError") setError("No se pudo armar el PDF. Probá de nuevo.");
    }
    setArmando(false);
  };
  const puedeCompartirArchivo = useSyncExternalStore(sinSuscripcion, compartirArchivos, () => false);

  const firmar = async () => {
    setError(null);
    if (!conTrazo) { setError("Firmá con el dedo en el recuadro blanco."); return; }
    if (!nombre.trim()) { setError("Poné tu nombre."); return; }
    setEnviando(true);
    try {
      const res = await fetch("/api/remito/firmar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, png: firma.current.png(), nombre: nombre.trim(), dni: dni.trim() }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error || "No se pudo guardar la firma");
      setD((x) => ({ ...x, puedeFirmar: false, parada: { ...x.parada, firma_url: r.firma_url, firma_nombre: nombre.trim(), firma_dni: dni.trim() || null, sin_firma: false, firmada_link_at: new Date().toISOString() } }));
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  return (
    <main className="min-h-dvh bg-gypi-bg text-gypi-text font-body overflow-y-auto">
      <div className="max-w-[620px] mx-auto px-4 py-6 flex flex-col gap-4">
        <header className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- logo de la empresa, URL de Supabase */}
          {empresa.logo && <img src={empresa.logo} alt="" className="w-12 h-12 rounded-xl object-contain bg-gypi-surface" />}
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-bold font-heading truncate">{empresa.nombre}</div>
            <div className="text-[13px] text-gypi-dim">Remito interno · sin valor fiscal</div>
          </div>
        </header>

        <section aria-label="Remito" className="rounded-[18px] border border-gypi-border bg-gypi-surface p-4">
          <h1 className="m-0 text-[22px] font-extrabold font-heading">Remito N° {numeroRemito(parada.remito_numero)}</h1>
          <div className="text-[15px] font-semibold mb-2">{est.emoji} {est.label}</div>
          <dl className="m-0 grid grid-cols-[110px_1fr] gap-x-2 gap-y-1 text-[14px]">
            {filasRemito(d).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-bold">{k}</dt>
                <dd className="m-0">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-label={parada.accion === "retirar" ? "Lo retirado" : "Lo entregado"} className="rounded-[18px] border border-gypi-border bg-gypi-surface p-4">
          <h2 className="m-0 mb-2 text-[16px] font-bold">{parada.accion === "retirar" ? "Lo retirado" : "Lo entregado"}</h2>
          {parada.renglones.length ? (
            <ul className="list-none m-0 p-0 flex flex-col gap-1">
              {parada.renglones.map((r, i) => (
                <li key={i} className="flex gap-2 text-[14px] border-b border-gypi-border pb-1">
                  <span className="flex-1">{r.texto}</span>
                  <span className="whitespace-nowrap font-semibold">{Number(r.hecha) >= Number(r.cantidad) ? cant(r.cantidad) : `${cant(r.hecha)} de ${cant(r.cantidad)}`}</span>
                </li>
              ))}
            </ul>
          ) : <div className="text-[14px] text-gypi-dim">Sin detalle.</div>}
          {parada.motivo && <p className="text-[14px] mt-2 mb-0"><b>Observación:</b> {parada.motivo}</p>}
        </section>

        {parada.fotos.length > 0 && (
          <section aria-label="Fotos" className="flex flex-wrap gap-2">
            {parada.fotos.map((u, i) => (
              <a key={u} href={u} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- foto de la entrega, URL de Supabase */}
                <img src={u} alt={`Foto ${i + 1} de la entrega`} className="w-[100px] h-[100px] object-cover rounded-lg border border-gypi-border" />
              </a>
            ))}
          </section>
        )}

        <section aria-label="Firma" className="rounded-[18px] border border-gypi-border bg-gypi-surface p-4">
          <h2 className="m-0 mb-2 text-[16px] font-bold">Recibió</h2>
          {parada.firma_url ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- firma, URL de Supabase */}
              <img src={parada.firma_url} alt="Firma de quien recibió" className="w-full max-w-[320px] bg-white rounded-xl border border-gypi-border" />
              <div className="text-[14px] mt-1">{[parada.firma_nombre, parada.firma_dni && `DNI ${parada.firma_dni}`].filter(Boolean).join(" · ")}</div>
              {parada.firmada_link_at && <div className="text-[12px] text-gypi-dim">Firmó desde este link el {fechaHora(parada.firmada_link_at)}</div>}
            </>
          ) : d.puedeFirmar ? (
            <>
              <p className="text-[14px] mt-0">Cuando se entregó no había nadie para firmar. Si recibiste lo de arriba, firmá acá:</p>
              <FirmaDedo ref={firma} onCambio={setConTrazo} disabled={enviando} quien="quien recibió" />
              <div className="flex gap-2 mt-2">
                <input aria-label="Tu nombre" className="g-input flex-1 min-w-0" maxLength={120} placeholder="Tu nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
                <input aria-label="Tu DNI" inputMode="numeric" className="g-input !w-[120px]" maxLength={20} placeholder="DNI" value={dni} onChange={(e) => setDni(e.target.value)} />
              </div>
              <button type="button" className="g-btn g-btn-primary w-full mt-2" onClick={firmar} disabled={enviando}>{enviando ? "Guardando…" : "✍️ Firmar el remito"}</button>
            </>
          ) : <div className="text-[14px] text-gypi-dim">Sin firma.</div>}
        </section>

        {error && <div role="alert" className="text-[14px] text-gypi-red">{error}</div>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="g-btn g-btn-primary flex-1" onClick={() => pdf(false)} disabled={armando}>{armando ? "Armando el PDF…" : "📄 Bajar en PDF"}</button>
          {puedeCompartirArchivo && <button type="button" className="g-btn g-btn-secondary flex-1" onClick={() => pdf(true)} disabled={armando}>📤 Compartir el PDF</button>}
        </div>
      </div>
    </main>
  );
}
