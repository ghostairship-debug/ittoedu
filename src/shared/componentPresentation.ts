import type { ComponentInstance, ComponentLayoutInput, CourseProjectV10 } from './contracts/component-platform'
import { componentDefinitionBuiltinKey } from './contracts/component-platform'
import { componentLayoutInput } from '../components/web/measuredFragmentBox'
import { flowObjectExtent } from '../core/components/geometry/flowObjectExtent'
import { resolveFlowMediaLayoutProjection, type FlowMediaLayoutWidths } from './flowMediaLayout'

export interface ComponentOuterPresentationInput {
  placement: 'free' | 'flow'
  purpose: 'author' | 'playback'
  inlineSize: number
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

/** PM document sections and component projections share this author/playback policy. */
export function resolveSectionPresentation(data: { collapsedByDefault?: boolean },
  purpose: ComponentOuterPresentationInput['purpose']): { open: boolean; collapsedByDefault: boolean } {
  const collapsedByDefault = data.collapsedByDefault === true
  return { open: purpose === 'author' || !collapsedByDefault, collapsedByDefault }
}

/** Outer placement only. React, PM and Player retain their DOM and mount ownership. */
export function resolveComponentOuterPresentation(project: CourseProjectV10, instance: ComponentInstance,
  input: ComponentOuterPresentationInput): ComponentOuterPresentation {
  const definition = project.definitions[instance.definitionId], frame = instance.frame
  const key = componentDefinitionBuiltinKey(definition)
  const documentBlock = key === 'guoling.document-block'
  const data = instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data) ? instance.data : {}
  const section = documentBlock && data.type === 'section'
    ? resolveSectionPresentation({ collapsedByDefault: data.collapsedByDefault === true }, input.purpose) : null
  const flow = input.placement === 'flow'
  const unframedExtent = flow && !frame && instance.childIds?.length ? flowObjectExtent(project, instance.id) : null
  const layoutInput = componentLayoutInput(instance, { kind: flow ? 'flow' : 'free-frame', inlineSize: input.inlineSize, definition, viewport: unframedExtent ?? undefined })
  const naturalFlow = flow && layoutInput.mode === 'flow-content'
  const media = ['guoling.image', 'guoling.video', 'guoling.audio'].includes(key ?? '')
  const localAssembly = flow && layoutInput.mode === 'flow-viewport' && !documentBlock
  const extent = localAssembly ? flowObjectExtent(project, instance.id, layoutInput) : null
  const scale = extent && extent.width > 0 ? (media ? input.inlineSize / extent.width : Math.min(1, input.inlineSize / extent.width)) : 1
  const childrenPlacement = flow && documentBlock ? 'flow' : 'free'
  const outerStyle: Record<string, string> = flow
    ? { position: 'relative', left: '', top: '', transform: '', transformOrigin: '', width: '100%', height: 'auto', maxWidth: '', margin: '0 0 12px', float: 'none' }
    : frame ? { position: 'absolute', left: '0px', top: '0px', width: `${frame.width}px`, height: `${frame.height}px`,
      transform: `matrix(${frame.transform.join(',')})`, transformOrigin: '0 0', maxWidth: '', margin: '', float: '' }
      : { position: 'relative', left: '', top: '', width: '100%', height: 'auto', transform: '', transformOrigin: '', maxWidth: '', margin: '', float: '' }
  if (flow && (media || instance.flowLayout)) {
    const presentation = resolveFlowMediaLayoutProjection(instance.flowLayout?.width ?? 'content-width', input.flowLayout ?? { readingWidth: 860, wideContentWidth: 1100 })
    const wrap = instance.flowLayout?.wrap
    const wrapped = wrap === 'left' || wrap === 'right'
    Object.assign(outerStyle, { width: wrapped ? presentation.wrappedOuterInlineSize : presentation.inlineSize,
      maxWidth: wrapped ? presentation.wrappedOuterInlineSize : presentation.maxInlineSize, float: wrapped ? wrap : 'none',
      margin: wrap === 'left' ? '8px 20px 8px 0' : wrap === 'right' ? '8px 0 8px 20px' : `16px calc((100% - ${presentation.inlineSize}) / 2)` })
  }
  const stageStyle: Record<string, string> = { position: flow ? 'relative' : 'absolute', inset: flow ? '' : '0px', width: '100%',
    height: flow ? extent ? `${extent.height * scale}px` : naturalFlow || documentBlock ? 'auto' : `${frame?.height ?? 0}px` : '100%' }
  const geometry: Record<string, string> = extent ? { position: 'absolute', left: '0px', top: '0px',
    transform: `scale(${scale}) translate(${-extent.x}px,${-extent.y}px)`, transformOrigin: '0 0' }
    : { position: flow ? 'relative' : 'absolute', left: '0px', top: '0px', transform: '', transformOrigin: '' }
  const contentStyle = { inset: '', ...geometry, width: extent ? `${frame?.width ?? extent.width}px` : '100%',
    height: extent ? `${frame?.height ?? extent.height}px` : naturalFlow ? 'var(--component-flow-height, auto)' : flow ? frame ? `${frame.height}px` : 'auto' : '100%' }
  const childrenStyle = { inset: '', ...geometry, position: childrenPlacement === 'flow' ? 'relative' : 'absolute',
    width: extent ? `${extent.width}px` : '100%', height: extent ? `${extent.height}px` : childrenPlacement === 'flow' ? 'auto' : '100%',
    display: childrenPlacement === 'flow' ? 'flow-root' : 'block', pointerEvents: 'none' }
  return { layoutInput, naturalFlow, localAssembly, extent, scale, childrenPlacement, section, outerStyle, stageStyle, contentStyle, childrenStyle }
}
