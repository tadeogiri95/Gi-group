'use client';
// app/components/FinanzasExtracto.jsx — Finanzas → 💰 Cajas y bancos → un
// banco → 📥 Subir extracto (parte F5a; /api/finanzas/banco; reglas en
// app/lib/finanzasBanco.js). Sin migración.
//
// Se sube el resumen en PDF o los movimientos en Excel/CSV. Lo que ya está en
// Gypi (pagos, e-cheq debitados, cobros, lo de un extracto anterior) sale
// marcado ✓; lo demás viene con el tipo y la cuenta que se usaron antes para
// ese texto del banco, para revisar y cargar todo junto. "Aprender del libro"
// lee T-OPERACIONES acá mismo y manda solo las reglas.
// 13/11 (parte 5 del plan de Tesorería): el extracto completa, no copia. Un
// renglón que coincide con algo que Gypi espera (cheque por debitar o en
// cartera, orden de pago por transferencia, plazo fijo vencido) sale 🔗 y se
// completa eso en vez de cargarse nuevo. Antes de cargar, el resumen con el
// saldo contra el del banco. Cada carga queda registrada y se puede deshacer
// entera o por renglones (migración 188).
// 13/11 (parte 7): en una caja es 📥 Subir planilla (Fecha, Concepto,
// Ingreso, Egreso) y funciona igual: ya estaba, nuevo, sospechoso, el tipo
// sugerido y deshacer. Hay una planilla de ejemplo para descargar.
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { plata } from "../lib/finanzasOperaciones";
import { movimientoEnCuenta, reglasDelLibro } from "../lib/finanzasBanco";
import { resumenDeCarga, textoCarga } from "../lib/finanzasExtractoPendientes";
import { PLANILLA_EJEMPLO, claseDeArchivo } from "../lib/finanzasExtracto";
import { puedeAnular, puedeCorregir } from "../lib/finanzasCorregir";
import { Detalle } from "./FinanzasMovimientos";
import { Modal, Spinner } from "./ui";
import { useToast } from "./ui/Toast";

