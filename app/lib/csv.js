// app/lib/csv.js — Parser CSV minimal sin dependencias externas.
// Soporta: comillas para campos con comas, CRLF y LF, espacios en headers.

/**
 * Parsea texto CSV y devuelve array de objetos usando la primera fila como headers.
 * @param {string} text
 * @returns {{ headers: string[], rows: Record<string,string>[], errors: string[] }}
 */
export function parseCsv(text) {
  if (!text || typeof text !== "string") {
    return { headers: [], rows: [], errors: ["Archivo vacío o inválido"] };
  }

  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length < 2) {
    return { headers: [], rows: [], errors: ["Se necesita al menos una fila de headers y una de datos"] };
  }

  const headers = splitCsvLine(nonEmpty[0]).map((h) => h.trim().toLowerCase());
  const rows = [];
  const errors = [];

  for (let i = 1; i < nonEmpty.length; i++) {
    const parts = splitCsvLine(nonEmpty[i]);
    if (parts.length !== headers.length) {
      errors.push(`Fila ${i + 1}: esperaba ${headers.length} columnas, encontró ${parts.length}`);
      continue;
    }
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = parts[j].trim();
    }
    rows.push(row);
  }

  return { headers, rows, errors };
}

/**
 * Divide una línea CSV respetando comillas dobles.
 * @param {string} line
 * @returns {string[]}
 */
function splitCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
