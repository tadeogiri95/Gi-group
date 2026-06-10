"use client";
// Singleton del cliente Supabase para Realtime (solo browser)
// Requiere NEXT_PUBLIC_SUPABASE_ANON_KEY — degrada silenciosamente si no está
import { createClient } from "@supabase/supabase-js";

let _client = null;

export function getRealtimeClient() {
  if (typeof window === "undefined") return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!_client) {
    _client = createClient(url, key, {
      realtime: { params: { eventsPerSecond: 2 } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}
