// app/lib/ip.js — IP del cliente para auditoría y límites de intentos (F2-20).
//
// En Vercel, `x-real-ip` lo pone la plataforma con la IP real de quien se
// conecta. `x-forwarded-for` puede traer valores agregados por el propio
// cliente; si hay que usarlo, solo vale el primero. Lo que no tenga forma de
// IP se descarta: así nadie mete texto arbitrario en el registro de
// auditoría ni rota la clave del rate limit a voluntad.

const RE_IP = /^[0-9a-fA-F:.]{2,45}$/;

/** @param {Request} request @returns {string} IP o "unknown" */
export function ipCliente(request) {
  const h = request?.headers;
  if (!h?.get) return "unknown";
  const candidatos = [h.get("x-real-ip"), h.get("x-forwarded-for")?.split(",")[0]];
  for (const c of candidatos) {
    const ip = c?.trim();
    if (ip && RE_IP.test(ip)) return ip;
  }
  return "unknown";
}
