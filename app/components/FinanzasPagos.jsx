'use client';
// app/components/FinanzasPagos.jsx — Finanzas → 💸 Pagos (parte F2b, 2;
// migración 175; /api/finanzas/pagos; reglas en app/lib/finanzasPagos.js).
//
// La Orden de Pago: desde la ficha del proveedor (botón 💸 Pagar) o desde
// acá se eligen las compras que se pagan y con qué (efectivo, transferencia,
// e-cheq Credicoop o cheques de la cartera). Se manda por WhatsApp al CFO con
// un link para aprobarla o rechazarla (/op/<token>, sin usuario). Aprobada,
// el dueño la marca pagada y recién ahí se generan las operaciones y los
// cheques. El PDF sale de la ventana de imprimir.
// Solo el rol Dueño (la pantalla ni aparece para los demás).
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyAr, numero, plata } from "../lib/finanzasOperaciones";
import { numeroWhatsapp } from "../lib/compras";
import {
  ESTADOS_ORDEN, FORMAS_PAGO, accionesOrden, cuentasParaPagar, fechaCorta, imprimirOrdenPago, textoForma, textoWhatsappCfo,
} from "../lib/finanzasPagos";
import { Chip, Modal, SelectBuscable, Spinner } from "./ui";
import { useToast } from "./ui/Toast";
import ElegirProveedor from "./FinanzasElegirProveedor";

const normal = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

