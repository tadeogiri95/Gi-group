'use client';
// app/components/DestinosOt.jsx — 📍 Destinos de una OT, dentro de 🧩 Piezas
// (Tadeo, 07/11; app/lib/destinosPiezas.js, migración 163).
// Las piezas con el mismo módulo en su código forman ese módulo, que se arma
// y viaja como un bulto. Acá gestión define lo que falta:
//   - cada módulo: 📦 Se arma o 🧩 Van sueltas;
//   - cada pieza sin módulo: a un módulo (va armada dentro) o suelta;
//   - cada herraje o perfil de la planilla: dentro del mueble o suelto.
// Lo suelto pasa solo a 📦 Sueltos de la OT para el acopio y la carga.
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, sbGetAll } from "../lib/supabase";
import { armarDestinos, textoDestinos, ARMADO, SUELTAS } from "../lib/destinosPiezas";

const BOTON = "min-h-[40px] px-2.5 rounded-lg border text-xs font-bold cursor-pointer disabled:opacity-50";
const activo = (si, color = "green") => (si
  ? (color === "amber" ? "bg-gypi-amber/15 border-gypi-amber text-gypi-amber-ink" : "bg-gypi-green/15 border-gypi-green text-gypi-green")
  : "bg-transparent border-gypi-border text-gypi-dim");
const SIN_DEFINIR = "";
const SUELTA = "\u0000suelta";

