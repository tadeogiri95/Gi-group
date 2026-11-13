'use client';
// app/components/FinanzasMayor.jsx — Finanzas → 📚 Mayor de cuentas (13/11,
// pedido de Tadeo; /api/finanzas/mayor; reglas en app/lib/finanzasMayor.js).
//
// Arriba, todas las cuentas del plan con su saldo (las que tienen el saldo al
// revés, marcadas con ⚠). Tocando una se ve su mayor: el saldo de apertura y
// cada movimiento con su saldo; tocando un movimiento se abre su detalle para
// corregirlo o anularlo. "＋ Asiento" carga un asiento de registro o de
// ajuste con el debe y el haber a elección (con los mismos controles que
// cualquier operación); en una cuenta al revés propone el saldo inicial.
//
// Esto es lo percibido y lo devengado juntos, en cada cuenta: la plata que se
// movió está en 💰 Tesorería y lo devengado del mes, en Devengamiento.
// Solo el rol Dueño.
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { nombreTipo } from "../lib/finanzasTipos";
import { hoyAr, inicioMes, numero, plata, validarOperacion } from "../lib/finanzasOperaciones";
import { asientoPropuesto } from "../lib/finanzasMayor";
import { fechaCorta } from "../lib/finanzasPagos";
import { textoOt } from "../lib/nombreOt";
import { Detalle } from "./FinanzasMovimientos";
import AvisoRepetidos, { repetidosDe } from "./FinanzasAvisoRepetidos";
import { Chip, Modal, SelectBuscable, Spinner } from "./ui";
import { useToast } from "./ui/Toast";

const normal = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const nombreCuenta = (codigo, cuentas = []) => {
  const c = cuentas.find((x) => x.codigo === codigo);
  return c ? `${c.codigo} · ${c.nombre}` : codigo;
};
const colorSaldo = (n) => (n < 0 ? "text-gypi-red" : "text-gypi-text");

/* ─── Asiento de registro o de ajuste ────────────────────────────────── */

/** Los tipos para un asiento: primero los de ajustes, después el resto. */
function tiposParaAsiento(tipos = []) {
  const activos = tipos.filter((t) => t.activo !== false);
  const ajuste = (t) => /AJUSTE/i.test(normal(t.grupo));
  return [...activos.filter(ajuste), ...activos.filter((t) => !ajuste(t))];
}

