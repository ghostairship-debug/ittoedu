import { frameToSpaceMatrix, invertMatrix, multiplyMatrices, transformPoint, type AffineMatrix, type GeometryPoint } from '../../core/components/geometry'
import { isComponentVisibleAtSurface, type ComponentFrame, type ComponentEdit, type CourseProjectV10 } from '../../shared/contracts/component-platform'
import { normalizeElbowLineAuthoring, normalizeStraightLineAuthoring, resolveNativeLinePoints } from '../../shared/nativeLineGeometry'
import type { NativeLineGeometry } from '../../shared/contracts/native-v1/types'
import type { CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import { FreeTransformGesture, freeSurfaceTargets, hitFreeObject, marqueeFreeTargets, sameFreeTarget, selectedFreeTargets,
  type FreeObjectTarget, type FreeResizeHandle, type FreeSnapGuide } from '../componentPlatform/surfaces/slide'

export interface SlideAuthoringPointer { x: number; y: number; additive?: boolean; altKey?: boolean; shiftKey?: boolean }
export interface SlideWorkspaceAuthoringState { project: CourseProjectV10; surfaceId: string; documentId: string; selectedInstanceIds: readonly string[]; activeStateId?: string | null; editingScope?: 'scene' | 'global' }
export interface SlideWorkspaceAuthoringPorts {
  read(): SlideWorkspaceAuthoringState | null
  capture(): CapturedCourseTarget
  select(ids: readonly string[]): void
  commit(edits: ComponentEdit[], target: CapturedCourseTarget, historyGroup: string): Promise<unknown>
  report(message: string): void
}
export interface SlideWorkspaceAuthoringResult {
  preview: Record<string, ComponentFrame>
  guides: readonly FreeSnapGuide[]
  marquee: { start: GeometryPoint; end: GeometryPoint } | null
}

/** Reframe a moved endpoint in its original affine parent space, preserving the opposite endpoint. */
export function proposeSlideLineHandle(target: FreeObjectTarget, geometry: NativeLineGeometry, handle: 'start' | 'end' | 'elbow', at: GeometryPoint) {
  const local = transformPoint(invertMatrix(frameToSpaceMatrix(target.frame, target.parentToSurface)), at)
  const points = resolveNativeLinePoints(geometry, target.frame.width, target.frame.height)
  const start = handle === 'start' ? local : points[0]!, end = handle === 'end' ? local : points.at(-1)!
  const value = geometry.kind === 'straight' ? normalizeStraightLineAuthoring(start, end)
    : normalizeElbowLineAuthoring(start, end, geometry.axis, handle === 'elbow'
      ? geometry.axis === 'horizontal' ? local.x : local.y
      : geometry.position * (geometry.axis === 'horizontal' ? target.frame.width : target.frame.height))
  if (!value) return null
  const frame: ComponentFrame = { width: value.frame.width, height: value.frame.height,
    transform: [...multiplyMatrices(target.frame.transform, [1, 0, 0, 1, value.frame.x, value.frame.y])] }
  return { frame, geometry: value.lineGeometry }
}

/** Derived eligibility. Hidden or locked ancestors protect the whole branch. */
export function listSlideWorkspaceHitTargets(state: SlideWorkspaceAuthoringState | null): FreeObjectTarget[] {
  if (!state) return []
  return freeSurfaceTargets(state.project, state.surfaceId).filter(target => {
    const root = target.ancestors[0] ?? target.instanceId
    const global = state.project.global.underlay.includes(root) || state.project.global.overlay.includes(root)
    if (state.editingScope === 'global' && !global) return false
    if (state.editingScope === 'scene' && global && state.project.instances[root]?.definitionId !== 'guoling.navigation') return false
    return [target.instanceId, ...target.ancestors].every(id => {
      const instance = state.project.instances[id]
      return instance && isComponentVisibleAtSurface(instance, state.surfaceId)
    })
  })
}
const empty = (): SlideWorkspaceAuthoringResult => ({ preview: {}, guides: [], marquee: null })
const point = (pointer: SlideAuthoringPointer) => ({ x: pointer.x, y: pointer.y })
const CLICK_SLOP = 3

/** The mature workspace owns chrome/pan. This service only proposes affine edits. */
export function createSlideWorkspaceAuthoringController(ports: SlideWorkspaceAuthoringPorts) {
  let gesture: { target: CapturedCourseTarget; value: FreeTransformGesture; edits: ComponentEdit[]; origin: GeometryPoint; moved: boolean } | null = null
  let marquee: { start: GeometryPoint; extend: readonly string[] } | null = null
  let output = empty()
  const cancelGesture = () => { gesture = null; marquee = null; output = empty(); return output }
  const pointerDown = (pointer: SlideAuthoringPointer, surfaceToPointer: AffineMatrix, handle?: FreeResizeHandle | 'rotate') => {
    const state = ports.read()
    if (!state) return cancelGesture()
    const targets = listSlideWorkspaceHitTargets(state)
    const at = transformPoint(invertMatrix(surfaceToPointer), point(pointer))
    let ids = [...state.selectedInstanceIds]
    if (!handle) {
      const hit = hitFreeObject(targets, at, Boolean(pointer.altKey))
      if (!hit) {
        marquee = { start: at, extend: pointer.additive ? ids : [] }
        if (!pointer.additive) ports.select([])
        return output = { ...empty(), marquee: { start: at, end: at } }
      }
      if (pointer.additive) {
        ids = ids.includes(hit.instanceId) ? ids.filter(id => id !== hit.instanceId) : [...ids, hit.instanceId]
        ports.select(ids)
        return output = empty()
      }
      if (!ids.includes(hit.instanceId)) { ids = [hit.instanceId]; ports.select(ids) }
    }
    const selected = selectedFreeTargets(targets, ids).filter(target =>
      [target.instanceId, ...target.ancestors].every(id => !state.project.instances[id]?.locked))
    if (!selected.length) return cancelGesture()
    gesture = { target: ports.capture(), origin: point(pointer), moved: false, edits: [], value: new FreeTransformGesture({
      mode: handle === 'rotate' ? 'rotate' : handle ? 'resize' : 'drag', handle: handle === 'rotate' ? undefined : handle,
      targets: selected, pointer: point(pointer), surfaceToPointer, snapTargets: targets,
      designSize: state.project.surfaces.find(surface => surface.id === state.surfaceId)?.designSize,
    }) }
    return output = empty()
  }
  const pointerMove = (pointer: SlideAuthoringPointer, surfaceToPointer: AffineMatrix) => {
    if (marquee) {
      const end = transformPoint(invertMatrix(surfaceToPointer), point(pointer))
      return output = { ...empty(), marquee: { start: marquee.start, end } }
    }
    if (!gesture) return output
    if (!gesture.moved && Math.hypot(pointer.x - gesture.origin.x, pointer.y - gesture.origin.y) < CLICK_SLOP) return output
    gesture.moved = true
    const proposal = gesture.value.update(point(pointer), { shift: pointer.shiftKey, alt: pointer.altKey })
    gesture.edits = proposal.edits
    const preview: Record<string, ComponentFrame> = {}
    for (const edit of proposal.edits) if (edit.type === 'frame.set' && edit.frame) preview[edit.instanceId] = edit.frame
    return output = { preview, guides: proposal.guides, marquee: null }
  }
  const pointerUp = async (pointer: SlideAuthoringPointer, surfaceToPointer: AffineMatrix) => {
    if (marquee) {
      const state = ports.read(), at = transformPoint(invertMatrix(surfaceToPointer), point(pointer))
      ports.select([...new Set([...marquee.extend, ...marqueeFreeTargets(listSlideWorkspaceHitTargets(state), marquee.start, at)])])
      return cancelGesture()
    }
    pointerMove(pointer, surfaceToPointer)
    const current = gesture, state = ports.read()
    cancelGesture()
    if (!current || !current.moved || !current.edits.length || !state) return output
    const latest = listSlideWorkspaceHitTargets(state)
    if (state.documentId !== current.target.documentId || state.surfaceId !== current.target.surfaceId ||
      state.activeStateId !== undefined && state.activeStateId !== current.target.activeStateId ||
      !current.value.targets.every(original => {
        const now = latest.find(target => target.instanceId === original.instanceId)
        return now && sameFreeTarget(original, now) && [now.instanceId, ...now.ancestors].every(id => !state.project.instances[id]?.locked)
      })) {
      ports.report('对象或父级位置已改变，已取消本次拖动')
      return output
    }
    try { await ports.commit(current.edits, current.target, crypto.randomUUID()) }
    catch (error) { ports.report(error instanceof Error ? error.message : String(error)) }
    return output
  }
  return { pointerDown, pointerMove, pointerUp, cancelGesture,
    contextTarget(pointer: GeometryPoint, surfaceToPointer: AffineMatrix) {
      const state = ports.read(), hit = hitFreeObject(listSlideWorkspaceHitTargets(state), transformPoint(invertMatrix(surfaceToPointer), pointer))
      if (!hit) return null
      if (!state?.selectedInstanceIds.includes(hit.instanceId)) ports.select([hit.instanceId])
      return hit.instanceId
    },
  }
}
