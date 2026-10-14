import { useState } from 'react'
import type { ComponentClickNavigationAction } from '../../../shared/componentInteractionData'
import type { InteractionSceneListItem } from '../InteractionEditor'
import { SelectField } from './PropertyControls'

export interface ComponentClickNavigationPropertiesContext {
  readonly action: ComponentClickNavigationAction | null
  readonly otherActions: boolean
  readonly unavailableReason: string | null
  readonly surfaceId: string
  readonly scenes: readonly InteractionSceneListItem[]
  readonly onChange: (action: ComponentClickNavigationAction | null) => Promise<void>
  readonly onOpenProfessional: () => void
}

export function ComponentClickNavigationProperties({ context }: { context: ComponentClickNavigationPropertiesContext }) {
  const [busy, setBusy] = useState(false)
  const targetScene = context.scenes.find(scene => scene.id === context.action?.sceneId)
  const targets = targetScene?.spatial?.frames ?? targetScene?.presentation?.states ?? []
  const change = (action: ComponentClickNavigationAction | null) => {
    setBusy(true)
    void context.onChange(action).catch(() => {}).finally(() => setBusy(false))
  }
  return <section className="property-section" data-testid="component-click-navigation-properties">
    <h3 className="property-title">点击动作</h3>
    <fieldset disabled={busy || Boolean(context.unavailableReason)} style={{ border: 0, padding: 0, margin: 0 }}>
      <SelectField<string> label="点击动作" value={context.action ? 'scene.go' : ''}
        options={[{ value: '', label: '未设置跳转' }, { value: 'scene.go', label: '跳转到镜头' }]}
        onChange={value => change(value ? { type: 'scene.go', sceneId: context.surfaceId } : null)} />
      {context.action && <>
        <SelectField<string> label="目标页面" value={context.action.sceneId}
          options={[
            ...(!targetScene ? [{ value: context.action.sceneId, label: `缺失页面（${context.action.sceneId}）` }] : []),
            ...context.scenes.map(scene => ({ value: scene.id, label: scene.name })),
          ]}
          onChange={sceneId => change({ type: 'scene.go', sceneId })} />
        <SelectField<string> label={targetScene?.spatial ? '进入镜头' : '进入位置'} value={context.action.targetStateId ?? ''}
          options={[
            { value: '', label: '播放起点' },
            ...(context.action.targetStateId && !targets.some(target => target.id === context.action!.targetStateId)
              ? [{ value: context.action.targetStateId, label: `缺失目标（${context.action.targetStateId}）` }] : []),
            ...targets.map(target => ({ value: target.id, label: target.name })),
          ]}
          onChange={targetStateId => change(targetStateId ? { ...context.action!, targetStateId }
            : { type: 'scene.go', sceneId: context.action!.sceneId })} />
      </>}
    </fieldset>
    {context.unavailableReason && <p className="property-hint" role="status">{context.unavailableReason}</p>}
    {context.otherActions && <p className="property-hint">其他点击动作保持原配置。</p>}
    <button type="button" className="secondary-button" onClick={context.onOpenProfessional}>打开互动与动画</button>
  </section>
}
