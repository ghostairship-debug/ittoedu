import { Code2 } from 'lucide-react'
import type { ComponentDefinition, ComponentInstance } from '../../../shared/contracts/component-platform/project'
import type { DocumentResources } from '../../../shared/workbench/document'
import { ToggleRow } from './PropertyControls'
export type RuntimeInspectorCommitResult = { readonly ok: true; readonly status: 'updated' | 'unchanged' } | { readonly ok: false; readonly reason: string }
export type PropertiesFeedback = { readonly kind: 'success' | 'error'; readonly message: string }
export interface RuntimePropertiesContext {
  readonly kind: 'runtime'
  readonly scope: 'scene' | 'global'
  readonly definition: ComponentDefinition
  readonly instance: ComponentInstance
  readonly components?: DocumentResources['components']
  readonly assetCount: number
  readonly disabledReason: string | null
  readonly commands: { setEnabled(enabled: boolean): void; editSource(): void }
}
export function RuntimePropertiesPanel({ context }: { context: RuntimePropertiesContext }) {
  const implementation = context.instance.implementationOverride ?? context.definition.implementation
  if (implementation.kind !== 'source') return null
  const entry = implementation.workspace?.entry
  const entryBytes = implementation.workspace ? context.components?.[implementation.workspace.ownerId]?.[implementation.workspace.entry] : undefined
  let source = implementation.source ?? '', diagnostic: string | null = null
  if (implementation.workspace) {
    if (!entryBytes) diagnostic = `入口文件“${entry}”尚未提供，请打开源码编辑补充。`
    else try { source = new TextDecoder('utf-8', { fatal: true }).decode(entryBytes) }
    catch { diagnostic = `入口文件“${entry}”不是 UTF-8 文本，请打开源码编辑。` }
  }
  const compact = source.replace(/\s+/g, ' ').trim()
  const bytes = entryBytes?.byteLength ?? new TextEncoder().encode(source).byteLength
  return <section className="property-section runtime-inspector" data-testid={`${context.scope}-runtime-inspector`}>
    <h3 className="property-title"><Code2 size={14} />自定义组件源码</h3>
    <ToggleRow label="显示组件" checked={context.instance.visible !== false} disabled={Boolean(context.disabledReason)} onChange={context.commands.setEnabled} />
    <div className="runtime-summary-grid" aria-label="运行时摘要">
      <span><small>运行时协议</small>Component API 5</span>
      <span><small>源码体积</small>{(bytes / 1024).toFixed(bytes >= 1024 ? 1 : 2)} KiB</span>
      <span><small>工程素材</small>{context.assetCount}</span>
      <span><small>源码语言</small>{implementation.language}</span>
      {entry && <span><small>入口文件</small>{entry}</span>}
    </div>
    <div className="form-field"><label>源码摘要（只读）</label><div className="readonly-value runtime-source-summary">{compact.length > 96 ? `${compact.slice(0, 96)}…` : compact || '空源码'}</div></div>
    <button type="button" className="secondary-button" onClick={context.commands.editSource}>编辑组件源码</button>
    {diagnostic && <p className="property-hint" role="status">{diagnostic}</p>}
    {context.disabledReason && <p className="property-hint" role="status">{context.disabledReason}</p>}
  </section>
}