export default function DestinosOt({ ot, empresaId, piezas, onCambio }) {
  const [destinos, setDestinos] = useState(null);
  const [falta, setFalta] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [tildadas, setTildadas] = useState(() => new Set());
  const [enLote, setEnLote] = useState(SIN_DEFINIR);

  const cargar = useCallback(async () => {
    if (!ot || !empresaId) return;
    try {
      const { data } = await sbGetAll(`destinos_ot?empresa_id=eq.${empresaId}&ot=eq.${encodeURIComponent(ot)}&select=tipo,clave,datos,planilla_suelto,en_planilla,suelto,modulo&order=id.asc`);
      setDestinos(data || []);
      setFalta(false);
    } catch {
      setDestinos([]);
      setFalta(true);
    }
  }, [ot, empresaId]);
  useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect

  const d = useMemo(() => armarDestinos(piezas || [], destinos || []), [piezas, destinos]);

  const enviar = async (cambios) => {
    setGuardando(true);
    setError(null);
    try {
      const r = await apiFetch("/api/piezas", { method: "POST", body: JSON.stringify({ accion: "destino", ot, cambios }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "No se pudo guardar");
      await cargar();
      await onCambio?.();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setGuardando(false);
    }
  };

  const destinoPieza = (nombre, valor) => ({
    tipo: "pieza", clave: nombre,
    suelto: valor === SUELTA ? true : null,
    modulo: valor && valor !== SUELTA ? valor : null,
  });
  const valorDe = (p) => (p.destino === "suelta" ? SUELTA : p.destino === "modulo" ? p.modulo : SIN_DEFINIR);

  const tildar = (nombre) => setTildadas((prev) => {
    const s = new Set(prev);
    if (s.has(nombre)) s.delete(nombre); else s.add(nombre);
    return s;
  });
  const aplicarLote = async () => {
    if (await enviar([...tildadas].map((n) => destinoPieza(n, enLote)))) {
      setTildadas(new Set());
      setEnLote(SIN_DEFINIR);
    }
  };

  if (!piezas?.length || destinos === null) return null;
  const opcionesModulo = d.modulos.map((m) => ({ valor: m.modulo, texto: m.destino === SUELTAS ? `Con ${m.modulo} (van sueltas)` : `Dentro de ${m.modulo}` }));

  return (
    <section aria-label="Destinos de módulos y piezas" className={`g-card mb-3 ${d.sinDefinir ? "border-gypi-red/50" : ""}`}>
      <button onClick={() => setAbierto((a) => !a)} aria-expanded={abierto}
        className="w-full flex items-center gap-2 bg-transparent border-none p-0 cursor-pointer text-left text-gypi-text">
        <span className="flex-1 min-w-0">
          <span className="block text-[14px] font-bold">📍 Destinos: qué se arma y qué va suelto</span>
          <span className={`block text-xs ${d.sinDefinir ? "text-gypi-red" : "text-gypi-dim"}`}>{falta ? "Falta correr la migración 163 en Supabase." : textoDestinos(d)}</span>
        </span>
        <span className="text-gypi-dim text-sm">{abierto ? "▲" : "▼"}</span>
      </button>

      {abierto && !falta && (
        <div className="mt-3 flex flex-col gap-3">
          <div className="text-xs text-gypi-dim">
            Las piezas con el mismo módulo en su código forman ese módulo: se arma y viaja como un bulto. Lo que va suelto pasa solo a 📦 Sueltos para controlarlo en el acopio y la carga.
          </div>
          {error && <div role="alert" className="text-[12px] text-gypi-red">{error}</div>}

          {d.modulos.length > 0 && (
            <div>
              <div className="text-[13px] font-bold mb-1">Módulos ({d.modulos.length})</div>
              <ul className="list-none p-0 m-0 flex flex-col gap-1.5">
                {d.modulos.map((m) => (
                  <li key={m.modulo} className="flex items-center gap-2 rounded-xl p-2 border border-gypi-border bg-gypi-surface">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-bold">{m.modulo}</div>
                      <div className="text-xs text-gypi-dim">
                        {m.unidades === 1 ? "1 pieza" : `${m.unidades} piezas`}
                        {m.agregadas > 0 && ` · +${m.agregadas} sin módulo`}
                        {m.sueltasPlanilla > 0 && ` · ${m.sueltasPlanilla} ${m.sueltasPlanilla === 1 ? "viaja suelta" : "viajan sueltas"} (SUELTO en la planilla)`}
                      </div>
                    </div>
                    <button onClick={() => enviar([{ tipo: "modulo", clave: m.modulo, suelto: null }])} disabled={guardando || m.destino === ARMADO}
                      aria-pressed={m.destino === ARMADO} className={`${BOTON} ${activo(m.destino === ARMADO)}`}>📦 Se arma</button>
                    <button onClick={() => enviar([{ tipo: "modulo", clave: m.modulo, suelto: true }])} disabled={guardando || m.destino === SUELTAS}
                      aria-pressed={m.destino === SUELTAS} className={`${BOTON} ${activo(m.destino === SUELTAS, "amber")}`}>🧩 Van sueltas</button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {d.sinModulo.length > 0 && (
            <div>
              <div className="text-[13px] font-bold mb-1">
                Piezas sin módulo ({d.sinModulo.length}){d.sinDefinir > 0 && <span className="text-gypi-red"> · {d.sinDefinir} sin definir</span>}
              </div>
              <div className="text-xs text-gypi-dim mb-1.5">Elegí si van armadas dentro de un módulo o sueltas. Su código de barras no cambia.</div>
              {tildadas.size > 0 && (
                <div className="flex items-center gap-2 mb-1.5 p-2 rounded-xl border border-gypi-amber bg-gypi-amber/10">
                  <span className="text-xs font-bold shrink-0">{tildadas.size} tildadas →</span>
                  <select className="g-input flex-1 min-w-0 text-[13px]" value={enLote} onChange={(e) => setEnLote(e.target.value)} aria-label="Destino de las piezas tildadas">
                    <option value={SIN_DEFINIR}>Sin definir</option>
                    <option value={SUELTA}>Suelta</option>
                    {opcionesModulo.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
                  </select>
                  <button onClick={aplicarLote} disabled={guardando} className="g-btn g-btn-primary text-xs min-h-[40px] px-3 shrink-0">Aplicar</button>
                </div>
              )}
              <ul className="list-none p-0 m-0 flex flex-col gap-1.5">
                {d.sinModulo.map((p) => (
                  <li key={p.nombre} className={`flex items-center gap-2 rounded-xl p-2 border bg-gypi-surface ${p.destino ? "border-gypi-border" : "border-gypi-red/60"}`}>
                    <input type="checkbox" className="w-5 h-5 shrink-0" checked={tildadas.has(p.nombre)} onChange={() => tildar(p.nombre)} aria-label={`Tildar ${p.nombre}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-bold">{p.nombre} <span className="font-normal text-gypi-dim">× {p.unidades}</span></div>
                      <div className="text-xs text-gypi-dim truncate">{[p.medida, p.material, p.planilla && !p.manual && "SUELTO en la planilla"].filter(Boolean).join(" · ")}</div>
                    </div>
                    <select className={`g-input w-[150px] shrink-0 text-[13px] ${p.destino ? "" : "text-gypi-red"}`} value={valorDe(p)} disabled={guardando}
                      onChange={(e) => enviar([destinoPieza(p.nombre, e.target.value)])} aria-label={`Destino de ${p.nombre}`}>
                      <option value={SIN_DEFINIR}>Sin definir</option>
                      <option value={SUELTA}>Suelta</option>
                      {opcionesModulo.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
                    </select>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="text-[13px] font-bold mb-1">Herrajes y perfiles ({d.herrajes.filter((h) => h.en_planilla).length})</div>
            {d.herrajes.length === 0 ? (
              <div className="text-xs text-gypi-dim">Todavía no hay lista: llega sola con la próxima lectura de la planilla (NECESIDADES).</div>
            ) : (
              <>
                <div className="text-xs text-gypi-dim mb-1.5">Van dentro del mueble salvo los que marques sueltos (o los que dicen SUELTO en la planilla).</div>
                <ul className="list-none p-0 m-0 flex flex-col gap-1.5">
                  {d.herrajes.filter((h) => h.en_planilla).map((h) => (
                    <li key={h.clave} className="flex items-center gap-2 rounded-xl p-2 border border-gypi-border bg-gypi-surface">
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-bold truncate" title={h.descripcion}>{h.descripcion || h.codigo}</div>
                        <div className="text-xs text-gypi-dim">
                          {[h.tipo, h.codigo, `Cant. ${Number(h.cantidad || 1).toLocaleString("es-AR")}`, h.planilla_suelto && "SUELTO en la planilla"].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      <button onClick={() => enviar([{ tipo: "herraje", clave: h.clave, suelto: h.planilla_suelto ? false : null }])} disabled={guardando || !h.suelto}
                        aria-pressed={!h.suelto} className={`${BOTON} ${activo(!h.suelto)}`}>Dentro</button>
                      <button onClick={() => enviar([{ tipo: "herraje", clave: h.clave, suelto: h.planilla_suelto ? null : true }])} disabled={guardando || h.suelto}
                        aria-pressed={h.suelto} className={`${BOTON} ${activo(h.suelto, "amber")}`}>Suelto</button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
