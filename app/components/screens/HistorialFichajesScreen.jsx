"use client";
import { useState, useEffect, useMemo } from "react";
import { sb } from "../../lib/supabase";
import { hoyArg } from "../../lib/dates";
import { Ic } from "../Icons";
import EmptyState from "../ui/EmptyState";

const AMBER = "var(--color-empresa-primary, #F97316)";
const GREEN = "#16A34A";
const RED = "#DC2626";
const CYAN = "#0891B2";

export default function HistorialFichajesScreen({ usuario, ctx, legajoVer, onBack }) {
  const [fichadas, setFichadas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mes, setMes] = useState(() => hoyArg().slice(0, 7));
  const [chatHistory, setChatHistory] = useState([]);
  const [showChat, setShowChat] = useState(false);
  const legajo = legajoVer || usuario.legajo;
  const isGer = usuario.rol === "gerencial" || usuario.rol === "administrativo";
  const empleadoVer = (ctx.empleados || []).find(e => e.legajo === legajo);
  const empNombre = isGer && legajoVer ? empleadoVer?.apodo || `L-${legajo}` : usuario.apodo;
  const empleadoId = legajoVer ? empleadoVer?.id : usuario.id;

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [y, m] = mes.split("-").map(Number);
        const desde = `${y}-${String(m).padStart(2, "0")}-01`;
        const hasta = new Date(y, m, 0);
        const hastaStr = `${y}-${String(m).padStart(2, "0")}-${String(hasta.getDate()).padStart(2, "0")}`;
        const f = await sb.get(`fichadas?legajo=eq.${legajo}&fecha=gte.${desde}&fecha=lte.${hastaStr}&order=fecha.desc&select=*`);
        setFichadas(f || []);
        if (empleadoId) {
          const ch = await sb.get(`mensajes_chat?empleado_id=eq.${empleadoId}&order=created_at.desc&limit=100`);
          setChatHistory(ch || []);
        } else {
          setChatHistory([]);
        }
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, [legajo, mes, empleadoId]);

  const totalTardes = fichadas.filter(f => f.llegada_tarde).length;
  const tardanzasMap = useMemo(() => {
    const sorted = [...fichadas].sort((a, b) => a.fecha.localeCompare(b.fecha));
    const map = new Map();
    let acumulado = 0;
    for (const f of sorted) {
      if (!f.llegada_tarde) continue;
      acumulado++;
      const conPerdida = f.minutos_tarde > 30 || acumulado >= 3;
      map.set(f.id ?? f.fecha, { conPerdida, numero: acumulado });
    }
    return map;
  }, [fichadas]);
  const tardesComunes = fichadas.filter(f => f.llegada_tarde && !tardanzasMap.get(f.id ?? f.fecha)?.conPerdida);
  const tardesConPerdida = fichadas.filter(f => f.llegada_tarde && tardanzasMap.get(f.id ?? f.fecha)?.conPerdida);
  const cambiarMes = (dir) => { const [y, m] = mes.split("-").map(Number); const d = new Date(y, m - 1 + dir, 1); setMes(hoyArg(d).slice(0, 7)); };
  const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const [y2, m2] = mes.split("-").map(Number);
  const mesLabel = `${meses[m2 - 1]} ${y2}`;

  return (
    <section aria-label={`Fichajes de ${empNombre}`} className="px-[18px] pb-[110px] overflow-y-auto flex-1">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} aria-label="Volver" className="bg-transparent border-none text-gypi-text cursor-pointer p-1.5 flex"><Ic.chevL /></button>
        <h2 className="m-0 font-heading text-xl font-bold text-gypi-text flex-1">Fichajes de {empNombre}</h2>
      </div>

      <div className="g-card flex items-center justify-between !py-2.5 !px-4 mb-4">
        <button onClick={() => cambiarMes(-1)} aria-label="Mes anterior" className="bg-transparent border-none text-gypi-text cursor-pointer text-lg p-1">←</button>
        <span className="font-heading text-base font-bold text-gypi-text">{mesLabel}</span>
        <button onClick={() => cambiarMes(1)} aria-label="Mes siguiente" className="bg-transparent border-none text-gypi-text cursor-pointer text-lg p-1">→</button>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="g-card text-center !p-3.5">
          <div className="font-heading text-[22px] font-bold" style={{ color: totalTardes > 0 ? "#F59E0B" : GREEN }}>{totalTardes}</div>
          <div className="text-[10px] text-gypi-dim font-semibold mt-0.5">Tardes total</div>
        </div>
        <div className="rounded-[14px] p-3.5 text-center" style={{ background: `${AMBER}08`, border: "1px solid #F59E0B30" }}>
          <div className="font-heading text-[22px] font-bold" style={{ color: "#F59E0B" }}>{tardesComunes.length}</div>
          <div className="text-[10px] text-gypi-dim font-semibold mt-0.5">Comunes</div>
        </div>
        <div className="rounded-[14px] p-3.5 text-center" style={{ background: `${RED}08`, border: `1px solid ${RED}30` }}>
          <div className="font-heading text-[22px] font-bold text-gypi-red">{tardesConPerdida.length}</div>
          <div className="text-[10px] text-gypi-dim font-semibold mt-0.5">Con pérdida</div>
        </div>
      </div>

      {loading ? (
        <div className="gypi-dots py-10"><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /><span className="bg-gypi-amber" /></div>
      ) : fichadas.length === 0 ? (
        <EmptyState icon="calendar" title="Sin fichadas este mes" description="No hay registros de asistencia para este período." color={CYAN} style={{ padding: "32px 16px" }} />
      ) : (
        <div className="flex flex-col gap-2">
          {fichadas.map((f, i) => {
            const info = tardanzasMap.get(f.id ?? f.fecha);
            const esTardeComun = f.llegada_tarde && info && !info.conPerdida;
            const esTardeConPerdida = f.llegada_tarde && info?.conPerdida;
            const bgColor = esTardeConPerdida ? `${RED}10` : esTardeComun ? "rgba(245,158,11,0.08)" : `${GREEN}05`;
            const borderColor = esTardeConPerdida ? `${RED}30` : esTardeComun ? "#F59E0B30" : "var(--color-border)";
            const statusColor = esTardeConPerdida ? RED : esTardeComun ? "#F59E0B" : GREEN;
            const statusIcon = esTardeConPerdida ? "⛔" : esTardeComun ? "⚠️" : "✓";
            const statusLabel = esTardeConPerdida ? "Pérdida de presentismo" : esTardeComun ? `Tarde +${f.minutos_tarde}min` : "Puntual";
            const tardeCuenta = info?.numero || 0;
            return (
              <div key={f.id || i} className="rounded-[14px] p-3.5" style={{ background: bgColor, border: `1px solid ${borderColor}` }}>
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-[13px] font-bold text-gypi-text">{new Date(f.fecha + "T12:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" })}</div>
                    <div className="text-xs text-gypi-dim mt-1 font-mono">{f.ingreso?.slice(0, 5) || "—"} → {f.egreso?.slice(0, 5) || "sin egreso"}</div>
                    {f.horas_trabajadas && <div className="text-[11px] text-gypi-dim mt-0.5">{Number(f.horas_trabajadas).toFixed(1)}h trabajadas</div>}
                  </div>
                  <div className="text-right">
                    <span className="inline-flex items-center gap-1 py-[3px] px-2 rounded-md text-[10px] font-bold" style={{ background: `${statusColor}22`, color: statusColor }}>{statusIcon} {statusLabel}</span>
                    {f.llegada_tarde && tardeCuenta > 0 && <div className="text-[10px] font-semibold mt-1" style={{ color: statusColor }}>Tarde #{tardeCuenta} del mes</div>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-6 mb-3">
        <h3 className="m-0 text-base font-bold text-gypi-text font-heading">Historial de conversaciones</h3>
      </div>
      <button onClick={() => setShowChat(!showChat)} aria-expanded={showChat} className="g-card w-full !py-3.5 text-[13px] font-semibold font-body cursor-pointer flex justify-between items-center">
        <span>{showChat ? "Ocultar" : "Ver"} conversaciones ({chatHistory.length})</span>
        <span aria-hidden="true" className="text-[11px] text-gypi-dim">{showChat ? "▲" : "▼"}</span>
      </button>
      {showChat && (
        <div role="log" aria-label="Historial de conversaciones" className="mt-2.5 g-card !p-3.5 max-h-[400px] overflow-y-auto">
          {chatHistory.length === 0 ? (
            <div className="text-center text-gypi-dim text-[13px] py-4">Sin conversaciones</div>
          ) : chatHistory.map((m, i) => (
            <div key={i} className={`flex mb-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] py-2 px-3 text-xs text-gypi-text leading-relaxed ${m.role === "user" ? "rounded-[12px_12px_4px_12px] bg-gypi-amber/20" : "rounded-[12px_12px_12px_4px] bg-gypi-surf-hi"}`}>
                <div className="whitespace-pre-wrap">{m.content}</div>
                <div className={`text-[9px] text-gypi-mute mt-1 ${m.role === "user" ? "text-right" : "text-left"}`}>{new Date(m.created_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