const fechaCorta = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}` : "");
const normal = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const MAX_FILAS = 400;

async function postBanco(body) {
  const res = await apiFetch("/api/finanzas/banco", { method: "POST", body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(d.error || "No se pudo guardar"), { datos: d });
  return d;
}

/** "02.01.02.001.001 · Proveedores" → "02.01.02.001.001". */
export const codigoDe = (texto) => String(texto || "").split(" · ")[0].trim();

/** La cuenta de enfrente que trae el tipo: al debe si sale plata, al haber si entra (nunca el mismo banco). */
export function contraDeTipo(tipo, importe, cuentaBanco) {
  if (!tipo) return "";
  const c = importe < 0 ? tipo.cuenta_debe : tipo.cuenta_haber;
  return c && c !== cuentaBanco ? c : "";
}

/**
 * Por qué no se pudo leer el libro, en castellano: el error de la librería
 * ("invalid zip data") no le dice nada a nadie. Lo más común es haber elegido
 * acá el archivo del banco en vez del libro.
 */
export function problemaDelLibro(bytes) {
  const clase = claseDeArchivo(bytes);
  if (clase === "xlsx") return null;
  if (clase === "xls") return "Ese archivo no es el libro contable en .xlsx: es un Excel viejo (.xls) o tiene contraseña. Si es el extracto del banco, subilo arriba en \"Archivo del extracto\". Si es el libro, guardalo como .xlsx sin contraseña.";
  return "Ese archivo no es el libro contable (.xlsx). Si es el extracto del banco, subilo arriba en \"Archivo del extracto\".";
}

export const LIBRO_ILEGIBLE = "No pude abrir el libro: puede estar incompleto o con contraseña. Bajalo de nuevo como .xlsx (sin contraseña) y probá otra vez.";

const ORIGEN_CORTO = { libro: "del libro", banco: "del extracto", manual: "a mano", plazo_fijo: "plazo fijo", saldo_inicial: "apertura", mi_caja: "Mi caja" };
const origenCorto = (o) => ORIGEN_CORTO[o?.origen || "manual"] || o?.origen || "";

/** Cómo se arma el saldo de Gypi y la diferencia con el banco (12/11). */
function SaldoGypi({ saldo, banco, hasta, dice = "el banco" }) {
  if (!saldo) return null;
  const dif = banco == null ? null : Math.round((saldo.saldo - banco) * 100) / 100;
  const mal = dif != null && Math.abs(dif) >= 0.01;
  return (
    <details className={`rounded-lg border p-2 text-[13px] ${mal ? "border-gypi-red/40 bg-gypi-red/5" : "border-gypi-border"}`} open={mal}>
      <summary className="cursor-pointer font-semibold">
        🔎 Saldo de Gypi al {fechaCorta(hasta)}: {plata(saldo.saldo, "ARS")}
        {banco != null && (mal ? <span className="text-gypi-red"> · {dice} dice {plata(banco, "ARS")} (diferencia {plata(dif, "ARS")})</span> : <span className="text-gypi-green"> · igual que {dice} ✓</span>)}
      </summary>
      <p className="m-0 mt-2 text-gypi-dim">De dónde sale el saldo de Gypi (todas las operaciones de esta cuenta hasta esa fecha):</p>
      <table className="mt-1 text-[13px] border-collapse" aria-label="Saldo por origen">
        <tbody>
          {saldo.origenes.map((o) => (
            <tr key={o.origen} className="border-t border-gypi-border">
              <td className="py-0.5 pr-3">{o.nombre}</td>
              <td className="py-0.5 pr-3 text-gypi-dim text-right">{o.n} mov.</td>
              <td className={`py-0.5 text-right font-mono ${o.saldo < 0 ? "text-gypi-red" : "text-gypi-text"}`}>{plata(o.saldo, "ARS")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {mal && <p className="m-0 mt-1 text-gypi-dim">Si un origen suma mucho más de lo que debería, suele ser lo mismo cargado dos veces: mirá abajo &quot;Posibles repetidos&quot;.</p>}
    </details>
  );
}

/** Operaciones de la cuenta que parecen cargadas dos veces: se elige cuáles anular. */
export function Repetidos({ grupos, onVer, onAnuladas, titulo = "🔁 Posibles repetidos en Gypi", abierto = false }) {
  const toast = useToast();
  const [elegidas, setElegidas] = useState(() => new Set());
  const [anulando, setAnulando] = useState(false);
  if (!grupos?.length) return null;
  const alternar = (id) => setElegidas((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const sugerir = () => setElegidas(new Set(grupos.flatMap((g) => g.ops.filter((o) => o.id !== g.queda && puedeAnular(o)).map((o) => o.id))));
  const anular = async () => {
    if (!window.confirm(`Se anulan ${elegidas.size} operaciones: quedan tachadas y dejan de sumar (si estaban en el libro, el libro las borra). ¿Seguimos?`)) return;
    setAnulando(true);
    try {
      const r = await apiFetch("/api/finanzas/operaciones", { method: "POST", body: JSON.stringify({ accion: "anular_varias", ids: [...elegidas] }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudieron anular");
      toast.success(`Se anularon ${d.anuladas} operaciones`);
      setElegidas(new Set());
      onAnuladas();
    } catch (e) {
      toast.error(e.message);
    }
    setAnulando(false);
  };
  return (
    <details className="rounded-lg border border-gypi-amber/40 bg-gypi-amber/10 p-2 text-[13px]" open={abierto || undefined}>
      <summary className="cursor-pointer font-semibold text-gypi-amber-ink">{titulo} ({grupos.length})</summary>
      <p className="m-0 mt-2 text-gypi-dim">Mismo importe y hasta 3 días de diferencia en esta cuenta. Tildá las que sobran: se anulan. ⭐ = la que conviene dejar: la copiada del libro si la hay (al anular la otra, el libro también queda bien), si no la del extracto o la más vieja.</p>
      <ul className="list-none m-0 mt-1 p-0 flex flex-col gap-2">
        {grupos.map((g) => (
          <li key={g.ops.map((o) => o.id).join("-")} className="border-t border-gypi-border pt-1">
            {/* 13/11: 🔴 si hay dos el mismo día, 🟡 si están a pocos días */}
            {g.ops.some((o, i) => g.ops.findIndex((x) => x.fecha === o.fecha) !== i) ? "🔴 " : "🟡 "}
            <b className="font-mono">{plata(g.importe, "ARS")}</b> · {g.ops.length} veces
            <ul className="list-none m-0 p-0">
              {g.ops.map((o) => (
                <li key={o.id} className="flex items-start gap-2">
                  <input type="checkbox" className="mt-0.5" aria-label={`Anular la operación ${o.id}`} checked={elegidas.has(o.id)} disabled={!puedeAnular(o)} onChange={() => alternar(o.id)} />
                  <span className="flex-1 min-w-0">
                    {o.id === g.queda ? "⭐ " : ""}<span className="font-mono">{fechaCorta(o.fecha)}</span> {o.tipo} · {origenCorto(o)}{o.descripcion ? ` · ${o.descripcion}` : ""}
                    {!puedeAnular(o) && <span className="text-gypi-dim"> (se borra en el libro y volvés a pasar el histórico)</span>}
                  </span>
                  <button type="button" className="g-btn g-btn-secondary !py-0.5 !px-2 text-[12px]" onClick={() => onVer(o)} aria-label={`Ver la operación ${o.id}`}>Ver</button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 mt-2">
        <button type="button" className="g-btn g-btn-secondary" onClick={sugerir}>Tildar las que sobran</button>
        <button type="button" className="g-btn g-btn-primary disabled:opacity-50" disabled={!elegidas.size || anulando} onClick={anular}>{anulando ? "Anulando…" : `🗑 Anular ${elegidas.size} elegidas`}</button>
      </div>
    </details>
  );
}

/**
 * 13/11: el renglón se parece a algo que ya está (🔴 mismo importe el mismo
 * día, 🟡 hasta 3 días). Solo se carga tildándolo a propósito.
 */
function AvisoSospecha({ f, caja, onVer }) {
  const rojo = f.sospecha.nivel === "rojo";
  const p = f.sospecha.parecida;
  return (
    <span role="note" className={`block mt-1 p-1.5 rounded text-[12px] text-gypi-text ${rojo ? "bg-gypi-red/10 border border-gypi-red/40" : "bg-gypi-amber/10 border border-gypi-amber/40"}`}>
      <b>{rojo ? "🔴 Muy sospechoso" : "🟡 Posible repetido"}:</b>{" "}
      {f.sospecha.motivo === "extracto"
        ? "hay otro renglón igual (misma fecha e importe) en este mismo extracto."
        : p
          ? <>en Gypi ya hay {plata(movimientoEnCuenta(p, caja.cuenta), "ARS")} el {fechaCorta(p.fecha)} · {p.tipo} ({origenCorto(p)}).</>
          : "en Gypi ya hay un movimiento por el mismo importe en esos días."}
      {" "}No se carga salvo que tildes la casilla: <b>es otro distinto</b>.
      {p && <button type="button" className="g-btn g-btn-secondary !py-0.5 !px-2 text-[12px] ml-1" onClick={() => onVer(p)}>Ver</button>}
    </span>
  );
}

/** Las cargas anteriores del extracto de esta cuenta, para ver qué entró y deshacerlo (13/11, parte 5). */
export function CargasAnteriores({ caja, recargar = 0, onDeshecho }) {
  const toast = useToast();
  const [cargas, setCargas] = useState(null);
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  const [abierta, setAbierta] = useState(null);
  const [ops, setOps] = useState(null);
  const [elegidos, setElegidos] = useState(() => new Set());
  const [deshaciendo, setDeshaciendo] = useState(false);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/finanzas/banco?cuenta=${encodeURIComponent(caja.cuenta)}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudieron leer las cargas");
      setCargas(d.cargas || []);
      setFaltaMigracion(Boolean(d.falta_migracion));
    } catch (e) {
      setError(e.message);
    }
  }, [caja.cuenta, recargar]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { cargar(); }, [cargar]);

  async function abrir(c) {
    if (abierta === c.id) { setAbierta(null); return; }
    setAbierta(c.id);
    setOps(null);
    setElegidos(new Set());
    try {
      const r = await apiFetch(`/api/finanzas/banco?carga=${c.id}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo abrir la carga");
      setOps(d.operaciones || []);
    } catch (e) {
      setError(e.message);
    }
  }

  async function deshacer(c, soloElegidos) {
    const n = soloElegidos ? elegidos.size : (ops || []).filter((o) => !o.anulada_at).length || c.cargadas;
    if (!window.confirm(`Se anulan ${n} movimientos de esta carga: quedan tachados y dejan de sumar. ¿Seguimos?`)) return;
    setDeshaciendo(true);
    setError(null);
    try {
      const d = await postBanco({ accion: "deshacer", id: c.id, ...(soloElegidos ? { ops: [...elegidos] } : {}) });
      toast.success(d.deshecha ? "Carga deshecha" : `Se deshicieron ${d.anuladas} movimientos`);
      setAbierta(null);
      await cargar();
      onDeshecho?.();
    } catch (e) {
      setError(e.message);
    }
    setDeshaciendo(false);
  }

  if (faltaMigracion) return <p className="m-0 text-[13px] text-gypi-amber-ink">Para ver las cargas anteriores y poder deshacerlas falta correr la migración 188 en Supabase.</p>;
  if (!cargas?.length) return error ? <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p> : null;
  return (
    <section aria-label="Cargas anteriores" className="rounded-lg border border-gypi-border p-2 text-[13px] flex flex-col gap-1">
      <b className="text-gypi-text">🗂 Cargas anteriores</b>
      <ul className="list-none m-0 p-0 flex flex-col gap-1">
        {cargas.map((c) => (
          <li key={c.id} className="flex flex-col gap-1 border-t first:border-t-0 border-gypi-border pt-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className={`flex-1 min-w-[200px] ${c.deshecha_at ? "line-through text-gypi-dim" : "text-gypi-text"}`}>
                <span className="font-mono">{fechaCorta(String(c.created_at || "").slice(0, 10))}</span> · {textoCarga(c)}
              </span>
              {c.deshecha_at
                ? <span className="text-gypi-dim">Deshecha{c.deshecha_por_nombre ? ` por ${c.deshecha_por_nombre}` : ""}</span>
                : <button type="button" className="g-btn g-btn-secondary !py-0.5 !px-2 text-[12px]" onClick={() => abrir(c)}>{abierta === c.id ? "Cerrar" : "Ver o deshacer"}</button>}
            </span>
            {abierta === c.id && (
              <div className="pl-2 flex flex-col gap-1">
                {!ops ? <Spinner /> : (
                  <>
                    <ul className="list-none m-0 p-0 flex flex-col gap-0.5" aria-label="Movimientos de la carga">
                      {ops.map((o) => (
                        <li key={o.id} className={o.anulada_at ? "line-through text-gypi-dim" : ""}>
                          <label className="flex items-start gap-2 cursor-pointer">
                            <input type="checkbox" className="mt-0.5" aria-label={`Deshacer el movimiento ${o.id}`} disabled={Boolean(o.anulada_at)} checked={elegidos.has(o.id)}
                              onChange={() => setElegidos((s) => { const n = new Set(s); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); return n; })} />
                            <span><span className="font-mono">{fechaCorta(o.fecha)}</span> <b className="font-mono">{plata(movimientoEnCuenta(o, caja.cuenta), "ARS")}</b> {o.tipo}{o.entidad ? ` · ${o.entidad}` : ""}{o.descripcion ? ` · ${o.descripcion}` : ""}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    <span className="flex flex-wrap justify-end gap-2">
                      <button type="button" className="g-btn g-btn-secondary !py-1 !px-2 text-[12px]" disabled={deshaciendo || !elegidos.size} onClick={() => deshacer(c, true)}>Deshacer {elegidos.size || ""} elegidos</button>
                      <button type="button" className="g-btn g-btn-primary !py-1 !px-2 text-[12px]" disabled={deshaciendo} onClick={() => deshacer(c, false)}>{deshaciendo ? "Deshaciendo…" : "Deshacer la carga entera"}</button>
                    </span>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
    </section>
  );
}

export default function SubirExtracto({ caja, datos, onCerrar, onCargado, onCambio = null }) {
  const toast = useToast();
  const [leyendo, setLeyendo] = useState(false);
  const [aprendiendo, setAprendiendo] = useState(false);
  // Lo que aprendió del libro, a la vista (antes era un aviso que se iba y parecía que no pasaba nada)
  const [aprendido, setAprendido] = useState(null);
  const [errorLibro, setErrorLibro] = useState(null);
  const [res, setRes] = useState(null);
  const [filas, setFilas] = useState([]);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [verYa, setVerYa] = useState(false);
  // El archivo subido: después de corregir o anular algo se vuelve a leer, así se ve cómo quedó
  const [archivo, setArchivo] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [corrigiendo, setCorrigiendo] = useState(null);
  const [completando, setCompletando] = useState(null);
  const [deshechas, setDeshechas] = useState(0);
  const nombreCuenta = useMemo(() => new Map((datos.cuentas || []).map((c) => [c.codigo, c.nombre])), [datos.cuentas]);
  const tipos = useMemo(() => (datos.tipos || []).filter((t) => t.activo !== false), [datos.tipos]);
  const etiquetaCuenta = (c) => (c ? `${c} · ${nombreCuenta.get(c) || ""}` : "");
  // Una caja se pone al día con una planilla; un banco, con su extracto
  const planilla = (caja.tipo || "banco") !== "banco";
  const dice = planilla ? "la planilla" : "el banco";

  function bajarEjemplo() {
    // Con BOM, así Excel lee bien los acentos
    const url = URL.createObjectURL(new Blob(["\uFEFF" + PLANILLA_EJEMPLO], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "planilla-de-caja-ejemplo.csv" });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function subir(file) {
    if (!file) return;
    setArchivo(file);
    setError(null);
    setLeyendo(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("cuenta", caja.cuenta);
      const r = await apiFetch("/api/finanzas/banco", { method: "POST", body: form });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo leer el extracto");
      setRes(d);
      setFilas(d.filas.map((f, i) => ({
        ...f, i,
        // 13/11: lo sospechoso (igual a algo de Gypi) no se tilda solo
        elegida: !f.op && Boolean(f.sugerencia) && !f.sospecha && !f.pendiente,
        tipo: f.sugerencia?.tipo || "",
        contra: f.sugerencia?.contra ? etiquetaCuenta(f.sugerencia.contra) : "",
        entidad: f.sugerencia?.entidad || "",
        proveedor_id: f.sugerencia?.proveedor_id || null,
        cliente_id: f.sugerencia?.cliente_id || null,
      })));
    } catch (e) {
      setError(e.message);
    }
    setLeyendo(false);
  }

  async function aprenderDelLibro(file) {
    if (!file) return;
    setErrorLibro(null);
    setAprendido(null);
    setAprendiendo(true);
    try {
      const { hojasXlsx, leerHojaXlsx } = await import("../lib/leerXlsx");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const problema = problemaDelLibro(bytes);
      if (problema) throw new Error(problema);
      let hojas;
      try { hojas = hojasXlsx(bytes); } catch { throw new Error(LIBRO_ILEGIBLE); }
      const hoja = hojas.find((n) => normal(n) === "TOPERACIONES");
      if (!hoja) throw new Error("Ese archivo no tiene la hoja T-OPERACIONES");
      const { reglas, usadas, error: err } = reglasDelLibro(leerHojaXlsx(bytes, hoja, { maxFilas: 60000, maxCols: 60 }) || [], caja.cuenta);
      if (err) throw new Error(err);
      if (!usadas) throw new Error(`En el libro no hay movimientos de ${caja.nombre}`);
      const d = await postBanco({ accion: "aprender", cuenta: caja.cuenta, reglas });
      toast.success(`Aprendí de ${usadas} movimientos del libro`);
      setAprendido({ usadas, reglas: d.reglas, conExtracto: Boolean(res) });
      // Con el extracto abierto, las sugerencias se vuelven a calcular con lo aprendido
      if (res && archivo) await subir(archivo);
    } catch (e) {
      setErrorLibro(e.message);
    }
    setAprendiendo(false);
  }

  const cambiar = (i, cambios) => setFilas((fs) => fs.map((f) => (f.i === i ? { ...f, ...cambios } : f)));
  const elegirTipo = (f, codigo) => {
    const t = tipos.find((x) => x.codigo === codigo);
    const contra = codigoDe(f.contra) || contraDeTipo(t, f.importe, caja.cuenta);
    cambiar(f.i, { tipo: codigo, contra: etiquetaCuenta(contra), elegida: Boolean(codigo) && (!f.sospecha || f.elegida) });
  };

  const repetidas = useMemo(() => new Set((res?.repetidos || []).flatMap((g) => g.ops.filter((o) => o.id !== g.queda).map((o) => o.id))), [res]);
  const pendientes = filas.filter((f) => !f.op && !f.completada);
  const completan = pendientes.filter((f) => f.pendiente).length;
  const completadas = filas.filter((f) => f.completada).length;
  const sospechosas = pendientes.filter((f) => f.sospecha).length;
  const ya = filas.filter((f) => f.op);
  const elegidas = pendientes.filter((f) => f.elegida);
  const incompletas = elegidas.filter((f) => !f.tipo || !nombreCuenta.has(codigoDe(f.contra)));
  const resumen = res ? resumenDeCarga(elegidas, { saldoGypi: res.saldo_gypi?.saldo || 0, saldoBanco: res.control?.final ?? null }) : null;

  // 🔗 Completar lo pendiente (el cheque, la orden o el plazo fijo) con su propia pantalla
  async function completar(f) {
    setError(null);
    setCompletando(f.i);
    try {
      const r = await apiFetch(f.pendiente.accion.url, { method: "POST", body: JSON.stringify(f.pendiente.accion.body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo completar");
      toast.success("✅ Listo: quedó registrado");
      cambiar(f.i, { completada: true, elegida: false });
      onCambio?.();
    } catch (e) {
      setError(e.message);
    }
    setCompletando(null);
  }

  const releer = () => { if (archivo) subir(archivo); };

  // "Dejar como dice el banco": la de Gypi toma la fecha y el importe del extracto
  async function comoElBanco(op, f) {
    setError(null);
    setCorrigiendo(op.id);
    try {
      const r = await apiFetch("/api/finanzas/operaciones", { method: "POST", body: JSON.stringify({ accion: "corregir", id: op.id, cambios: { fecha: f.fecha, total: Math.abs(f.importe) } }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo corregir");
      toast.success(`✅ Quedó como dice ${dice}`);
      releer();
    } catch (e) {
      setError(e.message);
    }
    setCorrigiendo(null);
  }

  async function cargar() {
    setError(null);
    setGuardando(true);
    try {
      const d = await postBanco({
        accion: "confirmar", cuenta: caja.cuenta, archivo: res.archivo || archivo?.name || null, desde: res.desde, hasta: res.hasta, movimientos: res.filas.length,
        filas: elegidas.map((f) => ({
          fecha: f.fecha, descripcion: f.descripcion, comprobante: f.comprobante, importe: f.importe, marca: f.marca,
          tipo: f.tipo, contra: codigoDe(f.contra), entidad: f.entidad || null, proveedor_id: f.proveedor_id, cliente_id: f.cliente_id,
          forzar: Boolean(f.sospecha),
        })),
      });
      toast.success(`Se cargaron ${d.cargadas} movimientos${d.repetidas ? ` (${d.repetidas} ya estaban)` : ""}`);
      if (d.aviso) toast.error(d.aviso);
      onCargado();
    } catch (e) {
      // 13/11: el servidor encontró algo igual que la pantalla no vio (se cargó recién): esos quedan sospechosos y sin tildar
      const marcas = new Set(e.datos?.marcas || []);
      if (marcas.size) setFilas((fs) => fs.map((f) => (marcas.has(f.marca) ? { ...f, elegida: false, sospecha: f.sospecha || { nivel: "rojo", motivo: "gypi", parecida: null } } : f)));
      setError(e.message);
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onCerrar} title={`📥 ${planilla ? "Planilla" : "Extracto"} de ${caja.nombre}`} maxWidth={980}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        {!res && (
          <>
            {planilla ? (
              <p className="m-0">Subí una planilla (Excel o CSV) con los movimientos de la caja: <b>Fecha, Concepto, Ingreso y Egreso</b>. Lo que ya está en Gypi se marca solo; lo demás viene con el tipo sugerido para revisar.</p>
            ) : (
              <p className="m-0">Subí el resumen del banco en PDF o los movimientos bajados en Excel o CSV. Lo que ya está en Gypi se marca solo; lo demás viene con el tipo sugerido para revisar.</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <label className={`g-btn g-btn-primary text-[15px] ${leyendo ? "opacity-60" : "cursor-pointer"}`}>
                📄 Elegir {planilla ? "la planilla" : "el archivo del extracto"}
                <input type="file" className="sr-only" accept=".pdf,.xlsx,.xls,.csv,application/pdf" aria-label={planilla ? "Archivo de la planilla" : "Archivo del extracto"} disabled={leyendo} onChange={(e) => subir(e.target.files?.[0])} />
              </label>
              {planilla && <button type="button" className="g-btn g-btn-secondary" onClick={bajarEjemplo}>⬇ Planilla de ejemplo</button>}
            </div>
            {leyendo && <p className="m-0 flex items-center gap-2 text-gypi-dim"><Spinner /> Leyendo {planilla ? "la planilla" : "el extracto"}…</p>}
            <CargasAnteriores caja={caja} recargar={deshechas} onDeshecho={() => { setDeshechas((n) => n + 1); onCambio?.(); }} />
          </>
        )}
        {res && (
          <>
            <p className="m-0">
              {res.filas.length} movimientos del {fechaCorta(res.desde)} al {fechaCorta(res.hasta)} · <b className="text-gypi-green">✓ {ya.length} ya en Gypi</b>
              {(completan > 0 || completadas > 0) && <> · <b className="text-gypi-text">🔗 {completan} completan algo pendiente{completadas ? ` (${completadas} ya completados)` : ""}</b></>}
              {" · "}<b>＋ {pendientes.length - completan} nuevos</b>
              {sospechosas > 0 && <> · <b className="text-gypi-red">{sospechosas} sospechosos (no se cargan sin tu OK)</b></>}
            </p>
            {res.control && (
              <p className={`m-0 text-[13px] ${res.control.ok ? "text-gypi-green" : "text-gypi-red"}`}>
                {res.control.ok
                  ? `✓ El saldo cierra con el de ${dice}: ${plata(res.control.final, "ARS")}`
                  : `⚠ El saldo no cierra: ${dice} dice ${plata(res.control.final, "ARS")} y los movimientos leídos dan ${plata(res.control.calculado, "ARS")}. Revisá que el archivo esté completo.`}
              </p>
            )}
            <SaldoGypi saldo={res.saldo_gypi} banco={res.control?.final ?? null} hasta={res.hasta} dice={dice} />
            <Repetidos grupos={res.repetidos} onVer={setDetalle} onAnuladas={releer} />
            {!res.reglas && <p className="m-0 text-[13px] text-gypi-amber-ink">Todavía no aprendí cómo cargás {planilla ? "esta caja" : "este banco"}: subí el libro con &quot;📘 Aprender del libro&quot; y las sugerencias salen solas.</p>}
          </>
        )}
        <details className="rounded-lg border border-gypi-border p-2 text-[13px] text-gypi-dim" open={Boolean(res && !res.reglas) || aprendiendo || Boolean(aprendido) || Boolean(errorLibro)}>
          <summary className="cursor-pointer font-semibold">📘 Aprender del libro contable (opcional)</summary>
          <p className="m-0 mt-2">Esto NO es para el extracto: acá va el libro contable (.xlsx con la hoja T-OPERACIONES), para que Gypi aprenda cómo cargás cada movimiento del banco.</p>
          <label className="flex flex-wrap items-center gap-2 mt-2">
            Libro contable:
            <input type="file" accept=".xlsx,.xlsm" aria-label="Libro contable" disabled={aprendiendo}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; aprenderDelLibro(f); }} />
          </label>
          {aprendiendo && <p className="m-0 mt-2 flex items-center gap-2 text-gypi-text"><Spinner /> Leyendo el libro… puede tardar un minuto si es grande.</p>}
          {errorLibro && <p role="alert" className="m-0 mt-2 text-[13px] text-gypi-red">⚠ {errorLibro}</p>}
          {aprendido && (
            <p role="status" className="m-0 mt-2 p-2 rounded-lg bg-gypi-green/10 text-gypi-text">
              ✅ Aprendí de <b>{aprendido.usadas}</b> movimientos de {caja.nombre} en el libro ({aprendido.reglas} textos del banco reconocidos).
              {aprendido.conExtracto ? " Ya volví a sugerir el tipo en los movimientos de abajo." : " Ahora subí el extracto: los tipos vienen sugeridos."}
            </p>
          )}
        </details>

        {res && pendientes.length > 0 && (
          <div className="overflow-x-auto">
            <datalist id="fin-tipos">{tipos.map((t) => <option key={t.codigo} value={t.codigo}>{t.nombre || ""}</option>)}</datalist>
            <datalist id="fin-cuentas">{(datos.cuentas || []).filter((c) => c.activa !== false).map((c) => <option key={c.codigo} value={etiquetaCuenta(c.codigo)} />)}</datalist>
            <table className="w-full text-[13px] border-collapse" aria-label="Movimientos para cargar">
              <thead>
                <tr className="text-gypi-dim text-left">
                  <th className="py-1 w-8"><span className="sr-only">Cargar</span></th>
                  <th className="font-semibold py-1">Movimiento {planilla ? "de la planilla" : "del banco"}</th>
                  <th className="font-semibold py-1 text-right">Importe</th>
                  <th className="font-semibold py-1">Tipo</th>
                  <th className="font-semibold py-1">Cuenta de enfrente</th>
                </tr>
              </thead>
              <tbody>
                {pendientes.slice(0, MAX_FILAS).map((f) => (
                  <tr key={f.i} className="border-t border-gypi-border align-top">
                    <td className="py-1"><input type="checkbox" aria-label={f.sospecha ? `Es otro distinto: cargar renglón ${f.i + 1} igual` : `Cargar renglón ${f.i + 1}`} checked={f.elegida} onChange={(e) => cambiar(f.i, { elegida: e.target.checked })} /></td>
                    <td className="py-1 min-w-[220px]">
                      <span className="font-mono text-[12px] text-gypi-dim">{fechaCorta(f.fecha)}</span> {f.descripcion}
                      {f.sospecha && <AvisoSospecha f={f} caja={caja} onVer={setDetalle} />}
                      {f.pendiente && (
                        <span className="block mt-1 p-1.5 rounded bg-gypi-green/10 text-[12px] text-gypi-text">
                          🔗 Completa algo pendiente: {f.pendiente.texto}. No hace falta cargarlo nuevo.
                          <span className="flex flex-wrap gap-1.5 mt-1">
                            <button type="button" className="g-btn g-btn-primary !py-0.5 !px-2 text-[12px]" disabled={completando === f.i} onClick={() => completar(f)}>
                              {completando === f.i ? "Registrando…" : f.pendiente.boton}
                            </button>
                          </span>
                        </span>
                      )}
                      {f.entidad && <span className="block text-[12px] text-gypi-dim">{f.entidad}{f.sugerencia?.por === "cuit" ? " · por CUIT" : ""}</span>}
                      {f.parecido && (
                        <span className="block mt-1 p-1.5 rounded bg-gypi-amber/10 text-[12px] text-gypi-text">
                          ¿Es esta de Gypi? {plata(movimientoEnCuenta(f.parecido, caja.cuenta), "ARS")} el {fechaCorta(f.parecido.fecha)} · {f.parecido.tipo} ({origenCorto(f.parecido)})
                          <span className="flex flex-wrap gap-1.5 mt-1">
                            {puedeCorregir(f.parecido) && (
                              <button type="button" className="g-btn g-btn-primary !py-0.5 !px-2 text-[12px]" disabled={corrigiendo === f.parecido.id} onClick={() => comoElBanco(f.parecido, f)}>
                                {corrigiendo === f.parecido.id ? "Corrigiendo…" : `Dejar como dice ${dice}`}
                              </button>
                            )}
                            <button type="button" className="g-btn g-btn-secondary !py-0.5 !px-2 text-[12px]" onClick={() => setDetalle(f.parecido)}>Ver</button>
                          </span>
                        </span>
                      )}
                    </td>
                    <td className={`py-1 text-right font-mono whitespace-nowrap ${f.importe < 0 ? "text-gypi-red" : "text-gypi-green"}`}>{plata(f.importe, "ARS")}</td>
                    <td className="py-1">
                      <input className="g-input w-full min-w-[170px]" list="fin-tipos" aria-label={`Tipo del renglón ${f.i + 1}`} value={f.tipo} onChange={(e) => elegirTipo(f, e.target.value)} />
                    </td>
                    <td className="py-1">
                      <input className="g-input w-full min-w-[220px]" list="fin-cuentas" aria-label={`Cuenta del renglón ${f.i + 1}`} value={f.contra} onChange={(e) => cambiar(f.i, { contra: e.target.value })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pendientes.length > MAX_FILAS && <p className="m-0 mt-1 text-[12px] text-gypi-dim">Se ven los primeros {MAX_FILAS}: cargalos y volvé a subir el extracto para seguir.</p>}
          </div>
        )}

        {res && ya.length > 0 && (
          <div>
            <button type="button" className="g-btn g-btn-secondary" onClick={() => setVerYa((v) => !v)}>{verYa ? "Ocultar" : "Ver"} los {ya.length} que ya están en Gypi</button>
            {verYa && (
              <ul className="list-none m-0 mt-2 p-0 flex flex-col gap-1 text-[13px]" aria-label="Ya en Gypi">
                {ya.map((f) => (
                  <li key={f.i} className="text-gypi-dim flex flex-wrap items-start gap-x-2 gap-y-1">
                    <span className="flex-1 min-w-[200px]">
                      ✓ <span className="font-mono">{fechaCorta(f.fecha)}</span> {plata(f.importe, "ARS")} · {f.descripcion} → <b className="text-gypi-text">{f.op.tipo}</b>{f.op.entidad ? ` (${f.op.entidad})` : ""} · {origenCorto(f.op)}{f.ya ? " · de un extracto anterior" : ""}
                      {f.op.fecha !== f.fecha && <span className="text-gypi-amber-ink"> · en Gypi dice {fechaCorta(f.op.fecha)}</span>}
                    </span>
                    {f.op.fecha !== f.fecha && puedeCorregir(f.op) && (
                      <button type="button" className="g-btn g-btn-secondary !py-0.5 !px-2 text-[12px]" disabled={corrigiendo === f.op.id} onClick={() => comoElBanco(f.op, f)}>📅 Poner la fecha {planilla ? "de la planilla" : "del banco"}</button>
                    )}
                    <button type="button" className="g-btn g-btn-secondary !py-0.5 !px-2 text-[12px]" onClick={() => setDetalle(f.op)}>✏ Corregir o anular</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {res?.sin_banco?.length > 0 && (
          <div className="p-3 rounded-lg border border-gypi-amber/40 bg-gypi-amber/10 text-[13px]">
            <b className="text-gypi-amber-ink">En Gypi pero no en {dice} ({res.sin_banco.length}):</b>
            <p className="m-0 mt-0.5 text-gypi-dim">{planilla ? "Si la planilla está completa," : "El extracto suele estar bien:"} si alguna de estas está mal o sobra, corregila o anulala acá.</p>
            <ul className="list-none m-0 mt-1 p-0 flex flex-col gap-0.5" aria-label={`No están en ${dice}`}>
              {res.sin_banco.slice(0, 100).map((o) => (
                <li key={o.id} className="flex flex-wrap items-start gap-x-2 gap-y-1">
                  <span className="flex-1 min-w-[200px]">
                    <span className="font-mono">{fechaCorta(o.fecha)}</span> <b className="font-mono">{plata(movimientoEnCuenta(o, caja.cuenta), "ARS")}</b> {o.tipo}{o.entidad ? ` · ${o.entidad}` : ""}{o.descripcion ? ` · ${o.descripcion}` : ""} · {origenCorto(o)}
                    {repetidas.has(o.id) && <span className="text-gypi-red font-semibold"> · 🔁 parece repetida</span>}
                  </span>
                  <button type="button" className="g-btn g-btn-secondary !py-0.5 !px-2 text-[12px]" onClick={() => setDetalle(o)}>✏ Corregir o anular</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {res && resumen && resumen.n > 0 && (
          <section aria-label="Resumen de la carga" className="rounded-lg border border-gypi-border bg-gypi-surface p-2 text-[13px] text-gypi-text">
            <p className="m-0">Vas a cargar <b>{resumen.n}</b> movimientos: entran <b className="font-mono text-gypi-green">{plata(resumen.entra, "ARS")}</b> y salen <b className="font-mono text-gypi-red">{plata(resumen.sale, "ARS")}</b>.</p>
            <p className="m-0">Al {fechaCorta(res.hasta)}, Gypi queda en <b className="font-mono">{plata(resumen.queda, "ARS")}</b>
              {resumen.diferencia == null ? "." : resumen.cierra
                ? <span className="text-gypi-green"> ✓ igual que {dice}.</span>
                : <span className="text-gypi-red"> y {dice} dice {plata(res.control.final, "ARS")}: diferencia de {plata(resumen.diferencia, "ARS")}.</span>}
            </p>
          </section>
        )}
        {detalle && <Detalle op={detalle} datos={datos} onCerrar={() => setDetalle(null)} onAnulada={() => { setDetalle(null); releer(); }} />}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {res && <button type="button" className="g-btn g-btn-secondary" onClick={() => { setRes(null); setFilas([]); }}>Subir otro</button>}
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cerrar</button>
          {res && (
            <button type="button" className="g-btn g-btn-primary" disabled={guardando || !elegidas.length || incompletas.length > 0} onClick={cargar}>
              {guardando ? "Cargando…" : incompletas.length ? `Faltan ${incompletas.length} sin tipo o cuenta` : `Cargar ${elegidas.length} movimientos`}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
