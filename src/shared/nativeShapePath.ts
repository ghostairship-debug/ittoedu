import type { NativePathCommand, NativePathGeometry, NativeShapeContent } from './contracts/native-v1'

/** Resolve adjusted brace parameters once for Canvas, SVG and static consumers.
 * Quarter ellipses use the standard cubic approximation (radial error <0.03%).
 * The derived path is never written back into the authoring document. */
export function resolveNativeShapePath(data: NativeShapeContent, width: number, height: number): NativePathGeometry | undefined {
  if (data.pathGeometry) return data.pathGeometry
  const brace = data.braceGeometry
  if (!brace) return undefined
  const radius = Math.min(Math.min(width, height) * brace.curvatureRatio, height * Math.min(brace.midpoint, 1 - brace.midpoint) / 2)
  const midpoint = height * brace.midpoint
  const commands: NativePathCommand[] = []
  let current: [number, number] = [width, height]
  const normalize = ([x, y]: [number, number]): [number, number] => [data.shapeType === 'brace-right' ? 1 - x / width : x / width, y / height]
  commands.push({ kind: 'move', to: normalize(current) })
  const line = (to: [number, number]) => { commands.push({ kind: 'line', to: normalize(to) }); current = to }
  const arc = (start: number, sweep: number) => {
    const rx = width / 2, ry = radius
    const end = start + sweep, k = 4 / 3 * Math.tan(sweep / 4)
    const center: [number, number] = [current[0] - rx * Math.cos(start), current[1] - ry * Math.sin(start)]
    const to: [number, number] = [center[0] + rx * Math.cos(end), center[1] + ry * Math.sin(end)]
    commands.push({ kind: 'cubic',
      control1: normalize([current[0] - k * rx * Math.sin(start), current[1] + k * ry * Math.cos(start)]),
      control2: normalize([to[0] + k * rx * Math.sin(end), to[1] - k * ry * Math.cos(end)]), to: normalize(to),
    })
    current = to
  }
  arc(Math.PI / 2, Math.PI / 2)
  line([width / 2, midpoint + radius])
  arc(0, -Math.PI / 2)
  arc(Math.PI / 2, -Math.PI / 2)
  line([width / 2, radius])
  arc(Math.PI, Math.PI / 2)
  return { paths: [{ fill: false, stroke: true, commands }] }
}
