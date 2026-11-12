'use client';
// app/components/FinanzasConfig.jsx — Finanzas → 🧾 Configuración (parte F1a;
// migración 171; /api/finanzas; app/lib/finanzas.js).
//
// Plan de cuentas, tipos de operación, cajas y bancos y centros de costo.
// Se copian una sola vez del libro contable: en Google Sheets, Archivo →
// Descargar → Microsoft Excel, y se sube acá. Gypi lee las hojas en el
// navegador, muestra qué va a copiar (con avisos) y sugiere cuentas para los
// tipos de operación que no tienen, con lo que más se usó en T-OPERACIONES.
// Después cada fila se puede corregir o se pueden sumar nuevas.
// Solo el rol Dueño (la pantalla ni aparece para los demás).
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import FinanzasLibroScript from "./FinanzasLibroScript";
import FinanzasHistorico from "./FinanzasHistorico";
import FinanzasTipos from "./FinanzasTipos";
import { HOJA_FLUJO, HOJA_OPERACIONES, TABLAS_FIN, TIPOS_TESORERIA, leerLibro } from "../lib/finanzas";
import { Chip, Modal, SelectBuscable, Spinner } from "./ui";
import { useToast } from "./ui/Toast";
import { leyendaTipo } from "../lib/finanzasTipos";

const ORDEN_COPIA = ["cuentas", "tesoreria", "centros", "tipos"];
const HOJAS_LIBRO = [...Object.values(TABLAS_FIN).map((t) => t.hoja), HOJA_OPERACIONES, HOJA_FLUJO];
const normal = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function leerExcel(file) {
  const { hojasXlsx, leerHojaXlsx } = await import("../lib/leerXlsx");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const nombres = hojasXlsx(bytes).filter((n) => HOJAS_LIBRO.some((h) => normal(h) === normal(n)));
  return nombres.map((nombre) => ({ nombre, grilla: leerHojaXlsx(bytes, nombre, { maxFilas: 40000, maxCols: 30 }) || [] }));
}

