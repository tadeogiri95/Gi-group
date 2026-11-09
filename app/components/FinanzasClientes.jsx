'use client';
// app/components/FinanzasClientes.jsx — Finanzas → 👥 Clientes (parte F4a;
// migración 177; reemplaza CC_CLIENTES del libro; /api/finanzas/clientes;
// reglas en app/lib/finanzasClientes.js).
//
// La lista de clientes con lo que debe cada uno (o lo que tiene a favor). La
// ficha muestra los movimientos con el saldo renglón por renglón, lo que
// falta cobrar de cada OT, sus datos y otros nombres, y 💵 Cobrar: efectivo,
// transferencia, cheque o e-cheq (a la cartera) y dólares, todo junto si pagó
// de varias formas. "Traer de las OT" suma los clientes de las OT que faltan;
// "Cargar saldos iniciales" lee T-OPERACIONES del libro a una fecha de corte.
// "🧾 Ventas de las OT" prende la venta y la entrega automática de cada OT
// (F4b, app/lib/finanzasVentas.js). Plan del 09/11: "📋 Cuenta por OT"
// (parte 6, FinanzasOtClientes.jsx) y "🔗 Cliente y proveedor" (parte 5).
// Solo el rol Dueño (la pantalla ni aparece para los demás).
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyAr, numero, plata } from "../lib/finanzasOperaciones";
import { ORIGEN_SALDO_INICIAL } from "../lib/finanzasProveedores";
import { TIPOS_CHEQUE } from "../lib/finanzasCheques";
import {
  FORMAS_COBRO, ORIGEN_COBRO, emparejarCliente, movimientosCliente, saldoPorOt, saldosClientes, saldosClientesDelLibro,
} from "../lib/finanzasClientes";
import { Chip, Modal, Spinner } from "./ui";
import { useToast } from "./ui/Toast";
import FinanzasUnificados, { LineaUnificada } from "./FinanzasUnificados";
import FinanzasOtClientes from "./FinanzasOtClientes";

