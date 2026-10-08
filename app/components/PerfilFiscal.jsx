"use client";
// Datos de facturación de la empresa (ítem 26): obligatorios para contratar un plan.
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { CONDICIONES_IVA, formatearCuit, validarPerfilFiscal } from "../lib/perfilFiscal";

export default function PerfilFiscal({ abiertoAlInicio = false, onCompleto }) {
  const [perfil, setPerfil] = useState(null);
  const [editando, setEditando] = useState(abiertoAlInicio);
  const [form, setForm] = useState({ razon_social: "", cuit: "", condicion_iva: "", domicilio_fiscal: "" });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/api/billing/perfil-fiscal", { method: "GET" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return;
        setPerfil(d);
        setForm({ razon_social: d.razon_social || "", cuit: d.cuit ? formatearCuit(d.cuit) : "", condicion_iva: d.condicion_iva || "", domicilio_fiscal: d.domicilio_fiscal || "" });
        if (!d.completo) setEditando(true);
      })
      .catch(() => {});
  }, []);

  useEffect(() => { if (abiertoAlInicio) setEditando(true); }, [abiertoAlInicio]);

  const guardar = async (e) => {
    e.preventDefault();
    const v = validarPerfilFiscal(form);
    if (!v.ok) { setError(v.error); return; }
    setGuardando(true);
    setError("");
    try {
      const r = await apiFetch("/api/billing/perfil-fiscal", { method: "PUT", body: JSON.stringify(v.perfil) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo guardar");
      setPerfil(d);
      setEditando(false);
      onCompleto?.();
    } catch (err) {
      setError(err.message);
    }
    setGuardando(false);
  };

  const campo = (k) => ({ value: form[k], onChange: (e) => setForm((f) => ({ ...f, [k]: e.target.value })) });

  return (
    <section aria-label="Datos de facturación" className="bg-gypi-surface rounded-[14px] border border-gypi-border p-4 mb-4">
      <div className="flex justify-between items-center mb-2">
        <div className="text-xs text-gypi-dim font-semibold tracking-wide">DATOS DE FACTURACIÓN</div>
        {!editando && perfil?.completo && (
          <button onClick={() => setEditando(true)} className="text-xs font-bold text-gypi-amber bg-transparent border-none cursor-pointer">Cambiar</button>
        )}
      </div>
      {!editando && perfil?.completo && (
        <div className="text-[13px] text-gypi-text">
          <div className="font-semibold">{perfil.razon_social}</div>
          <div className="text-gypi-dim text-xs mt-0.5">CUIT {formatearCuit(perfil.cuit)} · {CONDICIONES_IVA[perfil.condicion_iva]?.nombre}</div>
          <div className="text-gypi-dim text-xs">{perfil.domicilio_fiscal}</div>
        </div>
      )}
      {editando && (
        <form onSubmit={guardar} className="flex flex-col gap-2">
          <p className="text-xs text-gypi-dim m-0">La Factura C sale a nombre de tu empresa con estos datos (como figuran en ARCA).</p>
          <label className="text-xs text-gypi-dim">Razón social<input {...campo("razon_social")} className="g-input w-full mt-1" maxLength={120} /></label>
          <label className="text-xs text-gypi-dim">CUIT<input {...campo("cuit")} className="g-input w-full mt-1" inputMode="numeric" placeholder="30-12345678-9" maxLength={13} /></label>
          <label className="text-xs text-gypi-dim">Condición frente al IVA
            <select {...campo("condicion_iva")} className="g-input w-full mt-1">
              <option value="">Elegí una</option>
              {Object.entries(CONDICIONES_IVA).map(([k, c]) => <option key={k} value={k}>{c.nombre}</option>)}
            </select>
          </label>
          <label className="text-xs text-gypi-dim">Domicilio fiscal<input {...campo("domicilio_fiscal")} className="g-input w-full mt-1" maxLength={200} /></label>
          {error && <div role="alert" className="text-xs text-gypi-red">{error}</div>}
          <button type="submit" disabled={guardando} className="g-btn g-btn-primary mt-1">{guardando ? "Guardando…" : "Guardar datos de facturación"}</button>
        </form>
      )}
    </section>
  );
}
