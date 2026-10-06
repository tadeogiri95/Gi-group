# Fase 6 — SaaS-readiness y monetización

> Solo lectura. Rama `claude/modest-archimedes-1jy9rm`, base `1c2a869`. Fecha: 2026-10-06.
> **[HECHO]** = código actual · **[HIPÓTESIS]** = mercado, precios, competencia, políticas de terceros o fiscales: **todo lo de mercado y precios es hipótesis a validar con clientes**, y todo lo fiscal **es un punto a validar con un contador, no asesoramiento**.
> Contexto: piloto sin cobros (versión completa gratis), 100% de los operarios con Android, wifi en planta, la tablet de kiosco la pone el cliente, cuenta de Google Play personal, módulos nuevos por paquete (stock, compras, OP, calidad, mantenimiento), supervisor por división, reporte de obra como módulo opcional.

## Resumen (5 líneas)

1. **Ya existe mucho de la base para cobrar:** alta self-service, planes con límites, suscripciones de Mercado Pago (preapproval) con webhook y reconciliación, trial, período de gracia, override del superadmin, emails de cobro, métricas de MRR/churn y Factura C por ARCA (apagada). Pero **nunca se probó con cobros reales** y tiene bugs conocidos (F1-08/09, F2-11).
2. **Brechas para ser vendible:** datos fiscales del cliente (CUIT, condición frente al IVA, razón social: no existen en el esquema), factura correcta para B2B (hoy se emite a “consumidor final”), planes y módulos en la base (hoy en código), ajuste de precios por inflación, **exportación y baja de datos** (prometidas en los términos y no implementadas), soporte y contrato/DPA.
3. **Modelo recomendado:** **suscripción por tramos de operarios activos + módulos como add-ons**, con un **cargo de puesta en marcha** opcional. Encaja con cómo el dueño de una pyme presupuesta (“cuánta gente tengo”) y con la arquitectura modular de la Fase 3.
4. **Google Play no es una fuente de ingresos en sí misma:** es **distribución y confianza**. Cobrar dentro de la app obligaría a usar Google Play Billing (comisión del ~15% en suscripciones [HIPÓTESIS]); conviene cobrar afuera (Mercado Pago o transferencia) y que la app solo haga login.
5. Los **precios actuales** (Starter ARS 15.000 / Pro ARS 35.000 por mes, por tramos de 15 y 50 empleados) son una hipótesis sin validar. Propongo **3 estructuras de planes** con su métrica de valor para testear con 5–10 pymes antes de fijar números.

---

## 1. Brecha para ser un SaaS vendible