const MAX_LISTA = 300;
const fechaCorta = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}` : "");
const normal = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const nombreOt = (p) => [p.ot, p.cliente, p.obra].filter(Boolean).join(" · ");

/** Texto del saldo: "Nos debe $ X", "A favor $ X" o "Al día". */
export function textoSaldoCliente(saldo) {
  if (saldo >= 0.01) return { texto: `Nos debe ${plata(saldo, "ARS")}`, clase: "text-gypi-text" };
  if (saldo <= -0.01) return { texto: `A favor ${plata(-saldo, "ARS")}`, clase: "text-gypi-green" };
  return { texto: "Al día", clase: "text-gypi-dim" };
}

async function postClientes(body) {
  const res = await apiFetch("/api/finanzas/clientes", { method: "POST", body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "No se pudo guardar");
  return d;
}

const campo = (label, input, extra = "") => <label className={`flex flex-col gap-1 text-[13px] font-semibold text-gypi-text ${extra}`}>{label}{input}</label>;

async function leerOperacionesDelLibro(file) {
  const { hojasXlsx, leerHojaXlsx } = await import("../lib/leerXlsx");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hoja = hojasXlsx(bytes).find((n) => normal(n) === "TOPERACIONES");
  if (!hoja) return null;
  return leerHojaXlsx(bytes, hoja, { maxFilas: 60000, maxCols: 60 }) || [];
}

/* ─── Cobrar ─────────────────────────────────────────────────────────── */

const formaVacia = (forma = "transferencia") => ({ forma, importe: "", cuenta: "", tipo_cheque: "echeq_diferido", banco: "", numero: "", fecha_pago: "", tipo_cambio: "" });

export function Cobrar({ datos, cliente, proyectoId = "", onCerrar, onHecho }) {
  const toast = useToast();
  const [fecha, setFecha] = useState(hoyAr());
  const [ot, setOt] = useState(proyectoId ? String(proyectoId) : "");
  const [notas, setNotas] = useState("");
  const [formas, setFormas] = useState([formaVacia()]);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const vivas = datos.tesoreria.filter((t) => t.activa !== false);
  const opcionesCaja = (forma) => vivas.filter((t) => (forma === "dolares" ? t.moneda === "USD" : t.moneda !== "USD" && (forma === "efectivo" ? t.tipo === "caja" : t.tipo !== "caja")));
  const otsCliente = useMemo(() => {
    const mias = datos.proyectos.filter((p) => emparejarCliente(p.cliente, [cliente]));
    return mias.length ? mias : datos.proyectos;
  }, [datos.proyectos, cliente]);
  const set = (i, k, v) => setFormas((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: v, ...(k === "forma" ? { cuenta: "" } : {}) } : x)));
  const totalPesos = formas.reduce((s, x) => s + (x.forma === "dolares" ? numero(x.importe) * numero(x.tipo_cambio) : numero(x.importe)), 0);

  async function guardar() {
    setError(null);
    setGuardando(true);
    try {
      const d = await postClientes({
        accion: "cobrar", cliente_id: cliente.id, fecha, proyecto_id: ot ? Number(ot) : null, notas,
        formas: formas.map((x) => ({ ...x, importe: numero(x.importe), tipo_cambio: x.forma === "dolares" ? numero(x.tipo_cambio) : null })),
      });
      toast.success(`Cobro cargado: ${plata(d.total, "ARS")}`);
      onHecho();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onCerrar} title={`Cobrar a ${cliente.nombre}`} maxWidth={600}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {campo("Fecha", <input type="date" className="g-input" aria-label="Fecha del cobro" value={fecha} onChange={(e) => setFecha(e.target.value)} />)}
          {campo("OT (opcional)", (
            <select className="g-input w-full" aria-label="OT del cobro" value={ot} onChange={(e) => setOt(e.target.value)}>
              <option value="">Sin OT</option>
              {otsCliente.slice(0, 300).map((p) => <option key={p.id} value={p.id}>{nombreOt(p)}</option>)}
            </select>
          ), "flex-1 min-w-[200px]")}
        </div>
        {formas.map((x, i) => (
          <fieldset key={i} className="border border-gypi-border rounded-lg p-2.5 m-0 flex flex-col gap-2 min-w-0">
            <legend className="px-1 text-[13px] font-bold">{formas.length > 1 ? `Forma ${i + 1}` : "Cómo pagó"}</legend>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Cómo pagó ${i + 1}`}>
              {Object.entries(FORMAS_COBRO).map(([k, n]) => <Chip key={k} active={x.forma === k} onClick={() => set(i, "forma", k)}>{n}</Chip>)}
            </div>
            <div className="flex flex-wrap gap-2 items-end">
              {campo(x.forma === "dolares" ? "Importe (USD)" : "Importe", <input className="g-input w-[150px] text-right font-mono" inputMode="decimal" aria-label={`Importe ${i + 1}`} value={x.importe} onChange={(e) => set(i, "importe", e.target.value)} />)}
              {x.forma === "dolares" && campo("Tipo de cambio", <input className="g-input w-[120px]" inputMode="decimal" aria-label={`Tipo de cambio ${i + 1}`} value={x.tipo_cambio} onChange={(e) => set(i, "tipo_cambio", e.target.value)} />)}
              {x.forma !== "cheque" && campo(x.forma === "efectivo" ? "Caja" : x.forma === "dolares" ? "Caja o banco en dólares" : "Banco", (
                <select className="g-input w-full" aria-label={`Dónde entró ${i + 1}`} value={x.cuenta} onChange={(e) => set(i, "cuenta", e.target.value)}>
                  <option value="">Elegí…</option>
                  {opcionesCaja(x.forma).map((t) => <option key={t.cuenta} value={t.cuenta}>{t.nombre}</option>)}
                </select>
              ), "flex-1 min-w-[180px]")}
            </div>
            {x.forma === "cheque" && (
              <div className="flex flex-wrap gap-2">
                {campo("Tipo", (
                  <select className="g-input" aria-label={`Tipo de cheque ${i + 1}`} value={x.tipo_cheque} onChange={(e) => set(i, "tipo_cheque", e.target.value)}>
                    {Object.entries(TIPOS_CHEQUE).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                  </select>
                ))}
                {campo("Banco", <input className="g-input w-[140px]" aria-label={`Banco del cheque ${i + 1}`} maxLength={60} value={x.banco} onChange={(e) => set(i, "banco", e.target.value)} />)}
                {campo("Número", <input className="g-input w-[120px]" aria-label={`Número del cheque ${i + 1}`} maxLength={40} value={x.numero} onChange={(e) => set(i, "numero", e.target.value)} />)}
                {campo("Fecha de pago", <input type="date" className="g-input" aria-label={`Fecha de pago ${i + 1}`} value={x.fecha_pago} onChange={(e) => set(i, "fecha_pago", e.target.value)} />)}
              </div>
            )}
            {formas.length > 1 && <button type="button" className="text-[12px] text-gypi-red underline bg-transparent border-none p-0 cursor-pointer self-start" onClick={() => setFormas((xs) => xs.filter((_, j) => j !== i))}>Sacar esta forma</button>}
          </fieldset>
        ))}
        <button type="button" className="g-btn g-btn-secondary self-start" onClick={() => setFormas((xs) => [...xs, formaVacia("efectivo")])}>＋ Otra forma de pago</button>
        {campo("Nota (opcional)", <input className="g-input w-full" aria-label="Nota del cobro" maxLength={200} value={notas} onChange={(e) => setNotas(e.target.value)} />)}
        <p className="m-0 text-[14px] text-gypi-text">Total del cobro <b className="font-mono">{plata(totalPesos, "ARS")}</b></p>
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={guardando || !(totalPesos > 0)} onClick={guardar}>{guardando ? "Guardando…" : "Cargar el cobro"}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Datos de un cliente ────────────────────────────────────────────── */

