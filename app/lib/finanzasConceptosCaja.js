// app/lib/finanzasConceptosCaja.js — "¿En qué?" de las cajas (14/11, pedido
// de Tadeo): una lista fija de conceptos de caja, escritos normal, agrupados
// por tema y cada uno con una reseña de para qué se usa.
//
// Antes "¿En qué?" mostraba los tipos de operación: los que vinieron del
// libro sin nombre salían en mayúscula (PAGO GASTOS DE LOGÍSTICA) y había
// opciones que no son de caja. Ahora cada concepto dice:
//   - la cuenta del plan (código del libro; si no está, se busca por nombre).
//     Un concepto cuya cuenta no está en el plan de la empresa no aparece.
//   - el tipo de operación (renglón del flujo de caja), el mismo de antes.
// El asiento es el de siempre: un gasto, la cuenta al debe y la caja al
// haber; plata que entra, al revés. Va a T-OPERACIONES con su tipo y sus
// cuentas, que ya existen en el libro.
//
// Quedan afuera a propósito (tienen su botón en ➕ Cargar): pago a un
// proveedor (Orden de pago), pases entre cajas, plazos fijos, FCI, títulos y
// dólares, impuestos grandes, tarjetas, préstamos y retiros de socios.

import { claveTipo } from "./finanzasTipos";

const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const C = (id, nombre, grupo, leyenda, cuenta, nombreCuenta, tipo) => ({ id, nombre, grupo, leyenda, cuenta, nombreCuenta, tipo });

