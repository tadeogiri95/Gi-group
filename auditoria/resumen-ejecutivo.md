# Gypi — Resumen ejecutivo de la auditoría

*Octubre 2026 · Para el dueño del producto · Lenguaje no técnico*

## Qué es Gypi hoy

Una aplicación web para pymes industriales que ya resuelve bien lo básico: **los operarios fichan desde el celular (con control de ubicación), registran en qué orden de trabajo y etapa están trabajando, y el dueño ve en vivo qué pasa en la planta**. También tiene altas de empresas por internet, planes, cobro con Mercado Pago y un panel para administrar a todos los clientes. Es una base valiosa: lo que la diferencia de un reloj de fichaje común es la medición de la productividad por orden de trabajo.

## Qué encontramos

1. **Seguridad.** La base de datos estaba abierta a cualquiera desde internet. **Ya la cerramos** (paso de contención del 6/10, verificado). Quedan fallas dentro de la app: hoy un operario podría ver o modificar información que no le corresponde, e incluso borrar los datos de su empresa. **Es lo primero a corregir.**
2. **Dos reglas de la base mezclan a las empresas entre sí.** Con un segundo cliente, un empleado de una empresa podría impedir que fiche uno de otra. **Bloquea vender a más de una empresa.**
3. **Algunos números no son confiables:** las causas del tiempo perdido no se guardan y los reportes del mes se cortan cuando hay muchos registros.
4. **El operario tiene fricciones serias:** pierde la sesión cada vez que cierra la app, ficha desde un chat, puede quedar “atrapado” en esa pantalla y no puede trabajar sin señal.
5. **Una empresa nueva no puede arrancar sola:** los empleados que se cargan sin email no tienen forma de entrar.
6. **Operación:** hoy se usan planes gratuitos de los proveedores, que **no permiten uso comercial ni tienen copias de seguridad**. Antes del primer cobro hay que pasar a los planes pagos (≈ USD 50 por mes en total para empezar).

## Qué decidimos

- **Formato:** una sola aplicación web, distribuida como **panel en la computadora** para el dueño y la administración, **app en Google Play** para los operarios (todos usan Android) y **modo tablet en planta** con **QR + PIN**. La app de iPhone, solo si un cliente la pide.
- **Cómo se cobra:** **plan Free mínimo** (sin publicidad), y dos planes pagos, **Asistencia** y **Planta**, por **cantidad de operarios**, con **módulos adicionales** (stock, compras, órdenes de producción, calidad, mantenimiento, trabajo en campo, asistente con IA). **Precios en dólares cobrados en pesos** por Mercado Pago, **100% autoservicio**, con **Factura C** al CUIT del cliente (como monotributista). Google Play se usa para distribuir, no para cobrar (evita una comisión de ~15%).
- **Reglas de cada fábrica** (tolerancias, tardanzas, presentismo) pasan a ser **configurables por cliente**.

## El plan, en tres etapas

| Etapa | Duración estimada | Resultado |
|---|---|---|
| **1. Arreglar ya** | 2–3 semanas | Plataforma segura para varias empresas, datos confiables, copias de seguridad y monitoreo de errores |
| **2. Listo para el segundo cliente** | 6–9 semanas | Una empresa nueva se registra, configura, da acceso a sus operarios con QR + PIN, la usa en planta (incluso con cortes de señal), paga con Mercado Pago y recibe su factura, **sin tu intervención**. App publicada en Google Play y resumen semanal automático para el dueño |
| **3. Listo para escalar** | 3–6 meses | Módulos vendibles por paquete, uno por vez: **órdenes de producción → stock → compras → calidad → mantenimiento** |

## Lo que necesito de vos

- **Aprobar el plan.**
- Crear un **ambiente de pruebas** en Supabase (gratis).
- **Hablar con tu contador** sobre: punto de venta electrónico, Factura C y tope del monotributo, ingresos brutos, precios en dólares, y ley de datos personales.
- Que **un abogado revise** los términos, la política de privacidad y el contrato de datos para clientes.
- **Validar los precios** con 5 a 10 pymes antes de fijarlos.

## Lo que no conviene hacer todavía

Construir todos los módulos a la vez, hacer la app de iPhone, cobrar dentro de Google Play o reescribir la aplicación desde cero.

*Detalle técnico completo: `auditoria/fase-0.md` a `fase-7.md` y `backlog-acumulado.md`.*
