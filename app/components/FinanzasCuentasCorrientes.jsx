'use client';
// app/components/FinanzasCuentasCorrientes.jsx — Finanzas → 📒 Cuentas
// corrientes (pedido de Tadeo del 19/11; reglas en
// app/lib/finanzasCuentasCorrientes.js). Sin migración.
//
// Una sola lista con los clientes y los proveedores, porque hay clientes que
// también son proveedores y al revés. Reemplaza a 👥 Clientes y 🏭
// Proveedores en el menú (los links viejos abren esta pantalla con su
// filtro). Cada renglón abre la ficha de siempre; el que es las dos cosas
// muestra lo que nos debe, lo que le debemos y el neto, con ⚖ Compensar.
// Las herramientas de las dos pantallas viejas están en "🛠 Más".
// Solo el rol Dueño (la pantalla ni aparece para los demás).
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { plata } from "../lib/finanzasOperaciones";
import { saldosClientes } from "../lib/finanzasClientes";
import { saldosProveedores } from "../lib/finanzasProveedores";
import { FILTROS_CC, cuentasCorrientes, entraEnFiltro, filtroInicialCc, totalesCc } from "../lib/finanzasCuentasCorrientes";
import { Chip, Modal, Spinner } from "./ui";
import BotonEstadoCuenta from "./FinanzasEstadoCuenta";
import { useToast } from "./ui/Toast";
import {
  DatosCliente, Ficha as FichaCliente, SaldosIniciales as SaldosInicialesClientes, VentasOt, textoSaldoCliente,
} from "./FinanzasClientes";
import {
  CuentasDeProveedores, Ficha as FichaProveedor, SaldosIniciales as SaldosInicialesProveedores, aprendidasDe, textoSaldo,
} from "./FinanzasProveedores";
import FinanzasUnificados, { Compensar, textoNeto } from "./FinanzasUnificados";
import FinanzasOtClientes from "./FinanzasOtClientes";
import FinanzasSos from "./FinanzasSos";

