"use client";
// Pestaña "Solicitudes" del operario (U-04): el botón para pedir arriba, a la
// vista, y un mensaje que explica qué hacer cuando todavía no pidió nada.
import { useState } from "react";
import NuevaSolicitud from "../NuevaSolicitud";
import SolCard from "../cards/SolCard";
import EmptyState from "../ui/EmptyState";
import { Button } from "../ui";

export default function MisSolicitudesScreen({ solicitudes = [], usuario, empresa, demo = false, reload }) {
  const [pidiendo, setPidiendo] = useState(false);
  const lista = solicitudes || [];

  return (
    <section aria-label="Mis solicitudes" className="px-[18px] pb-[110px] overflow-y-auto flex-1 flex flex-col gap-3">
      {pidiendo ? (
        <NuevaSolicitud
          usuario={usuario}
          empresa={empresa}
          demo={demo}
          onCerrar={() => setPidiendo(false)}
          onEnviada={() => { setPidiendo(false); reload?.(); }}
        />
      ) : (
        <Button size="planta" onClick={() => setPidiendo(true)} className="w-full">
          + Pedir permiso, vacaciones o avisar una falta
        </Button>
      )}

      {lista.length === 0 ? (
        !pidiendo && (
          <div className="bg-gypi-surface rounded-[14px] border border-gypi-border">
            <EmptyState
              icon="inbox"
              title="Todavía no pediste nada"
              description="Tocá el botón de arriba para pedir un permiso o vacaciones. Acá vas a ver si te lo aprobaron."
              color="var(--color-empresa-secondary)"
            />
          </div>
        )
      ) : (
        <div className="flex flex-col gap-2.5">
          {lista.map((s) => <SolCard key={s.id} s={s} />)}
        </div>
      )}
    </section>
  );
}
