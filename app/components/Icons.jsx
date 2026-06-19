// ═══════════════════════════════════════════════════════════
// Icons — Bridge sobre Icon.jsx (fuente única de verdad)
//
// Mantiene la API Ic.xxx para backward compat con los 7+
// archivos que la usan. Cada entrada delega a <Icon />.
//
// Uso:
//   import { Ic } from "../components/Icons";
//   <Ic.bot size={20} />
// ═══════════════════════════════════════════════════════════

import Icon from './Icon';

function ic(name, defaults = {}) {
  const { size = 20, strokeWidth = 2 } = defaults;
  return function IcBridge(props) {
    return <Icon name={name} size={props.size || size} strokeWidth={strokeWidth} {...props} />;
  };
}

export const Ic = {
  bot:      ic('bot'),
  send:     ic('send',     { size: 18, strokeWidth: 2.5 }),
  check:    ic('check',    { size: 14, strokeWidth: 3 }),
  x:        ic('x',        { size: 16, strokeWidth: 3 }),
  bell:     ic('bell'),
  clock:    ic('clock',    { size: 12 }),
  enter:    ic('enter',    { size: 14, strokeWidth: 2.5 }),
  exit:     ic('exit',     { size: 14, strokeWidth: 2.5 }),
  home:     ic('home',     { size: 22 }),
  chat:     ic('chat',     { size: 22 }),
  users:    ic('users',    { size: 22 }),
  inbox:    ic('inbox',    { size: 22 }),
  history:  ic('clock',    { size: 22 }),
  chevL:    ic('chevron-left'),
  chevR:    ic('chevron-right', { size: 14 }),
  alert:    ic('alert-triangle', { size: 14, strokeWidth: 2.5 }),
  sparkle:  ic('sparkle',  { size: 16 }),
  gear:     ic('settings'),
  plus:     ic('plus',     { size: 16, strokeWidth: 2.5 }),
  trash:    ic('trash',    { size: 14 }),
  logout:   ic('logout',   { size: 16 }),
  refresh:  ic('refresh',  { size: 16 }),
  hammer:   ic('hammer',   { size: 22 }),
  search:   ic('search',   { size: 16 }),
  filter:   ic('filter',   { size: 16 }),
  sortAsc:  ic('sort-asc', { size: 14 }),
  sortDesc: ic('sort-desc', { size: 14 }),
  eye:      ic('eye',      { size: 16 }),
  edit:     ic('edit',     { size: 14 }),
  download: ic('download', { size: 16 }),
  calendar: ic('calendar', { size: 16 }),
  map:      ic('map-pin',  { size: 16 }),
};
