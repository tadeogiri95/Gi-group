'use client';
// app/components/FinanzasCargar.jsx — el botón ➕ Cargar de Finanzas (etapa 3
// de la auditoría de Finanzas integrada, 14/11).
//
// Antes cada pantalla tenía su propio formulario para lo mismo (una factura se
// cargaba por 8 caminos, un pago por 7, un cobro por 6). Ahora el mismo botón
// aparece en el Inicio de Finanzas, en Tesorería (con la caja elegida), en la
// ficha de cada proveedor y de cada cliente, y abre siempre el mismo
// formulario de cada documento, ya completado con lo que se sabe:
//   🧾 Factura o gasto → FinanzasCargarGasto (con o sin factura)
//   💸 Pago a un proveedor → la Orden de pago (FinanzasPagos)
//   💵 Cobro de un cliente → Cobrar (FinanzasClientes)
//   ⇄ Entre cajas → Pasar plata entre cajas (FinanzasTransferir)
//   Otra operación → el formulario general (FinanzasNuevaOperacion)
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyAr } from "../lib/finanzasOperaciones";
import CargarGasto from "./FinanzasCargarGasto";
import { NuevaOperacion } from "./FinanzasNuevaOperacion";
import Transferir from "./FinanzasTransferir";
import { NuevaOrden, leerDatosPagos } from "./FinanzasPagos";
import { Cobrar } from "./FinanzasClientes";
import { VentanaAltaPersona } from "./AltaPersona";
import { Modal, SelectBuscable, Spinner } from "./ui";
import { useToast } from "./ui/Toast";

/** Lo que se puede cargar, en el orden en que se muestra. */
export const DOCUMENTOS = [
  { id: "gasto", icono: "🧾", nombre: "Factura o gasto", detalle: "Una compra o un gasto, con factura o sin factura. Si ya se pagó, también el pago." },
  { id: "pago", icono: "💸", nombre: "Pago a un proveedor", detalle: "Orden de pago: efectivo, transferencia, e-cheq o un cheque de la cartera." },
  { id: "cobro", icono: "💵", nombre: "Cobro de un cliente", detalle: "Efectivo, transferencia, dólares o cheque. Suma en su cuenta corriente." },
  { id: "cajas", icono: "⇄", nombre: "Entre cajas y bancos", detalle: "Pasar plata de una caja o banco a otro." },
];

async function leer(url, error) {
  const res = await apiFetch(url);
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || error);
  return d;
}
// Las listas de Finanzas (tipos, cuentas, cajas, proveedores, OT): con un solo día alcanza
const leerListas = () => { const h = hoyAr(); return leer(`/api/finanzas/operaciones?desde=${h}&hasta=${h}`, "No se pudieron cargar las listas de Finanzas"); };
const leerClientes = () => leer("/api/finanzas/clientes", "No se pudieron cargar los clientes");

