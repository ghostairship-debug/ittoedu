/** CSS color for the strictly validated #RRGGBB Native color contract. */
export function colorWithAlpha(color: string, opacity: number): string {
  const value = Number.parseInt(color.slice(1), 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${Math.max(0, Math.min(1, opacity))})`
}
