'use client';
// MenuLateral — Menú a la izquierda en la computadora (auditoría 01/11, PR 5).
// Solo para la oficina (gerencia y administración) y solo desde 1024 px: en
// el celular y en tablets sigue la barra de abajo. Tiene lo mismo que la
// barra, pero abierto: Inicio, cada botón (Producción, Materiales,
// Mantenimiento) con sus opciones a la vista, y Equipo, Permisos y Más.
// Las opciones que la empresa no contrató se ven con 🔒, como en las pestañas.
import { tieneModulo } from '../../lib/modulos';
import { BOTONES_GESTION, ICONO_GESTION, conBoton, opcionesBoton } from '../../lib/menuGestion';
import { GRUPOS_FINANZAS } from '../../lib/finanzasInicio';

const ICONO = ICONO_GESTION;
// Finanzas (171) solo aparece para el Dueño
const BOTONES = ['proyectos', 'inventario', 'mantenimiento', 'finanzas'];

/** La opción que está abierta en un botón: la elegida o la primera que la empresa tiene. */
export function opcionAbierta(boton, empresa, usuario, seccion) {
  const ops = opcionesBoton(boton, empresa, usuario);
  if (ops.some((o) => o.id === seccion)) return seccion;
  return (ops.find((o) => tieneModulo(empresa, o.modulo)) || ops[0])?.id || null;
}

// Finanzas en grupos (auditoría 12/11, parte 13): fuera de Finanzas el menú
// muestra un solo renglón (su Inicio, que tiene todo por tema); adentro se
// abre con los temas de finanzasInicio.js como subtítulos. Antes eran 14
// renglones y en la computadora lo último quedaba fuera de la pantalla.
const TEMA_FINANZAS = new Map(GRUPOS_FINANZAS.flatMap((g) => g.opciones.map((id) => [id, g.titulo])));

/** Grupos y renglones del menú para esta empresa y este usuario.
 *  abierto: la pantalla que se está mirando (Finanzas se despliega solo ahí). */
export function gruposMenu(empresa, usuario, pend = 0, abierto = null) {
  const grupos = [{ id: 'inicio', items: [{ id: 'home', destino: 'home', pantalla: 'home', label: 'Inicio', icono: '🏠' }] }];
  for (const b of BOTONES) {
    if (!conBoton(b, empresa, usuario)) continue;
    let items = opcionesBoton(b, empresa, usuario).map((o) => ({
      id: `${b}:${o.id}`, destino: `${b}:${o.id}`, pantalla: b, opcion: o.id,
      label: o.label, icono: ICONO[o.id] || '•', bloqueado: !tieneModulo(empresa, o.modulo),
      ...(b === 'finanzas' && TEMA_FINANZAS.has(o.id) ? { tema: TEMA_FINANZAS.get(o.id) } : {}),
    }));
    if (b === 'finanzas' && abierto !== 'finanzas') {
      items = items.filter((it) => !it.tema).map((it) => (it.opcion === 'fin-inicio' ? { ...it, label: 'Inicio y todo Finanzas' } : it));
    }
    grupos.push({ id: b, titulo: BOTONES_GESTION[b].label, items });
  }
  // Personal con lugar propio (auditoría 12/11, parte 13): antes iba mezclado con Más
  grupos.push({
    id: 'personal',
    titulo: 'Personal',
    items: [
      { id: 'equipo', destino: 'equipo', pantalla: 'equipo', label: 'Equipo y horarios', icono: '👥' },
      { id: 'solicitudes', destino: 'solicitudes', pantalla: 'solicitudes', label: 'Permisos', icono: '📨', badge: pend },
    ],
  });
  grupos.push({
    id: 'empresa',
    titulo: 'Empresa',
    items: [{ id: 'config', destino: 'config', pantalla: 'config', label: 'Más', icono: '☰' }],
  });
  return grupos;
}

export default function MenuLateral({ empresa, usuario, pend = 0, screen, seccion, onIr }) {
  const grupos = gruposMenu(empresa, usuario, pend, screen);
  const activo = (it) => (it.opcion
    ? screen === it.pantalla && opcionAbierta(it.pantalla, empresa, usuario, seccion) === it.opcion
    : screen === it.pantalla);
  return (
    <aside aria-label="Menú" className="menu-lateral shrink-0 w-[232px] h-full overflow-y-auto border-r border-gypi-border bg-gypi-bg px-3 py-4 font-body">
      <div className="flex items-center gap-2 px-2 mb-4 min-h-[40px]">
        {empresa?.logo_url
          ? <img src={empresa.logo_url} alt="" className="w-8 h-8 rounded-lg object-contain shrink-0" />
          : <span aria-hidden="true" className="w-8 h-8 rounded-lg bg-gypi-amber shrink-0" />}
        <span className="font-heading text-[16px] font-bold text-gypi-text leading-tight line-clamp-2">{empresa?.nombre || 'Gypi'}</span>
      </div>
      <nav aria-label="Navegación principal en la computadora">
        {grupos.map((g) => (
          <div key={g.id} className="mb-3">
            {g.titulo && <div className="g-overline text-gypi-dim px-2 mb-1">{g.titulo}</div>}
            {g.items.map((it, i) => {
              const on = activo(it);
              const tema = it.tema && it.tema !== g.items[i - 1]?.tema ? it.tema : null;
              return (
                <div key={it.id}>
                {tema && <div className="text-xs font-bold text-gypi-dim px-2 pt-2 pb-0.5 pl-9">{tema}</div>}
                <button type="button" onClick={() => onIr(it.destino)} aria-current={on ? 'page' : undefined}
                  className={`w-full min-h-[40px] flex items-center gap-2 px-2 rounded-lg border-none cursor-pointer text-left text-[14px] ${on ? 'bg-gypi-amber/15 text-gypi-text font-bold' : 'bg-transparent text-gypi-dim font-medium hover:bg-gypi-surface'}`}>
                  <span aria-hidden="true" className="w-5 text-center">{it.icono}</span>
                  <span className="flex-1 min-w-0 truncate">{it.label}</span>
                  {it.bloqueado && <span aria-label="No contratado">🔒</span>}
                  {it.badge > 0 && <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-gypi-red text-white text-xs font-extrabold font-mono flex items-center justify-center">{it.badge > 99 ? '99+' : it.badge}</span>}
                </button>
                </div>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
