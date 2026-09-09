import type { Locator } from '@playwright/test'

export type CanvasPose = { at: number; colors: string[]; coordinates: number[] }
export type CanvasMotion = { source: 'actual-preview-canvas-painted-quadrilaterals'; runtimeId: string; poses: CanvasPose[] }

/** Test-only transparent taps on this canvas instance. Every native operation is
 * executed first, unchanged. No animation callbacks or clocks are replaced. */
export async function startCanvasPoseObservation(root: Locator) {
  return root.evaluateHandle(element => {
    const canvases: HTMLCanvasElement[] = []
    const visit = (node: Element) => {
      if (node instanceof HTMLCanvasElement) canvases.push(node)
      if (node.shadowRoot) Array.from(node.shadowRoot.children).forEach(visit)
      Array.from(node.children).forEach(visit)
    }
    visit(element)
    if (canvases.length !== 1) throw new Error('Canvas pose observer requires one actual runtime canvas')
    const canvas = canvases[0]!, ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas pose observer requires the actual Canvas2D carrier')
    const poses: CanvasPose[] = [], restore: Array<() => void> = []
    let path: number[] = [], faces = new Map<string, number[]>(), overflow = false
    const tap = (name: 'beginPath' | 'moveTo' | 'lineTo' | 'fill' | 'clearRect', read: (args: unknown[]) => void) => {
      const descriptor = Object.getOwnPropertyDescriptor(ctx, name)
      const native = ctx[name] as (...args: unknown[]) => unknown
      Object.defineProperty(ctx, name, { configurable: true, writable: true, value: function (...args: unknown[]) {
        const result = Reflect.apply(native, ctx, args)
        read(args)
        return result
      } })
      restore.push(() => { if (descriptor) Object.defineProperty(ctx, name, descriptor); else delete (ctx as unknown as Record<string, unknown>)[name] })
    }
    tap('clearRect', () => { faces = new Map(); path = [] })
    tap('beginPath', () => { path = [] })
    const point = (args: unknown[]) => {
      const matrix = ctx.getTransform(), p = matrix.transformPoint({ x: Number(args[0]), y: Number(args[1]) })
      path.push(p.x / canvas.width, p.y / canvas.height)
    }
    tap('moveTo', point)
    tap('lineTo', point)
    tap('fill', args => {
      // This narrow observer supports six separately colored quad faces. Other
      // carriers or paths remain explicitly unmeasurable, never silently pass.
      if (args.length || path.length !== 8 || typeof ctx.fillStyle !== 'string' || ctx.globalAlpha !== 1) return
      faces.set(ctx.fillStyle, [...path])
      if (faces.size !== 6) return
      const colors = [...faces.keys()].sort()
      if (poses.length >= 1024) { overflow = true; return }
      poses.push({ at: performance.now(), colors, coordinates: colors.flatMap(color => faces.get(color)!) })
      faces = new Map()
    })
    let stopped = false
    return { stop() { if (!stopped) { restore.reverse().forEach(fn => fn()); stopped = true } return { poses, overflow } } }
  })
}

export function validateCanvasPoses(poses: CanvasPose[]) {
  if (poses.length < 8) throw new Error('Canvas motion measurement insufficient: fewer than eight painted poses')
  const first = poses[0]!
  if (first.colors.length !== 6 || first.coordinates.length !== 48) throw new Error('Canvas pose topology unsupported')
  for (let index = 0; index < poses.length; index++) {
    const pose = poses[index]!
    if (pose.colors.join('|') !== first.colors.join('|') || pose.coordinates.length !== 48 || !pose.coordinates.every(Number.isFinite)
      || index > 0 && pose.at <= poses[index - 1]!.at) throw new Error('Canvas pose identity or real clock is unstable')
  }
  const distance = (a: number[], b: number[]) => Math.sqrt(a.reduce((sum, value, index) => sum + (value - b[index]!) ** 2, 0) / a.length)
  const travel = poses.slice(1).reduce((sum, pose, index) => sum + distance(pose.coordinates, poses[index]!.coordinates), 0)
  if (travel < .08 || poses.filter(pose => distance(pose.coordinates, first.coordinates) > .02).length < 5) throw new Error('Canvas motion is static or too small to measure')
  return { paintedPoseCount: poses.length, elapsedMs: poses.at(-1)!.at - first.at, normalizedGeometryTravel: travel }
}

/** Match actual painted geometry to the reference trajectory, with an arbitrary
 * initial phase. The independent variables are real timestamps, never constants
 * parsed from Runtime source. Unsupported shape/path changes fail explicitly. */
export function compareCanvasMotion(before: CanvasMotion, after: CanvasMotion) {
  validateCanvasPoses(before.poses); validateCanvasPoses(after.poses)
  if (before.runtimeId !== after.runtimeId || before.poses[0]!.colors.join('|') !== after.poses[0]!.colors.join('|')) throw new Error('Canvas motion target or face identity changed')
  const matched = after.poses.map(pose => {
    let best = { residual: Infinity, referenceAt: 0 }
    for (let index = 1; index < before.poses.length; index++) {
      const a = before.poses[index - 1]!, b = before.poses[index]!
      const vector = b.coordinates.map((value, i) => value - a.coordinates[i]!)
      const length = vector.reduce((sum, value) => sum + value * value, 0)
      if (length < 1e-10) continue
      const fraction = Math.max(0, Math.min(1, vector.reduce((sum, value, i) => sum + value * (pose.coordinates[i]! - a.coordinates[i]!), 0) / length))
      const residual = Math.sqrt(vector.reduce((sum, value, i) => sum + (pose.coordinates[i]! - a.coordinates[i]! - fraction * value) ** 2, 0) / vector.length)
      if (residual < best.residual) best = { residual, referenceAt: a.at + fraction * (b.at - a.at) }
    }
    return { at: pose.at, ...best }
  }).filter(sample => sample.residual < .008)
  if (matched.length < 8 || matched.length < after.poses.length * .6) throw new Error('Canvas trajectories do not have sufficient matching geometry')
  const start = matched[0]!, end = matched.at(-1)!
  if (end.referenceAt - start.referenceAt < (before.poses.at(-1)!.at - before.poses[0]!.at) * .25) throw new Error('Canvas matched phase coverage is insufficient')
  if (matched.some((sample, index) => index > 0 && sample.referenceAt < matched[index - 1]!.referenceAt - 1)) throw new Error('Canvas trajectory reverses or aliases')
  const meanX = matched.reduce((sum, p) => sum + p.at - start.at, 0) / matched.length
  const meanY = matched.reduce((sum, p) => sum + p.referenceAt - start.referenceAt, 0) / matched.length
  const xx = matched.reduce((sum, p) => sum + (p.at - start.at - meanX) ** 2, 0)
  const speedRatio = matched.reduce((sum, p) => sum + (p.at - start.at - meanX) * (p.referenceAt - start.referenceAt - meanY), 0) / xx
  const error = matched.reduce((sum, p) => sum + (p.referenceAt - start.referenceAt - meanY - speedRatio * (p.at - start.at - meanX)) ** 2, 0)
  const slopeStandardError = Math.sqrt(error / (matched.length - 2) / xx)
  if (!(speedRatio > 0 && speedRatio + 3 * slopeStandardError < 1)) throw new Error('Canvas actual matched-pose speed is not demonstrably slower')
  return { status: 'passed', mechanism: before.source, speedRatio, slopeStandardError, matched, clock: 'actual-painted-monotonic-wall-time' }
}
