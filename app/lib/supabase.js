const SUPABASE_URL = "https://olhrkpaxadrtvhbewkff.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9saHJrcGF4YWRydHZoYmV3a2ZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MDQ0OTksImV4cCI6MjA5NDQ4MDQ5OX0.oMs25ZKlOASVXfg0xSHvaUxDd3d5_cX3ZzdXZ1JtAi0";

async function req(path, opts = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...opts.headers,
  };
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${res.status}: ${err}`);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

export const sb = {
  get: (path) => req(path),
  post: (path, data) => req(path, { method: "POST", body: JSON.stringify(data) }),
  patch: (path, data) => req(path, { method: "PATCH", body: JSON.stringify(data) }),
  del: (path) => req(path, { method: "DELETE" }),
};

export { SUPABASE_URL, SUPABASE_KEY };