function DatosCliente({ cliente, onCerrar, onGuardado }) {
  const nuevo = !cliente?.id;
  const [f, setF] = useState({ nombre: cliente?.nombre || "", cuit: cliente?.cuit || "", telefono: cliente?.telefono || "", email: cliente?.email || "", notas: cliente?.notas || "", alias: (cliente?.alias || []).join("\n") });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function guardar(activo) {
    setError(null);
    setGuardando(true);
    try {
      const datos = { ...f, alias: f.alias.split("\n").map((a) => a.trim()).filter(Boolean) };
      await postClientes(nuevo ? { accion: "crear", cliente: datos } : { accion: "editar", id: cliente.id, cliente: datos, ...(activo === false ? { activo: false } : {}) });
      onGuardado();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onCerrar} title={nuevo ? "Cliente nuevo" : `Datos de ${cliente.nombre}`} maxWidth={480}>
      <div className="flex flex-col gap-3">
        {campo("Nombre", <input className="g-input w-full" aria-label="Nombre del cliente" maxLength={120} value={f.nombre} onChange={set("nombre")} />)}
        <div className="flex flex-wrap gap-2">
          {campo("CUIT", <input className="g-input w-[150px]" aria-label="CUIT" maxLength={20} value={f.cuit} onChange={set("cuit")} />)}
          {campo("Teléfono", <input className="g-input w-[150px]" aria-label="Teléfono" maxLength={40} value={f.telefono} onChange={set("telefono")} />)}
        </div>
        {campo("Email", <input className="g-input w-full" aria-label="Email" maxLength={120} value={f.email} onChange={set("email")} />)}
        {campo("Otros nombres (uno por renglón)", <textarea className="g-input w-full min-h-[70px]" aria-label="Otros nombres" value={f.alias} onChange={set("alias")} placeholder="Como aparece escrito en el libro o en las OT" />)}
        {campo("Notas", <input className="g-input w-full" aria-label="Notas del cliente" maxLength={500} value={f.notas} onChange={set("notas")} />)}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {!nuevo && <button type="button" className="g-btn g-btn-secondary mr-auto" disabled={guardando} onClick={() => guardar(false)}>Desactivar</button>}
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={guardando || !f.nombre.trim()} onClick={() => guardar()}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>
    </Modal>
  );
}

