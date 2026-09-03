import { ImagePlus, LoaderCircle, RotateCcw } from 'lucide-react'
import type { ComponentAuthoringTextTarget } from '../../../shared/componentTypes'
import type { RuntimeAuthoringTarget } from '../../../shared/runtimeTypes'
import type { ComponentTextEditSession } from '../../authoring/componentTextEditSession'
import type { CourseRuntimeContentTextTarget } from '../../runtime/runtimeContentTextAuthoringCommands'
import type { RuntimeTargetEditSession } from '../../authoring/runtimeTargetEditSession'
import { CanvasPlainTextEditor } from '../CanvasPlainTextEditor'

export type SlidePreviewFeedback = {
  kind: 'loading' | 'error'
  title: string
  message: string
} | null

export interface SlideRuntimeTextEditSession {
  readonly liveSession: Readonly<RuntimeTargetEditSession>
  readonly courseTarget: CourseRuntimeContentTextTarget
}

export interface SlideDynamicAuthoringOverlayProps {
  readonly interactive: boolean
  readonly runtimeTargets: ReadonlyArray<Readonly<RuntimeAuthoringTarget>>
  readonly componentTargets: ReadonlyArray<Readonly<ComponentAuthoringTextTarget>>
  readonly hoveredTargetId: string | null
  readonly replacingRuntimeAssetTargetId: string | null
  readonly activeRuntimeTextSession: Readonly<SlideRuntimeTextEditSession> | null
  readonly activeRuntimeTextTarget: Readonly<RuntimeAuthoringTarget> | undefined
  readonly activeRuntimeTextValue: string
  readonly activeComponentTextSession: Readonly<ComponentTextEditSession> | null
  readonly activeComponentTextTarget: Readonly<ComponentAuthoringTextTarget> | undefined
  readonly componentEditingReady: boolean
  readonly componentEditingValue: string
  readonly previewFeedback: SlidePreviewFeedback
  readonly showPreparing: boolean
  readonly onHoverTarget: (targetId: string | null) => void
  readonly onRuntimeTargetActivate: (target: Readonly<RuntimeAuthoringTarget>) => void
  readonly onComponentTargetActivate: (target: Readonly<ComponentAuthoringTextTarget>) => void
  readonly onCommitRuntimeText: (
    session: Readonly<SlideRuntimeTextEditSession>,
    value: string,
  ) => void
  readonly onCancelRuntimeText: () => void
  readonly onCommitComponentText: (
    session: Readonly<ComponentTextEditSession>,
    value: string,
  ) => void
  readonly onCancelComponentText: () => void
  readonly onRetryPreview: () => void
}

