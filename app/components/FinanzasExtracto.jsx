'use client';
// app/components/FinanzasExtracto.jsx — Finanzas → 💰 Cajas y bancos → un
// banco → 📥 Subir extracto (parte F5a; /api/finanzas/banco; reglas en
// app/lib/finanzasBanco.js). Sin migración.
//
// Se sube el resumen en PDF o los movimientos en Excel/CSV. Lo que ya está en
// Gypi (pagos, e-cheq debitados, cobros, lo de un extracto anterior) sale
// marcado ✓; lo demás viene con el tipo y la cuenta que se usaron antes para
// ese texto del banco, para revisar y cargar todo junto. "Aprender del libro"
// lee T-OPERACIONES acá mismo y manda solo las reglas.
import { useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { plata } from "../lib/finanzasOperaciones";
import { reglasDelLibro } from "../lib/finanzasBanco";
import { Modal, Spinner } from "./ui";
import { useToast } from "./ui/Toast";

const fechaCorta = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}` : "");
const normal = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const MAX_FILAS = 400;

async function postBanco(body) {
  const res = await apiFetch("/api/finanzas/banco", { method: "POST", body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "No se pudo guardar");
  return d;
}

/** "02.01.02.001.001 · Proveedores" → "02.01.02.001.001". */
export const codigoDe = (texto) => String(texto || "").split(" · ")[0].trim();

/** La cuenta de enfrente que trae el tipo: al debe si sale plata, al haber si entra (nunca el mismo banco). */
export function contraDeTipo(tipo, importe, cuentaBanco) {
  if (!tipo) return "";
  const c = importe < 0 ? tipo.cuenta_debe : tipo.cuenta_haber;
  return c && c !== cuentaBanco ? c : "";
}

export default function SubirExtracto({ caja, datos, onCerrar, onCargado }) {
  const toast = useToast();
  const [leyendo, setLeyendo] = useState(false);
  const [aprendiendo, setAprendiendo] = useState(false);
  const [res, setRes] = useState(null);
  const [filas, setFilas] = useState([]);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [verYa, setVerYa] = useState(false);
  const nombreCuenta = useMemo(() => new Map((datos.cuentas || []).map((c) => [c.codigo, c.nombre])), [datos.cuentas]);
  const tipos = useMemo(() => (datos.tipos || []).filter((t) => t.activo !== false), [datos.tipos]);
  const etiquetaCuenta = (c) => (c ? `${c} · ${nombreCuenta.get(c) || ""}` : "");

  async function subir(file) {
    if (!file) return;
    setError(null);
    setLeyendo(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("cuenta", caja.cuenta);
      const r = await apiFetch("/api/finanzas/banco", { method: "POST", body: form });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo leer el extracto");
      setRes(d);
      setFilas(d.filas.map((f, i) => ({
        ...f, i,
        elegida: !f.op && Boolean(f.sugerencia),
        tipo: f.sugerencia?.tipo || "",
        contra: f.sugerencia?.contra ? etiquetaCuenta(f.sugerencia.contra) : "",
        entidad: f.sugerencia?.entidad || "",
        proveedor_id: f.sugerencia?.proveedor_id || null,
        cliente_id: f.sugerencia?.cliente_id || null,
      })));
    } catch (e) {
      setError(e.message);
    }
    setLeyendo(false);
  }

  async function aprenderDelLibro(file) {
    if (!file) return;
    setError(null);
    setAprendiendo(true);
    try {
      const { hojasXlsx, leerHojaXlsx } = await import("../lib/leerXlsx");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hoja = hojasXlsx(bytes).find((n) => normal(n) === "TOPERACIONES");
      if (!hoja) throw new Error("Ese archivo no tiene la hoja T-OPERACIONES");
      const { reglas, usadas, error: err } = reglasDelLibro(leerHojaXlsx(bytes, hoja, { maxFilas: 60000, maxCols: 60 }) || [], caja.cuenta);
      if (err) throw new Error(err);
      if (!usadas) throw new Error(`En el libro no hay movimientos de ${caja.nombre}`);
      const d = await postBanco({ accion: "aprender", cuenta: caja.cuenta, reglas });
      toast.success(`Aprendí de ${usadas} movimientos del libro (${d.reglas} textos del banco)`);
      setRes((r) => (r ? { ...r, reglas: d.reglas } : r));
    } catch (e) {
      setError(e.message);
    }
    setAprendiendo(false);
  }

  const cambiar = (i, cambios) => setFilas((fs) => fs.map((f) => (f.i === i ? { ...f, ...cambios } : f)));
  const elegirTipo = (f, codigo) => {
    const t = tipos.find((x) => x.codigo === codigo);
    const contra = codigoDe(f.contra) || contraDeTipo(t, f.importe, caja.cuenta);
    cambiar(f.i, { tipo: codigo, contra: etiquetaCuenta(contra), elegida: Boolean(codigo) });
  };

  const pendientes = filas.filter((f) => !f.op);
  const ya = filas.filter((f) => f.op);
  const elegidas = pendientes.filter((f) => f.elegida);
  const incompletas = elegidas.filter((f) => !f.tipo || !nombreCuenta.has(codigoDe(f.contra)));

  async function cargar() {
    setError(null);
    setGuardando(true);
    try {
      const d = await postBanco({
        accion: "confirmar", cuenta: caja.cuenta,
        filas: elegidas.map((f) => ({
          fecha: f.fecha, descripcion: f.descripcion, comprobante: f.comprobante, importe: f.importe, marca: f.marca,
          tipo: f.tipo, contra: codigoDe(f.contra), entidad: f.entidad || null, proveedor_id: f.proveedor_id, cliente_id: f.cliente_id,
        })),
      });
      toast.success(`Se cargaron ${d.cargadas} movimientos${d.repetidas ? ` (${d.repetidas} ya estaban)` : ""}`);
      onCargado();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onCerrar} title={`📥 Extracto de ${caja.nombre}`} maxWidth={980}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        {!res && (
          <>
            <p className="m-0">Subí el resumen del banco en PDF o los movimientos bajados en Excel o CSV. Lo que ya está en Gypi se marca solo; lo demás viene con el tipo sugerido para revisar.</p>
            <label className="flex flex-col gap-1 text-[13px] font-semibold">
              Archivo del extracto
              <input type="file" accept=".pdf,.xlsx,.xls,.csv,application/pdf" aria-label="Archivo del extracto" disabled={leyendo} onChange={(e) => subir(e.target.files?.[0])} />
            </label>
            {leyendo && <p className="m-0 flex items-center gap-2 text-gypi-dim"><Spinner /> Leyendo el extracto…</p>}
          </>
        )}
        {res && (
          <>
            <p className="m-0">
              {res.filas.length} movimientos del {fechaCorta(res.desde)} al {fechaCorta(res.hasta)} · <b className="text-gypi-green">✓ {ya.length} ya en Gypi</b> · <b>{pendientes.length} para cargar</b>
            </p>
            {res.control && (
              <p className={`m-0 text-[13px] ${res.control.ok ? "text-gypi-green" : "text-gypi-red"}`}>
                {res.control.ok
                  ? `✓ El saldo cierra con el del banco: ${plata(res.control.final, "ARS")}`
                  : `⚠ El saldo no cierra: el banco dice ${plata(res.control.final, "ARS")} y los movimientos leídos dan ${plata(res.control.calculado, "ARS")}. Revisá que el archivo esté completo.`}
              </p>
            )}
            {!res.reglas && <p className="m-0 text-[13px] text-gypi-amber-ink">Todavía no aprendí cómo cargás este banco: subí el libro con &quot;📘 Aprender del libro&quot; y las sugerencias salen solas.</p>}
          </>
        )}
        <label className="flex flex-wrap items-center gap-2 text-[13px] text-gypi-dim">
          📘 Aprender del libro (T-OPERACIONES):
          <input type="file" accept=".xlsx,.xlsm" aria-label="Libro contable" disabled={aprendiendo} onChange={(e) => aprenderDelLibro(e.target.files?.[0])} />
          {aprendiendo && <Spinner />}
        </label>

        {res && pendientes.length > 0 && (
          <div className="overflow-x-auto">
            <datalist id="fin-tipos">{tipos.map((t) => <option key={t.codigo} value={t.codigo}>{t.nombre || ""}</option>)}</datalist>
            <datalist id="fin-cuentas">{(datos.cuentas || []).filter((c) => c.activa !== false).map((c) => <option key={c.codigo} value={etiquetaCuenta(c.codigo)} />)}</datalist>
            <table className="w-full text-[13px] border-collapse" aria-label="Movimientos para cargar">
              <thead>
                <tr className="text-gypi-dim text-left">
                  <th className="py-1 w-8"><span className="sr-only">Cargar</span></th>
                  <th className="font-semibold py-1">Movimiento del banco</th>
                  <th className="font-semibold py-1 text-right">Importe</th>
                  <th className="font-semibold py-1">Tipo</th>
                  <th className="font-semibold py-1">Cuenta de enfrente</th>
                </tr>
              </thead>
              <tbody>
                {pendientes.slice(0, MAX_FILAS).map((f) => (
                  <tr key={f.i} className="border-t border-gypi-border align-top">
                    <td className="py-1"><input type="checkbox" aria-label={`Cargar renglón ${f.i + 1}`} checked={f.elegida} onChange={(e) => cambiar(f.i, { elegida: e.target.checked })} /></td>
                    <td className="py-1 min-w-[220px]">
                      <span className="font-mono text-[12px] text-gypi-dim">{fechaCorta(f.fecha)}</span> {f.descripcion}
                      {f.entidad && <span className="block text-[12px] text-gypi-dim">{f.entidad}{f.sugerencia?.por === "cuit" ? " · por CUIT" : ""}</span>}
                    </td>
                    <td className={`py-1 text-right font-mono whitespace-nowrap ${f.importe < 0 ? "text-gypi-red" : "text-gypi-green"}`}>{plata(f.importe, "ARS")}</td>
                    <td className="py-1">
                      <input className="g-input w-full min-w-[170px]" list="fin-tipos" aria-label={`Tipo del renglón ${f.i + 1}`} value={f.tipo} onChange={(e) => elegirTipo(f, e.target.value)} />
                    </td>
                    <td className="py-1">
                      <input className="g-input w-full min-w-[220px]" list="fin-cuentas" aria-label={`Cuenta del renglón ${f.i + 1}`} value={f.contra} onChange={(e) => cambiar(f.i, { contra: e.target.value })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pendientes.length > MAX_FILAS && <p className="m-0 mt-1 text-[12px] text-gypi-dim">Se ven los primeros {MAX_FILAS}: cargalos y volvé a subir el extracto para seguir.</p>}
          </div>
        )}

        {res && ya.length > 0 && (
          <div>
            <button type="button" className="g-btn g-btn-secondary" onClick={() => setVerYa((v) => !v)}>{verYa ? "Ocultar" : "Ver"} los {ya.length} que ya están en Gypi</button>
            {verYa && (
              <ul className="list-none m-0 mt-2 p-0 flex flex-col gap-1 text-[13px]" aria-label="Ya en Gypi">
                {ya.map((f) => (
                  <li key={f.i} className="text-gypi-dim">
                    ✓ <span className="font-mono">{fechaCorta(f.fecha)}</span> {plata(f.importe, "ARS")} · {f.descripcion} → <b className="text-gypi-text">{f.op.tipo}</b>{f.op.entidad ? ` (${f.op.entidad})` : ""}{f.ya ? " · de un extracto anterior" : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {res?.sin_banco?.length > 0 && (
          <div className="p-3 rounded-lg border border-gypi-amber/40 bg-gypi-amber/10 text-[13px]">
            <b className="text-gypi-amber-ink">En Gypi pero no en el banco ({res.sin_banco.length}):</b>
            <ul className="list-none m-0 mt-1 p-0 flex flex-col gap-0.5" aria-label="No están en el banco">
              {res.sin_banco.slice(0, 50).map((o) => <li key={o.id}><span className="font-mono">{fechaCorta(o.fecha)}</span> {o.tipo}{o.entidad ? ` · ${o.entidad}` : ""}{o.descripcion ? ` · ${o.descripcion}` : ""}</li>)}
            </ul>
          </div>
        )}

        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {res && <button type="button" className="g-btn g-btn-secondary" onClick={() => { setRes(null); setFilas([]); }}>Subir otro</button>}
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cerrar</button>
          {res && (
            <button type="button" className="g-btn g-btn-primary" disabled={guardando || !elegidas.length || incompletas.length > 0} onClick={cargar}>
              {guardando ? "Cargando…" : incompletas.length ? `Faltan ${incompletas.length} sin tipo o cuenta` : `Cargar ${elegidas.length} movimientos`}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
