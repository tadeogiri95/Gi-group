'use client';
// app/components/FinanzasBuenasPracticas.jsx — Finanzas → 🧾 Configuración →
// ✅ Revisión contable (parte 7 del plan del 11/11; /api/finanzas/buenas-practicas,
// reglas en app/lib/finanzasBuenasPracticas.js).
//
// Muestra qué conviene corregir: operaciones contra Ajuste De Capital, tipos
// con otra cuenta que la recomendada (se cambian tildando y apretando un
// botón), tipos sin cuentas y cuentas que faltan en el plan.
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { plata } from "../lib/finanzasOperaciones";
import { fechaCorta } from "../lib/finanzasPagos";
import { Modal, Spinner } from "./ui";
import { useToast } from "./ui/Toast";

function Revision({ onCerrar, onAplicado }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [elegidos, setElegidos] = useState(new Set());
  const [aplicando, setAplicando] = useState(false);

  useEffect(() => {
    apiFetch("/api/finanzas/buenas-practicas")
      .then(async (res) => {
        const x = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(x.error || "No se pudo revisar");
        setD(x);
        setElegidos(new Set(x.recomendadas.map((r) => r.codigo)));
      })
      .catch((e) => setError(e.message || "No se pudo revisar"));
  }, []);

  const nombre = (c) => (c ? d?.nombres?.[c] || c : "—");
  const tildar = (codigo) => setElegidos((s) => {
    const n = new Set(s);
    if (n.has(codigo)) n.delete(codigo); else n.add(codigo);
    return n;
  });

  async function aplicar() {
    setAplicando(true);
    setError(null);
    try {
      const res = await apiFetch("/api/finanzas/buenas-practicas", { method: "POST", body: JSON.stringify({ accion: "aplicar", codigos: [...elegidos] }) });
      const x = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(x.error || "No se pudieron cambiar las cuentas");
      toast.success(`✅ ${x.cambiados.length} ${x.cambiados.length === 1 ? "tipo quedó" : "tipos quedaron"} con las cuentas recomendadas`);
      onAplicado();
    } catch (e) {
      setError(e.message);
      setAplicando(false);
    }
  }

  const todoBien = d && !d.ajuste.n && !d.recomendadas.length && !d.sin_cuentas.length && !d.faltan.length && !d.tipos_ajuste.length;
  return (
    <Modal open onClose={aplicando ? () => {} : onCerrar} title="Revisión contable" maxWidth={720}>
      <div className="flex flex-col gap-4 text-[14px] text-gypi-text">
        {!d && !error && <Spinner size={18} />}
        {todoBien && <p className="m-0 font-semibold">✅ Todo en orden: no hay nada para corregir.</p>}

        {d?.recomendadas.length > 0 && (
          <section aria-label="Cuentas recomendadas">
            <h3 className="m-0 mb-1 text-[14px] font-bold">Cuentas recomendadas para cada tipo</h3>
            <p className="m-0 mb-2 text-[13px] text-gypi-dim">Son las que se proponen al cargar. Las operaciones que ya están cargadas no cambian. Tildá las que quieras usar.</p>
            <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
              {d.recomendadas.map((r) => (
                <li key={r.codigo} className="rounded-lg border border-gypi-border p-2">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input type="checkbox" className="mt-1" checked={elegidos.has(r.codigo)} onChange={() => tildar(r.codigo)} aria-label={`Usar las cuentas recomendadas en ${r.nombre}`} />
                    <span className="flex-1 min-w-0">
                      <span className="block font-semibold">{r.nombre}</span>
                      {r.actual.debe !== r.recomendada.debe && <span className="block text-[13px]">Debe: <s className="text-gypi-dim">{nombre(r.actual.debe)}</s> → <b>{nombre(r.recomendada.debe)}</b></span>}
                      {r.actual.haber !== r.recomendada.haber && <span className="block text-[13px]">Haber: <s className="text-gypi-dim">{nombre(r.actual.haber)}</s> → <b>{nombre(r.recomendada.haber)}</b></span>}
                      <span className="block text-[12px] text-gypi-dim">{r.motivo}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}

        {d?.ajuste.n > 0 && (
          <section aria-label="Operaciones contra Ajuste De Capital">
            <h3 className="m-0 mb-1 text-[14px] font-bold">Operaciones contra Ajuste De Capital</h3>
            <p className="m-0 mb-2 text-[13px] text-gypi-dim">
              Desde el {fechaCorta(d.desde)}, {d.ajuste.n} de {d.ajuste.de} operaciones usan Ajuste De Capital como contrapartida. Es una cuenta del patrimonio: una compra o un gasto va contra Proveedores o Acreedores Varios, un impuesto contra su cuenta a pagar. Desde ahora Gypi no deja cargar operaciones nuevas así (salvo apertura, saldos iniciales y socios). Las viejas conviene corregirlas con el contador al cierre.
            </p>
            <table className="w-full border-collapse text-[13px]" aria-label="Por tipo">
              <thead><tr className="text-left text-gypi-dim"><th className="py-1 font-semibold">Tipo</th><th className="py-1 font-semibold text-right">Operaciones</th><th className="py-1 font-semibold text-right">Importe</th></tr></thead>
              <tbody>
                {d.ajuste.por_tipo.slice(0, 10).map((t) => (
                  <tr key={t.tipo} className="border-t border-gypi-border"><td className="py-1">{t.tipo}</td><td className="py-1 text-right font-mono">{t.n}</td><td className="py-1 text-right font-mono">{plata(t.total)}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {d?.tipos_ajuste.length > 0 && (
          <p className="m-0 text-[13px] text-gypi-amber-ink">⚠ Estos tipos tienen Ajuste De Capital como cuenta por defecto: {d.tipos_ajuste.join(", ")}. Cambiala en la lista de tipos (más abajo).</p>
        )}
        {d?.sin_cuentas.length > 0 && (
          <p className="m-0 text-[13px]"><b>Tipos sin cuentas por defecto ({d.sin_cuentas.length}):</b> {d.sin_cuentas.join(", ")}. Al cargar hay que elegirlas a mano.</p>
        )}
        {d?.faltan.length > 0 && (
          <section aria-label="Cuentas que faltan">
            <h3 className="m-0 mb-1 text-[14px] font-bold">Cuentas que conviene agregar al plan</h3>
            <ul className="m-0 pl-5 text-[13px]">
              {d.faltan.map((f) => <li key={f.sugerido}><b>{f.sugerido}</b>: para {f.para}.</li>)}
            </ul>
            <p className="m-0 mt-1 text-[12px] text-gypi-dim">Se agregan en el libro (dim_plan_cuentas) y después se copian con 📥 Copiar desde el libro.</p>
          </section>
        )}

        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" disabled={aplicando} onClick={onCerrar}>Cerrar</button>
          {d?.recomendadas.length > 0 && (
            <button type="button" className="g-btn g-btn-primary" disabled={aplicando || !elegidos.size} onClick={aplicar}>
              {aplicando ? "Cambiando…" : `Usar las cuentas recomendadas (${elegidos.size})`}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function FinanzasBuenasPracticas({ onAplicado }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <section aria-label="Revisión contable" className="mb-3 p-3 border border-gypi-border rounded-lg">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[220px]">
          <h3 className="m-0 text-[14px] font-bold text-gypi-text">✅ Revisión contable</h3>
          <p className="m-0 text-[13px] text-gypi-dim">Cuentas según buenas prácticas: qué tipo va contra qué cuenta, y qué conviene corregir.</p>
        </div>
        <button type="button" className="g-btn g-btn-secondary" onClick={() => setAbierto(true)}>Revisar</button>
      </div>
      {abierto && <Revision onCerrar={() => setAbierto(false)} onAplicado={() => { setAbierto(false); onAplicado?.(); }} />}
    </section>
  );
}
