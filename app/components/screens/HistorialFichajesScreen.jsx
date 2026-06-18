"use client";
// Extraído de [slug]/page.js líneas 420-534
import { useState, useEffect, useMemo } from "react";
import { C, fH, fB, fM } from "../../lib/theme";
import { sb } from "../../lib/supabase";
import { hoyArg } from "../../lib/dates";
import { Ic } from "../Icons";
import EmptyState from "../ui/EmptyState";

export default function HistorialFichajesScreen({ usuario, ctx, legajoVer, onBack }) {
  const [fichadas, setFichadas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mes, setMes] = useState(() => hoyArg().slice(0, 7));
  const [chatHistory, setChatHistory] = useState([]);
  const [showChat, setShowChat] = useState(false);
  const legajo = legajoVer || usuario.legajo;
  const isGer = usuario.rol === "gerencial" || usuario.rol === "administrativo";
  const empNombre = isGer && legajoVer ? (ctx.empleados || []).find(e => e.legajo === legajo)?.apodo || `L-${legajo}` : usuario.apodo;

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
        const ch = await sb.get(`mensajes_chat?legajo=eq.${legajo}&order=created_at.desc&limit=100`);
        setChatHistory(ch || []);
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, [legajo, mes]);

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
    <section aria-label={`Fichajes de ${empNombre}`} style={{ padding: "0 18px 110px", overflowY: "auto", flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button onClick={onBack} aria-label="Volver" style={{ background: "none", border: "none", color: C.text, cursor: "pointer", padding: 6, display: "flex" }}><Ic.chevL /></button>
        <h2 style={{ margin: 0, fontFamily: fH, fontSize: 20, fontWeight: 700, color: C.text, flex: 1 }}>Fichajes de {empNombre}</h2>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, background: C.surface, borderRadius: 14, padding: "10px 16px", border: `1px solid ${C.border}` }}>
        <button onClick={() => cambiarMes(-1)} aria-label="Mes anterior" style={{ background: "none", border: "none", color: C.text, cursor: "pointer", fontSize: 18, padding: 4 }}>←</button>
        <span style={{ fontFamily: fH, fontSize: 16, fontWeight: 700, color: C.text }}>{mesLabel}</span>
        <button onClick={() => cambiarMes(1)} aria-label="Mes siguiente" style={{ background: "none", border: "none", color: C.text, cursor: "pointer", fontSize: 18, padding: 4 }}>→</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
        <div style={{ background: C.surface, borderRadius: 14, padding: 14, border: `1px solid ${C.border}`, textAlign: "center" }}><div style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, color: totalTardes > 0 ? "#F59E0B" : C.green }}>{totalTardes}</div><div style={{ fontSize: 10, color: C.dim, fontWeight: 600, marginTop: 2 }}>Tardes total</div></div>
        <div style={{ background: `${C.amber}08`, borderRadius: 14, padding: 14, border: "1px solid #F59E0B30", textAlign: "center" }}><div style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, color: "#F59E0B" }}>{tardesComunes.length}</div><div style={{ fontSize: 10, color: C.dim, fontWeight: 600, marginTop: 2 }}>Comunes</div></div>
        <div style={{ background: `${C.red}08`, borderRadius: 14, padding: 14, border: `1px solid ${C.red}30`, textAlign: "center" }}><div style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, color: C.red }}>{tardesConPerdida.length}</div><div style={{ fontSize: 10, color: C.dim, fontWeight: 600, marginTop: 2 }}>Con pérdida</div></div>
      </div>
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: 40, gap: 6 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ width: 6, height: 6, borderRadius: 3, background: C.amber, animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
          ))}
          <style>{`@keyframes pulse { 0%,100%{opacity:.2;transform:scale(.7)} 50%{opacity:1;transform:scale(1)} }`}</style>
        </div>
      ) : fichadas.length === 0 ? (
        <EmptyState icon="calendar" title="Sin fichadas este mes" description="No hay registros de asistencia para este período." color={C.cyan} style={{ padding: "32px 16px" }} />
      ) :
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {fichadas.map((f, i) => {
              const info = tardanzasMap.get(f.id ?? f.fecha);
              const esTardeComun = f.llegada_tarde && info && !info.conPerdida;
              const esTardeConPerdida = f.llegada_tarde && info?.conPerdida;
              const bgColor = esTardeConPerdida ? `${C.red}10` : esTardeComun ? "rgba(245,158,11,0.08)" : `${C.green}05`;
              const borderColor = esTardeConPerdida ? `${C.red}30` : esTardeComun ? "#F59E0B30" : C.border;
              const statusColor = esTardeConPerdida ? C.red : esTardeComun ? "#F59E0B" : C.green;
              const statusIcon = esTardeConPerdida ? "⛔" : esTardeComun ? "⚠️" : "✓";
              const statusLabel = esTardeConPerdida ? "Pérdida de presentismo" : esTardeComun ? `Tarde +${f.minutos_tarde}min` : "Puntual";
              const tardeCuenta = info?.numero || 0;
              return (
                <div key={f.id || i} style={{ background: bgColor, borderRadius: 14, padding: 14, border: `1px solid ${borderColor}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{new Date(f.fecha + "T12:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" })}</div>
                      <div style={{ fontSize: 12, color: C.dim, marginTop: 4, fontFamily: fM }}>{f.ingreso?.slice(0, 5) || "—"} → {f.egreso?.slice(0, 5) || "sin egreso"}</div>
                      {f.horas_trabajadas && <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{Number(f.horas_trabajadas).toFixed(1)}h trabajadas</div>}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, background: `${statusColor}22`, color: statusColor, fontSize: 10, fontWeight: 700 }}>{statusIcon} {statusLabel}</span>
                      {f.llegada_tarde && tardeCuenta > 0 && <div style={{ fontSize: 10, color: statusColor, marginTop: 4, fontWeight: 600 }}>Tarde #{tardeCuenta} del mes</div>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>}
      <div style={{ marginTop: 24, marginBottom: 12 }}><h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text, fontFamily: fH }}>Historial de conversaciones</h3></div>
      <button onClick={() => setShowChat(!showChat)} aria-expanded={showChat} style={{ width: "100%", padding: 14, borderRadius: 14, background: C.surface, border: `1px solid ${C.border}`, color: C.text, fontSize: 13, fontWeight: 600, fontFamily: fB, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>{showChat ? "Ocultar" : "Ver"} conversaciones ({chatHistory.length})</span><span aria-hidden="true" style={{ fontSize: 11, color: C.dim }}>{showChat ? "▲" : "▼"}</span>
      </button>
      {showChat && <div role="log" aria-label="Historial de conversaciones" style={{ marginTop: 10, background: C.surface, borderRadius: 14, padding: 14, border: `1px solid ${C.border}`, maxHeight: 400, overflowY: "auto" }}>
        {chatHistory.length === 0 ? <div style={{ textAlign: "center", color: C.dim, fontSize: 13, padding: 16 }}>Sin conversaciones</div> :
          chatHistory.map((m, i) => <div key={i} style={{ display: "flex", justifyContent: m.rol === "user" ? "flex-end" : "flex-start", marginBottom: 8 }}>
            <div style={{ maxWidth: "80%", padding: "8px 12px", borderRadius: m.rol === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px", background: m.rol === "user" ? `${C.amber}30` : C.surfHi, fontSize: 12, color: C.text, lineHeight: 1.4 }}>
              <div style={{ whiteSpace: "pre-wrap" }}>{m.mensaje}</div>
              <div style={{ fontSize: 9, color: C.mute, marginTop: 4, textAlign: m.rol === "user" ? "right" : "left" }}>{new Date(m.created_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>
            </div>
          </div>)}
      </div>}
    </section>
  );
}