function Unir({ cliente, datos, onCerrar, onHecho }) {
  const [otro, setOtro] = useState("");
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const opciones = datos.clientes.filter((c) => c.activo !== false && c.id !== cliente.id);
  async function unir() {
    setError(null);
    setGuardando(true);
    try {
      await postClientes({ accion: "unir", a: cliente.id, b: Number(otro) });
      onHecho();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onCerrar} title={`Unir con ${cliente.nombre}`} maxWidth={480}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0">Elegí el cliente repetido. Su nombre pasa a ser otro nombre de {cliente.nombre} y sus movimientos se suman acá.</p>
        <select className="g-input w-full" aria-label="Cliente repetido" value={otro} onChange={(e) => setOtro(e.target.value)}>
          <option value="">Elegí…</option>
          {opciones.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={guardando || !otro} onClick={unir}>{guardando ? "Uniendo…" : "Unir"}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Ventas de las OT (F4b) ─────────────────────────────────────────── */

/** Texto del resultado de una revisión de ventas. */
export function textoResultadoVentas(r) {
  if (!r || r.accion === "apagada") return "Ventas de las OT apagadas";
  const partes = [
    r.creadas ? `${r.creadas} anotadas` : null,
    r.corregidas ? `${r.corregidas} con precio corregido` : null,
    r.anuladas ? `${r.anuladas} anuladas` : null,
    r.clientes_nuevos ? `${r.clientes_nuevos} clientes nuevos` : null,
  ].filter(Boolean);
  return partes.length ? `Ventas y entregas: ${partes.join(", ")}` : "Las ventas y entregas de las OT ya estaban al día";
}

function VentasOt({ config, onCerrar, onHecho }) {
  const toast = useToast();
  const [activo, setActivo] = useState(Boolean(config?.activo || !config?.desde));
  const [desde, setDesde] = useState(config?.desde || hoyAr());
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  async function enviar(body) {
    setError(null);
    setGuardando(true);
    try {
      const d = await postClientes(body);
      toast.success(textoResultadoVentas(d.resultado));
      onHecho();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onCerrar} title="🧾 Ventas de las OT" maxWidth={520}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0">Cuando una OT se carga en el Plan de trabajo con su PRECIO (sin IVA), Gypi anota la <b>venta</b>: el cliente queda debiendo, contra Ventas Generales.</p>
        <p className="m-0">Cuando la OT se termina, anota la <b>entrega</b>: pasa de Ventas Generales a Entregas Generales. Eso es el ingreso del mes.</p>
        <p className="m-0 text-[13px] text-gypi-dim">Si cambia el precio, se corrige; si se borra el precio o la OT se reabre, se anula. Se revisa en cada sincronización del Plan.</p>
        {config?.error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {config.error}</p>}
        <label className="flex items-center gap-2 font-semibold">
          <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
          Anotar las ventas y entregas de las OT
        </label>
        {activo && campo("Solo las OT cargadas desde", <input type="date" className="g-input w-full" value={desde} onChange={(e) => setDesde(e.target.value)} />)}
        {activo && <p className="m-0 text-[13px] text-gypi-dim">Las OT de antes ya están en los saldos iniciales del libro: no se anotan de nuevo.</p>}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {config?.activo && <button type="button" className="g-btn g-btn-secondary" disabled={guardando} onClick={() => enviar({ accion: "revisar_ventas" })}>🔄 Revisar ahora</button>}
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={guardando || (activo && !desde)} onClick={() => enviar({ accion: "config_ventas", activo, desde: activo ? desde : null })}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Ficha ──────────────────────────────────────────────────────────── */

function Ficha({ saldo, datos, cuentasDeu, onCerrar, onCambio }) {
  const toast = useToast();
  const [vista, setVista] = useState("movimientos");
  const [modal, setModal] = useState(null);
  const [error, setError] = useState(null);
  const cliente = datos.clientes.find((c) => Number(c.id) === saldo.cliente_id);
  const movimientos = useMemo(() => movimientosCliente(datos.operaciones, saldo.clave, cuentasDeu, datos.clientes), [datos, saldo, cuentasDeu]);
  const porOt = useMemo(() => saldoPorOt(movimientos), [movimientos]);
  const ots = useMemo(() => new Map(datos.proyectos.map((p) => [Number(p.id), p])), [datos.proyectos]);
  const s = textoSaldoCliente(saldo.saldo);

  async function anular(grupo) {
    setError(null);
    try {
      await postClientes({ accion: "anular_cobro", grupo });
      toast.success("Cobro anulado");
      onCambio();
    } catch (e) {
      setError(e.message);
    }
  }
  const grupoDe = (op) => (op.origen === ORIGEN_COBRO ? String(op.origen_id || "").split(":")[0] : null);

  return (
    <Modal open onClose={onCerrar} title={saldo.nombre || "Cliente"} maxWidth={680}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className={`m-0 text-[18px] font-bold ${s.clase}`}>{s.texto}</p>
        <p className="m-0 text-[13px] text-gypi-dim">Vendido {plata(saldo.vendido, "ARS")} · Cobrado {plata(saldo.cobrado, "ARS")}{cliente?.telefono ? ` · Tel. ${cliente.telefono}` : ""}</p>
        {cliente ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="g-btn g-btn-primary" onClick={() => setModal("cobrar")}>💵 Cobrar</button>
            <button type="button" className="g-btn g-btn-secondary" onClick={() => setModal("datos")}>✏ Datos y otros nombres</button>
            <button type="button" className="g-btn g-btn-secondary" onClick={() => setModal("unir")}>🔗 Unir un repetido</button>
          </div>
        ) : (
          <p className="m-0 text-[12px] text-gypi-dim">Este nombre no está en la lista de clientes: creá el cliente o sumalo como otro nombre de uno que ya esté.</p>
        )}
        {saldo.cliente_id && <LineaUnificada clienteId={saldo.cliente_id} onCambio={onCambio} />}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex gap-2">
          <Chip active={vista === "movimientos"} onClick={() => setVista("movimientos")}>Movimientos ({movimientos.length})</Chip>
          <Chip active={vista === "ot"} onClick={() => setVista("ot")}>Por OT ({porOt.length})</Chip>
        </div>
        {vista === "ot" ? (
          porOt.length ? (
            <table className="w-full text-[13px] border-collapse" aria-label="Por OT">
              <thead>
                <tr className="text-gypi-dim text-left">
                  <th className="font-semibold py-1">OT</th>
                  <th className="font-semibold py-1 text-right">Vendido</th>
                  <th className="font-semibold py-1 text-right">Cobrado</th>
                  <th className="font-semibold py-1 text-right">Falta</th>
                </tr>
              </thead>
              <tbody>
                {porOt.map((o) => (
                  <tr key={o.proyecto_id} className="border-t border-gypi-border">
                    <td className="py-1">{ots.get(Number(o.proyecto_id)) ? nombreOt(ots.get(Number(o.proyecto_id))) : `OT ${o.proyecto_id}`}</td>
                    <td className="py-1 text-right font-mono">{plata(o.vendido, "ARS")}</td>
                    <td className="py-1 text-right font-mono">{plata(o.cobrado, "ARS")}</td>
                    <td className={`py-1 text-right font-mono font-semibold ${o.falta < 0 ? "text-gypi-green" : ""}`}>{plata(o.falta, "ARS")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="m-0 text-[13px] text-gypi-dim">Todavía no hay ventas ni cobros con OT.</p>
        ) : movimientos.length ? (
          <table className="w-full text-[13px] border-collapse" aria-label="Movimientos del cliente">
            <thead>
              <tr className="text-gypi-dim text-left">
                <th className="font-semibold py-1">Fecha</th>
                <th className="font-semibold py-1 text-right">Venta</th>
                <th className="font-semibold py-1 text-right">Cobro</th>
                <th className="font-semibold py-1 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {[...movimientos].reverse().map((m) => {
                const grupo = grupoDe(m.op);
                return (
                  <tr key={m.op.id} className="border-t border-gypi-border">
                    <td className="py-1">
                      <span className="font-mono text-[12px] text-gypi-dim">{fechaCorta(m.op.fecha)}</span> {m.op.tipo}
                      {m.op.descripcion && <span className="block text-[12px] text-gypi-dim truncate">{m.op.descripcion}</span>}
                      {m.op.proyecto_id && ots.get(Number(m.op.proyecto_id)) && <span className="block text-[12px] text-gypi-dim">OT {ots.get(Number(m.op.proyecto_id)).ot}</span>}
                      {grupo && <button type="button" className="text-[12px] text-gypi-red underline bg-transparent border-none p-0 cursor-pointer" onClick={() => anular(grupo)}>Anular el cobro</button>}
                    </td>
                    <td className="py-1 text-right font-mono">{m.venta ? plata(m.venta, "ARS") : ""}</td>
                    <td className="py-1 text-right font-mono">{m.cobro ? plata(m.cobro, "ARS") : ""}</td>
                    <td className="py-1 text-right font-mono font-semibold">{plata(m.saldo, "ARS")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p className="m-0 text-[13px] text-gypi-dim">Sin movimientos todavía.</p>}
      </div>
      {modal === "cobrar" && cliente && <Cobrar datos={datos} cliente={cliente} onCerrar={() => setModal(null)} onHecho={() => { setModal(null); onCambio(); }} />}
      {modal === "datos" && cliente && <DatosCliente cliente={cliente} onCerrar={() => setModal(null)} onGuardado={() => { setModal(null); onCambio(); }} />}
      {modal === "unir" && cliente && <Unir cliente={cliente} datos={datos} onCerrar={() => setModal(null)} onHecho={() => { setModal(null); onCambio(); }} />}
    </Modal>
  );
}

/* ─── Saldos iniciales ───────────────────────────────────────────────── */

function SaldosIniciales({ datos, cuentasDeu, onCerrar, onCargados }) {
  const toast = useToast();
  const [grilla, setGrilla] = useState(null);
  const [fecha, setFecha] = useState(hoyAr());
  const [elegidos, setElegidos] = useState({});
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const vivos = datos.clientes.filter((c) => c.activo !== false);
  const yaCargados = datos.operaciones.some((o) => o.origen === ORIGEN_SALDO_INICIAL && o.cliente_id);
  const resultado = useMemo(() => (grilla ? saldosClientesDelLibro(grilla, fecha, cuentasDeu) : null), [grilla, fecha, cuentasDeu]);
  const filas = useMemo(() => (resultado?.filas || []).map((f) => {
    const elegido = elegidos[f.nombre];
    return { ...f, cliente_id: elegido !== undefined ? elegido : (emparejarCliente(f.nombre, vivos)?.id ?? "") };
  }), [resultado, elegidos, vivos]);
  const total = filas.reduce((s, f) => s + f.saldo, 0);

  async function abrir(file) {
    if (!file) return;
    setLeyendo(true);
    setError(null);
    try {
      const g = await leerOperacionesDelLibro(file);
      if (!g) throw new Error("El archivo no tiene la hoja T-OPERACIONES.");
      setGrilla(g);
      setElegidos({});
    } catch (e) {
      setError(e.message || "No se pudo leer el archivo");
    } finally {
      setLeyendo(false);
    }
  }

  async function cargar() {
    setGuardando(true);
    setError(null);
    try {
      const d = await postClientes({ accion: "saldos_iniciales", fecha, filas: filas.map((f) => ({ cliente_id: f.cliente_id ? Number(f.cliente_id) : null, nombre: f.nombre, saldo: f.saldo })) });
      toast.success(`Saldos iniciales cargados: ${d.cargados} clientes${d.clientes_nuevos ? ` (${d.clientes_nuevos} nuevos en la lista)` : ""}`);
      onCargados();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onCerrar} title="Cargar saldos iniciales" maxWidth={720}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0">
          Subí el libro (.xlsx). Se suma todo lo de T-OPERACIONES que toca Deudores por Ventas hasta la fecha de corte, por cliente
          (juntando los nombres escritos distinto), y cada saldo entra como &quot;SALDO INICIAL&quot; contra Ajuste De Capital.
          Los que no están en la lista se crean.
        </p>
        {yaCargados && <p className="m-0 text-[13px] text-gypi-amber-ink">⚠ Ya hay saldos iniciales cargados: los de los clientes que cargues ahora se reemplazan.</p>}
        <div className="flex flex-wrap items-end gap-2">
          <label className="g-btn g-btn-secondary cursor-pointer">
            {leyendo ? "Leyendo…" : grilla ? "Elegir otro archivo" : "📂 Subir el libro"}
            <input type="file" accept=".xlsx,.xlsm" className="sr-only" aria-label="Subir el libro contable" disabled={leyendo} onChange={(e) => { abrir(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          {campo("Fecha de corte (incluida)", <input type="date" className="g-input" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />, "ml-auto")}
        </div>
        {(error || resultado?.error) && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error || resultado.error}</p>}
        {resultado && !resultado.error && (
          <>
            <p className="m-0 text-[13px] text-gypi-dim">
              {filas.length} clientes con saldo al {fechaCorta(fecha)} · Total que nos deben <b className="text-gypi-text">{plata(total, "ARS")}</b>.
              Si dos del libro son el mismo cliente, elegí el mismo en los dos.
            </p>
            <div className="max-h-[50vh] overflow-y-auto border border-gypi-border rounded-lg">
              <table className="w-full text-[13px] border-collapse" aria-label="Saldos del libro">
                <thead>
                  <tr className="text-gypi-dim text-left">
                    <th className="font-semibold p-2">En el libro</th>
                    <th className="font-semibold p-2">Cliente en Gypi</th>
                    <th className="font-semibold p-2 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.nombre} className="border-t border-gypi-border">
                      <td className="p-2">{f.nombre}{f.variantes > 1 && <span className="block text-[12px] text-gypi-dim">escrito de {f.variantes} formas</span>}</td>
                      <td className="p-2">
                        <select className="g-input w-full" aria-label={`Cliente para ${f.nombre}`} value={f.cliente_id} onChange={(e) => setElegidos((x) => ({ ...x, [f.nombre]: e.target.value }))}>
                          <option value="">— Crear con este nombre —</option>
                          {vivos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                        </select>
                      </td>
                      <td className={`p-2 text-right font-mono ${textoSaldoCliente(f.saldo).clase}`}>{plata(f.saldo, "ARS")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={!filas.length || guardando} onClick={cargar}>{guardando ? "Cargando…" : `Cargar ${filas.length} saldos`}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Pantalla ───────────────────────────────────────────────────────── */

export default function FinanzasClientes() {
  const toast = useToast();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [buscar, setBuscar] = useState("");
  const [filtro, setFiltro] = useState("deben");
  const [ficha, setFicha] = useState(null);
  const [modal, setModal] = useState(null);
  const [trayendo, setTrayendo] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await apiFetch("/api/finanzas/clientes");
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudieron cargar los clientes");
      setDatos(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const cuentasDeu = useMemo(() => new Set(datos?.cuentas_deudores || []), [datos]);
  const saldos = useMemo(() => (datos ? saldosClientes(datos.operaciones, cuentasDeu, datos.clientes) : []), [datos, cuentasDeu]);
  const lista = useMemo(() => {
    const b = normal(buscar);
    return saldos.filter((s) => (filtro === "deben" ? s.saldo >= 0.01 : filtro === "favor" ? s.saldo <= -0.01 : true) && (!b || normal(s.nombre).includes(b)));
  }, [saldos, buscar, filtro]);

  async function traer() {
    setTrayendo(true);
    try {
      const d = await postClientes({ accion: "traer_de_ot" });
      toast.success(d.agregados ? `Se sumaron ${d.agregados} clientes de las OT` : "Ya estaban todos los clientes de las OT");
      cargar();
    } catch (e) {
      toast.error(e.message);
    }
    setTrayendo(false);
  }

  if (error) return <p role="alert" className="m-[18px] text-[14px] text-gypi-red">⚠ {error}</p>;
  if (!datos) return <div className="flex-1 flex items-center justify-center py-10"><Spinner /></div>;
  if (!cuentasDeu.size) {
    return <p className="m-[18px] text-[14px] text-gypi-text">Primero copiá el libro en Finanzas → 🧾 Configuración: falta la cuenta &quot;Deudores por Ventas&quot; en el plan de cuentas.</p>;
  }
  const nosDeben = saldos.reduce((s, x) => s + Math.max(0, x.saldo), 0);
  const aFavor = saldos.reduce((s, x) => s + Math.max(0, -x.saldo), 0);
  const cuantos = (f) => saldos.filter((s) => (f === "deben" ? s.saldo >= 0.01 : s.saldo <= -0.01)).length;
  const fichaActual = ficha ? saldos.find((s) => s.clave === ficha) : null;

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <p className="m-0 text-[14px] text-gypi-text flex-1 min-w-[200px]">
          Nos deben <b>{plata(nosDeben, "ARS")}</b>{aFavor >= 0.01 && <> · A favor de clientes <b className="text-gypi-green">{plata(aFavor, "ARS")}</b></>}
        </p>
        <button type="button" className="g-btn g-btn-primary" onClick={() => setModal("nuevo")}>＋ Cliente</button>
        <button type="button" className="g-btn g-btn-secondary" disabled={trayendo} onClick={traer}>{trayendo ? "Trayendo…" : "📋 Traer de las OT"}</button>
        <button type="button" className="g-btn g-btn-secondary" onClick={() => setModal("iniciales")}>📥 Cargar saldos iniciales</button>
        <button type="button" className="g-btn g-btn-secondary" onClick={() => setModal("ventas")}>🧾 Ventas de las OT</button>
        <button type="button" className="g-btn g-btn-secondary" onClick={() => setModal("por_ot")}>📋 Cuenta por OT</button>
        <button type="button" className="g-btn g-btn-secondary" onClick={() => setModal("unificados")}>🔗 Cliente y proveedor</button>
      </div>
      <p className="m-0 mb-2 text-[13px] text-gypi-dim">
        {datos.ventas_ot?.activo
          ? `🧾 Las ventas y entregas de las OT se anotan solas (OT cargadas desde ${fechaCorta(datos.ventas_ot.desde)}).`
          : "🧾 Las ventas de las OT todavía no se anotan solas."}
      </p>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Chip active={filtro === "deben"} onClick={() => setFiltro("deben")}>Nos deben ({cuantos("deben")})</Chip>
        <Chip active={filtro === "favor"} onClick={() => setFiltro("favor")}>A favor ({cuantos("favor")})</Chip>
        <Chip active={filtro === "todos"} onClick={() => setFiltro("todos")}>Todos ({saldos.length})</Chip>
        <input className="g-input flex-1 min-w-[180px]" aria-label="Buscar cliente" placeholder="Buscar cliente" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
      </div>
      <ul className="list-none m-0 p-0 flex flex-col gap-1.5" aria-label="Clientes">
        {lista.slice(0, MAX_LISTA).map((s) => {
          const t = textoSaldoCliente(s.saldo);
          return (
            <li key={s.clave}>
              <button type="button" onClick={() => setFicha(s.clave)} className="w-full text-left min-h-[48px] px-3 py-2 rounded-lg border border-gypi-border bg-gypi-surface cursor-pointer">
                <span className="flex items-baseline gap-2 text-[14px] text-gypi-text">
                  <span className="font-semibold flex-1 min-w-0 truncate">{s.nombre || "Sin nombre"}</span>
                  <span className={`font-mono font-semibold ${t.clase}`}>{t.texto}</span>
                </span>
                <span className="block text-[12px] text-gypi-dim">
                  {s.ultimo ? `Último movimiento ${fechaCorta(s.ultimo)}` : "Sin movimientos"}{!s.cliente_id && " · No está en la lista de clientes"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {lista.length > MAX_LISTA && <p className="mt-2 text-[13px] text-gypi-dim">Hay {lista.length - MAX_LISTA} más: usá el buscador.</p>}
      {!lista.length && (
        <p className="mt-2 text-[13px] text-gypi-dim">
          {saldos.length ? "Ningún cliente con ese filtro." : "Todavía no hay clientes. Traelos de las OT o cargá los saldos iniciales del libro."}
        </p>
      )}

      {fichaActual && <Ficha saldo={fichaActual} datos={datos} cuentasDeu={cuentasDeu} onCerrar={() => setFicha(null)} onCambio={cargar} />}
      {modal === "nuevo" && <DatosCliente cliente={null} onCerrar={() => setModal(null)} onGuardado={() => { setModal(null); cargar(); }} />}
      {modal === "por_ot" && <FinanzasOtClientes onCerrar={() => setModal(null)} />}
      {modal === "unificados" && <FinanzasUnificados onCerrar={() => setModal(null)} onCambio={cargar} />}
      {modal === "ventas" && <VentasOt config={datos.ventas_ot} onCerrar={() => setModal(null)} onHecho={() => { setModal(null); cargar(); }} />}
      {modal === "iniciales" && <SaldosIniciales datos={datos} cuentasDeu={cuentasDeu} onCerrar={() => setModal(null)} onCargados={() => { setModal(null); cargar(); }} />}
    </div>
  );
}
