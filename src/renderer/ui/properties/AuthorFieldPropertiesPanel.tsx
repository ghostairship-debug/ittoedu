import { ImageIcon, Layers3, Type } from 'lucide-react'

export interface AuthorFieldPropertiesContext {
  readonly kind: 'author-field'
  readonly draftBindingKey: string
  readonly fieldKind: 'text' | 'image'
  readonly label: string
  readonly ownerName: string
  readonly disabledReason: string | null
  readonly commands: { edit(): void; selectOwner(): void }
}

/** This is the selected field's inspector; parent layout requires an explicit selection. */
export function AuthorFieldPropertiesPanel({ context }: { context: AuthorFieldPropertiesContext }) {
  const Icon = context.fieldKind === 'text' ? Type : ImageIcon
  return <div className="properties-scroll" data-testid="properties-tab">
    <section className="property-section" data-testid="author-field-properties-context">
      <h3 className="property-title"><Icon size={14} />{context.label}</h3>
      <button type="button" className="secondary-button" disabled={Boolean(context.disabledReason)} onClick={context.commands.edit}>
        {context.fieldKind === 'image' ? '替换这张图片' : '在作品中编辑文字'}
      </button>
      <p className="property-hint">当前操作只影响这处内容。调整整体布局或删除整个组件，请先选择整体。</p>
      <button type="button" className="secondary-button" onClick={context.commands.selectOwner}><Layers3 size={14} />选择整体：{context.ownerName}</button>
      {context.disabledReason && <p className="property-hint" role="status">{context.disabledReason}</p>}
    </section>
  </div>
}
