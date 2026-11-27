'use client';
// app/components/EscanearPiezas.jsx — El operario escanea las piezas en su
// etapa (Órdenes de Producción, parte 18). Elige la etapa (las de la empresa
// marcadas en Configuración → Etapas como "Se escanea por pieza"; si tiene
// una tarea en curso de esa etapa, ya viene elegida) y escanea una pieza tras otra sin tocar la pantalla:
//   verde    → la pieza pasó por la etapa
//   amarillo → ya estaba escaneada, se salteó una etapa anterior o no le toca
//   rojo     → no es una etiqueta de pieza, o la pieza ya no está en la OT
// La etiqueta de un módulo hace pasar todas sus piezas de una vez (Armado).
// El QR de una pieza es el mismo para todas sus unidades: cada escaneo anota
// la siguiente que falta ("3 de 7 en Corte").
// Sin señal, el escaneo se guarda y se manda solo cuando vuelve la conexión.
// Desde el 04/11, cada pieza escaneada muestra 📄 para abrir el PDF de su OT,
// y desde el 26/11 📋 para ver las piezas de la OT con cuántas van escaneadas.
// codigoInicial: el QR leído con la cámara del celular (link ?qr=, ver
// QrAbierto.jsx); queda esperando que el operario elija la etapa y confirme.
// Desde el 27/11 (Tadeo: se anotó el canto de una OT que no se trabajaba):
//   - la cámara solo toma la etiqueta del recuadro del medio, y de a una;
//   - arriba dice la OT en curso (la de la tarea en curso, o la de la primera
//     pieza escaneada); una etiqueta de otra OT no se anota sola: pregunta.
// Desde el 27/11 (Tadeo: canto de 0,45, 1 o 2 mm en la misma pieza): en la
// etapa de canto se elige el canto que está en la máquina ("2 mm GRAFITO",
// queda guardado en el celular) y cada escaneo es un lado de ese canto. Si la
// pieza no tiene lados pendientes de ese canto, o lleva varios y no se
// eligió, una tarjeta amarilla pregunta cuál se pegó.
import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, sbGetAll } from "../lib/supabase";
import { enviarOEncolar } from "../lib/colaOffline";
import Modal from "./ui/Modal";
import EscanerCodigo, { escanerDisponible } from "./EscanerCodigo";
import { reglasPieza, nombresEtapas, mensajeEscaneo, otsDelCodigo, esDeOtraOt, otCanonica } from "../lib/piezas";
import { useOts } from "../hooks/useOts";
import { usePdfsOt } from "../hooks/usePdfsOt";
import { indicePdfs } from "../lib/pdfOt";
import { LinkPdfOt } from "./PdfOt";
import PiezasOtOperario, { CLAVE_ETAPA_PIEZAS } from "./PiezasOtOperario";
import { tiposDe, textoTipoCanto } from "../lib/cantoLados";

const CLAVE_ETAPA = CLAVE_ETAPA_PIEZAS;
// Sin leerlo este rato, el QR salió de cuadro y el próximo escaneo cuenta
const FUERA_DE_CUADRO_MS = 1000;
const MAX_RESULTADOS = 30;
// El aviso "una etiqueta por vez" se va solo después de este rato
const AVISO_VARIOS_MS = 2500;
// El canto que está en la máquina (27/11)
export const CLAVE_CANTO_MAQUINA = "gypi_canto_maquina";

function cantoGuardado() {
  try { return localStorage.getItem(CLAVE_CANTO_MAQUINA) || null; } catch { return null; }
}

const TONOS = {
  verde: "bg-gypi-green/10 text-gypi-green",
  amarillo: "bg-gypi-amber/10 text-gypi-amber-ink",
  rojo: "bg-gypi-red/10 text-gypi-red",
  pendiente: "bg-gypi-surf-hi text-gypi-dim",
};

function etapaInicial(etapas, botones, tareaActiva) {
  const enCurso = tareaActiva?.etapa ? etapas.find((e) => e.codigo === tareaActiva.etapa || e.id === tareaActiva.etapa) : null;
  if (enCurso && botones.some((b) => b.codigo === Number(enCurso.codigo))) return Number(enCurso.codigo);
  try {
    const guardada = Number(localStorage.getItem(CLAVE_ETAPA));
    return botones.some((b) => b.codigo === guardada) ? guardada : null;
  } catch { return null; }
}

