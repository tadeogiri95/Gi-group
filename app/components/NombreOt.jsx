// app/components/NombreOt.jsx — La OT con sus cuatro datos (Código · Cliente ·
// Proyecto · Descripción) igual en todas las pantallas (Tadeo, 02/11). Los
// datos salen de app/lib/nombreOt.js.
//
// forma="linea": un renglón "OT 7961 · RIOFRIO IVAN · EDIFICIO MAIPU · COCINA"
//   (truncar corta con "…" y el texto completo queda al apoyar el mouse).
// forma="bloque": el cliente en negrita, el proyecto debajo y la descripción
//   en otro renglón, para tarjetas y cabeceras.
// sinCodigo: cuando el código ya se muestra al lado (botón, chip de color…).

import { Fragment } from "react";
import { partesOt, textoOt } from "../lib/nombreOt";

export default function NombreOt({ proyecto, forma = "linea", sinCodigo = false, truncar = false, className = "" }) {
  const { codigo, cliente, proyecto: obra, descripcion } = partesOt(proyecto);
  const completo = textoOt(proyecto);
  if (forma === "bloque") {
    return (
      <div className={`min-w-0 ${className}`} data-nombre-ot title={completo}>
        {!sinCodigo && codigo && <div className="font-mono font-bold text-gypi-amber-ink">OT {codigo}</div>}
        <div className={`font-bold text-gypi-text ${truncar ? "truncate" : ""}`} data-cliente>{cliente || "—"}</div>
        {obra && <div className={`text-[13px] text-gypi-dim ${truncar ? "truncate" : ""}`} data-obra>{obra}</div>}
        {descripcion && <div className={`text-[13px] font-semibold text-gypi-text ${truncar ? "line-clamp-2" : ""}`} data-descripcion>{descripcion}</div>}
      </div>
    );
  }
  const resto = [cliente, obra, descripcion].filter(Boolean);
  return (
    <span className={`min-w-0 ${truncar ? "truncate" : ""} ${className}`} data-nombre-ot title={completo}>
      {!sinCodigo && codigo && <span className="font-mono font-bold">OT {codigo}</span>}
      {resto.map((t, i) => (
        <Fragment key={i}>
          {(i > 0 || (!sinCodigo && codigo)) ? " · " : ""}
          {i === 0 ? <span className="font-semibold">{t}</span> : t}
        </Fragment>
      ))}
    </span>
  );
}

/**
 * Cabecera de las ventanas de una OT (Detalle, Piezas, Carga, Acta…): el
 * cliente como título y debajo el proyecto y la descripción. El código va
 * arriba, en el renglón "Orden 7961 · …" de cada ventana.
 */
export function TituloOt({ proyecto }) {
  const { cliente, proyecto: obra, descripcion } = partesOt(proyecto);
  return (
    <>
      <h3 className="m-0 font-heading text-lg font-bold truncate" title={textoOt(proyecto)}>{cliente || "—"}</h3>
      {(obra || descripcion) && (
        <div className="text-[13px] text-gypi-text mt-0.5" data-obra-descripcion>{[obra, descripcion].filter(Boolean).join(" · ")}</div>
      )}
    </>
  );
}
