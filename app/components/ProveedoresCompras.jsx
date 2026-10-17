'use client';
// app/components/ProveedoresCompras.jsx — Planta → Compras → Proveedores
// (Compras, parte 20; ítem 41). Administración y gerencia cargan los datos de
// cada proveedor (CUIT, contacto, WhatsApp, email, plazo, condición de pago).
// Para no arrancar de cero se pega la lista de TABLAS → PROVEEDORES de la
// planilla MRP. Un proveedor que ya no se usa se da de baja, no se borra.
import { useCallback, useEffect, useMemo, useState } from "react";
import { sbGetAll, apiFetch } from "../lib/supabase";
import { leerListaProveedores, numeroWhatsapp } from "../lib/compras";

const VACIO = { id: null, nombre: "", cuit: "", contacto: "", whatsapp: "", email: "", plazo_dias: "", condicion_pago: "", notas: "" };
const MOSTRAR = 100;

async function postCompras(body) {
  const res = await apiFetch("/api/compras", { method: "POST", body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo guardar");
  return data;
}

export default function ProveedoresCompras({ empresaId }) {
  const [lista, setLista] = useState(null);
  const [texto, setTexto] = useState("");
  const [verBajas, setVerBajas] = useState(false);
  const [form, setForm] = useState(null);
  const [importar, setImportar] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => {
    if (!empresaId) return;
    try {
      const { data } = await sbGetAll("proveedores?order=nombre.asc", { maxFilas: 5000 });
      setLista(data || []);
    } catch (e) {
      setLista([]);
      setError(String(e?.message).includes("proveedores") ? "Para usar Compras falta correr la migración 113 en Supabase." : "No se pudieron leer los proveedores");
    }
  }, [empresaId]);
  useEffect(() => { cargar(); }, [cargar]);

  const visibles = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return (lista || []).filter((p) => (verBajas ? !p.activo : p.activo) &&
      (!t || [p.nombre, p.cuit, p.contacto, p.email].some((v) => String(v ?? "").toLowerCase().includes(t))));
  }, [lista, texto, verBajas]);
  const nombresImportar = useMemo(() => (importar === null ? [] : leerListaProveedores(importar)), [importar]);
  const cambiar = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  const guardar = async () => {
    if (!form.nombre.trim()) { setError("Poné el nombre del proveedor"); return; }
    const plazo = form.plazo_dias === "" || form.plazo_dias === null ? null : Number(form.plazo_dias);
    if (plazo !== null && !(Number.isInteger(plazo) && plazo >= 0 && plazo <= 365)) { setError("El plazo va en días, de 0 a 365"); return; }
    const vacioANull = (v) => (String(v ?? "").trim() ? String(v).trim() : null);
    setEnviando(true);
    setError(null);
    try {
      await postCompras({
        accion: "proveedor_guardar",
        ...(form.id ? { id: form.id } : {}),
        nombre: form.nombre.trim(),
        cuit: vacioANull(form.cuit),
        contacto: vacioANull(form.contacto),
        whatsapp: vacioANull(form.whatsapp),
        email: vacioANull(form.email),
        plazo_dias: plazo,
        condicion_pago: vacioANull(form.condicion_pago),
        notas: vacioANull(form.notas),
      });
      setForm(null);
      await cargar();
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  const darDeBaja = async (p, activo) => {
    setError(null);
    try {
      await postCompras({ accion: "proveedor_baja", id: p.id, activo });
      await cargar();
    } catch (e) {
      setError(e.message);
    }
  };

  const confirmarImportar = async () => {
    if (!nombresImportar.length) { setError("Pegá al menos un nombre"); return; }
    setEnviando(true);
    setError(null);
    try {
      const data = await postCompras({ accion: "proveedores_importar", nombres: nombresImportar });
      setImportar(null);
      setAviso(`Agregué ${data.agregados} proveedor${data.agregados === 1 ? "" : "es"}${data.ya_estaban ? ` (${data.ya_estaban} ya estaban)` : ""}.`);
      await cargar();
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  if (form) {
    return (
      <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
        <div className="text-[15px] font-bold mb-2">{form.id ? "Editar proveedor" : "Nuevo proveedor"}</div>
        <label className="g-label" htmlFor="prov-nombre">Nombre</label>
        <input id="prov-nombre" className="g-input w-full mb-2" value={form.nombre} onChange={cambiar("nombre")} maxLength={120} />
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="g-label" htmlFor="prov-cuit">CUIT</label>
            <input id="prov-cuit" className="g-input w-full mb-2" inputMode="numeric" value={form.cuit} onChange={cambiar("cuit")} maxLength={20} placeholder="20-12345678-9" />
          </div>
          <div className="flex-1">
            <label className="g-label" htmlFor="prov-contacto">Contacto</label>
            <input id="prov-contacto" className="g-input w-full mb-2" value={form.contacto} onChange={cambiar("contacto")} maxLength={120} placeholder="Nombre de quien atiende" />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="g-label" htmlFor="prov-whatsapp">WhatsApp</label>
            <input id="prov-whatsapp" className="g-input w-full mb-2" inputMode="tel" value={form.whatsapp} onChange={cambiar("whatsapp")} maxLength={30} placeholder="11 2345 6789" />
          </div>
          <div className="flex-1">
            <label className="g-label" htmlFor="prov-email">Email</label>
            <input id="prov-email" type="email" className="g-input w-full mb-2" value={form.email} onChange={cambiar("email")} maxLength={160} />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="g-label" htmlFor="prov-plazo">Plazo de entrega (días)</label>
            <input id="prov-plazo" className="g-input w-full mb-2" inputMode="numeric" value={form.plazo_dias ?? ""} onChange={cambiar("plazo_dias")} />
          </div>
          <div className="flex-1">
            <label className="g-label" htmlFor="prov-pago">Condición de pago</label>
            <input id="prov-pago" className="g-input w-full mb-2" value={form.condicion_pago} onChange={cambiar("condicion_pago")} maxLength={120} placeholder="Ej: 30 días, contado" />
          </div>
        </div>
        <label className="g-label" htmlFor="prov-notas">Notas</label>
        <input id="prov-notas" className="g-input w-full mb-3" value={form.notas} onChange={cambiar("notas")} maxLength={300} />
        {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
        <div className="flex gap-2">
          <button onClick={() => { setForm(null); setError(null); }} className="g-btn g-btn-secondary flex-1">Cancelar</button>
          <button onClick={guardar} disabled={enviando} className="g-btn g-btn-primary flex-1">{enviando ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>
    );
  }

  if (importar !== null) {
    return (
      <div className="p-3 mb-3 rounded-[10px] border border-gypi-border bg-gypi-surface">
        <div className="text-[15px] font-bold mb-1">Traer proveedores de la planilla</div>
        <div className="text-[13px] text-gypi-dim mb-2">En la planilla MRP, hoja TABLAS, copiá la columna PROVEEDORES y pegala acá. Los que ya están no se repiten.</div>
        <textarea aria-label="Lista de proveedores" className="g-input w-full mb-2 min-h-[160px]" value={importar} onChange={(e) => setImportar(e.target.value)} />
        <div className="text-[13px] mb-2" role="status">{nombresImportar.length} nombre{nombresImportar.length === 1 ? "" : "s"} para agregar</div>
        {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
        <div className="flex gap-2">
          <button onClick={() => { setImportar(null); setError(null); }} className="g-btn g-btn-secondary flex-1">Cancelar</button>
          <button onClick={confirmarImportar} disabled={enviando} className="g-btn g-btn-primary flex-1">{enviando ? "Agregando…" : "Agregar"}</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <button onClick={() => { setForm({ ...VACIO }); setError(null); setAviso(null); }} className="g-btn g-btn-primary flex-1">＋ Nuevo proveedor</button>
        <button onClick={() => { setImportar(""); setError(null); setAviso(null); }} className="g-btn g-btn-secondary flex-1">📋 Traer de la planilla</button>
      </div>
      {aviso && <div role="status" className="text-[13px] mb-2">✅ {aviso}</div>}
      <div className="flex gap-2 mb-2 items-center">
        <input aria-label="Buscar proveedor" className="g-input flex-1 min-w-0" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar nombre, CUIT o contacto" />
        <label className="flex items-center gap-1 text-[13px] text-gypi-dim min-h-[44px]">
          <input type="checkbox" checked={verBajas} onChange={(e) => setVerBajas(e.target.checked)} /> Dados de baja
        </label>
      </div>
      {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}

      {lista === null ? (
        <div className="text-[14px] text-gypi-dim" role="status">Cargando proveedores…</div>
      ) : !visibles.length ? (
        <div className="text-[14px] text-gypi-dim">
          {lista.length ? "No hay proveedores con ese filtro." : "Todavía no hay proveedores. Traelos de la planilla para no cargarlos de cero."}
        </div>
      ) : (
        <>
          <ul aria-label="Proveedores" className="list-none m-0 p-0 flex flex-col gap-1.5">
            {visibles.slice(0, MOSTRAR).map((p) => {
              const wa = numeroWhatsapp(p.whatsapp);
              const datos = [p.contacto, p.cuit ? `CUIT ${p.cuit}` : null, p.plazo_dias != null ? `${p.plazo_dias} días` : null, p.condicion_pago].filter(Boolean);
              return (
                <li key={p.id} className="flex items-center gap-2 p-2 rounded-[10px] border border-gypi-border bg-gypi-surface">
                  <button onClick={() => { setForm({ ...VACIO, ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v ?? ""])), id: p.id }); setError(null); setAviso(null); }}
                    aria-label={`Editar ${p.nombre}`} className="flex-1 min-w-0 min-h-[44px] text-left bg-transparent border-none p-0 cursor-pointer font-body text-gypi-text">
                    <div className="text-[14px] font-semibold truncate">{p.nombre}</div>
                    <div className="text-[12px] text-gypi-dim truncate">{datos.length ? datos.join(" · ") : "Sin datos todavía. Tocá para completar."}</div>
                  </button>
                  {wa && (
                    <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp de ${p.nombre}`}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[18px] no-underline">💬</a>
                  )}
                  <button onClick={() => darDeBaja(p, !p.activo)} aria-label={`${p.activo ? "Dar de baja" : "Reactivar"} ${p.nombre}`}
                    className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-dim cursor-pointer">{p.activo ? "Baja" : "Reactivar"}</button>
                </li>
              );
            })}
          </ul>
          {visibles.length > MOSTRAR && <div className="text-[12px] text-gypi-dim mt-2">Mostrando {MOSTRAR} de {visibles.length}. Buscá para ver el resto.</div>}
        </>
      )}
    </div>
  );
}
