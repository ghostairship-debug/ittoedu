import { Layers3, Palette, Workflow } from 'lucide-react'
import { ColorInput } from '../ColorInput'
import { BufferedInput, PropertyDraftBoundary } from './PropertyControls'
import { RuntimePropertiesPanel, type RuntimePropertiesContext } from './RuntimePropertiesPanel'

export interface EmptyScenePropertiesContext {
  readonly kind: 'empty-scene'
  readonly draftBindingKey: string
  readonly scene: {
    readonly id: string
    readonly name: string
    readonly backgroundColor: string
    readonly interactionCount: number
    readonly stateName: string | null
  } | null
  readonly editorMode: 'simple' | 'professional'
  readonly runtime: RuntimePropertiesContext | null
  readonly commands: {
    readonly updateName: (name: string) => void
    readonly updateBackground: (backgroundColor: string) => void
    readonly openAutomation: () => void
    readonly openProfessionalAutomation: () => void
  }
  readonly onStale: () => void
}

export function EmptyScenePropertiesPanel({
  context,
}: {
  context: EmptyScenePropertiesContext
}) {
  const { scene } = context
  return (
    <PropertyDraftBoundary bindingKey={context.draftBindingKey} onStale={context.onStale}>
      <div className="properties-scroll" data-testid="properties-tab">
        <section className={`state-editing-notice${scene?.stateName ? ' state-editing-notice--override' : ''}`}>
          <Layers3 size={15} />
          <div>
            <strong>{scene?.stateName ? `状态：${scene.stateName}` : '基础场景'}</strong>
            <span>{scene?.stateName
              ? '背景修改只保存在当前状态；场景名称仍为通用名称。'
              : '这里的修改会被所有状态继承。'}</span>
          </div>
        </section>
        <section className="property-section">
          <h3 className="property-title"><Palette size={14} />场景</h3>
          <BufferedInput label="场景名称" value={scene?.name ?? ''} onCommit={context.commands.updateName} />
          <ColorInput id="scene-background" label="背景色" value={scene?.backgroundColor ?? '#ffffff'} onChange={context.commands.updateBackground} />
        </section>
        {context.editorMode === 'professional' ? (
          <>
            <section className="property-section">
              <h3 className="property-title"><Workflow size={14} />场景规则</h3>
              <p className="property-hint">当前场景有 {scene?.interactionCount ?? 0} 条规则。规则按“何时发生 → 是否满足条件 → 做什么”组织。</p>
              <button type="button" className="secondary-button" onClick={context.commands.openAutomation}><Workflow size={14} />打开规则面板</button>
            </section>
            {context.runtime && <RuntimePropertiesPanel context={context.runtime} />}
          </>
        ) : (scene?.interactionCount ?? 0) > 0 ? (
          <section className="property-section simple-rule-summary">
            <h3 className="property-title"><Workflow size={14} />专业互动</h3>
            <p className="property-hint">此场景已有 {scene?.interactionCount} 条专业规则，播放时会继续生效。</p>
            <button type="button" className="secondary-button" onClick={context.commands.openProfessionalAutomation}>切换专业模式查看</button>
          </section>
        ) : null}
      </div>
    </PropertyDraftBoundary>
  )
}
