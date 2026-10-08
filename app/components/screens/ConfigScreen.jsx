"use client";
import { useState } from "react";
import ReportesScreen from "../../reportes_screen";
import GrillaHorarioScreen from "../../grilla_horario_screen";
import ProyectosScreen from "../../proyectos_screen.jsx";
import GeolocalizacionScreen from "../../geolocalizacion_screen";
import CalendarioScreen from "../../calendario_screen";
import ReglasScreen from "./ReglasScreen";
import AdminEmpresaScreen from "../../admin_empresa_screen";
import DocumentosEmpleadoScreen from "../../documentos_empleado_screen";
import CuentaDatos from "../CuentaDatos";
import { useAuth } from "../../context/AuthContext";
import ModuloBloqueado from "../ModuloBloqueado";
import { MODULO_SECCION_GESTION, seccionBloqueada } from "../../lib/modulos";
import { seccionesMas, GRUPOS } from "../../lib/menuGestion";
import ListItem from "../ui/ListItem";
import AsistenciaReglasScreen from "./AsistenciaReglasScreen";

// Gypi no muestra publicidad (D20): solo usa lo necesario para la sesión.
function PrivacidadPanel({ usuario, empresa }) {
  const { logout } = useAuth();
  return (
    <div className="px-4 py-6 flex flex-col gap-5 overflow-y-auto flex-1">
      <CuentaDatos usuario={usuario} empresa={empresa} onLogout={logout} />
      <div>
        <p className="g-overline text-gypi-dim mb-1">Cookies</p>
        <div className="bg-gypi-surface border border-gypi-border rounded-xl p-4">
          <p className="text-[13px] text-gypi-text m-0">
            Gypi no muestra publicidad ni usa cookies de seguimiento. Solo guarda lo necesario para mantener tu sesión iniciada y proteger los formularios.
          </p>
        </div>
      </div>
      <div>
        <p className="g-overline text-gypi-dim mb-1">Más información</p>
        <div className="bg-gypi-surface border border-gypi-border rounded-xl">
          <a href="/privacy#cookies" className="flex items-center justify-between px-4 py-3 text-[13px] text-gypi-text no-underline">
            <span>Política de privacidad y cookies</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </a>
        </div>
      </div>
    </div>
  );
}

// Pantalla "Más" de gestión (reforma UX R5): una lista simple agrupada en
// "Día a día" y "Configuración"; cada renglón abre su pantalla con "← Más".
// Antes eran 3 pestañas, 10 sub-pestañas y chips adentro.
export default function ConfigScreen({ ctx, reload, usuario, empresa, onUpdateEmpresa, divisiones = [], etapas = [], onVerPlanes, seccion: seccionInicial = null, onSeccion }) {
  const [seccionLocal, setSeccionLocal] = useState(seccionInicial);
  const seccionId = onSeccion ? seccionInicial : seccionLocal;
  const abrir = (id) => {
    if (id === "facturacion") { onVerPlanes?.(); return; }
    if (onSeccion) onSeccion(id); else setSeccionLocal(id);
  };
  const empresaId = usuario?.empresa_id || empresa?.id;
  const secciones = seccionesMas({ empresa, usuario });
  const seccion = secciones.find((x) => x.id === seccionId) || null;

  if (!seccion) {
    return (
      <nav aria-label="Más opciones" className="flex-1 overflow-y-auto px-[18px] pb-[110px] flex flex-col gap-5">
        {GRUPOS.map((g) => {
          const items = secciones.filter((x) => x.grupo === g.id);
          if (items.length === 0) return null;
          return (
            <div key={g.id} className="flex flex-col gap-2">
              <h2 className="g-overline m-0">{g.titulo}</h2>
              {items.map((x) => (
                <ListItem
                  key={x.id}
                  icon={x.icono}
                  title={x.label}
                  detail={x.bloqueado ? "No está en tu plan" : x.detalle}
                  right={<span aria-hidden="true" className="text-gypi-dim">{x.bloqueado ? "🔒" : "›"}</span>}
                  label={x.bloqueado ? `${x.label} (no está en tu plan)` : x.label}
                  onClick={() => abrir(x.id)}
                />
              ))}
            </div>
          );
        })}
      </nav>
    );
  }

  const id = seccion.id;
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-[18px] pb-1 shrink-0">
        <button onClick={() => abrir(null)} className="min-h-[44px] -ml-1 px-1 bg-transparent border-none cursor-pointer text-[15px] font-semibold text-gypi-text">
          ← Más
        </button>
        <h2 className="m-0 mb-2 text-[20px] font-bold text-gypi-text font-heading">{seccion.label}</h2>
      </div>
      <div role="region" aria-label={seccion.label} className="flex-1 overflow-hidden flex flex-col">
        {seccionBloqueada(id, empresa) && <ModuloBloqueado modulo={MODULO_SECCION_GESTION[id]} empresa={empresa} rol={usuario?.rol} onVerPlanes={onVerPlanes} />}
        {!seccionBloqueada(id, empresa) && <>
        {id === "reportes"      && <ReportesScreen />}
        {id === "horarios"      && <GrillaHorarioScreen empresaId={empresaId} />}
        {id === "proyectos"     && <ProyectosScreen empresaId={empresaId} />}
        {id === "ubicaciones"   && <GeolocalizacionScreen empresaId={empresaId} />}
        {id === "calendario"    && <CalendarioScreen empresaId={empresaId} />}
        {id === "documentacion" && <DocumentosEmpleadoScreen empresaId={empresaId} />}
        {id === "asistencia"    && <AsistenciaReglasScreen />}
        {id === "reglas"        && <ReglasScreen ctx={ctx} reload={reload} usuario={usuario} />}
        {id === "admin"         && <AdminEmpresaScreen empresa={empresa} empresaId={usuario?.empresa_id} onUpdate={onUpdateEmpresa} divisiones={divisiones} etapas={etapas} />}
        {id === "privacidad"    && <PrivacidadPanel usuario={usuario} empresa={empresa} />}
        </>}
      </div>
    </div>
  );
}
