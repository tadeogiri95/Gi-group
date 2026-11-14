'use client';
// app/components/FinanzasPaginas.jsx — etapa 4 de la auditoría de Finanzas
// integrada (14/11): lo que estaba escondido adentro de otras pantallas pasa
// a tener su lugar en el menú de Finanzas.
//   💰 Tesorería → 📈 Inversiones (plazos fijos, FCI y títulos; antes al pie
//      de Cajas y bancos)
//   👥 Cuentas corrientes → 📋 Cuenta por OT y 🔗 Cliente y proveedor (antes
//      botones de Clientes y Proveedores)
//   📚 Contabilidad → 📄 Importar S.O.S (antes un botón de Proveedores)
// Son las mismas pantallas de siempre; las que eran ventanas se muestran en
// la página (ModalEnPagina).
import PlazosFijos from "./FinanzasPlazosFijos";
import Inversiones from "./FinanzasInversiones";
import FinanzasOtClientes from "./FinanzasOtClientes";
import FinanzasSos from "./FinanzasSos";
import FinanzasUnificados from "./FinanzasUnificados";
import { ModalEnPagina } from "./ui/Modal";

export function InversionesPagina() {
  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      <p className="m-0 mb-3 text-[13px] text-gypi-dim">Los plazos fijos, el FCI y los títulos. Su saldo también suma en la plata de Tesorería.</p>
      <PlazosFijos onCambio={() => {}} />
      <Inversiones onCambio={() => {}} />
    </div>
  );
}

/** Una ventana de Finanzas que ahora es una pantalla del menú. onIr lleva a otra pantalla. */
export function VentanaComoPagina({ id, onIr }) {
  const volver = (a) => () => onIr?.(a);
  return (
    <ModalEnPagina.Provider value={true}>
      {id === "fin-cuenta-ot" && <FinanzasOtClientes onCerrar={volver("fin-clientes")} />}
      {id === "fin-sos" && <FinanzasSos onCerrar={volver("fin-devengamiento")} onImportado={volver("fin-proveedores")} />}
      {id === "fin-unificados" && <FinanzasUnificados onCerrar={volver("fin-personas")} onCambio={() => {}} />}
    </ModalEnPagina.Provider>
  );
}