async function postPagos(body) {
  const res = await apiFetch("/api/finanzas/pagos", { method: "POST", body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "No se pudo guardar");
  return d;
}

/** Abre WhatsApp con el link para el CFO. */
function mandarWhatsapp(orden, url, datos) {
  const texto = textoWhatsappCfo(orden, url, { empresa: datos.empresa?.nombre || "", cfo: datos.cfo?.nombre || "" });
  const tel = numeroWhatsapp(datos.cfo?.telefono);
  window.open(`https://wa.me/${tel || ""}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
}

function campo(label, input) {
  return <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">{label}{input}</label>;
}

/* ─── Nueva orden ────────────────────────────────────────────────────── */

const FORMA_VACIA = { efectivo: { cuenta: "", importe: "" }, transferencia: { cuenta: "", importe: "" }, echeq: { importe: "", fecha_pago: "", numero: "" }, cheque_tercero: { cheque_id: "" } };

/**
 * @param {{ datos: object, proveedorId?: number, pendientes?: { op: object, falta: number }[], onCerrar: Function, onGuardada: Function }} props
 *   pendientes: las compras sin pagar del proveedor (de la ficha), para elegir qué se paga.
 */
export function NuevaOrden({ datos, proveedorId = null, pendientes = [], onCerrar, onGuardada }) {
  const toast = useToast();
  const { cajas, bancos } = useMemo(() => cuentasParaPagar(datos.tesoreria), [datos.tesoreria]);
  const [proveedor, setProveedor] = useState(proveedorId ? String(proveedorId) : "");
  const [fecha, setFecha] = useState(hoyAr());
  const [elegidas, setElegidas] = useState(() => new Set());
  const [formas, setFormas] = useState([]);
  const [notas, setNotas] = useState("");
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const usados = new Set(formas.filter((f) => f.forma === "cheque_tercero").map((f) => String(f.cheque_id)));
  const importeDe = (f) => (f.forma === "cheque_tercero" ? Number(datos.cheques.find((c) => String(c.id) === String(f.cheque_id))?.importe) || 0 : numero(f.importe) || 0);
  const total = formas.reduce((s, f) => s + importeDe(f), 0);
  const aPagar = pendientes.filter((p) => elegidas.has(p.op.id)).reduce((s, p) => s + p.falta, 0);
  const diferencia = Math.round((total - aPagar) * 100) / 100;

  const agregar = (forma) => setFormas((x) => [...x, {
    forma, ...FORMA_VACIA[forma],
    ...(forma === "efectivo" && cajas.length === 1 ? { cuenta: cajas[0].cuenta } : {}),
    ...(forma === "transferencia" && bancos.length === 1 ? { cuenta: bancos[0].cuenta } : {}),
    // Lo que falta para llegar a lo elegido
    ...(forma !== "cheque_tercero" && aPagar - total > 0 ? { importe: String(Math.round((aPagar - total) * 100) / 100).replace(".", ",") } : {}),
  }]);
  const cambiar = (i, k) => (e) => setFormas((x) => x.map((f, j) => (j === i ? { ...f, [k]: e.target.value } : f)));
  const quitar = (i) => setFormas((x) => x.filter((_, j) => j !== i));
  const elegir = (id) => setElegidas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function guardar(mandar) {
    setError(null);
    setGuardando(true);
    try {
      const d = await postPagos({
        accion: "crear", mandar,
        orden: {
          proveedor_id: proveedor ? Number(proveedor) : null, fecha, notas,
          facturas: pendientes.filter((p) => elegidas.has(p.op.id)).map((p) => ({ op_id: p.op.id, fecha: p.op.fecha, detalle: [p.op.tipo, p.op.descripcion].filter(Boolean).join(" · "), importe: p.falta })),
          formas: formas.map((f) => ({ ...f, importe: f.forma === "cheque_tercero" ? undefined : numero(f.importe) })),
        },
      });
      if (mandar && d.url) mandarWhatsapp(d.orden, d.url, datos);
      toast.success(mandar ? `Orden N° ${d.orden.numero} lista: mandásela al CFO por WhatsApp` : `Orden N° ${d.orden.numero} guardada como borrador`);
      onGuardada(d.orden);
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onCerrar} title="Orden de pago" maxWidth={640}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <div className="flex flex-wrap gap-2">
          <div className="flex-1 min-w-[200px]">
            {campo("Proveedor", (
              <ElegirProveedor aria-label="Proveedor" vacio="Elegí…" value={proveedor} disabled={!!proveedorId} proveedores={datos.proveedores} onChange={(e) => setProveedor(e.target.value)} />
            ))}
          </div>
          {campo("Fecha", <input type="date" className="g-input" aria-label="Fecha de la orden" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />)}
        </div>

        {pendientes.length > 0 && (
          <fieldset className="border border-gypi-border rounded-lg p-2 m-0">
            <legend className="text-[13px] font-semibold px-1">Qué se paga</legend>
            <ul className="list-none m-0 p-0 flex flex-col gap-1 max-h-[30vh] overflow-y-auto">
              {pendientes.map((p) => (
                <li key={p.op.id}>
                  <label className="flex items-baseline gap-2 text-[13px] min-h-[36px] cursor-pointer">
                    <input type="checkbox" checked={elegidas.has(p.op.id)} onChange={() => elegir(p.op.id)} aria-label={`Pagar ${p.op.tipo} del ${fechaCorta(p.op.fecha)}`} />
                    <span className="font-mono text-[12px] text-gypi-dim">{fechaCorta(p.op.fecha)}</span>
                    <span className="flex-1 min-w-0 truncate">{p.op.tipo}{p.op.descripcion ? ` · ${p.op.descripcion}` : ""}</span>
                    <span className="font-mono font-semibold">{plata(p.falta, "ARS")}</span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="m-0 mt-1 text-[12px] text-gypi-dim">Elegido: <b className="text-gypi-text">{plata(aPagar, "ARS")}</b></p>
          </fieldset>
        )}

        <div className="flex flex-col gap-2">
          <div className="text-[13px] font-semibold">Con qué se paga</div>
          {formas.map((f, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 p-2 rounded-lg border border-gypi-border bg-gypi-surface">
              <span className="w-full text-[13px] font-semibold">{FORMAS_PAGO[f.forma]}</span>
              {(f.forma === "efectivo" || f.forma === "transferencia") && (
                <SelectBuscable className="g-input flex-1 min-w-[160px]" aria-label={f.forma === "efectivo" ? "Caja" : "Banco"} value={f.cuenta} onChange={cambiar(i, "cuenta")}>
                  <option value="">{f.forma === "efectivo" ? "Elegí la caja" : "Elegí el banco"}</option>
                  {(f.forma === "efectivo" ? cajas : bancos).map((t) => <option key={t.cuenta} value={t.cuenta}>{t.nombre}</option>)}
                </SelectBuscable>
              )}
              {f.forma === "echeq" && (
                <>
                  {campo("Vence el", <input type="date" className="g-input" aria-label="Fecha de pago del e-cheq" value={f.fecha_pago} onChange={cambiar(i, "fecha_pago")} />)}
                  {campo("N° (si ya lo tenés)", <input className="g-input w-[130px]" aria-label="Número del e-cheq" value={f.numero} maxLength={40} onChange={cambiar(i, "numero")} />)}
                </>
              )}
              {f.forma === "cheque_tercero" ? (
                <SelectBuscable className="g-input flex-1 min-w-[220px]" aria-label="Cheque de la cartera" value={f.cheque_id} onChange={cambiar(i, "cheque_id")}>
                  <option value="">Elegí un cheque en cartera</option>
                  {datos.cheques.filter((c) => !usados.has(String(c.id)) || String(c.id) === String(f.cheque_id)).map((c) => (
                    <option key={c.id} value={c.id}>{plata(c.importe, "ARS")} · {c.banco || "Cheque"}{c.numero ? ` N° ${c.numero}` : ""} · vence {fechaCorta(c.fecha_pago)}</option>
                  ))}
                </SelectBuscable>
              ) : (
                <input className="g-input w-[150px] text-right font-mono" inputMode="decimal" aria-label={`Importe en ${FORMAS_PAGO[f.forma]}`} placeholder="Importe" value={f.importe} onChange={cambiar(i, "importe")} />
              )}
              <button type="button" className="g-btn g-btn-secondary min-h-[44px]" aria-label="Quitar esta forma de pago" onClick={() => quitar(i)}>✕</button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="g-btn g-btn-secondary" disabled={!cajas.length} onClick={() => agregar("efectivo")}>+ Efectivo</button>
            <button type="button" className="g-btn g-btn-secondary" disabled={!bancos.length} onClick={() => agregar("transferencia")}>+ Transferencia</button>
            <button type="button" className="g-btn g-btn-secondary" onClick={() => agregar("echeq")}>+ E-cheq Credicoop</button>
            <button type="button" className="g-btn g-btn-secondary" disabled={!datos.cheques.length} onClick={() => agregar("cheque_tercero")}>+ Cheque de la cartera</button>
          </div>
        </div>

        <p className="m-0 text-[16px]">Total de la orden: <b className="font-mono">{plata(total, "ARS")}</b></p>
        {pendientes.length > 0 && elegidas.size > 0 && Math.abs(diferencia) >= 0.01 && (
          <p className="m-0 text-[13px] text-gypi-amber-ink">
            {diferencia > 0 ? `Pagás ${plata(diferencia, "ARS")} más que lo elegido: queda a cuenta.` : `Faltan ${plata(-diferencia, "ARS")} para cubrir lo elegido: queda un pago parcial.`}
          </p>
        )}
        {campo("Nota para el CFO (opcional)", <textarea className="g-input w-full min-h-[60px]" aria-label="Nota" value={notas} maxLength={500} onChange={(e) => setNotas(e.target.value)} />)}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-secondary" disabled={guardando || !formas.length} onClick={() => guardar(false)}>Guardar borrador</button>
          <button type="button" className="g-btn g-btn-primary" disabled={guardando || !formas.length} onClick={() => guardar(true)}>
            {guardando ? "Guardando…" : "Guardar y mandar al CFO"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Detalle de una orden ───────────────────────────────────────────── */

function Detalle({ orden, datos, url, onCerrar, onCambio }) {
  const toast = useToast();
  const [fecha, setFecha] = useState(hoyAr());
  const [haciendo, setHaciendo] = useState(null);
  const [confirmarAnular, setConfirmarAnular] = useState(false);
  const [error, setError] = useState(null);
  const est = ESTADOS_ORDEN[orden.estado] || { nombre: orden.estado, icono: "" };
  const acciones = accionesOrden(orden.estado);

  async function hacer(accion, extra = {}) {
    setError(null);
    setHaciendo(accion);
    try {
      const d = await postPagos({ accion, id: orden.id, ...extra });
      if (accion === "mandar" && d.url) mandarWhatsapp(d.orden, d.url, datos);
      toast.success({ mandar: "Abrimos WhatsApp con el link para el CFO", pagar: "Orden pagada: se generaron las operaciones y los cheques", anular: "Orden anulada" }[accion]);
      onCambio();
    } catch (e) {
      setError(e.message);
    } finally {
      setHaciendo(null);
    }
  }

  function pdf() {
    setError(null);
    try { imprimirOrdenPago({ empresa: datos.empresa, orden }); } catch (e) { setError(e.message); }
  }

  return (
    <Modal open onClose={onCerrar} title={`Orden de pago N° ${orden.numero}`} maxWidth={600}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <div>
          <div className="text-[17px] font-bold">{orden.proveedor_nombre}</div>
          <div className="text-[13px] text-gypi-dim">{est.icono} {est.nombre} · {fechaCorta(orden.fecha)}{orden.cargada_por_nombre ? ` · ${orden.cargada_por_nombre}` : ""}</div>
        </div>
        <p className="m-0 text-[22px] font-bold font-mono">{plata(orden.total, "ARS")}</p>
        <ul className="list-none m-0 p-0 flex flex-col gap-1" aria-label="Formas de pago">
          {(orden.formas || []).map((f, i) => (
            <li key={i} className="flex items-baseline gap-2 text-[13px]">
              <span className="flex-1 min-w-0">{textoForma(f)}</span>
              <span className="font-mono font-semibold">{plata(f.importe, "ARS")}</span>
            </li>
          ))}
        </ul>
        {(orden.facturas || []).length > 0 && (
          <div className="text-[13px] text-gypi-dim">
            Paga: {(orden.facturas || []).map((f) => `${fechaCorta(f.fecha)} ${f.detalle} (${plata(f.importe, "ARS")})`).join(" · ")}
          </div>
        )}
        {orden.notas && <p className="m-0 text-[13px]">📝 {orden.notas}</p>}
        {orden.decidida_at && (
          <p className={`m-0 text-[13px] ${orden.estado === "rechazada" ? "text-gypi-red" : "text-gypi-green"}`}>
            {orden.estado === "rechazada" ? "❌ Rechazada" : "✅ Aprobada"}{orden.decidida_por_nombre ? ` por ${orden.decidida_por_nombre}` : ""} el {fechaCorta(String(orden.decidida_at).slice(0, 10))}
            {orden.decision_nota ? `: ${orden.decision_nota}` : ""}
          </p>
        )}
        {orden.estado === "pagada" && (
          <p className="m-0 text-[13px] text-gypi-dim">
            💸 Pagada el {fechaCorta(orden.pagada_fecha)}{orden.pagada_por_nombre ? ` por ${orden.pagada_por_nombre}` : ""}. Las operaciones están en Movimientos y los cheques en Cheques.
          </p>
        )}
        {orden.estado === "para_aprobar" && url && (
          <p className="m-0 text-[12px] text-gypi-dim break-all">Link para el CFO: {url}</p>
        )}

        {acciones.includes("pagar") && (
          <div className="flex flex-wrap items-end gap-2 p-2 rounded-lg border border-gypi-border">
            {campo("Fecha del pago", <input type="date" className="g-input" aria-label="Fecha del pago" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />)}
            <button type="button" className="g-btn g-btn-primary flex-1" disabled={!!haciendo} onClick={() => hacer("pagar", { fecha })}>
              {haciendo === "pagar" ? "Pagando…" : "💸 Marcar pagada"}
            </button>
          </div>
        )}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        {confirmarAnular ? (
          <div className="flex flex-col gap-2 p-2 rounded-lg border border-gypi-red">
            <p className="m-0 text-[13px]">
              {orden.estado === "pagada"
                ? "¿Anular la orden pagada? Se anulan sus operaciones, los e-cheq que emitió y los cheques de terceros vuelven a la cartera."
                : "¿Anular la orden? El link del CFO deja de servir."}
            </p>
            <div className="flex gap-2">
              <button type="button" className="g-btn g-btn-secondary flex-1" onClick={() => setConfirmarAnular(false)}>No</button>
              <button type="button" className="g-btn g-btn-danger flex-1" disabled={!!haciendo} onClick={() => hacer("anular")}>{haciendo === "anular" ? "Anulando…" : "Sí, anular"}</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="g-btn g-btn-secondary flex-1" onClick={pdf}>📄 PDF</button>
            {acciones.includes("mandar") && (
              <button type="button" className="g-btn g-btn-secondary flex-1" disabled={!!haciendo} onClick={() => hacer("mandar")}>
                {orden.estado === "para_aprobar" ? "📲 Mandar el link de nuevo" : "📲 Mandar al CFO"}
              </button>
            )}
            {acciones.includes("anular") && <button type="button" className="g-btn g-btn-secondary flex-1" onClick={() => setConfirmarAnular(true)}>🚫 Anular</button>}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ─── A quién se le manda ────────────────────────────────────────────── */

function DatosCfo({ cfo, onCerrar, onGuardado }) {
  const [nombre, setNombre] = useState(cfo?.nombre || "");
  const [telefono, setTelefono] = useState(cfo?.telefono || "");
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  async function guardar() {
    setGuardando(true);
    try {
      await postPagos({ accion: "cfo", nombre, telefono });
      onGuardado();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onCerrar} title="¿Quién aprueba los pagos?" maxWidth={440}>
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] text-gypi-dim">El link de cada orden se le manda por WhatsApp a esta persona. No necesita usuario en Gypi.</p>
        {campo("Nombre", <input className="g-input w-full" aria-label="Nombre del CFO" value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} />)}
        {campo("WhatsApp", <input className="g-input w-full" aria-label="WhatsApp del CFO" inputMode="tel" placeholder="351 555 1234" value={telefono} maxLength={30} onChange={(e) => setTelefono(e.target.value)} />)}
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

/** Lee lo que necesita la orden de pago (también lo usa la ficha del proveedor). */
export async function leerDatosPagos(anuladas = false) {
  const res = await apiFetch(`/api/finanzas/pagos${anuladas ? "?anuladas=1" : ""}`);
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "No se pudieron cargar las órdenes de pago");
  return d;
}

const FILTROS = {
  pendientes: { nombre: "Por resolver", estados: ["borrador", "para_aprobar", "aprobada", "rechazada"] },
  aprobada: { nombre: "Para pagar", estados: ["aprobada"] },
  pagada: { nombre: "Pagadas", estados: ["pagada"] },
  todas: { nombre: "Todas", estados: null },
};

export default function FinanzasPagos() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [filtro, setFiltro] = useState("pendientes");
  const [buscar, setBuscar] = useState("");
  const [anuladas, setAnuladas] = useState(false);
  const [nueva, setNueva] = useState(false);
  const [abierta, setAbierta] = useState(null);
  const [cfo, setCfo] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setDatos(await leerDatosPagos(anuladas));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [anuladas]);
  useEffect(() => { cargar(); }, [cargar]);

  const lista = useMemo(() => {
    const b = normal(buscar);
    const est = FILTROS[filtro].estados;
    return (datos?.ordenes || []).filter((o) => (!est || est.includes(o.estado)) && (!b || normal(`${o.numero} ${o.proveedor_nombre}`).includes(b)));
  }, [datos, filtro, buscar]);

  if (error) return <p role="alert" className="m-[18px] text-[14px] text-gypi-red">⚠ {error}</p>;
  if (!datos) return <div className="flex-1 flex items-center justify-center py-10"><Spinner /></div>;
  const cuantas = (f) => (datos.ordenes || []).filter((o) => !FILTROS[f].estados || FILTROS[f].estados.includes(o.estado)).length;
  const orden = abierta ? datos.ordenes.find((o) => o.id === abierta) : null;

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <p className="m-0 text-[13px] text-gypi-dim flex-1 min-w-[200px]">
          Aprueba: <b className="text-gypi-text">{datos.cfo?.nombre || "sin cargar"}</b>{datos.cfo?.telefono ? ` · ${datos.cfo.telefono}` : ""}{" "}
          <button type="button" className="bg-transparent border-none p-0 text-gypi-amber-ink font-semibold cursor-pointer" onClick={() => setCfo(true)}>Cambiar</button>
        </p>
        <button type="button" className="g-btn g-btn-primary" onClick={() => setNueva(true)}>+ Orden de pago</button>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {Object.entries(FILTROS).map(([k, f]) => <Chip key={k} active={filtro === k} onClick={() => setFiltro(k)}>{f.nombre} ({cuantas(k)})</Chip>)}
        <input className="g-input flex-1 min-w-[160px]" aria-label="Buscar orden" placeholder="Buscar proveedor o N°" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        <label className="flex items-center gap-1 text-[13px] text-gypi-dim">
          <input type="checkbox" checked={anuladas} onChange={(e) => setAnuladas(e.target.checked)} /> Ver anuladas
        </label>
      </div>
      <ul className="list-none m-0 p-0 flex flex-col gap-1.5" aria-label="Órdenes de pago">
        {lista.map((o) => {
          const est = ESTADOS_ORDEN[o.estado] || { nombre: o.estado, icono: "" };
          return (
            <li key={o.id}>
              <button type="button" onClick={() => setAbierta(o.id)}
                className="w-full text-left min-h-[48px] px-3 py-2 rounded-lg border border-gypi-border bg-gypi-surface cursor-pointer">
                <span className="flex items-baseline gap-2 text-[14px] text-gypi-text">
                  <span className="font-mono text-[12px] text-gypi-dim">N° {o.numero}</span>
                  <span className="font-semibold flex-1 min-w-0 truncate">{o.proveedor_nombre}</span>
                  <span className="font-mono font-semibold">{plata(o.total, "ARS")}</span>
                </span>
                <span className={`block text-[12px] ${o.estado === "aprobada" ? "text-gypi-green font-semibold" : o.estado === "rechazada" ? "text-gypi-red" : "text-gypi-dim"}`}>
                  {est.icono} {est.nombre} · {fechaCorta(o.fecha)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!lista.length && (
        <p className="mt-2 text-[13px] text-gypi-dim">
          {(datos.ordenes || []).length ? "Ninguna orden con ese filtro." : "Todavía no hay órdenes de pago. Armá la primera con \"+ Orden de pago\" o desde la ficha del proveedor (💸 Pagar)."}
        </p>
      )}

      {nueva && <NuevaOrden datos={datos} onCerrar={() => setNueva(false)} onGuardada={(o) => { setNueva(false); setAbierta(o.id); cargar(); }} />}
      {orden && <Detalle orden={orden} datos={datos} url={datos.links?.[orden.id]} onCerrar={() => setAbierta(null)} onCambio={cargar} />}
      {cfo && <DatosCfo cfo={datos.cfo} onCerrar={() => setCfo(false)} onGuardado={() => { setCfo(false); cargar(); }} />}
    </div>
  );
}
