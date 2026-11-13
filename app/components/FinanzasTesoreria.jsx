'use client';
// app/components/FinanzasTesoreria.jsx — Finanzas → 💰 Cajas y bancos (parte
// F3a; reemplaza TESORERIA y RESUMEN CAJA del libro; /api/finanzas/tesoreria;
// reglas en app/lib/finanzasTesoreria.js). Sin migración.
//
// El saldo de cada caja y banco sale de las operaciones: lo que entra y lo que
// sale. La ficha muestra los movimientos con el saldo renglón por renglón.
// "Cargar saldos iniciales" lee T-OPERACIONES del libro hasta una fecha de
// corte; "Pasar plata" es una TRANSFERENCIA ENTRE CAJAS entre dos cajas.
// F3b (176): lo que cargan los responsables desde 📱 Mi caja espera acá
// ("Para revisar") y "⚙ Mi caja" esconde los tipos que no se les ofrecen.
// F5a: en la ficha de un banco, "📥 Subir extracto" (FinanzasExtracto.jsx).
// 13/11 (parte 7): en una caja, "📥 Subir planilla" (la misma pantalla).
// Parte 8 del 11/11: 🏦 Plazos fijos (FinanzasPlazosFijos.jsx).
// 12/11: tocando un movimiento de la ficha se ve su detalle, y se corrige o se
// anula (finanzasCorregir.js); 📈 Inversiones: el FCI con el saldo real y los
// títulos con láminas y cotización (FinanzasInversiones.jsx).
// 13/11: 🔎 Posibles repetidos busca en todas las cajas lo que parece cargado
// dos veces; las cargas avisan 🔴/🟡 antes de guardar (finanzasRepetidos.js).
// 13/11 (parte 3 del plan): 💰 Tesorería = Cajas y bancos + Movimientos en una
// sola pantalla. Arriba las cajas con su saldo; se elige una, varias o
// ninguna (todo) y abajo se ven sus movimientos (FinanzasMovimientos), con el
// saldo renglón por renglón si hay una sola y "＋ Nuevo movimiento" con esa
// caja puesta. Tocando un movimiento se ve, se corrige o se anula.
// Solo el rol Dueño (la pantalla ni aparece para los demás).
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { hoyAr, numero, plata } from "../lib/finanzasOperaciones";
import { ORIGEN_SALDO_INICIAL } from "../lib/finanzasProveedores";
import { ORIGEN_LIBRO } from "../lib/finanzasHistorico";
import { NOMBRE_GRUPO, ORDEN_TIPOS, movimientosDeCaja, saldosCajasDelLibro, saldosTesoreria, totalesTesoreria } from "../lib/finanzasTesoreria";
import { paraRevisarMiCaja, tiposParaMiCaja } from "../lib/finanzasMiCaja";
import SubirExtracto, { Repetidos } from "./FinanzasExtracto";
import { repetidosEnCuenta } from "../lib/finanzasBanco";
import PlazosFijos from "./FinanzasPlazosFijos";
import Inversiones from "./FinanzasInversiones";
import FinanzasMovimientos, { Detalle } from "./FinanzasMovimientos";
import AvisoRepetidos, { repetidosDe } from "./FinanzasAvisoRepetidos";
import { Chip, Modal, SelectBuscable, Spinner } from "./ui";
import { useToast } from "./ui/Toast";

