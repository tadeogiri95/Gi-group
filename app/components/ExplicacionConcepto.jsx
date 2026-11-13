// app/components/ExplicacionConcepto.jsx — Finanzas (13/11, parte 2 del plan
// de Tesorería): qué comprende el concepto elegido, en un recuadro claro con
// el ejemplo aparte, en vez de una línea gris chica. La explicación sale de
// leyendaTipo (la de la lista o la que escribió el dueño en Configuración).

/** Separa la explicación del ejemplo ("… Ej.: …"). */
export function partesLeyenda(texto) {
  const t = String(texto || "").trim();
  const m = t.match(/^(.*?)\s*Ej(?:emplo)?\.?:\s*(.+)$/is);
  return m ? { que: m[1].trim(), ejemplo: m[2].trim() } : { que: t, ejemplo: "" };
}

/** Lo primero de la explicación, para mostrar en la lista mientras se busca. */
export function leyendaCorta(texto, max = 90) {
  const { que } = partesLeyenda(texto);
  const primera = que.split(/(?<=\.)\s/)[0] || que;
  return primera.length > max ? `${primera.slice(0, max - 1).trimEnd()}…` : primera;
}

/** @param {{ texto: string, nombre?: string }} props */
export default function ExplicacionConcepto({ texto, nombre = "" }) {
  const { que, ejemplo } = partesLeyenda(texto);
  if (!que && !ejemplo) return null;
  return (
    <div role="note" aria-label="Qué comprende este tipo"
      className="rounded-lg border border-gypi-cyan/40 bg-gypi-cyan/10 px-3 py-2 flex flex-col gap-1 text-[14px] leading-snug text-gypi-text">
      <span className="text-[12px] font-semibold uppercase tracking-wide text-gypi-dim">ℹ {nombre ? `Qué es «${nombre}»` : "Qué comprende"}</span>
      {que && <span>{que}</span>}
      {ejemplo && <span className="text-[13px]"><b>Ejemplo:</b> {ejemplo}</span>}
    </div>
  );
}
