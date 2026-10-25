import type { DocumentSnapshot } from '../../../shared/workbench/document'
import type { HtmlPreviewLease } from '../../../shared/workbench/htmlPreview'
import type { ExecutionSelectionTarget } from '../../../shared/workbench/executionDesktop'
import { readEditableTargetContent, prepareExecutionContentOutput } from '../../../core/tools/ToolTargets'
import { equalComponentValue } from '../../../shared/componentValue'
import { readHtmlAuthoringRecords } from '../../../shared/html/htmlAuthoringRecords'
import { captureSelection, workbenchSelection } from '../../workbench/SelectionContextController'
import { TextAiButton, textCardLabel } from '../../workbench/elementCards/ElementTextCards'
import type { HtmlSelectedTarget } from './htmlPreviewController'

/** The same current-field AI action serves the HTML quick bar and the image panel. */
export function HtmlTargetAiButton({ target, committed, prepareTarget, lease }: {
  target: HtmlSelectedTarget
  committed: DocumentSnapshot
  prepareTarget?(): Promise<HtmlSelectedTarget>
  lease?: Pick<HtmlPreviewLease, 'leaseId' | 'loadId'>
}) {
  const locator = target.resolved.status === 'editable' ? target.resolved.locator : null
  const authoring = target.report.authoring ?? locator?.authoring
  if (committed.model.kind !== 'text') return null
  return <TextAiButton documentId={committed.documentId}
    selectionIdentity={authoring ? `${committed.documentId}:${committed.epoch}:${authoring.authorKey}:${JSON.stringify({
      kind: authoring.record.kind, scope: authoring.record.scope, binding: { ...authoring.record.binding, baseline: undefined } })}`
      : `${target.report.kind}:${target.report.handle}:${committed.revision}`} start={async () => {
      const selected = await prepareTarget?.() ?? target
      const snapshot = await workbenchSelection.prepare(committed.documentId)
      if (snapshot.epoch !== committed.epoch || snapshot.model.kind !== 'text') throw new Error('文档已变化，请重新选择。')
      let located = selected.resolved.status === 'editable' ? selected.resolved.locator : null
      const fieldAuthor = selected.report.authoring ?? located?.authoring
      const current = fieldAuthor ? readHtmlAuthoringRecords(snapshot.model.source)[fieldAuthor.authorKey] : undefined
      if (!current && located && snapshot.revision !== located.revision) {
        if (!lease) throw new Error('源码已变化，请重新选择；输入已保留。')
        const response = await window.desktopAPI.workspaceFiles!({ type: 'html-preview.resolve-target',
          ...lease, revision: snapshot.revision, targets: [selected.report] })
        if (response.revision !== snapshot.revision || response.targets[0]?.status !== 'editable') throw new Error('源码已变化，请重新选择；输入已保留。')
        located = response.targets[0].locator
      }
      const sourceSpan = !current ? located?.valueSpan : null
      if (!fieldAuthor || !sourceSpan && selected.report.bindingStatus !== 'bound') throw new Error('这个对象的运行位置尚未绑定，请重新选择。')
      const original = fieldAuthor.record
      if (current && (current.kind !== original.kind || !equalComponentValue(current.scope ?? {}, original.scope ?? {})
        || !equalComponentValue(current.binding, original.binding))) throw new Error('对象已变化，请重新选择；输入已保留。')
      const record = current ?? original, field = selected.report.kind === 'text' ? 'text' as const : 'src' as const
      const value = record.overrides[field], quote = sourceSpan ? snapshot.model.source[sourceSpan.start - 1] : ''
      const address: Extract<ExecutionSelectionTarget, { kind: 'html-author-field' }> = { kind: 'html-author-field', authorKey: fieldAuthor.authorKey, field,
        record: { ...record, overrides: value === undefined ? {} : { [field]: value } },
        ...(sourceSpan ? { source: { from: sourceSpan.start, to: sourceSpan.end,
          ...(field === 'src' ? { quote: quote === '"' || quote === "'" ? quote : '' as const } : {}) } } : {}) }
      const content = readEditableTargetContent(snapshot.model, address).text
      const label = selected.report.kind === 'text' ? textCardLabel(content) : '所选图片地址'
      return { target: address, capture: captureSelection(snapshot, [address], label), contentOutput: prepareExecutionContentOutput(snapshot, address), label, content }
    }} disabledReason={!authoring ? '这个位置暂时无法定位，请重新选择。' : null} />
}
