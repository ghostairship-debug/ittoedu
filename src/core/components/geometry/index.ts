/**
 * CSS/Canvas 2D affine convention: [a, b, c, d, e, f] maps a column point to
 * (a*x + c*y + e, b*x + d*y + f). Coordinates are CSS/logical pixels, x right
 * and y down; positive rotation in radians is clockwise on screen.
 *
 * A frame maps its local upper-left (0, 0) to its parent. Width and height stay
 * local dimensions; no matrix decomposition or visual AABB is author geometry.
 * Translation, rotation, nonuniform scale, reflection and shear are supported.
 * Operations requiring an inverse reject a singular transform.
 */
export type AffineMatrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number]

export interface GeometryPoint {
  readonly x: number
  readonly y: number
}

/** Structural math input, also usable with the formal component frame. */
export interface AffineFrame {
  readonly width: number
  readonly height: number
  readonly transform: AffineMatrix
}

export const IDENTITY_MATRIX: AffineMatrix = [1, 0, 0, 1, 0, 0]

/** left * right: apply right first, then left. */
export function multiplyMatrices(left: AffineMatrix, right: AffineMatrix): AffineMatrix {
  const [a, b, c, d, e, f] = left
  const [g, h, i, j, k, l] = right
  return [
    a * g + c * h, b * g + d * h,
    a * i + c * j, b * i + d * j,
    a * k + c * l + e, b * k + d * l + f,
  ]
}

/** Outer-to-inner order, e.g. composeMatrices(camera, group, child). */
export function composeMatrices(...matrices: readonly AffineMatrix[]): AffineMatrix {
  return matrices.reduce(multiplyMatrices, IDENTITY_MATRIX)
}

export function invertMatrix(matrix: AffineMatrix): AffineMatrix {
  const [a, b, c, d, e, f] = matrix
  const determinant = a * d - b * c
  if (determinant === 0) throw new RangeError('A singular affine transform has no inverse')
  return [
    d / determinant, -b / determinant, -c / determinant, a / determinant,
    (c * f - d * e) / determinant, (b * e - a * f) / determinant,
  ]
}

export function transformPoint(matrix: AffineMatrix, point: GeometryPoint): GeometryPoint {
  const [a, b, c, d, e, f] = matrix
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f }
}

/** Deltas have no translation; use this for pointer movement and directions. */
export function transformVector(matrix: AffineMatrix, vector: GeometryPoint): GeometryPoint {
  const [a, b, c, d] = matrix
  return { x: a * vector.x + c * vector.y, y: b * vector.x + d * vector.y }
}

export function translationMatrix(x: number, y: number): AffineMatrix {
  return [1, 0, 0, 1, x, y]
}

export function scaleMatrix(x: number, y = x): AffineMatrix {
  return [x, 0, 0, y, 0, 0]
}

export function rotationMatrix(radians: number): AffineMatrix {
  const cosine = Math.cos(radians), sine = Math.sin(radians)
  return [cosine, sine, -sine, cosine, 0, 0]
}

/** Apply a linear/affine operation around a point in the same coordinates. */
export function matrixAroundPoint(matrix: AffineMatrix, anchor: GeometryPoint): AffineMatrix {
  return composeMatrices(
    translationMatrix(anchor.x, anchor.y), matrix, translationMatrix(-anchor.x, -anchor.y),
  )
}

/** parentToSpace may include every ancestor and the camera/viewport matrix. */
export function frameToSpaceMatrix(
  frame: AffineFrame,
  parentToSpace: AffineMatrix = IDENTITY_MATRIX,
): AffineMatrix {
  return multiplyMatrices(parentToSpace, frame.transform)
}

export function framePointToSpace(
  frame: AffineFrame,
  localPoint: GeometryPoint,
  parentToSpace: AffineMatrix = IDENTITY_MATRIX,
): GeometryPoint {
  return transformPoint(frameToSpaceMatrix(frame, parentToSpace), localPoint)
}

export function spacePointToFrame(
  frame: AffineFrame,
  spacePoint: GeometryPoint,
  parentToSpace: AffineMatrix = IDENTITY_MATRIX,
): GeometryPoint {
  return transformPoint(invertMatrix(frameToSpaceMatrix(frame, parentToSpace)), spacePoint)
}

/** Rectangular frame hit test; a shape can refine the returned local point. */
export function frameContainsPoint(
  frame: AffineFrame,
  spacePoint: GeometryPoint,
  parentToSpace: AffineMatrix = IDENTITY_MATRIX,
): boolean {
  const local = spacePointToFrame(frame, spacePoint, parentToSpace)
  return local.x >= 0 && local.x <= frame.width && local.y >= 0 && local.y <= frame.height
}

/** Move in parent coordinates, preserving local dimensions and linear transform. */
export function translateFrame<T extends AffineFrame>(frame: T, parentDelta: GeometryPoint): T {
  return { ...frame, transform: multiplyMatrices(translationMatrix(parentDelta.x, parentDelta.y), frame.transform) }
}

/**
 * start/end are in the same pointer space (typically client CSS pixels).
 * parentToPointerSpace includes camera zoom and nested parents, never this frame.
 * Each update uses the gesture's original frame and original pointer.
 */
export function dragFrame<T extends AffineFrame>(
  frame: T,
  startPointer: GeometryPoint,
  endPointer: GeometryPoint,
  parentToPointerSpace: AffineMatrix = IDENTITY_MATRIX,
): T {
  const delta = transformVector(invertMatrix(parentToPointerSpace), {
    x: endPointer.x - startPointer.x, y: endPointer.y - startPointer.y,
  })
  return translateFrame(frame, delta)
}

/** Scale along local axes around a fixed local anchor; dimensions stay local. */
export function scaleFrame<T extends AffineFrame>(
  frame: T,
  x: number,
  y: number,
  localAnchor: GeometryPoint,
): T {
  return { ...frame, transform: multiplyMatrices(frame.transform, matrixAroundPoint(scaleMatrix(x, y), localAnchor)) }
}

/** Rotate in the parent plane, preserving the mapped local anchor. */
export function rotateFrame<T extends AffineFrame>(
  frame: T,
  radians: number,
  localAnchor: GeometryPoint,
): T {
  const parentAnchor = transformPoint(frame.transform, localAnchor)
  return { ...frame, transform: multiplyMatrices(matrixAroundPoint(rotationMatrix(radians), parentAnchor), frame.transform) }
}

/**
 * Re-express a frame under a different parent, retaining all four visual corners.
 * Both parent matrices map into the same space. For grouping, newParentToSpace
 * includes the group; for ungrouping, oldParentToSpace includes it.
 */
export function reparentFrame<T extends AffineFrame>(
  frame: T,
  oldParentToSpace: AffineMatrix,
  newParentToSpace: AffineMatrix,
): T {
  return { ...frame, transform: composeMatrices(invertMatrix(newParentToSpace), oldParentToSpace, frame.transform) }
}

/** Derived corners for chrome/rendering, never a replacement for the frame. */
export function frameCorners(
  frame: AffineFrame,
  parentToSpace: AffineMatrix = IDENTITY_MATRIX,
): readonly [GeometryPoint, GeometryPoint, GeometryPoint, GeometryPoint] {
  const matrix = frameToSpaceMatrix(frame, parentToSpace)
  return [
    transformPoint(matrix, { x: 0, y: 0 }),
    transformPoint(matrix, { x: frame.width, y: 0 }),
    transformPoint(matrix, { x: frame.width, y: frame.height }),
    transformPoint(matrix, { x: 0, y: frame.height }),
  ]
}
