'use client';
// app/components/FinanzasEcheqListado.jsx — Finanzas → 🏦 Cheques → 📥 Subir
// listado del banco (13/11, parte 6 del plan de Tesorería;
// /api/finanzas/cheques/listado; reglas en app/lib/finanzasEcheqListado.js;
// migración 189).
//
// Se sube el listado de e-cheq que baja el banco. Gypi separa emitidos y
// recibidos por la cuenta del emisor, busca cada cheque por su Id. o por
// número y monto, y muestra qué cambia, qué se suma y qué ya estaba. Vos
// elegís y confirmás. Subir el mismo listado otra vez no repite nada.
import { useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { plata } from "../lib/finanzasOperaciones";
import { planListado, resumenListado } from "../lib/finanzasEcheqListado";
import { Modal, Spinner } from "./ui";
import { useToast } from "./ui/Toast";

const fechaCorta = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}` : "");
const GRUPOS = [
  { que: "cambia", titulo: "🔄 Cambian", elegible: true },
  { que: "nuevo", titulo: "＋ Se suman (sin movimiento)", elegible: true },
  { que: "no", titulo: "⚠ Para hacer a mano", elegible: false },
  { que: "igual", titulo: "✓ Ya estaban igual", elegible: false },
];
const MAX_VER = 300;

export default function ListadoEcheq({ onCerrar, onAplicado }) {
  const toast = useToast();
  const [leyendo, setLeyendo] = useState(false);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [cuentaPropia, setCuentaPropia] = useState("");
  const [cuit, setCuit] = useState("");
  const [banco, setBanco] = useState("");
  const [fuera, setFuera] = useState(() => new Set());
  const [abiertos, setAbiertos] = useState(() => new Set(["cambia", "no"]));
  const [guardando, setGuardando] = useState(false);

  async function subir(file) {
    if (!file) return;
    setError(null);
    setLeyendo(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await apiFetch("/api/finanzas/cheques/listado", { method: "POST", body: form });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo leer el listado");
      setDatos(d);
      setCuentaPropia(d.cuenta_propia || "");
      setCuit(d.cuit_empresa || "");
      setBanco(d.cuenta_banco || "");
      setFuera(new Set());
    } catch (e) {
      setError(e.message);
    }
    setLeyendo(false);
  }

  const plan = useMemo(
    () => (datos ? planListado(datos.cheques, datos.gypi, { cuentaPropia, cuitEmpresa: cuit, proveedores: datos.proveedores }).filas : []),
    [datos, cuentaPropia, cuit],
  );
  const resumen = resumenListado(plan);
  const elegidos = plan.filter((f) => (f.que === "cambia" || f.que === "nuevo") && !fuera.has(f.c.id_banco));
  const alternar = (id) => setFuera((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const alternarGrupo = (que) => setAbiertos((s) => { const n = new Set(s); if (n.has(que)) n.delete(que); else n.add(que); return n; });

  async function aplicar() {
    setError(null);
    setGuardando(true);
    try {
      const r = await apiFetch("/api/finanzas/cheques/listado", {
        method: "POST",
        body: JSON.stringify({ accion: "aplicar", cheques: datos.cheques, cuenta_propia: cuentaPropia, cuit_empresa: cuit, cuenta_banco: banco, elegidos: elegidos.map((f) => f.c.id_banco) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo poner al día");
      toast.success(`✅ ${d.cambiados} cheques cambiados${d.unidos_al_banco ? ` (${d.unidos_al_banco} unidos al movimiento del banco)` : ""}, ${d.sumados} sumados${d.solo_id ? `, ${d.solo_id} unidos con el banco` : ""}`);
      if (d.errores?.length) toast.error(d.errores.slice(0, 3).join(" · "));
      onAplicado();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  const quien = (f) => (f.clase === "propio" ? f.c.beneficiario : `de la cuenta ${f.c.cuenta_emisor}${f.c.endosado_a ? ` · endosado a ${f.c.endosado_a}` : ""}`);
  const etiqueta = "flex flex-col gap-1 text-[13px] font-semibold text-gypi-text";

  return (
    <Modal open onClose={onCerrar} title="📥 Listado de e-cheq del banco" maxWidth={820}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        {!datos && (
          <>
            <p className="m-0">Subí el listado de e-cheq que baja el banco (emitidos y recibidos). Gypi pone al día cada cheque: qué se debitó, qué se depositó, qué se endosó a un proveedor y qué volvió rechazado. Antes de guardar ves todo.</p>
            <label className={`g-btn g-btn-primary self-start ${leyendo ? "opacity-60" : "cursor-pointer"}`}>
              📄 Elegir el listado
              <input type="file" className="sr-only" accept=".xls,.xlsx,.csv" aria-label="Archivo del listado" disabled={leyendo} onChange={(e) => subir(e.target.files?.[0])} />
            </label>
            {leyendo && <p className="m-0 flex items-center gap-2 text-gypi-dim"><Spinner /> Leyendo el listado…</p>}
          </>
        )}
        {datos && (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className={etiqueta}>Tu cuenta (la que emite)
                <select className="g-input w-full" value={cuentaPropia} onChange={(e) => setCuentaPropia(e.target.value)} aria-label="Tu cuenta">
                  {datos.cuentas_emisoras.map((c) => <option key={c.cuenta} value={c.cuenta}>{c.cuenta} ({c.cantidad})</option>)}
                </select>
              </label>
              <label className={etiqueta}>Banco en Gypi
                <select className="g-input w-full" value={banco} onChange={(e) => setBanco(e.target.value)} aria-label="Banco en Gypi">
                  <option value="">Elegí…</option>
                  {datos.bancos.map((b) => <option key={b.cuenta} value={b.cuenta}>{b.nombre}</option>)}
                </select>
              </label>
              <label className={etiqueta}>CUIT de tu empresa
                <input className="g-input w-full" value={cuit} onChange={(e) => setCuit(e.target.value)} placeholder="30-12345678-9" aria-label="CUIT de tu empresa" />
              </label>
            </div>
            {!cuit && <p className="m-0 text-[13px] text-gypi-amber-ink">Poné el CUIT de tu empresa: así Gypi sabe qué cheques recibidos endosaste a un proveedor.</p>}
            <p className="m-0">
              {datos.cheques.length} cheques: <b>{resumen.propio} emitidos</b> y <b>{resumen.tercero} recibidos</b> · 🔄 {resumen.cambia} cambian · ＋ {resumen.nuevo} se suman · ✓ {resumen.igual} ya estaban
              {resumen.no > 0 && <> · <span className="text-gypi-amber-ink">⚠ {resumen.no} a mano</span></>}
            </p>
            <p className="m-0 text-[12px] text-gypi-dim">
              Los que se suman entran sin movimiento, como lo copiado del libro: lo que ya se pagó o cobró ya está en tus movimientos. Cuando un débito o un depósito ya está en el banco (del extracto), se une al cheque en vez de cargarse otra vez.
            </p>
            {GRUPOS.map(({ que, titulo, elegible }) => {
              const del = plan.filter((f) => f.que === que);
              if (!del.length) return null;
              return (
                <section key={que} aria-label={titulo} className="rounded-lg border border-gypi-border">
                  <button type="button" className="w-full flex justify-between items-center px-3 py-2 bg-transparent border-0 cursor-pointer text-left font-semibold text-gypi-text" onClick={() => alternarGrupo(que)}>
                    <span>{titulo} ({del.length})</span><span aria-hidden>{abiertos.has(que) ? "▲" : "▼"}</span>
                  </button>
                  {abiertos.has(que) && (
                    <ul className="list-none m-0 px-3 pb-2 flex flex-col gap-1 text-[13px]">
                      {del.slice(0, MAX_VER).map((f) => (
                        <li key={f.c.id_banco} className="flex items-start gap-2 border-t border-gypi-border pt-1">
                          {elegible && <input type="checkbox" className="mt-0.5" aria-label={`Cheque ${f.c.numero}`} checked={!fuera.has(f.c.id_banco)} onChange={() => alternar(f.c.id_banco)} />}
                          <span className="flex-1 min-w-0 break-words">
                            <span className="font-mono">N° {f.c.numero}</span> · {f.clase === "propio" ? "emitido" : "recibido"} · <b className="font-mono">{plata(f.c.monto, "ARS")}</b> · paga {fechaCorta(f.c.fecha_pago)} · {quien(f)}
                            <span className="block text-gypi-dim">{f.texto}</span>
                          </span>
                        </li>
                      ))}
                      {del.length > MAX_VER && <li className="text-gypi-dim">Y {del.length - MAX_VER} más.</li>}
                    </ul>
                  )}
                </section>
              );
            })}
          </>
        )}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {datos && <button type="button" className="g-btn g-btn-secondary" onClick={() => setDatos(null)}>Subir otro</button>}
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cerrar</button>
          {datos && (
            <button type="button" className="g-btn g-btn-primary" disabled={guardando || !elegidos.length || !banco} onClick={aplicar}>
              {guardando ? "Guardando…" : `Poner al día ${elegidos.length} cheques`}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
