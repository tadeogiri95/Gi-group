'use client';
// app/components/PlanillaMrpConexion.jsx — Conectar la planilla MRP para que
// traiga sola los movimientos cargados en Gypi (Stock, parte 15; ítem 40).
// Gestión genera el código con la clave privada y lo pega una vez en Apps
// Script de la planilla; desde ahí la planilla los trae cada hora.
import { useCallback, useEffect, useState } from "react";
import { sb, apiFetch } from "../lib/supabase";
import { CLAVE_PLANILLA_MRP } from "../lib/movimientosStock";

const fechaHora = (iso) => new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });

export default function PlanillaMrpConexion() {
  const [cfg, setCfg] = useState(undefined);
  const [abierto, setAbierto] = useState(false);
  const [script, setScript] = useState(null);
  const [error, setError] = useState(null);
  const [generando, setGenerando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const rows = await sb.get(`config_sistema?clave=eq.${CLAVE_PLANILLA_MRP}&select=valor&limit=1`);
      setCfg(rows?.[0]?.valor || null);
    } catch {
      setCfg(null);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const generar = async () => {
    if (cfg?.hash && !window.confirm("El código anterior va a dejar de andar y vas a tener que pegar el nuevo en la planilla. ¿Seguimos?")) return;
    setGenerando(true);
    setError(null);
    try {
      const res = await apiFetch("/api/stock/planilla", { method: "POST" });
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

  const estado = cfg === undefined ? "" : !cfg?.hash ? "· sin conectar"
    : cfg.ultima_lectura ? `· trajo movimientos el ${fechaHora(cfg.ultima_lectura)}` : "· esperando que la planilla los pida";

  return (
    <div className="mb-3">
      <button onClick={() => setAbierto((v) => !v)} aria-expanded={abierto}
        className="w-full min-h-[44px] flex items-center justify-between px-3 rounded-[10px] border border-gypi-border bg-gypi-surface text-[14px] font-semibold text-gypi-text cursor-pointer">
        <span>📄 Pasar a la planilla MRP {estado}</span>
        <span className="text-[12px]">{abierto ? "▲" : "▼"}</span>
      </button>
      {abierto && (
        <div className="mt-1.5 p-3 bg-gypi-surface rounded-[10px] border border-gypi-border text-[13px] leading-relaxed">
          <p className="m-0 mb-2 text-gypi-dim">
            La planilla trae sola, cada hora, los retiros, devoluciones, ajustes e ingresos cargados acá, y los anota al final de fact_consumos_stock y fact_ingresos_stock. Si anulás uno que ya pasó, la planilla borra esa fila. También deja en fact_ordenes_compra lo que falta llegar de las órdenes de compra abiertas, así cuenta en EN TRÁNSITO y el MRP no te sugiere comprarlo de nuevo.
          </p>
          {!script ? (
            <button onClick={generar} disabled={generando} className="g-btn g-btn-primary w-full">
              {generando ? "Generando…" : cfg?.hash ? "Generar un código nuevo" : "Generar el código para la planilla"}
            </button>
          ) : (
            <>
              <ol className="m-0 mb-2 pl-5 flex flex-col gap-1">
                <li>Copiá el código.</li>
                <li>En la planilla MRP: Extensiones → Apps Script.</li>
                <li>Tocá ＋ → Secuencia de comandos, pegá el código y guardá. Si ya tenías el de Gypi, borrá el viejo y pegá este en su lugar.</li>
                <li>Arriba elegí la función <b>instalarGypi</b>, tocá Ejecutar y dale los permisos. Se hace una sola vez.</li>
              </ol>
              <textarea readOnly value={script} aria-label="Código para la planilla" rows={6}
                className="g-input w-full font-mono text-xs mb-2" onFocus={(e) => e.target.select()} />
              <button onClick={copiar} className="g-btn g-btn-primary w-full">{copiado ? "✅ Copiado" : "📋 Copiar el código"}</button>
              <p className="m-0 mt-2 text-[12px] text-gypi-dim">El código tiene una clave privada: no lo compartas. Se muestra una sola vez.</p>
            </>
          )}
          {error && <div role="alert" className="text-[13px] text-gypi-red mt-2">{error}</div>}
        </div>
      )}
    </div>
  );
}
