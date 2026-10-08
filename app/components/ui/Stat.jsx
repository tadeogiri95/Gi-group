'use client';
// Número del tablero (R4): el valor grande y la etiqueta completa, sin
// abreviaturas ("Cumplimiento", no "Cumplim."). tone: normal | bien | atencion | mal.
const TONOS = {
  normal: 'text-gypi-text',
  bien: 'text-gypi-green',
  atencion: 'text-gypi-amber-ink',
  mal: 'text-gypi-red',
};

export default function Stat({ value, label, tone = 'normal', onClick }) {
  const cuerpo = (
    <>
      <span className={`block font-heading text-[26px] font-bold leading-none tabular-nums ${TONOS[tone] || TONOS.normal}`}>{value}</span>
      <span className="block text-[13px] text-gypi-dim mt-1.5 leading-tight">{label}</span>
    </>
  );
  const clases = 'min-h-[80px] flex flex-col justify-center text-left px-3.5 py-3 bg-gypi-surface border border-gypi-border rounded-xl';
  return onClick
    ? <button onClick={onClick} className={`${clases} cursor-pointer font-body w-full`}>{cuerpo}</button>
    : <div className={clases}>{cuerpo}</div>;
}
