# Política de Privacidad de Gypi

> **BORRADOR PARA REVISIÓN LEGAL** — no publicar sin la revisión de un abogado (ver `README.md`).

*Última actualización: [FECHA DE PUBLICACIÓN]*

Gypi es un servicio de gestión de asistencia y producción para empresas (en adelante, "Gypi" o "el Servicio"), prestado por **[NOMBRE Y APELLIDO DEL TITULAR]**, CUIT **[CUIT]**, con domicilio en **[DOMICILIO]**, Argentina ("nosotros").

Esta política explica qué datos personales se tratan en Gypi, para qué, con quién se comparten, cuánto tiempo se guardan y cómo ejercer tus derechos, según la Ley 25.326 de Protección de los Datos Personales.

## 1. Quién decide sobre tus datos

Gypi lo usan **empresas** (los "Clientes") para gestionar a su personal.

- **Si sos empleado de una empresa que usa Gypi**, la responsable de tus datos es **esa empresa**: ella decide qué datos carga y para qué los usa. Gypi los trata **por cuenta y orden de la empresa**, según un acuerdo de tratamiento de datos. Las consultas sobre tus datos laborales hacéselas primero a tu empleador. También podés escribirnos y se las derivamos.
- **Si sos el dueño o administrador de la cuenta de una empresa**, somos responsables de los datos de contacto y facturación de esa cuenta.

## 2. Qué datos se tratan

**De los empleados (cargados por la empresa o por el propio empleado):**
- Identificación: nombre y apellido, legajo, email (opcional), división, rol y horario de trabajo.
- Asistencia: horas de entrada y salida, llegadas tarde, horas extra y notas (por ejemplo, "fichada sin conexión").
- **Ubicación (GPS):** solo en el momento de fichar. Ver la sección 4.
- Trabajo: tareas registradas, órdenes de trabajo, tiempos de espera y su causa, reportes de obra con fotos.
- Solicitudes: permisos, vacaciones, ausencias y justificaciones, con sus fechas y comentarios.
- Documentos que la empresa pida (por ejemplo, certificados), si usa ese módulo.
- Mensajes con el asistente de la App (ver la sección 5).
- Datos técnicos: tipo de navegador o dispositivo, dirección IP y fecha de los accesos. Se usan para la seguridad de la cuenta.
- Credenciales: la contraseña y el PIN se guardan cifrados de forma irreversible. Nadie, ni siquiera Gypi, puede verlos.

**De los dueños o administradores:** nombre, email, datos de la empresa y, para la facturación, razón social, CUIT, condición frente al IVA y domicilio. **No guardamos los datos de tarjetas:** los procesa Mercado Pago.

## 3. Para qué se usan

- Registrar la asistencia y calcular horas, tardanzas y horas extra según las reglas que define la empresa.
- Registrar el trabajo realizado sobre cada orden de trabajo y generar reportes para la empresa.
- Gestionar solicitudes y avisos entre el empleado y la empresa: notificaciones en la App y por email.
- Brindar el Servicio, mantener la seguridad, prevenir abusos y resolver problemas técnicos.
- Facturar y cobrar la suscripción a la empresa.

**No** usamos los datos para publicidad, **no** los vendemos y **no** armamos perfiles para terceros.

## 4. Ubicación (GPS)

La App pide la ubicación del teléfono **solo en el momento de fichar** la entrada o la salida. Sirve para verificar que estás en el lugar de trabajo que definió la empresa. No hay seguimiento continuo ni en segundo plano. La ubicación queda registrada junto con la fichada y se guarda 90 días.

Podés negar o quitar el permiso desde la configuración del teléfono. En ese caso, si la empresa exige fichar en el lugar, vas a tener que fichar desde el kiosco de la planta o pedirle a tu supervisor que cargue la fichada.

## 5. Asistente con inteligencia artificial

Si usás el chat de la App, el texto de tus mensajes y algunos datos necesarios para responder (tu nombre, horario y fichadas recientes) se envían a **Anthropic** para generar la respuesta. Anthropic no usa esos datos para entrenar sus modelos. Si no querés usar el asistente, podés hacer todo desde los botones de la App.

## 6. Con quién se comparten

- **Con tu empleador** (los usuarios de gestión de la empresa), que es para quien funciona el Servicio. Si la empresa definió supervisores por división, cada supervisor ve solo a su división.
- **Con los proveedores que necesitamos para prestar el Servicio**, que tratan los datos solo según nuestras instrucciones:

