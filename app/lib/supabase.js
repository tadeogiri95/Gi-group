// ═══════════════════════════════════════════════════════════
// Cliente Supabase SEGURO — pasa por /api/data (servidor)
// Las API keys ya NO están en el código del navegador
// ═══════════════════════════════════════════════════════════

async function req(method, path, body) {
  const res = await fetch("/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, path, body }),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json.error || `Error ${res.status}`);
  }
  return json.data;
}

export const sb = {
  get: (path) => req("GET", path),
  post: (path, data) => req("POST", path, data),
  patch: (path, data) => req("PATCH", path, data),
  del: (path) => req("DELETE", path),
};

// Ya NO exportamos URL ni KEY — quedan solo en el servidor
