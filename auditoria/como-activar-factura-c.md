# Cómo activar la Factura C automática (ítem 26)

Cada pago aprobado de Mercado Pago genera solo una **Factura C** a nombre de la empresa cliente (con su CUIT) y el dueño la descarga desde **Suscripción → Historial de pagos → Ver factura**. El código ya está; falta habilitarlo en ARCA y cargar los datos en Vercel. **No me pases ninguna clave:** todo se pega directo en Vercel.

> Hasta que esto esté completo, los pagos funcionan igual: simplemente no se emite la factura (queda registrado que falta).

## 1. En ARCA (con tu contador, recomendado)

Con tu **Clave Fiscal nivel 3**:
1. **Punto de venta para web services:** *Administración de puntos de venta y domicilios* → **Agregar** → sistema **"Factura Electrónica - Monotributo - Web Services"**. Anotá el número (por ejemplo, 2).
2. **Certificado digital:** *Administración de Certificados Digitales* → generar el certificado (`.crt`) a partir de un pedido (`.csr`) y guardar la clave privada (`.key`). Tu contador lo puede generar; es el paso más técnico.
3. **Autorizar el servicio:** *Administrador de Relaciones de Clave Fiscal* → **Nueva relación** → servicio **"Facturación Electrónica" (wsfe)** → representante: el certificado del paso 2.

## 2. Cuenta en Afip SDK (gratis)

La app habla con ARCA a través de Afip SDK. Creá una cuenta en <https://app.afipsdk.com> y copiá tu **access token**.

## 3. Cargar en Vercel

**Settings → Environment Variables** (solo **Production**):

| Variable | Valor |
|---|---|
| `AFIP_ACCESS_TOKEN` | el token del paso 2 |
| `AFIP_CUIT` | tu CUIT, solo números |
| `AFIP_CERT` | el contenido completo del `.crt` |
| `AFIP_KEY` | el contenido completo del `.key` |
| `AFIP_PUNTO_VENTA` | el número del paso 1.1 |
| `AFIP_RAZON_SOCIAL` | tu nombre como figura en ARCA |
| `AFIP_DOMICILIO` | tu domicilio fiscal |
| `AFIP_INICIO_ACTIVIDADES` | la fecha de inicio de actividades (dd/mm/aaaa) |
| `AFIP_IIBB` | tu número de Ingresos Brutos (o "Exento") |

**Redeploy.** Desde el próximo pago aprobado, se emite la factura.

## 4. Probar sin facturar de verdad

Con **solo** `AFIP_ACCESS_TOKEN` (sin `AFIP_CUIT`, `AFIP_CERT` ni `AFIP_KEY`), la app usa el ambiente de pruebas de ARCA: las facturas que emite no tienen validez fiscal. Sirve para ver todo el circuito en una cuenta de prueba de Mercado Pago antes de activar lo real.

## Lo que tiene que cargar cada cliente

Antes de elegir un plan, el dueño completa en **Suscripción → Datos de facturación**: razón social, CUIT, condición frente al IVA y domicilio fiscal. Sin eso, la app no lo deja pagar. El CUIT se valida con el dígito verificador.
