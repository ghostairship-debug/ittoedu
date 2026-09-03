import { Code2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CourseRuntimeContentTextTarget } from '../../runtime/runtimeContentTextAuthoringCommands'
import type {
  CourseRuntimePropertyTarget,
  CourseRuntimePropertyUpdate,
} from '../../runtime/runtimePropertyAuthoringCommands'
import type { RuntimeInspectorAuthoringView } from '../../runtime/runtimeInspectorAuthoringView'
import { RuntimeContentEditor } from '../RuntimeContentEditor'
import { SelectField, ToggleRow } from './PropertyControls'

export type RuntimeInspectorCommitResult =
  | { readonly ok: true; readonly status: 'updated' | 'unchanged' }
  | { readonly ok: false; readonly reason: string }

export type PropertiesFeedback =
  | { readonly kind: 'success'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string }

export interface RuntimePropertiesContext {
  readonly kind: 'runtime'
  readonly scope: 'scene' | 'global'
  readonly view: RuntimeInspectorAuthoringView | null
  readonly disabledReason: string | null
  readonly commands: {
    readonly updateProperty: (
      target: CourseRuntimePropertyTarget,
      update: CourseRuntimePropertyUpdate,
    ) => RuntimeInspectorCommitResult
    readonly updateContentText: (
      target: CourseRuntimeContentTextTarget,
      value: string,
    ) => RuntimeInspectorCommitResult
  }
  readonly onFeedback: (feedback: PropertiesFeedback) => void
}

function runtimeSourceSummary(source: string): string {
  const compact = source.replace(/\s+/g, ' ').trim()
  if (!compact) return '空源码'
  return compact.length > 96 ? `${compact.slice(0, 96)}…` : compact
}

export function RuntimePropertiesPanel({
  context,
}: {
  context: RuntimePropertiesContext
}) {
  const { view, scope, commands, onFeedback } = context
  const [result, setResult] = useState<{
    kind: 'success' | 'error'
    message: string
  } | null>(null)
  const runtimeDocumentKey = view?.documentKey ?? null
  useEffect(() => setResult(null), [runtimeDocumentKey])

  const reportCommit = (
    commit: RuntimeInspectorCommitResult,
    updatedMessage: string,
    unchangedMessage: string,
  ) => {
    if (!commit.ok) {
      const feedback: PropertiesFeedback = { kind: 'error', message: commit.reason }
      setResult(feedback)
      onFeedback(feedback)
      return commit
    }
    const message = commit.status === 'updated'
      ? updatedMessage
      : unchangedMessage
    const feedback: PropertiesFeedback = { kind: 'success', message }
    setResult(feedback)
    onFeedback(feedback)
    return commit
  }

  const title = scope === 'global' ? '全局自定义运行时' : '场景自定义运行时'
  if (!view || view.availability !== 'available') {
    return (
      <section className="property-section" data-testid={`${scope}-runtime-empty`}>
        <h3 className="property-title"><Code2 size={14} />{title}</h3>
        <p className="property-empty">
          {view?.label ?? context.disabledReason ?? '当前 Runtime 作者会话不可用'}。运行时代码由 AI 或生成脚本写入工程，编辑器只负责管理和修改登记文案。
        </p>
      </section>
    )
  }

  const renderModeOptions: Array<{
    value: typeof view.renderMode
    label: string
  }> = view.runtimeApiVersion === 3
    ? [{ value: 'dom', label: 'HTML / DOM（API 3 固定）' }]
    : [
        { value: 'phaser', label: 'Phaser 画布' },
        { value: 'dom', label: 'HTML / DOM' },
        { value: 'hybrid', label: '混合渲染' },
      ]
  return (
    <section
      className="property-section runtime-inspector"
      data-testid={`${scope}-runtime-inspector`}
    >
      <h3 className="property-title"><Code2 size={14} />{title}</h3>
      <ToggleRow
        label="启用运行时"
        checked={view.enabled}
        disabled={view.effectiveLocked}
        onChange={(enabled) => reportCommit(
          commands.updateProperty(
            view.enabledTarget,
            { field: 'enabled', value: enabled },
          ),
          enabled ? '运行时已启用' : '运行时已停用',
          '运行时启用状态没有变化',
        )}
      />
      <SelectField
        label="渲染能力声明"
        value={view.renderMode}
        options={renderModeOptions}
        disabled={view.effectiveLocked || view.runtimeApiVersion === 3}
        onChange={(renderMode) => reportCommit(
          commands.updateProperty(
            view.renderModeTarget,
            { field: 'renderMode', value: renderMode },
          ),
          '运行时渲染能力声明已更新',
          '运行时渲染能力声明没有变化',
        )}
      />
      <p className="property-hint">
        {view.runtimeApiVersion === 3
          ? 'Surface Runtime / API 3 固定使用 HTML / DOM；编辑器会保留其真实协议与版本。'
          : 'Canvas Runtime / API 2 会按此字段只挂载并暴露声明的能力。修改字段不会转换源码，请确认源码支持新模式。'}
      </p>
      {view.effectiveLocked && (
        <p className="property-hint" role="status">
          {context.disabledReason ?? '当前 Runtime 已锁定，属性与登记文案均为只读。'}
        </p>
      )}
      {result && (
        <p
          className="property-hint"
          role={result.kind === 'error' ? 'alert' : 'status'}
          data-testid={`${scope}-runtime-result`}
        >
          {result.message}
        </p>
      )}
      <div className="runtime-summary-grid" aria-label="运行时摘要">
        <span><small>运行时协议</small>{view.protocol} · API {view.runtimeApiVersion}</span>
        <span><small>源码体积</small>{(view.sourceBytes / 1024).toFixed(view.sourceBytes >= 1024 ? 1 : 2)} KiB</span>
        <span><small>素材绑定</small>{view.assetCount}</span>
        <span><small>可编辑文案</small>{view.contentFields.length}</span>
        <span><small>静态后备</small>{view.fallback ? '已配置' : '未配置'}</span>
      </div>
      <div className="form-field">
        <label>源码摘要（只读）</label>
        <div className="readonly-value runtime-source-summary">
          {runtimeSourceSummary(view.runtime.source)}
        </div>
      </div>
      {view.fallback && (
        <p className="property-hint">
          静态后备：{view.fallback.coverage === 'scene' ? '整场景' : '整表面'} · {view.fallback.assetId}
        </p>
      )}
      <div className="runtime-content-heading">
        <strong>可编辑文字</strong>
        <span>修改这里只更新 content.values，不会改写源码。</span>
      </div>
      <RuntimeContentEditor
        fields={view.contentFields}
        disabled={view.effectiveLocked}
        onCommit={(target, value) => reportCommit(
          commands.updateContentText(target, value),
          `运行时文案“${target.contentKey}”已更新`,
          `运行时文案“${target.contentKey}”没有变化`,
        )}
      />
    </section>
  )
}
