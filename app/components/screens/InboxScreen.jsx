"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { sb, apiFetch } from "../../lib/supabase";
import { sendPushToLegajo } from "../../lib/push";
import { Ic } from "../Icons";
import SolCard from "../cards/SolCard";
import { Chip, Button, EmptyState } from "../ui";
import { bandejaVacia } from "../../lib/textos";

const AMBER = "var(--color-empresa-primary, #F97316)";
const GREEN = "#16A34A";
const RED = "#DC2626";
// Tiempo para "Deshacer" antes de enviar la respuesta (F4-07)
export const ESPERA_DESHACER_MS = 5000;
const sinId = (obj, id) => Object.fromEntries(Object.entries(obj).filter(([k]) => k !== String(id)));

export default function InboxScreen({ ctx, reload, usuario }) {
  const [f, setF] = useState("pendiente");
  const [solicitudes, setSolicitudes] = useState(ctx.solicitudes || []);
  const [cargando, setCargando] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [enPrimeraPagina, setEnPrimeraPagina] = useState(true);
  const [hayMas, setHayMas] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const LIMIT = 30;

  const cargarSolicitudes = useCallback(async (cursorActual = null) => {
    const esPrimera = !cursorActual;
    if (esPrimera) setCargando(true); else setCargandoMas(true);
    try {
      const { data: sols, nextCursor } = await sb.getPage(`solicitudes?select=*&order=created_at.desc&limit=${LIMIT}`, cursorActual);
      if (esPrimera) setSolicitudes(sols || []); else setSolicitudes(prev => [...prev, ...(sols || [])]);
      setHayMas((sols || []).length === LIMIT);
      setCursor(nextCursor || null);
      setEnPrimeraPagina(esPrimera);
    } catch (e) { console.error("Error cargando solicitudes:", e); }
    if (esPrimera) setCargando(false); else setCargandoMas(false);
  }, []);

  useEffect(() => { cargarSolicitudes(); }, [cargarSolicitudes]);
  useEffect(() => { if (ctx.solicitudes?.length > 0 && enPrimeraPagina) setSolicitudes(ctx.solicitudes); }, [ctx.solicitudes, enPrimeraPagina]);

  const filtered = solicitudes.filter(s => { if (s.estado === "registrado") return false; if (f === "todas") return true; return s.estado === f; });
  const pend = solicitudes.filter(s => s.estado === "pendiente").length;
  const sortedFiltered = [...filtered].sort((a, b) => {
    const aI = a.motivo?.includes("INGRESO") || a.motivo?.includes("🔓") ? 1 : 0;
    const bI = b.motivo?.includes("INGRESO") || b.motivo?.includes("🔓") ? 1 : 0;
    return bI - aI;
  });

  // Todo se guarda junto en el servidor (ítem 38): la solicitud, la fichada
  // del permiso de ingreso o la hora extra, y el aviso al empleado.
  const resolver = async (id, estado, nota = "") => {
    setErrorMsg(null);
    try {
      const r = await apiFetch("/api/solicitudes/resolver", { method: "POST", body: JSON.stringify({ id, estado, nota: nota || null }) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 409) setErrorMsg("Otra persona ya respondió este pedido.");
      else if (!r.ok || !d.ok) throw new Error(d.error || `Error ${r.status}`);
      else if (d.push) sendPushToLegajo(d.push.legajo, d.push.titulo, d.push.cuerpo, { empresa_id: usuario.empresa_id }).catch(() => {});
      await cargarSolicitudes(); reload();
    } catch (e) { console.error(e); setErrorMsg("No se pudo responder el pedido. Revisá la conexión e intentá de nuevo."); }
  };

  // Aprobar/Rechazar espera unos segundos antes de enviarse, para poder deshacer
  // un toque equivocado (F4-07). Si se sale de la pantalla, se envía enseguida.
  const [enEspera, setEnEspera] = useState({}); // id -> { estado, nota, hasta }
  const timersRef = useRef(new Map());
  const resolverRef = useRef(resolver);
  useEffect(() => { resolverRef.current = resolver; });

  const enviar = useCallback((id, estado, nota) => {
    const t = timersRef.current.get(id);
    if (t) clearTimeout(t.timer);
    timersRef.current.delete(id);
    setEnEspera(prev => sinId(prev, id));
    return resolverRef.current(id, estado, nota);
  }, []);

  const pedirResolver = (id, estado, nota) => {
    const hasta = Date.now() + ESPERA_DESHACER_MS;
    const timer = setTimeout(() => enviar(id, estado, nota), ESPERA_DESHACER_MS);
    timersRef.current.set(id, { timer, estado, nota });
    setEnEspera(prev => ({ ...prev, [id]: { estado, hasta } }));
  };

  const deshacer = (id) => {
    const t = timersRef.current.get(id);
    if (t) clearTimeout(t.timer);
    timersRef.current.delete(id);
    setEnEspera(prev => sinId(prev, id));
  };

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const [id, t] of timers) {
        clearTimeout(t.timer);
        resolverRef.current(id, t.estado, t.nota);
      }
      timers.clear();
    };
  }, []);

  return (
    <section aria-label="Bandeja de solicitudes" className="px-[18px] pb-[110px] overflow-y-auto flex-1">
      {errorMsg && (
        <div role="alert" className="p-3 bg-gypi-red/10 text-gypi-red rounded-[10px] text-xs mb-3 flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} aria-label="Cerrar error" className="bg-transparent border-none text-gypi-red cursor-pointer font-bold text-sm">✕</button>
        </div>
      )}
      <div role="group" aria-label="Filtros de solicitudes" className="flex gap-1.5 mb-3.5 overflow-x-auto items-center">
        <Chip active={f === "pendiente"} onClick={() => setF("pendiente")} color={AMBER}>Pendientes · {pend}</Chip>
        <Chip active={f === "aprobado"} onClick={() => setF("aprobado")} color={GREEN}>Aprobados</Chip>
        <Chip active={f === "rechazado"} onClick={() => setF("rechazado")} color={RED}>Rechazados</Chip>
        <Chip active={f === "todas"} onClick={() => setF("todas")}>Todas</Chip>
        <Button variant="secondary" size="sm" onClick={() => cargarSolicitudes()} aria-label="Actualizar pedidos" className="shrink-0"><Ic.refresh /></Button>
      </div>
      {cargando ? (
        <div role="status" aria-live="polite" className="text-center py-8 text-gypi-dim text-[13px]">Cargando solicitudes...</div>
      ) : (
        <div className="flex flex-col gap-3">
          {sortedFiltered.length === 0 ? (
            <div className="g-card">
              <EmptyState icon="inbox" title={bandejaVacia(f).titulo} description={bandejaVacia(f).detalle} color="var(--color-green)" />
            </div>
          ) : sortedFiltered.map(s => <SolCard key={s.id} s={s} showActions onResolve={pedirResolver} enEspera={enEspera[s.id]} onDeshacer={deshacer} />)}
          {hayMas && !cargandoMas && (
            <Button variant="secondary" onClick={() => cargarSolicitudes(cursor)} className="w-full mt-1">Ver más pedidos</Button>
          )}
          {cargandoMas && <div role="status" aria-live="polite" className="text-center py-3.5 text-gypi-dim text-xs">Cargando...</div>}
        </div>
      )}
    </section>
  );
}
