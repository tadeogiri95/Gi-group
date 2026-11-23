'use client';
// app/components/FinanzasSueldos.jsx — Finanzas → 👷 Sueldos (parte F5b;
// migración 178; /api/finanzas/sueldos; reglas en app/lib/finanzasSueldos.js).
//
// Los sueldos se calculan afuera: acá se pasa la liquidación de cada período,
// un renglón por empleado y una columna por concepto (se puede pegar desde
// Excel). Al confirmarla cada importe va al libro como SUELDOS en su
// cuenta contra Sueldos A Pagar; al pagar, SUELDOS desde la caja o el
// banco de cada empleado. ⚙ Conceptos: sumar conceptos, su cuenta y la cuenta
// de sueldo del área de cada empleado.
// Solo el rol Dueño (la pantalla ni aparece para los demás).
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyAr, plata } from "../lib/finanzasOperaciones";
import { cuentasParaPagar, fechaCorta } from "../lib/finanzasPagos";
import { descontadosDe, mesDeLiquidacion, nombreMesLargo } from "../lib/finanzasAnticipos";
import { CLASES, numeroSueldo, pagadoPorEmpleado, renglonesDePegado, totalesLiquidacion } from "../lib/finanzasSueldos";
import { Chip, Modal, SelectBuscable, Spinner } from "./ui";
import { useToast } from "./ui/Toast";

const ESTADOS = { borrador: "📝 Borrador", confirmada: "✅ Confirmada", anulada: "🚫 Anulada" };
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

