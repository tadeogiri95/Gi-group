"use client";
// Descargar todos los datos y dar de baja la cuenta (F6-01, ítem 28). Solo el dueño.
import { useState } from "react";
import { apiFetch } from "../lib/supabase";

const FMT = { day: "numeric", month: "long", year: "numeric" };

export async function descargarDatos(fetcher = apiFetch) {
  const r = await fetcher("/api/cuenta/exportar", { method: "GET" });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "No se pudo descargar");
  const nombre = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") || "")?.[1] || "gypi-datos.zip";
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return nombre;
}

export default function CuentaDatos({ usuario, empresa, onLogout, fetcher = apiFetch }) {
  const [descargando, setDescargando] = useState(false);
  const [descargado, setDescargado] = useState(false);
  const [paso, setPaso] = useState(0); // 0: nada · 1: confirmando · 2: dada de baja
  const [confirmacion, setConfirmacion] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [borradoEl, setBorradoEl] = useState(null);

  if (usuario?.rol !== "gerencial") return null;

  const descargar = async () => {
    setDescargando(true);
    setError("");
    try { await descargarDatos(fetcher); setDescargado(true); } catch (e) { setError(e.message); }
    setDescargando(false);
  };

  const darDeBaja = async () => {
    setEnviando(true);
    setError("");
    try {
      const r = await fetcher("/api/cuenta/baja", { method: "POST", body: JSON.stringify({ confirmacion }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo dar de baja");
      setBorradoEl(d.borrado_el);
      setPaso(2);
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  return (
    <div>
      <p className="g-overline text-gypi-dim mb-1">Tus datos</p>
      <div className="bg-gypi-surface border border-gypi-border rounded-xl p-4 flex flex-col gap-3">
        <div>
          <p className="text-[13px] text-gypi-text m-0 mb-2">Descargá todo lo que tu empresa cargó en Gypi (empleados, fichadas, tareas, solicitudes, OT y más) en un archivo .zip que se abre con Excel.</p>
          <button onClick={descargar} disabled={descargando} className="min-h-[44px] px-4 rounded-lg border border-gypi-border bg-gypi-surf-hi text-gypi-text text-xs font-bold cursor-pointer disabled:opacity-50">
            {descargando ? "Preparando…" : "⬇️ Descargar todos los datos"}
          </button>
          {descargado && <p role="status" className="text-xs text-gypi-green mt-2 mb-0">Listo, revisá tus descargas.</p>}
        </div>

        <div className="border-t border-gypi-border pt-3">
          {paso === 0 && (
            <button onClick={() => setPaso(1)} className="min-h-[44px] px-4 rounded-lg border-none bg-gypi-red/10 text-gypi-red text-xs font-bold cursor-pointer">Dar de baja la cuenta</button>
          )}
          {paso === 1 && (
            <div className="flex flex-col gap-2">
              <p className="text-[13px] text-gypi-text m-0 font-semibold">¿Dar de baja {empresa?.nombre}?</p>
              <ul className="text-xs text-gypi-dim m-0 pl-4">
                <li>Nadie de tu equipo va a poder entrar, tampoco los kioscos.</li>
                <li>Se cancela la suscripción y no se cobra más.</li>
                <li>A los 30 días se borra todo para siempre. Hasta entonces la podés recuperar con el link que te mandamos por email.</li>
              </ul>
              {!descargado && <p className="text-xs text-gypi-amber-ink m-0">Te recomendamos descargar los datos antes: después no vas a poder entrar.</p>}
              <label className="text-xs text-gypi-dim">Para confirmar, escribí el nombre de la empresa: <b className="text-gypi-text">{empresa?.nombre}</b>
                <input value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} className="g-input w-full mt-1" autoComplete="off" />
              </label>
              <div className="flex gap-2">
                <button onClick={() => { setPaso(0); setConfirmacion(""); setError(""); }} className="flex-1 min-h-[44px] rounded-lg border border-gypi-border bg-transparent text-gypi-dim text-xs font-bold cursor-pointer">Cancelar</button>
                <button onClick={darDeBaja} disabled={enviando || !confirmacion.trim()} className="flex-1 min-h-[44px] rounded-lg border-none bg-gypi-red text-white text-xs font-bold cursor-pointer disabled:opacity-50">
                  {enviando ? "Dando de baja…" : "Sí, dar de baja"}
                </button>
              </div>
            </div>
          )}
          {paso === 2 && (
            <div role="status" className="flex flex-col gap-2">
              <p className="text-[13px] text-gypi-text m-0">La cuenta quedó dada de baja. Los datos se borran el {borradoEl ? new Date(borradoEl).toLocaleDateString("es-AR", FMT) : "en 30 días"}. Te mandamos un email con el link para recuperarla.</p>
              <button onClick={onLogout} className="min-h-[44px] px-4 rounded-lg border border-gypi-border bg-transparent text-gypi-text text-xs font-bold cursor-pointer">Salir</button>
            </div>
          )}
          {error && <p role="alert" className="text-xs text-gypi-red mt-2 mb-0">{error}</p>}
        </div>
      </div>
    </div>
  );
}
