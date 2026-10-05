/** Maps local content coordinates to the owning parent's coordinates. */
export type AffineTransform = [number, number, number, number, number, number]

export interface ComponentFrame {
  width: number
  height: number
  transform: AffineTransform
}

export const identityTransform = (): AffineTransform => [1, 0, 0, 1, 0, 0]
