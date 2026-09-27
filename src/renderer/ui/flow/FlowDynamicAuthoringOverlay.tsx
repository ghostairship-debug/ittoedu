import { ImagePlus } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { ComponentAuthoringImageTarget, ComponentAuthoringTextTarget } from '../../../shared/componentTypes'
import { CanvasPlainTextEditor } from '../CanvasPlainTextEditor'

export interface FlowDynamicAuthoringOverlayProps {
  readonly textTargets: ReadonlyArray<Readonly<ComponentAuthoringTextTarget>>
  readonly imageTargets: ReadonlyArray<Readonly<ComponentAuthoringImageTarget>>
  /** Targets use local card coordinates; the parent owns paper placement and viewport projection. */
  readonly style?: CSSProperties
  readonly activeText?: {
    readonly target: Readonly<ComponentAuthoringTextTarget>
    readonly value: string
    readonly onCommit: (value: string) => void
    readonly onCancel: () => void
    readonly onDraftChange?: (value: string, composing: boolean) => void
  }
  readonly replacingImageTargetId?: string | null
  readonly onTextActivate: (target: Readonly<ComponentAuthoringTextTarget>) => void
  readonly onImageActivate: (target: Readonly<ComponentAuthoringImageTarget>) => void
}

/** Card-local hit targets; commands and canonical edits remain with the Flow owner. */
export function FlowDynamicAuthoringOverlay({ textTargets, imageTargets, style, activeText, replacingImageTargetId, onTextActivate, onImageActivate }: FlowDynamicAuthoringOverlayProps) {
  if (textTargets.length === 0 && imageTargets.length === 0 && !activeText) return null
  return <div className="canvas-authoring-targets" data-testid="flow-component-authoring-targets" aria-label="纸面组件可编辑内容" style={style}>
    {imageTargets.map(target => <button key={JSON.stringify([target.scope, target.sceneId, target.nodeId, target.targetId])} type="button"
      className="canvas-authoring-target canvas-authoring-target--asset"
      aria-label={`${target.label}，替换组件图片`}
      disabled={replacingImageTargetId === target.targetId}
      style={{ left: target.bounds.x, top: target.bounds.y, width: target.bounds.width, height: target.bounds.height, transform: `rotate(${target.rotation}deg)`, pointerEvents: 'auto' }}
      onClick={() => onImageActivate(target)}>
      <span className="canvas-authoring-target__badge" aria-hidden="true"><ImagePlus size={14} /><span>{target.label}</span></span>
    </button>)}
    {textTargets.map(target => <button key={JSON.stringify([target.scope, target.sceneId, target.nodeId, target.targetId])} type="button"
      className="canvas-authoring-target canvas-authoring-target--component-text"
      aria-label={`${target.label}，编辑组件文字`}
      style={{ left: target.bounds.x, top: target.bounds.y, width: target.bounds.width, height: target.bounds.height, transform: `rotate(${target.rotation}deg)`, pointerEvents: 'auto' }}
      onClick={() => onTextActivate(target)}>
      <span className="canvas-authoring-target__badge" aria-hidden="true">T<span>{target.label}</span></span>
    </button>)}
    {activeText && <CanvasPlainTextEditor key={JSON.stringify([activeText.target.scope, activeText.target.sceneId, activeText.target.nodeId, activeText.target.targetId])}
      bounds={activeText.target.bounds} label={activeText.target.label} value={activeText.value}
      multiline={activeText.target.multiline} maxLength={activeText.target.maxLength}
      rotation={activeText.target.rotation} onDraftChange={activeText.onDraftChange}
      onCommit={activeText.onCommit} onCancel={activeText.onCancel} />}
  </div>
}
