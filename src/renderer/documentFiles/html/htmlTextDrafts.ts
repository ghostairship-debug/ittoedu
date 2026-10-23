import { mapMarkdownRange } from '../../../core/tools/ToolTargets'
import type { HtmlSelectedTarget } from './htmlPreviewController'
import type { ComponentAuthorRecord } from '../../../shared/contracts/component-platform/runtime'
import { patchHtmlAuthoringRecords, readHtmlAuthoringRecords } from '../../../shared/html/htmlAuthoringRecords'
import { equalComponentValue } from '../../../core/drivers/courseV10Operations'
import type { HtmlSourceAnalysis } from './htmlSourceAnalysis'

export interface HtmlTextDraft {
  readonly id: number
  readonly source: string
  readonly from: number
  readonly to: number
  readonly original: string
  readonly value: string
  readonly issue?: string
  /** Different recovered alternatives are kept for a person to choose, never replayed together. */
  readonly alternative?: boolean
  readonly authoring?: { authorKey: string; record: ComponentAuthorRecord }
  readonly sourceAuthoring?: { authorKey: string; record: ComponentAuthorRecord }
}
type PreparedTextDrafts = { source: string; drafts: Array<{ id: number; value: string; from: number; to: number }> }
const sourceChanged = '原文字已变化，草稿仍保留。要保留这次修改，请复制草稿，重新选择文字并粘贴、应用，再点击“放弃这份草稿”移除旧草稿后保存；不需要这次修改可直接放弃。'

function textRange(target: HtmlSelectedTarget, source: string) {
  if (target.report.kind !== 'text' || target.resolved.status !== 'editable') return null
  const { valueSpan, expectedRaw } = target.resolved.locator
  return valueSpan && source.slice(valueSpan.start, valueSpan.end) === expectedRaw
    ? { from: valueSpan.start, to: valueSpan.end } : null
}

function mapped(draft: HtmlTextDraft, source: string, records: () => ReturnType<typeof readHtmlAuthoringRecords>) {
  const address = draft.authoring ?? draft.sourceAuthoring
  const current = address && records()[address.authorKey]
  if (current && address) {
    const expected = structuredClone(draft.sourceAuthoring ? { ...address.record.binding, baseline: draft.original } : address.record.binding)
    // The exact source adapter can anchor this same selected static element on its first geometry edit.
    const anchor = current.binding.path.at(-1)?.attributes?.['data-cw-author-key']
    const last = expected.path.at(-1)
    if (draft.sourceAuthoring && anchor === address.authorKey && last && !last.attributes?.['data-cw-author-key']) {
      expected.path = expected.path.map((step, index) => ({ tag: step.tag, index: step.index,
        ...(index === expected.path.length - 1 ? { attributes: { 'data-cw-author-key': anchor } } : {}) }))
    }
    if (current.kind !== address.record.kind || !equalComponentValue(current.scope ?? {}, address.record.scope ?? {})
      || !equalComponentValue(current.binding, expected)) throw new Error(sourceChanged)
  }
  if (draft.authoring) {
    const record = current
    const value = record?.overrides.text ?? record?.binding.baseline ?? draft.authoring.record.binding.baseline
    if (value !== draft.original) throw new Error(sourceChanged)
    return { from: 0, to: 0 }
  }
  return mapMarkdownRange(draft.source, source, { kind: 'markdown-range', from: draft.from, to: draft.to })
}

function encoded(value: string, source: string, previous: string): string {
  const text = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return previous.includes('\r\n') || source.includes('\r\n') && !/(^|[^\r])\n/.test(source)
    ? text.replace(/\r?\n/g, '\r\n') : text
}

/** Unapplied input belongs to this document, not to a frame handle or a visible popover.
 * Preparing a save returns source to the existing document session; it never writes by itself. */
export class HtmlTextDrafts {
  private drafts: readonly HtmlTextDraft[] = []
  private sequence = 0
  private readonly listeners = new Set<() => void>()
  private prepared: PreparedTextDrafts[] = []
  private analysis: HtmlSourceAnalysis | undefined
  setAnalysis(value: HtmlSourceAnalysis) { this.analysis = value }
  private recordsSource: string | undefined
  private records: ReturnType<typeof readHtmlAuthoringRecords> | undefined
  private mapped(draft: HtmlTextDraft, source: string) {
    return mapped(draft, source, () => {
      if (source !== this.recordsSource || !this.records) {
        this.records = this.analysis?.source === source ? this.analysis.authoring.authoringRecords : readHtmlAuthoringRecords(source)
        this.recordsSource = source
      }
      return this.records
    })
  }
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  readonly read = () => this.drafts
  private publish(drafts: readonly HtmlTextDraft[]) {
    this.drafts = drafts
    if (!drafts.length) { this.recordsSource = undefined; this.records = undefined }
    for (const listener of this.listeners) listener()
  }
  private wasPrepared(id: number): boolean { return this.prepared.some(value => value.drafts.some(draft => draft.id === id)) }