export default function EscanearPiezas({ usuario, etapas = [], tareaActiva = null, codigoInicial = null, onClose }) {
  const porOt = useOts();
  const archivosPdf = usePdfsOt();
  const indicePdf = useMemo(() => indicePdfs(archivosPdf), [archivosPdf]);
  const botones = reglasPieza(etapas);
  const nombres = nombresEtapas(etapas);
  const [etapa, setEtapa] = useState(() => etapaInicial(etapas, botones, tareaActiva));
  const [resultados, setResultados] = useState([]);
  const [numero, setNumero] = useState("");
  const [leido, setLeido] = useState(codigoInicial);
  // 26/11: 📋 en cada pieza escaneada abre las piezas de su OT con el avance
  const [verOt, setVerOt] = useState(null);
  // 27/11: la OT que se está trabajando; una etiqueta de otra OT pregunta antes de anotarse
  const [otEnCurso, setOtEnCurso] = useState(() => (tareaActiva?.codigo_proyecto ? otCanonica(tareaActiva.codigo_proyecto) : null));
  const [varios, setVarios] = useState(false);
  // 27/11: canto en la máquina y los cantos que lleva la OT en curso
  const [canto, setCanto] = useState(cantoGuardado);
  const [cantosOt, setCantosOt] = useState({ ot: null, tipos: [] });
  const tiposOt = useMemo(() => (cantosOt.ot === otEnCurso ? cantosOt.tipos : []), [cantosOt, otEnCurso]);
  const porLados = Boolean(botones.find((b) => b.codigo === etapa)?.porLados);
  const vistos = useRef(new Map());
  const contador = useRef(0);
  const timerVarios = useRef(null);
  useEffect(() => () => clearTimeout(timerVarios.current), []);
  const avisarVarios = () => {
    setVarios(true);
    clearTimeout(timerVarios.current);
    timerVarios.current = setTimeout(() => setVarios(false), AVISO_VARIOS_MS);
  };

  useEffect(() => {
    if (!etapa) return;
    try { localStorage.setItem(CLAVE_ETAPA, String(etapa)); } catch { /* sin almacenamiento */ }
  }, [etapa]);

  useEffect(() => {
    try {
      if (canto) localStorage.setItem(CLAVE_CANTO_MAQUINA, canto);
      else localStorage.removeItem(CLAVE_CANTO_MAQUINA);
    } catch { /* sin almacenamiento */ }
  }, [canto]);

  // Los cantos de la OT en curso, para los botones (de la planilla pegada)
  useEffect(() => {
    if (!porLados || !otEnCurso) return undefined;
    let vivo = true;
    sbGetAll(`piezas_ot?ot=eq.${encodeURIComponent(otEnCurso)}&select=cantos`, { maxFilas: 5000 })
      .then((r) => {
        if (!vivo) return;
        const tipos = tiposDe((r.data || []).flatMap((p) => (Array.isArray(p.cantos) ? p.cantos : [])));
        setCantosOt((prev) => ({ ot: otEnCurso, tipos: [...new Set([...tipos, ...(prev.ot === otEnCurso ? prev.tipos : [])])] }));
      })
      .catch(() => { /* sin los botones de la OT: quedan los que traen los escaneos */ });
    return () => { vivo = false; };
  }, [porLados, otEnCurso]);

  // Los cantos que traen los escaneos se suman a los botones (de la OT de la pieza)
  const sumarTipos = (tipos, ot) => {
    if (!tipos?.length) return;
    const deOt = ot ? otCanonica(ot) : otEnCurso;
    setCantosOt((prev) => {
      const base = prev.ot === deOt ? prev.tipos : [];
      return tipos.every((t) => base.includes(t)) && prev.ot === deOt ? prev : { ot: deOt, tipos: [...new Set([...base, ...tipos])] };
    });
  };
  const botonesCanto = useMemo(() => (canto && !tiposOt.includes(canto) ? [...tiposOt, canto] : tiposOt), [tiposOt, canto]);

  const agregar = (r) => setResultados((prev) => [{ ...r, key: ++contador.current }, ...prev].slice(0, MAX_RESULTADOS));

  const anotar = async (codigo, { forzar = false, canto: cantoElegido = null } = {}) => {
    const texto = String(codigo || "").trim();
    if (!texto || !etapa) return;
    // La cámara lee el QR ~3 veces por segundo mientras está a la vista: se
    // cuenta una vez y vuelve a contar recién cuando el QR salió de cuadro
    // (04/11: las 7 unidades de una pieza llevan el mismo QR y cada escaneo suma una)
    const ahora = Date.now();
    const clave = `${etapa}|${texto}`;
    const visto = vistos.current.get(clave) || 0;
    vistos.current.set(clave, ahora);
    if (ahora - visto < FUERA_DE_CUADRO_MS) return;
    // Etiqueta de otra OT: no se anota sola, queda esperando que confirme
    const ots = otsDelCodigo(texto);
    if (!forzar && esDeOtraOt(ots, otEnCurso)) {
      setResultados((prev) => (prev.some((x) => x.confirmar === texto) ? prev : [{
        tono: "amarillo", confirmar: texto, otNueva: ots[0], key: ++contador.current,
        texto: `Esta etiqueta es de la OT ${ots[0]} y estás con la ${otEnCurso}. ¿La anoto igual?`,
        detalle: "Si fue sin querer (había otra etiqueta cerca), tocá No.",
      }, ...prev].slice(0, MAX_RESULTADOS)));
      return;
    }
    try {
      const r = await enviarOEncolar({
        empleadoId: usuario?.id, tipo: "paso_pieza", url: "/api/piezas/paso",
        body: { accion: "escanear", codigo: texto, etapa, ...(porLados && (cantoElegido || canto) ? { canto: cantoElegido || canto } : {}) },
      });
      if (r.encolado) {
        agregar({ tono: "pendiente", texto: "Sin señal: la pieza quedó guardada y se manda sola cuando vuelva la conexión.", detalle: null });
        return;
      }
      const data = r.data || {};
      // 27/11: la pieza no tiene lados pendientes del canto elegido, o lleva varios: ¿cuál se pegó?
      if (data.elegirCanto) {
        const ec = data.elegirCanto;
        const p = data.pieza || {};
        sumarTipos(ec.opciones, p.ot);
        if (!ec.opciones?.length) {
          agregar({ tono: "amarillo", texto: `${p.nombre || "La pieza"} ya tiene todos sus lados con canto.`, detalle: null });
          return;
        }
        setResultados((prev) => [{
          tono: "amarillo", elegir: { codigo: texto, opciones: ec.opciones }, key: ++contador.current, ot: p.ot || null,
          texto: ec.elegido
            ? `${p.nombre}${p.de > 1 ? ` (${p.de} unidades)` : ""} no tiene lados pendientes de canto ${textoTipoCanto(ec.elegido)}. ¿Qué canto pegaste?`
            : `${p.nombre} lleva más de un canto. ¿Cuál pegaste?`,
          detalle: "Tocá el canto y se anota. Si fue sin querer, tocá No anotar.",
        }, ...prev].slice(0, MAX_RESULTADOS));
        return;
      }
      if (data.lados?.tipos) sumarTipos(data.lados.tipos, data.pieza?.ot);
      const m = mensajeEscaneo({ ...data, ok: r.status === 200 && data.ok }, nombres, porOt);
      const ok = m.tono !== "rojo" && !data.ya;
      const deshacer = !ok ? null
        : data.modulo ? { accion: "deshacer_modulo", ot: data.modulo.ot, modulo: data.modulo.nombre, etapa: data.etapa }
          : data.pieza?.id ? { accion: "deshacer", pieza_id: data.pieza.id, etapa: data.etapa } : null;
      // QR de la pieza (mismo para todas las unidades): "Sumar otra" sin volver a escanear.
      // En canto por lados (25/11) suma el siguiente lado.
      const quedanLados = data.lados && data.lados.hechos < data.lados.total;
      const otra = !data.ya && ((data.conteo && data.conteo.pasaron < data.conteo.de) || quedanLados) ? texto : null;
      const otLeida = data.modulo?.ot || data.pieza?.ot || null;
      // La primera pieza que se anota marca la OT en curso
      if (m.tono !== "rojo" && otLeida && !otEnCurso) setOtEnCurso(otCanonica(otLeida));
      agregar({ ...m, deshacer, otra, lados: Boolean(data.lados), ot: otLeida });
    } catch (e) {
      agregar({ tono: "rojo", texto: e?.message || "No se pudo anotar la pieza.", detalle: null });
    }
  };

  const deshacer = async (item) => {
    try {
      const r = await apiFetch("/api/piezas/paso", { method: "POST", body: JSON.stringify(item.deshacer) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "No se pudo deshacer");
      vistos.current.clear();
      setResultados((prev) => prev.map((x) => (x.key === item.key ? { tono: "pendiente", texto: `Deshecho: ${x.texto}`, detalle: null, key: x.key } : x)));
    } catch (e) {
      agregar({ tono: "rojo", texto: e.message, detalle: null });
    }
  };

  // "Sí, anotar": pasa a ser la OT en curso (el operario cambió de OT)
  const confirmarOtra = (item) => {
    setResultados((prev) => prev.filter((x) => x.key !== item.key));
    if (item.otNueva) setOtEnCurso(item.otNueva);
    vistos.current.delete(`${etapa}|${item.confirmar}`);
    anotar(item.confirmar, { forzar: true });
  };
  // "Anotar como 0,45 mm": queda como el canto de la máquina
  const elegirCanto = (item, tipo) => {
    setResultados((prev) => prev.filter((x) => x.key !== item.key));
    setCanto(tipo);
    vistos.current.delete(`${etapa}|${item.elegir.codigo}`);
    anotar(item.elegir.codigo, { forzar: true, canto: tipo });
  };
  const descartar = (item) => setResultados((prev) => prev.filter((x) => x.key !== item.key));

  const escribir = (e) => {
    e.preventDefault();
    const n = numero.replace(/\D/g, "");
    if (!n) return;
    vistos.current.delete(`${etapa}|${n}`);
    anotar(n);
    setNumero("");
  };

  const nombreEtapa = nombres[etapa];

  return (
    <Modal open onClose={onClose} title="Escanear piezas">
      <div className="p-4 overflow-y-auto text-gypi-text">
        <div className="text-[13px] font-bold text-gypi-dim mb-1.5" id="etapa-piezas">¿En qué etapa estás?</div>
        <div className="grid grid-cols-2 gap-1.5 mb-3" role="group" aria-labelledby="etapa-piezas">
          {botones.map((e) => (
            <button key={e.codigo} onClick={() => setEtapa(e.codigo)} aria-pressed={etapa === e.codigo}
              className={`min-h-[48px] rounded-lg border text-[14px] font-bold cursor-pointer ${etapa === e.codigo ? "bg-gypi-amber/15 border-gypi-amber text-gypi-amber-ink" : "bg-gypi-surface border-gypi-border text-gypi-dim"}`}>
              {e.icon ? `${e.icon} ` : ""}{e.nombre}
            </button>
          ))}
        </div>

        {!botones.length ? (
          <div className="text-[14px] text-gypi-dim">Todavía no hay etapas que se escaneen por pieza. Se marcan en Más → Producción → Etapas.</div>
        ) : !etapa ? (
          <div className="text-[14px] text-gypi-dim">Elegí la etapa y escaneá las etiquetas de las piezas. En Armado escaneá la etiqueta del módulo: pasan todas sus piezas juntas.</div>
        ) : (
          <>
            <div className="flex items-center gap-2 rounded-xl px-3 py-2 mb-2 bg-gypi-surface border border-gypi-border text-[14px]">
              <div className="flex-1 min-w-0">
                {otEnCurso
                  ? <>Estás con la <b>OT {otEnCurso}</b>. Si aparece una etiqueta de otra OT, te pregunto antes de anotarla.</>
                  : <>La primera pieza que escanees marca la OT en curso.</>}
              </div>
              {otEnCurso && (
                <button onClick={() => setOtEnCurso(null)} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold cursor-pointer text-gypi-dim underline">Cambiar</button>
              )}
            </div>
            {porLados && (
              <div className="mb-2">
                <div className="text-[13px] font-bold text-gypi-dim mb-1.5" id="canto-maquina">¿Qué canto tenés en la máquina?</div>
                {botonesCanto.length ? (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="canto-maquina">
                    {botonesCanto.map((t) => (
                      <button key={t} onClick={() => setCanto(canto === t ? null : t)} aria-pressed={canto === t}
                        className={`min-h-[44px] px-3 rounded-lg border text-[14px] font-bold cursor-pointer ${canto === t ? "bg-gypi-amber/15 border-gypi-amber text-gypi-amber-ink" : "bg-gypi-surface border-gypi-border text-gypi-dim"}`}>
                        {textoTipoCanto(t)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-[13px] text-gypi-dim">Escaneá la primera pieza: si lleva un solo canto no hace falta elegir; si lleva varios, te pregunto cuál pegaste.</div>
                )}
                {botonesCanto.length > 0 && (
                  <div className="text-[12px] text-gypi-dim mt-1">
                    {canto ? `Cada escaneo es un lado con canto ${textoTipoCanto(canto)}. Tocalo de nuevo para no elegir ninguno.` : "Sin elegir: si la pieza lleva varios cantos, te pregunto cuál pegaste."}
                  </div>
                )}
              </div>
            )}
            {escanerDisponible() ? (
              <div className="mb-2">
                <EscanerCodigo onCodigo={anotar} mira onVarios={avisarVarios}
                  ayuda={`Poné una sola etiqueta adentro del recuadro: cada pieza (o módulo armado) que pasa por ${nombreEtapa}`} />
                {varios && (
                  <div role="alert" className="rounded-xl p-2.5 mb-2 text-[14px] font-semibold bg-gypi-amber/10 text-gypi-amber-ink">
                    Hay más de una etiqueta en el recuadro: apuntá a una sola.
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[13px] text-gypi-dim mb-2">Para escanear con la cámara usá Chrome en un celular Android. Mientras tanto, escribí el número de la etiqueta (N°).</div>
            )}
            {leido && (
              <div className="rounded-xl p-3 mb-3 bg-gypi-amber/10 border border-gypi-amber">
                <div className="text-[13px] text-gypi-dim">Leíste con la cámara</div>
                <div className="text-[14px] font-semibold break-words mb-2">{leido}</div>
                <button onClick={() => { const c = leido; setLeido(null); anotar(c, { forzar: true }); }} className="g-btn g-btn-primary w-full min-h-[48px] font-bold">
                  Anotar en {nombreEtapa}
                </button>
              </div>
            )}
            <form onSubmit={escribir} className="flex gap-2 mb-3">
              <input className="g-input flex-1" inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value)}
                aria-label="Número de la pieza" placeholder="O escribí el N° de la etiqueta" />
              <button type="submit" disabled={!numero.trim()} className="g-btn g-btn-secondary">Anotar</button>
            </form>
          </>
        )}

        {resultados.length > 0 && (
          <ul aria-label="Piezas escaneadas" className="list-none p-0 m-0 flex flex-col gap-1.5">
            {resultados.map((r) => (
              <li key={r.key} role="status" className={`rounded-xl p-2.5 text-[14px] ${TONOS[r.tono] || TONOS.pendiente}`}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">{r.texto}</div>
                    {r.detalle && <div className="text-[12px] mt-0.5 opacity-90">{r.detalle}</div>}
                  </div>
                  {r.ot && <LinkPdfOt ot={r.ot} indice={indicePdf} />}
                  {r.ot && (
                    <button onClick={() => setVerOt(r.ot)} aria-label={`Ver las piezas de la OT ${r.ot}`}
                      className="min-w-[44px] min-h-[44px] bg-transparent border-none text-[18px] cursor-pointer">📋</button>
                  )}
                  {r.otra && (
                    <button onClick={() => { vistos.current.delete(`${etapa}|${r.otra}`); anotar(r.otra, { forzar: true }); }}
                      className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold cursor-pointer text-current underline">{r.lados ? "+1 lado" : "+1 otra"}</button>
                  )}
                  {r.elegir && (
                    <div className="flex flex-col items-end">
                      {r.elegir.opciones.map((t) => (
                        <button key={t} onClick={() => elegirCanto(r, t)} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold cursor-pointer text-current underline text-right">Anotar {textoTipoCanto(t)}</button>
                      ))}
                      <button onClick={() => descartar(r)} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold cursor-pointer text-current underline">No anotar</button>
                    </div>
                  )}
                  {r.confirmar && (
                    <>
                      <button onClick={() => confirmarOtra(r)} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold cursor-pointer text-current underline">Sí, anotar</button>
                      <button onClick={() => descartar(r)} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold cursor-pointer text-current underline">No</button>
                    </>
                  )}
                  {r.deshacer && (
                    <button onClick={() => deshacer(r)} className="min-h-[44px] px-2 bg-transparent border-none text-[13px] font-semibold cursor-pointer text-current underline">Deshacer</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {verOt && <PiezasOtOperario empresaId={usuario?.empresa_id} ot={verOt} onClose={() => setVerOt(null)} />}
    </Modal>
  );
}
