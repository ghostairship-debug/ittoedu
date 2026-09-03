import { AlertTriangle, Play, Sparkles } from 'lucide-react'
import { isNodeMotionAction, type InteractionRule, type MotionDirection, type MotionEffect } from '../../shared/interactionTypes'
import { requestNodeMotionPreview } from '../phaser/elementAnimationPreviewBus'
import {
  findSimpleEntranceAnimationRule,
  hasAdvancedEntranceAnimation,
  type SlideSimpleEntranceAnimationConfig,
} from '../course/v9SlideContentCommands'

const EFFECTS: Array<{
  value: MotionEffect
  label: string
}> = [
  { value: 'none', label: '无' },
  { value: 'fade', label: '淡入' },
  { value: 'slide', label: '滑入' },
  { value: 'scale', label: '缩放' },
]

const DIRECTIONS: Array<{
  value: MotionDirection
  label: string
}> = [
  { value: 'left', label: '从左' },
  { value: 'right', label: '从右' },
  { value: 'up', label: '从上' },
  { value: 'down', label: '从下' },
]

const SPEEDS = [
  { value: 200, label: '快速' },
  { value: 320, label: '标准' },
  { value: 500, label: '舒缓' },
]

const DELAYS = [
  { value: 0, label: '不延迟' },
  { value: 300, label: '0.3 秒' },
  { value: 600, label: '0.6 秒' },
  { value: 1000, label: '1 秒' },
]

interface SimpleEntranceAnimationEditorProps {
  layerItemId: string
  interactions: readonly InteractionRule[]
  activeStateId: string | null
  onChange(config: SlideSimpleEntranceAnimationConfig | null): void
  onOpenProfessional(): void
}

export function SimpleEntranceAnimationEditor({
  layerItemId,
  interactions,
  activeStateId,
  onChange,
  onOpenProfessional,
}: SimpleEntranceAnimationEditorProps) {
  const rule = findSimpleEntranceAnimationRule(
    interactions,
    layerItemId,
    activeStateId,
  )
  const step = rule?.actions[0]
  const action = step && isNodeMotionAction(step.action)
    ? step.action
    : null
  const effect = action?.effect ?? 'none'
  const direction = action?.effect === 'slide' ? action.direction : 'left'
  const durationMs = action?.durationMs ?? 320
  const delayMs = step?.delayMs ?? 0
  const hasAdvancedRule = hasAdvancedEntranceAnimation(
    interactions,
    layerItemId,
    activeStateId,
  )

  const writeEntrance = (
    config: SlideSimpleEntranceAnimationConfig | null,
  ) => {
    onChange(config)
  }

  const apply = (
    nextEffect: Exclude<MotionEffect, 'none'>,
    patch: {
      direction?: MotionDirection
      durationMs?: number
      delayMs?: number
    } = {},
  ) => {
    writeEntrance({
      effect: nextEffect,
      direction: nextEffect === 'slide'
        ? patch.direction ?? direction
        : undefined,
      durationMs: patch.durationMs ?? durationMs,
      delayMs: patch.delayMs ?? delayMs,
    })
  }

  if (hasAdvancedRule) {
    return (
      <section
        className="property-section simple-motion-card simple-motion-card--conflict"
        data-testid="simple-entrance-animation"
      >
        <h3 className="property-title"><Sparkles size={14} />出现动画</h3>
        <div className="simple-motion-conflict">
          <AlertTriangle size={17} />
          <span>此元素已有专业动画规则，为避免重复播放，简洁模式不会覆盖它。</span>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={onOpenProfessional}
        >
          打开专业规则
        </button>
      </section>
    )
  }

  return (
    <section
      className="property-section simple-motion-card"
      data-testid="simple-entrance-animation"
    >
      <div className="simple-motion-heading">
        <h3 className="property-title"><Sparkles size={14} />出现动画</h3>
        <button
          type="button"
          className="simple-motion-preview"
          disabled={!action}
          onClick={() => {
            if (action) requestNodeMotionPreview(action, delayMs)
          }}
        >
          <Play size={13} />预览
        </button>
      </div>

      <div className="simple-motion-presets" role="group" aria-label="出现动画效果">
        {EFFECTS.map((item) => (
          <button
            key={item.value}
            type="button"
            className={effect === item.value ? 'is-active' : ''}
            aria-pressed={effect === item.value}
            onClick={() => {
              if (item.value === 'none') writeEntrance(null)
              else apply(item.value)
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {effect !== 'none' && (
        <div className="simple-motion-options">
          {effect === 'slide' && (
            <label>
              <span>方向</span>
              <select
                aria-label="滑入方向"
                value={direction}
                onChange={(event) => apply('slide', {
                  direction: event.target.value as MotionDirection,
                })}
              >
                {DIRECTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span>速度</span>
            <select
              aria-label="动画速度"
              value={durationMs}
              onChange={(event) => apply(
                effect,
                { durationMs: Number(event.target.value) },
              )}
            >
              {SPEEDS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>延迟</span>
            <select
              aria-label="动画延迟"
              value={delayMs}
              onChange={(event) => apply(
                effect,
                { delayMs: Number(event.target.value) },
              )}
            >
              {DELAYS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      <p className="property-hint">
        {effect === 'none'
          ? '选择效果后，元素会在进入当前场景或状态时自动出现。'
          : '已自动处理播放前隐藏；编辑画布仍保持可见。'}
      </p>
    </section>
  )
}