  restore(records: readonly Omit<HtmlTextDraft, 'id'>[]): void {
    const drafts = [...this.drafts]
    for (const record of records) {
      if (drafts.some(draft => draft.source === record.source && draft.from === record.from && draft.to === record.to
        && draft.original === record.original && draft.value === record.value
        && equalComponentValue(draft.authoring ?? draft.sourceAuthoring ?? null, record.authoring ?? record.sourceAuthoring ?? null))) continue
      const sameTarget = (draft: HtmlTextDraft) => record.authoring
        ? draft.authoring?.authorKey === record.authoring.authorKey
        : !draft.authoring && draft.source === record.source && draft.from === record.from && draft.to === record.to
      const alternative = drafts.some(sameTarget)
      if (alternative) for (let index = 0; index < drafts.length; index++) if (sameTarget(drafts[index]!))
        drafts[index] = { ...drafts[index]!, alternative: true, issue: '此处有多份未应用文字稿，均已保留；请选择需要的内容。' }
      drafts.push({ ...record, id: ++this.sequence, ...(alternative ? { alternative: true, issue: '此处有多份未应用文字稿，均已保留；请选择需要的内容。' } : {}) })
    }
    if (drafts.length !== this.drafts.length) this.publish(drafts)
  }

  /** A repeated flush can receive the optimistic source of an earlier submission.
   * Use that known span without treating its projection as a committed receipt. */
  private rangeForSave(draft: HtmlTextDraft, source: string) {
    for (let index = this.prepared.length - 1; index >= 0; index--) {
      const prepared = this.prepared[index]!
      const submitted = prepared.drafts.find(value => value.id === draft.id)
      if (!submitted) continue
      try { return this.mapped({ ...draft, source: prepared.source, original: submitted.value, from: submitted.from, to: submitted.to }, source) }
      catch { /* This source does not contain that submitted span; try an earlier baseline. */ }
    }
    return this.mapped(draft, source)
  }

  find(target: HtmlSelectedTarget, source: string): HtmlTextDraft | undefined {
    const authoring = target.resolved.status === 'editable' ? target.resolved.locator.authoring : undefined
    if (authoring) return this.drafts.find(draft => draft.authoring?.authorKey === authoring.authorKey)
    const range = textRange(target, source)
    if (!range) return undefined
    return this.drafts.find(draft => {
      try { const next = this.mapped(draft, source); return next.from === range.from && next.to === range.to }
      catch { return false }
    })
  }

  change(target: HtmlSelectedTarget, source: string, value: string): void {
    const authoring = target.resolved.status === 'editable' ? target.resolved.locator.authoring : undefined
    const range = textRange(target, source)
    if (!range && !authoring) return
    const previous = this.find(target, source)
    if (value === target.report.rawText && (!previous || !this.wasPrepared(previous.id))) { if (previous) this.discard(previous.id); return }
    const next: HtmlTextDraft = { id: previous?.id ?? ++this.sequence, source, ...(range ?? { from: 0, to: 0 }),
      ...(authoring ? { authoring } : target.report.authoring ? { sourceAuthoring: target.report.authoring } : {}), original: target.report.rawText, value }
    this.publish(previous ? this.drafts.map(draft => draft.id === previous.id ? next : draft) : [...this.drafts, next])
  }

  changeRetained(id: number, value: string): void {
    const draft = this.drafts.find(item => item.id === id)
    if (!draft || draft.value === value) return
    if (value === draft.original && !this.wasPrepared(id)) this.discard(id)
    else this.publish(this.drafts.map(item => item.id === id ? { ...item, value } : item))
  }
  discard(id: number): void { this.publish(this.drafts.filter(draft => draft.id !== id)) }
  applied(target: HtmlSelectedTarget, source: string, value: string): void {
    const draft = this.find(target, source)
    if (draft?.value === value) this.discard(draft.id)
  }

