import type { ComponentInstance, ComponentLayoutInput, CourseProjectV10 } from './contracts/component-platform'
import { componentDefinitionBuiltinKey, owningContainer } from './contracts/component-platform'
import { componentLayoutInput } from '../components/web/measuredFragmentBox'
import { flowObjectExtent } from '../core/components/geometry/flowObjectExtent'
import { resolveFlowMediaLayoutProjection, type FlowMediaLayoutWidths } from './flowMediaLayout'
import { isNativeFlowLayoutGroup, nativeFlowContainerStyle, nativeFlowItemStyle, nativeFlowMediaBlockSize } from './flowNativeLayout'

export interface ComponentOuterPresentationInput {
  placement: 'free' | 'flow'
  purpose: 'author' | 'playback'
  inlineSize: number
  viewport?: { width: number; height: number }
  flowLayout?: FlowMediaLayoutWidths
}

export interface ComponentOuterPresentation {
  layoutInput: ComponentLayoutInput
  naturalFlow: boolean
  localAssembly: boolean
  extent: ReturnType<typeof flowObjectExtent>
  scale: number
  childrenPlacement: 'free' | 'flow'
  section: { open: boolean; collapsedByDefault: boolean } | null
  outerStyle: Record<string, string>
  stageStyle: Record<string, string>
  contentStyle: Record<string, string>
  childrenStyle: Record<string, string>
}

/** Global Web input uses the existing native document paint owner in every player. */
export function isGlobalFramedWebDocument(project: CourseProjectV10, instance: ComponentInstance): boolean {
  const implementation = instance.implementationOverride ?? project.definitions[instance.definitionId]?.implementation
  if (!instance.frame || implementation?.kind !== 'builtin' || !['guoling.web', 'guoling.html-program'].includes(implementation.key)) return false
  let id = instance.id
  const visited = new Set<string>()
  while (!visited.has(id)) {
    visited.add(id)
    const owner = owningContainer(project, id)
    if (owner?.kind === 'global') return true
    if (owner?.kind !== 'instance') return false
    id = owner.instanceId
  }
  return false
}

/** PM document sections and component projections share this author/playback policy. */
export function resolveSectionPresentation(data: { collapsedByDefault?: boolean },
  purpose: ComponentOuterPresentationInput['purpose']): { open: boolean; collapsedByDefault: boolean } {
  const collapsedByDefault = data.collapsedByDefault === true
  return { open: purpose === 'author' || !collapsedByDefault, collapsedByDefault }
}

