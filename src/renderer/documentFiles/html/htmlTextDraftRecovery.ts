import { z } from 'zod'
import { componentAuthorRecordSchema, jsonValueSchema } from '../../../shared/contracts/component-platform/schema'
import type { AdvancedDraftRecovery, AuthoringRecoveryClaim, DocumentHostAPI } from '../../../shared/workbench/desktop'
import { HtmlTextDrafts, type HtmlTextDraft } from './htmlTextDrafts'

const key = 'html-text-drafts'
const address = z.object({ authorKey: z.string(), record: componentAuthorRecordSchema })
const payloadSchema = z.object({ version: z.literal(1), sources: z.array(z.string()), drafts: z.array(z.object({
  source: z.number().int().nonnegative(), from: z.number().int().nonnegative(), to: z.number().int().nonnegative(),
  original: z.string(), value: z.string(), authoring: address.optional(), sourceAuthoring: address.optional(), alternative: z.boolean().optional(),
})) })
type RecoveryAPI = Pick<DocumentHostAPI, 'readAuthoringDrafts' | 'writeAuthoringDrafts' | 'claimAuthoringDrafts'>

/** HTML input uses the existing auxiliary Source recovery records. It never
 * dispatches a document operation or silently applies a recovered alternative. */
export class HtmlTextDraftRecovery {
  private opened: Promise<void> | undefined
  private tail: Promise<void> = Promise.resolve()
  private saved: readonly HtmlTextDraft[] | undefined
  private retained: AuthoringRecoveryClaim[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private stop: (() => void) | undefined
  private live = false
  private ended = false
  private issue: string | null = null
  constructor(private readonly drafts: HtmlTextDrafts, private readonly owner: { documentId: string; epoch: string },
    private readonly api: RecoveryAPI | undefined, private readonly report: (message: string | null) => void) {}
  mount(): () => void {
    this.live = true
    this.ended = false
    void this.open().catch(error => this.failed(error))
    this.stop = this.drafts.subscribe(() => {
      clearTimeout(this.timer)
      // Coalesce replaceable input snapshots; explicit prepare below always
      // awaits its own acknowledgement and does not wait for this timer.
      this.timer = setTimeout(() => { void this.persist().catch(error => this.failed(error)) }, 800)
    })
    return () => this.dispose()
  }
  private failed(error: unknown) {
    this.issue = error instanceof Error ? error.message : String(error)
    if (this.live) this.report(`文字原稿暂未保全：${this.issue}`)
  }
  private open(): Promise<void> {
    return this.opened ??= this.restore().catch(error => { this.opened = undefined; throw error })
  }
  private async restore(): Promise<void> {
    if (!this.api) return
    try {
      const recovery = await this.api.readAuthoringDrafts(this.owner.documentId)
      if (this.ended || !recovery) return
      const adopted: AdvancedDraftRecovery[] = []
      for (const candidate of recovery.advanced) {
        if (candidate.kind !== 'source' || candidate.key !== key) continue
        const parsed = payloadSchema.safeParse(candidate.payload)
        if (!parsed.success || parsed.data.drafts.some(draft => parsed.data.sources[draft.source] === undefined
          || draft.from > draft.to || draft.to > parsed.data.sources[draft.source]!.length)) {
          this.report('一份旧 HTML 文字稿无法直接接续，原始恢复记录仍保留。')
          continue
        }
        this.drafts.restore(parsed.data.drafts.map(draft => ({ ...draft, source: parsed.data.sources[draft.source]! })))
        adopted.push(candidate)
      }
      const records = recovery.recoveryRecords ?? []
      const isAdopted = (value: unknown) => adopted.includes(value as AdvancedDraftRecovery)
        || adopted.some(candidate => JSON.stringify(candidate) === JSON.stringify(value))
      const claims = records.filter(record => record.kind === 'advanced' && isAdopted(record.value)).map(({ id, digest }) => ({ id, digest }))
      this.retained = records.filter(record => record.kind === 'advanced' && !isAdopted(record.value)).map(({ id, digest }) => ({ id, digest }))
      if (claims.length) await this.api.claimAuthoringDrafts?.(this.owner.documentId, this.owner.epoch, claims)
      this.saved = undefined
    } catch (error) { this.failed(error); throw error }
  }
  private write(records: readonly HtmlTextDraft[]): Promise<void> {
    const work = this.tail.catch(() => {}).then(async () => {
      await this.open()
      if (this.saved === records) return
      if (!this.api) {
        if (records.length) throw new Error('当前环境未连接输入恢复服务，原稿仍在当前编辑器中。')
        return
      }
      // A dynamic field is anchored by its existing author record, not by the
      // outer HTML span. Its recovery needs no copy of embedded media/code.
      const baseline = (draft: Pick<HtmlTextDraft, 'authoring' | 'source'>) => draft.authoring ? '' : draft.source
      const sources = [...new Set(records.map(baseline))]
      const payload = { version: 1 as const, sources, drafts: records.map(({ id: _id, issue: _issue, ...draft }) => ({ ...draft, source: sources.indexOf(baseline(draft)) })) }
      const advanced: AdvancedDraftRecovery[] = records.length ? [{ kind: 'source', key, projectId: this.owner.documentId,
        documentId: this.owner.documentId, epoch: this.owner.epoch, payload: jsonValueSchema.parse(payload) }] : []
      await this.api.writeAuthoringDrafts(this.owner.documentId, { advanced, ...(this.retained.length ? { retainedRecords: this.retained } : {}) }, this.owner.epoch)
      this.saved = records
      this.issue = null
      if (this.live) this.report(null)
    })
    this.tail = work
    return work
  }
  async persist(): Promise<void> {
    clearTimeout(this.timer)
    await this.open()
    return this.write(this.drafts.read())
  }
  async prepare(source: string, hints: Array<{ from: number; to: number; inserted: number }>, committedSource?: string): Promise<{ ready: boolean; source: string; issue?: string }> {
    try {
      await this.open()
      if (committedSource !== undefined) this.drafts.reconcile(committedSource)
      // Preserve even the conflicting original before allowing a save/close of
      // canonical content. A retained draft is never described as applied.
      await this.persist()
      const prepared = this.drafts.prepare(source, hints, true)
      return prepared
    } catch (error) {
      this.failed(error)
      return { ready: false, source, issue: this.issue ?? '文字原稿尚未可靠保全。' }
    }
  }
  dispose(): void {
    this.live = false
    this.ended = true
    clearTimeout(this.timer)
    this.stop?.()
    this.stop = undefined
  }
}