export function SlideDynamicAuthoringOverlay({
  interactive,
  runtimeTargets,
  componentTargets,
  hoveredTargetId,
  replacingRuntimeAssetTargetId,
  activeRuntimeTextSession,
  activeRuntimeTextTarget,
  activeRuntimeTextValue,
  activeComponentTextSession,
  activeComponentTextTarget,
  componentEditingReady,
  componentEditingValue,
  previewFeedback,
  showPreparing,
  onHoverTarget,
  onRuntimeTargetActivate,
  onComponentTargetActivate,
  onCommitRuntimeText,
  onCancelRuntimeText,
  onCommitComponentText,
  onCancelComponentText,
  onRetryPreview,
}: SlideDynamicAuthoringOverlayProps) {
  const showTargets = interactive && (
    runtimeTargets.length > 0 ||
    componentTargets.length > 0 ||
    Boolean(activeRuntimeTextTarget) ||
    Boolean(activeComponentTextTarget)
  )

  return (
    <>
      {showTargets && (
        <div
          className="canvas-authoring-targets"
          data-testid="runtime-authoring-targets"
          aria-label="画布可编辑内容"
        >
          {runtimeTargets.map((target) => (
            <button
              key={target.targetId}
              type="button"
              className={`canvas-authoring-target canvas-authoring-target--${target.kind}${
                hoveredTargetId === target.targetId
                  ? ' canvas-authoring-target--hovered'
                  : ''
              }`}
              aria-label={`${target.label ?? target.key}，双击${target.kind === 'text' ? '编辑文字' : '替换图片'}`}
              title={`双击${target.kind === 'text' ? '编辑文字' : '替换图片'}：${target.label ?? target.key}`}
              disabled={replacingRuntimeAssetTargetId === target.targetId}
              style={{
                left: target.bounds.x,
                top: target.bounds.y,
                width: target.bounds.width,
                height: target.bounds.height,
                zIndex: target.layer === 'overlay' ? 2 : 1,
              }}
              onFocus={() => onHoverTarget(target.targetId)}
              onBlur={() => onHoverTarget(null)}
              onClick={() => onRuntimeTargetActivate(target)}
            >
              <span className="canvas-authoring-target__badge" aria-hidden="true">
                {target.kind === 'asset'
                  ? <ImagePlus size={14} />
                  : 'T'}
                <span>{target.label ?? target.key}</span>
              </span>
            </button>
          ))}
          {activeRuntimeTextSession && activeRuntimeTextTarget?.kind === 'text' && (
            <CanvasPlainTextEditor
              key={activeRuntimeTextTarget.targetId}
              bounds={activeRuntimeTextTarget.bounds}
              label={activeRuntimeTextTarget.label ?? activeRuntimeTextTarget.key}
              value={activeRuntimeTextValue}
              multiline={activeRuntimeTextTarget.multiline}
              maxLength={activeRuntimeTextTarget.maxLength}
              onCommit={(value) => onCommitRuntimeText(activeRuntimeTextSession, value)}
              onCancel={onCancelRuntimeText}
            />
          )}
          {componentTargets.map((target) => (
            <button
              key={target.targetId}
              type="button"
              className={`canvas-authoring-target canvas-authoring-target--component-text${
                hoveredTargetId === target.targetId
                  ? ' canvas-authoring-target--hovered'
                  : ''
              }`}
              aria-label={`${target.label}，双击编辑组件文字`}
              title={`双击编辑组件文字：${target.label}`}
              style={{
                left: target.bounds.x,
                top: target.bounds.y,
                width: target.bounds.width,
                height: target.bounds.height,
                zIndex: 3,
                transform: `rotate(${target.rotation}deg)`,
              }}
              onFocus={() => onHoverTarget(target.targetId)}
              onBlur={() => onHoverTarget(null)}
              onClick={() => onComponentTargetActivate(target)}
            >
              <span className="canvas-authoring-target__badge" aria-hidden="true">
                T<span>{target.label}</span>
              </span>
            </button>
          ))}
          {activeComponentTextSession && activeComponentTextTarget && componentEditingReady && (
            <CanvasPlainTextEditor
              key={activeComponentTextTarget.targetId}
              bounds={activeComponentTextTarget.bounds}
              label={activeComponentTextTarget.label}
              value={componentEditingValue}
              multiline={activeComponentTextTarget.multiline}
              maxLength={activeComponentTextTarget.maxLength}
              rotation={activeComponentTextTarget.rotation}
              onCommit={(value) => onCommitComponentText(
                activeComponentTextSession,
                value,
              )}
              onCancel={onCancelComponentText}
            />
          )}
        </div>
      )}
      {previewFeedback && (
        <div
          className={`runtime-preview-loading runtime-preview-loading--${previewFeedback.kind}`}
          role={previewFeedback.kind === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          <div className="runtime-preview-loading__panel">
            {previewFeedback.kind === 'loading' && (
              <LoaderCircle
                className="runtime-preview-loading__spinner"
                size={24}
                aria-hidden="true"
              />
            )}
            <strong>{previewFeedback.title}</strong>
            <span>{previewFeedback.message}</span>
            {previewFeedback.kind === 'error' && (
              <button type="button" onClick={onRetryPreview}>
                <RotateCcw size={14} aria-hidden="true" />重新载入画布
              </button>
            )}
          </div>
        </div>
      )}
      {!previewFeedback && showPreparing && (
        <div className="runtime-preview-loading" role="status" aria-live="polite">
          <div className="runtime-preview-loading__panel">
            <LoaderCircle
              className="runtime-preview-loading__spinner"
              size={24}
              aria-hidden="true"
            />
            <strong>正在准备统一画布</strong>
          </div>
        </div>
      )}
    </>
  )
}
