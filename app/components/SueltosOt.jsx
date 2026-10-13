'use client';
// app/components/SueltosOt.jsx — Hoja de sueltos y herrajes de una OT
// (Órdenes de Producción, parte 9; ítem 39). Técnica la carga (a mano o
// pegando las filas desde Excel) y en acopio y en la carga se tilda cada ítem.
import { useCallback, useEffect, useState } from "react";
import { apiFetch, sb } from "../lib/supabase";
import { TIPOS_SUELTO, LIMITES, parsearPegado, resumenSueltos, nombreSuelto } from "../lib/sueltos";

const VACIO = { tipo: "", codigo: "", descripcion: "", medida: "", cantidad: "1", va_con: "" };

function Tilde({ activo, onClick, label, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-pressed={activo} aria-label={label}
      className={`min-h-[44px] px-2.5 rounded-lg border text-[11px] font-bold cursor-pointer ${activo ? "bg-gypi-green/15 border-gypi-green text-gypi-green" : "bg-transparent border-gypi-border text-gypi-dim"}`}>
      {activo ? "✓ " : ""}{label.split(" ")[0]}
    </button>
  );
}

export default function SueltosOt({ proyecto, empresaId, esGestion = false, onClose }) {
  const [items, setItems] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [modo, setModo] = useState(null); // null | "pegar" | "uno"
  const [pegado, setPegado] = useState("");
  const [nuevo, setNuevo] = useState(VACIO);
  const [confirmar, setConfirmar] = useState(null); // id a borrar o "vaciar"

  const ot = proyecto?.ot;
  const cargar = useCallback(async () => {
    if (!ot || !empresaId) return;
    try {
      const filas = await sb.get(`sueltos_ot?empresa_id=eq.${empresaId}&ot=eq.${encodeURIComponent(ot)}&order=orden.asc,id.asc&select=*`);
      setItems(filas || []);
      setAviso(null);
    } catch {
      setItems([]);
      setAviso("No se pudo leer la hoja de sueltos (¿falta correr la migración 103?).");
    }
  }, [ot, empresaId]);

  useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect

  const enviar = async (body) => {
    setGuardando(true);
    setError(null);
    try {
      const r = await apiFetch("/api/sueltos", { method: "POST", body: JSON.stringify(body) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "No se pudo guardar");
      return data;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setGuardando(false);
    }
  };

  const tildar = async (item, columna) => {
    const valor = !item[columna];
    const data = await enviar({ accion: "tildar", id: item.id, columna, valor });
    if (data) setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, [columna]: valor, ...(data.suelto || {}) } : i)));
  };

  const agregar = async (lista) => {
    const data = await enviar({ accion: "agregar", ot: String(ot), items: lista });
    if (!data) return;
    setItems((prev) => [...prev, ...(data.sueltos || [])]);
    setModo(null);
    setPegado("");
    setNuevo(VACIO);
  };

  const borrar = async (id) => {
    setConfirmar(null);
    if (id === "vaciar") {
      if (await enviar({ accion: "vaciar", ot: String(ot) })) setItems([]);
      return;
    }
    if (await enviar({ accion: "borrar", id })) setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const vista = modo === "pegar" && pegado.trim() ? parsearPegado(pegado) : null;
  const cantNuevo = Number(String(nuevo.cantidad).replace(",", "."));
  const nuevoValido = (nuevo.codigo.trim() || nuevo.descripcion.trim()) && cantNuevo > 0 && cantNuevo <= 99999;
  const res = resumenSueltos(items || []);

  return (
    <div className="fixed inset-0 z-200 flex items-end justify-center" role="dialog" aria-label={`Sueltos de la OT ${ot}`}>
      <div onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-[560px] bg-gypi-bg rounded-t-[20px] p-[20px_18px_30px] max-h-[90vh] overflow-y-auto border border-gypi-border text-gypi-text">
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="g-overline text-gypi-amber-ink">Orden {ot} · Sueltos y herrajes</div>
            <h3 className="m-0 font-heading text-lg font-bold truncate">{proyecto?.cliente || proyecto?.proyecto || "—"}</h3>
            {items && res.total > 0 && (
              <div className="text-xs text-gypi-dim mt-0.5">{res.total === 1 ? "1 ítem" : `${res.total} ítems`} · Acopio {res.acopio} de {res.total} · Carga {res.carga} de {res.total}</div>
            )}
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="min-w-[44px] min-h-[44px] bg-transparent border-none text-2xl cursor-pointer text-gypi-text">✕</button>
        </div>

        <div className="text-[12px] text-gypi-dim mb-3">Todo lo que viaja fuera de un módulo: maderas sueltas, perfiles, herrajes y accesorios que van a obra. Se tilda en acopio y al cargar el camión.</div>
        {aviso && <div role="alert" className="text-[12px] text-gypi-red mb-2.5">{aviso}</div>}
        {error && <div role="alert" className="text-[12px] text-gypi-red mb-2.5">{error}</div>}

        {!items ? (
          <div className="gypi-dots py-6" role="status" aria-label="Cargando"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>
        ) : items.length === 0 ? (
          <div className="text-sm text-gypi-dim py-3">Esta OT todavía no tiene sueltos cargados.</div>
        ) : (
          <ul aria-label="Ítems sueltos" className="list-none p-0 m-0 mb-3 flex flex-col gap-1.5">
            {items.map((i) => (
              <li key={i.id} className="bg-gypi-surface rounded-xl p-2.5 border border-gypi-border">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold">{nombreSuelto(i)}</div>
                    <div className="text-[11px] text-gypi-dim">
                      {[i.tipo, i.medida, `Cant. ${Number(i.cantidad).toLocaleString("es-AR")}`, i.va_con && `Va con ${i.va_con}`].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  {esGestion && (confirmar === i.id ? (
                    <button onClick={() => borrar(i.id)} disabled={guardando} className="min-h-[44px] px-2.5 rounded-lg border border-gypi-red bg-gypi-red/10 text-gypi-red text-[11px] font-bold cursor-pointer">Sí, sacar</button>
                  ) : (
                    <button onClick={() => setConfirmar(i.id)} aria-label={`Sacar ${nombreSuelto(i)}`} className="min-w-[44px] min-h-[44px] rounded-lg border border-gypi-border bg-transparent text-gypi-red text-sm cursor-pointer">🗑</button>
                  ))}
                </div>
                <div className="flex gap-1.5 mt-1.5">
                  <Tilde activo={i.acopio} disabled={guardando} onClick={() => tildar(i, "acopio")} label={`Acopio ${nombreSuelto(i)}`} />
                  <Tilde activo={i.carga} disabled={guardando} onClick={() => tildar(i, "carga")} label={`Carga ${nombreSuelto(i)}`} />
                </div>
              </li>
            ))}
          </ul>
        )}

        {esGestion && items && (
          modo === "pegar" ? (
            <section aria-label="Pegar desde Excel" className="g-card mb-3">
              <label htmlFor="sueltos-pegar" className="g-label mb-1 block">Pegar desde Excel</label>
              <div className="text-[11px] text-gypi-dim mb-1.5">Copiá las filas en el Excel (con o sin títulos) y pegalas acá. Columnas: Tipo, Código, Descripción, Medida, Cant., Va con.</div>
              <textarea id="sueltos-pegar" className="g-input w-full min-h-[110px] font-mono text-[12px]" value={pegado} onChange={(e) => setPegado(e.target.value)} placeholder={"Madera\tAJ.1\tAjuste grafito\t810 × 70\t1\tZona alacenas"} />
              {vista && (
                <div className="mt-2">
                  <div className="text-[12px] font-bold mb-1">
                    {vista.items.length === 1 ? "1 ítem para agregar" : `${vista.items.length} ítems para agregar`}{vista.conTitulos ? " (con títulos)" : ""}
                  </div>
                  {vista.items.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px] border-collapse">
                        <thead><tr className="text-gypi-dim text-left">{["Tipo", "Código", "Descripción", "Medida", "Cant.", "Va con"].map((t) => <th key={t} className="p-1 font-bold">{t}</th>)}</tr></thead>
                        <tbody>
                          {vista.items.map((i, n) => (
                            <tr key={n} className="border-t border-gypi-border">
                              <td className="p-1">{i.tipo || "—"}</td><td className="p-1">{i.codigo || "—"}</td><td className="p-1">{i.descripcion || "—"}</td>
                              <td className="p-1">{i.medida || "—"}</td><td className="p-1">{i.cantidad.toLocaleString("es-AR")}</td><td className="p-1">{i.va_con || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {vista.errores.map((e) => <div key={e.fila} className="text-[11px] text-gypi-red">Fila {e.fila}: {e.motivo}. No se agrega.</div>)}
                </div>
              )}
              <div className="flex gap-2 mt-2.5">
                <button onClick={() => { setModo(null); setPegado(""); }} className="g-btn g-btn-secondary flex-1">Cancelar</button>
                <button onClick={() => agregar(vista.items)} disabled={guardando || !vista?.items.length} className="g-btn g-btn-primary flex-1">
                  {guardando ? "Guardando…" : vista?.items.length ? `Agregar ${vista.items.length}` : "Agregar"}
                </button>
              </div>
            </section>
          ) : modo === "uno" ? (
            <section aria-label="Agregar un ítem" className="g-card mb-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] text-gypi-dim">Tipo
                  <input className="g-input w-full" list="tipos-suelto" value={nuevo.tipo} maxLength={LIMITES.tipo} onChange={(e) => setNuevo({ ...nuevo, tipo: e.target.value })} />
                </label>
                <label className="text-[11px] text-gypi-dim">Código
                  <input className="g-input w-full" value={nuevo.codigo} maxLength={LIMITES.codigo} onChange={(e) => setNuevo({ ...nuevo, codigo: e.target.value })} />
                </label>
                <label className="text-[11px] text-gypi-dim col-span-2">Descripción
                  <input className="g-input w-full" value={nuevo.descripcion} maxLength={LIMITES.descripcion} onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })} />
                </label>
                <label className="text-[11px] text-gypi-dim">Medida
                  <input className="g-input w-full" value={nuevo.medida} maxLength={LIMITES.medida} onChange={(e) => setNuevo({ ...nuevo, medida: e.target.value })} />
                </label>
                <label className="text-[11px] text-gypi-dim">Cant.
                  <input className="g-input w-full" inputMode="decimal" value={nuevo.cantidad} onChange={(e) => setNuevo({ ...nuevo, cantidad: e.target.value })} />
                </label>
                <label className="text-[11px] text-gypi-dim col-span-2">Va con
                  <input className="g-input w-full" value={nuevo.va_con} maxLength={LIMITES.va_con} onChange={(e) => setNuevo({ ...nuevo, va_con: e.target.value })} placeholder="Ej: Isla, Zona alacenas, 2.GB2P" />
                </label>
              </div>
              <datalist id="tipos-suelto">{TIPOS_SUELTO.map((t) => <option key={t} value={t} />)}</datalist>
              <div className="flex gap-2 mt-2.5">
                <button onClick={() => { setModo(null); setNuevo(VACIO); }} className="g-btn g-btn-secondary flex-1">Cancelar</button>
                <button disabled={guardando || !nuevoValido} className="g-btn g-btn-primary flex-1"
                  onClick={() => agregar([{
                    tipo: nuevo.tipo.trim() || null, codigo: nuevo.codigo.trim() || null, descripcion: nuevo.descripcion.trim() || null,
                    medida: nuevo.medida.trim() || null, cantidad: Math.round(cantNuevo * 100) / 100, va_con: nuevo.va_con.trim() || null,
                  }])}>
                  {guardando ? "Guardando…" : "Agregar"}
                </button>
              </div>
            </section>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <button onClick={() => setModo("pegar")} className="g-btn g-btn-primary flex-1">📋 Pegar desde Excel</button>
                <button onClick={() => setModo("uno")} className="g-btn g-btn-secondary flex-1">＋ Agregar uno</button>
              </div>
              {items.length > 0 && (confirmar === "vaciar" ? (
                <button onClick={() => borrar("vaciar")} disabled={guardando} className="min-h-[44px] rounded-lg border border-gypi-red bg-gypi-red/10 text-gypi-red text-xs font-bold cursor-pointer">Sí, borrar toda la hoja</button>
              ) : (
                <button onClick={() => setConfirmar("vaciar")} className="min-h-[44px] rounded-lg border-none bg-transparent text-gypi-red text-xs cursor-pointer">Borrar toda la hoja (se pegó mal)</button>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
