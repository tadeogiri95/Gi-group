# Acuerdo de Tratamiento de Datos Personales (Gypi)

> **BORRADOR PARA REVISIÓN LEGAL** — no publicar sin la revisión de un abogado (ver `README.md`).

Este acuerdo forma parte de los Términos y Condiciones de Gypi. Se celebra entre:
- **la empresa que contrata Gypi** (el "Cliente"), que actúa como **responsable** de los datos de su personal; y
- **[NOMBRE Y APELLIDO DEL TITULAR]**, CUIT **[CUIT]** ("Gypi"), que actúa como **prestador del servicio de tratamiento** por cuenta del Cliente, en los términos del artículo 25 de la Ley 25.326.

## 1. Objeto

Gypi trata los datos personales del personal del Cliente **solo para prestar el Servicio** contratado y **solo según las instrucciones del Cliente**. Esas instrucciones son las que surgen de los Términos, de este acuerdo y de la configuración que el Cliente hace en la App. Gypi no usa esos datos para fines propios, no los cede y no los vende.

## 2. Datos y personas alcanzadas

- **Personas:** empleados, supervisores y administradores del Cliente que usan Gypi.
- **Datos:**
  - identificación (nombre, legajo, email);
  - asistencia (fichadas, horarios, tardanzas, horas);
  - ubicación al fichar;
  - actividad laboral (tareas, órdenes de trabajo, reportes y fotos);
  - solicitudes y documentos que el Cliente pida;
  - mensajes del asistente;
  - datos técnicos de acceso.
- **No** se deben cargar datos sensibles (art. 2, Ley 25.326), como datos de salud. La excepción son los certificados que el Cliente decida pedir, que quedan bajo su responsabilidad.

## 3. Obligaciones de Gypi

1. Tratar los datos solo para el Servicio y según las instrucciones del Cliente.
2. Mantener la **confidencialidad**. Las personas que tengan acceso a los datos (Gypi y sus colaboradores) están obligadas a guardar secreto, incluso después de terminado el acuerdo.
3. Aplicar **medidas de seguridad** técnicas y organizativas adecuadas. Entre ellas:
   - cifrado en tránsito;
   - credenciales cifradas de forma irreversible;
   - separación lógica entre clientes;
   - control de acceso por rol (y por división, si el Cliente lo configura);
   - registro de acciones sensibles;
   - copias de seguridad.
4. **Subencargados:** el Cliente autoriza a Gypi a usar los proveedores de la tabla del Anexo. Gypi avisa por email con **30 días** de anticipación antes de sumar o cambiar un proveedor. El Cliente puede oponerse por motivos razonables y, si no hay acuerdo, terminar el contrato sin penalidad.
5. **Asistir al Cliente** para responder los pedidos de acceso, rectificación y supresión de su personal. La App permite al Cliente corregir y borrar los datos personales de un empleado y descargar todos sus datos.
6. **Incidentes:** avisar al Cliente, **sin demora indebida** y dentro de **[72] horas** de haber tomado conocimiento, de cualquier incidente de seguridad que afecte sus datos. El aviso incluye lo que se sepa de su alcance y las medidas tomadas.
7. **Al terminar el Servicio:**
   - el Cliente puede descargar sus datos desde la App;
   - Gypi los **elimina** a los **30 días** de la baja de la cuenta, junto con los archivos;
   - las copias de seguridad del proveedor se reemplazan solas dentro de **[PLAZO]**.
8. Dar al Cliente la información razonable que necesite para demostrar el cumplimiento de este acuerdo.

## 4. Obligaciones del Cliente

1. Tener base legal para el tratamiento de los datos de su personal e **informarle** del uso de Gypi, incluida la **ubicación al fichar**. Puede usar la Política de Privacidad de Gypi como apoyo.
2. Cargar solo los datos necesarios y mantenerlos actualizados.
3. Gestionar los accesos de su personal (altas, bajas y roles) y los dispositivos en modo kiosco.
4. Cumplir sus propias obligaciones como responsable de la base de datos, incluida, si corresponde, su inscripción ante la AAIP. **[VERIFICAR CON EL ABOGADO]**
5. Conservar los registros laborales que la ley le exija. Para eso puede descargar sus datos en cualquier momento.

## 5. Transferencia internacional

El Cliente toma conocimiento de que los subencargados del Anexo procesan datos fuera de Argentina, principalmente en Estados Unidos, y presta su conformidad. **[REDACCIÓN Y GARANTÍAS A DEFINIR CON EL ABOGADO SEGÚN EL ART. 12 DE LA LEY 25.326 Y LA NORMATIVA DE LA AAIP, p. ej. cláusulas contractuales modelo]**

## 6. Vigencia

Este acuerdo rige mientras el Cliente use el Servicio y hasta la eliminación de sus datos según el punto 3.7.

---

## Anexo — Subencargados autorizados

| Proveedor | Servicio | Ubicación principal |
|---|---|---|
| Supabase Inc. (sobre Amazon Web Services) | Base de datos y archivos | [REGIÓN DEL PROYECTO] |
| Vercel Inc. | Servidores de la aplicación | EE. UU. y red global |
| Anthropic PBC | Asistente con IA | EE. UU. |
| Resend Inc. | Envío de emails | EE. UU. |
| Google LLC (Firebase Cloud Messaging; inicio de sesión con Google) | Notificaciones; autenticación opcional | EE. UU. y red global |
| Functional Software Inc. (Sentry) | Registro de errores técnicos | EE. UU. |
| Mercado Pago (MercadoLibre S.R.L.) | Cobro de la suscripción (datos del administrador) | Argentina |
