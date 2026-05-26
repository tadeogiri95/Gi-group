"use client";
import { useState, useEffect, useRef } from "react";
import { C, fH, fB, fM } from "./lib/theme";
import sb from "./lib/supabase";

// ═══════════════════════════════════════════════════════════
// FASE 5.3 — Panel Admin con Divisiones, Etapas, Logo y Colores
// Reemplaza el admin_empresa_screen.jsx de la Fase 5.2
// ═══════════════════════════════════════════════════════════

const EMOJIS = ["🔥","🪵","🪟","🏭","⚡","🔧","✂️","🎨","🏗️","✅","📦","🔨","🛠️","⚙️","🧱","🪨","🔩","📐","🪚","🧪","🚚","📋","💡","🔌","🪣","🧹","🏠","🪜","🔑","🪤"];
const COLORS = ["#F97316","#EF4444","#22C55E","#3B82F6","#8B5CF6","#06B6D4","#EC4899","#A3E635","#F59E0B","#14B8A6","#6366F1","#D946EF"];

export default function AdminEmpresaScreen({ empresa, empresaId, onUpdate }) {
  const [tab, setTab] = useState("general");
  const [form, setForm] = useState({ nombre: "", nombre_corto: "", rubro: "" });
  const [colores, setColores] = useState({ color_primario: "#F97316", color_secundario: "#8B5CF6" });
  const [prompts, setPrompts] = useState({ prompt_ia_obra: "", prompt_ia_chat: "" });
  const [divisiones, setDivisiones] = useState([]);
  const [etapas, setEtapas] = useState([]);
  const [logoUrl, setLogoUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [stats, setStats] = useState({ empleados: 0, plan: "free", maxEmpleados: 10 });
  const [editingDiv, setEditingDiv] = useState(null);
  const [editingEtapa, setEditingEtapa] = useState(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(null);
  const [showColorPicker, setShowColorPicker] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!empresa) return;
    setForm({ nombre: empresa.nombre || "", nombre_corto: empresa.nombre_corto || "", rubro: empresa.rubro || "" });
    setColores({ color_primario: empresa.color_primario || "#F97316", color_secundario: empresa.color_secundario || "#8B5CF6" });
    setPrompts({ prompt_ia_obra: empresa.prompt_ia_obra || "", prompt_ia_chat: empresa.prompt_ia_chat || "" });
    setLogoUrl(empresa.logo_url || "");
    loadConfig();
    loadStats();
  }, [empresa]);

  const loadConfig = async () => {
    try {
      const res = await fetch(`/api/config-empresa?empresa_id=${empresaId}`);
      const data = await res.json();
      if (data.divisiones) setDivisiones(data.divisiones);
      if (data.etapas) setEtapas(data.etapas);
    } catch (e) { console.error(e); }
  };

  const loadStats = async () => {
    try {
      const emps = await sb.get(`empleados?empresa_id=eq.${empresaId}&activo=eq.true&select=id`);
      setStats({ empleados: emps?.length || 0, plan: empresa?.plan || "free", maxEmpleados: empresa?.max_empleados || 10 });
    } catch (e) { console.error(e); }
  };

  const showMsg = (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };

  const guardarGeneral = async () => {
    setLoading(true);
    try {
      await sb.patch(`empresa?id=eq.${empresaId}`, form);
      showMsg("✅ Guardado");
      if (onUpdate) onUpdate({ ...empresa, ...form });
    } catch (e) { showMsg("❌ " + e.message); }
    setLoading(false);
  };

  const guardarColores = async () => {
    setLoading(true);
    try {
      await sb.patch(`empresa?id=eq.${empresaId}`, colores);
      showMsg("✅ Colores guardados");
      if (onUpdate) onUpdate({ ...empresa, ...colores });
    } catch (e) { showMsg("❌ " + e.message); }
    setLoading(false);
  };

  const guardarPrompts = async () => {
    setLoading(true);
    try {
      await sb.patch(`empresa?id=eq.${empresaId}`, prompts);
      showMsg("✅ Prompts actualizados");
      if (onUpdate) onUpdate({ ...empresa, ...prompts });
    } catch (e) { showMsg("❌ " + e.message); }
    setLoading(false);
  };

  // ─── Divisiones CRUD ───
  const addDivision = async () => {
    const maxOrden = divisiones.reduce((m, d) => Math.max(m, d.orden || 0), 0);
    try {
      const res = await fetch("/api/config-empresa", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_division", empresa_id: empresaId, clave: `div_${Date.now()}`, label: "Nueva división", icon: "📦", color: "#F97316", orden: maxOrden + 1 }),
      });
      const data = await res.json();
      if (data.division) { setDivisiones([...divisiones, data.division]); setEditingDiv(data.division.id); }
    } catch (e) { showMsg("❌ " + e.message); }
  };

  const updateDivision = async (div) => {
    try {
      await fetch("/api/config-empresa", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_division", id: div.id, label: div.label, icon: div.icon, color: div.color, clave: div.clave }),
      });
      showMsg("✅"); setEditingDiv(null);
      if (onUpdate) onUpdate({ ...empresa, _divChanged: Date.now() });
    } catch (e) { showMsg("❌ " + e.message); }
  };

  const deleteDivision = async (id) => {
    if (!confirm("¿Eliminar esta división?")) return;
    try {
      await fetch(`/api/config-empresa?type=division&id=${id}`, { method: "DELETE" });
      setDivisiones(divisiones.filter(d => d.id !== id));
      showMsg("✅ Eliminada");
      if (onUpdate) onUpdate({ ...empresa, _divChanged: Date.now() });
    } catch (e) { showMsg("❌ " + e.message); }
  };

  // ─── Etapas CRUD ───
  const addEtapa = async () => {
    const maxCodigo = etapas.reduce((m, e) => Math.max(m, e.codigo || 0), 0);
    const maxOrden = etapas.reduce((m, e) => Math.max(m, e.orden || 0), 0);
    try {
      const res = await fetch("/api/config-empresa", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_etapa", empresa_id: empresaId, codigo: maxCodigo + 1, nombre: "Nueva etapa", icon: "🔨", color: "#F97316", orden: maxOrden + 1 }),
      });
      const data = await res.json();
      if (data.etapa) { setEtapas([...etapas, data.etapa]); setEditingEtapa(data.etapa.id); }
    } catch (e) { showMsg("❌ " + e.message); }
  };

  const updateEtapa = async (etapa) => {
    try {
      await fetch("/api/config-empresa", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_etapa", id: etapa.id, nombre: etapa.nombre, icon: etapa.icon, color: etapa.color, codigo: etapa.codigo }),
      });
      showMsg("✅"); setEditingEtapa(null);
      if (onUpdate) onUpdate({ ...empresa, _etapaChanged: Date.now() });
    } catch (e) { showMsg("❌ " + e.message); }
  };

  const deleteEtapa = async (id) => {
    if (!confirm("¿Eliminar esta etapa?")) return;
    try {
      await fetch(`/api/config-empresa?type=etapa&id=${id}`, { method: "DELETE" });
      setEtapas(etapas.filter(e => e.id !== id));
      showMsg("✅ Eliminada");
      if (onUpdate) onUpdate({ ...empresa, _etapaChanged: Date.now() });
    } catch (e) { showMsg("❌ " + e.message); }
  };

  // ─── Logo ───
  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("empresa_id", empresaId);
      const res = await fetch("/api/upload-logo", { method: "POST", body: fd });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setLogoUrl(data.logo_url);
      showMsg("✅ Logo actualizado");
      if (onUpdate) onUpdate({ ...empresa, logo_url: data.logo_url });
    } catch (err) { showMsg("❌ " + err.message); }
    setLoading(false);
    e.target.value = "";
  };

  // ─── Estilos ───
  const S = {
    wrap: { fontFamily: fB, padding: 16, maxWidth: 600, margin: "0 auto" },
    card: { background: C.surface, borderRadius: 16, padding: 16, border: `1px solid ${C.border}`, marginBottom: 12 },
    label: { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.dim, marginBottom: 8 },
    input: { width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 14, fontFamily: fB, outline: "none", boxSizing: "border-box", marginBottom: 8 },
    textarea: { width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13, fontFamily: fM, outline: "none", minHeight: 100, resize: "vertical", boxSizing: "border-box" },
    btn: { padding: "12px 20px", borderRadius: 12, border: "none", background: C.amber, color: "#000", fontSize: 14, fontWeight: 700, fontFamily: fB, cursor: "pointer", width: "100%" },
    btnSm: { padding: "8px 14px", borderRadius: 10, border: "none", background: `${C.amber}22`, color: C.amber, fontSize: 12, fontWeight: 700, fontFamily: fB, cursor: "pointer" },
    btnDanger: { padding: "6px 10px", borderRadius: 8, border: "none", background: `${C.red}15`, color: C.red, fontSize: 11, fontWeight: 700, cursor: "pointer" },
    row: { display: "flex", alignItems: "center", gap: 8 },
    itemCard: { background: C.bg, borderRadius: 12, padding: 12, border: `1px solid ${C.border}`, marginBottom: 8 },
  };

  const tabs = [
    ["general", "⚙️ General"],
    ["colores", "🎨 Colores"],
    ["divisiones", "🏭 Divisiones"],
    ["etapas", "🔨 Etapas"],
    ["logo", "📷 Logo"],
    ["prompts", "🤖 IA"],
    ["plan", "💳 Plan"],
  ];

  const EmojiPicker = ({ onSelect }) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: 8, background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, maxWidth: 280 }}>
      {EMOJIS.map(e => (
        <button key={e} onClick={() => { onSelect(e); setShowEmojiPicker(null); }} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", padding: 4, borderRadius: 6 }}>{e}</button>
      ))}
    </div>
  );

  const ColorPicker = ({ current, onSelect }) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: 8, background: C.surface, borderRadius: 12, border: `1px solid ${C.border}` }}>
      {COLORS.map(c => (
        <button key={c} onClick={() => { onSelect(c); setShowColorPicker(null); }} style={{ width: 28, height: 28, borderRadius: 8, background: c, border: c === current ? "3px solid #fff" : "2px solid transparent", cursor: "pointer", boxShadow: c === current ? `0 0 0 2px ${c}` : "none" }} />
      ))}
    </div>
  );

  const EditableItem = ({ item, type, isEditing, onEdit, onSave, onDelete }) => {
    const isDiv = type === "division";
    const nameField = isDiv ? "label" : "nombre";

    if (!isEditing) {
      return (
        <div style={{ ...S.itemCard, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: `${item.color}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{item.icon}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{item[nameField]}</div>
            <div style={{ fontSize: 11, color: C.dim }}>{isDiv ? `Clave: ${item.clave}` : `Código: ${item.codigo}`}</div>
          </div>
          <button onClick={onEdit} style={{ ...S.btnSm, padding: "6px 10px", fontSize: 11 }}>✏️</button>
          <button onClick={onDelete} style={S.btnDanger}>🗑️</button>
        </div>
      );
    }

    return (
      <div style={{ ...S.itemCard, border: `2px solid ${C.amber}50` }}>
        <div style={{ ...S.row, marginBottom: 8 }}>
          <button onClick={() => setShowEmojiPicker(showEmojiPicker === item.id ? null : item.id)} style={{ width: 40, height: 40, borderRadius: 10, background: `${item.color}22`, border: `2px dashed ${C.amber}50`, fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>{item.icon}</button>
          <input value={item[nameField]} onChange={(e) => {
            const updated = { ...item, [nameField]: e.target.value };
            if (isDiv) setDivisiones(divisiones.map(d => d.id === item.id ? updated : d));
            else setEtapas(etapas.map(et => et.id === item.id ? updated : et));
          }} style={{ ...S.input, marginBottom: 0, flex: 1 }} placeholder={isDiv ? "Nombre de la división" : "Nombre de la etapa"} />
        </div>
        {showEmojiPicker === item.id && (
          <div style={{ marginBottom: 8 }}>
            <EmojiPicker onSelect={(emoji) => {
              const updated = { ...item, icon: emoji };
              if (isDiv) setDivisiones(divisiones.map(d => d.id === item.id ? updated : d));
              else setEtapas(etapas.map(et => et.id === item.id ? updated : et));
            }} />
          </div>
        )}
        <div style={{ ...S.row, marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: C.dim, minWidth: 40 }}>Color:</span>
          <button onClick={() => setShowColorPicker(showColorPicker === item.id ? null : item.id)} style={{ width: 28, height: 28, borderRadius: 8, background: item.color, border: `2px solid ${C.border}`, cursor: "pointer" }} />
          {!isDiv && (
            <>
              <span style={{ fontSize: 11, color: C.dim, marginLeft: 8 }}>Código:</span>
              <input type="number" value={item.codigo} onChange={(e) => {
                setEtapas(etapas.map(et => et.id === item.id ? { ...et, codigo: parseInt(e.target.value) || 0 } : et));
              }} style={{ ...S.input, width: 60, marginBottom: 0, textAlign: "center" }} />
            </>
          )}
          {isDiv && (
            <>
              <span style={{ fontSize: 11, color: C.dim, marginLeft: 8 }}>Clave:</span>
              <input value={item.clave} onChange={(e) => {
                setDivisiones(divisiones.map(d => d.id === item.id ? { ...d, clave: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") } : d));
              }} style={{ ...S.input, width: 100, marginBottom: 0, fontSize: 12 }} placeholder="clave_interna" />
            </>
          )}
        </div>
        {showColorPicker === item.id && (
          <div style={{ marginBottom: 8 }}>
            <ColorPicker current={item.color} onSelect={(c) => {
              const updated = { ...item, color: c };
              if (isDiv) setDivisiones(divisiones.map(d => d.id === item.id ? updated : d));
              else setEtapas(etapas.map(et => et.id === item.id ? updated : et));
            }} />
          </div>
        )}
        <div style={{ ...S.row, justifyContent: "flex-end" }}>
          <button onClick={() => { isDiv ? setEditingDiv(null) : setEditingEtapa(null); }} style={{ ...S.btnSm, background: C.surface, color: C.dim, border: `1px solid ${C.border}` }}>Cancelar</button>
          <button onClick={() => onSave(item)} style={S.btnSm}>💾 Guardar</button>
        </div>
      </div>
    );
  };

  return (
    <div style={S.wrap}>
      <div style={{ display: "flex", gap: 4, overflowX: "auto", paddingBottom: 12, marginBottom: 4 }}>
        {tabs.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            padding: "8px 12px", borderRadius: 10, border: "none", cursor: "pointer", whiteSpace: "nowrap",
            background: tab === key ? `${C.amber}22` : "transparent",
            color: tab === key ? C.amber : C.dim, fontSize: 12, fontWeight: 700, fontFamily: fB,
          }}>{label}</button>
        ))}
      </div>

      {msg && (
        <div style={{ ...S.card, background: msg.includes("❌") ? C.redS : `${C.green}15`, border: `1px solid ${msg.includes("❌") ? C.red : C.green}33`, padding: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 13 }}>{msg}</span>
        </div>
      )}

      {tab === "general" && (<>
        <div style={S.card}>
          <div style={S.label}>Nombre de la empresa</div>
          <input style={S.input} value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Ej: Mi Empresa SRL" />
          <div style={S.label}>Nombre corto (aparece en la app)</div>
          <input style={S.input} value={form.nombre_corto} onChange={e => setForm({ ...form, nombre_corto: e.target.value })} placeholder="Ej: MiApp" />
          <div style={S.label}>Rubro</div>
          <select style={S.input} value={form.rubro} onChange={e => setForm({ ...form, rubro: e.target.value })}>
            {["industria","construcción","servicios","comercio","tecnología","salud","educación","otro"].map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase()+r.slice(1)}</option>)}
          </select>
        </div>
        <button style={{...S.btn,opacity:loading?0.5:1}} disabled={loading} onClick={guardarGeneral}>{loading?"Guardando...":"💾 Guardar"}</button>
      </>)}

      {tab === "colores" && (<>
        <div style={S.card}>
          <div style={S.label}>Color primario</div>
          <div style={{...S.row,marginBottom:12}}>
            <input type="color" value={colores.color_primario} onChange={e=>setColores({...colores,color_primario:e.target.value})} style={{width:48,height:40,border:"none",borderRadius:8,cursor:"pointer"}} />
            <input style={{...S.input,marginBottom:0,flex:1}} value={colores.color_primario} onChange={e=>setColores({...colores,color_primario:e.target.value})} />
          </div>
          <ColorPicker current={colores.color_primario} onSelect={c=>setColores({...colores,color_primario:c})} />
        </div>
        <div style={S.card}>
          <div style={S.label}>Color secundario</div>
          <div style={{...S.row,marginBottom:12}}>
            <input type="color" value={colores.color_secundario} onChange={e=>setColores({...colores,color_secundario:e.target.value})} style={{width:48,height:40,border:"none",borderRadius:8,cursor:"pointer"}} />
            <input style={{...S.input,marginBottom:0,flex:1}} value={colores.color_secundario} onChange={e=>setColores({...colores,color_secundario:e.target.value})} />
          </div>
          <ColorPicker current={colores.color_secundario} onSelect={c=>setColores({...colores,color_secundario:c})} />
        </div>
        <div style={{...S.card,background:`${colores.color_primario}12`}}>
          <div style={S.label}>Vista previa</div>
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            <div style={{width:44,height:44,borderRadius:12,background:`linear-gradient(135deg,${colores.color_primario},${colores.color_secundario})`,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:16}}>{form.nombre_corto?.[0]||"G"}</div>
            <div>
              <div style={{fontSize:15,fontWeight:700,color:colores.color_primario}}>{form.nombre_corto||"App"}</div>
              <div style={{fontSize:11,color:C.dim}}>{form.nombre||"Mi Empresa"}</div>
            </div>
          </div>
        </div>
        <button style={{...S.btn,opacity:loading?0.5:1}} disabled={loading} onClick={guardarColores}>{loading?"Guardando...":"💾 Guardar colores"}</button>
      </>)}

      {tab === "divisiones" && (<>
        <div style={{...S.card,background:`${C.cyan}08`}}>
          <div style={{fontSize:13,color:C.dim,lineHeight:1.5}}>Las divisiones son las áreas de trabajo de tu empresa (ej: Herrería, Muebles, Logística). Cada empleado se asigna a una división.</div>
        </div>
        {divisiones.map(div => (
          <EditableItem key={div.id} item={div} type="division" isEditing={editingDiv===div.id} onEdit={()=>setEditingDiv(div.id)} onSave={updateDivision} onDelete={()=>deleteDivision(div.id)} />
        ))}
        <button onClick={addDivision} style={{...S.btn,background:`${C.green}22`,color:C.green}}>＋ Agregar división</button>
      </>)}

      {tab === "etapas" && (<>
        <div style={{...S.card,background:`${C.cyan}08`}}>
          <div style={{fontSize:13,color:C.dim,lineHeight:1.5}}>Las etapas son los pasos del proceso productivo (ej: Corte, Armado, Pintura). Los operarios seleccionan una etapa al iniciar una tarea.</div>
        </div>
        {etapas.map(etapa => (
          <EditableItem key={etapa.id} item={etapa} type="etapa" isEditing={editingEtapa===etapa.id} onEdit={()=>setEditingEtapa(etapa.id)} onSave={updateEtapa} onDelete={()=>deleteEtapa(etapa.id)} />
        ))}
        <button onClick={addEtapa} style={{...S.btn,background:`${C.green}22`,color:C.green}}>＋ Agregar etapa</button>
      </>)}

      {tab === "logo" && (<>
        <div style={S.card}>
          <div style={S.label}>Logo actual</div>
          {logoUrl ? (
            <div style={{textAlign:"center",marginBottom:12}}>
              <img src={logoUrl+"?t="+Date.now()} alt="Logo" style={{maxWidth:180,maxHeight:120,borderRadius:12,border:`1px solid ${C.border}`}} />
            </div>
          ) : (
            <div style={{textAlign:"center",padding:30,color:C.dim,fontSize:13}}>Sin logo cargado</div>
          )}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={handleLogoUpload} style={{display:"none"}} />
          <button onClick={()=>fileRef.current?.click()} style={{...S.btn,opacity:loading?0.5:1}} disabled={loading}>{loading?"Subiendo...":logoUrl?"📷 Cambiar logo":"📷 Subir logo"}</button>
          <div style={{fontSize:11,color:C.dim,marginTop:8,textAlign:"center"}}>PNG, JPG, WebP o SVG · Máximo 2MB</div>
        </div>
      </>)}

      {tab === "prompts" && (<>
        <div style={S.card}>
          <div style={S.label}>Prompt para reportes de obra</div>
          <div style={{fontSize:11,color:C.dim,marginBottom:6}}>Instrucciones que recibe la IA cuando un instalador envía un reporte</div>
          <textarea style={S.textarea} value={prompts.prompt_ia_obra} onChange={e=>setPrompts({...prompts,prompt_ia_obra:e.target.value})} />
        </div>
        <div style={S.card}>
          <div style={S.label}>Prompt para chat general</div>
          <div style={{fontSize:11,color:C.dim,marginBottom:6}}>Instrucciones que recibe la IA en el chat del asistente</div>
          <textarea style={S.textarea} value={prompts.prompt_ia_chat} onChange={e=>setPrompts({...prompts,prompt_ia_chat:e.target.value})} />
        </div>
        <button style={{...S.btn,opacity:loading?0.5:1}} disabled={loading} onClick={guardarPrompts}>{loading?"Guardando...":"💾 Guardar prompts"}</button>
      </>)}

      {tab === "plan" && (<>
        <div style={S.card}>
          <div style={S.label}>Tu plan actual</div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
            <div style={{padding:"6px 14px",borderRadius:20,background:stats.plan==="enterprise"?`${C.violet}22`:stats.plan==="pro"?`${C.amber}22`:`${C.dim}22`,color:stats.plan==="enterprise"?C.violet:stats.plan==="pro"?C.amber:C.dim,fontSize:14,fontWeight:800,textTransform:"uppercase"}}>{stats.plan}</div>
          </div>
          <div style={{fontSize:13,color:C.text,lineHeight:1.6}}>Empleados: <b>{stats.empleados}</b> / {stats.maxEmpleados===-1?"∞":stats.maxEmpleados}</div>
        </div>
        <div style={{...S.card,background:`${C.cyan}08`}}>
          <div style={{fontSize:13,color:C.dim,lineHeight:1.6}}><b>Free</b>: Hasta 10 empleados, funciones básicas.{"\n"}<b>Pro</b>: Hasta 50 empleados, reportes avanzados, IA ilimitada.{"\n"}<b>Enterprise</b>: Sin límites, soporte prioritario.</div>
        </div>
      </>)}
    </div>
  );
}