| Capacidad | Estado actual [HECHO] | Evidencia | Brecha | Sev. | Esf. |
|---|---|---|---|---|---|
| **Alta self-service de empresas** | ✅ Registro con email o Google → empresa en plan Free + admin, asistente de 4 pasos | `api/registro-empresa`, `063_…sql`, `onboarding_wizard.jsx` | Los operarios no pueden activarse (F4-01/02); falta el paso “dar acceso” (QR + PIN) | Alto | M |
| **Planes y límites** | ⚠️ 5 planes en código (`plans.js`), con límites aplicados **solo en algunos `POST` de `/api/data`** (empleados, zonas, proyectos, reglas, calendario, reportes) y en algunas rutas (liquidación). Los módulos se ocultan en la UI | `lib/plans.js`, `lib/planEnforcement.js` | Planes y módulos en tablas (Fase 3 §7); *entitlements* chequeados en el servidor en **toda** ruta; cupo de IA por plan; límites por planta y por usuarios activos | Alto | M |
| **Facturación recurrente** | ⚠️ Preapproval de MP mensual o anual, webhook HMAC, idempotencia, reconciliación diaria, gracia hasta el fin del período, cancelación, emails de pago confirmado, fallido y suspensión | `lib/mercadopago.js`, `api/billing/*`, `cron/reconciliacion-mp` | Bugs F1-08/09 y F2-11; **monto fijo en ARS sin indexación**; sin prorrateo al cambiar de plan; sin pago por transferencia para planes Enterprise o anuales; sin listado de facturas descargables para el cliente; nunca probado en producción | Alto | M |
| **Factura electrónica** | ⚠️ Factura C a **consumidor final** (`DocTipo 99`, `DocNro 0`, sin IVA), apagada sin `AFIP_ACCESS_TOKEN` | `app/lib/afip.js:83-94` | El esquema **no tiene CUIT, razón social, condición frente al IVA ni domicilio fiscal** del cliente; un cliente empresa necesita la factura a su CUIT; si Gypi pasa a Responsable Inscripto, se necesitan facturas A/B con IVA; notas de crédito | Alto | M |
| **Panel de superadmin** | ✅ Empresas (paginado), cambiar plan, override, impersonación con código de un solo uso, auditoría, historial de planes, MRR/churn/funnel/health score | `app/superadmin/*`, `046/048/055_…sql` | Seguridad (F2-13: clave única, sin 2FA); faltan: activar módulos y add-ons por empresa, ver consumo (usuarios activos, IA, storage), registrar pagos manuales, notas de cuenta | Medio | M |
| **Configuración por tenant** | ⚠️ Branding (9 temas + colores + logo), etapas y divisiones, zona horaria, prompts de IA, reglas del bot | `empresa`, `etapas`, `divisiones`, `config_sistema` | Políticas de asistencia (H1–H3), catálogos (tipos de solicitud, causas), roles y permisos, plantas, campos personalizados, textos por rubro (Fase 2 §7, Fase 3 §7) | Alto | L |
| **Términos y privacidad** | ⚠️ Existen (`/terms`, `/privacy`), con jurisdicción en Córdoba, aviso de 30 días para cambios de precio y retención de 30 días tras la baja | `app/terms/page.js`, `app/privacy/page.js` | No identifican al **titular** (razón social, CUIT, domicilio); omiten proveedores (Anthropic, Resend, MP, Google: F2-17); prometen cosas no implementadas (ver abajo); no hay **contrato de encargado de tratamiento (DPA)** para el cliente empresa ni SLA | Alto | S–M |
| **Soporte** | ⚠️ Formulario de contacto, email, botón “Contacto Enterprise”, `/docs` estático | `api/contacto*`, `app/docs` | Canal de soporte definido (WhatsApp Business o helpdesk), base de conocimiento, página de estado, tiempos de respuesta por plan | Medio | S |
| **Exportación de datos** | ❌ Solo hay exportaciones CSV puntuales en reportes y personal. **Los términos prometen la exportación completa a pedido** | `terms/page.js` §8, `reportes_screen.jsx` | Exportación self-service por empresa (ZIP con CSV por tabla + archivos) | Alto | M |
| **Baja y borrado de datos** | ❌ **Los términos prometen borrar los datos 30 días después de la cancelación (y 90 días de inactividad en Free)**, pero no hay ningún cron ni proceso que lo haga. Además, hoy cualquier usuario puede borrar la empresa (F2-01) | `terms/page.js` §8; no hay código | Flujo de baja (solicitud del dueño, período de retención, export, borrado definitivo con registro), y borrado de un empleado a pedido (derecho de supresión) | Alto | M |
| **Publicidad en el plan Free** | ⚠️ AdSense en el panel de gestión | `AdSlot.jsx` | **Quitar**: resta percepción B2B, implica riesgo legal y trae ingresos marginales [HIPÓTESIS] | Medio | S |

## 2. Qué parte del código ya soporta cobrar (Mercado Pago) y qué falta

| Pieza | Estado | Falta |
|---|---|---|
| Crear la suscripción (preapproval) | ✅ `create-subscription`: deduplica si se repite en menos de 5 min, `external_reference = gypi-{empresa}-{susc}`, `back_url` al tenant | Usar el email del pagador que indique el cliente (hoy `empresa.admin_email`; MP puede exigir que coincida con la cuenta del pagador [HIPÓTESIS]); planes y precios leídos de la base |
| Webhook | ✅ HMAC + idempotencia + gracia + override + factura | F1-08 (pendiente → aprobado), F1-09 (unidad del `ts`), F2-11 (validar suscripción y monto) |
| Reconciliación | ✅ Reporta diferencias | Corregir automáticamente los casos seguros |
| Cancelación | ✅ `billing/portal POST` cancela en MP | Pedir el motivo de la baja (insumo de churn) |
| Trial | ✅ 14 días de Pro con un botón (`063`) | — |
| Upgrade/downgrade | ⚠️ Crea un preapproval nuevo y cancela los demás | Prorrateo o “el cambio rige desde el próximo ciclo” |
| Indexación (inflación) | ❌ Monto fijo | Actualización periódica del `transaction_amount` del preapproval (PUT) con aviso de 30 días, según los términos; o **precio en USD de referencia cobrado en ARS al tipo de cambio del día** [HIPÓTESIS: validar viabilidad con MP y el contador] |
| Medición de uso | ❌ | Operarios activos por mes, plantas, módulos activos, tokens de IA |
| Facturas para el cliente | ❌ | Listado y PDF de los comprobantes emitidos (CAE) en Billing |
| Cobro manual o transferencia (Enterprise/anual) | ⚠️ Solo override manual del plan | Registrar pagos manuales y emitir la factura |

