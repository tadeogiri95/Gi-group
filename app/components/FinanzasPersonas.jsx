'use client';
// app/components/FinanzasPersonas.jsx — Finanzas → 📇 Personas (parte 4 del
// plan del 11/11; migración 180; /api/finanzas/personas; reglas en
// app/lib/finanzasPersonas.js).
//
// Una sola agenda con los clientes, los proveedores y la gente de la hoja
// PERSONAS del Plan de trabajo, sin repetidos. Se busca, se filtra por
// "Faltan datos", se completa la ficha (CUIT, teléfono, email, dirección…)
// y queda guardado; si la persona es proveedor o cliente, los datos se copian
// ahí también. "📋 Pegar desde PERSONAS" trae la hoja (se puede repetir: lo
// que ya está no se duplica) y "Posibles repetidos" junta a los que son la
// misma persona escrita distinto.
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { CAMPOS_PERSONA, NOMBRE_CAMPO, datosFaltantes, rolPersona } from "../lib/finanzasPersonas";
import { normalizar } from "./ui/SelectBuscable";
import { olvidarAgenda } from "./FinanzasElegirProveedor";
import { Chip, Modal, Spinner } from "./ui";
import { useToast } from "./ui/Toast";

const RUTA = "/api/finanzas/personas";
const MAX_LISTA = 300;

async function mandar(body) {
  const res = await apiFetch(RUTA, { method: "POST", body: JSON.stringify(body) });
  const x = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(x.error || "No se pudo guardar");
  olvidarAgenda();
  return x;
}

const FILTROS = [
  { id: "todos", nombre: "Todos", ver: () => true },
  { id: "proveedores", nombre: "Proveedores", ver: (e) => !!e.proveedor_id },
  { id: "clientes", nombre: "Clientes", ver: (e) => !!e.cliente_id },
  { id: "faltan", nombre: "Faltan datos", ver: (e) => datosFaltantes(e).length > 0 },
];

const COLOR_ROL = { "Proveedor y cliente": "text-gypi-cyan", Proveedor: "text-gypi-amber-ink", Cliente: "text-gypi-green-ink", Agenda: "text-gypi-dim" };

/* ─── Ficha ─────────────────────────────────────────────────────────── */