export function NuevoAsiento({ datos, inicial, onCerrar, onGuardado }) {
  const toast = useToast();
  const tipos = useMemo(() => tiposParaAsiento(datos.tipos), [datos.tipos]);
  const [f, setF] = useState(() => ({
    entidad: "",
    ...inicial,
    tipo: tipos.some((t) => t.codigo === inicial.tipo) ? inicial.tipo : (tipos.find((t) => t.codigo === "RECLASIF") ? "RECLASIF" : ""),
  }));
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [repetidos, setRepetidos] = useState(null);
  const set = (k) => (e) => { setRepetidos(null); setErrores([]); setF((x) => ({ ...x, [k]: e.target.value })); };
  // Solo las cuentas donde se imputa (no las que juntan otras, como "Caja")
  const imputables = useMemo(() => {
    const cs = (datos.cuentas || []).filter((c) => c.activa !== false);
    return cs.filter((c) => !cs.some((x) => x.codigo !== c.codigo && x.codigo.startsWith(`${c.codigo}.`)));
  }, [datos.cuentas]);
  const tipo = tipos.find((t) => t.codigo === f.tipo);
  const importe = numero(f.importe);

  const guardar = async (confirmarRepetido = false) => {
    const operacion = { fecha: f.fecha, tipo: f.tipo, cuenta_debe: f.cuenta_debe, cuenta_haber: f.cuenta_haber, neto: f.importe, iva: "", otros_impuestos: "", moneda: "ARS", descripcion: f.descripcion, entidad: f.entidad };
    const { errores: e } = validarOperacion(operacion, datos);
    setErrores(e);
    if (e.length) return;
    setGuardando(true);
    try {
      const res = await apiFetch("/api/finanzas/operaciones", { method: "POST", body: JSON.stringify({ accion: "crear", operacion, confirmar_repetido: confirmarRepetido }) });
      const d = await res.json().catch(() => ({}));
      const rep = repetidosDe(res.status, d);
      if (rep) { setRepetidos(rep); return; }
      if (!res.ok) { setErrores(d.errores || [d.error || "No se pudo guardar"]); return; }
      toast.success("✅ Asiento guardado");
      onGuardado();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setGuardando(false);
    }
  };

  const etiqueta = "flex flex-col gap-1 text-[13px] text-gypi-dim";
  const selectCuenta = (lado) => (
    <label className={etiqueta}>
      {lado === "debe" ? "Cuenta del debe (aumenta un activo o un gasto)" : "Cuenta del haber (aumenta un pasivo, el patrimonio o un ingreso)"}
      <SelectBuscable className="g-input w-full" listaAncha value={f[`cuenta_${lado}`]} onChange={set(`cuenta_${lado}`)} aria-label={`Cuenta del ${lado}`}>
        <option value="">Elegí…</option>
        {imputables.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nombre}</option>)}
      </SelectBuscable>
    </label>
  );

  return (
    <Modal open onClose={onCerrar} title="＋ Asiento de registro o de ajuste" maxWidth={560}>
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] text-gypi-dim">
          Para registrar algo que no pasó por una caja (un saldo inicial, una reclasificación, una amortización) o para corregir el saldo de una cuenta.
          Va siempre en pesos y se puede corregir o anular después.
        </p>
        {inicial.como && <p className="m-0 p-2 rounded-lg bg-gypi-green/10 text-[13px] text-gypi-text">✨ Gypi propone: {inicial.como}. Revisalo y corregilo si hace falta.</p>}
        {inicial.tipo === "SALDO INICIAL" && (
          <p className="m-0 text-[13px] text-gypi-amber-ink">
            Te propongo el saldo inicial que deja la cuenta en cero, el día antes de su primer movimiento. Si ese día había más (por ejemplo, títulos que todavía tenés), poné el importe real.
          </p>
        )}
        <label className={etiqueta}>Fecha
          <input type="date" className="g-input w-full" value={f.fecha} onChange={set("fecha")} />
        </label>
        <label className={etiqueta}>Tipo de operación
          <SelectBuscable className="g-input w-full" listaAncha value={f.tipo} onChange={set("tipo")} aria-label="Tipo de operación">
            <option value="">Elegí…</option>
            {tipos.map((t) => <option key={t.codigo} value={t.codigo}>{nombreTipo(t)}</option>)}
          </SelectBuscable>
        </label>
        {selectCuenta("debe")}
        {selectCuenta("haber")}
        <label className={etiqueta}>Importe ($)
          <input className="g-input w-full" inputMode="decimal" value={f.importe} onChange={set("importe")} placeholder="0,00" />
        </label>
        {tipo?.pide_entidad && (
          <label className={etiqueta}>Proveedor o cliente
            <input className="g-input w-full" value={f.entidad} onChange={set("entidad")} />
          </label>
        )}
        <label className={etiqueta}>Descripción
          <input className="g-input w-full" value={f.descripcion} onChange={set("descripcion")} maxLength={500} placeholder="Por qué se hace este asiento" />
        </label>
        {f.cuenta_debe && f.cuenta_haber && importe !== 0 && !Number.isNaN(importe) && (
          <section aria-label="Así queda el asiento" className="rounded-lg border border-gypi-border bg-gypi-surface p-2 text-[13px] text-gypi-text">
            {importe < 0 && <p className="m-0 mb-1 text-gypi-amber-ink">Con el importe en negativo el asiento va al revés: así se carga, por ejemplo, el saldo inicial de una caja que funciona como cuenta corriente.</p>}
            <p className="m-0 flex justify-between gap-2"><span>Debe: {nombreCuenta(importe < 0 ? f.cuenta_haber : f.cuenta_debe, datos.cuentas)}</span><b className="font-mono">{plata(Math.abs(importe))}</b></p>
            <p className="m-0 flex justify-between gap-2 pl-4"><span>Haber: {nombreCuenta(importe < 0 ? f.cuenta_debe : f.cuenta_haber, datos.cuentas)}</span><b className="font-mono">{plata(Math.abs(importe))}</b></p>
          </section>
        )}
        {errores.length > 0 && (
          <ul role="alert" className="m-0 pl-4 text-[13px] text-gypi-red">{errores.map((e) => <li key={e}>{e}</li>)}</ul>
        )}
        <AvisoRepetidos repetidos={repetidos} ocupado={guardando} onCancelar={() => setRepetidos(null)} onCargarIgual={() => guardar(true)} />
        {!repetidos && (
          <div className="flex justify-end gap-2">
            <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
            <button type="button" className="g-btn g-btn-primary" disabled={guardando} onClick={() => guardar(false)}>{guardando ? "Guardando…" : "Guardar asiento"}</button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ─── Mayor de una cuenta ────────────────────────────────────────────── */

function MayorDeCuenta({ fila, datos, periodo, setPeriodo, onVolver, onAsiento, onAbrir }) {
  const m = datos.mayor;
  const cuentas = datos.cuentas || [];
  const cargando = !m || m.cuenta !== fila.codigo;
  return (
    <section className="flex flex-col gap-3" aria-label={`Mayor de ${fila.nombre}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="g-btn g-btn-secondary" onClick={onVolver}>← Todas las cuentas</button>
        <h3 className="m-0 flex-1 min-w-[200px] text-[16px] font-bold text-gypi-text break-words">{fila.codigo} · {fila.nombre}</h3>
        {!fila.hijas && <button type="button" className="g-btn g-btn-primary" onClick={() => onAsiento(fila, m?.primera)}>＋ Asiento en esta cuenta</button>}
      </div>
      <p className="m-0 text-[14px] text-gypi-text">Saldo al {fechaCorta(datos.hasta)}: <b className={`font-mono ${colorSaldo(fila.saldo)}`}>{plata(fila.saldo)}</b>
        {fila.hijas && <span className="text-gypi-dim text-[12px]"> (suma las cuentas de abajo)</span>}
      </p>
      {fila.al_reves && (
        <div role="alert" className="rounded-lg border border-gypi-amber/50 bg-gypi-amber/10 p-3 text-[13px] text-gypi-text flex flex-col gap-2">
          <p className="m-0">⚠ {fila.al_reves}</p>
          {!fila.hijas && (
            <button type="button" className="g-btn g-btn-primary self-start" disabled={cargando} onClick={() => onAsiento(fila, m?.primera, true)}>📥 Cargar el saldo inicial</button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[12px] text-gypi-dim">Desde
          <input type="date" className="g-input" value={periodo.desde} onChange={(e) => setPeriodo((p) => ({ ...p, desde: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-gypi-dim">Hasta
          <input type="date" className="g-input" value={periodo.hasta} onChange={(e) => setPeriodo((p) => ({ ...p, hasta: e.target.value }))} />
        </label>
        <Chip active={false} onClick={() => setPeriodo({ desde: "2000-01-01", hasta: hoyAr() })}>Desde el principio</Chip>
      </div>
      {cargando ? <Spinner /> : (
        <>
          {m.recortado && <p className="m-0 text-[12px] text-gypi-amber-ink">Hay muchos movimientos: se ven los últimos 1.500. Achicá las fechas para ver los anteriores.</p>}
          <div className="overflow-x-auto border border-gypi-border rounded-lg">
            <table className="w-full border-collapse text-[13px]" aria-label="Movimientos de la cuenta">
              <thead>
                <tr className="bg-gypi-surface text-gypi-dim">
                  <th className="text-left px-2 py-1.5">Fecha</th>
                  <th className="text-left px-2 py-1.5">Movimiento</th>
                  <th className="text-right px-2 py-1.5">Debe</th>
                  <th className="text-right px-2 py-1.5">Haber</th>
                  <th className="text-right px-2 py-1.5">Saldo</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-gypi-border">
                  <td className="px-2 py-1.5 font-mono">{fechaCorta(m.desde)}</td>
                  <td className="px-2 py-1.5 text-gypi-dim">Saldo de apertura (todo lo anterior)</td>
                  <td /><td />
                  <td className={`px-2 py-1.5 text-right font-mono ${colorSaldo(m.apertura)}`}>{plata(m.apertura)}</td>
                </tr>
                {m.renglones.map((r) => (
                  <tr key={r.op.id} className="border-t border-gypi-border hover:bg-gypi-surface">
                    <td className="px-2 py-1.5 font-mono align-top">{fechaCorta(r.op.fecha)}</td>
                    <td className="px-2 py-1.5 align-top">
                      <button type="button" className="text-left text-gypi-text bg-transparent border-0 p-0 cursor-pointer" onClick={() => onAbrir(r.op)}>
                        {nombreTipo(datos.tipos?.find((t) => t.codigo === r.op.tipo) || { codigo: r.op.tipo })}
                        {(r.op.entidad || r.op.descripcion) && <span className="text-gypi-dim"> · {r.op.entidad || r.op.descripcion}</span>}
                      </button>
                      {r.contra.length > 0 && <p className="m-0 text-[12px] text-gypi-dim break-words">contra {r.contra.map((c) => nombreCuenta(c, cuentas)).join(", ")}</p>}
                      {r.op.moneda === "USD" && <p className="m-0 text-[12px] text-gypi-dim">{plata(r.op.total, "USD")} a {String(r.op.tipo_cambio || "").replace(".", ",")}</p>}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono align-top">{r.debe ? plata(r.debe) : ""}</td>
                    <td className="px-2 py-1.5 text-right font-mono align-top">{r.haber ? plata(r.haber) : ""}</td>
                    <td className={`px-2 py-1.5 text-right font-mono align-top ${colorSaldo(r.saldo)}`}>{plata(r.saldo)}</td>
                  </tr>
                ))}
                {!m.renglones.length && (
                  <tr className="border-t border-gypi-border"><td colSpan={5} className="px-2 py-3 text-center text-gypi-dim">No hay movimientos en estas fechas.</td></tr>
                )}
              </tbody>
              {m.renglones.length > 0 && (
                <tfoot>
                  <tr className="border-t border-gypi-border bg-gypi-surface font-semibold">
                    <td colSpan={2} className="px-2 py-1.5">Total del período</td>
                    <td className="px-2 py-1.5 text-right font-mono">{plata(m.debe)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{plata(m.haber)}</td>
                    <td className={`px-2 py-1.5 text-right font-mono ${colorSaldo(m.saldo)}`}>{plata(m.saldo)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="m-0 text-[12px] text-gypi-dim">Lo que está en dólares se pasa a pesos con el tipo de cambio de cada operación. Tocá un movimiento para ver su asiento, corregirlo o anularlo.</p>
        </>
      )}
    </section>
  );
}

/* ─── Pantalla ───────────────────────────────────────────────────────── */

export default function FinanzasMayor() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [buscar, setBuscar] = useState("");
  const [ver, setVer] = useState("con"); // con movimientos | reves | todas
  const [elegida, setElegida] = useState("");
  const [periodo, setPeriodo] = useState(() => ({ desde: inicioMes(hoyAr()), hasta: hoyAr() }));
  const [asiento, setAsiento] = useState(null);
  const [detalle, setDetalle] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const q = elegida ? `?cuenta=${encodeURIComponent(elegida)}&desde=${periodo.desde}&hasta=${periodo.hasta}` : "";
      const res = await apiFetch(`/api/finanzas/mayor${q}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo cargar el mayor");
      setDatos(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [elegida, periodo]);
  useEffect(() => { cargar(); }, [cargar]);

  const saldos = useMemo(() => datos?.saldos || [], [datos]);
  const reves = saldos.filter((s) => s.al_reves && !s.hijas);
  const lista = useMemo(() => {
    const q = normal(buscar).trim();
    return saldos.filter((s) => {
      if (ver === "con" && !s.movimientos) return false;
      if (ver === "reves" && !(s.al_reves && !s.hijas)) return false;
      return !q || normal(`${s.codigo} ${s.nombre}`).includes(q);
    });
  }, [saldos, buscar, ver]);

  const nombres = useMemo(() => {
    const prov = new Map((datos?.proveedores || []).map((p) => [String(p.id), p.nombre]));
    const ots = new Map((datos?.proyectos || []).map((p) => [String(p.id), p]));
    return {
      entidad: (op) => (op.proveedor_id ? prov.get(String(op.proveedor_id)) : null) || op.entidad || "",
      ot: (op) => (op.proyecto_id && ots.get(String(op.proyecto_id)) ? textoOt(ots.get(String(op.proyecto_id))) : ""),
    };
  }, [datos]);

  const abrirAsiento = (fila, primera, saldoInicial = false) => {
    const hoy = hoyAr();
    const base = { fecha: hoy, tipo: "", cuenta_debe: fila?.codigo && !fila.hijas ? fila.codigo : "", cuenta_haber: "", importe: "", descripcion: "" };
    setAsiento(saldoInicial ? asientoPropuesto(fila, { cuentas: datos?.cuentas || [], primera, hoy }) : base);
  };
  const guardado = () => { setAsiento(null); cargar(); };

  if (error) return <p role="alert" className="m-[18px] text-[14px] text-gypi-red">⚠ {error}</p>;
  if (!datos) return <Spinner />;
  const fila = elegida ? saldos.find((s) => s.codigo === elegida) : null;

  return (
    // 13/11 (revisión de la navegación): con su propia barra para bajar; sin
    // overflow-y-auto la lista de cuentas quedaba cortada y no se llegaba al final
    <div className="flex-1 min-h-0 overflow-y-auto p-3 pb-6">
      <div className="flex flex-col gap-3">
      {fila ? (
        <MayorDeCuenta fila={fila} datos={datos} periodo={periodo} setPeriodo={setPeriodo} onVolver={() => setElegida("")} onAsiento={abrirAsiento} onAbrir={setDetalle} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <p className="m-0 flex-1 min-w-[220px] text-[13px] text-gypi-dim">Cada cuenta del plan con su saldo al {fechaCorta(datos.hasta)}. Tocá una para ver sus movimientos.</p>
            <button type="button" className="g-btn g-btn-primary" onClick={() => abrirAsiento(null)}>＋ Asiento de registro o de ajuste</button>
          </div>
          {reves.length > 0 && (
            <p role="status" className="m-0 rounded-lg border border-gypi-amber/50 bg-gypi-amber/10 p-2 text-[13px] text-gypi-text">
              ⚠ {reves.length === 1 ? "1 cuenta tiene" : `${reves.length} cuentas tienen`} el saldo al revés. Casi siempre falta el saldo inicial: entrá a la cuenta y tocá «📥 Cargar el saldo inicial».
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input className="g-input flex-1 min-w-[200px]" placeholder="Buscar cuenta por nombre o código" value={buscar} onChange={(e) => setBuscar(e.target.value)} aria-label="Buscar cuenta" />
            <Chip active={ver === "con"} onClick={() => setVer("con")}>Con movimientos</Chip>
            <Chip active={ver === "reves"} onClick={() => setVer("reves")}>⚠ Al revés ({reves.length})</Chip>
            <Chip active={ver === "todas"} onClick={() => setVer("todas")}>Todas</Chip>
          </div>
          {datos.truncado && <p className="m-0 text-[12px] text-gypi-amber-ink">Hay demasiadas operaciones: los saldos pueden no estar completos.</p>}
          <ul className="list-none m-0 p-0 flex flex-col border border-gypi-border rounded-lg overflow-hidden" aria-label="Cuentas">
            {lista.map((s) => (
              <li key={s.codigo} className="border-t first:border-t-0 border-gypi-border">
                <button type="button" className="w-full flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-left bg-transparent border-0 cursor-pointer hover:bg-gypi-surface"
                  onClick={() => { setElegida(s.codigo); setPeriodo({ desde: inicioMes(hoyAr()), hasta: hoyAr() }); }}>
                  <span className={`flex-1 min-w-[180px] text-[14px] text-gypi-text break-words ${s.hijas ? "font-semibold" : ""}`}>
                    {s.al_reves && !s.hijas && "⚠ "}<span className="font-mono text-[12px] text-gypi-dim">{s.codigo}</span> {s.nombre}
                  </span>
                  <span className="text-[12px] text-gypi-dim">{s.movimientos} mov.</span>
                  <b className={`font-mono text-[14px] ${colorSaldo(s.saldo)}`}>{plata(s.saldo)}</b>
                </button>
              </li>
            ))}
            {!lista.length && <li className="px-3 py-4 text-center text-[13px] text-gypi-dim">No hay cuentas con ese filtro.</li>}
          </ul>
        </>
      )}
      {asiento && <NuevoAsiento datos={datos} inicial={asiento} onCerrar={() => setAsiento(null)} onGuardado={guardado} />}
      {detalle && (
        <Detalle op={detalle} datos={datos} nombres={nombres} onCerrar={() => setDetalle(null)}
          onAnulada={() => { setDetalle(null); cargar(); }} onAdjuntos={cargar} />
      )}
      </div>
    </div>
  );
}