## 3. Modelos de monetización

| Modelo | Pros | Contras | Le calza a… |
|---|---|---|---|
| **Por usuario (seat)** | Simple, escala con el valor y es estándar en SaaS | El dueño de una pyme “cuenta cabezas” y castiga sumar operarios; hay que definir qué es un usuario activo | Empresas con dotación estable; métrica “operarios activos en el mes” |
| **Por tramos de usuarios** (lo actual: hasta 5/15/50) | Previsible para el cliente y fácil de comunicar | Saltos de precio en los bordes; deja plata en la mesa en la parte alta del tramo | Pymes de 10–80 personas (el foco) |
| **Por módulo** | Alineado a la arquitectura modular; vende lo que cada uno usa | Si hay demasiadas combinaciones, confunde | Clientes que entran por asistencia y después suman producción o stock |
| **Por planta** | Natural en industria (“tengo 2 plantas”); el kiosco es por planta | No escala con el tamaño de la planta | Multi-planta; combinarlo con tramos |
| **Por tramos de uso** (IA, storage, fotos) | Cubre los costos variables (Fase 3) | Facturas impredecibles, no gusta en pymes | Solo como **cupo incluido + extra** en IA |
| **Freemium** | Genera leads y prueba sin fricción | Soporte a usuarios que no pagan; costo de infraestructura; en B2B convierte menos que un trial [HIPÓTESIS] | Mantener un Free **muy acotado** (≤5 personas, solo fichaje) sin publicidad, o reemplazarlo por un trial de 14–30 días |
| **Licencia + implementación** | Ingreso inicial que paga la puesta en marcha; compromete al cliente | Venta más larga | Medianas o con integraciones (ERP, liquidación) |
| **White-label** | Precio alto; los temas ya existen | Soporte y marca de terceros; distrae del foco | Consultoras o cámaras industriales que revenden; **no ahora** |
| **Servicios de puesta en marcha** | Margen alto; reduce el churn (datos bien cargados, capacitación) | Escala con horas tuyas | Todos los clientes: paquete fijo (carga de personal, OT, horarios, QR/PIN, configuración del kiosco, capacitación) |
| **Google Play como canal de cobro** | — | Comisión del ~15–30% si se vende dentro de la app [HIPÓTESIS]; obliga a mantener precios en dos lugares | **No recomendado**: usar Play solo para distribuir y cobrar afuera |

## 4. Propuesta de estructuras de planes (los precios son hipótesis para testear)

> Unidad de medida: **operario activo** = persona que fichó o registró actividad al menos una vez en el mes. Los usuarios de gestión no cuentan o vienen incluidos. Precios de referencia en **USD por mes**, cobrados en **ARS** con actualización periódica [HIPÓTESIS: validar con el contador y MP]. Antes de fijarlos: entrevistas con 5–10 pymes y relevamiento de alternativas locales (relojes biométricos con software, apps de fichaje, ERPs pyme) [HIPÓTESIS: no hice relevamiento de competencia; requiere datos de mercado].

### Estructura 1 — “Por tramos + módulos” (recomendada para empezar)

| Plan | Incluye | Métrica de valor | Precio hipótesis |
|---|---|---|---|
| **Asistencia** | Fichaje (botón, QR/PIN, kiosco, GPS), solicitudes, horarios, liquidación de horas, resumen semanal | Hasta 15 / 40 / 80 operarios activos | USD 20 / 45 / 80 |
| **Planta** (Asistencia +) | OT y etapas, actividad con tiempo improductivo y causa, tablero en vivo, reportes por OT, escaneo de OT | Mismos tramos | USD 45 / 95 / 160 |
| **Add-ons** | Stock · Compras · Órdenes de producción · Calidad · Mantenimiento · Trabajo en campo (reporte de obra) · Asistente IA (cupo mensual) | Por módulo y por empresa | USD 15–40 cada uno |
| **Puesta en marcha** | Carga inicial, configuración, capacitación de 2 h, QR impresos | Única vez | USD 150–400 |

