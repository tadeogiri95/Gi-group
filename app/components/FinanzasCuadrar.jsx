'use client';
// app/components/FinanzasCuadrar.jsx — Finanzas → 🧾 Configuración →
// 🧮 Cuadrar con el libro (13/11; /api/finanzas/cuadrar, reglas en
// app/lib/finanzasCuadrar.js).
//
// Se sube el libro (.xlsx). Por cada caja y banco, hasta lo último que tiene
// el libro, se ve el saldo del libro, el de Gypi y, si no coinciden, qué
// sobra en Gypi (con su origen) y qué falta. Lo que sobra y vino de cargar
// algo de afuera (extracto, plazos fijos, saldos iniciales…) sale tildado;
// lo hecho en Gypi (pagos, cobros, Mi caja…) no. Se anula lo tildado después
// de confirmar; nada se borra.
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { DESDE_HISTORICO } from "../lib/finanzasHistorico";
import { MAX_ANULAR_CUADRAR, cuadrarConLibro, resumenVaciar } from "../lib/finanzasCuadrar";
import { hoyAr } from "../lib/finanzasOperaciones";
import { fechaCorta } from "../lib/finanzasPagos";
import { Modal, Spinner } from "./ui";
import { useToast } from "./ui/Toast";

const normal = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z]/g, "");
const plata = (n, moneda = "ARS") => `${moneda === "USD" ? "US$" : "$"} ${(Number(n) || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

async function leerOperacionesDelLibro(file) {
  const { hojasXlsx, leerHojaXlsx } = await import("../lib/leerXlsx");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hoja = hojasXlsx(bytes).find((n) => normal(n) === "TOPERACIONES");
  if (!hoja) return null;
  return leerHojaXlsx(bytes, hoja, { maxFilas: 60000, maxCols: 60 }) || [];
}

async function leerGypi() {
  const res = await apiFetch("/api/finanzas/cuadrar");
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "No se pudo leer lo de Gypi");
  return d;
}

function Caja({ c, elegidas, alternar }) {
  const quitado = c.sobran.reduce((s, x) => s + (elegidas.has(x.id) ? x.importe : 0), 0);
  const queda = Math.round((c.diferencia - quitado) * 100) / 100;
  const ok = Math.abs(c.diferencia) < 0.01 && !c.sobran.length && !c.faltan.length;
  return (
    <details open={!ok && Math.abs(c.diferencia) >= 0.01} className="border border-gypi-border rounded-lg">
      <summary className="cursor-pointer p-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px]">
        <b className="flex-1 min-w-[160px]">{ok ? "✅" : "⚠"} {c.nombre}</b>
        <span>Libro {plata(c.saldo_libro, c.moneda)}</span>
        <span>Gypi {plata(c.saldo_gypi, c.moneda)}</span>
        {!ok && <span className={Math.abs(c.diferencia) >= 0.01 ? "font-semibold text-gypi-red" : ""}>Diferencia {plata(c.diferencia, c.moneda)}</span>}
      </summary>
      {!ok && (
        <div className="px-2 pb-2 flex flex-col gap-2 text-[13px]">
          {c.sobran.length > 0 && (
            <div>
              <p className="m-0 font-semibold">Está en Gypi y no en el libro ({c.sobran.length})</p>
              <ul className="m-0 p-0 list-none flex flex-col gap-1 mt-1" aria-label={`Sobra en ${c.nombre}`}>
                {c.sobran.map((s) => (
                  <li key={s.id}>
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-1" checked={elegidas.has(s.id)} onChange={() => alternar(s.id)} aria-label={`Anular ${fechaCorta(s.fecha)} ${plata(s.importe, c.moneda)}`} />
                      <span>
                        <b>{fechaCorta(s.fecha)}</b> · <b>{plata(s.importe, c.moneda)}</b> · {s.tipo}{s.descripcion ? ` · ${s.descripcion}` : ""}
                        <span className="block text-[12px] text-gypi-dim">{s.nombre_origen}{s.importada ? "" : " · hecha en Gypi: revisá antes de anular"}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {c.faltan.length > 0 && (
            <div>
              <p className="m-0 font-semibold">Está en el libro y no en Gypi ({c.faltan.length})</p>
              <ul className="m-0 pl-5 flex flex-col gap-0.5 mt-1" aria-label={`Falta en ${c.nombre}`}>
                {c.faltan.map((f, i) => (
                  <li key={f.clave || `a${i}`}>
                    <b>{fechaCorta(f.fecha)}</b> · <b>{plata(f.importe, c.moneda)}</b> · {f.tipo}{f.descripcion ? ` · ${f.descripcion}` : ""}{f.fila ? ` (renglón ${f.fila})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {c.sobran.length > 0 && (
            <p className="m-0 text-[12px] text-gypi-dim">
              Si anulás lo tildado, la diferencia queda en <b className={Math.abs(queda) >= 0.01 ? "text-gypi-red" : "text-gypi-green"}>{plata(queda, c.moneda)}</b>
              {c.faltan.length > 0 ? " (y se arregla del todo cuando pases lo que falta)." : "."}
            </p>
          )}
          {c.otra_moneda > 0 && <p className="m-0 text-[12px] text-gypi-dim">{c.otra_moneda} renglones del libro de esta caja están en otra moneda: no se comparan.</p>}
        </div>
      )}
    </details>
  );
}

