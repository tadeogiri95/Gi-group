import { ZodSchema, ZodError } from "zod";
import { NextResponse } from "next/server";
import { CAMPOS_PERMITIDOS } from "./schemas";

/**
 * Validate body against a Zod schema. Returns { data } on success or { error, response } on failure.
 */
export function validateBody<T>(schema: ZodSchema<T>, body: unknown): { data: T; error?: never; response?: never } | { data?: never; error: string; response: NextResponse } {
  const result = schema.safeParse(body);
  if (result.success) {
    return { data: result.data };
  }
  const msg = result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
  return {
    error: msg,
    response: NextResponse.json({ error: `Datos inválidos: ${msg}` }, { status: 400 }),
  };
}

/**
 * Strip fields not in the whitelist for a given table+method in /api/data.
 * Always removes empresa_id (injected from session).
 */
export function stripUnallowedFields(body: Record<string, unknown>, tabla: string, method: string): Record<string, unknown> {
  const allowed = CAMPOS_PERMITIDOS[tabla]?.[method];
  if (!allowed) return body;

  const clean: Record<string, unknown> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) clean[key] = body[key];
  }
  return clean;
}

/**
 * Validate that a string is a valid UUID v4.
 */
export function isUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/**
 * Sanitize a PostgREST parameter value — strip characters that could
 * inject operators or break the query syntax.
 */
export function sanitizePostgrestParam(value: string): string {
  return value.replace(/[;'"\\()&|!,]/g, "").slice(0, 200);
}

/**
 * Safe error message for production — never expose internal details.
 */
export function safeErrorMessage(err: unknown): string {
  if (process.env.NODE_ENV === "development") {
    return err instanceof Error ? err.message : "Error desconocido";
  }
  return "Error interno del servidor";
}