*Por qué:* el dueño entiende “cuánta gente tengo” y “qué quiero controlar”; los módulos nuevos se venden como upgrade; el tramo evita castigar cada alta.

### Estructura 2 — “Por operario activo”

| Plan | Incluye | Métrica | Precio hipótesis |
|---|---|---|---|
| **Base** | Asistencia completa | USD por operario activo por mes, mínimo 10 | USD 1,5–2,5 |
| **Productividad** | Base + producción (OT/etapas/tablero/reportes) | Ídem | USD 3–5 |
| **Industria** | Productividad + stock, compras, OP, calidad, mantenimiento | Ídem | USD 6–9 |

*Por qué:* escala perfecto con el tamaño y es fácil de comparar con apps de fichaje [HIPÓTESIS]. *Riesgo:* facturas variables y ruido en la discusión de precio por persona.

### Estructura 3 — “Por planta + implementación” (para clientes medianos o multi-planta)

| Componente | Incluye | Métrica | Precio hipótesis |
|---|---|---|---|
| **Licencia por planta** | Todo Planta + hasta 60 operarios en esa planta + kiosco | Planta por mes | USD 120–200 |
| **Módulos** | Stock / Compras / OP / Calidad / Mantenimiento | Por planta | USD 30–60 cada uno |
| **Implementación** | Relevamiento, configuración de rutas y etapas, migración de OT/artículos, capacitación | Proyecto | USD 800–3.000 |

*Por qué:* así compra la industria mediana; asegura ingreso inicial. *Riesgo:* ciclo de venta largo.

**Recomendación:** lanzar con la **Estructura 1** (Asistencia y Planta por tramos + add-ons + puesta en marcha opcional), **trial de 30 días de Planta** en lugar de Free con publicidad, y dejar la Estructura 3 como “Enterprise” a medida. Validar con 5–10 clientes: (a) disposición a pagar por Asistencia vs. Planta, (b) si el tramo de 15 cubre a la pyme típica, (c) cuánto valoran la puesta en marcha. **Datos necesarios para validar:** precio que pagan hoy por reloj biométrico o software; cantidad de operarios; si liquidan sueldos internamente o con estudio contable; disposición a pagar en USD indexado vs. ARS fijo.

## 5. Requisitos fiscales de Argentina — **puntos a validar con un contador (no es asesoramiento)**

1. **Condición fiscal de Gypi:** monotributo (categoría y tope anual de facturación) vs. Responsable Inscripto. Define el tipo de comprobante (**C** vs. **A/B**) y si se discrimina IVA (21% en servicios digitales).
2. **Datos del cliente en la factura:** razón social, **CUIT**, condición frente al IVA y domicilio fiscal. Hoy se factura a consumidor final (`DocTipo 99`), lo que probablemente no sirve para que la pyme deduzca el gasto. Hay que agregar un **perfil fiscal** por empresa (Fase 7).
3. **Momento de emisión:** factura al acreditarse el pago (hoy, en el webhook) vs. al inicio del período; tratamiento de anuales (¿una factura o mensuales?).
4. **Notas de crédito** para reembolsos o cobros erróneos; anulaciones.
5. **Punto de venta** habilitado para facturación electrónica por web service (`wsfe`) y certificado; custodia segura del certificado y la clave (hoy irían en variables de entorno).
6. **Ingresos Brutos:** jurisdicción (Córdoba, CABA, Convenio Multilateral si hay clientes en varias provincias); retenciones y percepciones que aplica Mercado Pago.
7. **Comisiones de Mercado Pago** (tasa + IVA sobre la comisión) y plazos de acreditación; impacto en el precio neto [HIPÓTESIS: validar las tarifas vigentes de suscripciones].
8. **Moneda e indexación:** precios en USD de referencia cobrados en ARS, cláusula de actualización en los términos (hoy dice “30 días de preaviso”), tipo de cambio a usar.
9. **Clientes del exterior** (si los hubiera): factura E de exportación de servicios y su régimen.
10. **Impuesto a los débitos y créditos bancarios, Ganancias o componente impositivo del monotributo:** estimación del costo fiscal total sobre el ingreso.
11. **Datos personales (Ley 25.326):** inscripción de bases en la AAIP, rol de Gypi como encargado de tratamiento de los datos de los empleados de cada cliente, transferencia internacional (servidores fuera de Argentina) y contrato o DPA con cada empresa.
12. **Defensa del consumidor / “botón de baja”:** si algún cliente fuese persona humana (monotributista pequeño), verificar la obligación del botón de baja visible [HIPÓTESIS].
13. **Google Play con cuenta personal:** datos que Google publica del desarrollador, y requisitos para cuentas personales nuevas (pruebas cerradas con testers durante un período antes de producción [HIPÓTESIS: validar la política vigente]); evaluar migrar a una cuenta de organización cuando haya razón social.