/** Primero el cliente (si no vino elegido), después el cobro. */
function ElegirClienteCobro({ datos, onElegido, onCerrar }) {
  const [id, setId] = useState("");
  const [alta, setAlta] = useState(null);
  const lista = (datos.clientes || []).filter((c) => c.activo !== false && !c.unido_a);
  return (
    <Modal open onClose={onCerrar} title="Cobro de un cliente" maxWidth={480}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">
          ¿Quién pagó?
          <SelectBuscable className="g-input w-full" aria-label="Cliente que pagó" value={id} onChange={(e) => setId(e.target.value)}
            nuevo={{ etiqueta: "Nuevo cliente", onElegir: (nombre) => setAlta({ nombre }) }}>
            <option value="">Elegí el cliente</option>
            {lista.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </SelectBuscable>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={!id} onClick={() => onElegido(lista.find((c) => String(c.id) === String(id)))}>Seguir</button>
        </div>
      </div>
      <VentanaAltaPersona abierta={!!alta} onCerrar={() => setAlta(null)} nombre={alta?.nombre || ""} rol="cliente"
        onCreada={(p) => { if (p?.cliente_id) onElegido({ id: p.cliente_id, nombre: p.nombre, activo: true }); }} />
    </Modal>
  );
}

/**
 * La ventana de ➕ Cargar: elegir qué se carga y abrir su formulario.
 * @param {{ contexto?: { proveedorId?, cliente?: { id, nombre }, caja?, proyectoId?, cuentaGasto? }, documentos?: string[],
 *   onPago?: () => void, onCerrar: () => void, onHecho?: (doc: string) => void }} props
 *   onPago: la ficha del proveedor abre su propio pago (con las facturas pendientes para elegir).
 */
export function VentanaCargar({ contexto = {}, documentos = null, onPago = null, onCerrar, onHecho }) {
  const toast = useToast();
  const [doc, setDoc] = useState(null);
  const [datos, setDatos] = useState(null);
  const [cliente, setCliente] = useState(contexto.cliente || null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const opciones = DOCUMENTOS.filter((d) => !documentos || documentos.includes(d.id));
  // Con un solo documento (por ejemplo "🧾 Factura o gasto" en la ficha del proveedor) se abre directo
  const directo = documentos?.length === 1 ? documentos[0] : null;
  useEffect(() => { if (directo) elegir(directo); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function elegir(id) {
    if (id === "pago" && onPago) { onCerrar(); onPago(); return; }
    setError(null);
    setCargando(true);
    try {
      const d = id === "pago" ? await leerDatosPagos() : id === "cobro" ? await leerClientes() : await leerListas();
      if (id !== "pago" && id !== "cobro" && !d.tipos?.length) throw new Error("Primero copiá el libro en Finanzas → Configuración: sin tipos de operación no se puede cargar.");
      setDatos(d);
      setDoc(id);
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }
  const hecho = () => { onHecho?.(doc); onCerrar(); };

  if (doc === "gasto") {
    const inicial = {
      ...(contexto.proveedorId ? { proveedor_id: String(contexto.proveedorId) } : {}),
      ...(contexto.proyectoId ? { proyecto_id: String(contexto.proyectoId) } : {}),
      ...(contexto.caja ? { cuenta_caja: contexto.caja } : {}),
      ...(contexto.cuentaGasto ? { cuenta_gasto: contexto.cuentaGasto } : {}),
    };
    return <CargarGasto datos={datos} inicial={inicial} onCerrar={onCerrar} onGuardada={hecho} />;
  }
  if (doc === "pago") {
    return <NuevaOrden datos={datos} proveedorId={contexto.proveedorId || null} onCerrar={onCerrar} onGuardada={() => { toast.success("La orden queda en 💸 Pagos para pagarla"); hecho(); }} />;
  }
  if (doc === "cobro") {
    if (!cliente) return <ElegirClienteCobro datos={datos} onElegido={setCliente} onCerrar={onCerrar} />;
    return <Cobrar datos={datos} cliente={cliente} proyectoId={contexto.proyectoId || ""} cajaInicial={contexto.caja || ""} onCerrar={onCerrar} onHecho={hecho} />;
  }
  if (doc === "cajas") return <Transferir datos={datos} desdeInicial={contexto.caja || ""} onCerrar={onCerrar} onHecho={hecho} />;
  if (doc === "otra") {
    const inicial = {
      ...(contexto.proveedorId ? { proveedor_id: contexto.proveedorId } : {}),
      ...(contexto.proyectoId ? { proyecto_id: contexto.proyectoId } : {}),
    };
    return <NuevaOperacion datos={datos} cajaInicial={contexto.caja || ""} inicial={inicial} onCerrar={onCerrar} onGuardada={hecho} />;
  }

  if (directo && !error) return cargando ? <Modal open onClose={onCerrar} title="Cargando…" maxWidth={360}><div className="flex justify-center py-4"><Spinner /></div></Modal> : null;

  return (
    <Modal open onClose={onCerrar} title="¿Qué querés cargar?" maxWidth={560}>
      <div className="flex flex-col gap-2">
        {opciones.map((d) => (
          <button key={d.id} type="button" disabled={cargando} onClick={() => elegir(d.id)}
            className="w-full min-h-[60px] text-left px-3 py-2 rounded-xl border border-gypi-border bg-gypi-surface cursor-pointer disabled:opacity-60">
            <span className="block text-[15px] font-bold text-gypi-text">{d.icono} {d.nombre}</span>
            <span className="block text-[12px] text-gypi-dim">{d.detalle}</span>
          </button>
        ))}
        {!documentos && (
          <button type="button" disabled={cargando} onClick={() => elegir("otra")}
            className="self-start min-h-[44px] px-1 bg-transparent border-none text-[13px] font-semibold text-gypi-violet underline cursor-pointer">
            Otra operación (sueldos, impuestos, ajustes…)
          </button>
        )}
        {cargando && <div className="flex justify-center py-2"><Spinner /></div>}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
      </div>
    </Modal>
  );
}

/**
 * El botón ➕ Cargar.
 * @param {{ contexto?: object, documentos?: string[], onPago?: () => void, onHecho?: (doc: string) => void, className?: string, children?: any }} props
 */
export default function BotonCargar({ contexto, documentos, onPago, onHecho, className = "g-btn g-btn-primary", children }) {
  const [abierta, setAbierta] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setAbierta(true)}>{children || "➕ Cargar"}</button>
      {abierta && <VentanaCargar contexto={contexto} documentos={documentos} onPago={onPago} onCerrar={() => setAbierta(false)} onHecho={onHecho} />}
    </>
  );
}