/** Lo que se gasta desde una caja, en el orden en que se muestra. */
export const CONCEPTOS_GASTO = [
  C("combustible", "Combustible", "Vehículos y traslados", "Nafta, gasoil, GNC o aceite para los vehículos y las máquinas de la empresa. Ej.: carga de gasoil de la camioneta.", "04.02.01.001.005", "Combustibles Y Lubricantes", "GASTOS DE LOGÍSTICA"),
  C("anticipo_combustible", "Anticipo de sueldo por carga de combustible", "Vehículos y traslados", "Combustible que carga un dueño o un empleado para uso propio y se le descuenta del sueldo del mes. No es gasto de la empresa. Ej.: un socio carga nafta en su auto.", "01.01.03.014.001", "Anticipo De Sueldos", "SUELDOS"),
  C("movilidad", "Peajes, estacionamiento y traslados", "Vehículos y traslados", "Peajes, cocheras, taxi, Uber o colectivo por trabajo. Ej.: peaje y estacionamiento en una obra.", "04.02.01.001.031", "Movilidad", "GASTOS DE LOGÍSTICA"),
  C("fletes", "Fletes y envíos", "Vehículos y traslados", "Pagarle a otro para llevar o traer mercadería. Ej.: flete de placas desde el corralón.", "04.02.01.001.012", "Fletes Y Acarreos", "GASTOS DE LOGÍSTICA"),
  C("arreglo_vehiculos", "Arreglo de vehículos", "Vehículos y traslados", "Service, gomería, repuestos y lavado de los vehículos. Ej.: cambio de cubierta del camión.", "04.02.01.001.053", "Mantenimiento Automotor", "GASTOS DE LOGÍSTICA"),
  C("patente", "Patente de vehículos", "Vehículos y traslados", "Impuesto automotor de los vehículos de la empresa. Ej.: cuota de la patente de la camioneta.", "04.02.01.003.002", "Impuesto Automotor", "IMPUESTOS"),
  C("embalaje", "Embalaje", "Vehículos y traslados", "Film, cartón, esquineros y cinta para proteger lo que se entrega. Ej.: rollo de film stretch.", "04.02.01.001.056", "Embalaje", "GASTOS DE LOGÍSTICA"),
  C("viaticos", "Comidas y viáticos", "Viajes y comidas", "Comidas del personal cuando trabaja fuera de la planta. Ej.: almuerzo del equipo en una instalación.", "04.02.01.001.062", "Viáticos", "VIÁTICOS"),
  C("pasajes", "Pasajes y hotel", "Viajes y comidas", "Pasajes y alojamiento por trabajo en otra ciudad. Ej.: hotel para dos instaladores.", "04.02.01.001.052", "Pasajes y Hoteles", "VIÁTICOS"),
  C("insumos", "Insumos del taller", "Taller y materiales", "Lo que se gasta al producir y no queda en el mueble como pieza: lijas, cola, tornillos, mechas, discos. Ej.: ferretería para el taller.", "01.01.04.001.007", "Insumos", "COMPRAS"),
  C("materiales", "Materiales para producir", "Taller y materiales", "Placas, herrajes, cantos y otros materiales que van en los muebles, comprados al contado. Ej.: bisagras que faltaban para una OT.", "01.01.04.001.002", "Materias Primas", "COMPRAS"),
  C("arreglo_maquinas", "Arreglo de máquinas y herramientas", "Taller y materiales", "Repuestos y arreglos que no mejoran la máquina. Ej.: correa de la seccionadora.", "04.02.01.001.054", "Mantenimiento Maquinas", "GASTOS DE MANTENIMIENTO"),
  C("herramienta_nueva", "Herramienta o máquina nueva", "Taller y materiales", "Herramientas o máquinas que duran más de un año. Ej.: atornillador nuevo.", "01.02.02.001.006", "Maquinarias y herramientas- Valor Costo", "MAQUINARIA Y HERRAMIENTAS"),
  C("arreglo_edificio", "Arreglos del edificio", "Taller y materiales", "Arreglos de la planta y la oficina: pintura, plomería, electricidad, cerrajería. Ej.: cambio de una canilla.", "04.02.01.001.055", "Mantenimiento Edilicio", "GASTOS DE MANTENIMIENTO"),
  C("terceros", "Trabajos de terceros", "Taller y materiales", "Trabajos que hace otro taller o una persona de afuera. Ej.: laqueado de frentes, corte, una changa.", "04.02.01.001.046", "Trabajos De Terceros", "TRABAJOS TERCERIZADOS"),
  C("libreria", "Librería e impresiones", "Oficina y servicios", "Papelería, tinta, fotocopias y planos impresos. Ej.: resma de hojas.", "04.02.01.001.029", "Librería", "GASTOS DE ADMINISTRACIÓN"),
  C("limpieza", "Limpieza y cafetería", "Oficina y servicios", "Artículos de limpieza, agua, café y yerba para la planta y la oficina. Ej.: lavandina y bolsas.", "04.02.01.001.019", "Gastos General", "GASTOS DE ADMINISTRACIÓN"),
  C("informatica", "Computación y programas", "Oficina y servicios", "Equipos chicos, accesorios y suscripciones de programas. Ej.: mouse, suscripción mensual.", "04.02.01.001.057", "Informatica y Tecnologia", "GASTOS DE ADMINISTRACIÓN"),
  C("luz", "Luz", "Oficina y servicios", "Factura de electricidad. Ej.: factura de EPEC.", "04.02.01.001.011", "Electricidad", "SERVICIOS"),
  C("gas", "Gas", "Oficina y servicios", "Factura de gas o garrafas. Ej.: recarga de garrafa.", "04.02.01.001.014", "Gas", "SERVICIOS"),
  C("agua", "Agua", "Oficina y servicios", "Factura de agua o bidones. Ej.: factura de Aguas Cordobesas.", "04.02.01.001.001", "Agua Potable", "SERVICIOS"),
  C("celular", "Celular", "Oficina y servicios", "Abonos y recargas de los celulares de la empresa. Ej.: recarga del celular del chofer.", "04.02.01.001.045", "Telefonía Móvil", "SERVICIOS"),
  C("internet", "Internet", "Oficina y servicios", "Abono de internet de la planta o la oficina. Ej.: factura mensual del proveedor.", "04.02.01.001.058", "Internet", "SERVICIOS"),
  C("alquiler", "Alquiler", "Oficina y servicios", "Alquiler de un galpón, oficina, depósito o equipo. Ej.: alquiler mensual del depósito.", "04.02.01.001.002", "Alquileres", "SERVICIOS"),
  C("residuos", "Retiro de residuos", "Oficina y servicios", "Volquetes y retiro de aserrín y descartes. Ej.: volquete semanal.", "04.02.01.007.015", "Tratamiento de residuos", "SERVICIOS"),
  C("representacion", "Atención a clientes", "Ventas y clientes", "Comidas, regalos o atenciones a clientes y proveedores. Ej.: almuerzo con un cliente.", "04.02.01.001.017", "Gastos De Representacion", "GASTOS DE COMERCIALIZACIÓN"),
  C("publicidad", "Publicidad", "Ventas y clientes", "Avisos, redes, cartel, folletos y muestras. Ej.: campaña en Instagram.", "04.02.01.001.034", "Publicidad", "GASTOS DE COMERCIALIZACIÓN"),
  C("adelanto_sueldo", "Adelanto de sueldo", "Personal", "Plata que se le adelanta a un empleado o a un dueño y se descuenta del sueldo del mes. Ej.: adelanto de quincena.", "01.01.03.014.001", "Anticipo De Sueldos", "SUELDOS"),
  C("pago_sueldos", "Pago de sueldos", "Personal", "Pago de sueldos o jornales ya liquidados. Ej.: pago de la quincena en efectivo.", "02.01.03.001.001", "Sueldos A Pagar", "SUELDOS"),
  C("comisiones_banco", "Comisiones del banco", "Bancos e impuestos", "Mantenimiento de cuenta, comisiones y gastos que cobra el banco. Ej.: comisión mensual del Credicoop.", "04.02.01.001.008", "Comisiones Y Gastos Bancarios", "GASTOS BANCARIOS Y FINANCIEROS"),
  C("impuesto_cheque", "Impuesto al cheque", "Bancos e impuestos", "Impuesto a los débitos y créditos que el banco descuenta solo. Ej.: débito del 0,6 % en el extracto.", "04.02.01.001.023", "Impuesto Debitos Y Creditos Bancarios", "IMPUESTOS"),
  C("tasas", "Tasas y otros impuestos", "Bancos e impuestos", "Tasas municipales, sellados y otros impuestos chicos que no son IVA, IIBB ni Ganancias. Ej.: sellado de un contrato.", "04.02.01.003.001", "Egresos - Otros Impuestos", "IMPUESTOS"),
  C("honorarios", "Honorarios", "Bancos e impuestos", "Contador, abogado, escribano u otro profesional. Ej.: honorarios del estudio contable.", "04.02.01.001.021", "Honorarios Profesionales", "HONORARIOS"),
  C("otros_gastos", "Otros gastos", "Otros", "Lo que no entra en ningún otro. Usarlo poco y escribir el detalle. Ej.: una multa de tránsito.", "04.02.01.001.019", "Gastos General", "OTROS GASTOS"),
];

