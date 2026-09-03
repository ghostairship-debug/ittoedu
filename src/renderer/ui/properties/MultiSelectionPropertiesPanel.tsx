import {
  AlignHorizontalDistributeCenter,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignVerticalDistributeCenter,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Copy,
  Eye,
  EyeOff,
  Layers3,
  Lock,
  SlidersHorizontal,
  Trash2,
  Unlock,
} from 'lucide-react'
import type { PropertiesItemView } from './SlideNativePropertiesPanel'

export type MultiSelectionAlignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'

export interface MultiSelectionPropertiesContext {
  readonly kind: 'multi-selection'
  readonly items: readonly PropertiesItemView[]
  readonly spatialMode: boolean
  readonly presentation: {
    readonly stateName: string | null
    readonly overriddenCount: number
  } | null
  readonly commands: {
    readonly setVisible: (visible: boolean) => void
    readonly setLocked: (locked: boolean) => void
    readonly align: (mode: MultiSelectionAlignment) => void
    readonly distribute: (axis: 'horizontal' | 'vertical') => void
    readonly duplicate: (() => void) | null
    readonly remove: (() => void) | null
  }
  readonly unavailableReason: string | null
}

const ALIGN_ACTIONS: Array<{
  mode: MultiSelectionAlignment
  label: string
  icon: typeof AlignHorizontalJustifyStart
}> = [
  { mode: 'left', label: '左对齐', icon: AlignHorizontalJustifyStart },
  { mode: 'center', label: '水平居中', icon: AlignHorizontalJustifyCenter },
  { mode: 'right', label: '右对齐', icon: AlignHorizontalJustifyEnd },
  { mode: 'top', label: '顶对齐', icon: AlignVerticalJustifyStart },
  { mode: 'middle', label: '垂直居中', icon: AlignVerticalJustifyCenter },
  { mode: 'bottom', label: '底对齐', icon: AlignVerticalJustifyEnd },
]

export function MultiSelectionPropertiesPanel({
  context,
}: {
  context: MultiSelectionPropertiesContext
}) {
  const { items, presentation, commands } = context
  const unlockedCount = items.filter((node) => !node.locked).length
  const visibleCount = items.filter((node) => node.visible).length
  const activeStateName = presentation?.stateName ?? null
  const overriddenCount = presentation?.overriddenCount ?? 0
  return (
    <div className="properties-scroll" data-testid="properties-tab">
      {presentation && (
        <section className={`state-editing-notice${activeStateName ? ' state-editing-notice--override' : ''}`}>
          <Layers3 size={15} />
          <div>
            <strong>{activeStateName ? `状态：${activeStateName} · 多选` : '基础场景 · 多选'}</strong>
            <span>{activeStateName
              ? overriddenCount > 0
                ? `${overriddenCount}/${items.length} 个所选元素已有覆盖；批量修改只写入当前状态。`
                : `所选 ${items.length} 个元素当前继承基础；批量修改将创建状态覆盖。`
              : '批量修改基础元素会影响所有继承这些值的状态。'}</span>
          </div>
        </section>
      )}
      <section className="property-section multi-selection-summary" data-testid="multi-selection-properties">
        <div className="multi-selection-heading">
          <span className="selection-count">{items.length}</span>
          <span>
            <strong>已选择多个图层</strong>
            <small>{visibleCount} 个显示 · {items.length - unlockedCount} 个锁定</small>
          </span>
        </div>
        <div className="selection-stat-grid" aria-label="选区尺寸">
          <span><small>左</small>{Math.round(Math.min(...items.map((node) => node.x)))}</span>
          <span><small>顶</small>{Math.round(Math.min(...items.map((node) => node.y)))}</span>
          <span><small>右</small>{Math.round(Math.max(...items.map((node) => node.x + node.width)))}</span>
          <span><small>底</small>{Math.round(Math.max(...items.map((node) => node.y + node.height)))}</span>
        </div>
      </section>
      <section className="property-section">
        <h3 className="property-title"><SlidersHorizontal size={14} />对齐与分布</h3>
        <div className="property-action-grid property-action-grid--three">
          {ALIGN_ACTIONS.map(({ mode, label, icon: Icon }) => (
            <button type="button" className="property-action-button" key={mode} title={label} aria-label={label} disabled={unlockedCount < 2} onClick={() => commands.align(mode)}>
              <Icon size={16} /><span>{label}</span>
            </button>
          ))}
        </div>
        <div className="property-action-grid property-action-grid--two property-action-grid--spaced">
          <button type="button" className="property-action-button" disabled={unlockedCount < 3} onClick={() => commands.distribute('horizontal')}><AlignHorizontalDistributeCenter size={16} /><span>水平等距</span></button>
          <button type="button" className="property-action-button" disabled={unlockedCount < 3} onClick={() => commands.distribute('vertical')}><AlignVerticalDistributeCenter size={16} /><span>垂直等距</span></button>
        </div>
        {unlockedCount !== items.length && <p className="property-hint">锁定图层不会参与对齐或分布。</p>}
      </section>
      <section className="property-section">
        <h3 className="property-title"><Layers3 size={14} />批量图层操作</h3>
        <div className="property-action-grid property-action-grid--two">
          <button type="button" className="property-action-button" onClick={() => commands.setVisible(true)}><Eye size={16} /><span>全部显示</span></button>
          <button type="button" className="property-action-button" onClick={() => commands.setVisible(false)}><EyeOff size={16} /><span>全部隐藏</span></button>
          <button type="button" className="property-action-button" onClick={() => commands.setLocked(true)}><Lock size={16} /><span>全部锁定</span></button>
          <button type="button" className="property-action-button" onClick={() => commands.setLocked(false)}><Unlock size={16} /><span>全部解锁</span></button>
        </div>
        <div className="button-row property-action-footer">
          <button type="button" className="secondary-button" disabled={!commands.duplicate} title={!commands.duplicate ? context.unavailableReason ?? undefined : undefined} onClick={() => commands.duplicate?.()}><Copy size={14} />复制所选</button>
          <button type="button" className="secondary-button secondary-button--danger" disabled={!commands.remove} title={!commands.remove ? context.unavailableReason ?? undefined : undefined} onClick={() => commands.remove?.()}><Trash2 size={14} />删除所选</button>
        </div>
        {context.unavailableReason && <p className="property-hint" data-testid="spatial-multi-actions-unavailable">{context.unavailableReason}</p>}
      </section>
    </div>
  )
}