const fechaCorta = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}` : "");
const normal = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

async function postTesoreria(body) {
  const res = await apiFetch("/api/finanzas/tesoreria", { method: "POST", body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(d.error || "No se pudo guardar"), { status: res.status, datos: d });
  return d;
}

function campo(label, input) {
  return <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">{label}{input}</label>;
}

async function leerOperacionesDelLibro(file) {
  const { hojasXlsx, leerHojaXlsx } = await import("../lib/leerXlsx");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hoja = hojasXlsx(bytes).find((n) => normal(n) === "TOPERACIONES");
  if (!hoja) return null;
  return leerHojaXlsx(bytes, hoja, { maxFilas: 60000, maxCols: 60 }) || [];
}

/* ─── Saldos iniciales ───────────────────────────────────────────────── */

function SaldosIniciales({ datos, onCerrar, onCargados }) {
  const toast = useToast();
  const [grilla, setGrilla] = useState(null);
  const [fecha, setFecha] = useState(hoyAr());
  const [tc, setTc] = useState("");
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const yaCargados = (datos.operaciones || []).some((o) => o.origen === ORIGEN_SALDO_INICIAL);
  // 13/11: con el histórico del libro pasado, el saldo de las cajas ya sale de
  // ahí; un saldo inicial encima lo cuenta dos veces
  const conHistorico = (datos.operaciones || []).some((o) => o.origen === ORIGEN_LIBRO);
  const resultado = useMemo(() => (grilla ? saldosCajasDelLibro(grilla, fecha, datos.tesoreria) : null), [grilla, fecha, datos.tesoreria]);
  const filas = useMemo(() => (resultado?.filas || [])
    .map((f) => ({ ...f, caja: datos.tesoreria.find((t) => t.cuenta === f.cuenta) }))
    .filter((f) => f.caja && Math.abs(f.saldo) >= 0.01)
    .sort((a, b) => a.caja.nombre.localeCompare(b.caja.nombre)), [resultado, datos.tesoreria]);
  const hayUsd = filas.some((f) => f.caja.moneda === "USD");

  async function abrir(file) {
    if (!file) return;
    setLeyendo(true);
    setError(null);
    try {
      const g = await leerOperacionesDelLibro(file);
      if (!g) throw new Error("El archivo no tiene la hoja T-OPERACIONES.");
      setGrilla(g);
    } catch (e) {
      setError(e.message || "No se pudo leer el archivo");
    } finally {
      setLeyendo(false);
    }
  }

  async function cargar() {
    setError(null);
    if (hayUsd && !(numero(tc) > 0)) { setError("Poné el tipo de cambio para las cajas en dólares"); return; }
    setGuardando(true);
    try {
      const d = await postTesoreria({ accion: "saldos_iniciales", fecha, tipo_cambio: hayUsd ? numero(tc) : null, filas: filas.map((f) => ({ cuenta: f.cuenta, saldo: f.saldo })) });
      toast.success(`Saldos iniciales cargados: ${d.cargados} cajas y bancos`);
      onCargados();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onCerrar} title="Cargar saldos iniciales" maxWidth={640}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0">
          Subí el libro (.xlsx). Se suma todo lo de T-OPERACIONES que entró y salió de cada caja y banco hasta la fecha de corte, y
          cada saldo entra como &quot;SALDO INICIAL&quot; contra Ajuste De Capital. Lo que cargues en Gypi después de esa fecha sigue desde ahí.
        </p>
        {conHistorico && (
          <p role="alert" className="m-0 text-[13px] text-gypi-red">
            ⚠ Ya pasaste el histórico del libro: el saldo de cada caja ya sale de ahí y un saldo inicial lo contaría dos veces. Para revisar diferencias usá 🧾 Configuración → 🧮 Cuadrar con el libro.
          </p>
        )}
        {!conHistorico && yaCargados && <p className="m-0 text-[13px] text-gypi-amber-ink">⚠ Ya hay saldos iniciales cargados: los de las cajas que cargues ahora se reemplazan.</p>}
        <div className="flex flex-wrap items-end gap-2">
          <label className="g-btn g-btn-secondary cursor-pointer">
            {leyendo ? "Leyendo…" : grilla ? "Elegir otro archivo" : "📂 Subir el libro"}
            <input type="file" accept=".xlsx,.xlsm" className="sr-only" aria-label="Subir el libro contable" disabled={leyendo} onChange={(e) => { abrir(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          <div className="ml-auto">
            {campo("Fecha de corte (incluida)", <input type="date" className="g-input" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />)}
          </div>
        </div>
        {(error || resultado?.error) && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error || resultado.error}</p>}
        {resultado && !resultado.error && (
          <>
            <ul className="list-none m-0 p-0 flex flex-col max-h-[45vh] overflow-y-auto border border-gypi-border rounded-lg" aria-label="Saldos del libro">
              {filas.map((f) => (
                <li key={f.cuenta} className="flex items-baseline gap-2 px-2 py-1.5 border-b border-gypi-border last:border-b-0 text-[13px]">
                  <span className="flex-1 min-w-0">{f.caja.nombre}</span>
                  <span className={`font-mono font-semibold ${f.saldo < 0 ? "text-gypi-red" : ""}`}>{plata(f.saldo, f.caja.moneda)}</span>
                </li>
              ))}
              {!filas.length && <li className="p-2 text-[13px] text-gypi-dim">Ninguna caja con saldo a esa fecha.</li>}
            </ul>
            {hayUsd && campo("Tipo de cambio para las cajas en dólares", <input className="g-input w-[160px]" inputMode="decimal" aria-label="Tipo de cambio" value={tc} onChange={(e) => setTc(e.target.value)} />)}
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={conHistorico || !filas.length || guardando} onClick={cargar}>
            {guardando ? "Cargando…" : `Cargar ${filas.length} saldos`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Pasar plata entre cajas ────────────────────────────────────────── */

function Transferir({ datos, desdeInicial = "", onCerrar, onHecho }) {
  const toast = useToast();
  const vivas = datos.tesoreria.filter((t) => t.activa !== false);
  const [f, setF] = useState({ desde: desdeInicial, hacia: "", importe: "", fecha: hoyAr(), tipo_cambio: "", descripcion: "" });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [repetidos, setRepetidos] = useState(null);
  const set = (k) => (e) => { setRepetidos(null); setF((x) => ({ ...x, [k]: e.target.value })); };
  const desde = vivas.find((t) => t.cuenta === f.desde);
  const usd = desde?.moneda === "USD";

  async function guardar(confirmarRepetido = false) {
    setError(null);
    setGuardando(true);
    try {
      await postTesoreria({ accion: "transferir", ...f, importe: numero(f.importe), tipo_cambio: usd ? numero(f.tipo_cambio) : null, confirmar_repetido: confirmarRepetido });
      toast.success("Listo: la plata pasó de caja");
      onHecho();
    } catch (e) {
      const rep = repetidosDe(e.status, e.datos);
      if (rep) setRepetidos(rep);
      else setError(e.message);
      setGuardando(false);
    }
  }

  const opciones = (excluir) => vivas.filter((t) => t.cuenta !== excluir && (!desde || excluir !== f.desde || (t.moneda === "USD") === usd));
  return (
    <Modal open onClose={onCerrar} title="Pasar plata entre cajas" maxWidth={480}>
      <div className="flex flex-col gap-3">
        {campo("Sale de", (
          <SelectBuscable className="g-input w-full" aria-label="Sale de" value={f.desde} onChange={set("desde")}>
            <option value="">Elegí…</option>
            {vivas.map((t) => <option key={t.cuenta} value={t.cuenta}>{t.nombre}</option>)}
          </SelectBuscable>
        ))}
        {campo("Va a", (
          <SelectBuscable className="g-input w-full" aria-label="Va a" value={f.hacia} onChange={set("hacia")}>
            <option value="">Elegí…</option>
            {opciones(f.desde).map((t) => <option key={t.cuenta} value={t.cuenta}>{t.nombre}</option>)}
          </SelectBuscable>
        ))}
        <div className="flex flex-wrap gap-2">
          {campo(usd ? "Importe (USD)" : "Importe", <input className="g-input w-[160px] text-right font-mono" inputMode="decimal" aria-label="Importe" value={f.importe} onChange={set("importe")} />)}
          {campo("Fecha", <input type="date" className="g-input" aria-label="Fecha" value={f.fecha} onChange={set("fecha")} />)}
          {usd && campo("Tipo de cambio", <input className="g-input w-[120px]" inputMode="decimal" aria-label="Tipo de cambio" value={f.tipo_cambio} onChange={set("tipo_cambio")} />)}
        </div>
        {campo("Nota (opcional)", <input className="g-input w-full" aria-label="Nota" maxLength={300} value={f.descripcion} onChange={set("descripcion")} />)}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        {repetidos
          ? <AvisoRepetidos repetidos={repetidos} ocupado={guardando} onCargarIgual={() => guardar(true)} onCancelar={() => setRepetidos(null)} />
          : (
            <div className="flex justify-end gap-2">
              <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
              <button type="button" className="g-btn g-btn-primary" disabled={guardando || !f.desde || !f.hacia} onClick={() => guardar()}>{guardando ? "Guardando…" : "Pasar la plata"}</button>
            </div>
          )}
      </div>
    </Modal>
  );
}

/* ─── Mi caja: qué se ofrece y lo que espera revisión (F3b, 176) ───── */

function ConfigMiCaja({ datos, onCerrar, onGuardado }) {
  const toast = useToast();
  const sirven = useMemo(() => tiposParaMiCaja(datos.tipos || []), [datos.tipos]);
  // Se guardan los que el dueño escondió: un tipo nuevo aparece solo.
  const [ocultos, setOcultos] = useState({ gastos: new Set(datos.mi_caja?.ocultos?.gastos || []), ingresos: new Set(datos.mi_caja?.ocultos?.ingresos || []) });
  const [buscar, setBuscar] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const b = normal(buscar);
  const alternar = (lado, codigo) => setOcultos((x) => {
    const nuevo = new Set(x[lado]);
    if (nuevo.has(codigo)) nuevo.delete(codigo); else nuevo.add(codigo);
    return { ...x, [lado]: nuevo };
  });

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await postTesoreria({ accion: "config_mi_caja", ocultos: { gastos: [...ocultos.gastos], ingresos: [...ocultos.ingresos] } });
      toast.success("Listo: Mi caja ya ofrece esos tipos");
      onGuardado();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  const listaDe = (lado, titulo) => (
    <fieldset className="border border-gypi-border rounded-lg p-2 m-0 min-w-0">
      <legend className="px-1 text-[13px] font-bold">{titulo} ({sirven[lado].filter((t) => !ocultos[lado].has(t.codigo)).length} de {sirven[lado].length})</legend>
      <ul className="list-none m-0 p-0 max-h-[30vh] overflow-y-auto">
        {sirven[lado].filter((t) => !b || normal(`${t.codigo} ${t.nombre}`).includes(b)).map((t) => (
          <li key={t.codigo}>
            <label className="flex items-center gap-2 py-1 text-[13px] cursor-pointer">
              <input type="checkbox" checked={!ocultos[lado].has(t.codigo)} onChange={() => alternar(lado, t.codigo)} />
              <span className="flex-1 min-w-0">{t.nombre || t.codigo}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );

  return (
    <Modal open onClose={onCerrar} title="Qué se carga desde Mi caja" maxWidth={640}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0">
          Cada responsable de una caja la ve en su celular (📱 Mi caja) y carga lo que gastó y la plata que recibió.
          Le aparecen todos los tipos de gasto y de plata que entra: él ve el nombre y la cuenta la pone el tipo. Destildá los que no quieras que vea.
          Lo que carga te queda &quot;Para revisar&quot; acá.
        </p>
        <input className="g-input w-full" placeholder="Buscar tipo…" aria-label="Buscar tipo" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        {listaDe("gastos", "Gastos")}
        {listaDe("ingresos", "Plata que recibe")}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>
    </Modal>
  );
}

function RevisarMiCaja({ datos, pendientes, onCerrar, onCambio }) {
  const toast = useToast();
  const [ocupado, setOcupado] = useState(null);
  const [tipos, setTipos] = useState({});
  const [error, setError] = useState(null);
  const cuentasCaja = useMemo(() => new Set(datos.tesoreria.map((t) => t.cuenta)), [datos.tesoreria]);
  const sirven = useMemo(() => tiposParaMiCaja(datos.tipos || []), [datos.tipos]);
  const nombreTipo = (c) => (datos.tipos || []).find((t) => t.codigo === c)?.nombre || c;

  async function hacer(op, accion) {
    setOcupado(op.id);
    setError(null);
    try {
      await postTesoreria(accion === "revisar" ? { accion, id: op.id, tipo: tipos[op.id] || op.tipo } : { accion, id: op.id });
      toast.success(accion === "revisar" ? "Confirmado" : "Anulado");
      onCambio();
    } catch (e) {
      setError(e.message);
    }
    setOcupado(null);
  }

  return (
    <Modal open onClose={onCerrar} title={`Para revisar de Mi caja (${pendientes.length})`} maxWidth={640}>
      <div className="flex flex-col gap-2 text-[14px] text-gypi-text">
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        {!pendientes.length && <p className="m-0 text-gypi-dim">No queda nada para revisar.</p>}
        <ul className="list-none m-0 p-0 flex flex-col gap-2" aria-label="Para revisar">
          {pendientes.map((op) => {
            const gasto = cuentasCaja.has(op.cuenta_haber);
            const caja = datos.tesoreria.find((t) => t.cuenta === (gasto ? op.cuenta_haber : op.cuenta_debe));
            const opciones = gasto ? sirven.gastos : sirven.ingresos;
            return (
              <li key={op.id} className="p-2.5 rounded-lg border border-gypi-border flex flex-col gap-1.5">
                <span className="flex items-baseline gap-2">
                  <span className="flex-1 min-w-0 font-semibold">{op.cargada_por_nombre || "—"} · {caja?.nombre}</span>
                  <span className={`font-mono font-semibold ${gasto ? "text-gypi-red" : "text-gypi-green-ink"}`}>{gasto ? "−" : "+"}{plata(op.total, op.moneda)}</span>
                </span>
                <span className="text-[12px] text-gypi-dim">{fechaCorta(op.fecha)} · {op.descripcion}</span>
                {op.comprobante_url && <a href={op.comprobante_url} target="_blank" rel="noopener noreferrer" className="text-[13px] text-gypi-cyan underline self-start">🧾 Ver ticket</a>}
                <span className="flex flex-wrap items-center gap-2">
                  <SelectBuscable className="g-input flex-1 min-w-[180px]" aria-label={`Tipo del movimiento ${op.id}`} value={tipos[op.id] || op.tipo} onChange={(e) => setTipos((x) => ({ ...x, [op.id]: e.target.value }))}>
                    {!opciones.some((t) => t.codigo === op.tipo) && <option value={op.tipo}>{nombreTipo(op.tipo)}</option>}
                    {opciones.map((t) => <option key={t.codigo} value={t.codigo}>{t.nombre || t.codigo}</option>)}
                  </SelectBuscable>
                  <button type="button" className="g-btn g-btn-primary" disabled={ocupado === op.id} onClick={() => hacer(op, "revisar")}>✓ Confirmar</button>
                  <button type="button" className="g-btn g-btn-secondary" disabled={ocupado === op.id} onClick={() => hacer(op, "anular_mi_caja")}>Anular</button>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}

/* ─── 🔎 Posibles repetidos en todas las cajas (13/11) ──────────────────── */

/** Por caja, los grupos del mismo importe con 3 días o menos entre uno y otro (repetidosEnCuenta). */
export function repetidosPorCaja(operaciones = [], tesoreria = []) {
  return tesoreria
    .filter((t) => t.activa !== false)
    .map((t) => ({ caja: t, grupos: repetidosEnCuenta(operaciones, t.cuenta) }))
    .filter((x) => x.grupos.length)
    .sort((a, b) => a.caja.nombre.localeCompare(b.caja.nombre));
}

function PosiblesRepetidos({ datos, porCaja, onCerrar, onCambio }) {
  const [detalle, setDetalle] = useState(null);
  return (
    <Modal open onClose={onCerrar} title="🔎 Posibles repetidos" maxWidth={980}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px] text-gypi-dim">
          En cada caja y banco, los movimientos por el mismo importe con 3 días o menos de diferencia. 🔴 = dos el mismo día (muy sospechoso), 🟡 = a pocos días.
          Puede ser algo que de verdad se repitió (dos comisiones iguales): revisá antes de anular. Lo anulado queda tachado y deja de sumar.
        </p>
        {!porCaja.length && <p className="m-0 p-3 rounded-lg bg-gypi-green/10">✅ No encontré movimientos repetidos en ninguna caja ni banco.</p>}
        {porCaja.map(({ caja, grupos }) => (
          <Repetidos key={caja.cuenta} grupos={grupos} titulo={caja.nombre} abierto={porCaja.length === 1} onVer={setDetalle} onAnuladas={onCambio} />
        ))}
        <div className="flex justify-end">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cerrar</button>
        </div>
      </div>
      {detalle && <Detalle op={detalle} datos={datos} onCerrar={() => setDetalle(null)} onAnulada={() => { setDetalle(null); onCambio(); }} />}
    </Modal>
  );
}

/* ─── Pantalla ───────────────────────────────────────────────────────── */

/** El saldo de la caja después de cada movimiento (para la lista con una sola caja elegida). */
export function saldosDeCaja(operaciones = [], caja = null) {
  return caja ? new Map(movimientosDeCaja(operaciones, caja).map((m) => [m.op.id, m.saldo])) : null;
}

/** Elegir o sacar una caja de las elegidas. */
export function alternarCaja(elegidas = [], cuenta) {
  return elegidas.includes(cuenta) ? elegidas.filter((c) => c !== cuenta) : [...elegidas, cuenta];
}

export default function FinanzasTesoreria({ onIr = null } = {}) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [elegidas, setElegidas] = useState([]);
  const [transferir, setTransferir] = useState(null);
  const [iniciales, setIniciales] = useState(false);
  const [inactivas, setInactivas] = useState(false);
  const [verRevisar, setVerRevisar] = useState(false);
  const [verConfig, setVerConfig] = useState(false);
  const [extracto, setExtracto] = useState(null);
  const [verRepetidos, setVerRepetidos] = useState(false);
  const [masOpciones, setMasOpciones] = useState(false);
  // Lo que cambia desde acá (pasar plata, extracto, Mi caja) también recarga la lista de abajo
  const [version, setVersion] = useState(0);

  const cargar = useCallback(async () => {
    try {
      const res = await apiFetch("/api/finanzas/tesoreria");
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudieron cargar las cajas");
      setDatos(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  const cambioAca = () => { cargar(); setVersion((v) => v + 1); };

  const saldos = useMemo(() => (datos ? saldosTesoreria(datos.operaciones, datos.tesoreria) : []), [datos]);
  const totales = useMemo(() => totalesTesoreria(saldos), [saldos]);
  const pendientes = useMemo(() => paraRevisarMiCaja(datos?.operaciones), [datos]);
  const porCaja = useMemo(() => (datos ? repetidosPorCaja(datos.operaciones, datos.tesoreria) : []), [datos]);
  const nRepetidos = porCaja.reduce((n, x) => n + x.grupos.length, 0);
  const una = elegidas.length === 1 ? saldos.find((s) => s.cuenta === elegidas[0]) || null : null;
  const saldoRenglon = useMemo(() => (datos && una ? saldosDeCaja(datos.operaciones, una) : null), [datos, una]);

  if (error) return <p role="alert" className="m-[18px] text-[14px] text-gypi-red">⚠ {error}</p>;
  if (!datos) return <div className="flex-1 flex items-center justify-center py-10"><Spinner /></div>;
  if (!datos.tesoreria.length) {
    return <p className="m-[18px] text-[14px] text-gypi-text">Primero copiá el libro en Finanzas → 🧾 Configuración: no hay cajas ni bancos cargados.</p>;
  }
  const visibles = saldos.filter((s) => inactivas || s.activa !== false || elegidas.includes(s.cuenta));
  const elegidasVivas = elegidas.filter((c) => saldos.some((s) => s.cuenta === c));
  const nombreResp = (s) => (s.responsable_id ? datos.personal.find((p) => p.id === s.responsable_id)?.nombre : null);
  const sumaElegidas = elegidasVivas.length > 1
    ? saldos.filter((s) => elegidasVivas.includes(s.cuenta)).reduce((t, s) => ({ ...t, [s.moneda]: (t[s.moneda] || 0) + s.saldo }), {})
    : null;

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <p className="m-0 text-[15px] text-gypi-text flex-1 min-w-[200px]">
          En pesos <b className="font-mono">{plata(totales.ARS, "ARS")}</b>{Math.abs(totales.USD) >= 0.01 && <> · En dólares <b className="font-mono">{plata(totales.USD, "USD")}</b></>}
        </p>
        <button type="button" className="g-btn g-btn-secondary" onClick={() => setTransferir("")}>⇄ Pasar plata</button>
        {onIr && <button type="button" className="g-btn g-btn-secondary" onClick={() => onIr("fin-cheques")}>🏦 Cheques</button>}
        <button type="button" className={`g-btn ${nRepetidos ? "g-btn-primary" : "g-btn-secondary"}`} onClick={() => setVerRepetidos(true)}>
          🔎 Posibles repetidos{nRepetidos ? ` (${nRepetidos})` : ""}
        </button>
        <button type="button" className="g-btn g-btn-secondary" aria-expanded={masOpciones} onClick={() => setMasOpciones((v) => !v)}>⋯ Más</button>
      </div>
      {masOpciones && (
        <div className="flex flex-wrap gap-2 mb-3">
          <button type="button" className="g-btn g-btn-secondary" onClick={() => setIniciales(true)}>📥 Cargar saldos iniciales</button>
          <button type="button" className="g-btn g-btn-secondary" onClick={() => setVerConfig(true)}>⚙ Mi caja</button>
        </div>
      )}
      {pendientes.length > 0 && (
        <button type="button" onClick={() => setVerRevisar(true)}
          className="w-full mb-3 p-3 rounded-lg border border-gypi-amber/40 bg-gypi-amber/10 text-left text-[14px] font-semibold text-gypi-amber-ink cursor-pointer">
          📱 {pendientes.length === 1 ? "1 movimiento" : `${pendientes.length} movimientos`} de Mi caja para revisar
        </button>
      )}

      <section aria-label="Cajas y bancos" className="mb-3">
        <div className="flex flex-wrap items-center gap-2 mb-1.5">
          <p className="m-0 flex-1 min-w-[200px] text-[13px] text-gypi-dim">Tocá una o varias cajas para ver solo sus movimientos. Sin ninguna elegida se ve todo.</p>
          <Chip type="button" active={!elegidasVivas.length} onClick={() => setElegidas([])}>Todas</Chip>
        </div>
        {ORDEN_TIPOS.map((tipo) => {
          const grupo = visibles.filter((s) => (s.tipo || "otro") === tipo);
          if (!grupo.length) return null;
          return (
            <div key={tipo} role="group" aria-label={NOMBRE_GRUPO[tipo]} className="mb-2">
              <h2 className="m-0 mb-1 text-[13px] font-bold text-gypi-dim">{NOMBRE_GRUPO[tipo]}</h2>
              <ul className="list-none m-0 p-0 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1.5">
                {grupo.map((s) => {
                  const marcada = elegidas.includes(s.cuenta);
                  return (
                    <li key={s.cuenta}>
                      <button type="button" aria-pressed={marcada} onClick={() => setElegidas((x) => alternarCaja(x, s.cuenta))}
                        className={`w-full text-left min-h-[48px] px-3 py-2 rounded-lg border cursor-pointer ${marcada ? "border-gypi-cyan bg-gypi-cyan/10" : "border-gypi-border bg-gypi-surface"} ${s.activa === false ? "opacity-60" : ""}`}>
                        <span className="flex items-baseline gap-2 text-[14px] text-gypi-text">
                          <span className="font-semibold flex-1 min-w-0 truncate">{marcada ? "✓ " : ""}{s.nombre}</span>
                          <span className={`font-mono font-semibold ${s.saldo < 0 ? "text-gypi-red" : ""}`}>{plata(s.saldo, s.moneda)}</span>
                        </span>
                        <span className="block text-[12px] text-gypi-dim">
                          {s.ultimo ? `Último movimiento ${fechaCorta(s.ultimo)}` : "Sin movimientos"}
                          {nombreResp(s) ? ` · ${nombreResp(s)}` : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {saldos.some((s) => s.activa === false) && (
          <label className="flex items-center gap-2 text-[13px] text-gypi-dim">
            <input type="checkbox" checked={inactivas} onChange={(e) => setInactivas(e.target.checked)} /> Ver las inactivas
          </label>
        )}
      </section>

      <section aria-label="Movimientos" className="mb-4 border-t border-gypi-border pt-3">
        <h2 className="m-0 mb-2 text-[15px] font-bold text-gypi-text">
          {una ? <>Movimientos de {una.nombre} · <span className={`font-mono ${una.saldo < 0 ? "text-gypi-red" : ""}`}>{plata(una.saldo, una.moneda)}</span></>
            : elegidasVivas.length > 1 ? <>Movimientos de {elegidasVivas.length} cajas{sumaElegidas && <> · {Object.entries(sumaElegidas).map(([m, v]) => <span key={m} className="font-mono"> {plata(v, m)}</span>)}</>}</>
              : "Todos los movimientos"}
        </h2>
        <FinanzasMovimientos cajas={elegidasVivas} saldos={saldoRenglon} cajaNueva={una?.activa !== false ? una?.cuenta || "" : ""} onCambio={cargar} recargar={version}
          acciones={una ? (
            <>
              <button type="button" className="g-btn g-btn-secondary" onClick={() => setTransferir(una.cuenta)}>⇄ Pasar plata desde esta</button>
              {una.tipo === "banco" && una.moneda !== "USD" && <button type="button" className="g-btn g-btn-secondary" onClick={() => setExtracto(una.cuenta)}>📥 Subir extracto</button>}
              {["caja", "otro"].includes(una.tipo) && una.moneda !== "USD" && <button type="button" className="g-btn g-btn-secondary" onClick={() => setExtracto(una.cuenta)}>📥 Subir planilla</button>}
            </>
          ) : null} />
      </section>

      {datos.tesoreria.some((t) => t.tipo === "plazo_fijo" && t.activa !== false) && <PlazosFijos onCambio={cambioAca} />}
      {(datos.tesoreria.some((t) => t.tipo === "fci" && t.activa !== false) || (datos.cuentas || []).some((c) => /T[IÍ]TULOS? P[UÚ]BLICOS/i.test(c.nombre || ""))) && <Inversiones onCambio={cambioAca} />}

      {verRepetidos && <PosiblesRepetidos datos={datos} porCaja={porCaja} onCerrar={() => setVerRepetidos(false)} onCambio={cambioAca} />}
      {extracto && <SubirExtracto caja={saldos.find((s) => s.cuenta === extracto) || { cuenta: extracto, nombre: extracto }} datos={datos} onCerrar={() => setExtracto(null)} onCargado={() => { setExtracto(null); cambioAca(); }} onCambio={cambioAca} />}
      {transferir !== null && <Transferir datos={datos} desdeInicial={transferir} onCerrar={() => setTransferir(null)} onHecho={() => { setTransferir(null); cambioAca(); }} />}
      {verRevisar && <RevisarMiCaja datos={datos} pendientes={pendientes} onCerrar={() => setVerRevisar(false)} onCambio={cambioAca} />}
      {verConfig && <ConfigMiCaja datos={datos} onCerrar={() => setVerConfig(false)} onGuardado={() => { setVerConfig(false); cargar(); }} />}
      {iniciales && <SaldosIniciales datos={datos} onCerrar={() => setIniciales(false)} onCargados={() => { setIniciales(false); cambioAca(); }} />}
    </div>
  );
}
