import type { EditorStoreKernel } from '../../store/editorStoreKernel'
import type { ComponentEdit } from '../../../shared/contracts/component-platform/operations'
import { resolveComponentBackground, type ComponentAsset, type JsonObject } from '../../../shared/contracts/component-platform/project'
import type { CapturedCourseTarget } from '../../documents/CourseV10DocumentBridge'
import { componentIsLocked, componentParentMatrix } from '../crossSurfaceCommands'
import { frameCorners, translateFrame, transformVector, invertMatrix } from '../../../core/components/geometry'
import type { ComponentFrame } from '../../../shared/contracts/component-platform/frame'
import { slideLightPageCommands, slideLightObjectCommands, type SlideLightCommand } from '../../editing/commands/slideLightCommands'

export interface SlideLightPageTarget extends CapturedCourseTarget { readonly kind: 'page' }
export interface SlideLightObjectTarget extends CapturedCourseTarget { readonly kind: 'object'; readonly instanceId: string; readonly itemId: string }
export type SlideLightSelectionSnapshot = SlideLightPageTarget | SlideLightObjectTarget
export interface SlideLightPageView { readonly target: SlideLightPageTarget; readonly commands: readonly SlideLightCommand[]; readonly backgroundColor: string | null }
export interface SlideLightObjectView { readonly target: SlideLightObjectTarget; readonly commands: readonly SlideLightCommand[]; readonly fontFamily: string | null; readonly lineSpacing: number | null; readonly opacity: number }
export interface SlideLightEditingOwner {
  kernel: EditorStoreKernel
  chooseAudio?(): Promise<{ readonly asset: ComponentAsset; readonly bytes: Uint8Array } | null>
  placeAudio?(target: CapturedCourseTarget, selected: { readonly asset: ComponentAsset; readonly bytes: Uint8Array }): Promise<void>
  setBackground?(target: CapturedCourseTarget, color: string): Promise<void>
  runInteraction?(target: CapturedCourseTarget, kind: 'audio-play' | 'location-go', value: string): Promise<void>
  readSounds?(target: CapturedCourseTarget): readonly { id: string; name: string }[]
}
export function createSlideLightEditingPort(owner: SlideLightEditingOwner) {
  const { kernel } = owner
  const capturePage = (): SlideLightPageTarget | null => {
    if (!kernel.readView().project || kernel.readView().pending) return null
    const target = kernel.captureTarget()
    return target.editingProject.surfaces.find(surface => surface.id === target.surfaceId)?.kind === 'slide' ? { ...target, kind: 'page' } : null
  }
  const captureObject = (): SlideLightObjectTarget | null => {
    const page = capturePage()
    return page?.instanceId && page.instanceIds.length === 1 ? { ...page, kind: 'object', instanceId: page.instanceId, itemId: page.instanceId } : null
  }
  const viewPage = (target: SlideLightPageTarget): SlideLightPageView => {
    const surface = target.editingProject.surfaces.find(value => value.id === target.surfaceId)
    if (!surface) throw new Error('页面已不存在')
    const base = target.project.surfaces.find(value => value.id === target.surfaceId)
    const state = base?.presentation?.states.find(value => value.id === target.activeStateId)
    return { target, backgroundColor: resolveComponentBackground(target.editingProject,surface).color,
      commands: slideLightPageCommands({stateBackgroundOverride:Boolean(state?.background)}).map(command => ({ ...command, disabledReason: command.kind === 'audio-import' ? owner.chooseAudio && owner.placeAudio ? null : '音频放置入口尚未接入' : command.disabledReason })) }
  }
  const viewObject = (target: SlideLightObjectTarget): SlideLightObjectView => {
    const item = target.editingProject.instances[target.instanceId]
    if (!item) throw new Error('对象已不存在')
    const data = item.data && typeof item.data === 'object' && !Array.isArray(item.data) ? item.data as JsonObject : {}
    const appearance = data.appearance && typeof data.appearance === 'object' && !Array.isArray(data.appearance) ? data.appearance as JsonObject : {}
    const key = target.editingProject.definitions[item.definitionId]?.implementation
    const commands = slideLightObjectCommands({ isText: key?.kind === 'builtin' && key.key === 'guoling.text', locked: componentIsLocked(target.editingProject,target.instanceId),
      clickBindable: Boolean(owner.runInteraction), sounds: owner.readSounds?.(target) ?? [], locations: target.editingProject.surfaces.map(surface => ({ id: surface.id, label: surface.title })) })
    return { target, commands, fontFamily: typeof appearance.fontFamily === 'string' ? appearance.fontFamily : null,
      lineSpacing: typeof appearance.lineHeight === 'number' ? Math.round((appearance.lineHeight - 1) * Number(appearance.fontSize ?? 24)) : null,
      opacity: typeof item.style?.opacity === 'number' ? item.style.opacity : 1 }
  }
  const commit = (target: CapturedCourseTarget, edits: ComponentEdit[]) => kernel.editCaptured(kernel.capture(edits, target)).then(() => {})
  const placeAudio = async (target: SlideLightPageTarget) => {
    if (!owner.chooseAudio || !owner.placeAudio) throw new Error('音频放置入口尚未接入')
    const selected = await owner.chooseAudio()
    if (selected) await owner.placeAudio(target, selected)
  }
  const runPage = async (target: SlideLightPageTarget, command: SlideLightCommand) => {
    const available = viewPage(target).commands.find(value => value.id === command.id)
    if (!available || available.disabledReason) throw new Error(available?.disabledReason ?? '当前页面操作不可用')
    if (available.kind === 'audio-import') await placeAudio(target)
    else if (available.kind === 'scene-background') {
      if(owner.setBackground) await owner.setBackground(target,String(available.value))
      else { const surface=target.project.surfaces.find(value=>value.id===target.surfaceId)!; await commit(target,[{type:'surface.background.set',surfaceId:surface.id,background:{...surface.background,mode:'own',color:String(available.value)}}]) }
    }
  }
  const runObject = async (target: SlideLightObjectTarget, command: SlideLightCommand) => {
    const available = viewObject(target).commands.find(value => value.id === command.id)
    if (!available || available.disabledReason) throw new Error(available?.disabledReason ?? '当前对象操作不可用')
    const id = target.instanceId, value = available.value, item = target.editingProject.instances[id]
    switch (available.kind) {
      case 'opacity': return commit(target, [{ type: 'style.set', instanceId: id, path: ['opacity'], value: Number(value) }])
      case 'font': return commit(target, [{ type: 'data.set', instanceId: id, path: ['appearance','fontFamily'], value: String(value) }])
      case 'line-spacing': return commit(target, [{ type: 'data.set', instanceId: id, path: ['appearance','lineHeight'], value: 1 + Number(value) / Number((item.data as JsonObject)?.appearance && ((item.data as JsonObject).appearance as JsonObject).fontSize || 24) }])
      case 'page-align': {
        const surface = target.editingProject.surfaces.find(value => value.id === target.surfaceId)
        if (!item.frame || !surface?.designSize) throw new Error('当前对象没有可对齐的页面 frame')
        const corners = frameCorners(item.frame, componentParentMatrix(target.editingProject,id)), xs = corners.map(point => point.x), ys = corners.map(point => point.y)
        const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys)
        const dx = value === 'left' ? -left : value === 'center-x' ? (surface.designSize.width - left - right) / 2 : value === 'right' ? surface.designSize.width - right : 0
        const dy = value === 'top' ? -top : value === 'center-y' ? (surface.designSize.height - top - bottom) / 2 : value === 'bottom' ? surface.designSize.height - bottom : 0
        return commit(target, [{ type: 'frame.set', instanceId: id, frame: translateFrame(item.frame, transformVector(invertMatrix(componentParentMatrix(target.editingProject,id)), { x: dx, y: dy })) as ComponentFrame }])
      }
      case 'audio-play': case 'location-go': if (owner.runInteraction) return owner.runInteraction(target, available.kind, String(value)); throw new Error('点击互动入口尚未接入')
      default: throw new Error('当前对象操作不可用')
    }
  }
  return { capturePage, captureObject, viewPage, viewObject, runPage, runObject, placeAudio }
}
export type SlideLightEditingPort = ReturnType<typeof createSlideLightEditingPort>


