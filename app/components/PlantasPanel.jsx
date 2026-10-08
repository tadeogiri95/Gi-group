"use client";
// Plantas o sedes de la empresa (ítem 36, parte 3). Arriba de "Ubicaciones":
// con una sola planta es una línea con su nombre; al sumar otra, cada persona
// y cada punto de fichaje se puede asignar a la suya.
import { useState } from "react";
import { apiFetch } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { useToast } from "./ui/Toast";
import { useConfirm } from "./ui/ConfirmDialog";
import { ordenarPlantas } from "../lib/plantas";

async function enviar(url, opts) {
  const res = await apiFetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "No se pudo guardar. Probá de nuevo.");
  return data;
}

export default function PlantasPanel() {
  const { plantas: plantasCtx, recargarConfig, usuario } = useAuth();
  const plantas = ordenarPlantas(plantasCtx);
  const toast = useToast();
  const [confirmar, ConfirmDialog] = useConfirm();
  // editando: null | { id?: string, nombre: string } — sin id es una planta nueva
  const [editando, setEditando] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const puedeEditar = usuario?.rol === "gerencial" || (usuario?.rol === "administrativo" && !usuario?.solo_su_division);

  if (plantas.length === 0) return null; // sin la migración 084 o en modo demo

  const guardar = async () => {
    const nombre = editando?.nombre?.trim();
    if (!nombre) return;
    setGuardando(true);
    try {
      if (editando.id) {
        await enviar("/api/config-empresa", { method: "PATCH", body: JSON.stringify({ action: "update_planta", id: editando.id, nombre }) });
        toast.success("Nombre actualizado");
      } else {
        await enviar("/api/config-empresa", { method: "POST", body: JSON.stringify({ action: "add_planta", nombre }) });
        toast.success(`Listo: "${nombre}" agregada. Ahora podés asignarle personas y puntos de fichaje.`);
      }
      setEditando(null);
      await recargarConfig?.();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  };

  const quitar = async (planta) => {
    const principal = plantas.find((p) => p.principal);
    const ok = await confirmar(
      `Las personas y los puntos de fichaje de "${planta.nombre}" pasan a "${principal?.nombre}".`,
      { title: `¿Quitar ${planta.nombre}?`, confirmLabel: "Quitar planta", destructive: true }
    );
    if (!ok) return;
    try {
      await enviar(`/api/config-empresa?type=planta&id=${planta.id}`, { method: "DELETE" });
      toast.success(`"${planta.nombre}" quitada`);
      await recargarConfig?.();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const formulario = (
    <div className="flex gap-2 mt-2">
      <input
        autoFocus
        aria-label={editando?.id ? "Nuevo nombre de la planta" : "Nombre de la planta nueva"}
        value={editando?.nombre || ""}
        onChange={(e) => setEditando((p) => ({ ...p, nombre: e.target.value }))}
        onKeyDown={(e) => { if (e.key === "Enter") guardar(); if (e.key === "Escape") setEditando(null); }}
        placeholder="Ej: Planta Norte, Taller Centro"
        maxLength={80}
        className="g-input flex-1"
      />
      <button onClick={guardar} disabled={guardando || !editando?.nombre?.trim()} className="g-btn g-btn-primary px-4 min-h-[48px] disabled:opacity-50">
        {guardando ? "Guardando…" : "Guardar"}
      </button>
      <button onClick={() => setEditando(null)} className="g-btn px-3 min-h-[48px]">Cancelar</button>
    </div>
  );

  return (
    <section aria-label="Plantas" className="g-card mb-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="g-overline">{plantas.length > 1 ? `Plantas (${plantas.length})` : "Planta"}</div>
        {puedeEditar && !editando && (
          <button onClick={() => setEditando({ nombre: "" })} className="text-[13px] font-bold text-gypi-text bg-transparent border-none cursor-pointer min-h-[44px] px-2">
            + Agregar planta
          </button>
        )}
      </div>

      <ul className="list-none m-0 p-0 flex flex-col gap-1">
        {plantas.map((p) => (
          <li key={p.id}>
            <div className="flex items-center gap-2 min-h-[44px]">
              <span aria-hidden="true" className="text-lg">🏭</span>
              <span className="flex-1 min-w-0 text-[14px] font-bold text-gypi-text truncate">{p.nombre}</span>
              {p.principal && plantas.length > 1 && <span className="text-[11px] text-gypi-dim">Principal</span>}
              {puedeEditar && !editando && (
                <>
                  <button onClick={() => setEditando({ id: p.id, nombre: p.nombre })} className="text-[12px] text-gypi-dim underline bg-transparent border-none cursor-pointer min-h-[44px] px-1.5">
                    Cambiar nombre
                  </button>
                  {!p.principal && (
                    <button onClick={() => quitar(p)} className="text-[12px] text-red-600 underline bg-transparent border-none cursor-pointer min-h-[44px] px-1.5">
                      Quitar
                    </button>
                  )}
                </>
              )}
            </div>
            {editando?.id === p.id && formulario}
          </li>
        ))}
      </ul>
      {editando && !editando.id && formulario}

      <p className="text-[12px] text-gypi-dim mt-2 mb-0 leading-relaxed">
        {plantas.length > 1
          ? "Cada persona ficha en los puntos de su planta. La planta de cada uno se elige en Personal."
          : "¿Trabajan en más de un lugar? Agregá otra planta y elegí dónde trabaja cada persona."}
      </p>
      {ConfirmDialog}
    </section>
  );
}