async function postSueldos(body) {
  const res = await apiFetch("/api/finanzas/sueldos", { method: "POST", body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "No se pudo guardar");
  return d;
}

function campo(label, input) {
  return <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">{label}{input}</label>;
}

const textoNumero = (n) => (n == null || n === "" ? "" : String(n).replace(".", ","));
/** Los valores de una liquidación como números (para los totales). */
const numerica = (renglones) => ({ renglones: renglones.map((r) => ({ ...r, valores: Object.fromEntries(Object.entries(r.valores || {}).map(([k, v]) => [k, numeroSueldo(v) || 0])) })) });

/** El período del mes anterior ("Octubre 2026"). */
function periodoAnterior() {
  const [a, m] = hoyAr().split("-").map(Number);
  return m === 1 ? `${MESES[11]} ${a - 1}` : `${MESES[m - 2]} ${a}`;
}

/* ─── Pegar desde Excel ──────────────────────────────────────────────── */

function Pegar({ conceptos, empleados, onCerrar, onListo }) {
  const [texto, setTexto] = useState("");
  const r = useMemo(() => (texto.trim() ? renglonesDePegado(texto, conceptos, empleados) : null), [texto, conceptos, empleados]);
  return (
    <Modal open onClose={onCerrar} title="Pegar desde Excel" maxWidth={600}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px] text-gypi-dim">
          Copiá la tabla de la liquidación con los títulos: la primera columna con el nombre (o el legajo) y una columna por concepto, con el mismo nombre que acá
          ({conceptos.map((c) => c.nombre).join(", ")}).
        </p>
        <textarea className="g-input w-full min-h-[160px] font-mono text-[12px]" aria-label="Tabla pegada" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={`Empleado\t${conceptos.slice(0, 3).map((c) => c.nombre).join("\t")}`} />
        {r?.error && <p className="m-0 text-[13px] text-gypi-amber-ink">{r.error}</p>}
        {r && !r.error && (
          <div className="text-[13px] flex flex-col gap-1">
            <p className="m-0">Encontré <b>{r.renglones.length}</b> empleado{r.renglones.length === 1 ? "" : "s"}.</p>
            {r.sin_empleado.length > 0 && <p className="m-0 text-gypi-amber-ink">⚠ No encontré a: {r.sin_empleado.join(", ")}. Revisá el nombre o el legajo en Personal.</p>}
            {r.sin_concepto.length > 0 && <p className="m-0 text-gypi-amber-ink">⚠ Columnas sin concepto (no se usan): {r.sin_concepto.join(", ")}. Sumalas en ⚙ Conceptos si van.</p>}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={!r?.renglones?.length} onClick={() => onListo(r.renglones)}>Usar estos datos</button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Editor de una liquidación (borrador) ───────────────────────────── */

function Editor({ datos, liquidacion, onCerrar, onCambio, onRecargar }) {
  const toast = useToast();
  const conceptos = useMemo(() => datos.conceptos.filter((c) => c.activo || (liquidacion?.renglones || []).some((r) => r.valores?.[c.codigo] != null)), [datos.conceptos, liquidacion]);
  const activos = useMemo(() => datos.empleados.filter((e) => e.activo !== false), [datos.empleados]);
  const [periodo, setPeriodo] = useState(liquidacion?.periodo || periodoAnterior());
  const [fecha, setFecha] = useState(liquidacion?.fecha || hoyAr());
  const [notas, setNotas] = useState(liquidacion?.notas || "");
  const [renglones, setRenglones] = useState(() => (liquidacion?.renglones || []).map((r) => ({ ...r, valores: Object.fromEntries(Object.entries(r.valores || {}).map(([k, v]) => [k, textoNumero(v)])) })));
  const [pegar, setPegar] = useState(false);
  const [sumar, setSumar] = useState("");
  const [error, setError] = useState(null);
  const [haciendo, setHaciendo] = useState(null);
  const [id, setId] = useState(liquidacion?.id ?? null);

  const tot = useMemo(() => totalesLiquidacion(numerica(renglones), conceptos), [renglones, conceptos]);
  const enLista = new Set(renglones.map((r) => String(r.empleado_id)));
  const faltan = activos.filter((e) => !enLista.has(String(e.id)));

  const cambiar = (i, codigo) => (e) => setRenglones((x) => x.map((r, j) => (j === i ? { ...r, valores: { ...r.valores, [codigo]: e.target.value } } : r)));
  const agregar = (emps) => setRenglones((x) => [...x, ...emps.map((e) => ({ empleado_id: String(e.id), nombre: e.nombre, valores: {} }))]);
  const quitar = (i) => setRenglones((x) => x.filter((_, j) => j !== i));
  function pegados(lista) {
    // Lo pegado reemplaza a esos empleados; los demás quedan
    const porId = new Map(lista.map((r) => [r.empleado_id, r]));
    setRenglones((x) => [
      ...x.map((r) => (porId.has(String(r.empleado_id)) ? { ...porId.get(String(r.empleado_id)), valores: Object.fromEntries(Object.entries(porId.get(String(r.empleado_id)).valores).map(([k, v]) => [k, textoNumero(v)])) } : r)),
      ...lista.filter((r) => !x.some((y) => String(y.empleado_id) === r.empleado_id)).map((r) => ({ ...r, valores: Object.fromEntries(Object.entries(r.valores).map(([k, v]) => [k, textoNumero(v)])) })),
    ]);
    setPegar(false);
  }

  async function guardar(confirmar) {
    setError(null);
    setHaciendo(confirmar ? "confirmar" : "guardar");
    try {
      const d = await postSueldos({ accion: "guardar", id, periodo, fecha, notas, renglones });
      setId(d.liquidacion.id);
      if (!confirmar) {
        toast.success("Liquidación guardada como borrador");
        return onCambio(null);
      }
      try {
        const c = await postSueldos({ accion: "confirmar", id: d.liquidacion.id });
        toast.success(`Liquidación confirmada: ${c.operaciones} importes pasaron al libro`);
        onCambio(d.liquidacion.id);
      } catch (e) {
        // Quedó guardada como borrador
        setError(e.message);
        setHaciendo(null);
        onRecargar();
      }
    } catch (e) {
      setError(e.message);
      setHaciendo(null);
    }
  }

  async function anular() {
    setHaciendo("anular");
    try {
      await postSueldos({ accion: "anular", id });
      toast.success("Borrador anulado");
      onCambio(null);
    } catch (e) {
      setError(e.message);
      setHaciendo(null);
    }
  }

  return (
    <Modal open onClose={onCerrar} title={id ? `Liquidación ${liquidacion.periodo}` : "Liquidación nueva"} maxWidth={1100}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[180px]">{campo("Período", <input className="g-input w-full" aria-label="Período" value={periodo} maxLength={60} onChange={(e) => setPeriodo(e.target.value)} />)}</div>
          {campo("Fecha del devengado", <input type="date" className="g-input" aria-label="Fecha del devengado" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />)}
          <button type="button" className="g-btn g-btn-secondary min-h-[44px]" onClick={() => setPegar(true)}>📋 Pegar desde Excel</button>
        </div>

        <div className="overflow-x-auto border border-gypi-border rounded-lg">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-gypi-surface">
                <th className="text-left px-2 py-1.5 sticky left-0 bg-gypi-surface min-w-[160px]">Empleado</th>
                {conceptos.map((c) => (
                  <th key={c.codigo} className="text-right px-2 py-1.5 font-semibold whitespace-nowrap">
                    {c.nombre}{c.clase === "horas" && <span className="block text-[12px] font-normal text-gypi-dim">horas</span>}
                  </th>
                ))}
                <th className="text-right px-2 py-1.5 whitespace-nowrap">Total $</th>
                <th aria-label="Quitar" />
              </tr>
            </thead>
            <tbody>
              {renglones.map((r, i) => (
                <tr key={r.empleado_id} className="border-t border-gypi-border">
                  <td className="px-2 py-1 sticky left-0 bg-gypi-bg font-semibold">{r.nombre}</td>
                  {conceptos.map((c) => (
                    <td key={c.codigo} className="px-1 py-1">
                      <input className="g-input w-[110px] text-right font-mono" inputMode="decimal" aria-label={`${c.nombre} de ${r.nombre}`} value={r.valores?.[c.codigo] ?? ""} onChange={cambiar(i, c.codigo)} />
                    </td>
                  ))}
                  <td className="px-2 py-1 text-right font-mono font-semibold whitespace-nowrap">{plata(tot.porEmpleado[i]?.total)}</td>
                  <td className="px-1"><button type="button" className="g-btn g-btn-secondary min-h-[36px]" aria-label={`Quitar a ${r.nombre}`} onClick={() => quitar(i)}>✕</button></td>
                </tr>
              ))}
              {renglones.length > 0 && (
                <tr className="border-t-2 border-gypi-border bg-gypi-surface font-semibold">
                  <td className="px-2 py-1.5 sticky left-0 bg-gypi-surface">Total</td>
                  {conceptos.map((c) => <td key={c.codigo} className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{c.clase === "horas" ? textoNumero(tot.porConcepto[c.codigo]) : plata(tot.porConcepto[c.codigo])}</td>)}
                  <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{plata(tot.total)}</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
          {!renglones.length && <p className="m-0 p-3 text-[13px] text-gypi-dim">Sin empleados todavía: pegá la tabla desde Excel o sumalos abajo.</p>}
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <SelectBuscable className="g-input flex-1 min-w-[200px]" aria-label="Sumar empleado" value={sumar} onChange={(e) => { const emp = activos.find((x) => String(x.id) === e.target.value); if (emp) agregar([emp]); setSumar(""); }}>
            <option value="">+ Sumar un empleado…</option>
            {faltan.map((e) => <option key={e.id} value={e.id}>{e.nombre}{e.division ? ` · ${e.division}` : ""}</option>)}
          </SelectBuscable>
          {faltan.length > 0 && <button type="button" className="g-btn g-btn-secondary" onClick={() => agregar(faltan)}>+ Todos los activos ({faltan.length})</button>}
        </div>

        {campo("Notas (opcional)", <input className="g-input w-full" aria-label="Notas" value={notas} maxLength={500} onChange={(e) => setNotas(e.target.value)} />)}
        <p className="m-0 text-[12px] text-gypi-dim">
          Al confirmar, cada importe pasa al libro como SUELDOS (devengado) en la cuenta de su concepto, contra Sueldos A Pagar. Las horas quedan como dato. Un importe negativo (un descuento) va al revés.
        </p>
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {id && <button type="button" className="g-btn g-btn-secondary" disabled={!!haciendo} onClick={anular}>🚫 Anular borrador</button>}
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cerrar</button>
          <button type="button" className="g-btn g-btn-secondary" disabled={!!haciendo} onClick={() => guardar(false)}>{haciendo === "guardar" ? "Guardando…" : "Guardar borrador"}</button>
          <button type="button" className="g-btn g-btn-primary" disabled={!!haciendo || !renglones.length} onClick={() => guardar(true)}>{haciendo === "confirmar" ? "Confirmando…" : "✅ Confirmar"}</button>
        </div>
      </div>
      {pegar && <Pegar conceptos={conceptos} empleados={datos.empleados} onCerrar={() => setPegar(false)} onListo={pegados} />}
    </Modal>
  );
}

/* ─── Liquidación confirmada: pagos ──────────────────────────────────── */

function Detalle({ datos, liquidacion, onCerrar, onCambio, onCopiar }) {
  const toast = useToast();
  const { cajas, bancos } = useMemo(() => cuentasParaPagar(datos.tesoreria), [datos.tesoreria]);
  const lugares = [...bancos, ...cajas];
  const tot = useMemo(() => totalesLiquidacion(liquidacion, datos.conceptos), [liquidacion, datos.conceptos]);
  const pagos = useMemo(() => (datos.pagos || []).filter((o) => !o.anulada_at && String(o.origen_id).startsWith(`l${liquidacion.id}:`)), [datos.pagos, liquidacion.id]);
  const pagado = useMemo(() => pagadoPorEmpleado(liquidacion.id, datos.pagos || []), [datos.pagos, liquidacion.id]);
  const falta = (emp) => Math.round((emp.total - (pagado[emp.empleado_id] || 0)) * 100) / 100;
  const [fecha, setFecha] = useState(hoyAr());
  const [cuenta, setCuenta] = useState(lugares.length === 1 ? lugares[0].cuenta : "");
  // 14/11: los anticipos por combustible del mes de la liquidación que todavía no se descontaron
  const mesLiq = mesDeLiquidacion(liquidacion);
  const anticipoDe = (emp) => {
    const hechos = descontadosDe(datos.pagos || [], emp);
    return hechos[mesLiq] ? 0 : Number(datos.anticipos?.[emp]?.[mesLiq]) || 0;
  };
  const [filas, setFilas] = useState(() => Object.fromEntries(tot.porEmpleado.filter((e) => falta(e) > 0).map((e) => {
    const ant = Math.min(anticipoDe(e.empleado_id), falta(e));
    return [e.empleado_id, { elegido: true, importe: textoNumero(Math.round((falta(e) - ant) * 100) / 100), cuenta: "", descontar: ant > 0 }];
  })));
  const [error, setError] = useState(null);
  const [haciendo, setHaciendo] = useState(null);
  const [confirmarAnular, setConfirmarAnular] = useState(false);
  const confirmada = liquidacion.estado === "confirmada";
  const pendientes = tot.porEmpleado.filter((e) => falta(e) > 0);
  const elegidos = pendientes.filter((e) => filas[e.empleado_id]?.elegido);
  const aPagar = elegidos.reduce((s, e) => s + (numeroSueldo(filas[e.empleado_id]?.importe) || 0), 0);
  const cambiarDescontar = (e, v) => setFilas((x) => {
    const ant = Math.min(anticipoDe(e.empleado_id), falta(e));
    return { ...x, [e.empleado_id]: { ...x[e.empleado_id], descontar: v, importe: textoNumero(Math.round((falta(e) - (v ? ant : 0)) * 100) / 100) } };
  });
  const nombreLugar = (c) => datos.tesoreria.find((t) => t.cuenta === c)?.nombre || c;

  const cambiar = (emp, k, v) => setFilas((x) => ({ ...x, [emp]: { ...x[emp], [k]: v } }));

  async function hacer(accion, extra, ok) {
    setError(null);
    setHaciendo(accion);
    try {
      await postSueldos({ accion, ...extra });
      toast.success(ok);
      onCambio(accion === "anular" ? null : liquidacion.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setHaciendo(null);
    }
  }

  const pagar = () => hacer("pagar", {
    id: liquidacion.id,
    pagos: elegidos.map((e) => ({
      empleado_id: e.empleado_id, importe: numeroSueldo(filas[e.empleado_id].importe) || 0, cuenta: filas[e.empleado_id].cuenta || cuenta, fecha,
      ...(filas[e.empleado_id].descontar && anticipoDe(e.empleado_id) > 0 ? { descontar: true } : {}),
    })),
  }, `Sueldos pagados: ${elegidos.length} pago${elegidos.length === 1 ? "" : "s"} al libro`);

  return (
    <Modal open onClose={onCerrar} title={`Liquidación ${liquidacion.periodo}`} maxWidth={760}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <div className="text-[13px] text-gypi-dim">{ESTADOS[liquidacion.estado]} · devengado el {fechaCorta(liquidacion.fecha)}{liquidacion.cargada_por_nombre ? ` · ${liquidacion.cargada_por_nombre}` : ""}</div>
        <p className="m-0 text-[22px] font-bold font-mono">{plata(tot.total)}</p>
        {liquidacion.notas && <p className="m-0 text-[13px]">📝 {liquidacion.notas}</p>}

        {confirmada && pendientes.length > 0 && (
          <fieldset className="border border-gypi-border rounded-lg p-2 m-0 flex flex-col gap-2">
            <legend className="text-[13px] font-semibold px-1">💸 Pagar</legend>
            <div className="flex flex-wrap gap-2 items-end">
              {campo("Fecha del pago", <input type="date" className="g-input" aria-label="Fecha del pago" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />)}
              <div className="flex-1 min-w-[200px]">
                {campo("Desde (para todos)", (
                  <SelectBuscable className="g-input w-full" aria-label="Caja o banco para todos" value={cuenta} onChange={(e) => setCuenta(e.target.value)}>
                    <option value="">Elegí la caja o el banco</option>
                    {lugares.map((t) => <option key={t.cuenta} value={t.cuenta}>{t.nombre}</option>)}
                  </SelectBuscable>
                ))}
              </div>
            </div>
            <ul className="list-none m-0 p-0 flex flex-col gap-1 max-h-[40vh] overflow-y-auto">
              {pendientes.map((e) => {
                const f = filas[e.empleado_id] || { elegido: false, importe: textoNumero(falta(e)), cuenta: "" };
                return (
                  <li key={e.empleado_id} className="flex flex-wrap items-center gap-2 text-[13px]">
                    <label className="flex items-center gap-2 flex-1 min-w-[160px] min-h-[40px] cursor-pointer">
                      <input type="checkbox" checked={!!f.elegido} onChange={(ev) => cambiar(e.empleado_id, "elegido", ev.target.checked)} aria-label={`Pagar a ${e.nombre}`} />
                      <span className="font-semibold">{e.nombre}</span>
                      <span className="text-gypi-dim">falta {plata(falta(e))}</span>
                    </label>
                    <input className="g-input w-[130px] text-right font-mono" inputMode="decimal" aria-label={`Importe para ${e.nombre}`} value={f.importe} onChange={(ev) => cambiar(e.empleado_id, "importe", ev.target.value)} />
                    <SelectBuscable className="g-input w-[170px]" aria-label={`Desde dónde se le paga a ${e.nombre}`} value={f.cuenta} onChange={(ev) => cambiar(e.empleado_id, "cuenta", ev.target.value)}>
                      <option value="">{cuenta ? `Igual que todos` : "Elegí…"}</option>
                      {lugares.map((t) => <option key={t.cuenta} value={t.cuenta}>{t.nombre}</option>)}
                    </SelectBuscable>
                    {anticipoDe(e.empleado_id) > 0 && (
                      <label className="basis-full flex items-center gap-2 pl-6 text-[12px] cursor-pointer">
                        <input type="checkbox" checked={!!f.descontar} onChange={(ev) => cambiarDescontar(e, ev.target.checked)} aria-label={`Descontar anticipos de ${e.nombre}`} />
                        Descontar anticipos por combustible de {nombreMesLargo(mesLiq)}: {plata(Math.min(anticipoDe(e.empleado_id), falta(e)))}
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>
            <button type="button" className="g-btn g-btn-primary" disabled={!!haciendo || !elegidos.length} onClick={pagar}>
              {haciendo === "pagar" ? "Pagando…" : `💸 Pagar ${plata(aPagar)} (${elegidos.length})`}
            </button>
          </fieldset>
        )}

        <div>
          <div className="text-[13px] font-semibold mb-1">Por empleado</div>
          <ul className="list-none m-0 p-0 flex flex-col gap-0.5" aria-label="Por empleado">
            {tot.porEmpleado.map((e) => (
              <li key={e.empleado_id} className="flex items-baseline gap-2 text-[13px]">
                <span className="flex-1 min-w-0 truncate">{e.nombre}</span>
                {e.horas > 0 && <span className="text-gypi-dim">{textoNumero(e.horas)} h</span>}
                <span className="font-mono">{plata(e.total)}</span>
                <span className={`w-[90px] text-right text-[12px] ${falta(e) <= 0 ? "text-gypi-green" : "text-gypi-dim"}`}>{falta(e) <= 0 ? "✓ pagado" : pagado[e.empleado_id] ? "pago parcial" : "sin pagar"}</span>
              </li>
            ))}
          </ul>
        </div>

        {pagos.length > 0 && (
          <div>
            <div className="text-[13px] font-semibold mb-1">Pagos</div>
            <ul className="list-none m-0 p-0 flex flex-col gap-1" aria-label="Pagos">
              {pagos.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="font-mono text-[12px] text-gypi-dim">{fechaCorta(o.fecha)}</span>
                  <span className="flex-1 min-w-0 truncate">{o.entidad} · {nombreLugar(o.cuenta_haber)}</span>
                  <span className="font-mono">{plata(o.total_ars ?? o.total)}</span>
                  <button type="button" className="g-btn g-btn-secondary min-h-[36px]" disabled={!!haciendo} aria-label={`Anular el pago a ${o.entidad}`} onClick={() => hacer("anular_pago", { op_id: o.id }, "Pago anulado")}>🚫</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        {confirmarAnular ? (
          <div className="flex flex-col gap-2 p-2 rounded-lg border border-gypi-red">
            <p className="m-0 text-[13px]">¿Anular la liquidación? Se anula su devengado en el libro. Después podés cargarla de nuevo con “📄 Copiar como nueva”.</p>
            <div className="flex gap-2">
              <button type="button" className="g-btn g-btn-secondary flex-1" onClick={() => setConfirmarAnular(false)}>No</button>
              <button type="button" className="g-btn g-btn-danger flex-1" disabled={!!haciendo} onClick={() => hacer("anular", { id: liquidacion.id }, "Liquidación anulada")}>{haciendo === "anular" ? "Anulando…" : "Sí, anular"}</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="g-btn g-btn-secondary flex-1" onClick={() => onCopiar(liquidacion)}>📄 Copiar como nueva</button>
            {confirmada && <button type="button" className="g-btn g-btn-secondary flex-1" disabled={pagos.length > 0} title={pagos.length ? "Anulá primero los pagos" : undefined} onClick={() => setConfirmarAnular(true)}>🚫 Anular</button>}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ─── Conceptos y cuentas ────────────────────────────────────────────── */

function Conceptos({ datos, onCerrar, onGuardado }) {
  const [conceptos, setConceptos] = useState(() => datos.conceptos.map((c) => ({ ...c })));
  const [areas, setAreas] = useState(() => ({ ...datos.areas }));
  // 14/11: sueldo mensual fijo de quien tiene una caja a cargo (los dueños)
  const [fijos, setFijos] = useState(() => Object.fromEntries(Object.entries(datos.fijos || {}).map(([k, v]) => [k, textoNumero(v)])));
  const responsables = datos.empleados.filter((e) => e.activo !== false && (datos.tesoreria || []).some((t) => String(t.responsable_id) === String(e.id)));
  const [todos, setTodos] = useState("");
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const cuentas = datos.cuentas.filter((c) => c.activa !== false);
  const activos = datos.empleados.filter((e) => e.activo !== false);
  const cambiar = (i, k, v) => setConceptos((x) => x.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  const mover = (i, d) => setConceptos((x) => { const n = [...x]; const j = i + d; if (j < 0 || j >= n.length) return x; [n[i], n[j]] = [n[j], n[i]]; return n; });

  async function guardar() {
    setError(null);
    setGuardando(true);
    try {
      await postSueldos({ accion: "config", conceptos, areas, fijos: Object.fromEntries(Object.entries(fijos).filter(([, v]) => String(v).trim()).map(([k, v]) => [k, numeroSueldo(v) ?? v])) });
      onGuardado();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onCerrar} title="Conceptos y cuentas" maxWidth={760}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px] text-gypi-dim">Cada importe va a la cuenta de su concepto. Los que van “al área” usan la cuenta de sueldo de cada empleado (abajo).</p>
        <ul className="list-none m-0 p-0 flex flex-col gap-1.5" aria-label="Conceptos">
          {conceptos.map((c, i) => (
            <li key={c.codigo || i} className={`flex flex-wrap items-center gap-2 p-2 rounded-lg border border-gypi-border ${c.activo ? "bg-gypi-surface" : "opacity-60"}`}>
              <input className="g-input flex-1 min-w-[150px]" aria-label={`Nombre del concepto ${i + 1}`} value={c.nombre} maxLength={60} onChange={(e) => cambiar(i, "nombre", e.target.value)} />
              <SelectBuscable className="g-input w-[130px]" aria-label={`Clase de ${c.nombre}`} value={c.clase} disabled={c.base} onChange={(e) => cambiar(i, "clase", e.target.value)}>
                {Object.entries(CLASES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </SelectBuscable>
              {c.clase === "importe" && (
                <SelectBuscable className="g-input flex-1 min-w-[200px]" aria-label={`Cuenta de ${c.nombre}`} value={c.cuenta || ""} onChange={(e) => cambiar(i, "cuenta", e.target.value || null)}>
                  <option value="">Sin cuenta</option>
                  {cuentas.map((x) => <option key={x.codigo} value={x.codigo}>{x.nombre}</option>)}
                </SelectBuscable>
              )}
              {c.clase === "importe" && (
                <label className="flex items-center gap-1 text-[12px]"><input type="checkbox" checked={!!c.usa_area} onChange={(e) => cambiar(i, "usa_area", e.target.checked)} /> Al área</label>
              )}
              <label className="flex items-center gap-1 text-[12px]"><input type="checkbox" checked={c.activo !== false} onChange={(e) => cambiar(i, "activo", e.target.checked)} /> Se usa</label>
              <button type="button" className="g-btn g-btn-secondary min-h-[36px]" aria-label={`Subir ${c.nombre}`} onClick={() => mover(i, -1)}>↑</button>
              <button type="button" className="g-btn g-btn-secondary min-h-[36px]" aria-label={`Bajar ${c.nombre}`} onClick={() => mover(i, 1)}>↓</button>
              {!c.base && <button type="button" className="g-btn g-btn-secondary min-h-[36px]" aria-label={`Quitar ${c.nombre}`} onClick={() => setConceptos((x) => x.filter((_, j) => j !== i))}>✕</button>}
            </li>
          ))}
        </ul>
        <div><button type="button" className="g-btn g-btn-secondary" onClick={() => setConceptos((x) => [...x, { codigo: "", nombre: "", clase: "importe", cuenta: null, usa_area: false, activo: true, base: false }])}>+ Concepto</button></div>

        <fieldset className="border border-gypi-border rounded-lg p-2 m-0 flex flex-col gap-2">
          <legend className="text-[13px] font-semibold px-1">Cuenta de sueldo de cada empleado (área)</legend>
          {!datos.cuentas_area.length && <p className="m-0 text-[13px] text-gypi-amber-ink">No encontré cuentas “Sueldos, Jornales…” en el plan de cuentas.</p>}
          <div className="flex flex-wrap gap-2 items-center">
            <SelectBuscable className="g-input flex-1 min-w-[220px]" aria-label="Cuenta para los que no tienen" value={todos} onChange={(e) => setTodos(e.target.value)}>
              <option value="">Poner a los que no tienen…</option>
              {datos.cuentas_area.map((x) => <option key={x.codigo} value={x.codigo}>{x.nombre}</option>)}
            </SelectBuscable>
            <button type="button" className="g-btn g-btn-secondary" disabled={!todos} onClick={() => setAreas((a) => ({ ...Object.fromEntries(activos.map((e) => [String(e.id), todos])), ...a }))}>Poner</button>
          </div>
          <ul className="list-none m-0 p-0 flex flex-col gap-1 max-h-[35vh] overflow-y-auto" aria-label="Cuenta por empleado">
            {activos.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="flex-1 min-w-[150px]">{e.nombre}{e.division ? <span className="text-gypi-dim"> · {e.division}</span> : null}</span>
                <SelectBuscable className="g-input w-[300px] max-w-full" aria-label={`Cuenta de sueldo de ${e.nombre}`} value={areas[String(e.id)] || ""} onChange={(ev) => setAreas((a) => { const n = { ...a }; if (ev.target.value) n[String(e.id)] = ev.target.value; else delete n[String(e.id)]; return n; })}>
                  <option value="">La del concepto</option>
                  {datos.cuentas_area.map((x) => <option key={x.codigo} value={x.codigo}>{x.nombre}</option>)}
                </SelectBuscable>
              </li>
            ))}
          </ul>
        </fieldset>
        {responsables.length > 0 && (
          <fieldset className="border border-gypi-border rounded-lg p-2 m-0 flex flex-col gap-2">
            <legend className="text-[13px] font-semibold px-1">Sueldo mensual fijo de los dueños</legend>
            <p className="m-0 text-[13px] text-gypi-dim">En su caja se ve lo que lleva de anticipos por carga de combustible en el mes y cuánto queda del sueldo para liquidar. Al pagar el sueldo, esos anticipos se descuentan.</p>
            <ul className="list-none m-0 p-0 flex flex-col gap-1" aria-label="Sueldo fijo">
              {responsables.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="flex-1 min-w-[150px]">{e.nombre}</span>
                  <input className="g-input w-[160px] text-right font-mono" inputMode="decimal" placeholder="Sin sueldo fijo" aria-label={`Sueldo fijo de ${e.nombre}`}
                    value={fijos[String(e.id)] ?? ""} onChange={(ev) => setFijos((x) => ({ ...x, [String(e.id)]: ev.target.value }))} />
                </li>
              ))}
            </ul>
          </fieldset>
        )}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Pantalla ───────────────────────────────────────────────────────── */

export default function FinanzasSueldos() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [anuladas, setAnuladas] = useState(false);
  const [abierta, setAbierta] = useState(null); // id, "nueva" o { copia }
  const [config, setConfig] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/finanzas/sueldos${anuladas ? "?anuladas=1" : ""}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudieron cargar los sueldos");
      setDatos(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [anuladas]);
  useEffect(() => { cargar(); }, [cargar]);

  if (error) return <p role="alert" className="m-[18px] text-[14px] text-gypi-red">⚠ {error}</p>;
  if (!datos) return <div className="flex-1 flex items-center justify-center py-10"><Spinner /></div>;

  const liq = typeof abierta === "number" ? datos.liquidaciones.find((l) => l.id === abierta) : null;
  const copia = abierta && typeof abierta === "object" ? abierta.copia : null;
  const cambio = (id) => { setAbierta(id ?? null); cargar(); };

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <p className="m-0 text-[13px] text-gypi-dim flex-1 min-w-[200px]">Pasá la liquidación de cada período: va al libro como SUELDOS y después marcás lo pagado.</p>
        <button type="button" className="g-btn g-btn-secondary" onClick={() => setConfig(true)}>⚙ Conceptos</button>
        <button type="button" className="g-btn g-btn-primary" onClick={() => setAbierta("nueva")}>+ Liquidación</button>
      </div>
      {!datos.cuenta_a_pagar && <p className="m-0 mb-2 text-[13px] text-gypi-amber-ink">⚠ Falta la cuenta “Sueldos A Pagar” en el plan de cuentas: sin ella no se puede confirmar.</p>}
      {!datos.config_guardada && <p className="m-0 mb-2 text-[13px] text-gypi-dim">Antes de la primera, revisá en ⚙ Conceptos la cuenta de cada concepto y el área de cada empleado.</p>}
      <div className="flex items-center gap-2 mb-3">
        <label className="flex items-center gap-1 text-[13px] text-gypi-dim">
          <input type="checkbox" checked={anuladas} onChange={(e) => setAnuladas(e.target.checked)} /> Ver anuladas
        </label>
      </div>
      <ul className="list-none m-0 p-0 flex flex-col gap-1.5" aria-label="Liquidaciones">
        {datos.liquidaciones.map((l) => {
          const t = totalesLiquidacion(l, datos.conceptos);
          const pagado = Object.values(pagadoPorEmpleado(l.id, datos.pagos)).reduce((s, n) => s + n, 0);
          const resto = Math.round((t.total - pagado) * 100) / 100;
          return (
            <li key={l.id}>
              <button type="button" onClick={() => setAbierta(l.id)} className="w-full text-left min-h-[48px] px-3 py-2 rounded-lg border border-gypi-border bg-gypi-surface cursor-pointer">
                <span className="flex items-baseline gap-2 text-[14px] text-gypi-text">
                  <span className="font-semibold flex-1 min-w-0 truncate">{l.periodo}</span>
                  <span className="font-mono font-semibold">{plata(t.total)}</span>
                </span>
                <span className="flex flex-wrap gap-x-2 text-[12px] text-gypi-dim">
                  <span>{ESTADOS[l.estado]} · {fechaCorta(l.fecha)} · {t.porEmpleado.length} empleado{t.porEmpleado.length === 1 ? "" : "s"}</span>
                  {l.estado === "confirmada" && <span className={resto <= 0 ? "text-gypi-green font-semibold" : "text-gypi-amber-ink font-semibold"}>{resto <= 0 ? "✓ Todo pagado" : `Falta pagar ${plata(resto)}`}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!datos.liquidaciones.length && <p className="mt-2 text-[13px] text-gypi-dim">Todavía no hay liquidaciones. Cargá la primera con “+ Liquidación”.</p>}
      <div className="mt-3 flex flex-wrap gap-1">
        {datos.conceptos.filter((c) => c.activo).map((c) => <Chip key={c.codigo}>{c.nombre}</Chip>)}
      </div>

      {(abierta === "nueva" || copia || liq?.estado === "borrador") && (
        <Editor datos={datos} liquidacion={copia ? { ...copia, id: null } : liq} onCerrar={() => setAbierta(null)} onCambio={cambio} onRecargar={cargar} />
      )}
      {liq && liq.estado !== "borrador" && (
        <Detalle key={`${liq.id}:${datos.pagos.filter((o) => !o.anulada_at).length}`} datos={datos} liquidacion={liq} onCerrar={() => setAbierta(null)} onCambio={cambio}
          onCopiar={(l) => setAbierta({ copia: { periodo: l.periodo, fecha: l.fecha, renglones: l.renglones, notas: l.notas } })} />
      )}
      {config && <Conceptos datos={datos} onCerrar={() => setConfig(false)} onGuardado={() => { setConfig(false); cargar(); }} />}
    </div>
  );
}