function Ficha({ entrada, onCerrar, onGuardada }) {
  const toast = useToast();
  const nueva = !entrada;
  const [f, setF] = useState(() => Object.fromEntries(["nombre", ...CAMPOS_PERSONA].map((c) => [c, entrada?.[c] || ""])));
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function guardar() {
    setError(null);
    setGuardando(true);
    try {
      await mandar({ accion: "guardar", clave: entrada?.clave || null, persona: f });
      toast.success(nueva ? "Persona agregada" : "Datos guardados");
      onGuardada();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  const campo = (k, label, extra = {}) => (
    <label className="flex flex-col gap-1 text-[13px] font-semibold text-gypi-text">
      {label}
      {k === "notas"
        ? <textarea className="g-input w-full" rows={2} aria-label={label} value={f[k]} onChange={set(k)} maxLength={500} />
        : <input className="g-input w-full" aria-label={label} value={f[k]} onChange={set(k)} {...extra} />}
    </label>
  );
  const faltan = entrada ? datosFaltantes({ ...entrada, ...f }) : [];

  return (
    <Modal open onClose={onCerrar} title={nueva ? "Nueva persona" : entrada.nombre} maxWidth={560}>
      <div className="flex flex-col gap-3">
        {entrada && (
          <p className="m-0 text-[13px] text-gypi-dim">
            <span className={`font-semibold ${COLOR_ROL[rolPersona(entrada)]}`}>{rolPersona(entrada)}</span>
            {entrada.id_planilla ? ` · ID ${entrada.id_planilla} en PERSONAS` : ""}
            {entrada.alias?.length ? ` · también escrito como: ${entrada.alias.join(", ")}` : ""}
          </p>
        )}
        {campo("nombre", "Nombre o razón social", { maxLength: 120 })}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {campo("cuit", "CUIT", { inputMode: "numeric", placeholder: "30-12345678-9", maxLength: 20 })}
          {campo("telefono", "Teléfono", { inputMode: "tel", maxLength: 60 })}
          {campo("email", "Email", { type: "email", maxLength: 160 })}
          {campo("direccion", "Dirección", { maxLength: 200 })}
        </div>
        {campo("contacto", "Contacto (otra persona, teléfono)", { maxLength: 200 })}
        {campo("notas", "Notas")}
        {faltan.length > 0 && <p className="m-0 text-[12px] text-gypi-amber-ink">Faltan: {faltan.map((c) => NOMBRE_CAMPO[c]).join(", ")}</p>}
        {(entrada?.proveedor_id || entrada?.cliente_id) && <p className="m-0 text-[12px] text-gypi-dim">Lo que guardes se copia también a su ficha de {[entrada.proveedor_id && "proveedor", entrada.cliente_id && "cliente"].filter(Boolean).join(" y de ")}.</p>}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="g-btn g-btn-primary" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Pegar la hoja PERSONAS ─────────────────────────────────────────── */

function Pegar({ onCerrar, onHecho }) {
  const toast = useToast();
  const [texto, setTexto] = useState("");
  const [vista, setVista] = useState(null);
  const [error, setError] = useState(null);
  const [trabajando, setTrabajando] = useState(false);

  async function correr(ver) {
    setError(null);
    setTrabajando(true);
    try {
      const d = await mandar({ accion: "importar", texto, ver });
      if (ver) { setVista(d); setTrabajando(false); return; }
      toast.success(`Listo: ${d.resumen.nuevas} nuevas y ${d.resumen.completar} con datos completados`);
      onHecho();
    } catch (e) {
      setError(e.message);
      setTrabajando(false);
    }
  }

  const r = vista?.resumen;
  return (
    <Modal open onClose={onCerrar} title="Pegar desde la hoja PERSONAS" maxWidth={640}>
      <div className="flex flex-col gap-3 text-[14px] text-gypi-text">
        <p className="m-0">
          En el Plan de trabajo abrí la hoja <b>PERSONAS</b>, seleccioná desde los títulos (ID, NOMBRE, TELEFONO…) hasta el último renglón, copiá y pegá acá.
          Los que ya están en Gypi no se repiten: solo se les completa lo que les falta. Se puede volver a pegar cuando agregues gente.
        </p>
        <textarea className="g-input w-full font-mono text-[12px]" rows={8} aria-label="Lo pegado de PERSONAS" value={texto} onChange={(e) => { setTexto(e.target.value); setVista(null); }} placeholder={"ID\tNOMBRE\tTELEFONO\tEMAIL\tDIRECCION…"} />
        {r && (
          <div className="rounded-lg border border-gypi-border bg-gypi-surface p-3 text-[13px]">
            <p className="m-0">Leí <b>{r.leidas}</b> renglones.</p>
            <ul className="m-0 mt-1 pl-5">
              <li><b>{r.nuevas}</b> personas nuevas{vista.ejemplos?.length ? ` (por ejemplo: ${vista.ejemplos.slice(0, 4).join(", ")})` : ""}</li>
              <li><b>{r.completar}</b> que ya estaban y se les completan datos</li>
              <li><b>{r.iguales}</b> que ya estaban iguales</li>
              {r.juntadas > 0 && <li><b>{r.juntadas}</b> repetidos dentro de la hoja que se juntan (ej. &quot;GIRI EZEQUIEL&quot; y &quot;EZEQUIEL GIRI&quot;)</li>}
            </ul>
          </div>
        )}
        {error && <p role="alert" className="m-0 text-[13px] text-gypi-red">⚠ {error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="g-btn g-btn-secondary" onClick={onCerrar}>Cancelar</button>
          {!r
            ? <button type="button" className="g-btn g-btn-primary" disabled={trabajando || !texto.trim()} onClick={() => correr(true)}>{trabajando ? "Leyendo…" : "Ver qué va a hacer"}</button>
            : <button type="button" className="g-btn g-btn-primary" disabled={trabajando} onClick={() => correr(false)}>{trabajando ? "Cargando…" : "Cargar"}</button>}
        </div>
      </div>
    </Modal>
  );
}

/* ─── Posibles repetidos ─────────────────────────────────────────────── */

/** De los dos, el que se queda: el que es proveedor o cliente, si no el nombre más largo. */
function quienQueda(a, b) {
  const peso = (e) => (e.proveedor_id ? 4 : 0) + (e.cliente_id ? 2 : 0) + (e.persona_id ? 1 : 0);
  if (peso(a) !== peso(b)) return peso(a) > peso(b) ? [a, b] : [b, a];
  return String(a.nombre).length >= String(b.nombre).length ? [a, b] : [b, a];
}

function Repetidos({ pares, onCerrar, onHecho }) {
  const toast = useToast();
  const [descartados, setDescartados] = useState(new Set());
  const [ocupado, setOcupado] = useState(null);
  const lista = pares.filter((p) => !descartados.has(`${p.a.clave}|${p.b.clave}`));

  async function unir(p) {
    const [a, b] = quienQueda(p.a, p.b);
    setOcupado(`${p.a.clave}|${p.b.clave}`);
    try {
      await mandar({ accion: "unir", a: a.clave, b: b.clave });
      toast.success(`"${b.nombre}" quedó como otro nombre de "${a.nombre}"`);
      onHecho();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <Modal open onClose={onCerrar} title="Posibles repetidos" maxWidth={640}>
      <div className="flex flex-col gap-2 text-[14px] text-gypi-text">
        <p className="m-0 text-[13px] text-gypi-dim">Nombres parecidos (todas las palabras de uno están en el otro). Si son la misma persona, uní: queda uno solo y el otro nombre se guarda para reconocerlo.</p>
        {!lista.length && <p className="m-0">No quedan posibles repetidos.</p>}
        <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
          {lista.map((p) => {
            const k = `${p.a.clave}|${p.b.clave}`;
            return (
              <li key={k} className="rounded-lg border border-gypi-border bg-gypi-surface px-3 py-2 flex flex-wrap items-center gap-2">
                <span className="flex-1 min-w-[200px]">
                  <b>{p.a.nombre}</b> <span className="text-gypi-dim">({rolPersona(p.a)})</span>
                  <span className="block"><b>{p.b.nombre}</b> <span className="text-gypi-dim">({rolPersona(p.b)})</span></span>
                </span>
                <button type="button" className="g-btn g-btn-primary" disabled={ocupado === k} onClick={() => unir(p)}>Son la misma: unir</button>
                <button type="button" className="g-btn g-btn-secondary" onClick={() => setDescartados((s) => new Set([...s, k]))}>No</button>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}

/* ─── Pantalla ───────────────────────────────────────────────────────── */

export default function FinanzasPersonas() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [buscar, setBuscar] = useState("");
  const [filtro, setFiltro] = useState("todos");
  const [ficha, setFicha] = useState(null);
  const [pegar, setPegar] = useState(false);
  const [repetidos, setRepetidos] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await apiFetch(RUTA);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se pudo leer la agenda");
      setDatos(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const agenda = useMemo(() => datos?.agenda || [], [datos]);
  const lista = useMemo(() => {
    const ver = FILTROS.find((x) => x.id === filtro)?.ver || (() => true);
    const palabras = normalizar(buscar).split(/\s+/).filter(Boolean);
    return agenda.filter(ver).filter((e) => {
      if (!palabras.length) return true;
      const donde = normalizar([e.nombre, ...(e.alias || []), e.cuit, e.telefono, e.email, e.direccion, e.contacto].join(" "));
      return palabras.every((p) => donde.includes(p));
    });
  }, [agenda, filtro, buscar]);

  if (error) return <p role="alert" className="m-[18px] text-[14px] text-gypi-red">⚠ {error}</p>;
  if (!datos) return <div className="flex-1 flex items-center justify-center py-10"><Spinner /></div>;
  const listo = () => { setFicha(null); setPegar(false); setRepetidos(false); cargar(); };

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <button type="button" className="g-btn g-btn-primary" onClick={() => setFicha("nueva")}>＋ Nueva persona</button>
        <button type="button" className="g-btn g-btn-secondary" onClick={() => setPegar(true)}>📋 Pegar desde PERSONAS</button>
        {datos.repetidos?.length > 0 && <button type="button" className="g-btn g-btn-secondary" onClick={() => setRepetidos(true)}>Posibles repetidos ({datos.repetidos.length})</button>}
      </div>
      <input className="g-input w-full mb-2" aria-label="Buscar persona" placeholder="Buscar por nombre, CUIT, teléfono o email" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {FILTROS.map((x) => <Chip key={x.id} active={filtro === x.id} onClick={() => setFiltro(x.id)}>{x.nombre} ({agenda.filter(x.ver).length})</Chip>)}
      </div>
      {!agenda.length ? (
        <p className="text-[14px] text-gypi-text">Todavía no hay nadie. Pegá la hoja PERSONAS del Plan de trabajo con &quot;📋 Pegar desde PERSONAS&quot;.</p>
      ) : (
        <>
          <p className="mb-2 text-[13px] text-gypi-dim">{lista.length} persona{lista.length === 1 ? "" : "s"}{lista.length > MAX_LISTA ? ` (se ven las primeras ${MAX_LISTA}: buscá para encontrar el resto)` : ""}</p>
          <ul className="list-none m-0 p-0 flex flex-col gap-1.5" aria-label="Personas">
            {lista.slice(0, MAX_LISTA).map((e) => {
              const faltan = datosFaltantes(e);
              const rol = rolPersona(e);
              return (
                <li key={e.clave}>
                  <button type="button" onClick={() => setFicha(e)} className="w-full text-left min-h-[48px] px-3 py-2 rounded-lg border border-gypi-border bg-gypi-surface cursor-pointer">
                    <span className="flex items-baseline gap-2 text-[14px] text-gypi-text">
                      <span className="font-semibold flex-1 min-w-0 truncate">{e.nombre}</span>
                      <span className={`text-[12px] font-semibold ${COLOR_ROL[rol]}`}>{rol}</span>
                    </span>
                    <span className="block text-[12px] text-gypi-dim truncate">
                      {[e.cuit && `CUIT ${e.cuit}`, e.telefono, e.email].filter(Boolean).join(" · ") || "Sin datos"}
                      {faltan.length > 0 && <span className="text-gypi-amber-ink"> · Faltan: {faltan.map((c) => NOMBRE_CAMPO[c]).join(", ")}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {ficha && <Ficha entrada={ficha === "nueva" ? null : ficha} onCerrar={() => setFicha(null)} onGuardada={listo} />}
      {pegar && <Pegar onCerrar={() => setPegar(false)} onHecho={listo} />}
      {repetidos && <Repetidos pares={datos.repetidos || []} onCerrar={() => setRepetidos(false)} onHecho={cargar} />}
    </div>
  );
}
