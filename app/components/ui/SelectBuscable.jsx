'use client';
// app/components/ui/SelectBuscable.jsx — un desplegable donde se puede
// escribir para filtrar (pedido de Tadeo del 11/11 para Finanzas).
//
// Se usa igual que un <select>: mismos value, onChange y <option>/<optgroup>
// adentro. Al tocarlo se abre la lista completa; lo que se escribe la filtra
// (sin importar mayúsculas ni tildes, cada palabra en cualquier orden). Con
// las flechas se recorre, Enter elige y Escape cierra. onChange recibe
// { target: { value } }, como el de un <select>, así no cambia nada más.
import { Children, Fragment, isValidElement, useId, useMemo, useRef, useState } from 'react';

/** Texto plano de los hijos de un <option> ("{a} · {b}" → "a · b"). */
function textoDe(hijos) {
  if (hijos == null || typeof hijos === 'boolean') return '';
  if (typeof hijos === 'string' || typeof hijos === 'number') return String(hijos);
  if (Array.isArray(hijos)) return hijos.map(textoDe).join('');
  if (isValidElement(hijos)) return textoDe(hijos.props.children);
  return '';
}

/** Las opciones de los hijos: <option> sueltos o dentro de <optgroup>. */
export function opcionesDe(children) {
  const out = [];
  const recorrer = (nodos, grupo) => {
    Children.toArray(nodos).forEach((n) => {
      if (!isValidElement(n)) return;
      if (n.type === 'optgroup') { recorrer(n.props.children, n.props.label || null); return; }
      if (n.type === 'option') {
        const label = textoDe(n.props.children);
        out.push({ value: String(n.props.value ?? label), label, grupo, disabled: Boolean(n.props.disabled) });
        return;
      }
      if (n.type === Fragment) recorrer(n.props.children, grupo);
    });
  };
  recorrer(children, null);
  return out;
}

/** Minúsculas y sin tildes, para comparar. */
export const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Las opciones que coinciden con lo escrito: cada palabra tiene que estar (en el texto o en el grupo). */
export function filtrarOpciones(opciones, texto) {
  const palabras = normalizar(texto).split(/\s+/).filter(Boolean);
  if (!palabras.length) return opciones;
  return opciones.filter((o) => {
    const donde = normalizar(`${o.label} ${o.grupo || ''}`);
    return palabras.every((p) => donde.includes(p));
  });
}

export default function SelectBuscable({
  value, onChange, children, className = 'g-input w-full', disabled = false, id, placeholder,
  'aria-label': ariaLabel, ...rest
}) {
  // El ancho (w-*, min-w-*, max-w-*, flex-1…) va a la caja de afuera; el
  // casillero de adentro siempre ocupa todo
  const clases = String(className).split(/\s+/).filter(Boolean);
  const esAncho = (c) => /^(w-|min-w-|max-w-|flex-|basis-|grow|shrink|self-)/.test(c);
  const afuera = clases.filter(esAncho);
  const contenedor = `relative ${afuera.length ? afuera.join(' ') : 'w-full'}`;
  const claseInput = [...clases.filter((c) => !esAncho(c)), 'w-full', 'g-buscable'].join(' ');
  const propio = useId();
  const idInput = id || propio;
  const idLista = `${idInput}-lista`;
  const opciones = useMemo(() => opcionesDe(children), [children]);
  const elegida = opciones.find((o) => o.value === String(value ?? ''));
  const vacia = opciones.find((o) => o.value === '');
  const [abierta, setAbierta] = useState(false);
  const [texto, setTexto] = useState('');
  const [activa, setActiva] = useState(0);
  const lista = useRef(null);

  const visibles = useMemo(() => filtrarOpciones(opciones, texto), [opciones, texto]);

  const elegir = (o) => {
    if (!o || o.disabled) return;
    setAbierta(false);
    setTexto('');
    if (o.value !== String(value ?? '')) onChange?.({ target: { value: o.value } });
  };

  const abrir = () => {
    if (disabled) return;
    setTexto('');
    setActiva(Math.max(0, opciones.findIndex((o) => o.value === String(value ?? ''))));
    setAbierta(true);
  };

  const mover = (paso) => {
    if (!abierta) { abrir(); return; }
    const n = visibles.length;
    if (!n) return;
    const i = (activa + paso + n) % n;
    setActiva(i);
    lista.current?.querySelector?.(`[data-i="${i}"]`)?.scrollIntoView?.({ block: 'nearest' });
  };

  const teclas = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); mover(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); mover(-1); }
    else if (e.key === 'Enter') { if (abierta) { e.preventDefault(); elegir(visibles[activa]); } }
    else if (e.key === 'Escape') { if (abierta) { e.preventDefault(); e.stopPropagation(); setAbierta(false); setTexto(''); } }
  };

  const escribir = (e) => {
    const t = e.target.value;
    // Si lo escrito es justo el valor o el texto de una opción, queda elegida
    const exacta = opciones.find((o) => !o.disabled && (o.value === t || normalizar(o.label) === normalizar(t)) && t !== '');
    if (exacta) { elegir(exacta); return; }
    setTexto(t);
    setActiva(0);
    setAbierta(true);
  };

  const mostrado = abierta ? texto : (elegida && elegida.value !== '' ? elegida.label : '');
  const sugerencia = abierta && elegida?.label ? elegida.label : (placeholder || vacia?.label || 'Escribí para buscar…');

  return (
    <div className={contenedor}>
      <input
        {...rest}
        id={idInput}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={abierta}
        aria-controls={idLista}
        aria-autocomplete="list"
        autoComplete="off"
        className={claseInput}
        disabled={disabled}
        value={mostrado}
        placeholder={sugerencia}
        onFocus={abrir}
        onClick={() => { if (!abierta) abrir(); }}
        onChange={escribir}
        onKeyDown={teclas}
        onBlur={() => { setAbierta(false); setTexto(''); }}
      />
      {abierta && (
        <ul
          ref={lista}
          id={idLista}
          role="listbox"
          aria-label={ariaLabel ? `Opciones de ${ariaLabel}` : 'Opciones'}
          className="absolute z-50 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-lg border border-gypi-border bg-gypi-bg shadow-lg py-1 m-0 list-none"
        >
          {visibles.length === 0 && <li className="px-3 py-2 text-[13px] text-gypi-dim">No hay coincidencias</li>}
          {visibles.map((o, i) => {
            const titulo = o.grupo && (i === 0 || visibles[i - 1].grupo !== o.grupo);
            const marcada = o.value === String(value ?? '');
            return (
              <Fragment key={`${o.grupo || ''}|${o.value}`}>
                {titulo && <li role="presentation" className="px-3 pt-2 pb-1 text-[12px] font-semibold uppercase tracking-wide text-gypi-dim">{o.grupo}</li>}
                <li role="option" data-i={i} aria-selected={marcada} aria-disabled={o.disabled || undefined}
                  onMouseDown={(e) => { e.preventDefault(); elegir(o); }}
                  onMouseEnter={() => setActiva(i)}
                  className={`px-3 py-2 min-h-[40px] text-[14px] text-gypi-text cursor-pointer ${i === activa ? 'bg-gypi-surface' : ''} ${o.disabled ? 'opacity-50' : ''} ${marcada ? 'font-semibold' : ''}`}>
                  {o.label}
                </li>
              </Fragment>
            );
          })}
        </ul>
      )}
    </div>
  );
}
