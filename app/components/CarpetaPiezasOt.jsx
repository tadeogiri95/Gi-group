'use client';
// app/components/CarpetaPiezasOt.jsx — Más → Planillas conectadas → 🧩 Piezas
// desde las planillas de despiece (07/11; app/lib/planillaPiezas.js).
// Gestión pega el link de la carpeta de Drive con los Excel de cada OT,
// genera el código y lo pega una vez en script.google.com. Desde ahí, cada
// 15 minutos, Gypi carga solo las piezas y los módulos de las OT con la
// Técnica lista (columna EXCEL del Plan de trabajo).
import { useCallback, useEffect, useMemo, useState } from "react";
import { sb, apiFetch } from "../lib/supabase";
import { CLAVE_PLANILLAS_PIEZAS, cargasParaVer, textoCarga, excelsGrandes } from "../lib/planillaPiezas";

const fechaHora = (iso) => new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
const VISIBLES = 15;

export default function CarpetaPiezasOt() {
  const [cfg, setCfg] = useState(undefined);
  const [carpeta, setCarpeta] = useState("");
  const [script, setScript] = useState(null);
  const [error, setError] = useState(null);
  const [generando, setGenerando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [todas, setTodas] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const rows = await sb.get(`config_sistema?clave=eq.${CLAVE_PLANILLAS_PIEZAS}&select=valor&limit=1`);
      const v = rows?.[0]?.valor || null;
      setCfg(v);
      if (v?.carpeta) setCarpeta((c) => c || `https://drive.google.com/drive/folders/${v.carpeta}`);
    } catch {
      setCfg(null);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const llamar = async (cuerpo) => {
    const res = await apiFetch("/api/piezas/planillas", { method: "POST", body: JSON.stringify(cuerpo) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo hacer");
    return data;
  };

  const generar = async () => {
    if (cfg?.hash && !window.confirm("El código anterior va a dejar de andar y vas a tener que pegar el nuevo en Apps Script. ¿Seguimos?")) return;
    setGenerando(true);
    setError(null);
    try {
      const data = await llamar({ accion: "conectar", carpeta });
      setScript(data.script);
      setCopiado(false);
      await cargar();
    } catch (e) {
      setError(e.message);
    }
    setGenerando(false);
  };

  const releer = async (ot) => {
    setError(null);
    try {
      await llamar({ accion: "releer", ot });
      await cargar();
    } catch (e) {
      setError(e.message);
    }
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(script);
      setCopiado(true);
    } catch {
      setError("No se pudo copiar: seleccioná el texto y copialo a mano.");
    }
  };

  const cargas = useMemo(() => cargasParaVer(cfg?.cargas), [cfg]);
  const grandes = useMemo(() => excelsGrandes(cfg?.archivos), [cfg]);
  const conProblema = cargas.filter((c) => c.problema).length;
  const lista = todas ? cargas : cargas.slice(0, VISIBLES);
  const cuantos = Array.isArray(cfg?.archivos) ? cfg.archivos.length : 0;
  const estado = cfg === undefined ? "" : !cfg?.hash ? "Sin conectar."
    : cfg.ultima_lectura ? `Conectada: ${cuantos} Excel en la carpeta, mirada el ${fechaHora(cfg.ultima_lectura)}. ${cargas.length} OT con piezas cargadas solas.` : "Esperando que el script mire la carpeta.";

  return (
    <section aria-label="Piezas desde las planillas" className="p-3.5 rounded-xl border border-gypi-border bg-gypi-surface flex flex-col gap-2">
      <h3 className="m-0 text-[16px] font-bold text-gypi-text">🧩 Piezas y módulos desde las planillas (carpeta de Drive)</h3>
      <p className="m-0 text-[13px] text-gypi-dim leading-relaxed">
        Cuando en el Plan de trabajo la columna <b>EXCEL</b> de una OT tiene las iniciales de la arquitecta, Gypi abre la planilla de esa OT y carga solas sus piezas en 🧩 Piezas, con su módulo.
        La planilla se reconoce por el número del principio del nombre (por ejemplo <b>7408-230-BCG-….xlsm</b> para la OT M-7408-230). Si la planilla cambia, Gypi la vuelve a leer y las piezas ya escaneadas no pierden sus escaneos.
      </p>
      <p className="m-0 text-[13px] text-gypi-dim leading-relaxed">
        Todo va dentro del mueble salvo lo que se marca. En las planillas con la columna <b>SUELTO</b> (en DATOS al lado de cada pieza y en PLANILLA al lado de CANTIDAD de NECESIDADES), lo que dice <b>SI</b> pasa a 📦 Sueltos de la OT para controlarlo en el acopio y la carga.
      </p>
      {estado && <div className={`text-xs ${cfg?.ultima_lectura ? "text-gypi-green" : "text-gypi-dim"}`}>{estado}</div>}
      <label className="g-label" htmlFor="carpeta-piezas">Link de la carpeta de Drive</label>
      <input id="carpeta-piezas" value={carpeta} onChange={(e) => setCarpeta(e.target.value)}
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
            <li>Borrá lo que aparece, pegá el código y guardá. Si ya tenías este script de Gypi, pegá el nuevo en su lugar.</li>
            <li>Arriba elegí la función <b>instalarPiezasGypi</b>, tocá Ejecutar y dale los permisos. Se hace una sola vez. Después corre solo cada 15 minutos.</li>
          </ol>
          <textarea readOnly value={script} aria-label="Código para Apps Script" rows={6}
            className="g-input w-full font-mono text-xs" onFocus={(e) => e.target.select()} />
          <button onClick={copiar} className="g-btn g-btn-primary w-full">{copiado ? "✅ Copiado" : "📋 Copiar el código"}</button>
          <p className="m-0 text-[12px] text-gypi-dim">El código tiene una clave privada: no lo compartas. Se muestra una sola vez.</p>
        </>
      )}
      {error && <div role="alert" className="text-[13px] text-gypi-red">{error}</div>}

      {grandes.length > 0 && (
        <div className="text-[12px] text-gypi-amber-ink">
          {grandes.length === 1 ? "Un Excel es demasiado grande para leerlo solo" : `${grandes.length} Excel son demasiado grandes para leerlos solos`} (más de 3 MB): {grandes.slice(0, 5).map((a) => a.nombre).join(", ")}. Esas piezas se pegan a mano en 🧩 Piezas.
        </div>
      )}

      {cargas.length > 0 && (
        <div className="flex flex-col gap-1.5 mt-1">
          <div className="text-[13px] font-semibold">
            Últimas cargas{conProblema > 0 && <span className="text-gypi-red"> · {conProblema} para revisar</span>}
          </div>
          <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
            {lista.map((c) => (
              <li key={c.ot} className={`p-2 rounded-lg border text-[12px] ${c.problema ? "border-gypi-red/40" : "border-gypi-border"}`}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">{c.ot} <span className="font-normal text-gypi-dim">· {c.at ? fechaHora(c.at) : ""}</span></div>
                    <div className="text-gypi-dim truncate" title={c.nombre}>{c.nombre}</div>
                    <div className={c.problema ? "text-gypi-red" : "text-gypi-green"}>{textoCarga(c)}</div>
                    {c.sin_codigo?.length > 0 && <div className="text-gypi-dim">Sin código: {c.sin_codigo.join(", ")}{c.sin_codigo_total > c.sin_codigo.length ? "…" : ""}</div>}
                    {c.errores?.length > 0 && <div className="text-gypi-dim">{c.errores.join(" · ")}</div>}
                  </div>
                  <button onClick={() => releer(c.ot)} className="g-btn g-btn-secondary text-[12px] min-h-[36px] px-2.5 shrink-0" title="La próxima vuelta del script la vuelve a leer">🔄 Volver a leer</button>
                </div>
              </li>
            ))}
          </ul>
          {cargas.length > VISIBLES && (
            <button onClick={() => setTodas((t) => !t)} className="g-btn g-btn-secondary w-full text-[13px]">
              {todas ? "Ver menos" : `Ver las ${cargas.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
