'use client';
// app/components/PlacasCortadas.jsx — 🪚 Placas cortadas entre varias OT
// (pedido de Tadeo, 27/11). El operario escanea la placa (el rótulo del
// catálogo o del estante) o la busca, pone cuántas cortó y marca las OT del
// corte. Gypi reparte las placas según lo que le falta a cada OT
// (app/lib/repartoPlacas.js), con un decimal; cada número se puede cambiar
// antes de confirmar, siempre que la suma dé lo cortado. Se guarda un retiro
// por OT, todos juntos o ninguno (registrar_varios), y llegan al MRP y al
// costo de cada OT igual que los retiros de siempre.
import { useCallback, useEffect, useMemo, useState } from "react";
import { sb, sbGetAll, apiFetch } from "../lib/supabase";
import Modal from "./ui/Modal";
import EscanerCodigo, { escanerDisponible } from "./EscanerCodigo";
import ElegirOtCarga from "./ElegirOtCarga";
import { filtrarArticulos, leerQrArticulo, cantidadTexto } from "../lib/stock";
import { leerCantidadMovimiento } from "../lib/movimientosStock";
import { claseMaterialMrp } from "../lib/materialMrp";
import { pendientesPorOt, otsConFalta, repartirPlacas, sumaReparto, repartoValido, notaCorte, leerReparto } from "../lib/repartoPlacas";
import { useOts } from "../hooks/useOts";
import { otCompleta, textoOt } from "../lib/nombreOt";

const MAX_VISIBLES = 30;
const CAMPOS = "sku,nombre,unidad,division,familia,activo";
const esPlaca = (a) => ["placa", "fondo"].includes(claseMaterialMrp(a));
const decimalTexto = (n) => String(n).replace(".", ",");

