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

/** El error que mandó el script, contado en castellano simple. */
export function errorDelLibroSimple(error) {
  const s = String(error || "");
  const celda = s.match(/celda ([A-Z]+\d+)/i) || s.match(/cell ([A-Z]+\d+)/i);
  const valores = s.match(/valores:\s*([^\n]*?)\.?\s*$/im);
  if (/validaci[oó]n|validation/i.test(s)) {
    return `Una celda del libro${celda ? ` (${celda[1]})` : ""} no aceptó el dato por su lista desplegable${valores ? ` (solo acepta: ${valores[1]})` : ""}, y el pase se frenó. Generá el código nuevo y pegalo: ya no se frena por eso.`;
  }
  if (/exceeded|tiempo m[aá]ximo/i.test(s)) return "El pase tardó más de lo que permite Google y se cortó. Vuelve a probar solo en 15 minutos.";
  return s;
}

const clave = (r) => `${r.fila}|${r.firma}`;

/** Lo que pasó en la última vuelta del script y las copias repetidas del libro. */
function EstadoDelPase({ estado, pedidos, onCambio }) {
  const [elegidas, setElegidas] = useState(() => new Set());
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState(null);
  if (!estado) return null;
  const errores = estado.errores || [];
  const avisos = estado.avisos || [];
  const repetidos = estado.repetidos || [];
  const pedidas = new Set((pedidos || []).map(clave));
  const copias = repetidos.filter((r) => elegidas.has(clave(r))).reduce((s, r) => s + r.copias, 0);
  const alternar = (k) => setElegidas((x) => { const n = new Set(x); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const borrar = async () => {
    if (!window.confirm(`Se van a borrar ${copias} renglones repetidos del libro (de cada grupo queda el primero). ¿Seguimos?`)) return;
    setEnviando(true);
    setMsg(null);
    try {
      const res = await apiFetch("/api/finanzas/libro", { method: "POST", body: JSON.stringify({ accion: "borrar_repetidos", repetidos: repetidos.filter((r) => elegidas.has(clave(r))) }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo pedir");
      setMsg(`Listo: el libro borra ${d.copias} renglones en la próxima vuelta (hasta 15 minutos).`);
      setElegidas(new Set());
      onCambio();
    } catch (e) {
      setMsg(`⚠ ${e.message}`);
    }
    setEnviando(false);
  };

  return (
    <div className="flex flex-col gap-2 text-[13px]" aria-label="Última vuelta del libro">
      {errores.length ? (
        <div role="alert" className="p-2 rounded-lg border border-gypi-red/40 bg-gypi-red/10 text-gypi-text">
          <b className="text-gypi-red">⚠ El último pase al libro ({fechaHora(estado.at)}) no terminó:</b>
          <ul className="m-0 mt-1 pl-5">{errores.map((e, i) => <li key={i}>{errorDelLibroSimple(e)}</li>)}</ul>
        </div>
      ) : (
        <div className="text-gypi-green">✓ El último pase al libro salió bien ({fechaHora(estado.at)}).</div>
      )}
      {avisos.length > 0 && (
        <details className="p-2 rounded-lg border border-gypi-amber/40 bg-gypi-amber/10">
          <summary className="cursor-pointer font-semibold text-gypi-amber-ink">{avisos.length} datos entraron con el triángulo rojo (no están en la lista desplegable de su columna)</summary>
          <ul className="m-0 mt-1 pl-5 text-gypi-text">{avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </details>
      )}
      {repetidos.length > 0 && (
        <div className="p-2 rounded-lg border border-gypi-amber/40 bg-gypi-amber/10 flex flex-col gap-1.5">
          <b className="text-gypi-amber-ink">🔁 Renglones repetidos en T-OPERACIONES ({repetidos.length})</b>
          <p className="m-0 text-gypi-dim">Son renglones iguales en todo al de arriba. Elegí los que sean copias: se borran las copias y queda el primero.</p>
          <ul className="list-none m-0 p-0 flex flex-col gap-1">
            {repetidos.map((r) => (
              <li key={clave(r)}>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={elegidas.has(clave(r))} disabled={pedidas.has(clave(r))} onChange={() => alternar(clave(r))} aria-label={`Borrar las copias del renglón ${r.fila}`} />
                  <span>
                    <b>Renglón {r.fila}</b> · {r.fecha}{r.total ? ` · ${r.total}` : ""} · {r.descripcion || "sin descripción"} — <b>{r.copias} {r.copias === 1 ? "copia" : "copias"}</b>
                    {pedidas.has(clave(r)) && <span className="text-gypi-dim"> (se borra en la próxima vuelta)</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <button type="button" className="g-btn g-btn-primary self-start disabled:opacity-50" disabled={!copias || enviando} onClick={borrar}>
            {enviando ? "Pidiendo…" : copias ? `🗑 Borrar ${copias} copias` : "Elegí cuáles borrar"}
          </button>
        </div>
      )}
      {msg && <div className="text-gypi-text">{msg}</div>}
    </div>
  );
}

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
      {cfg?.hash && <EstadoDelPase estado={cfg.estado} pedidos={cfg.borrar} onCambio={cargar} />}
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