## 6. Sobre “la Play Store como forma de monetizar”

- **Lo que sí aporta Play:** confianza (“está en la store”), instalación de un toque en el 100% Android de la planta, actualizaciones automáticas del *shell* y descubrimiento marginal [HIPÓTESIS: el B2B industrial casi no se descubre buscando en la store].
- **Lo que no conviene:** vender la suscripción dentro de la app. Si se vende dentro, Google exige su sistema de cobro y retiene comisión [HIPÓTESIS: ~15% en suscripciones]; además se pierde la factura propia y el control de precios. Si la app **solo hace login** y el contrato se hace afuera (web, Mercado Pago, transferencia), en general no aplica comisión [HIPÓTESIS: validar la política vigente de Google Play para apps B2B].
- **Conclusión:** publicar la TWA en Play como **canal de distribución** (Fase 5, opción E) y monetizar con la suscripción por fuera.

---

## 7. Tabla de hallazgos

| ID | Sev. | Esf. | Categoría | Evidencia | Recomendación |
|---|---|---|---|---|---|
| F6-01 | **Alto** | M | Legal / datos | Los términos prometen exportación a pedido y borrado a los 30 días de la cancelación (y a los 90 en Free); no hay implementación | Implementar export + baja con retención, o ajustar los términos ya |
| F6-02 | **Alto** | M | Fiscal / billing | Sin perfil fiscal del cliente; la Factura C sale a consumidor final (`afip.js:83-94`) | Perfil fiscal obligatorio para planes pagos + factura al CUIT (validar el tipo con el contador) |
| F6-03 | **Alto** | M | Billing | El cobro real nunca se probó; bugs F1-08/09, F2-11 | Prueba de punta a punta en sandbox de MP + corrección de bugs antes del primer cliente |
| F6-04 | **Alto** | M | Producto / billing | Planes y módulos en código; *entitlements* solo parciales | Tablas `planes/modulos/empresa_modulos` + `requireModulo` en el servidor |
| F6-05 | Medio | S | Billing | Monto fijo en ARS sin indexación | Actualización programada del preapproval + aviso por email |
| F6-06 | Medio | M | Billing | Sin medición de operarios activos, IA ni storage | Tabla de uso mensual por empresa (sirve para cobrar y para ver costos) |
| F6-07 | Medio | S | Legal | Términos sin titular identificado, proveedores incompletos, sin DPA ni SLA | Redactar con un abogado; DPA estándar para clientes |
| F6-08 | Medio | S | Producto | Plan Free con AdSense | Reemplazar por un trial de 30 días (o un Free mínimo sin publicidad) |
| F6-09 | Medio | M | Superadmin | No gestiona módulos, add-ons, pagos manuales ni consumo | Ampliar el panel (con el 2FA de F2-13) |
| F6-10 | Bajo | S | Soporte | Sin canal ni SLA definidos | WhatsApp Business + base de conocimiento + página de estado |
| F6-11 | Bajo | S | Billing | Sin descarga de facturas ni historial para el cliente | Sección “Comprobantes” en Billing |

---

## Preguntas abiertas

1. **Condición fiscal actual:** ¿sos monotributista o Responsable Inscripto? ¿Tenés punto de venta electrónico habilitado? (Define F6-02; validarlo con tu contador.)
2. **Estructura de planes:** ¿te resulta más natural cobrar **por tramos de operarios + módulos** (Estructura 1) o **por operario activo** (Estructura 2)?
3. **Puesta en marcha:** ¿estás dispuesto a ofrecer implementación paga (carga inicial, capacitación) o preferís un producto 100% self-service?
4. **Moneda:** ¿preferís precios en **ARS con actualización** o **USD de referencia cobrados en ARS**?
5. **Plan Free:** ¿lo mantenemos mínimo y sin publicidad, o lo reemplazamos por un **trial de 30 días**?
