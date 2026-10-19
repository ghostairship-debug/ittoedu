import type { ComponentNavigationTransition } from '../../../shared/contracts/component-platform/navigationMotion'
import { BufferedInput, SelectField } from './PropertyControls'

/** Both ordinary click properties and professional actions edit the same owner parameters. */
export function NavigationTransitionFields({ transition, onChange }: {
  transition?: ComponentNavigationTransition
  onChange(transition: ComponentNavigationTransition): void
}) {
  const custom = Boolean(transition?.outgoing || transition?.incoming)
  const effect = transition?.effect === 'none' ? 'none' : custom ? 'custom' : transition ? transition.effect ?? 'fade' : 'none'
  const duration = transition?.durationMs ?? (transition?.effect ? 240 : 300)
  const easing = transition?.easing ?? (transition?.effect ? 'ease-out' : 'linear')
  return <>
    <SelectField<string> label="页面转场" value={effect} options={[
      { value: 'none', label: '无动效' }, { value: 'fade', label: '淡入' },
      { value: 'slide', label: '滑入' }, { value: 'zoom', label: '轻缩放' },
      ...(custom ? [{ value: 'custom', label: '自定义关键帧' }] : []),
    ]} onChange={value => {
      if (value === 'custom') { onChange({ ...transition, effect: undefined }); return }
      onChange(value === 'none' ? { ...transition, effect: 'none' }
        : { effect: value as 'fade' | 'slide' | 'zoom', durationMs: transition?.durationMs ?? 240,
          easing: transition?.easing ?? 'ease-out', ...(value === 'slide' ? { direction: transition?.direction ?? 'left' } : {}) })
    }} />
    {effect === 'custom' && <p className="property-hint">自定义关键帧和各轨道时序保持原配置；选择预置会改用对应效果。</p>}
    {effect !== 'none' && effect !== 'custom' && <>
      <BufferedInput label="转场时长（毫秒）" type="number" min={0} value={duration}
        onCommit={raw => { const value = Number(raw); if (Number.isFinite(value) && value >= 0) onChange({ ...transition, durationMs: value }) }} />
      <SelectField<string> label="转场缓动" value={easing} options={[
        { value: 'ease-out', label: '减速' }, { value: 'ease-in-out', label: '缓入缓出' }, { value: 'linear', label: '匀速' },
        ...(transition?.easing && !['ease-out', 'ease-in-out', 'linear'].includes(transition.easing)
          ? [{ value: transition.easing, label: transition.easing }] : []),
      ]} onChange={easing => onChange({ ...transition, easing })} />
      {effect === 'slide' && <SelectField<string> label="转场方向" value={transition?.direction ?? 'left'} options={[
        { value: 'left', label: '向左' }, { value: 'right', label: '向右' }, { value: 'up', label: '向上' }, { value: 'down', label: '向下' },
      ]} onChange={direction => onChange({ ...transition, direction: direction as ComponentNavigationTransition['direction'] })} />}
    </>}
  </>
}
