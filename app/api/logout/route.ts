import { NextResponse } from "next/server";

export async function POST(): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true });
  const cookieBase = { path: "/" as const, maxAge: 0 };
  res.cookies.set({ name: "gypi_token",   value: "", ...cookieBase });
  res.cookies.set({ name: "gypi_refresh", value: "", ...cookieBase });
  return res;
}
