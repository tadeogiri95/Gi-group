# Textos legales de Gypi — borradores para revisión (ítem 29)

> **Son borradores.** Los escribí con lo que hace hoy el sistema, pero **no son asesoramiento legal**. Antes de publicarlos los tiene que revisar un abogado con experiencia en protección de datos personales (Ley 25.326) y contratos de software. Cuando estén aprobados, yo los paso a las páginas `/terms` y `/privacy` de la app.

## Qué hay en esta carpeta

| Archivo | Para quién | Qué es |
|---|---|---|
| `terminos.md` | Empresas clientes y sus empleados | Términos y condiciones de uso del servicio |
| `privacidad.md` | Empleados y dueños | Política de privacidad: qué datos, para qué, con quién, cuánto tiempo, derechos |
| `acuerdo-tratamiento-datos.md` | Empresas clientes | Acuerdo de tratamiento de datos (DPA): Gypi trata los datos de los empleados **por cuenta** de la empresa |

Los lugares marcados con **[CORCHETES EN MAYÚSCULA]** son datos que tenés que completar vos o el abogado (nombre del titular, CUIT, domicilio, etc.).

## Lo que hay que completar

- **Titular del servicio.** Hoy las páginas dicen "Gypi Software", pero eso no es una persona ni una sociedad inscripta. Si facturás como monotributista, el titular sos vos: **[NOMBRE Y APELLIDO]**, **[CUIT]**, **[DOMICILIO]**.
- **Email de privacidad** (puede ser el mismo `contacto@gypi.app`).

## Preguntas concretas para el abogado

1. **Roles.** Para los datos de los empleados, ¿está bien plantear a la empresa cliente como **responsable** de la base de datos y a Gypi como quien presta el servicio de tratamiento por cuenta de ella (art. 25, Ley 25.326)? Así está escrito el acuerdo.
2. **Inscripción en la AAIP.** ¿Gypi tiene que inscribir sus propias bases de datos en el Registro Nacional de Bases de Datos? ¿Hay que recomendarles a los clientes que inscriban la suya?
3. **Transferencia internacional.** Los proveedores (Supabase/AWS, Vercel, Anthropic, Resend, Google, Sentry) procesan datos fuera de Argentina, principalmente en EE. UU. ¿Qué hace falta para cumplir el art. 12 de la Ley 25.326 y la normativa de la AAIP? ¿Alcanza con el consentimiento y las cláusulas del acuerdo, o hay que usar las cláusulas modelo de la AAIP?
4. **Geolocalización.** La ubicación se toma solo al fichar y se compara con la zona de la planta. ¿El aviso al empleado y la base legal están bien planteados, considerando que la relación laboral no es "consentimiento libre"?
5. **Asistente con IA.** Los mensajes del chat se mandan a Anthropic para generar la respuesta. ¿Alcanza con informarlo, o hace falta algo más?
6. **Retención.** ¿Los plazos propuestos son compatibles con la obligación del empleador de conservar registros laborales? Esa obligación es del cliente, no de Gypi: el cliente puede descargar sus datos en cualquier momento.
7. **Baja y borrado.** Hoy los datos se borran a los 30 días de que la empresa da de baja su cuenta. Falta decidir qué pasa con una empresa que deja vencer la prueba o el pago **sin** darse de baja: hoy no se borra nada. Propuesta: borrar a los 90 días de inactividad con aviso previo por email. ¿Es razonable?
8. **Limitación de responsabilidad** al monto de 3 meses de abono: ¿es válida frente a la Ley de Defensa del Consumidor? En general no aplica a contratos entre empresas, pero un cliente puede ser una persona humana.
9. **Jurisdicción:** Córdoba. ¿Está bien?
10. **Precios en USD cobrados en pesos** y actualización con 30 días de aviso: ¿cómo redactar la cláusula?

## Cuándo hacen falta

- Para seguir con pruebas en empresas conocidas, alcanzan los textos actuales, con las correcciones ya hechas.
- **Antes de vender a empresas desconocidas** o de publicar en Google Play (pide el link a la política de privacidad), conviene tenerlos revisados.