function Cuadrar({ onCerrar, onCambio }) {
  const toast = useToast();
  const [grilla, setGrilla] = useState(null);
  const [gypi, setGypi] = useState(null);
  const [corte, setCorte] = useState("");
  const [desde, setDesde] = useState(DESDE_HISTORICO);
  const [elegidas, setElegidas] = useState(null);
  const [leyendo, setLeyendo] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [error, setError] = useState(null);

  async function abrir(file) {
    if (!file) return;
    setLeyendo(true);
    setError(null);
    try {
      const [g, d] = await Promise.all([leerOperacionesDelLibro(file), leerGypi()]);
      if (!g) throw new Error("El archivo no tiene la hoja T-OPERACIONES.");
      setGrilla(g);
      setGypi(d);
      setElegidas(null);
      setCorte("");
    } catch (e) {
      setError(e.message || "No se pudo leer el archivo");
    } finally {
      setLeyendo(false);
    }
  }

  const res = useMemo(() => {
    if (!grilla || !gypi || !FECHA.test(desde)) return null;
    return cuadrarConLibro({ grilla, ops: gypi.operaciones, tesoreria: gypi.tesoreria, corte: FECHA.test(corte) ? corte : null, desde, hoy: hoyAr() });
  }, [grilla, gypi, corte, desde]);
  // Lo tildado: al principio, lo que vino de afuera
  const sel = useMemo(() => elegidas || new Set(res?.anulables || []), [elegidas, res]);
  const sobran = useMemo(() => {
    const m = new Map();
    for (const c of res?.cajas || []) for (const s of c.sobran) if (!m.has(s.id)) m.set(s.id, s);
    return m;
  }, [res]);
  const tildadas = [...sel].filter((id) => sobran.has(id));
  const conDiferencia = (res?.cajas || []).filter((c) => Math.abs(c.diferencia) >= 0.01 || c.sobran.length || c.faltan.length);
  const faltan = (res?.cajas || []).reduce((n, c) => n + c.faltan.length, 0);

  function alternar(id) {
    const s = new Set(sel);
    if (s.has(id)) s.delete(id); else s.add(id);
    setElegidas(s);
  }

  async function anular() {
    setAnulando(true);
    setError(null);
    try {
      let total = 0;
      for (let i = 0; i < tildadas.length; i += MAX_ANULAR_CUADRAR) {
        const r = await apiFetch("/api/finanzas/cuadrar", { method: "POST", body: JSON.stringify({ accion: "anular", ids: tildadas.slice(i, i + MAX_ANULAR_CUADRAR) }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "No se pudo anular");
        total += d.anuladas || 0;
      }
      toast.success(`Listo: ${total} operaciones anuladas`);
      setConfirmar(false);
      setElegidas(null);
      setGypi(await leerGypi());
      onCambio?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setAnulando(false);
    }
  }

  return (
    <Modal open onClose={anulando ? () => {} : onCerrar} title="Cuadrar con el libro" maxWidth={760}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px] text-gypi-dim">
          Subí el libro y Gypi compara cada caja y banco, movimiento por movimiento, hasta lo último que tiene el libro. Lo que está en Gypi y no en el libro se puede anular (no se borra); lo que falta se carga pasando el histórico con el mismo libro.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            Libro (.xlsx)
            <input type="file" accept=".xlsx" aria-label="Libro (.xlsx)" className="text-[13px]" onChange={(e) => abrir(e.target.files?.[0])} />
          </label>
          {res?.corte && (
            <>
              <label className="flex flex-col gap-1 text-[13px] font-semibold">
                Hasta
                <input type="date" className="g-input" aria-label="Hasta" value={corte || res.corte} onChange={(e) => { setCorte(e.target.value); setElegidas(null); }} />
              </label>
              <label className="flex flex-col gap-1 text-[13px] font-semibold">
                Histórico desde
                <input type="date" className="g-input" aria-label="Histórico desde" value={desde} onChange={(e) => { setDesde(e.target.value); setElegidas(null); }} />
              </label>
            </>
          )}
          {leyendo && <Spinner size={16} />}
        </div>

        {res?.error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {res.error}</p>}
        {res && !res.error && (
          <>
            <p className="m-0 text-[13px]" role="status">
              {conDiferencia.length
                ? <>Al <b>{fechaCorta(res.corte)}</b>, <b>{conDiferencia.length}</b> de {res.cajas.length} cajas y bancos no coinciden con el libro.</>
                : <>✅ Al <b>{fechaCorta(res.corte)}</b> todas las cajas y bancos coinciden con el libro.</>}
            </p>
            <div className="flex flex-col gap-2">
              {[...res.cajas].sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia)).map((c) => (
                <Caja key={c.cuenta} c={c} elegidas={sel} alternar={alternar} />
              ))}
            </div>
            {faltan > 0 && (
              <p className="m-0 text-[13px]">
                Faltan <b>{faltan}</b> renglones del libro en Gypi: después de anular, cerrá esto y apretá <b>📚 Pasar el histórico</b> con este mismo libro.
              </p>
            )}
          </>
        )}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        {confirmar ? (
          <div className="p-2 rounded-lg border border-gypi-red flex flex-col gap-2" role="alertdialog" aria-label="Confirmar anulación">
            <p className="m-0 text-[13px]">
              ¿Anular <b>{tildadas.length}</b> operaciones? No se borran: quedan anuladas, con tu nombre, y se ven en Movimientos.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className="g-btn g-btn-secondary" disabled={anulando} onClick={() => setConfirmar(false)}>Volver</button>
              <button type="button" className="g-btn g-btn-primary" disabled={anulando} onClick={anular}>{anulando ? "Anulando…" : "Sí, anular"}</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cerrar</button>
            {res && !res.error && (
              <button type="button" className="g-btn g-btn-primary" disabled={!tildadas.length} onClick={() => setConfirmar(true)}>
                Anular {tildadas.length} tildadas
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

async function postCuadrar(body) {
  const r = await apiFetch("/api/finanzas/cuadrar", { method: "POST", body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "No se pudo guardar");
  return d;
}

function EmpezarDeNuevo({ onCerrar, onCambio }) {
  const toast = useToast();
  const [gypi, setGypi] = useState(null);
  const [alcance, setAlcance] = useState("importado");
  const [confirmar, setConfirmar] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [hecho, setHecho] = useState(null);
  const [error, setError] = useState(null);

  async function leer() {
    setError(null);
    try { setGypi(await leerGypi()); } catch (e) { setError(e.message); }
  }
  useEffect(() => { leer(); }, []);

  const resumen = useMemo(() => (gypi ? resumenVaciar(gypi.operaciones, alcance) : null), [gypi, alcance]);

  async function vaciar() {
    setTrabajando(true);
    setError(null);
    try {
      const d = await postCuadrar({ accion: "vaciar", alcance, esperadas: resumen.ids.length });
      toast.success(`Listo: ${d.anuladas} movimientos anulados`);
      setHecho(d.marca || null);
      setConfirmar(false);
      await leer();
      onCambio?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setTrabajando(false);
    }
  }

  async function deshacer(marca) {
    setTrabajando(true);
    setError(null);
    try {
      const d = await postCuadrar({ accion: "deshacer", marca });
      toast.success(`Listo: ${d.vueltas} movimientos volvieron`);
      setHecho(null);
      await leer();
      onCambio?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setTrabajando(false);
    }
  }

  const ultimo = hecho || gypi?.ultimo_vaciado || null;
  return (
    <Modal open onClose={trabajando ? () => {} : onCerrar} title="Empezar de nuevo las cajas y bancos" maxWidth={620}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px] text-gypi-dim">
          Anula los movimientos de todas las cajas y bancos para volver a cargarlos: primero 📚 Pasar el histórico con el libro, después los extractos y la planilla de plazos fijos hasta hoy. No se borra nada: quedan anulados con una marca y se pueden volver atrás. Facturas, órdenes de pago, cheques, clientes, proveedores, plan de cuentas y tipos no se tocan.
        </p>
        {!gypi && !error && <Spinner size={16} />}
        {resumen && (
          <>
            <fieldset className="m-0 p-0 border-0 flex flex-col gap-1.5" aria-label="Qué se anula">
              <label className="flex items-start gap-2 text-[13px]">
                <input type="radio" name="alcance" className="mt-1" checked={alcance === "importado"} onChange={() => { setAlcance("importado"); setConfirmar(false); }} />
                <span><b>Lo cargado de afuera y a mano</b> (libro, saldos iniciales, extractos, plazos fijos, FCI, Movimientos). Quedan los pagos, cobros, cheques, Mi caja y sueldos hechos en Gypi.</span>
              </label>
              <label className="flex items-start gap-2 text-[13px]">
                <input type="radio" name="alcance" className="mt-1" checked={alcance === "todo"} onChange={() => { setAlcance("todo"); setConfirmar(false); }} />
                <span><b>Todo lo que pasa por cajas y bancos</b>, también lo hecho en Gypi. Las órdenes de pago y cobros pueden quedar como hechos sin su movimiento.</span>
              </label>
            </fieldset>
            <div className="text-[13px]" role="status">
              <p className="m-0">Se anulan <b>{resumen.ids.length}</b> movimientos{resumen.quedan ? `; quedan ${resumen.quedan} hechos en Gypi` : ""}.</p>
              <ul className="m-0 pl-5" aria-label="Por origen">
                {resumen.porOrigen.map((o) => <li key={o.origen}>{o.nombre}: {o.n}</li>)}
              </ul>
            </div>
          </>
        )}
        {ultimo && (
          <div className="p-2 rounded-lg border border-gypi-border flex flex-wrap items-center gap-2 text-[13px]">
            <span className="flex-1 min-w-[200px]">Última vez: <b>{ultimo}</b>. {hecho ? "Ahora pasá el histórico con el libro." : ""}</span>
            <button type="button" className="g-btn g-btn-secondary" disabled={trabajando} onClick={() => deshacer(ultimo)}>Deshacer</button>
          </div>
        )}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        {confirmar ? (
          <div className="p-2 rounded-lg border border-gypi-red flex flex-col gap-2" role="alertdialog" aria-label="Confirmar empezar de nuevo">
            <p className="m-0 text-[13px]">¿Anular <b>{resumen.ids.length}</b> movimientos de las cajas y bancos? Los saldos van a quedar en cero hasta que pases el histórico.</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="g-btn g-btn-secondary" disabled={trabajando} onClick={() => setConfirmar(false)}>Volver</button>
              <button type="button" className="g-btn g-btn-primary" disabled={trabajando} onClick={vaciar}>{trabajando ? "Anulando…" : "Sí, empezar de nuevo"}</button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cerrar</button>
            <button type="button" className="g-btn g-btn-primary" disabled={!resumen?.ids.length || trabajando} onClick={() => setConfirmar(true)}>
              Anular {resumen?.ids.length || 0}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function FinanzasCuadrar({ onCambio }) {
  const [abierto, setAbierto] = useState(false);
  const [vaciar, setVaciar] = useState(false);
  return (
    <section aria-label="Cuadrar con el libro" className="mb-3 p-3 border border-gypi-border rounded-lg">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[220px]">
          <h3 className="m-0 text-[14px] font-bold text-gypi-text">🧮 Cuadrar con el libro</h3>
          <p className="m-0 text-[13px] text-gypi-dim">Compara cada caja y banco de Gypi con el libro y muestra lo repetido para anularlo, o empieza de nuevo para volver a cargar todo.</p>
        </div>
        <button type="button" className="g-btn g-btn-secondary" onClick={() => setAbierto(true)}>Cuadrar</button>
        <button type="button" className="g-btn g-btn-secondary" onClick={() => setVaciar(true)}>🧹 Empezar de nuevo</button>
      </div>
      {abierto && <Cuadrar onCerrar={() => setAbierto(false)} onCambio={onCambio} />}
      {vaciar && <EmpezarDeNuevo onCerrar={() => setVaciar(false)} onCambio={onCambio} />}
    </section>
  );
}
