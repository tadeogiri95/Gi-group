"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { C, fH, fB } from "./lib/theme";

export default function Landing() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [modo, setModo] = useState("ingresar"); // ingresar | registrar
  const [form, setForm] = useState({ nombre_empresa: "", nombre_admin: "", email: "", password: "", rubro: "" });
  const [msg, setMsg] = useState("");
  const [cargando, setCargando] = useState(false);

  async function registrar(e) {
    e.preventDefault();
    setCargando(true);
    setMsg("");
    try {
      const res = await fetch("/api/registro-empresa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al registrar");
      setMsg(`¡Empresa creada! Tu link: /${data.empresa.slug}`);
      setTimeout(() => router.push(`/${data.empresa.slug}`), 2000);
    } catch (err) {
      setMsg(err.message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: C.bg, padding: 24 }}>
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <h1 style={{ fontFamily: fH, fontSize: 32, color: C.pri, margin: 0 }}>Gypi</h1>
        <p style={{ fontFamily: fB, fontSize: 15, color: C.t2, marginTop: 8 }}>Gestión de personal inteligente</p>
      </div>

      {modo === "ingresar" ? (
        <div style={{ width: "100%", maxWidth: 340 }}>
          <form onSubmit={(e) => { e.preventDefault(); if (slug.trim()) router.push(`/${slug.trim().toLowerCase()}`); }}
            style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input
              placeholder="Slug de tu empresa"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              style={{ fontFamily: fB, fontSize: 15, padding: "12px 16px", borderRadius: 10, border: `1px solid ${C.brd}`, background: C.card, color: C.t1, outline: "none" }}
            />
            <button type="submit"
              style={{ fontFamily: fH, fontSize: 15, padding: "12px 0", borderRadius: 10, background: C.pri, color: "#fff", border: "none", cursor: "pointer" }}>
              Ingresar
            </button>
          </form>
          <p style={{ fontFamily: fB, fontSize: 13, color: C.t3, textAlign: "center", marginTop: 16 }}>
            ¿No tenés empresa?{" "}
            <span onClick={() => setModo("registrar")} style={{ color: C.pri, cursor: "pointer", textDecoration: "underline" }}>
              Registrate gratis
            </span>
          </p>
        </div>
      ) : (
        <div style={{ width: "100%", maxWidth: 380 }}>
          <form onSubmit={registrar} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { key: "nombre_empresa", ph: "Nombre de la empresa" },
              { key: "nombre_admin", ph: "Tu nombre completo" },
              { key: "email", ph: "Email", type: "email" },
              { key: "password", ph: "Contraseña", type: "password" },
              { key: "rubro", ph: "Rubro (opcional)" },
            ].map(({ key, ph, type }) => (
              <input
                key={key}
                placeholder={ph}
                type={type || "text"}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                style={{ fontFamily: fB, fontSize: 15, padding: "12px 16px", borderRadius: 10, border: `1px solid ${C.brd}`, background: C.card, color: C.t1, outline: "none" }}
              />
            ))}
            <button type="submit" disabled={cargando}
              style={{ fontFamily: fH, fontSize: 15, padding: "12px 0", borderRadius: 10, background: C.pri, color: "#fff", border: "none", cursor: "pointer", opacity: cargando ? 0.6 : 1 }}>
              {cargando ? "Creando…" : "Crear empresa"}
            </button>
          </form>
          {msg && <p style={{ fontFamily: fB, fontSize: 13, color: msg.includes("¡") ? C.ok : C.err, textAlign: "center", marginTop: 12 }}>{msg}</p>}
          <p style={{ fontFamily: fB, fontSize: 13, color: C.t3, textAlign: "center", marginTop: 16 }}>
            ¿Ya tenés empresa?{" "}
            <span onClick={() => setModo("ingresar")} style={{ color: C.pri, cursor: "pointer", textDecoration: "underline" }}>
              Ingresá con tu slug
            </span>
          </p>
        </div>
      )}

      <p style={{ fontFamily: fB, fontSize: 11, color: C.t3, marginTop: 40 }}>
        © {new Date().getFullYear()} Gypi · Todos los derechos reservados
      </p>
    </div>
  );
}