  reconcile(source: string): void {
    let drafts = this.drafts
    // Called with committed source only. Typing after Save remains a new draft
    // against the acknowledged text, including when another save is already queued.
    const acknowledged = this.prepared.findIndex(value => value.source === source)
    if (acknowledged >= 0) {
      const prepared = this.prepared[acknowledged]!
      drafts = drafts.flatMap(draft => {
        const submitted = prepared.drafts.find(item => item.id === draft.id)
        if (!submitted) return [draft]
        return draft.value === submitted.value ? [] : [{ ...draft, source, from: submitted.from, to: submitted.to,
          original: submitted.value, issue: undefined }]
      })
      this.prepared.splice(0, acknowledged + 1)
    }
    const next = drafts.flatMap(draft => {
      if (draft.alternative) return [draft]
      // Recovery can outlive the input's successful commit. Compare against the
      // exact intended value before treating that own change as a conflict.
      try {
        const intended = draft.authoring ? null : draft.source.slice(0, draft.from)
          + encoded(draft.value, draft.source, draft.source.slice(draft.from, draft.to)) + draft.source.slice(draft.to)
        if (draft.authoring) {
          const records = this.analysis?.source === source ? this.analysis.authoring.authoringRecords : readHtmlAuthoringRecords(source)
          const record = records[draft.authoring.authorKey]
          if (record?.overrides.text === draft.value && equalComponentValue(record.binding, draft.authoring.record.binding)
            && equalComponentValue(record.scope ?? {}, draft.authoring.record.scope ?? {})) return []
        } else if (intended !== null) {
          const value = encoded(draft.value, draft.source, draft.source.slice(draft.from, draft.to))
          const range = mapMarkdownRange(intended, source, { kind: 'markdown-range', from: draft.from, to: draft.from + value.length })
          if (source.slice(range.from, range.to) === value) return []
        }
      } catch { /* The intended value is not in the current source; retain the original input. */ }
      try {
        const range = this.mapped(draft, source)
        return [draft.source === source && !draft.issue ? draft : { ...draft, source, from: range.from, to: range.to, issue: undefined }]
      } catch {
        return [draft.issue ? draft : { ...draft, issue: sourceChanged }]
      }
    })
    if (next.length !== this.drafts.length || next.some((draft, index) => draft !== this.drafts[index])) this.publish(next)
  }

  prepare(source: string, sourceChangeHints?: Array<{ from: number; to: number; inserted: number }>, retained = false): { ready: boolean; source: string } {
    const located = this.drafts.map(draft => {
      if (draft.alternative) return draft
      try { return { ...draft, ...this.rangeForSave(draft, source), issue: undefined } }
      catch { return { ...draft, issue: sourceChanged } }
    })
    const next = this.drafts.map((draft, index) => draft.issue === located[index]!.issue
      ? draft : { ...draft, issue: located[index]!.issue })
    if (next.some((draft, index) => draft !== this.drafts[index])) this.publish(next)
    if (!retained && located.some(draft => draft.issue)) return { ready: false, source }
    const applicable = located.filter(draft => !draft.issue)
    const sorted = applicable.filter(draft => !draft.authoring).sort((a, b) => a.from - b.from)
    const submitted: PreparedTextDrafts['drafts'] = []
    const staticChanges: Array<{ from: number; to: number; inserted: number }> = []
    let result = '', position = 0
    for (const draft of sorted) {
      const text = encoded(draft.value, source, source.slice(draft.from, draft.to))
      staticChanges.push({ from: draft.from, to: draft.to, inserted: text.length })
      result += source.slice(position, draft.from)
      const from = result.length
      result += text
      submitted.push({ id: draft.id, value: draft.value, from, to: result.length })
      position = draft.to
    }
    result += source.slice(position)
    sourceChangeHints?.push(...staticChanges.reverse())
    const dynamic = applicable.filter(draft => draft.authoring)
    if (dynamic.length || sorted.some(draft => draft.sourceAuthoring)) {
      const records = readHtmlAuthoringRecords(result)
      let changed = false
      for (const draft of sorted) {
        const key = draft.sourceAuthoring?.authorKey, previous = key && records[key]
        if (key && previous) {
          records[key] = { ...previous, binding: { ...previous.binding, baseline: draft.value } }
          changed = true
        }
      }
      for (const draft of dynamic) {
        const authoring = draft.authoring!
        const previous = records[authoring.authorKey] ?? authoring.record
        records[authoring.authorKey] = { ...previous, overrides: { ...previous.overrides, text: draft.value } }
        changed = true
        submitted.push({ id: draft.id, value: draft.value, from: 0, to: 0 })
      }
      if (changed) result = patchHtmlAuthoringRecords(result, records, {}, sourceChangeHints)
    }
    if (submitted.length) {
      const prepared = { source: result, drafts: submitted }
      if (this.prepared.at(-1)?.source === result) this.prepared[this.prepared.length - 1] = prepared
      else this.prepared.push(prepared)
    }
    return { ready: true, source: result }
  }
}
