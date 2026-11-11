"use client";
// Más → 🔐 Accesos (migración 181): el titular de la cuenta elige qué módulos
// ve cada persona de la oficina y quién puede cambiar las configuraciones.
// Reglas en app/lib/accesos.js; lo guarda /api/accesos.
import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/supabase";
import { Spinner, Chip } from "../ui";

const ROL = { gerencial: "Dueño", administrativo: "Administración" };
const rolDe = (p) => (p.supervisor ? "Supervisor" : ROL[p.rol] || p.rol);

export default function AccesosScreen() {
  const [datos, setDatos] = useState(null);
  const [guardando, setGuardando] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    apiFetch("/api/accesos")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok) throw new Error(d.error || "No se pudieron leer los accesos");
        setDatos(d);
      })
      .catch((e) => { if (vivo) { setError(e.message); setDatos({ personas: [], modulos: [] }); } });
    return () => { vivo = false; };
  }, []);

  const guardar = async (persona, cambio) => {
    setGuardando(persona.id);
    setError("");
    try {
      const r = await apiFetch("/api/accesos", { method: "PATCH", body: JSON.stringify({ empleado_id: persona.id, ...cambio }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudo guardar");
      setDatos(d);
    } catch (e) {
      setError(e.message);
    }
    setGuardando(null);
  };

  const alternarModulo = (p, id) => {
    const ocultos = p.ocultos.includes(id) ? p.ocultos.filter((m) => m !== id) : [...p.ocultos, id];
    guardar(p, { modulos_ocultos: ocultos });
  };

  const pasarTitularidad = (p) => {
    const ok = typeof window === "undefined" || window.confirm(`¿Pasar la titularidad de la cuenta a ${p.nombre}? Desde ese momento los accesos los da esa persona. Vos vas a seguir viendo todo y configurando.`);
    if (ok) guardar(p, { titular: true });
  };

  if (!datos) return <div className="flex-1 flex items-center justify-center py-10"><Spinner /></div>;

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-[110px] flex flex-col gap-3">
      <p className="m-0 text-[13px] text-gypi-dim">
        Elegí qué módulos ve cada persona de la oficina y quién puede cambiar las configuraciones. Lo que no tiene tildado no le aparece y no lo puede abrir. Los operarios no cambian: siguen viendo lo suyo.
      </p>
      {error && <div role="alert" className="text-[13px] text-gypi-red">{error}</div>}
      {datos.personas.map((p) => (
        <section key={p.id} aria-label={p.nombre} className="g-card flex flex-col gap-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-gypi-text">{p.nombre}</div>
              <div className="text-[12px] text-gypi-dim mt-0.5">{rolDe(p)}{p.legajo != null ? ` · Legajo ${p.legajo}` : ""}</div>
            </div>
            {p.titular && <span className="shrink-0 text-[12px] font-bold text-gypi-amber-ink">⭐ Titular</span>}
          </div>

          {p.titular ? (
            <p className="m-0 text-[13px] text-gypi-dim">Ve todos los módulos, cambia las configuraciones y da los accesos.</p>
          ) : (
            <>
              <button
                type="button"
                role="switch"
                aria-checked={p.puede_configurar}
                aria-label={`${p.nombre}: puede cambiar configuraciones`}
                onClick={() => guardar(p, { puede_configurar: !p.puede_configurar })}
                disabled={guardando !== null}
                className={`min-h-[44px] px-3 rounded-lg border-none text-[13px] font-bold cursor-pointer text-left ${p.puede_configurar ? "bg-gypi-green/15 text-gypi-green" : "bg-gypi-surface text-gypi-dim"}`}
              >
                {guardando === p.id ? "Guardando…" : p.puede_configurar ? "✓ Puede cambiar configuraciones" : "Solo mira la configuración"}
              </button>
              <div>
                <div className="text-[12px] text-gypi-dim mb-1.5">Módulos que ve (tocá para mostrar u ocultar)</div>
                <div className="flex flex-wrap gap-1.5">
                  {datos.modulos.map((m) => {
                    const bloqueado = m.solo_dueno && p.rol !== "gerencial";
                    const ve = !p.ocultos.includes(m.id) && !bloqueado;
                    return (
                      <Chip
                        key={m.id}
                        active={ve}
                        aria-label={`${m.nombre}: ${ve ? "lo ve" : "oculto"}`}
                        title={bloqueado ? `${m.nombre} es solo para Dueños` : undefined}
                        disabled={guardando !== null || bloqueado}
                        onClick={() => alternarModulo(p, m.id)}
                      >
                        {ve ? "✓ " : ""}{m.nombre}{bloqueado ? " 🔒" : ""}
                      </Chip>
                    );
                  })}
                </div>
                {datos.modulos.some((m) => m.solo_dueno) && p.rol !== "gerencial" && (
                  <div className="text-[12px] text-gypi-dim mt-1.5">Finanzas solo se puede dar a un Dueño.</div>
                )}
              </div>
              {p.rol === "gerencial" && (
                <button type="button" className="g-btn g-btn-secondary self-start" disabled={guardando !== null} onClick={() => pasarTitularidad(p)}>
                  Pasarle la titularidad
                </button>
              )}
            </>
          )}
        </section>
      ))}
      {datos.personas.length === 0 && !error && <p className="m-0 text-[13px] text-gypi-dim">Todavía no hay otras personas de la oficina.</p>}
    </div>
  );
}
