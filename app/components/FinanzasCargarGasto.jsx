'use client';
// app/components/FinanzasCargarGasto.jsx — Finanzas, parte 5 del plan del
// 11/11: cargar un gasto devengado, con factura o sin factura. El gasto va al
// mes en que ocurrió aunque se pague después (reglas en app/lib/finanzasGastos.js):
// queda la deuda con el proveedor (o en Acreedores Varios, Impuesto IIBB A
// Pagar…) y, si ya se pagó, también el pago. Antes de guardar se ve el asiento.
// `inicial` deja el formulario ya lleno (lo usa la carga desde la factura).
import { useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { textoOt } from "../lib/nombreOt";
import { leyendaTipo, nombreTipo } from "../lib/finanzasTipos";
import { asientoDe, cajasDelLado, hoyAr, numero, plata } from "../lib/finanzasOperaciones";
import { LETRAS, cuentasDeuda, fechaDevengado, operacionesGasto } from "../lib/finanzasGastos";
import ElegirProveedor from "./FinanzasElegirProveedor";
import { Chip, Modal, SelectBuscable } from "./ui";
import { useToast } from "./ui/Toast";

const ACREEDORES = /^acreedores varios$/i;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const textoMes = (mes) => `${MESES[Number(mes.slice(5, 7)) - 1] || ""} ${mes.slice(0, 4)}`;
const fechaCorta = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}` : "");

function campo(label, input, extra = "") {
  return (
    <label className={`flex flex-col gap-1 text-[13px] font-semibold text-gypi-text ${extra}`}>
      {label}
      {input}
    </label>
  );
}

/** Los tipos que sirven para un gasto: los que no tienen una caja, una deuda ni un cliente al debe. */
export function tiposDeGasto(tipos = [], tesoreria = []) {
  return tipos.filter((t) => t.activo !== false && !cajasDelLado(t.cuenta_debe, tesoreria)
    && !String(t.cuenta_debe || "").startsWith("02") && !String(t.cuenta_debe || "").startsWith("01.01.02"));
}

/** La deuda que propone un tipo: su cuenta del haber si es un pasivo; si no, Acreedores Varios. */
export function deudaDelTipo(tipo, cuentas = []) {
  const deudas = cuentasDeuda(cuentas);
  if (tipo?.cuenta_haber && deudas.some((c) => c.codigo === tipo.cuenta_haber)) return tipo.cuenta_haber;
  return deudas.find((c) => ACREEDORES.test(String(c.nombre || "").trim()))?.codigo || "";
}

function Renglones({ op, datos }) {
  const { renglones } = asientoDe(op, datos);
  return renglones.map((r, i) => (
    <tr key={i} className="border-t border-gypi-border">
      <td className={`py-1 ${r.lado === "haber" ? "pl-4" : ""}`}>{r.nombre || r.cuenta}</td>
      <td className="py-1 text-right font-mono">{r.lado === "debe" ? plata(r.importe) : ""}</td>
      <td className="py-1 text-right font-mono">{r.lado === "haber" ? plata(r.importe) : ""}</td>
    </tr>
  ));
}

export default function CargarGasto({ datos, inicial = {}, onCerrar, onGuardada }) {
  const toast = useToast();
  const hoy = hoyAr();
  const [f, setF] = useState(() => ({
    tipo: "", cuenta_gasto: "", con_factura: true, letra: "A", punto_venta: "", numero: "",
    fecha_factura: hoy, mes: hoy.slice(0, 7), proveedor_id: "", entidad: "", cuenta_deuda: deudaDelTipo(null, datos.cuentas),
    neto: "", iva: "", otros_impuestos: "", centro_costo: "", proyecto_id: "", descripcion: "",
    pagado: false, cuenta_caja: "", fecha_pago: hoy,
    ...inicial,
  }));
  const [aQuien, setAQuien] = useState(inicial.proveedor_id || !inicial.cuenta_deuda ? "proveedor" : "cuenta");
  const [cambiarCuenta, setCambiarCuenta] = useState(false);
  const [mostrarErrores, setMostrarErrores] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const tipos = tiposDeGasto(datos.tipos, datos.tesoreria);
  const grupos = [...new Set(tipos.map((t) => t.grupo || "Otros"))];
  const tipo = datos.tipos.find((t) => t.codigo === f.tipo);
  const cajasTesoreria = new Set(datos.tesoreria.map((t) => t.cuenta));
  const cuentasGasto = datos.cuentas.filter((c) => (c.activa !== false || c.codigo === f.cuenta_gasto) && !cajasTesoreria.has(c.codigo) && !String(c.codigo).startsWith("02"));
  const deudas = cuentasDeuda(datos.cuentas);
  const cajasPago = datos.tesoreria.filter((t) => t.activa !== false && t.moneda !== "USD");
  const discrimina = f.con_factura && ["A", "M"].includes(f.letra);

  const elegirTipo = (e) => {
    const t = datos.tipos.find((x) => x.codigo === e.target.value);
    const caja = cajasDelLado(t?.cuenta_haber, datos.tesoreria)?.defecto || "";
    setF((x) => ({
      ...x, tipo: e.target.value, cuenta_gasto: t?.cuenta_debe || "",
      cuenta_deuda: deudaDelTipo(t, datos.cuentas) || x.cuenta_deuda, cuenta_caja: x.cuenta_caja || caja,
    }));
  };

  // Lo que se manda: importes en número y la deuda según a quién se le debe
  const gasto = useMemo(() => ({
    ...f,
    proveedor_id: aQuien === "proveedor" ? f.proveedor_id : "",
    entidad: aQuien === "cuenta" ? f.entidad : "",
    cuenta_deuda: aQuien === "cuenta" ? f.cuenta_deuda : "",
    neto: numero(f.neto), iva: discrimina ? numero(f.iva) : 0, otros_impuestos: numero(f.otros_impuestos),
    letra: f.con_factura ? f.letra : "",
  }), [f, aQuien, discrimina]);
  // Un proveedor recién dado de alta desde la agenda todavía no está en la lista
  const ctx = useMemo(() => ({
    ...datos,
    proveedores: gasto.proveedor_id && !datos.proveedores.some((p) => String(p.id) === String(gasto.proveedor_id))
      ? [...datos.proveedores, { id: Number(gasto.proveedor_id), activo: true }] : datos.proveedores,
  }), [datos, gasto.proveedor_id]);
  const { ops, errores } = operacionesGasto(gasto, ctx);
  const total = Math.round(((Number(gasto.neto) || 0) + (Number(gasto.iva) || 0) + (Number(gasto.otros_impuestos) || 0)) * 100) / 100;
  const fechaOp = fechaDevengado(f.fecha_factura, f.mes);

  const guardar = async () => {
    setMostrarErrores(true);
    if (errores.length) return;
    setGuardando(true);
    try {
      const res = await apiFetch("/api/finanzas/operaciones", { method: "POST", body: JSON.stringify({ accion: "gasto", gasto }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo guardar el gasto");
      toast.success(f.pagado ? "✅ Gasto y pago guardados" : "✅ Gasto guardado: queda la deuda");
      onGuardada();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal open onClose={onCerrar} title="Cargar gasto o factura" maxWidth={680}>
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] text-gypi-dim">El gasto va al mes en que ocurrió, aunque lo pagues después. Queda la deuda y, si ya lo pagaste, también el pago.</p>

        {campo("Tipo de gasto", (
          <SelectBuscable className="g-input w-full" value={f.tipo} onChange={elegirTipo}>
            <option value="">Elegí…</option>
            {grupos.map((g) => (
              <optgroup key={g} label={g}>
                {tipos.filter((t) => (t.grupo || "Otros") === g).map((t) => <option key={t.codigo} value={t.codigo}>{nombreTipo(t)}</option>)}
              </optgroup>
            ))}
          </SelectBuscable>
        ))}
        {tipo && leyendaTipo(tipo) && <p className="-mt-2 text-[12px] leading-snug text-gypi-dim" aria-label="Qué comprende este tipo">ℹ {leyendaTipo(tipo)}</p>}
        {tipo && (cambiarCuenta || !f.cuenta_gasto ? campo("Cuenta del gasto", (
          <SelectBuscable className="g-input w-full" value={f.cuenta_gasto} onChange={set("cuenta_gasto")}>
            <option value="">Elegí…</option>
            {cuentasGasto.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nombre}</option>)}
          </SelectBuscable>
        )) : (
          <p className="m-0 text-[13px] text-gypi-dim">
            Va a la cuenta <b className="text-gypi-text">{datos.cuentas.find((c) => c.codigo === f.cuenta_gasto)?.nombre || f.cuenta_gasto}</b>{" "}
            <button type="button" className="g-btn g-btn-secondary ml-1" onClick={() => setCambiarCuenta(true)}>Cambiar cuenta</button>
          </p>
        ))}

        <div className="flex flex-wrap gap-1.5" aria-label="Comprobante">
          <Chip active={f.con_factura} onClick={() => setF((x) => ({ ...x, con_factura: true }))}>🧾 Con factura</Chip>
          <Chip active={!f.con_factura} onClick={() => setF((x) => ({ ...x, con_factura: false }))}>📝 Sin factura</Chip>
        </div>
        {f.con_factura ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <span className="text-[13px] font-semibold text-gypi-text">Letra</span>
              <div className="flex gap-1" aria-label="Letra">
                {LETRAS.map((l) => <Chip key={l} active={f.letra === l} onClick={() => setF((x) => ({ ...x, letra: l }))}>{l}</Chip>)}
              </div>
            </div>
            {campo("Punto de venta", <input className="g-input w-[110px]" inputMode="numeric" value={f.punto_venta} onChange={set("punto_venta")} placeholder="0001" />)}
            {campo("Número", <input className="g-input w-[150px]" inputMode="numeric" value={f.numero} onChange={set("numero")} placeholder="00001234" />)}
            {campo("Fecha de la factura", <input type="date" className="g-input" value={f.fecha_factura} onChange={set("fecha_factura")} />)}
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            {campo("Fecha", <input type="date" className="g-input" value={f.fecha_factura} onChange={set("fecha_factura")} />)}
            {campo("Comprobante (recibo, ticket; opcional)", <input className="g-input w-[220px]" value={f.numero} onChange={set("numero")} />)}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2">
          {campo("Mes del gasto", <input type="month" className="g-input" value={f.mes} onChange={set("mes")} />)}
          {fechaOp && f.mes && fechaOp !== f.fecha_factura && (
            <p className="m-0 pb-2 text-[12px] text-gypi-amber-ink">Va a {textoMes(f.mes)}: se anota con fecha {fechaCorta(fechaOp)}.</p>
          )}
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-gypi-border p-3">
          <span className="text-[13px] font-semibold text-gypi-text">¿A quién se le debe?</span>
          <div className="flex flex-wrap gap-1.5" aria-label="A quién se le debe">
            <Chip active={aQuien === "proveedor"} onClick={() => setAQuien("proveedor")}>A un proveedor</Chip>
            <Chip active={aQuien === "cuenta"} onClick={() => setAQuien("cuenta")}>Impuesto, servicio u otro</Chip>
          </div>
          {aQuien === "proveedor" ? (
            <ElegirProveedor aria-label="Proveedor del gasto" value={String(f.proveedor_id || "")} onChange={set("proveedor_id")} proveedores={datos.proveedores} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {campo("Queda la deuda en", (
                <SelectBuscable className="g-input w-full" value={f.cuenta_deuda} onChange={set("cuenta_deuda")}>
                  <option value="">Elegí…</option>
                  {deudas.map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
                </SelectBuscable>
              ))}
              {campo("A nombre de (opcional)", <input className="g-input w-full" value={f.entidad} onChange={set("entidad")} placeholder="EPEC, Rentas, el contador…" />)}
            </div>
          )}
        </div>

        <div className={`grid grid-cols-1 gap-3 ${discrimina ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          {campo(discrimina ? "Neto (sin IVA)" : "Importe", <input className="g-input w-full" inputMode="decimal" value={f.neto} onChange={set("neto")} placeholder="0,00" />)}
          {discrimina && campo("IVA", <input className="g-input w-full" inputMode="decimal" value={f.iva} onChange={set("iva")} placeholder="0,00" />)}
          {campo("Percepciones y otros impuestos", <input className="g-input w-full" inputMode="decimal" value={f.otros_impuestos} onChange={set("otros_impuestos")} placeholder="0,00" />)}
        </div>
        {f.con_factura && !discrimina && <p className="-mt-2 m-0 text-[12px] text-gypi-dim">En una factura {f.letra} el IVA no se separa: va todo en el importe.</p>}
        <p className="m-0 text-[15px] font-bold text-gypi-text">Total: {plata(total)}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {campo(`Centro de costo${tipo?.pide_cc ? " (obligatorio)" : ""}`, (
            <SelectBuscable className="g-input w-full" value={f.centro_costo} onChange={set("centro_costo")}>
              <option value="">Sin centro de costo</option>
              {datos.centros.filter((c) => c.activo !== false).map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre && c.nombre.toUpperCase() !== c.codigo.toUpperCase() ? `${c.codigo} · ${c.nombre}` : c.codigo}</option>)}
            </SelectBuscable>
          ))}
          {campo("OT (opcional)", (
            <SelectBuscable className="g-input w-full" value={String(f.proyecto_id || "")} onChange={set("proyecto_id")}>
              <option value="">Sin OT</option>
              {datos.proyectos.map((p) => <option key={p.id} value={p.id}>{textoOt(p)}</option>)}
            </SelectBuscable>
          ))}
        </div>
        {campo("Descripción", <input className="g-input w-full" value={f.descripcion} onChange={set("descripcion")} placeholder="Luz de la planta, honorarios de octubre…" />)}

        <label className="flex items-center gap-2 text-[14px] font-semibold text-gypi-text cursor-pointer">
          <input type="checkbox" checked={f.pagado} onChange={set("pagado")} /> Ya está pagado
        </label>
        {f.pagado && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {campo("Se pagó con", (
              <SelectBuscable className="g-input w-full" value={f.cuenta_caja} onChange={set("cuenta_caja")}>
                <option value="">Elegí la caja o el banco…</option>
                {cajasPago.map((c) => <option key={c.cuenta} value={c.cuenta}>{c.nombre}</option>)}
              </SelectBuscable>
            ))}
            {campo("Fecha del pago", <input type="date" className="g-input w-full" value={f.fecha_pago} onChange={set("fecha_pago")} />)}
          </div>
        )}

        {ops.length > 0 && (
          <section className="rounded-lg border border-gypi-border bg-gypi-surface p-3">
            <h3 className="m-0 mb-1 text-[13px] font-bold text-gypi-text">Así queda</h3>
            <table className="w-full text-[13px] border-collapse" aria-label="Asiento del gasto">
              <thead>
                <tr className="text-gypi-dim text-left">
                  <th className="font-semibold py-1">Cuenta</th>
                  <th className="font-semibold py-1 text-right">Debe</th>
                  <th className="font-semibold py-1 text-right">Haber</th>
                </tr>
              </thead>
              {ops.map((op, i) => (
                <tbody key={i}>
                  <tr><td colSpan={3} className="pt-2 text-[12px] font-semibold text-gypi-dim">{i ? `El pago · ${fechaCorta(op.fecha)}` : `El gasto · ${fechaCorta(op.fecha)}`}</td></tr>
                  <Renglones op={op} datos={datos} />
                </tbody>
              ))}
            </table>
          </section>
        )}

        {mostrarErrores && errores.length > 0 && (
          <ul role="alert" className="m-0 pl-5 text-[13px] text-gypi-red">
            {errores.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar gasto"}</button>
        </div>
      </div>
    </Modal>
  );
}
