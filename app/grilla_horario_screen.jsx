import { useState, useEffect, useCallback } from "react";
import { C, fH, fB, fM, DIAS_KEY } from "./lib/theme";
import { sb } from "./lib/supabase";

/* ═══ CONSTANTES ═══ */
const DIAS_LABELS = {
  lun: "Lunes", mar: "Martes", mie: "Miércoles",
  jue: "Jueves", vie: "Viernes", sab: "Sábado", dom: "Domingo",
};
const DIAS_SEMANA = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
const DEFAULT_IN = "08:30";
const DEFAULT_OUT = "17:30";

/* ═══ PRIMITIVAS ═══ */
const Tag = ({ color = C.amber, children, style = {} }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, background: `${color}22`, color, fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", fontFamily: fB, ...style }}>{children}</span>
);

const Chip = ({ active, onClick, children, color = C.amber }) => (
  <button onClick={onClick} style={{
    padding: "8px 14px", borderRadius: 20, border: "none", cursor: "pointer",
    background: active ? `${color}22` : C.surface,
    color: active ? color : C.dim,
    fontSize: 12, fontWeight: 700, fontFamily: fB, whiteSpace: "nowrap",
    transition: "all 0.15s",
  }}>{children}</button>
);

/* ═══ COMPONENTE PRINCIPAL ═══ */
export default function GrillaHorarioScreen() {
  const [empleados, setEmpleados] = useState([]);
  const [grilla, setGrilla] = useState({});       // { empleado_id: { lun: {in,out}|null, mar: ... } }
  const [original, setOriginal] = useState({});    // copia para detectar cambios
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [filter, setFilter] = useState("todos");   // todos | con-cambios
  const [expandedId, setExpandedId] = useState(null);

  // ── Cargar empleados activos ──
  const cargarDatos = useCallback(async () => {
    setLoading(true);
    try {
      const emps = await sb.get("empleados?activo=eq.true&order=nombre.asc&select=id,nombre,apodo,legajo,area,division,rol,diagrama,horas_semanales");
      setEmpleados(emps || []);

      // Armar grilla desde diagrama existente
      const g = {};
      const o = {};
      (emps || []).forEach(e => {
        const diag = e.diagrama || {};
        const row = {};
        DIAS_SEMANA.forEach(d => {
          row[d] = diag[d] ? { in: diag[d].in || DEFAULT_IN, out: diag[d].out || DEFAULT_OUT } : null;
        });
        g[e.id] = row;
        o[e.id] = JSON.parse(JSON.stringify(row));
      });
      setGrilla(g);
      setOriginal(o);
    } catch (err) {
      console.error("Error cargando empleados:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargarDatos(); }, [cargarDatos]);

  // ── Helpers ──
  const tienesCambios = (empId) => JSON.stringify(grilla[empId]) !== JSON.stringify(original[empId]);
  const totalCambios = empleados.filter(e => tienesCambios(e.id)).length;

  const setHorario = (empId, dia, campo, valor) => {
    setGrilla(prev => {
      const copy = { ...prev };
      const row = { ...copy[empId] };
      if (!row[dia]) row[dia] = { in: DEFAULT_IN, out: DEFAULT_OUT };
      row[dia] = { ...row[dia], [campo]: valor };
      copy[empId] = row;
      return copy;
    });
  };

  const toggleFranco = (empId, dia) => {
    setGrilla(prev => {
      const copy = { ...prev };
      const row = { ...copy[empId] };
      row[dia] = row[dia] ? null : { in: DEFAULT_IN, out: DEFAULT_OUT };
      copy[empId] = row;
      return copy;
    });
  };

  const aplicarDefault = (empId) => {
    setGrilla(prev => {
      const copy = { ...prev };
      const row = {};
      DIAS_SEMANA.forEach(d => {
        row[d] = (d === "sab" || d === "dom") ? null : { in: DEFAULT_IN, out: DEFAULT_OUT };
      });
      copy[empId] = row;
      return copy;
    });
  };

  const copiarDesde = (empIdOrigen, empIdDestino) => {
    setGrilla(prev => {
      const copy = { ...prev };
      copy[empIdDestino] = JSON.parse(JSON.stringify(copy[empIdOrigen]));
      return copy;
    });
  };

  const aplicarDefaultATodos = () => {
    setGrilla(prev => {
      const copy = { ...prev };
      empleados.forEach(e => {
        if (e.rol !== "gerencia" && e.rol !== "admin") {
          const row = {};
          DIAS_SEMANA.forEach(d => {
            row[d] = (d === "sab" || d === "dom") ? null : { in: DEFAULT_IN, out: DEFAULT_OUT };
          });
          copy[e.id] = row;
        }
      });
      return copy;
    });
  };

  // ── Calcular horas semanales de un empleado ──
  const calcHorasSemanales = (empId) => {
    const row = grilla[empId];
    if (!row) return 0;
    let total = 0;
    DIAS_SEMANA.forEach(d => {
      if (row[d]) {
        const [hIn, mIn] = row[d].in.split(":").map(Number);
        const [hOut, mOut] = row[d].out.split(":").map(Number);
        total += (hOut * 60 + mOut - hIn * 60 - mIn) / 60;
      }
    });
    return Math.max(0, total);
  };

  // ── Guardar y notificar ──
  const guardarYNotificar = async () => {
    const cambios = empleados.filter(e => tienesCambios(e.id));
    if (cambios.length === 0) {
      showToast("No hay cambios para guardar", C.amber);
      return;
    }

    setSaving(true);
    try {
      let exitos = 0;
      let errores = 0;

      for (const emp of cambios) {
        const row = grilla[emp.id];
        const diagrama = {};
        DIAS_SEMANA.forEach(d => {
          diagrama[d] = row[d] ? { in: row[d].in, out: row[d].out } : null;
        });

        // Calcular horas semanales
        const horas = calcHorasSemanales(emp.id);

        try {
          // Actualizar diagrama en la tabla empleados
          await sb.patch(`empleados?id=eq.${emp.id}`, {
            diagrama,
            horas_semanales: Math.round(horas),
          });

          // Crear notificación para el empleado
          await sb.post("notificaciones", {
            destinatario_rol: String(emp.legajo),
            tipo: "info",
            asunto: "📅 Horario actualizado",
            detalle: buildResumenHorario(row),
            urgencia: "normal",
          });

          // Enviar push notification
          try {
            await fetch("/api/send-push", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                legajo: String(emp.legajo),
                title: "📅 Horario actualizado",
                body: `Tu grilla horaria fue modificada. Revisá tu nuevo horario.`,
                data: { tag: "horario-update", url: "https://gi-group-app.vercel.app" },
              }),
            });
          } catch (pushErr) {
            console.warn("Push falló para", emp.legajo, pushErr);
          }

          exitos++;
        } catch (err) {
          console.error(`Error guardando ${emp.nombre}:`, err);
          errores++;
        }
      }

      // Actualizar original para reflejar estado guardado
      setOriginal(JSON.parse(JSON.stringify(grilla)));

      if (errores === 0) {
        showToast(`✅ ${exitos} horario${exitos > 1 ? "s" : ""} actualizado${exitos > 1 ? "s" : ""} y notificado${exitos > 1 ? "s" : ""}`, C.green);
      } else {
        showToast(`⚠️ ${exitos} guardados, ${errores} con error`, C.amber);
      }
    } catch (err) {
      console.error("Error guardando grilla:", err);
      showToast("Error al guardar", C.red);
    } finally {
      setSaving(false);
    }
  };

  const buildResumenHorario = (row) => {
    const partes = DIAS_SEMANA.map(d => {
      if (!row[d]) return `${d.toUpperCase()}: FRANCO`;
      return `${d.toUpperCase()}: ${row[d].in}-${row[d].out}`;
    });
    return partes.join(" · ");
  };

  const showToast = (msg, color) => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Filtrar empleados ──
  const empsFiltrados = filter === "con-cambios"
    ? empleados.filter(e => tienesCambios(e.id))
    : empleados;

  // ── Render ──
  return (
    <div style={{ fontFamily: fB, flex: 1, overflowY: "auto", padding: "0 18px 110px", position: "relative" }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)",
          zIndex: 999, padding: "12px 20px", borderRadius: 12,
          background: C.bg, border: `1px solid ${toast.color}40`,
          boxShadow: `0 8px 32px ${toast.color}20`,
          fontSize: 13, fontWeight: 600, color: toast.color,
          animation: "fadeIn 0.25s ease", maxWidth: "90%",
        }}>
          {toast.msg}
        </div>
      )}

      {/* Header info */}
      <div style={{
        background: `linear-gradient(135deg, ${C.cyan}12, ${C.surface})`,
        borderRadius: 16, padding: 16, border: `1px solid ${C.border}`, marginBottom: 14,
      }}>
        <div style={{ fontSize: 11, color: C.cyan, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          GRILLA DE HORARIOS
        </div>
        <div style={{ fontSize: 13, color: C.text, marginTop: 6, lineHeight: 1.5 }}>
          Configurá los horarios de trabajo del equipo. Al guardar, cada empleado con cambios será notificado automáticamente.
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <Tag color={C.cyan}>Horario por defecto: {DEFAULT_IN} – {DEFAULT_OUT}</Tag>
          {totalCambios > 0 && <Tag color={C.amber}>{totalCambios} cambio{totalCambios > 1 ? "s" : ""}</Tag>}
        </div>
      </div>

      {/* Acciones rápidas */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, overflowX: "auto", paddingBottom: 4 }}>
        <Chip active={filter === "todos"} onClick={() => setFilter("todos")} color={C.cyan}>
          👥 Todos ({empleados.length})
        </Chip>
        <Chip active={filter === "con-cambios"} onClick={() => setFilter("con-cambios")} color={C.amber}>
          ✏️ Con cambios ({totalCambios})
        </Chip>
        <button onClick={aplicarDefaultATodos} style={{
          padding: "8px 14px", borderRadius: 20, border: "none", cursor: "pointer",
          background: `${C.violet}22`, color: C.violet,
          fontSize: 12, fontWeight: 700, fontFamily: fB, whiteSpace: "nowrap",
        }}>
          ⚡ Default L-V a todos
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: C.dim, fontSize: 13 }}>Cargando personal...</div>
      ) : (
        <>
          {/* Lista de empleados */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {empsFiltrados.map(emp => {
              const isExpanded = expandedId === emp.id;
              const changed = tienesCambios(emp.id);
              const horas = calcHorasSemanales(emp.id);
              const row = grilla[emp.id] || {};
              const diasActivos = DIAS_SEMANA.filter(d => row[d]).length;

              return (
                <div key={emp.id} style={{
                  background: C.surface, borderRadius: 14,
                  border: `1px solid ${changed ? `${C.amber}40` : C.border}`,
                  overflow: "hidden", transition: "border-color 0.2s",
                }}>
                  {/* Fila colapsada */}
                  <button onClick={() => setExpandedId(isExpanded ? null : emp.id)} style={{
                    width: "100%", padding: 14, background: "transparent", border: "none",
                    cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                    fontFamily: fB, textAlign: "left",
                  }}>
                    <div style={{
                      width: 38, height: 38, borderRadius: 10,
                      background: emp.rol === "gerencia" ? C.violetS : C.cyanS,
                      color: emp.rol === "gerencia" ? C.violet : C.cyan,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontFamily: fH, fontSize: 12, fontWeight: 700, flexShrink: 0,
                    }}>
                      {(emp.nombre || "").split(" ").map(w => w[0]).slice(0, 2).join("")}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, fontWeight: 700, color: C.text,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {emp.nombre}
                      </div>
                      <div style={{ fontSize: 11, color: C.dim, marginTop: 1 }}>
                        L-{emp.legajo} · {diasActivos} días · {horas.toFixed(1)}h/sem
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {changed && <Tag color={C.amber}>Editado</Tag>}
                      <span style={{
                        color: C.dim, fontSize: 14,
                        transform: isExpanded ? "rotate(90deg)" : "rotate(0)",
                        transition: "transform 0.2s",
                      }}>▶</span>
                    </div>
                  </button>

                  {/* Mini preview de días (siempre visible) */}
                  {!isExpanded && (
                    <div style={{ padding: "0 14px 10px", display: "flex", gap: 4 }}>
                      {DIAS_SEMANA.map(d => {
                        const activo = !!row[d];
                        return (
                          <div key={d} style={{
                            flex: 1, textAlign: "center", padding: "4px 0",
                            borderRadius: 6, fontSize: 9, fontWeight: 700, fontFamily: fM,
                            background: activo ? `${C.green}15` : `${C.mute}10`,
                            color: activo ? C.green : C.mute,
                            letterSpacing: "0.05em", textTransform: "uppercase",
                          }}>
                            {d}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Panel expandido */}
                  {isExpanded && (
                    <div style={{ padding: "0 14px 14px" }}>
                      {/* Quick actions */}
                      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                        <button onClick={() => aplicarDefault(emp.id)} style={{
                          padding: "6px 12px", borderRadius: 8, border: "none",
                          background: `${C.cyan}22`, color: C.cyan,
                          fontSize: 11, fontWeight: 700, fontFamily: fB, cursor: "pointer",
                        }}>
                          🔄 Default L-V
                        </button>
                      </div>

                      {/* Grilla de días */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {DIAS_SEMANA.map(d => {
                          const activo = !!row[d];
                          return (
                            <div key={d} style={{
                              display: "flex", alignItems: "center", gap: 8,
                              padding: "8px 10px", borderRadius: 10,
                              background: activo ? `${C.green}08` : C.surfLo,
                              border: `1px solid ${activo ? `${C.green}20` : C.border}`,
                            }}>
                              {/* Día label */}
                              <div style={{
                                width: 52, fontSize: 11, fontWeight: 700, fontFamily: fH,
                                color: activo ? C.text : C.mute,
                                textTransform: "uppercase", letterSpacing: "0.04em",
                              }}>
                                {DIAS_LABELS[d].slice(0, 3)}
                              </div>

                              {/* Toggle franco */}
                              <button onClick={() => toggleFranco(emp.id, d)} style={{
                                width: 36, height: 20, borderRadius: 10, border: "none",
                                background: activo ? C.green : C.mute,
                                cursor: "pointer", position: "relative", transition: "background 0.2s",
                                flexShrink: 0,
                              }}>
                                <div style={{
                                  width: 16, height: 16, borderRadius: 8, background: "#fff",
                                  position: "absolute", top: 2,
                                  left: activo ? 18 : 2,
                                  transition: "left 0.2s",
                                }} />
                              </button>

                              {activo ? (
                                <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                                  <input
                                    type="time"
                                    value={row[d].in}
                                    onChange={e => setHorario(emp.id, d, "in", e.target.value)}
                                    style={{
                                      background: C.surfHi, border: `1px solid ${C.border}`,
                                      borderRadius: 8, padding: "5px 8px", color: C.text,
                                      fontSize: 13, fontFamily: fM, fontWeight: 600,
                                      outline: "none", width: 90,
                                    }}
                                  />
                                  <span style={{ color: C.dim, fontSize: 12, fontWeight: 700 }}>→</span>
                                  <input
                                    type="time"
                                    value={row[d].out}
                                    onChange={e => setHorario(emp.id, d, "out", e.target.value)}
                                    style={{
                                      background: C.surfHi, border: `1px solid ${C.border}`,
                                      borderRadius: 8, padding: "5px 8px", color: C.text,
                                      fontSize: 13, fontFamily: fM, fontWeight: 600,
                                      outline: "none", width: 90,
                                    }}
                                  />
                                </div>
                              ) : (
                                <span style={{ fontSize: 12, color: C.mute, fontWeight: 600 }}>FRANCO</span>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Resumen */}
                      <div style={{
                        marginTop: 10, padding: "8px 10px", borderRadius: 8,
                        background: C.surfLo, display: "flex", justifyContent: "space-between",
                        alignItems: "center", fontSize: 11,
                      }}>
                        <span style={{ color: C.dim }}>
                          {diasActivos} días laborales · <span style={{ fontFamily: fM, fontWeight: 700, color: horas >= 40 ? C.green : C.amber }}>{horas.toFixed(1)}h</span>/semana
                        </span>
                        {changed && <Tag color={C.amber} style={{ fontSize: 9 }}>Sin guardar</Tag>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {empsFiltrados.length === 0 && (
            <div style={{
              background: C.surface, borderRadius: 16, padding: 40,
              textAlign: "center", border: `1px solid ${C.border}`,
            }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Sin cambios pendientes</div>
              <div style={{ fontSize: 12, color: C.dim, marginTop: 6 }}>
                Todos los horarios están al día
              </div>
            </div>
          )}

          {/* Botón guardar flotante */}
          {totalCambios > 0 && (
            <div style={{
              position: "fixed", bottom: 100, left: "50%", transform: "translateX(-50%)",
              zIndex: 50, maxWidth: 440, width: "calc(100% - 36px)",
            }}>
              <button onClick={guardarYNotificar} disabled={saving} style={{
                width: "100%", padding: 16, borderRadius: 16, border: "none",
                background: saving ? C.surface : `linear-gradient(135deg, ${C.amber}, ${C.violet})`,
                color: saving ? C.dim : "#000",
                fontSize: 15, fontWeight: 700, fontFamily: fH,
                cursor: saving ? "default" : "pointer",
                boxShadow: `0 8px 32px ${C.amber}30`,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
                {saving ? (
                  <>
                    <span style={{ animation: "spin 1s linear infinite", display: "inline-flex" }}>⏳</span>
                    Guardando y notificando...
                  </>
                ) : (
                  <>
                    📤 Guardar y notificar {totalCambios} empleado{totalCambios > 1 ? "s" : ""}
                  </>
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
