"use client";
import { C, fH, fB, fM, fmtDate, DIAS_KEY } from "../../lib/theme";
import { Ic } from "../Icons";
import SolCard from "../cards/SolCard";
import EmptyState from "../ui/EmptyState";

export default function HomeEmp({ goto, usuario, ctx, logout, empresa }) {
  const misSols = ctx.misSolicitudes || [];
  const dH = DIAS_KEY[new Date().getDay()];
  const diagH = usuario.diagrama?.[dH];

  const notisResolucion = (() => {
    const hoy = new Date().toISOString().split("T")[0];
    if (diagH) { const [hS, mS] = diagH.out.split(":").map(Number); if (new Date().getHours() * 60 + new Date().getMinutes() >= hS * 60 + mS) return []; }
    const todasResol = (ctx.notificaciones || []).filter(n => n.tipo === "aprobacion" && n.created_at?.startsWith(hoy));
    return todasResol.length > 0 ? [todasResol[0]] : [];
  })();

  return (
    <div style={{ padding: "0 18px 110px", overflowY: "auto", flex: 1 }}>
      {/* Hero card */}
      <div style={{ background: `linear-gradient(135deg,${ctx.fichadaHoy?.ingreso ? C.green : C.amber}08,${C.surface} 60%)`, borderRadius: 20, padding: 20, border: `1px solid ${ctx.fichadaHoy?.ingreso ? C.green + "30" : C.border}`, marginBottom: 16, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -50, right: -50, width: 170, height: 170, borderRadius: "50%", background: `${ctx.fichadaHoy?.ingreso ? C.green : C.amber}12`, filter: "blur(60px)" }} />
        <div style={{ position: "relative" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, color: C.dim, marginBottom: 4 }}>{fmtDate(new Date())}</div>
              <h2 style={{ margin: 0, fontFamily: fH, fontSize: 24, fontWeight: 700, color: C.text }}>Hola, {usuario.apodo}</h2>
              {diagH && <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>Jornada: <span style={{ color: C.text, fontWeight: 600 }}>{diagH.in} a {diagH.out}</span></div>}
              {!diagH && usuario.diagrama && <div style={{ fontSize: 12, color: C.green, fontWeight: 600, marginTop: 4 }}>Hoy es franco</div>}
            </div>
            <button onClick={logout} aria-label="Cerrar sesión" style={{ width: 36, height: 36, borderRadius: 10, background: C.surface, color: C.dim, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}><Ic.logout /></button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: ctx.fichadaHoy?.ingreso ? C.green : C.amber }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: ctx.fichadaHoy?.ingreso ? C.green : C.amber }}>
              {ctx.fichadaHoy?.ingreso ? `Ingreso ${ctx.fichadaHoy.ingreso.slice(0, 5)}${ctx.fichadaHoy?.egreso ? " · Egreso " + ctx.fichadaHoy.egreso.slice(0, 5) : ""}` : "Sin fichar"}
            </span>
          </div>
        </div>
      </div>

      {/* Notificaciones */}
      {notisResolucion.length > 0 && <div style={{ marginBottom: 16 }}>
        {notisResolucion.map(n => <div key={n.id} style={{ background: n.asunto?.includes("APROBADA") || n.asunto?.includes("aprobado") ? `${C.green}10` : `${C.red}10`, borderRadius: 12, padding: 12, border: `1px solid ${n.asunto?.includes("APROBADA") || n.asunto?.includes("aprobado") ? C.green + "30" : C.red + "30"}`, marginBottom: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{n.asunto}</div>
          <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>{n.detalle}</div>
        </div>)}
      </div>}

      {/* Bot CTA */}
      <button onClick={() => goto("chat")} style={{ width: "100%", padding: "16px 20px", borderRadius: 16, background: `linear-gradient(135deg,${C.amber}15,${C.violet}15)`, border: `1px solid ${C.amber}30`, cursor: "pointer", display: "flex", alignItems: "center", gap: 14, fontFamily: fB, marginBottom: 18 }}>
        <div style={{ width: 44, height: 44, borderRadius: 14, background: `linear-gradient(135deg,${C.amber},${C.violet})`, display: "flex", alignItems: "center", justifyContent: "center", color: "#000", flexShrink: 0 }}><Ic.bot /></div>
        <div style={{ flex: 1, textAlign: "left" }}><div style={{ fontSize: 14, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>Tocame para fichar ingreso, salida,</div><div style={{ fontSize: 14, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>pedir permisos o dar avisos</div></div>
        <span style={{ color: C.amber, flexShrink: 0 }}><Ic.chevR /></span>
      </button>

      {/* Historial link */}
      <button onClick={() => goto("historial-fichajes")} style={{ width: "100%", padding: 14, borderRadius: 14, background: `linear-gradient(135deg,${C.cyan}08,${C.surface})`, border: `1px solid ${C.cyan}30`, color: C.text, fontSize: 13, fontWeight: 600, fontFamily: fB, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ width: 34, height: 34, borderRadius: 10, background: `${C.cyan}22`, color: C.cyan, display: "flex", alignItems: "center", justifyContent: "center" }}>📊</div><div style={{ textAlign: "left" }}><div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Historial de fichajes</div><div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>Tardanzas, presentismo y conversaciones</div></div></div>
        <span style={{ color: C.dim }}><Ic.chevR /></span>
      </button>

      {/* Grilla semanal */}
      {usuario.diagrama && (() => {
        const DIAS_G = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
        const DIAS_LABEL = { lun: "Lunes", mar: "Martes", mie: "Miércoles", jue: "Jueves", vie: "Viernes", sab: "Sábado", dom: "Domingo" };
        const diaHoy = DIAS_KEY[new Date().getDay()];
        const diag = usuario.diagrama;
        let totalH = 0;
        DIAS_G.forEach(d => { if (diag[d]) { const [hI, mI] = diag[d].in.split(":").map(Number); const [hO, mO] = diag[d].out.split(":").map(Number); totalH += (hO * 60 + mO - hI * 60 - mI) / 60; } });
        return <>
          <div style={{ marginBottom: 12 }}><h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text, fontFamily: fH }}>Mi grilla semanal</h3></div>
          <div style={{ background: C.surface, borderRadius: 16, padding: 14, border: `1px solid ${C.border}`, marginBottom: 18 }}>
            {DIAS_G.map((d, i) => { const h = diag[d]; const esHoy = d === diaHoy; return <div key={d} style={{ display: "flex", alignItems: "center", padding: "10px 8px", borderRadius: 10, background: esHoy ? `${C.amber}12` : "transparent", border: esHoy ? `1px solid ${C.amber}30` : "1px solid transparent", marginBottom: i < 6 ? 4 : 0 }}><div style={{ width: 70, fontSize: 13, fontWeight: esHoy ? 700 : 500, color: esHoy ? C.amber : C.text, fontFamily: fH }}>{DIAS_LABEL[d]}</div>{h ? <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontFamily: fM, fontSize: 14, fontWeight: 600, color: esHoy ? C.text : C.dim }}>{h.in}</span><span style={{ color: C.mute, fontSize: 10 }}>→</span><span style={{ fontFamily: fM, fontSize: 14, fontWeight: 600, color: esHoy ? C.text : C.dim }}>{h.out}</span></div> : <div style={{ flex: 1, fontSize: 13, color: C.green, fontWeight: 600 }}>Franco</div>}{esHoy && <span style={{ fontSize: 10, color: C.amber, fontWeight: 700, background: `${C.amber}22`, padding: "2px 8px", borderRadius: 6, marginLeft: 6 }}>HOY</span>}</div>; })}
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", fontSize: 12 }}><span style={{ color: C.dim }}>{DIAS_G.filter(d => diag[d]).length} días laborales</span><span style={{ color: C.text, fontWeight: 700, fontFamily: fM }}>{totalH.toFixed(1)}h/semana</span></div>
          </div>
        </>;
      })()}

      {/* Mi semana */}
      <div style={{ marginBottom: 12 }}><h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text, fontFamily: fH }}>Mi semana</h3></div>
      <div style={{ background: C.surface, borderRadius: 16, padding: 14, border: `1px solid ${C.border}`, marginBottom: 18 }}>
        {(ctx.fichadasSemana || []).length === 0
          ? <EmptyState icon="clock" title="Sin fichadas esta semana" description="Tus registros de entrada y salida aparecerán acá." color={C.cyan} style={{ padding: "24px 16px" }} />
          : (ctx.fichadasSemana || []).map((d, i, a) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < a.length - 1 ? `1px solid ${C.border}` : "none" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{new Date(d.fecha + "T12:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" })}</div>
                {d.ingreso && <div style={{ fontSize: 11, color: C.dim, marginTop: 2, fontFamily: fM }}>{d.ingreso.slice(0, 5)} → {d.egreso ? d.egreso.slice(0, 5) : "en curso"}</div>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {d.horas_trabajadas && <span style={{ fontSize: 10, color: C.dim, fontFamily: fM }}>{Number(d.horas_trabajadas).toFixed(1)}h</span>}
                <span style={{ fontFamily: fM, fontSize: 14, fontWeight: 700, color: d.ingreso ? C.green : C.mute }}>{d.ingreso ? "✓" : "—"}</span>
              </div>
            </div>
          ))}
      </div>

      {/* Mis solicitudes */}
      <div style={{ marginBottom: 12 }}><h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text, fontFamily: fH }}>Mis solicitudes</h3></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {misSols.length === 0
          ? (
            <div style={{ background: C.surface, borderRadius: 14, border: `1px solid ${C.border}` }}>
              <EmptyState
                icon="inbox"
                title="Sin solicitudes"
                description="Cuando pidas permisos o justifiques ausencias desde el chat, aparecerán acá."
                color={C.violet}
                style={{ padding: "28px 16px" }}
              />
            </div>
          )
          : misSols.map(s => <SolCard key={s.id} s={s} />)}
      </div>
    </div>
  );
}