const previousPresentationStyles = new WeakMap<HTMLElement, string[]>()
/** Clear only this projection's retired declarations on retained host nodes. */
export function applyComponentPresentationStyle(element: HTMLElement, style: Readonly<Record<string, string>>): void {
  for (const key of previousPresentationStyles.get(element) ?? []) if (!(key in style))
    element.style.removeProperty(key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`))
  Object.assign(element.style, style)
  previousPresentationStyles.set(element, Object.keys(style))
}

/** Outer placement only. React, PM and Player retain their DOM and mount ownership. */
export function resolveComponentOuterPresentation(project: CourseProjectV10, instance: ComponentInstance,
  input: ComponentOuterPresentationInput): ComponentOuterPresentation {
  const definition = project.definitions[instance.definitionId], frame = instance.frame
  const implementation = instance.implementationOverride ?? definition?.implementation
  const program = !instance.container && project.rootIds.includes(instance.id)
    && (implementation?.kind === 'source' || implementation?.kind === 'builtin' && ['guoling.web', 'guoling.html-program'].includes(implementation.key))
  const key = componentDefinitionBuiltinKey(definition)
  const documentBlock = key === 'guoling.document-block'
  const data = instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data) ? instance.data : {}
  const section = documentBlock && data.type === 'section'
    ? resolveSectionPresentation({ collapsedByDefault: data.collapsedByDefault === true }, input.purpose) : null
  const flow = input.placement === 'flow'
  const nativeLayout = flow && isNativeFlowLayoutGroup(instance, definition)
  const owner = flow ? owningContainer(project, instance.id) : null
  const parent = owner?.kind === 'instance' ? project.instances[owner.instanceId] : undefined
  const nativeItem = Boolean(parent && isNativeFlowLayoutGroup(parent, project.definitions[parent.definitionId]))
  const unframedExtent = flow && !nativeLayout && !frame && instance.childIds?.length ? flowObjectExtent(project, instance.id) : null
  const layoutInput = componentLayoutInput(instance, { project, kind: program ? 'program' : flow ? 'flow' : 'free-frame', inlineSize: input.inlineSize, definition, viewport: program ? input.viewport : unframedExtent ?? undefined })
  const naturalFlow = flow && layoutInput.mode === 'flow-content'
  const media = ['guoling.image', 'guoling.video', 'guoling.audio'].includes(key ?? '')
  const localAssembly = flow && layoutInput.mode === 'flow-viewport' && !documentBlock
  const extent = localAssembly ? flowObjectExtent(project, instance.id, layoutInput) : null
  const scale = extent && extent.width > 0 ? (media ? input.inlineSize / extent.width : Math.min(1, input.inlineSize / extent.width)) : 1
  const childrenPlacement = flow && (documentBlock || nativeLayout) ? 'flow' : 'free'
  const outerStyle: Record<string, string> = flow
    ? { position: 'relative', left: '', top: '', transform: '', transformOrigin: '', width: '100%', height: 'auto', maxWidth: '', margin: '0 0 12px', float: 'none' }
    : frame ? { position: 'absolute', left: '0px', top: '0px', width: `${frame.width}px`, height: `${frame.height}px`,
      transform: `matrix(${frame.transform.join(',')})`, transformOrigin: '0 0', maxWidth: '', margin: '', float: '' }
      : { position: 'relative', left: '', top: '', width: '100%', height: 'auto', transform: '', transformOrigin: '', maxWidth: '', margin: '', float: '' }
  outerStyle.cursor = typeof instance.style?.cursor === 'string' ? instance.style.cursor : ''
  // Web paint and input live in its content iframe. Layout holders must not
  // turn the transparent part of that frame into a second input surface.
  outerStyle.pointerEvents = isGlobalFramedWebDocument(project, instance)
    ? 'none' : String(instance.style?.pointerEvents ?? instance.style?.['pointer-events'] ?? 'auto')
  if (flow && !nativeItem && (media || instance.flowLayout)) {
    const presentation = resolveFlowMediaLayoutProjection(instance.flowLayout?.width ?? 'content-width', input.flowLayout ?? { readingWidth: 860, wideContentWidth: 1100 })
    const wrap = instance.flowLayout?.wrap
    const wrapped = wrap === 'left' || wrap === 'right'
    Object.assign(outerStyle, { width: wrapped ? presentation.wrappedOuterInlineSize : presentation.inlineSize,
      maxWidth: wrapped ? presentation.wrappedOuterInlineSize : presentation.maxInlineSize, float: wrapped ? wrap : 'none',
      margin: wrap === 'left' ? '8px 20px 8px 0' : wrap === 'right' ? '8px 0 8px 20px' : `16px calc((100% - ${presentation.inlineSize}) / 2)` })
  }
  if (nativeLayout || nativeItem) Object.assign(outerStyle, { display: 'block', minWidth: '0px', boxSizing: 'border-box',
    ...(nativeItem ? { margin: '0px' } : {}), ...nativeFlowItemStyle(instance) })
  // Free frame paint owns its border/padding. A static stage participates in
  // that content box while the absolute children still anchor to the outer frame.
  const freeContentBox = !flow && Boolean(frame)
  const stageStyle: Record<string, string> = { position: flow ? 'relative' : freeContentBox ? 'static' : 'absolute', inset: flow || freeContentBox ? '' : '0px', width: '100%',
    height: flow ? extent ? `${extent.height * scale}px` : naturalFlow || documentBlock ? 'auto' : `${frame?.height ?? 0}px` : '100%' }
  const geometry: Record<string, string> = extent ? { position: 'absolute', left: '0px', top: '0px',
    transform: `scale(${scale}) translate(${-extent.x}px,${-extent.y}px)`, transformOrigin: '0 0' }
    : { position: flow || freeContentBox ? 'relative' : 'absolute', left: '0px', top: '0px', transform: '', transformOrigin: '' }
  const contentStyle = { inset: '', ...geometry, width: extent ? `${frame?.width ?? extent.width}px` : '100%',
    height: extent ? `${frame?.height ?? extent.height}px` : naturalFlow ? 'var(--component-flow-height, auto)' : flow ? frame ? `${frame.height}px` : 'auto' : '100%' }
  const childrenStyle = { inset: '', ...geometry, position: childrenPlacement === 'flow' ? 'relative' : 'absolute',
    width: extent ? `${extent.width}px` : '100%', height: extent ? `${extent.height}px` : childrenPlacement === 'flow' ? 'auto' : '100%',
    display: childrenPlacement === 'flow' ? 'flow-root' : 'block', pointerEvents: 'none',
    ...(nativeLayout ? nativeFlowContainerStyle(instance) : {}) }
  // A stretched native group must pass its allocated block size through the
  // retained stage to the actual child layout owner. Otherwise flex/grid items
  // stretch only their outer shell and justify-content still sees intrinsic height.
  if (nativeLayout) {
    Object.assign(outerStyle, { display: 'flex', flexDirection: 'column' })
    Object.assign(stageStyle, { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minWidth: '0px' })
    Object.assign(contentStyle, { flex: '0 0 auto' })
    Object.assign(childrenStyle, { flex: '1 1 auto', minWidth: '0px' })
  }
  // Explicit CSS block sizes of unframed native media belong to Flow layout.
  // Pass that size through the retained wrappers; the image owner then crops
  // into this actual box instead of inventing a fixed design viewport.
  if (naturalFlow && media && !frame && nativeItem) {
    const authoredHeight = nativeFlowMediaBlockSize(project, instance)
    if (authoredHeight && authoredHeight !== 'auto') {
      stageStyle.height = authoredHeight
      contentStyle.height = '100%'
    }
  }
  if (program) {
    Object.assign(outerStyle, { position: 'relative', left: '0px', top: '0px', width: '100%', height: '100%', transform: 'none', margin: '0px' })
    Object.assign(stageStyle, { position: 'relative', inset: '', width: '100%', height: '100%' })
    Object.assign(contentStyle, { position: 'relative', inset: '', left: '0px', top: '0px', width: '100%', height: '100%', transform: 'none' })
  }
  return { layoutInput, naturalFlow, localAssembly, extent, scale, childrenPlacement, section, outerStyle, stageStyle, contentStyle, childrenStyle }
}
