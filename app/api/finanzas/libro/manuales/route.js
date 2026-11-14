// /api/finanzas/libro/manuales — Finanzas → Contabilidad → 📗 Libro de Google
// (etapa 7 de la auditoría de Finanzas integrada, 14/11; reglas en
// app/lib/finanzasLibroManual.js). Sin migración.
//
//   GET → lo cargado a mano en el libro que Gypi todavía no tiene (lo deja el
//       script en cada vuelta en config_sistema "finanzas_libro"), con los
//       nombres de las cuentas.
//   POST { accion: "incorporar", claves, tc } → lo carga a Gypi como el
//       Histórico (origen "libro", la misma clave del renglón). tc: tipo de
//       cambio por clave para lo que está en dólares.
//   POST { accion: "ignorar", claves } → no se vuelve a mostrar (en el libro
//       se despinta en la próxima vuelta).
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige).
import { NextResponse } from "next/server";
import { sbGet, sbGetAll, sbPatch, sbPost } from "../../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../../lib/planEnforcement";
import { broadcastRefresh } from "../../../../lib/broadcast";
import { sesionDueno, errorFinanzas } from "../../../../lib/finanzasApi";
import { CLAVE_LIBRO_FIN } from "../../../../lib/finanzasLibro";
import { ORIGEN_LIBRO, limpiarOperacionHistorico } from "../../../../lib/finanzasHistorico";
import { CARGADA_POR_MANUAL, operacionManual, sinClaves, sumarIgnorados } from "../../../../lib/finanzasLibroManual";

const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);
const filtroCfg = (e) => `config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_LIBRO_FIN}`;
const leerCfg = async (e) => (await sbGet(`${filtroCfg(e)}&select=valor&limit=1`, { silent: true, fallback: [] }))?.[0]?.valor || null;

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const e = sesion.empresa_id;
  try {
    const valor = await leerCfg(e);
    const m = valor?.manuales || null;
    const usadas = [...new Set((m?.pendientes || []).flatMap((o) => [o.cuenta_debe, o.cuenta_haber]))];
    const cuentas = usadas.length
      ? await leer(sesion, `fin_cuentas?empresa_id=eq.${e}&codigo=in.(${encodeURIComponent(usadas.map((c) => `"${String(c).replace(/"/g, "")}"`).join(","))})&select=codigo,nombre`)
      : [];
    return NextResponse.json({
      conectado: !!valor?.hash,
      ultima_lectura: valor?.ultima_lectura || null,
      revisado_at: m?.at || null,
      desde: m?.desde || null,
      pendientes: m?.pendientes || [],
      total: Number(m?.total) || 0,
      faltan_cuentas: m?.faltan_cuentas || [],
      error: m?.error || null,
      ignorados: (valor?.manuales_ignorados || []).length,
      cuentas: Object.fromEntries(cuentas.map((c) => [c.codigo, c.nombre])),
    });
  } catch (err) {
    return errorFinanzas(err, "libro manuales GET");
  }
}

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  const e = sesion.empresa_id;
  const d = await request.json().catch(() => null);
  const claves = [...new Set((Array.isArray(d?.claves) ? d.claves : []).map(String).filter((c) => c && c.length <= 60))];
  if (!claves.length) return NextResponse.json({ error: "Elegí qué renglones" }, { status: 400 });
  if (claves.length > 500) return NextResponse.json({ error: "Hasta 500 por vez" }, { status: 400 });
  try {
    const valor = await leerCfg(e);
    if (!valor?.hash) return NextResponse.json({ error: "El libro no está conectado" }, { status: 400 });
    if (d.accion === "ignorar") {
      await sbPatch(filtroCfg(e), { valor: { ...valor, manuales: sinClaves(valor.manuales, claves), manuales_ignorados: sumarIgnorados(valor.manuales_ignorados, claves) } });
      return NextResponse.json({ ok: true, ignorados: claves.length });
    }
    if (d.accion !== "incorporar") return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
    const porClave = new Map((valor.manuales?.pendientes || []).map((o) => [o.origen_id, o]));
    const elegidas = claves.map((c) => porClave.get(c)).filter(Boolean);
    if (!elegidas.length) return NextResponse.json({ error: "Esos renglones ya no están pendientes: actualizá la pantalla" }, { status: 409 });
    // Lo que ya entró (por otra pestaña o el Histórico) no se repite
    const lista = elegidas.map((o) => `"${String(o.origen_id).replace(/"/g, "")}"`).join(",");
    const ya = new Set((await leer(sesion, `fin_operaciones?empresa_id=eq.${e}&origen=eq.${ORIGEN_LIBRO}&anulada_at=is.null&origen_id=in.(${encodeURIComponent(lista)})&select=origen_id`)).map((o) => o.origen_id));
    const [cuentas, proveedores, clientes] = await Promise.all([
      leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo`),
      leer(sesion, `proveedores?empresa_id=eq.${e}&select=id`, 10000),
      leer(sesion, `fin_clientes?empresa_id=eq.${e}&select=id`, 10000),
    ]);
    const ctx = { codigos: new Set(cuentas.map((c) => c.codigo)), proveedores: new Set(proveedores.map((p) => Number(p.id))), clientes: new Set(clientes.map((c) => Number(c.id))) };
    const tc = d.tc && typeof d.tc === "object" ? d.tc : {};
    const ahora = new Date().toISOString();
    const filas = [];
    for (const o of elegidas) {
      if (ya.has(o.origen_id)) continue;
      const r = limpiarOperacionHistorico(operacionManual(o, tc[o.origen_id]), ctx);
      if (r.error) return NextResponse.json({ error: `Renglón ${o.fila || "?"} del libro: ${r.error}` }, { status: 400 });
      filas.push({ ...r.fila, empresa_id: e, cargada_por_nombre: CARGADA_POR_MANUAL, created_at: ahora, updated_at: ahora });
    }
    if (filas.length) await sbPost("fin_operaciones", filas, { sesion });
    // Se vuelve a leer por si el script escribió en el medio
    const actual = (await leerCfg(e)) || valor;
    await sbPatch(filtroCfg(e), { valor: { ...actual, manuales: sinClaves(actual.manuales, elegidas.map((o) => o.origen_id)) } });
    broadcastRefresh(e, "fin_operaciones");
    return NextResponse.json({ ok: true, incorporadas: filas.length, ya_estaban: elegidas.length - filas.length });
  } catch (err) {
    return errorFinanzas(err, "libro manuales POST");
  }
}