/** La plata que entra a una caja. */
export const CONCEPTOS_INGRESO = [
  C("cobro_cliente", "Cobro a un cliente", "Clientes", "Un cliente paga una OT o una factura. Baja lo que debe. Ej.: el cliente paga el saldo de la cocina en efectivo.", "01.01.02.001.001", "Deudores Por Ventas", "COBRO A CLIENTES"),
  C("anticipo_cliente", "Seña o anticipo de un cliente", "Clientes", "Un cliente paga antes de la entrega. Queda como anticipo hasta que se entrega. Ej.: 50 % al firmar el presupuesto.", "02.01.02.002.001", "Anticipo de Clientes", "ANTICIPO DE CLIENTES"),
  C("devolucion_adelanto", "Devolución de un adelanto de sueldo", "Personal", "Un empleado devuelve en plata un adelanto. Ej.: devuelve el adelanto que no usó.", "01.01.03.014.001", "Anticipo De Sueldos", "OTROS INGRESOS"),
  C("intereses", "Intereses ganados", "Inversiones y alquileres", "Intereses que paga el banco u otra inversión. Ej.: intereses de un plazo fijo.", "04.01.02.002.001", "Intereses Ganados", "RENDIMIENTOS FINANCIEROS"),
  C("alquiler_cobrado", "Alquiler cobrado", "Inversiones y alquileres", "Alquiler que paga un inquilino a la empresa. Ej.: alquiler del local.", "01.01.02.004.001", "Alquileres a cobrar", "RENDIMIENTOS INMOBILIARIOS"),
  C("aporte_socio", "Aporte de un socio", "Socios", "Un socio pone plata de su bolsillo en la empresa. Ej.: un socio deposita para cubrir sueldos.", "01.01.03.111.001", "Cuenta Particular Titular O Socio", "APORTE DE SOCIOS"),
  C("retazos", "Venta de retazos o chatarra", "Otros", "Venta de sobrantes, recortes o chatarra. Ej.: venta de retazos de placa.", "04.01.02.004.001", "Otros Ingresos", "OTROS INGRESOS"),
  C("otros_ingresos", "Otros ingresos", "Otros", "Plata que entra y no es ninguna de las anteriores. Escribir el detalle. Ej.: el seguro paga un siniestro.", "04.01.02.004.001", "Otros Ingresos", "OTROS INGRESOS"),
];