const MAX_LISTA = 300;
const fechaCorta = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}` : "");
const normal = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const ETIQUETA = { cliente: "👥 Cliente", proveedor: "🏭 Proveedor", ambos: "👥🏭 Cliente y proveedor" };

async function leer(url, error) {
  const res = await apiFetch(url);
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || error);
  return d;
}

/** El texto del saldo de un renglón: el neto si es las dos cosas, o su saldo. */
export function textoRenglonCc(r) {
  if (r.tipo === "cliente") return textoSaldoCliente(r.nos_debe);
  if (r.tipo === "proveedor") return textoSaldo(r.le_debemos);
  return { texto: textoNeto(r.neto), clase: Math.abs(r.neto) >= 0.01 ? "text-gypi-text" : "text-gypi-dim" };
}

/** El que es cliente y proveedor: los dos saldos, el neto, compensar y abrir cada ficha. */
function FichaAmbos({ r, onCliente, onProveedor, onCerrar, onCambio }) {
  const [compensar, setCompensar] = useState(false);
  const compensable = Math.max(0, Math.min(r.nos_debe, r.le_debemos));
  const cuenta = {
    cliente_id: r.cliente.cliente_id, proveedor_id: r.proveedor.proveedor_id, cliente: r.cliente.nombre, proveedor: r.proveedor.nombre,
    nos_debe: r.nos_debe, le_debemos: r.le_debemos, neto: r.neto, compensable: Math.round(compensable * 100) / 100,
  };
  return (
    <Modal open onClose={onCerrar} title={r.nombre || "Cuenta corriente"} maxWidth={520}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px] text-gypi-dim">
          Es cliente{r.cliente.nombre !== r.proveedor.nombre ? ` (${r.cliente.nombre})` : ""} y proveedor{r.cliente.nombre !== r.proveedor.nombre ? ` (${r.proveedor.nombre})` : ""}.
          Las dos cuentas siguen separadas en el libro; acá se ven juntas.
        </p>
        <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
          <dt>Nos debe como cliente</dt><dd className="m-0 font-mono text-right">{plata(r.nos_debe, "ARS")}</dd>
          <dt>Le debemos como proveedor</dt><dd className="m-0 font-mono text-right">{plata(r.le_debemos, "ARS")}</dd>
          <dt className="font-bold">Neto</dt><dd className="m-0 font-mono font-bold text-right">{textoNeto(r.neto).replace("Neto: ", "")}</dd>
        </dl>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="g-btn g-btn-secondary flex-1" onClick={onCliente}>👥 Ver como cliente</button>
          <button type="button" className="g-btn g-btn-secondary flex-1" onClick={onProveedor}>🏭 Ver como proveedor</button>
        </div>
        <div><BotonEstadoCuenta cliente={r.cliente.clave} proveedor={r.proveedor.clave} nombre={r.nombre} /></div>
        {cuenta.compensable > 0 && (
          <button type="button" className="g-btn g-btn-primary" onClick={() => setCompensar(true)}>⚖ Compensar una deuda con la otra</button>
        )}
      </div>
      {compensar && <Compensar cuenta={cuenta} onCerrar={() => setCompensar(false)} onHecho={() => { setCompensar(false); onCambio(); onCerrar(); }} />}
    </Modal>
  );
}

const HERRAMIENTAS = [
  ["traer", "📋 Traer clientes de las OT"],
  ["iniciales_cli", "📥 Saldos iniciales de clientes"],
  ["iniciales_prov", "📥 Saldos iniciales de proveedores"],
  ["ventas", "🧾 Ventas de las OT"],
  ["por_ot", "📋 Cuenta por OT"],
  ["unificados", "🔗 Unir cliente y proveedor"],
  ["cuentas_prov", "📚 Cuenta de cada proveedor"],
  ["sos", "📄 Importar CSV del S.O.S"],
];

export default function FinanzasCuentasCorrientes({ seccion = null }) {
  const toast = useToast();
  const [cli, setCli] = useState(null);
  const [prov, setProv] = useState(null);
  const [pares, setPares] = useState([]);
  const [error, setError] = useState(null);
  const [buscar, setBuscar] = useState("");
  const [filtro, setFiltro] = useState(() => filtroInicialCc(seccion));
  const [abierta, setAbierta] = useState(null); // { clave, lado: "ambos"|"cliente"|"proveedor" }
  const [modal, setModal] = useState(null);
  const [trayendo, setTrayendo] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [c, p, u] = await Promise.all([
        leer("/api/finanzas/clientes", "No se pudieron cargar los clientes"),
        leer("/api/finanzas/proveedores", "No se pudieron cargar los proveedores"),
        leer("/api/finanzas/unificados", "No se pudieron cargar los clientes que también son proveedores").catch(() => ({ pares: [] })),
      ]);
      setCli(c);
      setProv(p);
      setPares(u.pares || []);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const cuentasDeu = useMemo(() => new Set(cli?.cuentas_deudores || []), [cli]);
  const cuentasProv = useMemo(() => new Set(prov?.cuentas_proveedores || []), [prov]);
  const aprendidas = useMemo(() => (prov ? aprendidasDe(prov, cuentasProv) : new Map()), [prov, cuentasProv]);
  const renglones = useMemo(() => {
    if (!cli || !prov) return [];
    return cuentasCorrientes({
      clientes: cuentasDeu.size ? saldosClientes(cli.operaciones, cuentasDeu, cli.clientes) : [],
      proveedores: cuentasProv.size ? saldosProveedores(prov.operaciones, cuentasProv, prov.proveedores) : [],
      pares,
    });
  }, [cli, prov, pares, cuentasDeu, cuentasProv]);
  const lista = useMemo(() => {
    const b = normal(buscar);
    return renglones.filter((r) => entraEnFiltro(r, filtro) && (!b || normal(r.nombre).includes(b) || normal(r.cliente?.nombre).includes(b) || normal(r.proveedor?.nombre).includes(b)));
  }, [renglones, buscar, filtro]);

  async function traer() {
    setTrayendo(true);
    try {
      const res = await apiFetch("/api/finanzas/clientes", { method: "POST", body: JSON.stringify({ accion: "traer_de_ot" }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudieron traer los clientes");
      toast.success(d.agregados ? `Se sumaron ${d.agregados} clientes de las OT` : "Ya estaban todos los clientes de las OT");
      cargar();
    } catch (e) {
      toast.error(e.message);
    }
    setTrayendo(false);
  }
  const herramienta = (id) => (id === "traer" ? traer() : setModal(id));
  const cerrarYcargar = () => { setModal(null); cargar(); };

  if (error) return <p role="alert" className="m-[18px] text-[14px] text-gypi-red">⚠ {error}</p>;
  if (!cli || !prov) return <div className="flex-1 flex items-center justify-center py-10"><Spinner /></div>;
  if (!cuentasDeu.size && !cuentasProv.size) {
    return <p className="m-[18px] text-[14px] text-gypi-text">Primero copiá el libro en Finanzas → 🧾 Configuración: faltan las cuentas &quot;Deudores por Ventas&quot; y &quot;Proveedores&quot; en el plan de cuentas.</p>;
  }
  const t = totalesCc(renglones);
  const cuantos = (f) => renglones.filter((r) => entraEnFiltro(r, f)).length;
  const actual = abierta ? renglones.find((r) => r.clave === abierta.clave) : null;

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <p className="m-0 text-[14px] text-gypi-text flex-1 min-w-[220px]">
          Nos deben <b>{plata(t.nos_deben, "ARS")}</b> · Les debemos <b>{plata(t.debemos, "ARS")}</b> · <b>{textoNeto(t.neto)}</b>
        </p>
        <button type="button" className="g-btn g-btn-primary" onClick={() => setModal("nuevo")}>＋ Cliente</button>
        <details className="relative">
          <summary className="g-btn g-btn-secondary list-none cursor-pointer" aria-label="Más herramientas de cuentas corrientes">🛠 Más</summary>
          <ul className="list-none m-0 p-1 absolute left-0 sm:left-auto sm:right-0 z-10 mt-1 w-[260px] max-w-[calc(100vw-36px)] rounded-lg border border-gypi-border bg-gypi-surface shadow-lg flex flex-col">
            {HERRAMIENTAS.map(([id, texto]) => (
              <li key={id}>
                <button type="button" className="w-full text-left min-h-[44px] px-3 rounded-md text-[14px] text-gypi-text hover:bg-gypi-bg cursor-pointer"
                  disabled={id === "traer" && trayendo}
                  onClick={(e) => { e.currentTarget.closest("details")?.removeAttribute("open"); herramienta(id); }}>
                  {id === "traer" && trayendo ? "Trayendo…" : texto}
                </button>
              </li>
            ))}
          </ul>
        </details>
      </div>
      <p className="m-0 mb-2 text-[13px] text-gypi-dim">
        {cli.ventas_ot?.activo
          ? `🧾 Las ventas y entregas de las OT se anotan solas (OT cargadas desde ${fechaCorta(cli.ventas_ot.desde)}).`
          : "🧾 Las ventas de las OT todavía no se anotan solas."}
      </p>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {Object.entries(FILTROS_CC).map(([id, nombre]) => (
          <Chip key={id} active={filtro === id} onClick={() => setFiltro(id)}>{nombre} ({cuantos(id)})</Chip>
        ))}
        <input className="g-input flex-1 min-w-[180px]" aria-label="Buscar cliente o proveedor" placeholder="Buscar cliente o proveedor" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
      </div>
      <ul className="list-none m-0 p-0 flex flex-col gap-1.5" aria-label="Cuentas corrientes">
        {lista.slice(0, MAX_LISTA).map((r) => {
          const s = textoRenglonCc(r);
          return (
            <li key={r.clave}>
              <button type="button" onClick={() => setAbierta({ clave: r.clave, lado: r.tipo })}
                className="w-full text-left min-h-[48px] px-3 py-2 rounded-lg border border-gypi-border bg-gypi-surface cursor-pointer">
                <span className="flex flex-wrap items-baseline gap-x-2 text-[14px] text-gypi-text">
                  <span className="font-semibold flex-1 min-w-[160px] break-words">{r.nombre || "Sin nombre"}</span>
                  <span className={`font-mono font-semibold ml-auto ${s.clase}`}>{s.texto}</span>
                </span>
                <span className="block text-[12px] text-gypi-dim">
                  {ETIQUETA[r.tipo]}
                  {r.tipo === "ambos" && ` · Nos debe ${plata(r.nos_debe, "ARS")} · Le debemos ${plata(r.le_debemos, "ARS")}`}
                  {" · "}{r.ultimo ? `Último movimiento ${fechaCorta(r.ultimo)}` : "Sin movimientos"}
                  {r.tipo === "cliente" && !r.cliente.cliente_id && " · No está en la lista de clientes"}
                  {r.tipo === "proveedor" && !r.proveedor.proveedor_id && " · No está en la lista de proveedores"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {lista.length > MAX_LISTA && <p className="mt-2 text-[13px] text-gypi-dim">Hay {lista.length - MAX_LISTA} más: usá el buscador.</p>}
      {!lista.length && (
        <p className="mt-2 text-[13px] text-gypi-dim">
          {renglones.length ? "Nadie con ese filtro." : "Todavía no hay clientes ni proveedores. Traé los clientes de las OT o cargá los saldos iniciales del libro (🛠 Más)."}
        </p>
      )}

      {actual && abierta.lado === "ambos" && (
        <FichaAmbos r={actual} onCerrar={() => setAbierta(null)} onCambio={cargar}
          onCliente={() => setAbierta({ clave: actual.clave, lado: "cliente" })} onProveedor={() => setAbierta({ clave: actual.clave, lado: "proveedor" })} />
      )}
      {actual?.cliente && abierta.lado === "cliente" && (
        <FichaCliente saldo={actual.cliente} datos={cli} cuentasDeu={cuentasDeu} onCerrar={() => setAbierta(null)} onCambio={cargar} />
      )}
      {actual?.proveedor && abierta.lado === "proveedor" && (
        <FichaProveedor saldo={actual.proveedor} datos={prov} cuentasProv={cuentasProv} aprendidas={aprendidas} onCerrar={() => setAbierta(null)} onCargada={() => { setAbierta(null); cargar(); }} />
      )}
      {modal === "nuevo" && <DatosCliente cliente={null} onCerrar={() => setModal(null)} onGuardado={cerrarYcargar} />}
      {modal === "iniciales_cli" && <SaldosInicialesClientes datos={cli} cuentasDeu={cuentasDeu} onCerrar={() => setModal(null)} onCargados={cerrarYcargar} />}
      {modal === "iniciales_prov" && <SaldosInicialesProveedores datos={prov} cuentasProv={cuentasProv} onCerrar={() => setModal(null)} onCargados={cerrarYcargar} />}
      {modal === "ventas" && <VentasOt config={cli.ventas_ot} onCerrar={() => setModal(null)} onHecho={cerrarYcargar} />}
      {modal === "por_ot" && <FinanzasOtClientes onCerrar={() => setModal(null)} />}
      {modal === "unificados" && <FinanzasUnificados onCerrar={() => setModal(null)} onCambio={cargar} />}
      {modal === "cuentas_prov" && <CuentasDeProveedores datos={prov} cuentasProv={cuentasProv} aprendidas={aprendidas} onCerrar={() => setModal(null)} onGuardadas={cerrarYcargar} />}
      {modal === "sos" && <FinanzasSos onCerrar={() => setModal(null)} onImportado={cerrarYcargar} />}
    </div>
  );
}
