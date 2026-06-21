// app/api/empleados/import-csv — Importación masiva de empleados desde CSV.
//
// POST con body text/plain (CSV) o JSON { csv: "..." }
// Headers esperados (case-insensitive): legajo, nombre, email, area, division, rol, diagrama
// Columnas obligatorias: legajo, nombre
// Solo accesible para roles: gerencial, administrativo
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { validarToken } from "../../../lib/auth";
import { parseCsv } from "../../../lib/csv";
import { passwordInicial } from "../../../lib/passwords";
import { PLANES } from "../../../lib/plans";
import { sbGet, sbPost } from "../../../lib/sbHelpers";
import { validarFormatoEmail } from "../../../lib/rateLimit";

const ROLES_VALIDOS = ["operativo", "gerencial", "administrativo"];
const ROLES_PERMITIDOS = new Set(["gerencial", "administrativo"]);

export async function POST(req) {
  // Autenticación
  const sesion = await validarToken(req);
  if (!sesion) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (!ROLES_PERMITIDOS.has(sesion.rol)) {
    return NextResponse.json({ error: "Solo gerencial o administrativo puede importar empleados" }, { status: 403 });
  }

  const empresaId = sesion.empresa_id;

  // Leer CSV del body
  let csvText;
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await req.json();
    csvText = body.csv;
  } else {
    csvText = await req.text();
  }

  if (!csvText || typeof csvText !== "string") {
    return NextResponse.json({ error: "Body vacío o inválido. Enviá el CSV como text/plain o JSON {csv: '...'}" }, { status: 400 });
  }
  if (csvText.length > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "Archivo demasiado grande (máximo 5 MB)" }, { status: 413 });
  }

  const { headers, rows, errors: parseErrors } = parseCsv(csvText);

  if (!headers.includes("legajo") || !headers.includes("nombre")) {
    return NextResponse.json({
      error: "El CSV debe tener al menos las columnas: legajo, nombre",
      headers_encontrados: headers,
    }, { status: 400 });
  }

  // Legajos existentes para skip duplicados
  const existentes = await sbGet(`empleados?empresa_id=eq.${empresaId}&select=legajo`);
  const legajosExistentes = new Set((existentes || []).map((e) => Number(e.legajo)));

  // Verificar límite de plan — fuente de verdad: PLANES[], no empresa.max_empleados
  const empresaData = await sbGet(`empresa?id=eq.${empresaId}&select=plan_activo`);
  const planActivo = empresaData?.[0]?.plan_activo || "free";
  const maxEmpleados = (PLANES[planActivo] ?? PLANES.free).max_empleados;
  const actuales = legajosExistentes.size;

  const results = { created: 0, skipped: 0, errors: [...parseErrors] };
  let added = 0;

  // Validar todas las filas primero, acumular batch para insert masivo
  const batch = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const legajo = parseInt(row.legajo, 10);
    if (isNaN(legajo) || legajo <= 0) {
      results.errors.push(`Fila ${rowNum}: legajo inválido ("${row.legajo}")`);
      continue;
    }

    const nombre = row.nombre?.trim();
    if (!nombre) {
      results.errors.push(`Fila ${rowNum}: nombre vacío`);
      continue;
    }

    if (legajosExistentes.has(legajo)) {
      results.skipped++;
      continue;
    }

    if (actuales + added >= maxEmpleados) {
      results.errors.push(`Fila ${rowNum}: límite de empleados alcanzado (${maxEmpleados})`);
      continue;
    }

    const rol = ROLES_VALIDOS.includes(row.rol) ? row.rol : "operativo";

    const emailRaw = row.email?.trim() || null;
    if (emailRaw && !validarFormatoEmail(emailRaw)) {
      results.errors.push(`Fila ${rowNum}: email inválido ("${emailRaw}")`);
      continue;
    }

    batch.push({ rowNum, legajo, nombre, emailRaw, rol, row });
    added++;
    legajosExistentes.add(legajo);
  }

  // Hash passwords en paralelo y hacer bulk insert en lotes de 50
  const BATCH_SIZE = 50;
  for (let b = 0; b < batch.length; b += BATCH_SIZE) {
    const chunk = batch.slice(b, b + BATCH_SIZE);

    const withHashes = await Promise.all(
      chunk.map(async (item) => ({
        ...item,
        passwordHash: await bcrypt.hash(passwordInicial(), 10),
      }))
    );

    const payloads = withHashes.map(({ legajo, nombre, emailRaw, rol, row, passwordHash }) => ({
      empresa_id: empresaId,
      legajo,
      nombre,
      apodo: nombre.split(" ")[0],
      email: emailRaw,
      area: row.area?.trim() || "produccion",
      division: row.division?.trim() || null,
      rol,
      activo: true,
      password: passwordHash,
      debe_cambiar_password: true,
    }));

    try {
      const created = await sbPost("empleados", payloads);
      if (Array.isArray(created)) {
        results.created += created.length;
      } else {
        results.errors.push(`Lote ${Math.floor(b / BATCH_SIZE) + 1}: respuesta inesperada del servidor`);
      }
    } catch (e) {
      const rowNums = chunk.map((c) => c.rowNum).join(",");
      results.errors.push(`Filas ${rowNums}: ${e.message}`);
    }
  }

  return NextResponse.json({
    ok: true,
    ...results,
    total_procesadas: rows.length,
  });
}
