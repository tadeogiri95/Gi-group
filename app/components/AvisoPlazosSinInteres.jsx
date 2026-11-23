"use client";
// 20/11: aviso de Resultados y del Flujo de caja: plazos fijos que ya
// vencieron y cuyo interés todavía no está registrado (no cuenta en el
// resultado ni en el flujo). Se arregla subiendo el extracto del banco (Gypi
// lo registra solo) o con "Registrar" en Finanzas → Inversiones → Plazos fijos.
const plata = (n) => `$ ${Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AvisoPlazosSinInteres({ datos }) {
  if (!datos?.cantidad) return null;
  const uno = datos.cantidad === 1;
  return (
    <p className="m-0 mb-2 text-[13px] text-gypi-amber-ink" role="status">
      ⚠ {uno ? "1 plazo fijo venció" : `${datos.cantidad} plazos fijos vencieron`} y {uno ? "su interés todavía no está registrado" : "sus intereses todavía no están registrados"} (<b className="font-mono">{plata(datos.importe)}</b>): no {uno ? "cuenta" : "cuentan"} acá.
      {" "}Subí el extracto del banco (Gypi lo registra solo) o apretá Registrar en Finanzas → Inversiones → Plazos fijos.
    </p>
  );
}
