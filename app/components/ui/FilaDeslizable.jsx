"use client";
import { useEffect, useRef, useState } from "react";

// Fila de pestañas o filtros que en un celular angosto se desliza de costado
// en vez de partirse en dos o tres renglones. Si quedan botones a la derecha,
// el borde se desvanece para que se note que hay más; la elegida queda a la vista.
export default function FilaDeslizable({ children, className = "", activa, ...props }) {
  const ref = useRef(null);
  const [hayMas, setHayMas] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const medir = () => setHayMas(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    medir();
    el.addEventListener("scroll", medir, { passive: true });
    window.addEventListener("resize", medir);
    return () => {
      el.removeEventListener("scroll", medir);
      window.removeEventListener("resize", medir);
    };
  }, []);

  useEffect(() => {
    const elegida = ref.current?.querySelector('[aria-selected="true"], [aria-pressed="true"]');
    elegida?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activa]);

  return (
    <div ref={ref} data-hay-mas={hayMas ? "si" : undefined} className={`fila-desliza ${className}`} {...props}>
      {children}
    </div>
  );
}
