// POST /api/empleados/tarjetas-email — manda al email del dueño las tarjetas
// con QR del equipo recién cargado (R10 de la reforma UX).
//
// Body: { tarjetas: [{ legajo, codigo }] }
// Los códigos solo existen en texto plano en la pantalla del alta (en la base
// queda el hash). Por eso los manda el navegador, y acá se comparan contra el
// hash de cada empleado: solo salen los que coinciden, con el nombre y el link
// armados en el servidor. El destino es siempre el email de la empresa, nunca
// uno que venga en el pedido.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { sbGet } from "../../../lib/sbHelpers";
import { hashCodigo, linkActivacion } from "../../../lib/activacion";
import { rechazarSiSupervisor } from "../../../lib/alcance";
import { checkRateLimit } from "../../../lib/rateLimitMemory";
import { htmlTarjetas } from "../../../lib/tarjetasQR";
import { sendTarjetasQR } from "../../../lib/email";

const APP_BASE = process.env.NEXT_PUBLIC_APP_URL || "https://gypi.app";
const MAX_TARJETAS = 500;
const CODIGO = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export async function POST(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return respuestaNoAutorizado();
  if (!["gerencial", "administrativo"].includes(sesion.rol)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  const bloqueoSupervisor = await rechazarSiSupervisor(sesion);
  if (bloqueoSupervisor) return bloqueoSupervisor;

  const body = await request.json().catch(() => ({}));
  const pedidas = Array.isArray(body?.tarjetas) ? body.tarjetas : null;
  if (!pedidas?.length || pedidas.length > MAX_TARJETAS) {
    return NextResponse.json({ error: "No hay tarjetas para mandar" }, { status: 400 });
  }
  const validas = pedidas.filter((t) => Number.isInteger(t?.legajo) && t.legajo > 0 && CODIGO.test(String(t?.codigo || "")));
  if (validas.length === 0) return NextResponse.json({ error: "No hay tarjetas para mandar" }, { status: 400 });

  if (checkRateLimit(`tarjetas-email:${sesion.empresa_id}`, 5, 60 * 60_000).limited) {
    return NextResponse.json({ error: "Ya te mandamos varios emails. Probá de nuevo en un rato." }, { status: 429 });
  }

  const [empresa] = await sbGet(`empresa?id=eq.${sesion.empresa_id}&select=nombre,slug,admin_email&limit=1`) || [];
  if (!empresa?.admin_email) {
    return NextResponse.json({ error: "Tu empresa no tiene un email cargado" }, { status: 400 });
  }

  const legajos = [...new Set(validas.map((t) => t.legajo))].join(",");
  const empleados = await sbGet(
    `empleados?empresa_id=eq.${sesion.empresa_id}&legajo=in.(${legajos})&activo=eq.true&select=legajo,nombre,activacion_codigo_hash`
  ) || [];
  const porLegajo = new Map(empleados.map((e) => [e.legajo, e]));
  const tarjetas = validas
    .filter((t) => {
      const e = porLegajo.get(t.legajo);
      return e?.activacion_codigo_hash && e.activacion_codigo_hash === hashCodigo(t.codigo);
    })
    .map((t) => ({
      legajo: t.legajo,
      codigo: t.codigo,
      nombre: porLegajo.get(t.legajo).nombre,
      link: linkActivacion(APP_BASE, empresa.slug, t.codigo),
    }));
  if (tarjetas.length === 0) {
    return NextResponse.json({ error: "Esos códigos ya no sirven. Generá nuevos desde Personal." }, { status: 400 });
  }

  const htmlImprimible = await htmlTarjetas({
    titulo: "Códigos de acceso",
    empresa: empresa.nombre,
    tarjetas: tarjetas.map((t) => ({
      nombre: t.nombre,
      detalle: `Legajo ${t.legajo} · Código ${t.codigo}`,
      link: t.link,
      pie: "Escaneá con la cámara del celular y creá tu contraseña. Sirve una vez.",
    })),
  });

  const enviado = await sendTarjetasQR({
    to: empresa.admin_email,
    empresa: empresa.nombre,
    tarjetas,
    htmlImprimible,
    empresaId: sesion.empresa_id,
  });
  if (!enviado) {
    return NextResponse.json({ error: "No pudimos mandar el email. Imprimilas desde acá o probá en un rato." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, email: empresa.admin_email, enviadas: tarjetas.length });
}