| Proveedor | Para qué | Dónde |
|---|---|---|
| Supabase (sobre Amazon Web Services) | Base de datos y archivos | [REGIÓN DEL PROYECTO, p. ej. EE. UU.] |
| Vercel | Servidores de la aplicación | EE. UU. y red global |
| Anthropic | Asistente con IA (sección 5) | EE. UU. |
| Resend | Envío de emails | EE. UU. |
| Google (Firebase) | Notificaciones en el celular; inicio de sesión con Google, si se usa | EE. UU. y red global |
| Mercado Pago | Cobro de la suscripción (solo datos del dueño o administrador) | Argentina |
| Sentry | Registro de errores técnicos | EE. UU. |
| OpenStreetMap (Nominatim) | Buscar en el mapa la dirección de la planta (solo la dirección, sin datos de personas) | Unión Europea |

- **Con autoridades**, cuando una ley o una orden judicial lo exija.

**Transferencia internacional:** varios proveedores procesan los datos fuera de Argentina. **[REDACCIÓN A DEFINIR CON EL ABOGADO SEGÚN EL ART. 12 DE LA LEY 25.326 Y LA NORMATIVA DE LA AAIP]**

## 7. Cuánto tiempo se guardan

- Los datos de la empresa y su personal se guardan **mientras la empresa tenga su cuenta**. La empresa decide cuándo dar de baja a un empleado o borrar sus datos personales.
- **Ubicaciones de las fichadas:** 90 días.
- **Registros de seguridad** (accesos y cambios importantes): 180 días.
- **Baja de la cuenta:** cuando la empresa da de baja su cuenta, los datos se conservan **30 días** (por si se arrepiente) y después se **borran de forma definitiva**, incluidos documentos y fotos.
- **[A DEFINIR: qué pasa con una cuenta que deja de pagar sin darse de baja. Propuesta: borrado a los 90 días de inactividad, con aviso previo por email.]**
- Las copias de seguridad del proveedor de base de datos se reemplazan solas en **[PLAZO SEGÚN EL PLAN DE SUPABASE, p. ej. 7 días]**.

La obligación de conservar registros laborales es de la empresa empleadora. La empresa puede **descargar todos sus datos** en cualquier momento desde la App: Gestión → Configuración → Privacidad.

## 8. Seguridad

- Toda la comunicación viaja cifrada (HTTPS).
- Contraseñas y PIN guardados con cifrado irreversible.
- Sesiones que vencen y se pueden cerrar desde el servidor.
- Separación estricta entre empresas: una empresa nunca ve datos de otra.
- Cada usuario ve solo lo que corresponde a su rol.
- Registro de las acciones sensibles.

Si detectamos un incidente que afecte tus datos, lo informamos a la empresa y, cuando corresponda, a la autoridad.

## 9. Tus derechos

Podés pedir **acceso** a tus datos, su **rectificación**, su **actualización** o su **supresión**, en los términos de la Ley 25.326. El acceso es gratuito, una vez cada seis meses salvo que acredites un interés legítimo.

- Si sos empleado, pedíselo a tu empleador. También podés escribirnos a **[EMAIL DE PRIVACIDAD]**, y lo coordinamos con la empresa.
- Respondemos dentro de los plazos de la ley: 10 días corridos para el acceso y 5 días hábiles para rectificación o supresión.

La **AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA**, órgano de control de la Ley 25.326, tiene la atribución de atender las denuncias y reclamos que se presenten por incumplimiento de las normas sobre protección de datos personales.

## 10. Cookies

Usamos solo las cookies y el almacenamiento del navegador **estrictamente necesarios**:
- mantener la sesión iniciada;
- proteger los formularios contra envíos falsificados;
- recordar preferencias;
- permitir fichar y cargar tareas sin conexión: lo hecho sin señal se guarda en el teléfono hasta enviarse.

No usamos cookies de publicidad ni de seguimiento de terceros.

## 11. Menores

Gypi es una herramienta laboral para empresas. No está dirigida a menores de 18 años, salvo los casos en que la empresa los emplee legalmente.

## 12. Cambios

Si cambiamos esta política de forma importante, lo avisamos en la App y por email a los administradores, con al menos 15 días de anticipación.

## 13. Contacto

**[NOMBRE Y APELLIDO DEL TITULAR]** — **[EMAIL DE PRIVACIDAD]** — **[DOMICILIO]**, Argentina.