export default function PlacasCortadas({ empresaId, onClose, onVolver = null }) {
  const porOt = useOts();
  const [paso, setPaso] = useState("placa"); // placa | corte | otra-ot | hecho
  const [placa, setPlaca] = useState(null);
  const [lista, setLista] = useState(null);
  const [texto, setTexto] = useState("");
  const [escaneando, setEscaneando] = useState(escanerDisponible());
  const [aviso, setAviso] = useState(null);
  const [pendientes, setPendientes] = useState(null); // Map ot → { necesario, retirado, falta }
  const [total, setTotal] = useState("");
  const [marcadas, setMarcadas] = useState([]); // OT del corte, en orden
  const [valores, setValores] = useState({}); // ot → texto editable
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const [hecho, setHecho] = useState(null);

  const asegurarLista = useCallback(async () => {
    if (lista) return lista;
    const { data } = await sbGetAll(`articulos_stock?activo=eq.true&select=${CAMPOS}&order=sku.asc`, { maxFilas: 20000 });
    const placas = (data || []).filter(esPlaca);
    setLista(placas);
    return placas;
  }, [lista]);

  const elegirPlaca = useCallback(async (a) => {
    setPlaca(a);
    setAviso(esPlaca(a) ? null : "Ojo: ese artículo no parece una placa. Para herrajes y accesorios usá Retirar material.");
    setEscaneando(false);
    setPendientes(null);
    setMarcadas([]);
    setValores({});
    setTotal("");
    setError(null);
    setPaso("corte");
    const sku = encodeURIComponent(a.sku);
    // Sin las migraciones 107/108 no hay tablas: se reparte en partes iguales
    const [nec, movs] = await Promise.all([
      sbGetAll(`necesidades_stock?empresa_id=eq.${empresaId}&sku=eq.${sku}&select=ot,cantidad,fecha,obra_terminada`, { maxFilas: 20000 }).then((r) => r.data || []).catch(() => []),
      sbGetAll(`movimientos_stock?empresa_id=eq.${empresaId}&sku=eq.${sku}&anulado=eq.false&tipo=in.(consumo,devolucion)&ot=not.is.null&select=ot,cantidad,tipo,anulado`, { maxFilas: 20000 }).then((r) => r.data || []).catch(() => []),
    ]);
    setPendientes(pendientesPorOt(nec, movs));
  }, [empresaId]);

  const alEscanear = async (codigo) => {
    const sku = leerQrArticulo(codigo);
    if (!sku) { setAviso("Ese QR no es de un artículo."); return; }
    try {
      const rows = await sb.get(`articulos_stock?sku=eq.${encodeURIComponent(sku)}&select=${CAMPOS}&limit=1`);
      const a = rows?.[0];
      if (!a) { setAviso(`El código ${sku} no está en el stock. Puede que falte sincronizar la planilla.`); return; }
      if (a.activo === false) { setAviso("Ese artículo ya no está en la planilla MRP."); return; }
      elegirPlaca(a);
    } catch {
      setAviso("No se pudo leer el stock. Probá de nuevo.");
    }
  };

  const filtrados = useMemo(() => (texto.trim() ? filtrarArticulos(lista || [], { texto }) : []), [lista, texto]);

  // Las OT activas que todavía necesitan esta placa (las terminadas no)
  const sugeridas = useMemo(() => {
    const activa = (ot) => { const p = porOt.get(String(ot)); return !p?.estado || p.estado === "activo"; };
    return otsConFalta(pendientes).filter((f) => activa(f.ot));
  }, [pendientes, porOt]);
  const extras = marcadas.filter((ot) => !sugeridas.some((s) => s.ot === ot));

  const nTotal = leerCantidadMovimiento(total);
  const totalD = nTotal ? Math.round(nTotal * 10) / 10 : null;

  // Cada vez que cambia lo cortado o las OT marcadas, Gypi propone el reparto
  const proponer = useCallback((ots, cant) => {
    const datos = ots.map((ot) => ({ ot, ...(pendientes?.get(ot) || { necesario: 0, falta: 0 }) }));
    const rep = repartirPlacas(cant || 0, datos);
    setValores(Object.fromEntries(rep.map((r) => [r.ot, decimalTexto(r.cantidad)])));
  }, [pendientes]);

  useEffect(() => { proponer(marcadas, totalD); }, [marcadas, totalD, proponer]);

  const alternar = (ot) => setMarcadas((m) => (m.includes(ot) ? m.filter((x) => x !== ot) : [...m, ot]));

  const reparto = marcadas.map((ot) => ({ ot, cantidad: leerReparto(valores[ot]) }));
  const algunoMal = reparto.some((r) => r.cantidad == null);
  const suma = sumaReparto(reparto.map((r) => ({ ...r, cantidad: r.cantidad ?? 0 })));
  const valido = !algunoMal && totalD != null && repartoValido(reparto, totalD);
  const sinNecesidad = marcadas.filter((ot) => !pendientes?.get(ot)?.conNecesidad);

  const confirmar = async () => {
    if (!valido) return;
    setEnviando(true);
    setError(null);
    const renglones = reparto.filter((r) => r.cantidad > 0).map((r) => ({ sku: placa.sku, cantidad: r.cantidad, ot: r.ot }));
    try {
      const res = await apiFetch("/api/stock/movimientos", {
        method: "POST",
        body: JSON.stringify({ accion: "registrar_varios", tipo: "consumo", renglones, notas: notaCorte(totalD, marcadas) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo registrar");
      setHecho({ placa, total: totalD, renglones });
      setPaso("hecho");
    } catch (e) {
      setError(e.message);
    }
    setEnviando(false);
  };

  const otraPlaca = () => {
    setPlaca(null);
    setHecho(null);
    setTexto("");
    setAviso(null);
    setError(null);
    setEscaneando(escanerDisponible());
    setPaso("placa");
  };

  if (paso === "otra-ot") {
    return (
      <ElegirOtCarga empresaId={empresaId} titulo="¿Qué otra OT entró en el corte?" verbo="Sumar"
        onElegir={(o) => { const ot = String(o); setMarcadas((m) => (m.includes(ot) ? m : [...m, ot])); setPaso("corte"); }}
        onClose={() => setPaso("corte")} />
    );
  }

  const u = placa?.unidad || "placas";
  const nombreOt = (ot) => textoOt(otCompleta(ot, porOt));

  return (
    <Modal open onClose={onClose} title="🪚 Placas cortadas">
      <div className="p-4 overflow-y-auto text-gypi-text">
        {paso === "placa" && (
          <>
            <p className="text-[13px] text-gypi-dim mb-3 mt-0">Escaneá la placa que cortaste, poné cuántas y marcá las OT del corte. Gypi las reparte según lo que le falta a cada una.</p>
            {escanerDisponible() && (
              <div className="mb-3">
                <button onClick={() => { setEscaneando(!escaneando); setAviso(null); }} aria-pressed={escaneando} className="g-btn g-btn-secondary w-full">
                  {escaneando ? "Cerrar la cámara" : "📷 Escanear el QR de la placa"}
                </button>
                {escaneando && <div className="mt-2"><EscanerCodigo onCodigo={alEscanear} ayuda="Apuntá al rótulo de la placa en el catálogo o en la pila" /></div>}
              </div>
            )}
            {aviso && <div role="alert" className="text-[13px] text-gypi-red mb-2">{aviso}</div>}
            <input className="g-input w-full mb-2" value={texto} inputMode="search" aria-label="Buscar placa"
              placeholder="O buscala por nombre o código" onFocus={() => asegurarLista().catch(() => setAviso("No se pudo leer el stock."))}
              onChange={(e) => setTexto(e.target.value)} />
            {texto.trim() && lista === null && <div className="text-[13px] text-gypi-dim" role="status">Cargando placas…</div>}
            {texto.trim() && lista !== null && !filtrados.length && <div className="text-[13px] text-gypi-dim">No hay placas con ese nombre.</div>}
            {filtrados.length > 0 && (
              <ul aria-label="Placas" className="list-none p-0 m-0 flex flex-col gap-1.5">
                {filtrados.slice(0, MAX_VISIBLES).map((a) => (
                  <li key={a.sku}>
                    <button onClick={() => elegirPlaca(a)} className="w-full min-h-[52px] text-left bg-gypi-surface rounded-xl px-3 py-2 border border-gypi-border cursor-pointer font-body text-gypi-text">
                      <div className="text-[14px] font-bold">{a.nombre || a.sku}</div>
                      <div className="text-[12px] text-gypi-dim">{a.sku}{a.unidad ? ` · ${a.unidad}` : ""}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {onVolver && <button onClick={onVolver} className="g-btn g-btn-secondary w-full mt-3">Volver a Retirar material</button>}
          </>
        )}

        {paso === "corte" && placa && (
          <>
            <div className="p-3 rounded-xl bg-gypi-surface border border-gypi-border mb-3">
              <div className="text-[16px] font-bold">{placa.nombre || placa.sku}</div>
              <div className="text-[12px] text-gypi-dim">{placa.sku}</div>
              <button onClick={otraPlaca} className="min-h-[44px] px-0 bg-transparent border-none text-[13px] font-semibold text-gypi-amber-ink cursor-pointer">Otra placa</button>
            </div>
            {aviso && <div role="alert" className="text-[13px] text-gypi-amber-ink mb-2">{aviso}</div>}
            <label className="g-label" htmlFor="placas-total">¿Cuántas cortaste?{placa.unidad ? ` (${placa.unidad})` : ""}</label>
            <input id="placas-total" className="g-input w-full mb-3 text-[20px]" inputMode="decimal" autoFocus value={total}
              onChange={(e) => setTotal(e.target.value)} placeholder="Ej: 10" />

            <div className="g-label mb-1">¿Qué OT entraron en el corte?</div>
            {pendientes === null ? (
              <div className="text-[13px] text-gypi-dim mb-2" role="status">Buscando qué OT necesitan esta placa…</div>
            ) : !sugeridas.length ? (
              <div className="text-[13px] text-gypi-dim mb-2">Ninguna OT tiene pendiente esta placa en el MRP. Sumá las OT a mano.</div>
            ) : (
              <ul aria-label="OT que necesitan esta placa" className="list-none p-0 m-0 flex flex-col gap-1.5 mb-2">
                {sugeridas.map((f) => {
                  const on = marcadas.includes(f.ot);
                  return (
                    <li key={f.ot}>
                      <label className={`flex items-center gap-2 min-h-[52px] rounded-xl px-3 py-2 border cursor-pointer ${on ? "bg-gypi-amber/10 border-gypi-amber" : "bg-gypi-surface border-gypi-border"}`}>
                        <input type="checkbox" checked={on} onChange={() => alternar(f.ot)} aria-label={`La OT ${f.ot} entró en el corte`} className="w-5 h-5" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-[14px] font-bold truncate">{nombreOt(f.ot)}</span>
                          <span className="block text-[12px] text-gypi-dim">Le faltan {cantidadTexto(f.falta)} de {cantidadTexto(f.necesario)}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {extras.length > 0 && (
              <ul aria-label="Otras OT del corte" className="list-none p-0 m-0 flex flex-col gap-1.5 mb-2">
                {extras.map((ot) => (
                  <li key={ot} className="flex items-center gap-2 min-h-[52px] rounded-xl px-3 py-2 border bg-gypi-amber/10 border-gypi-amber">
                    <span className="flex-1 min-w-0 text-[14px] font-bold truncate">{nombreOt(ot)}</span>
                    <button onClick={() => alternar(ot)} aria-label={`Sacar la OT ${ot} del corte`} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold text-gypi-red cursor-pointer">Sacar</button>
                  </li>
                ))}
              </ul>
            )}
            <button onClick={() => setPaso("otra-ot")} className="g-btn g-btn-secondary w-full mb-3">➕ Sumar otra OT</button>

            {marcadas.length > 0 && (
              <section aria-label="Reparto" className="mb-3">
                <div className="g-label mb-1">Reparto (podés cambiar los números)</div>
                <ul className="list-none p-0 m-0 flex flex-col gap-1.5">
                  {marcadas.map((ot) => (
                    <li key={ot} className="flex items-center gap-2">
                      <label htmlFor={`reparto-${ot}`} className="flex-1 min-w-0 text-[14px] truncate">OT {ot}</label>
                      <input id={`reparto-${ot}`} className="g-input w-24 text-right" inputMode="decimal" value={valores[ot] ?? ""}
                        aria-label={`Placas para la OT ${ot}`} onChange={(e) => setValores((v) => ({ ...v, [ot]: e.target.value }))} />
                    </li>
                  ))}
                </ul>
                {totalD != null && (
                  <div className={`text-[13px] mt-2 ${valido ? "text-gypi-green" : "text-gypi-red"}`} role="status">
                    {algunoMal ? "Revisá los números: cada OT lleva una cantidad (puede ser 0)." : `Suman ${cantidadTexto(suma)} de ${cantidadTexto(totalD)} ${u}.`}
                  </div>
                )}
                {totalD != null && !valido && !algunoMal && (
                  <button onClick={() => proponer(marcadas, totalD)} className="min-h-[44px] px-0 bg-transparent border-none text-[13px] font-semibold text-gypi-amber-ink cursor-pointer">Volver a repartir solo</button>
                )}
                {sinNecesidad.length > 0 && sinNecesidad.length < marcadas.length && (
                  <div className="text-[12px] text-gypi-amber-ink mt-1">
                    {sinNecesidad.length === 1 ? `La OT ${sinNecesidad[0]} no tiene` : `Las OT ${sinNecesidad.join(", ")} no tienen`} esta placa en sus necesidades: empieza en 0.
                  </div>
                )}
                {sinNecesidad.length > 0 && sinNecesidad.length === marcadas.length && (
                  <div className="text-[12px] text-gypi-amber-ink mt-1">Ninguna de estas OT tiene esta placa en sus necesidades: se reparte en partes iguales.</div>
                )}
              </section>
            )}

            {error && <div role="alert" className="text-[13px] text-gypi-red mb-2">{error}</div>}
            <button onClick={confirmar} disabled={enviando || !valido} className="g-btn g-btn-primary w-full">
              {enviando ? "Registrando…" : "Registrar el corte"}
            </button>
          </>
        )}

        {paso === "hecho" && hecho && (
          <>
            <div role="status" className="p-3 rounded-xl mb-3 text-[15px] font-semibold bg-gypi-green/10 text-gypi-green">
              ✅ Registrado: {cantidadTexto(hecho.total)} {hecho.placa.unidad || "placas"} de {hecho.placa.nombre || hecho.placa.sku}
            </div>
            <ul className="list-none p-0 m-0 mb-3 flex flex-col gap-1 text-[14px]">
              {hecho.renglones.map((r) => <li key={r.ot}>OT {r.ot}: <b>{cantidadTexto(r.cantidad)}</b></li>)}
            </ul>
            <button onClick={otraPlaca} className="g-btn g-btn-primary w-full mb-2">Cortaste otra placa</button>
            <button onClick={onClose} className="g-btn g-btn-secondary w-full">Listo</button>
          </>
        )}
      </div>
    </Modal>
  );
}
