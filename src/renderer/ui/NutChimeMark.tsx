/** A walnut wind chime, with a wooden beam, nut shells and an amber clapper. */
export function NutChimeMark({ size = 28 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <path d="M16 15Q32 5 48 15M12 17H52" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    <path d="M21 19V31M32 19V40M43 19V28" stroke="currentColor" strokeWidth="2" />
    <path d="M21 31C11 35 13 47 21 49C30 46 31 34 21 31Z" fill="#c18b38" stroke="currentColor" strokeWidth="2" />
    <path d="M43 28C34 32 35 44 43 46C52 43 52 31 43 28Z" fill="#e0b668" stroke="currentColor" strokeWidth="2" />
    <path d="M21 34L20 45M43 31L42 42" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M32 40L27 53L32 59L37 53Z" fill="#e0b668" stroke="currentColor" strokeWidth="2" />
  </svg>
}
