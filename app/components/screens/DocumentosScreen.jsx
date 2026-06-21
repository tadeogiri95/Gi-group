"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch, getToken } from "../../lib/supabase";
import { useToast } from "../ui/Toast";
import EmptyState from "../ui/EmptyState";

const GREEN = "#16A34A";
const RED = "#DC2626";
const CYAN = "#0891B2";
const AMBER = "var(--color-empresa-primary, #F97316)";

const ACCEPT_POR_FORMATO = {
  pdf: "application/pdf",
  image: "image/png,image/jpeg,image/webp",
  word: "application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export default function DocumentosScreen() {
  const [exigidos, setExigidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subiendoId, setSubiendoId] = useState(null);
  const fileRefs = useRef({});
  const toast = useToast();

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/documentos/mis-documentos");
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Error");
      setExigidos(data.exigidos || []);
    } catch (err) { console.error(err); }
    setLoading(false);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const onFile = async (tipo, file) => {
    if (!file) return;
    setSubiendoId(tipo.id);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("tipo_documento_id", tipo.id);
      const token = getToken();
      const res = await fetch("/api/documentos/upload", {
        method: "POST",
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Error al subir");
      toast.show("✅ Documento subido", GREEN);
      await cargar();
    } catch (err) {
      toast.show(`Error: ${err.message}`, RED);
    }
    setSubiendoId(null);
  };

  const ver = async (documentoId) => {
    try {
      const res = await apiFetch("/api/documentos/sign-url", { method: "POST", body: JSON.stringify({ documento_id: documentoId }) });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Error");
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) { toast.show(`Error: ${err.message}`, RED); }
  };

  const cargadosCount = exigidos.filter((e) => (e.documentos || []).some((d) => d.estado === "cargado")).length;

  return (
    <div className="g-fade-in flex-1 overflow-y-auto px-4 pb-[110px]">
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="g-card text-center">
          <div className="g-overline">Cargados</div>
          <div className="font-heading text-[26px] font-bold text-gypi-green mt-0.5">{cargadosCount}</div>
        </div>
        <div className="g-card text-center">
          <div className="g-overline">Exigidos</div>
          <div className="font-heading text-[26px] font-bold text-gypi-amber mt-0.5">{exigidos.length}</div>
        </div>
      </div>

      {loading ? (
        <div className="gypi-dots"><span style={{ background: AMBER }} /><span style={{ background: AMBER }} /><span style={{ background: AMBER }} /></div>
      ) : exigidos.length === 0 ? (
        <div className="bg-gypi-surface rounded-[14px] border border-gypi-border">
          <EmptyState icon="inbox" title="Sin documentos exigidos" description="Cuando gerencia te exija un documento, aparecerá acá." color={CYAN} style={{ padding: "28px 16px" }} />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {exigidos.map((tipo) => {
            const docsCargados = (tipo.documentos || []).filter((d) => d.estado === "cargado");
            const docRechazado = (tipo.documentos || []).find((d) => d.estado === "rechazado");
            const tieneDoc = docsCargados.length > 0;
            const subiendo = subiendoId === tipo.id;
            const accept = (tipo.formatos_aceptados || []).map((f) => ACCEPT_POR_FORMATO[f]).filter(Boolean).join(",");
            const labelBoton = subiendo ? "Subiendo..." : !tieneDoc ? "📤 Subir" : tipo.admite_multiples ? "📤 Subir otro" : "🔄 Reemplazar";

            return (
              <div key={tipo.id} className="bg-gypi-surface rounded-2xl p-3.5 border border-gypi-border">
                <div className="flex items-center gap-2.5 mb-2.5">
                  <div className="w-9 h-9 rounded-[10px] flex items-center justify-center text-base shrink-0" style={{ background: tieneDoc ? `${GREEN}18` : `${RED}18` }}>
                    {tieneDoc ? "✅" : "📄"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold text-gypi-text truncate">{tipo.nombre}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: tieneDoc ? "var(--color-text-dim)" : RED }}>
                      {docRechazado ? "Rechazado — volvé a subirlo" : tieneDoc ? `Cargado${docsCargados.length > 1 ? ` (${docsCargados.length})` : ""}` : "Falta cargar"}
                    </div>
                  </div>
                </div>

                {docsCargados.length > 0 && (
                  <div className="flex flex-col gap-1 mb-2.5">
                    {docsCargados.map((d) => (
                      <button key={d.id} onClick={() => ver(d.id)} className="flex items-center justify-between py-2 px-2.5 rounded-lg border-none bg-gypi-cyan/10 text-gypi-cyan text-[11px] font-semibold cursor-pointer text-left">
                        <span className="truncate">{d.nombre_archivo || "Ver documento"}</span>
                        <span>⬇</span>
                      </button>
                    ))}
                  </div>
                )}

                <input
                  ref={(el) => { fileRefs.current[tipo.id] = el; }}
                  type="file"
                  accept={accept}
                  hidden
                  onChange={(e) => { onFile(tipo, e.target.files?.[0]); e.target.value = ""; }}
                />
                <button
                  onClick={() => fileRefs.current[tipo.id]?.click()}
                  disabled={subiendo}
                  className="w-full py-2.5 rounded-lg border-none text-[11px] font-bold cursor-pointer min-h-[40px]"
                  style={{ background: subiendo ? "var(--color-surf-hi)" : `${AMBER}18`, color: subiendo ? "var(--color-text-dim)" : AMBER }}
                >
                  {labelBoton}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