async function postFin(body) {
  const res = await apiFetch("/api/finanzas", { method: "POST", body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "No se pudo guardar");
  return d;
}

/** "01.01.01.003.002 · Banco Credicoop CTA CTE" */
function textoCuenta(codigo, nombres) {
  if (!codigo) return "—";
  return nombres.get(codigo) ? `${codigo} · ${nombres.get(codigo)}` : codigo;
}

/* ─── Copiar desde el libro ──────────────────────────────────────────── */

function CopiarLibro({ nombres, onCopiado }) {
  const toast = useToast();
  const [leyendo, setLeyendo] = useState(false);
  const [libro, setLibro] = useState(null);
  const [elegidas, setElegidas] = useState(new Set(ORDEN_COPIA));
  const [sugeridas, setSugeridas] = useState(new Set());
  const [copiando, setCopiando] = useState(null);
  const [conFlujo, setConFlujo] = useState(true);
  const tiposFlujo = libro?.flujo ? Object.keys(libro.flujo.tipos).length : 0;

  const abrir = async (file) => {
    if (!file) return;
    setLeyendo(true);
    try {
      const l = leerLibro(await leerExcel(file));
      if (l.faltan.length === ORDEN_COPIA.length) throw new Error("Ese archivo no tiene las hojas del libro (dim_plan_cuentas, dim_tipos_op, dim_tesoreria, dim_cc).");
      setLibro(l);
      setElegidas(new Set(ORDEN_COPIA.filter((t) => l[t].filas.length)));
      setSugeridas(new Set(l.sugerencias.map((s) => s.codigo)));
    } catch (e) {
      toast.error(e.message || "No pude leer el archivo");
    } finally {
      setLeyendo(false);
    }
  };

  // Para mostrar las sugerencias con nombre: las cuentas del libro, o las ya copiadas
  const nombresLibro = useMemo(() => new Map([...nombres, ...(libro?.cuentas.filas || []).map((c) => [c.codigo, c.nombre])]), [libro, nombres]);

  const copiar = async () => {
    try {
      for (const t of ORDEN_COPIA) {
        if (!elegidas.has(t)) continue;
        setCopiando(TABLAS_FIN[t].nombre);
        let filas = libro[t].filas;
        if (t === "tipos") {
          const sug = new Map(libro.sugerencias.filter((s) => sugeridas.has(s.codigo)).map((s) => [s.codigo, s]));
          filas = filas.map((f) => (sug.has(f.codigo) ? { ...f, cuenta_debe: sug.get(f.codigo).cuenta_debe, cuenta_haber: sug.get(f.codigo).cuenta_haber } : f));
        }
        await postFin({ accion: "importar", tabla: t, filas });
      }
      if (conFlujo && tiposFlujo) {
        setCopiando("Líneas del flujo de caja");
        const res = await apiFetch("/api/finanzas/flujo", { method: "POST", body: JSON.stringify({ accion: "lineas", ...libro.flujo }) });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || "No se pudieron guardar las líneas del flujo");
      }
      toast.success("✅ Listo: la configuración del libro quedó en Gypi");
      setLibro(null);
      onCopiado();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setCopiando(null);
    }
  };

  const alternar = (set, setter, k) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); setter(n); };

  return (
    <section className="g-card p-4 mb-3" aria-label="Copiar desde el libro">
      <h2 className="m-0 mb-1 text-[16px] font-bold text-gypi-text">📥 Copiar desde el libro</h2>
      <p className="m-0 mb-3 text-[13px] text-gypi-dim">
        En Google Sheets abrí el libro contable y andá a Archivo → Descargar → Microsoft Excel (.xlsx). Subí ese archivo acá: Gypi copia el plan de cuentas,
        los tipos de operación, las cajas y bancos y los centros de costo. Si una fila ya está, se actualiza; nada se borra.
      </p>
      <label className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-lg border border-gypi-border bg-gypi-surface cursor-pointer text-[14px] font-semibold text-gypi-text">
        {leyendo ? <Spinner size={16} /> : "📄"} {leyendo ? "Leyendo el libro…" : "Subir el libro (.xlsx)"}
        <input type="file" accept=".xlsx,.xlsm" className="sr-only" aria-label="Subir el libro contable" disabled={leyendo} onChange={(e) => { abrir(e.target.files?.[0]); e.target.value = ""; }} />
      </label>

      {libro && (
        <div className="mt-4">
          <h3 className="m-0 mb-2 text-[14px] font-bold text-gypi-text">Qué se va a copiar</h3>
          <ul className="list-none m-0 p-0 flex flex-col gap-2">
            {ORDEN_COPIA.map((t) => (
              <li key={t} className="rounded-lg border border-gypi-border p-3">
                <label className="flex items-center gap-2 text-[14px] text-gypi-text cursor-pointer">
                  <input type="checkbox" checked={elegidas.has(t)} disabled={!libro[t].filas.length} onChange={() => alternar(elegidas, setElegidas, t)} />
                  <span className="font-semibold">{TABLAS_FIN[t].nombre}</span>
                  <span className="text-gypi-dim">· {libro[t].filas.length} filas (hoja {TABLAS_FIN[t].hoja})</span>
                </label>
                {libro.faltan.includes(TABLAS_FIN[t].hoja) && <p className="m-0 mt-1 text-[13px] text-gypi-dim">El archivo no tiene esta hoja.</p>}
                {libro[t].avisos.length > 0 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[13px] text-gypi-dim">⚠ {libro[t].avisos.length} aviso(s)</summary>
                    <ul className="m-0 mt-1 pl-5 text-[13px] text-gypi-dim">{libro[t].avisos.map((a) => <li key={a}>{a}</li>)}</ul>
                  </details>
                )}
              </li>
            ))}
            {libro.flujo && (
              <li className="rounded-lg border border-gypi-border p-3">
                <label className="flex items-center gap-2 text-[14px] text-gypi-text cursor-pointer">
                  <input type="checkbox" checked={conFlujo && tiposFlujo > 0} disabled={!tiposFlujo} onChange={() => setConFlujo((x) => !x)} />
                  <span className="font-semibold">Líneas del flujo de caja</span>
                  <span className="text-gypi-dim">· {tiposFlujo} tipos (hoja {HOJA_FLUJO})</span>
                </label>
                {libro.flujo.avisos.length > 0 && <p className="m-0 mt-1 text-[13px] text-gypi-dim">⚠ {libro.flujo.avisos.join(" ")}</p>}
              </li>
            )}
          </ul>

          {elegidas.has("tipos") && (
            <div className="mt-4">
              <h3 className="m-0 mb-1 text-[14px] font-bold text-gypi-text">Cuentas sugeridas para los tipos que no tienen</h3>
              {libro.sugerencias.length ? (
                <>
                  <p className="m-0 mb-2 text-[13px] text-gypi-dim">
                    Para cada tipo, la cuenta del debe y del haber que más usaste en {HOJA_OPERACIONES}, sin contar Ajuste De Capital.
                    Destildá las que no quieras; se pueden cambiar después.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px] border-collapse">
                      <thead><tr className="text-left text-gypi-dim"><th className="p-1.5" scope="col">Usar</th><th className="p-1.5" scope="col">Tipo</th><th className="p-1.5" scope="col">Debe</th><th className="p-1.5" scope="col">Haber</th><th className="p-1.5" scope="col">Veces</th></tr></thead>
                      <tbody>
                        {libro.sugerencias.map((s) => (
                          <tr key={s.codigo} className="border-t border-gypi-border align-top">
                            <td className="p-1.5"><input type="checkbox" aria-label={`Usar la sugerencia de ${s.codigo}`} checked={sugeridas.has(s.codigo)} onChange={() => alternar(sugeridas, setSugeridas, s.codigo)} /></td>
                            <td className="p-1.5 font-semibold text-gypi-text">{s.codigo}</td>
                            <td className="p-1.5 text-gypi-text">{textoCuenta(s.cuenta_debe, nombresLibro)}</td>
                            <td className="p-1.5 text-gypi-text">{textoCuenta(s.cuenta_haber, nombresLibro)}</td>
                            <td className="p-1.5 text-gypi-dim whitespace-nowrap">{s.veces} de {s.de}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="m-0 text-[13px] text-gypi-dim">{libro.faltan.includes(HOJA_OPERACIONES) ? `Sin la hoja ${HOJA_OPERACIONES} no hay de dónde sugerir.` : "No hay sugerencias: los tipos sin cuenta no tienen operaciones cargadas."}</p>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="g-btn g-btn-primary" disabled={(!elegidas.size && !(conFlujo && tiposFlujo)) || !!copiando} onClick={copiar}>
              {copiando ? `Copiando ${copiando}…` : "Copiar a Gypi"}
            </button>
            <button type="button" className="g-btn g-btn-secondary" disabled={!!copiando} onClick={() => setLibro(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ─── Editar una fila ────────────────────────────────────────────────── */

function campo(label, input) {
  return (
    <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">
      {label}
      {input}
    </label>
  );
}

function EditarFila({ tabla, fila, nueva, cuentas, personal, onCerrar, onGuardado }) {
  const toast = useToast();
  const [f, setF] = useState(fila);
  const [guardando, setGuardando] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const clave = TABLAS_FIN[tabla].clave;

  const guardar = async () => {
    setGuardando(true);
    try {
      const fila = tabla === "tesoreria" ? { ...f, responsable_id: f.responsable_id || null } : f;
      await postFin({ accion: "guardar", tabla, fila });
      toast.success("✅ Guardado");
      onGuardado();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  };

  const input = (k, extra = {}) => <input className="g-input w-full" value={f[k] ?? ""} onChange={set(k)} {...extra} />;
  const casilla = (k, label) => (
    <label className="flex items-center gap-2 text-[14px] text-gypi-text cursor-pointer min-h-[36px]">
      <input type="checkbox" checked={!!f[k]} onChange={set(k)} /> {label}
    </label>
  );
  const elegirCuenta = (k) => (
    <SelectBuscable className="g-input w-full" listaAncha value={f[k] || ""} onChange={set(k)}>
      <option value="">Sin cuenta por defecto</option>
      {cuentas.filter((c) => c.activa !== false || c.codigo === f[k]).map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nombre}</option>)}
    </SelectBuscable>
  );

  return (
    <Modal open onClose={onCerrar} title={nueva ? `Nueva fila: ${TABLAS_FIN[tabla].nombre}` : `Editar ${f[clave]}`}>
      <div className="flex flex-col gap-3">
        {nueva && campo(tabla === "tesoreria" ? "Código de la cuenta" : "Código", input(clave, { placeholder: tabla === "tipos" || tabla === "centros" ? "" : "01.01.01.001.001" }))}
        {tabla === "cuentas" && <>
          {campo("Nombre", input("nombre"))}
          {campo("Rubro", input("rubro", { placeholder: "ACTIVO CORRIENTE" }))}
          {casilla("activa", "Activa (se puede usar en operaciones nuevas)")}
        </>}
        {tabla === "tipos" && <>
          {campo("Nombre", input("nombre"))}
          {campo("Grupo", input("grupo", { placeholder: "COMPRAS, PAGOS, COBROS…" }))}
          {campo("Cuenta del debe por defecto", elegirCuenta("cuenta_debe"))}
          {campo("Cuenta del haber por defecto", elegirCuenta("cuenta_haber"))}
          {casilla("pide_entidad", "Pide proveedor o cliente")}
          {casilla("pide_ot", "Pide OT")}
          {casilla("pide_cc", "Pide centro de costo")}
          {campo("Para qué se usa (leyenda en letra chica al cargar)", <textarea className="g-input w-full" rows={3} value={f.descripcion ?? ""} onChange={set("descripcion")} placeholder={leyendaTipo({ codigo: f[clave] }) || "Qué comprende este tipo y un ejemplo"} />)}
          {casilla("activo", "Activo")}
        </>}
        {tabla === "tesoreria" && <>
          {campo("Nombre", input("nombre"))}
          {campo("Tipo", <SelectBuscable className="g-input w-full" value={f.tipo || "caja"} onChange={set("tipo")}>{Object.entries(TIPOS_TESORERIA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</SelectBuscable>)}
          {campo("Moneda", <SelectBuscable className="g-input w-full" value={f.moneda || "ARS"} onChange={set("moneda")}><option value="ARS">Pesos</option><option value="USD">Dólares</option></SelectBuscable>)}
          {campo("Responsable (para que la cargue desde su celular más adelante)", (
            <SelectBuscable className="g-input w-full" value={f.responsable_id || ""} onChange={set("responsable_id")}>
              <option value="">Sin responsable</option>
              {personal.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </SelectBuscable>
          ))}
          {casilla("activa", "Activa")}
        </>}
        {tabla === "centros" && <>
          {campo("Nombre", input("nombre"))}
          {campo("División", input("division", { placeholder: "MADERA" }))}
          {campo("Tipo", input("tipo", { placeholder: "PRODUCCION" }))}
          {casilla("activo", "Activo")}
        </>}
        <div className="flex gap-2 mt-1">
          <button type="button" className="g-btn g-btn-primary" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar"}</button>
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Listas ─────────────────────────────────────────────────────────── */

const VACIAS = {
  cuentas: { codigo: "", nombre: "", rubro: "", activa: true },
  tipos: { codigo: "", nombre: "", grupo: "", cuenta_debe: "", cuenta_haber: "", pide_entidad: false, pide_ot: false, pide_cc: false, descripcion: "", activo: true },
  tesoreria: { cuenta: "", nombre: "", tipo: "caja", moneda: "ARS", responsable_id: "", activa: true },
  centros: { codigo: "", nombre: "", division: "", tipo: "", activo: true },
};

function renglon(tabla, f, nombres, personal) {
  if (tabla === "cuentas") return { titulo: f.nombre, detalle: [f.codigo, f.rubro].filter(Boolean).join(" · "), apagado: f.activa === false };
  if (tabla === "tipos") {
    const falta = !f.cuenta_debe || !f.cuenta_haber;
    return {
      titulo: f.codigo,
      detalle: `Debe: ${textoCuenta(f.cuenta_debe, nombres)} · Haber: ${textoCuenta(f.cuenta_haber, nombres)}`,
      marca: falta ? "Sin cuentas por defecto" : null,
      apagado: f.activo === false,
    };
  }
  if (tabla === "tesoreria") {
    const resp = personal.find((p) => p.id === f.responsable_id)?.nombre;
    return { titulo: f.nombre, detalle: [f.cuenta, TIPOS_TESORERIA[f.tipo], f.moneda === "USD" ? "Dólares" : "Pesos", resp && `Responsable: ${resp}`].filter(Boolean).join(" · "), apagado: f.activa === false };
  }
  return { titulo: f.codigo, detalle: [f.nombre, f.division].filter(Boolean).join(" · "), apagado: f.activo === false };
}

export default function FinanzasConfig() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [tabla, setTabla] = useState("cuentas");
  const [buscar, setBuscar] = useState("");
  const [soloSinCuenta, setSoloSinCuenta] = useState(false);
  const [editando, setEditando] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const res = await apiFetch("/api/finanzas");
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo cargar Finanzas");
      setDatos(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const nombres = useMemo(() => new Map((datos?.cuentas || []).map((c) => [c.codigo, c.nombre])), [datos]);
  const lista = useMemo(() => {
    const filas = datos?.[tabla === "tipos" ? "tipos" : tabla] || [];
    const q = normal(buscar).trim();
    return filas
      .filter((f) => !q || normal(Object.values(f).join(" ")).includes(q))
      .filter((f) => tabla !== "tipos" || !soloSinCuenta || !f.cuenta_debe || !f.cuenta_haber);
  }, [datos, tabla, buscar, soloSinCuenta]);

  if (error) return <p role="alert" className="m-[18px] text-[14px] text-gypi-red">⚠ {error}</p>;
  if (!datos) return <div className="flex-1 flex items-center justify-center py-10"><Spinner /></div>;

  const vacio = !datos.cuentas.length && !datos.tipos.length && !datos.tesoreria.length && !datos.centros.length;
  const sinCuenta = datos.tipos.filter((t) => !t.cuenta_debe || !t.cuenta_haber).length;

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      <CopiarLibro nombres={nombres} onCopiado={cargar} />
      {!vacio && <FinanzasLibroScript />}
      {!vacio && <FinanzasHistorico onPasado={cargar} />}
      {!vacio && <FinanzasTipos onPasado={cargar} />}

      {!vacio && (
        <section aria-label="Configuración de Finanzas">
          <div className="flex flex-wrap gap-1.5 mb-2" aria-label="Tablas">
            {Object.entries(TABLAS_FIN).map(([k, t]) => (
              <Chip key={k} active={tabla === k} onClick={() => { setTabla(k); setBuscar(""); }}>
                {t.nombre} ({datos[k].length})
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <input className="g-input flex-1 min-w-[180px]" aria-label="Buscar" placeholder="Buscar por código o nombre" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
            <button type="button" className="g-btn g-btn-secondary" onClick={() => setEditando({ fila: { ...VACIAS[tabla] }, nueva: true })}>+ Nueva</button>
          </div>
          {tabla === "tipos" && sinCuenta > 0 && (
            <label className="flex items-center gap-2 mb-2 text-[13px] text-gypi-text cursor-pointer">
              <input type="checkbox" checked={soloSinCuenta} onChange={(e) => setSoloSinCuenta(e.target.checked)} />
              Ver solo los {sinCuenta} tipos sin cuentas por defecto
            </label>
          )}
          <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
            {lista.slice(0, 300).map((f) => {
              const r = renglon(tabla, f, nombres, datos.personal || []);
              const k = f[TABLAS_FIN[tabla].clave];
              return (
                <li key={k}>
                  <button type="button" onClick={() => setEditando({ fila: { ...f }, nueva: false })}
                    className={`w-full text-left min-h-[48px] px-3 py-2 rounded-lg border border-gypi-border bg-gypi-surface cursor-pointer ${r.apagado ? "opacity-60" : ""}`}>
                    <span className="block text-[14px] font-semibold text-gypi-text">{r.titulo}{r.apagado ? " (inactiva)" : ""}</span>
                    <span className="block text-[13px] text-gypi-dim">{r.detalle}</span>
                    {r.marca && <span className="inline-block mt-1 text-[12px] font-semibold text-gypi-red">{r.marca}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {lista.length > 300 && <p className="mt-2 text-[13px] text-gypi-dim">Hay {lista.length - 300} más: buscá por código o nombre.</p>}
          {!lista.length && <p className="mt-2 text-[13px] text-gypi-dim">No hay filas que coincidan.</p>}
        </section>
      )}

      {editando && (
        <EditarFila
          tabla={tabla}
          fila={editando.fila}
          nueva={editando.nueva}
          cuentas={datos.cuentas}
          personal={datos.personal || []}
          onCerrar={() => setEditando(null)}
          onGuardado={() => { setEditando(null); cargar(); }}
        />
      )}
    </div>
  );
}
