export function stepFontSize(size: number, direction: 1 | -1): number {
  const step = size < 24 ? 2 : size < 72 ? 4 : 8
  return Math.max(8, Math.min(400, Math.round(size) + direction * step))
}
