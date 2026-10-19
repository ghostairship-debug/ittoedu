import { Play, Sparkles } from 'lucide-react'
import type { ComponentMotionActionView, ComponentMotionPreset } from '../../../shared/componentMotionAuthoring'
import { DEFAULT_COMPONENT_MOTION } from '../../../shared/componentMotionAuthoring'
import type { MotionDirection, MotionEasing, MotionEffect, NodeMotionAction } from '../../../shared/interactionTypes'
import { BufferedInput, PropertyDraftFieldBoundary } from './PropertyControls'

export interface ComponentMotionPropertiesContext {
  entrance: ComponentMotionActionView | null
  entranceUnavailableReason: string | null
  exits: readonly ComponentMotionActionView[]
  disabled: boolean
  onChangeEntrance(config: ComponentMotionPreset, enabled: boolean): void | Promise<void>
  onChangeExit(reference: ComponentMotionActionView, config: ComponentMotionPreset): void | Promise<void>
  onPreview(action: NodeMotionAction, delayMs: number): void
  onOpenProfessional(): void
  onOpenSource(): void
  instanceId: string
}
const directions = [{ value: 'left', label: '左' }, { value: 'right', label: '右' }, { value: 'up', label: '上' }, { value: 'down', label: '下' }] as const
const effects = [{ value: 'none', label: '无动效' }, { value: 'fade', label: '淡变' }, { value: 'slide', label: '滑动' }, { value: 'scale', label: '轻缩放' }] as const
function MotionFields({ label, config, disabled, onChange }: { label: string; config: ComponentMotionPreset; disabled: boolean; onChange(config: ComponentMotionPreset): void | Promise<void> }) {
  const patch = (value: Partial<ComponentMotionPreset>) => onChange({ ...config, ...value })
  return <fieldset className="simple-motion-options" disabled={disabled} style={{ border: 0, padding: 0, margin: 0 }}>
    <label><span>效果</span><select aria-label={`${label}效果`} value={config.effect}
      onChange={event => {
        const effect = event.target.value as MotionEffect
        return patch({ effect, ...(effect !== 'none' && config.durationMs === 0 ? { durationMs: DEFAULT_COMPONENT_MOTION.durationMs } : {}) })
      }}>
      {effects.map(effect => <option key={effect.value} value={effect.value}>{effect.label}</option>)}
    </select></label>
    {config.effect === 'slide' && <label><span>方向</span><select aria-label={`${label}方向`} value={config.direction ?? 'left'}
      onChange={event => patch({ direction: event.target.value as MotionDirection })}>
      {directions.map(direction => <option key={direction.value} value={direction.value}>{direction.label}</option>)}
    </select></label>}
    {config.effect !== 'none' && <>
      <BufferedInput label={`${label}时长（毫秒）`} type="number" min={0} max={60000} value={config.durationMs}
        onCommit={raw => patch({ durationMs: Number(raw) })} />
      <label><span>缓动</span><select aria-label={`${label}缓动`} value={config.easing}
        onChange={event => patch({ easing: event.target.value as MotionEasing })}>
        <option value="ease-out">减速</option><option value="ease-in">加速</option><option value="ease-in-out">缓入缓出</option><option value="linear">匀速</option>
      </select></label>
    </>}
    <BufferedInput label={`${label}延迟（毫秒）`} type="number" min={0} max={60000} value={config.delayMs}
      onCommit={raw => patch({ delayMs: Number(raw) })} />
  </fieldset>
}
export function ComponentMotionProperties({ context }: { context: ComponentMotionPropertiesContext }) {
  const entrance = context.entrance, config = entrance?.config ?? DEFAULT_COMPONENT_MOTION
  const preview = (type: NodeMotionAction['type'], config: ComponentMotionPreset) => {
    const common = { type, nodeId: context.instanceId, durationMs: config.effect === 'none' ? 0 : config.durationMs, easing: config.easing }
    context.onPreview(config.effect === 'slide' ? { ...common, effect: 'slide', direction: config.direction ?? 'left' }
      : { ...common, effect: config.effect }, config.delayMs)
  }
  return <section className="property-section simple-motion-card" data-testid="component-motion-properties">
    <h3 className="property-title"><Sparkles size={14} />对象动效</h3>
    <div className="simple-motion-heading">
      <label><input type="checkbox" aria-label="启用进入时出现" checked={entrance?.enabled ?? false}
        disabled={context.disabled || Boolean(context.entranceUnavailableReason)}
        onChange={event => context.onChangeEntrance(config, event.target.checked)} />进入时出现</label>
      <button type="button" className="simple-motion-preview" disabled={context.disabled || !entrance?.enabled}
        onClick={() => preview('node.enter', config)}><Play size={13} />预览进入</button>
    </div>
    {context.entranceUnavailableReason ? <p className="property-hint">{context.entranceUnavailableReason}</p>
      : entrance?.enabled && <PropertyDraftFieldBoundary fieldKey={['motion', entrance.behaviorId, entrance.ruleId, entrance.stepId]}>
        <MotionFields label="进入" config={config} disabled={context.disabled} onChange={next => context.onChangeEntrance(next, true)} />
      </PropertyDraftFieldBoundary>}
    {context.exits.map((exit, index) => <div key={`${exit.behaviorId}:${exit.stepId}`}>
      <div className="simple-motion-heading"><h4>退出动作 · {exit.label}</h4>
        <button type="button" className="simple-motion-preview" disabled={context.disabled || !exit.enabled}
          onClick={() => preview('node.exit', exit.config)}><Play size={13} />预览退出{context.exits.length > 1 ? index + 1 : ''}</button></div>
      {!exit.enabled && <p className="property-hint">此动作所在规则已停用。</p>}
      <PropertyDraftFieldBoundary fieldKey={['motion', exit.behaviorId, exit.ruleId, exit.stepId]}>
        <MotionFields label="退出" config={exit.config} disabled={context.disabled} onChange={next => context.onChangeExit(exit, next)} />
      </PropertyDraftFieldBoundary>
    </div>)}
    <p className="property-hint">进入效果在对象实际进入可见状态时播放。退出沿已有互动触发；无动效会直接完成显示或隐藏。</p>
    <button type="button" className="secondary-button" onClick={context.onOpenProfessional}>互动与动画</button>
    <button type="button" className="secondary-button" onClick={context.onOpenSource}>高级 Source</button>
  </section>
}
