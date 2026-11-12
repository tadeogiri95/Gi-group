'use client';
// app/components/FinanzasPlazosFijos.jsx — Finanzas → 💰 Cajas y bancos →
// 🏦 Plazos fijos (parte 8 del plan del 11/11; /api/finanzas/plazos-fijos,
// reglas en app/lib/finanzasPlazosFijos.js). Sin migración.
//
// Se sube la planilla de plazos fijos vigentes que baja el banco (.xls del
// Credicoop, .xlsx o .csv): Gypi carga solo lo que falta, sin repetir, con el
// interés aparte. Cuando un plazo vence, un botón registra que la plata
// volvió al banco y el interés (en el mes en que vence).
// 12/11: si un plazo quedó dos veces (lo cargó Gypi y también está en el
// libro), un aviso deja anular las de Gypi de un toque.
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { plata } from "../lib/finanzasOperaciones";
import { grillaDeArchivo } from "../lib/finanzasExtracto";
import { cuentasPorDefecto, fechaPf, leerPlazosFijos } from "../lib/finanzasPlazosFijos";
import { Modal, SelectBuscable, Spinner } from "./ui";
import { useToast } from "./ui/Toast";

async function postPf(body) {
  const res = await apiFetch("/api/finanzas/plazos-fijos", { method: "POST", body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "No se pudo completar");
  return d;
}

const SITUACION = {
  vigente: { texto: "Vigente", clase: "text-gypi-text" },
  vencido: { texto: "Venció: falta registrar", clase: "text-gypi-amber-ink font-semibold" },
  terminado: { texto: "Volvió al banco", clase: "text-gypi-dim" },
  sin_cargar: { texto: "Sin cargar", clase: "text-gypi-dim" },
};

/** Qué se carga de cada plazo, en palabras. */
function queSeCarga(f) {
  if (f.estado === "dolares") return "En dólares: cargalo a mano";
  if (!f.ops.length) return "Ya está en Gypi";
  const partes = f.ops.map((o) => {
    const paso = String(o.origen_id).slice(-1);
    if (paso === "c") return "la constitución";
    if (paso === "r") return "el vencimiento";
    return `el interés (${plata(o.total)})`;
  });
  const lista = partes.length > 1 ? `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}` : partes[0];
  return `${f.ya.length ? `Ya estaba: ${f.ya.join(" y ")}. ` : ""}Se carga ${lista}`;
}

function Importar({ datos, onCerrar, onCargado }) {
  const toast = useToast();
  const [leido, setLeido] = useState(null);
  const [banco, setBanco] = useState(datos.por_defecto?.banco || "");
  const [cuentaPf, setCuentaPf] = useState(datos.por_defecto?.cuenta_pf || "");
  const [plan, setPlan] = useState(null);
  const [fechas, setFechas] = useState({});
  const [omitir, setOmitir] = useState(new Set());
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  async function subir(file) {
    if (!file) return;
    setError(null);
    setPlan(null);
    setOcupado(true);
    try {
      const grilla = await grillaDeArchivo(new Uint8Array(await file.arrayBuffer()), { maxFilas: 2000, maxCols: 40 });
      if (!grilla) throw new Error("Es un PDF: subí la planilla en Excel (.xls o .xlsx) o .csv que baja del banco.");
      const r = leerPlazosFijos(grilla);
      if (r.error) throw new Error(r.error);
      const tesoreria = [
        ...datos.bancos.map((t) => ({ ...t, tipo: "banco" })),
        ...datos.cuentas_pf.map((t) => ({ ...t, tipo: "plazo_fijo" })),
      ];
      const sugeridas = cuentasPorDefecto(tesoreria, grilla.slice(0, 30).flat().join(" "));
      if (sugeridas.cuenta_pf) setCuentaPf(sugeridas.cuenta_pf);
      if (sugeridas.banco) setBanco(sugeridas.banco);
      setLeido(r);
    } catch (e) {
      setError(e.message || "No pude leer el archivo");
    }
    setOcupado(false);
  }

  // Cada vez que cambia la planilla o las cuentas, qué se cargaría
  useEffect(() => {
    if (!leido || !banco || !cuentaPf) return undefined;
    let vivo = true;
    setOcupado(true);
    postPf({ accion: "ver", plazos: leido.plazos, banco, cuenta_pf: cuentaPf, exportado: leido.exportado })
      .then((d) => { if (vivo) { setPlan(d); setError(null); } })
      .catch((e) => { if (vivo) { setPlan(null); setError(e.message); } })
      .finally(() => { if (vivo) setOcupado(false); });
    return () => { vivo = false; };
  }, [leido, banco, cuentaPf]);

  const conOps = plan ? plan.filas.filter((f) => f.ops.length) : [];
  const elegidas = conOps.filter((f) => !omitir.has(f.plazo.certificado));
  const operaciones = elegidas.reduce((n, f) => n + f.ops.length, 0);
  const tildar = (cert) => setOmitir((s) => { const n = new Set(s); if (n.has(cert)) n.delete(cert); else n.add(cert); return n; });

  async function cargar() {
    setError(null);
    setOcupado(true);
    try {
      const d = await postPf({ accion: "cargar", plazos: leido.plazos, banco, cuenta_pf: cuentaPf, exportado: leido.exportado, fechas, omitir: [...omitir] });
      toast.success(d.cargadas ? `✅ Se cargaron ${d.cargadas} ${d.cargadas === 1 ? "operación" : "operaciones"} de plazos fijos` : "✅ Lista de plazos fijos al día: no había nada para cargar");
      onCargado();
    } catch (e) {
      setError(e.message);
      setOcupado(false);
    }
  }

  return (
    <Modal open onClose={ocupado ? () => {} : onCerrar} title="🏦 Importar plazos fijos del banco" maxWidth={860}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px] text-gypi-dim">
          Subí la planilla de plazos fijos vigentes que bajás del home banking (en el Credicoop: Plazos fijos → Vigentes → Exportar). Gypi carga solo lo que falta: los que ya están no se repiten. El interés va aparte, en Rendimientos financieros, el día que vence.
        </p>
        <label className="flex flex-col gap-1 text-[13px] font-semibold">
          Planilla del banco
          <input type="file" accept=".xls,.xlsx,.csv,application/vnd.ms-excel" aria-label="Planilla de plazos fijos" disabled={ocupado} onChange={(e) => subir(e.target.files?.[0])} />
        </label>
        {leido && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-[13px] font-semibold">
                Sale de y vuelve a
                <SelectBuscable className="g-input w-full" aria-label="Banco del plazo fijo" value={banco} onChange={(e) => setBanco(e.target.value)}>
                  <option value="">Elegí el banco…</option>
                  {datos.bancos.map((t) => <option key={t.cuenta} value={t.cuenta}>{t.nombre}</option>)}
                </SelectBuscable>
              </label>
              <label className="flex flex-col gap-1 text-[13px] font-semibold">
                Cuenta del plazo fijo
                <SelectBuscable className="g-input w-full" aria-label="Cuenta del plazo fijo" value={cuentaPf} onChange={(e) => setCuentaPf(e.target.value)}>
                  <option value="">Elegí la cuenta…</option>
                  {datos.cuentas_pf.map((t) => <option key={t.cuenta} value={t.cuenta}>{t.nombre}</option>)}
                </SelectBuscable>
              </label>
            </div>
            {leido.exportado && <p className="m-0 text-[13px] text-gypi-dim">Planilla bajada el {fechaPf(leido.exportado)}: {leido.plazos.length} {leido.plazos.length === 1 ? "plazo fijo" : "plazos fijos"}.</p>}
            {leido.avisos.length > 0 && (
              <ul className="m-0 pl-5 text-[13px] text-gypi-amber-ink" aria-label="Avisos de la planilla">
                {leido.avisos.map((a) => <li key={a}>{a}</li>)}
              </ul>
            )}
          </>
        )}
        {ocupado && <Spinner size={18} />}
        {plan && (
          <div className="overflow-x-auto border border-gypi-border rounded-lg">
            <table className="w-full border-collapse text-[13px]" aria-label="Plazos fijos de la planilla">
              <thead>
                <tr className="bg-gypi-surface text-left">
                  <th className="px-2 py-1.5"><span className="sr-only">Cargar</span></th>
                  <th className="px-2 py-1.5">Certificado</th>
                  <th className="px-2 py-1.5">Constituido</th>
                  <th className="px-2 py-1.5">Vence</th>
                  <th className="px-2 py-1.5 text-right">Depositado</th>
                  <th className="px-2 py-1.5 text-right">Interés</th>
                  <th className="px-2 py-1.5">Qué se carga</th>
                </tr>
              </thead>
              <tbody>
                {plan.filas.map((f) => {
                  const p = f.plazo;
                  const carga = f.ops.length > 0;
                  const nueva = f.ops.some((o) => String(o.origen_id).endsWith(":c"));
                  return (
                    <tr key={p.certificado} className={`border-t border-gypi-border ${carga ? "" : "text-gypi-dim"}`}>
                      <td className="px-2 py-1">
                        {carga && <input type="checkbox" checked={!omitir.has(p.certificado)} onChange={() => tildar(p.certificado)} aria-label={`Cargar el plazo fijo ${p.certificado}`} />}
                      </td>
                      <td className="px-2 py-1 font-mono">{p.certificado}</td>
                      <td className="px-2 py-1">
                        {nueva
                          ? <input type="date" className="g-input w-[150px]" aria-label={`Fecha en que se constituyó el ${p.certificado}`} max={p.vencimiento} value={fechas[p.certificado] || f.fecha_alta || ""} onChange={(e) => setFechas((x) => ({ ...x, [p.certificado]: e.target.value }))} />
                          : fechaPf(f.fecha_alta)}
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">{fechaPf(p.vencimiento)}</td>
                      <td className="px-2 py-1 text-right font-mono whitespace-nowrap">{plata(p.depositado, p.moneda)}</td>
                      <td className="px-2 py-1 text-right font-mono whitespace-nowrap">{plata(p.interes, p.moneda)}</td>
                      <td className="px-2 py-1">{queSeCarga(f)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {plan && conOps.some((f) => f.ops.some((o) => String(o.origen_id).endsWith(":c"))) && (
          <p className="m-0 text-[12px] text-gypi-dim">La planilla del banco no trae el día en que se constituyó: Gypi propone el día en que la bajaste. Si lo sabés, cambialo.</p>
        )}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" disabled={ocupado} onClick={onCerrar}>Cerrar</button>
          {plan && (
            <button type="button" className="g-btn g-btn-primary" disabled={ocupado} onClick={cargar}>
              {operaciones ? `Cargar (${operaciones} ${operaciones === 1 ? "operación" : "operaciones"})` : "Guardar la lista"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Vencidos({ pendientes, onCerrar, onHecho }) {
  const toast = useToast();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  async function registrar() {
    setOcupado(true);
    setError(null);
    try {
      const d = await postPf({ accion: "vencidos" });
      toast.success(`✅ ${d.plazos} ${d.plazos === 1 ? "plazo fijo volvió" : "plazos fijos volvieron"} al banco, con el interés aparte`);
      onHecho();
    } catch (e) {
      setError(e.message);
      setOcupado(false);
    }
  }
  const interes = pendientes.reduce((s, p) => s + (p.falta.i ? p.interes : 0), 0);
  return (
    <Modal open onClose={ocupado ? () => {} : onCerrar} title="Plazos fijos vencidos" maxWidth={560}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px] text-gypi-dim">Se registra que lo depositado volvió al banco y, aparte, el interés ganado, con la fecha del vencimiento.</p>
        <ul className="list-none m-0 p-0 flex flex-col gap-1" aria-label="Vencidos para registrar">
          {pendientes.map((p) => (
            <li key={p.certificado} className="flex flex-wrap gap-x-2 text-[13px] border-b border-gypi-border py-1">
              <span className="font-mono">N° {p.certificado}</span>
              <span>venció el {fechaPf(p.vencimiento)}</span>
              <span className="flex-1 text-right font-mono">{p.falta.r ? plata(p.depositado) : ""}{p.falta.i ? ` + interés ${plata(p.interes)}` : ""}</span>
            </li>
          ))}
        </ul>
        {interes > 0 && <p className="m-0 text-[13px]">Intereses: <b className="font-mono">{plata(interes)}</b></p>}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" disabled={ocupado} onClick={onCerrar}>Cerrar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={ocupado} onClick={registrar}>{ocupado ? "Registrando…" : "Registrar"}</button>
        </div>
      </div>
    </Modal>
  );
}

const fechaCorta = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}` : "");

/** Los plazos que quedaron dos veces: se anula la que cargó Gypi y queda la del libro. */
function Repetidos({ repetidos, onCerrar, onHecho }) {
  const toast = useToast();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  async function anular() {
    setOcupado(true);
    setError(null);
    try {
      const d = await postPf({ accion: "anular_repetidos" });
      toast.success(`✅ ${d.anuladas === 1 ? "Se anuló 1 repetida" : `Se anularon ${d.anuladas} repetidas`}`);
      onHecho();
    } catch (e) {
      setError(e.message);
      setOcupado(false);
    }
  }
  return (
    <Modal open onClose={ocupado ? () => {} : onCerrar} title="Plazos fijos repetidos" maxWidth={680}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px] text-gypi-dim">
          Estas operaciones las cargó Gypi y también están en el libro, con el mismo importe y las mismas cuentas.
          Se anula la de Gypi (queda tachada y el libro borra su renglón) y queda la tuya.
        </p>
        <ul className="list-none m-0 p-0 flex flex-col gap-2" aria-label="Repetidas">
          {repetidos.map((r) => (
            <li key={r.id} className="text-[13px] border-b border-gypi-border pb-2">
              <span className="flex flex-wrap gap-x-2">
                <b className="font-mono">{plata(r.total)}</b>
                <span>{r.tipo}</span>
                <span className="text-gypi-dim">{fechaCorta(r.fecha)}</span>
              </span>
              <span className="block text-gypi-red">Se anula: {r.descripcion || "la de Gypi"}</span>
              <span className="block text-gypi-dim">Queda la {r.otra.origen} del {fechaCorta(r.otra.fecha)}{r.otra.descripcion ? `: ${r.otra.descripcion}` : ""}</span>
            </li>
          ))}
        </ul>
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" disabled={ocupado} onClick={onCerrar}>Cerrar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={ocupado} onClick={anular}>{ocupado ? "Anulando…" : `Anular las ${repetidos.length} de Gypi`}</button>
        </div>
      </div>
    </Modal>
  );
}

export default function FinanzasPlazosFijos({ onCambio }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [importar, setImportar] = useState(false);
  const [verVencidos, setVerVencidos] = useState(false);
  const [terminados, setTerminados] = useState(false);
  const [verRepetidos, setVerRepetidos] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await apiFetch("/api/finanzas/plazos-fijos");
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudieron leer los plazos fijos");
      setDatos(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const vigentes = useMemo(() => (datos?.plazos || []).filter((p) => p.situacion !== "terminado"), [datos]);
  const viejos = useMemo(() => (datos?.plazos || []).filter((p) => p.situacion === "terminado"), [datos]);
  const hecho = () => { setImportar(false); setVerVencidos(false); setVerRepetidos(false); cargar(); onCambio?.(); };
  const visibles = terminados ? [...vigentes, ...viejos] : vigentes;
  const depositado = vigentes.filter((p) => p.situacion !== "sin_cargar" && p.moneda !== "USD").reduce((s, p) => s + p.depositado, 0);
  const intereses = vigentes.filter((p) => p.situacion !== "sin_cargar" && p.moneda !== "USD").reduce((s, p) => s + p.interes, 0);

  return (
    <section aria-label="Plazos fijos del banco" className="mb-4 p-3 border border-gypi-border rounded-lg">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="flex-1 min-w-[220px]">
          <h2 className="m-0 text-[14px] font-bold text-gypi-text">🏦 Plazos fijos</h2>
          <p className="m-0 text-[13px] text-gypi-dim">Importá la planilla del banco: se carga lo nuevo sin repetir y el interés va aparte.</p>
        </div>
        <button type="button" className="g-btn g-btn-secondary" disabled={!datos} onClick={() => setImportar(true)}>📥 Importar del banco</button>
      </div>
      {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
      {!datos && !error && <Spinner size={18} />}
      {datos?.repetidos?.length > 0 && (
        <button type="button" onClick={() => setVerRepetidos(true)}
          className="w-full mb-2 p-3 rounded-lg border border-gypi-red/40 bg-gypi-red/10 text-left text-[14px] font-semibold text-gypi-red cursor-pointer">
          ⚠ {datos.repetidos.length === 1 ? "1 operación de plazo fijo está" : `${datos.repetidos.length} operaciones de plazos fijos están`} dos veces (en Gypi y en el libro): revisar y anular las repetidas
        </button>
      )}
      {datos?.pendientes.length > 0 && (
        <button type="button" onClick={() => setVerVencidos(true)}
          className="w-full mb-2 p-3 rounded-lg border border-gypi-amber/40 bg-gypi-amber/10 text-left text-[14px] font-semibold text-gypi-amber-ink cursor-pointer">
          🏦 {datos.pendientes.length === 1 ? "1 plazo fijo venció" : `${datos.pendientes.length} plazos fijos vencieron`}: registrar que volvieron al banco y el interés
        </button>
      )}
      {datos && !datos.plazos.length && <p className="m-0 text-[13px] text-gypi-dim">Todavía no importaste ningún plazo fijo.</p>}
      {datos && vigentes.length > 0 && (
        <p className="m-0 mb-1 text-[13px] text-gypi-text">
          Vigentes: <b className="font-mono">{plata(depositado)}</b> depositados · <b className="font-mono">{plata(intereses)}</b> de interés a cobrar
        </p>
      )}
      {datos && visibles.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]" aria-label="Plazos fijos">
            <thead>
              <tr className="text-left text-gypi-dim">
                <th className="py-1 pr-2 font-semibold">Certificado</th>
                <th className="py-1 pr-2 font-semibold">Vence</th>
                <th className="py-1 pr-2 font-semibold text-right">Depositado</th>
                <th className="py-1 pr-2 font-semibold text-right">Interés</th>
                <th className="py-1 font-semibold">Situación</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((p) => (
                <tr key={p.certificado} className="border-t border-gypi-border">
                  <td className="py-1 pr-2 font-mono">{p.certificado}</td>
                  <td className="py-1 pr-2 whitespace-nowrap">{fechaPf(p.vencimiento)}</td>
                  <td className="py-1 pr-2 text-right font-mono whitespace-nowrap">{plata(p.depositado, p.moneda)}</td>
                  <td className="py-1 pr-2 text-right font-mono whitespace-nowrap">{plata(p.interes, p.moneda)}</td>
                  <td className={`py-1 ${SITUACION[p.situacion]?.clase || ""}`}>{SITUACION[p.situacion]?.texto || p.situacion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {viejos.length > 0 && (
        <label className="flex items-center gap-2 mt-1 text-[13px] text-gypi-dim">
          <input type="checkbox" checked={terminados} onChange={(e) => setTerminados(e.target.checked)} /> Ver los que ya volvieron al banco ({viejos.length})
        </label>
      )}
      {importar && <Importar datos={datos} onCerrar={() => setImportar(false)} onCargado={hecho} />}
      {verRepetidos && <Repetidos repetidos={datos.repetidos} onCerrar={() => setVerRepetidos(false)} onHecho={hecho} />}
      {verVencidos && <Vencidos pendientes={datos.pendientes} onCerrar={() => setVerVencidos(false)} onHecho={hecho} />}
    </section>
  );
}
