import { componentContainers } from '../../shared/contracts/component-platform/project'
import { frameToSpaceMatrix, invertMatrix, multiplyMatrices, transformPoint, type AffineMatrix, type GeometryPoint } from '../../core/components/geometry'
import { isComponentVisibleAtSurface, type ComponentFrame, type ComponentEdit, type CourseProjectV10 } from '../../shared/contracts/component-platform'
import { normalizeElbowLineAuthoring, normalizeStraightLineAuthoring, resolveNativeLinePoints } from '../../shared/nativeLineGeometry'
import type { NativeLineGeometry } from '../../shared/contracts/native-v1/types'
import type { CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import { resolveGroupSelectionIntent, type GroupSelectionIntent } from '../documents/containerEditingContext'
import { FreeTransformGesture, freeSurfaceTargets, hitFreeObject, marqueeFreeTargets, sameFreeTarget, selectedFreeTargets,
  type FreeObjectTarget, type FreeResizeHandle, type FreeSnapGuide } from '../componentPlatform/surfaces/slide'

export interface SlideAuthoringPointer { x: number; y: number; additive?: boolean; altKey?: boolean; shiftKey?: boolean }
/** The original down intent survives a content ACK without repeating its screen hit. */
export type SlideWorkspacePointerHit = ({ kind: 'object'; instanceId: string; visibleInstanceId?: string; authorKey?: string } | { kind: 'blank' }) & { activeGroupId?: string | null }
export interface SlideWorkspaceAuthoringState { project: CourseProjectV10; surfaceId: string; documentId: string; selectedInstanceIds: readonly string[]; activeStateId?: string | null; activeGroupId?: string | null; editingScope?: 'scene' | 'global' }
export interface SlideWorkspaceAuthoringPorts {
  read(): SlideWorkspaceAuthoringState | null
  capture(): CapturedCourseTarget
  select(ids: readonly string[]): void
  selectCanvas?(ids: readonly string[], groupId: string | null, authorKey?: string): void
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
  let gesture: { target: CapturedCourseTarget; value: FreeTransformGesture; edits: ComponentEdit[]; origin: GeometryPoint; moved: boolean; click?: GroupSelectionIntent; authorKey?: string } | null = null
  let marquee: { start: GeometryPoint; extend: readonly string[]; target: CapturedCourseTarget } | null = null
  let output = empty()
  const cancelGesture = () => { gesture = null; marquee = null; output = empty(); return output }
  const captureHit = (pointer: SlideAuthoringPointer, surfaceToPointer: AffineMatrix): SlideWorkspacePointerHit => {
    const state = ports.read(), targets = listSlideWorkspaceHitTargets(state)
    const at = transformPoint(invertMatrix(surfaceToPointer), point(pointer))
    const leaf = hitFreeObject(targets, at, true, surfaceToPointer)
    const intent = state && leaf && resolveGroupSelectionIntent(state.project, state.surfaceId, leaf.instanceId,
      state.selectedInstanceIds, state.activeGroupId, pointer.altKey, pointer.additive)
    return intent ? { kind: 'object', instanceId: intent.pressId, visibleInstanceId: leaf!.instanceId, activeGroupId: state?.activeGroupId ?? null }
      : { kind: 'blank', activeGroupId: state?.activeGroupId ?? null }
  }
  const pointerDown = (pointer: SlideAuthoringPointer, surfaceToPointer: AffineMatrix, handle?: FreeResizeHandle | 'rotate', capturedHit?: SlideWorkspacePointerHit) => {
    const state = ports.read()
    if (!state) return cancelGesture()
    if (capturedHit && 'activeGroupId' in capturedHit && (capturedHit.activeGroupId ?? null) !== (state.activeGroupId ?? null)) {
      ports.report('编辑层级已改变，已取消原来的选择手势')
      return cancelGesture()
    }
    const targets = listSlideWorkspaceHitTargets(state)
    const at = transformPoint(invertMatrix(surfaceToPointer), point(pointer))
    let ids = [...state.selectedInstanceIds]
    let click: GroupSelectionIntent | undefined, authorKey: string | undefined
    if (!handle) {
      const intent = capturedHit ?? captureHit(pointer, surfaceToPointer)
      const resolved = intent.kind === 'object' && resolveGroupSelectionIntent(state.project, state.surfaceId,
        intent.visibleInstanceId ?? intent.instanceId, state.selectedInstanceIds, state.activeGroupId, pointer.altKey, pointer.additive)
      if (resolved && !pointer.additive) { click = resolved; authorKey = intent.kind === 'object' ? intent.authorKey : undefined }
      const hit = resolved ? targets.find(target => target.instanceId === resolved.pressId) : undefined
      if (intent.kind === 'object' && !hit) { ports.report('最初选择的对象已不存在或离开当前编辑范围，未切换到其他对象。'); return cancelGesture() }
      if (!hit) {
        marquee = { start: at, extend: pointer.additive ? ids : [], target: ports.capture() }
        if (!pointer.additive) ports.select([])
        return output = { ...empty(), marquee: { start: at, end: at } }
      }
      if (pointer.additive) {
        ids = ids.includes(hit.instanceId) ? ids.filter(id => id !== hit.instanceId) : [...ids, hit.instanceId]
        ports.select(ids)
        return output = empty()
      }
      if (!ids.includes(hit.instanceId)) { ids = [hit.instanceId]; if (ports.selectCanvas) ports.selectCanvas(ids, resolved && resolved.pressId === resolved.clickId ? resolved.groupId : state.activeGroupId ?? null); else ports.select(ids) }
      else if (capturedHit) ports.select(ids) // This resumed intent explicitly chose objects, including an old field's owner.
    }
    const selected = selectedFreeTargets(targets, ids).filter(target =>
      [target.instanceId, ...target.ancestors].every(id => !state.project.instances[id]?.locked))
    if (!selected.length) return cancelGesture()
    gesture = { target: ports.capture(), origin: point(pointer), moved: false, edits: [], click, authorKey, value: new FreeTransformGesture({
      mode: handle === 'rotate' ? 'rotate' : handle ? 'resize' : 'drag', handle: handle === 'rotate' ? undefined : handle,
      targets: selected, pointer: point(pointer), surfaceToPointer, snapTargets: targets,
      designSize: componentContainers(state.project).find(surface => surface.id === state.surfaceId)?.designSize,
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
      if (state && state.documentId === marquee.target.documentId && state.surfaceId === marquee.target.surfaceId
        && (state.activeGroupId ?? null) === (marquee.target.activeGroupId ?? null))
        {
          const ids = [...new Set([...marquee.extend, ...marqueeFreeTargets(listSlideWorkspaceHitTargets(state), marquee.start, at, state.activeGroupId)])]
          const isClick = Math.hypot(at.x - marquee.start.x, at.y - marquee.start.y) < CLICK_SLOP
          if (ports.selectCanvas) ports.selectCanvas(ids, isClick && !ids.length ? null : state.activeGroupId ?? null)
          else ports.select(ids)
        }
      return cancelGesture()
    }
    pointerMove(pointer, surfaceToPointer)
    const current = gesture, state = ports.read()
    cancelGesture()
    if (!current || !state) return output
    if (!current.moved) {
      if (current.click && state.documentId === current.target.documentId && state.surfaceId === current.target.surfaceId
        && (state.activeGroupId ?? null) === (current.target.activeGroupId ?? null)
        && state.project.instances[current.click.clickId]) {
        if (ports.selectCanvas) ports.selectCanvas([current.click.clickId], current.click.groupId, current.authorKey)
        else ports.select([current.click.clickId])
      }
      return output
    }
    if (!current.edits.length) return output
    const latest = listSlideWorkspaceHitTargets(state)
    if (state.documentId !== current.target.documentId || state.surfaceId !== current.target.surfaceId ||
      (state.activeGroupId ?? null) !== (current.target.activeGroupId ?? null) ||
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
  return { captureHit, pointerDown, pointerMove, pointerUp, cancelGesture,
    ownsCurrentGesture() { const current=ports.read();return Boolean(gesture && current && current.documentId===gesture.target.documentId && current.surfaceId===gesture.target.surfaceId && (current.activeGroupId ?? null)===(gesture.target.activeGroupId ?? null)) },
    contextTarget(pointer: GeometryPoint, surfaceToPointer: AffineMatrix) {
      const state=ports.read(),leaf=hitFreeObject(listSlideWorkspaceHitTargets(state),transformPoint(invertMatrix(surfaceToPointer),pointer),true,surfaceToPointer)
      const intent=state && leaf && resolveGroupSelectionIntent(state.project,state.surfaceId,leaf.instanceId,state.selectedInstanceIds,state.activeGroupId)
      if(!intent)return null
      if(!state!.selectedInstanceIds.includes(intent.pressId)){
        if(ports.selectCanvas)ports.selectCanvas([intent.pressId],intent.groupId);else ports.select([intent.pressId])
      }
      return intent.pressId
    },
  }
}