/** Los conceptos que son un anticipo de sueldo (para el resumen de los dueños). */
export const CONCEPTOS_ANTICIPO = new Set(["anticipo_combustible", "adelanto_sueldo"]);

/** El grupo del tipo de operación (para saber si separa IVA). */
const GRUPO_TIPO = {
  "GASTOS DE LOGÍSTICA": "GASTOS", "GASTOS DE MANTENIMIENTO": "GASTOS", "GASTOS DE ADMINISTRACIÓN": "GASTOS", "GASTOS DE COMERCIALIZACIÓN": "GASTOS",
  "GASTOS BANCARIOS Y FINANCIEROS": "GASTOS", "OTROS GASTOS": "GASTOS", "SERVICIOS": "GASTOS", "VIÁTICOS": "GASTOS", "HONORARIOS": "GASTOS",
  "COMPRAS": "COMPRAS", "TRABAJOS TERCERIZADOS": "COMPRAS", "MAQUINARIA Y HERRAMIENTAS": "INVERSIÓN",
  "SUELDOS": "SUELDOS", "IMPUESTOS": "IMPUESTOS",
  "COBRO A CLIENTES": "COBROS", "ANTICIPO DE CLIENTES": "COBROS", "OTROS INGRESOS": "COBROS",
  "RENDIMIENTOS FINANCIEROS": "INVERSIÓN", "RENDIMIENTOS INMOBILIARIOS": "INVERSIÓN", "APORTE DE SOCIOS": "FINANCIACIÓN",
};

/** La cuenta del concepto en el plan de la empresa: por código y, si no, por nombre. null si no está. */
export function cuentaDelConcepto(c, cuentas = []) {
  const activas = cuentas.filter((x) => x && x.codigo && x.activa !== false);
  const porCodigo = activas.find((x) => x.codigo === c.cuenta);
  if (porCodigo && sinTildes(porCodigo.nombre) === sinTildes(c.nombreCuenta)) return porCodigo.codigo;
  const porNombre = activas.filter((x) => sinTildes(x.nombre) === sinTildes(c.nombreCuenta));
  if (porNombre.length === 1) return porNombre[0].codigo;
  if (porCodigo) return porCodigo.codigo;
  return porNombre[0]?.codigo || null;
}

/**
 * Los conceptos que la empresa puede usar (todos, sin mirar lo que escondió
 * el dueño), con la cuenta y el tipo de la empresa. Un concepto sin su cuenta
 * en el plan queda afuera.
 * @returns {{ gastos: object[], ingresos: object[] }}
 */
export function conceptosCajaDisponibles(tipos = [], cuentas = []) {
  const tipoPor = new Map(tipos.filter((t) => t?.codigo).map((t) => [claveTipo(t.codigo), t.codigo]));
  const armar = (lista) => lista.flatMap((c) => {
    const cuenta = cuentaDelConcepto(c, cuentas);
    if (!cuenta) return [];
    return [{
      codigo: c.id, nombre: c.nombre, grupo: c.grupo, leyenda: c.leyenda, cuenta,
      tipo: tipoPor.get(claveTipo(c.tipo)) || c.tipo, grupo_tipo: GRUPO_TIPO[c.tipo] || "GASTOS",
    }];
  });
  return { gastos: armar(CONCEPTOS_GASTO), ingresos: armar(CONCEPTOS_INGRESO) };
}

/**
 * El concepto de un movimiento de caja ya cargado, por su tipo y la cuenta
 * del otro lado. null si no es de la lista.
 */
export function conceptoDeOperacion(op, cajaCuenta, disponibles) {
  if (!op || !disponibles) return null;
  const gasto = op.cuenta_haber === cajaCuenta;
  const otra = gasto ? op.cuenta_debe : op.cuenta_haber;
  const lista = gasto ? disponibles.gastos : disponibles.ingresos;
  const candidatos = lista.filter((c) => c.cuenta === otra && claveTipo(c.tipo) === claveTipo(op.tipo));
  // Dos con la misma cuenta y tipo (adelanto de sueldo y anticipo por
  // combustible): manda el nombre con el que empieza el detalle
  const desc = String(op.descripcion || "");
  return candidatos.find((c) => desc.startsWith(c.nombre)) || candidatos[0] || null;
}
