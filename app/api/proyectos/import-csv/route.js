// app/api/proyectos/import-csv — Importación masiva de proyectos desde CSV.
//
// POST con body text/plain (CSV) o JSON { csv: "..." }
// Headers esperados (case-insensitive, busca substring): ot, cliente, obra, proyecto, division
// Columna obligatoria: ot
// Solo accesible para roles: gerencial, administrativo
import { NextResponse } from "next/server";
import { validarToken } from "../../../lib/auth";
import { parseCsv } from "../../../lib/csv";
import { PLANES } from "../../../lib/plans";
import { sbGet, sbPost } from "../../../lib/sbHelpers";

const ROLES_PERMITIDOS = new Set(["gerencial", "administrativo"]);
const BATCH_SIZE = 50;

export async function POST(req) {
  const sesion = await validarToken(req);
  if (!sesion) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (!ROLES_PERMITIDOS.has(sesion.rol)) {
    return NextResponse.json({ error: "Solo gerencial o administrativo puede importar proyectos" }, { status: 403 });
  }

  const empresaId = sesion.empresa_id;

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

  const colOt = headers.find((h) => h.includes("ot"));
  if (!colOt) {
    return NextResponse.json({
      error: "El CSV debe tener al menos la columna: ot",
      headers_encontrados: headers,
    }, { status: 400 });
  }
  const colCliente = headers.find((h) => h.includes("cliente"));
  const colObra = headers.find((h) => h.includes("obra"));
  const colProyecto = headers.find((h) => h.includes("proyecto"));
  const colDivision = headers.find((h) => h.includes("divis"));

  const existentes = await sbGet(`proyectos?empresa_id=eq.${empresaId}&select=ot`);
  const otsExistentes = new Set((existentes || []).map((p) => String(p.ot)));

  const empresaData = await sbGet(`empresa?id=eq.${empresaId}&select=plan_activo`);
  const planActivo = empresaData?.[0]?.plan_activo || "free";
  const maxProyectos = (PLANES[planActivo] ?? PLANES.free).max_proyectos;
  const actuales = otsExistentes.size;

  const results = { created: 0, skipped: 0, errors: [...parseErrors] };
  let added = 0;

  const batch = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const ot = row[colOt]?.trim();
    if (!ot) {
      results.errors.push(`Fila ${rowNum}: OT vacía`);
      continue;
    }

    if (otsExistentes.has(ot)) {
      results.skipped++;
      continue;
    }

    if (actuales + added >= maxProyectos) {
      results.errors.push(`Fila ${rowNum}: límite de proyectos alcanzado (${maxProyectos})`);
      continue;
    }

    batch.push({
      rowNum,
      ot,
      cliente: colCliente ? row[colCliente]?.trim() || null : null,
      obra: colObra ? row[colObra]?.trim() || null : null,
      proyecto: colProyecto ? row[colProyecto]?.trim() || null : null,
      division: colDivision ? row[colDivision]?.trim() || null : null,
    });
    added++;
    otsExistentes.add(ot);
  }

  for (let b = 0; b < batch.length; b += BATCH_SIZE) {
    const chunk = batch.slice(b, b + BATCH_SIZE);
    const payloads = chunk.map(({ ot, cliente, obra, proyecto, division }) => ({
      empresa_id: empresaId,
      ot,
      cliente,
      obra,
      proyecto,
      division,
      estado: "activo",
    }));

    try {
      const created = await sbPost("proyectos", payloads);
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
