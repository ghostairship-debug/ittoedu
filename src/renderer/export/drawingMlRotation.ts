export function rotationToDrawingMlDegree(deg: number): number {
  if (!Number.isFinite(deg)) return 0
  let norm = Math.round(deg * 60_000) % 21_600_000
  if (norm < 0) norm += 21_600_000
  return norm
}


