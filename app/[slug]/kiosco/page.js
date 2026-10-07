"use client";
// /{slug}/kiosco — Modo kiosco (D7, D11, ítem 19). Ver components/screens/KioscoScreen.jsx.
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import KioscoScreen from "../../components/screens/KioscoScreen";
import { setColoresEmpresa } from "../../lib/theme";

export default function KioscoPage() {
  const { slug } = useParams();
  const [estado, setEstado] = useState(null); // null = cargando

  useEffect(() => {
    fetch("/api/kiosco", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d?.empresa) setColoresEmpresa(d.empresa);
        setEstado(d);
      })
      .catch(() => setEstado({ activo: false, error: true }));
  }, []);

  if (!estado) return <main className="min-h-dvh flex items-center justify-center text-gypi-dim">Cargando…</main>;

  if (!estado.activo || (estado.empresa?.slug && estado.empresa.slug !== slug)) {
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center px-6 text-center bg-gypi-bg">
        <h1 className="text-2xl font-bold text-gypi-text mb-3">Este dispositivo no es un kiosco</h1>
        <p className="text-gypi-dim max-w-[380px] mb-6">
          {estado.error
            ? "No se pudo conectar. Revisá internet y recargá la página."
            : "Para usarlo como punto de fichaje, un gerente tiene que entrar en este dispositivo y tocar “Activar modo kiosco” en Gestión de personal."}
        </p>
        <a href={`/${slug}`} className="min-h-[48px] px-6 py-3 rounded-xl bg-gypi-surface border border-gypi-border text-gypi-text font-bold no-underline">Ir al ingreso</a>
      </main>
    );
  }

  return <KioscoScreen empresa={estado.empresa} slug={slug} />;
}
