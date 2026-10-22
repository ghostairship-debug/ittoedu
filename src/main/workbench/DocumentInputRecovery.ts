import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { documentDigest } from '../../core/documents/documentDigest'
import { flowDocumentRecoverySchema, normalizedFlowRecoveryPath } from '../../shared/flowDocumentRecovery'
import { authoringDraftRecoverySchema, authoringDraftWriteSchema, authoringRecoveryRecordSchema,
  type AuthoringDraftRecovery, type AuthoringDraftWrite, type AuthoringRecoveryClaim } from '../../shared/workbench/desktop'
import type { DocumentKind, DocumentSnapshot } from '../../shared/workbench/document'
import type { WorkspaceMutationAction } from './WorkspaceFiles'
import { relocatedDocumentPath } from './DocumentFileCoordinator'
import { readLegacyFlowDocumentInputs } from '../flowDocumentRecovery'

type Owner = Pick<DocumentSnapshot, 'documentId' | 'epoch' | 'binding'> & { model:
  { kind: Exclude<DocumentKind, 'course-v10'> } | { kind: 'course-v10'; project: { id: string } } }
const bindingSchema = z.union([z.object({ kind: z.literal('file'), path: z.string(), version: z.string().nullable(), bindingVersion: z.number() }),
  z.object({ kind: z.literal('untitled'), suggestedName: z.string() })])
const storedRecordSchema = authoringRecoveryRecordSchema.extend({ ownerEpoch: z.string(), active: z.boolean().default(false) })
const envelopeSchema = z.object({ schemaVersion: z.literal(2), documentId: z.string(), epoch: z.string(),
  binding: bindingSchema, kind: z.string(), projectId: z.string().optional(), legacyLocator: z.string().optional(), records: z.array(storedRecordSchema) }).strict()
type Envelope = z.infer<typeof envelopeSchema>
type StoredRecord = Envelope['records'][number]
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
const canonicalPath = (value: string) => normalizedFlowRecoveryPath(value)
const contentDigest = (kind: StoredRecord['kind'], value: StoredRecord['value']) => {
  const stable = { ...value } as Record<string, unknown>
  delete stable.documentId; delete stable.epoch; delete stable.documentEpoch; delete stable.projectPath
  if (kind === 'properties' && typeof stable.bindingKey === 'string') {
    try { const binding = JSON.parse(stable.bindingKey); if (Array.isArray(binding)) stable.bindingKey = binding.slice(2) } catch { /* Preserve malformed original identity. */ }
  }
  return documentDigest({ kind, value: stable })
}
const record = (owner: Owner, kind: StoredRecord['kind'], value: StoredRecord['value'], active = false): StoredRecord => {
  const digest = contentDigest(kind, value)
  return { id: digest, digest, kind, value, ownerDocumentId: owner.documentId, ownerEpoch: owner.epoch, active }
}
const values = (drafts: AuthoringDraftWrite): (readonly [StoredRecord['kind'], StoredRecord['value']])[] => [
  ...(drafts.advanced ?? []).map(value => ['advanced', value] as const),
  ...(drafts.properties ?? []).map(value => ['properties', value] as const),
  ...(drafts.sourceConflicts ?? (drafts.sourceConflict ? [drafts.sourceConflict] : [])).map(value => ['sourceConflict', value] as const),
  ...(drafts.flow ?? []).map(value => ['flow', value] as const),
]
const merge = (left: StoredRecord[], right: StoredRecord[]) => {
  const merged = new Map<string, StoredRecord>()
  for (const item of [...left, ...right]) {
    const key = item.id + ':' + item.digest, previous = merged.get(key)
    if (!previous || item.active || !previous.active || item.ownerDocumentId !== previous.ownerDocumentId || item.ownerEpoch !== previous.ownerEpoch) merged.set(key, item)
  }
  return [...merged.values()]
}

/** One owner for all uncommitted input. Binding metadata locates candidates; it never owns them. */
export class DocumentInputRecovery {
  // Admission order belongs to the caller's owner. Cross-owner work locks its actual publication owners separately.
  private readonly requests = new Map<string, Promise<void>>()
  private readonly publications = new Map<string, Promise<void>>()
  private maintenanceTail: Promise<void> = Promise.resolve()
  constructor(private readonly directory: string, private readonly legacyFlowDirectory?: string) {}
  private serial<T>(tails: Map<string, Promise<void>>, documentIds: readonly string[], action: () => Promise<T>): Promise<T> {
    const keys = [...new Set(documentIds)]
    const next = Promise.all(keys.map(key => tails.get(key))).then(action)
    const settled = next.then(() => undefined, () => undefined)
    for (const key of keys) tails.set(key, settled)
    void settled.then(() => { for (const key of keys) if (tails.get(key) === settled) tails.delete(key) })
    return next
  }
  private request<T>(documentId: string, action: () => Promise<T>): Promise<T> {
    return this.serial(this.requests, [documentId], action)
  }
  private maintain<T>(action: () => Promise<T>): Promise<T> {
    const next = this.maintenanceTail.then(action, action)
    this.maintenanceTail = next.then(() => undefined, () => undefined)
    return next
  }
  /** Cross-owner discovery/consumption stays consistent; ordinary publications do not take this queue. */
  private candidates<T>(owner: Owner, action: (envelopes: Envelope[]) => Promise<T>): Promise<T> {
    return this.maintain(async () => {
      const found = (await this.envelopes()).filter(envelope => this.matches(owner, envelope))
      return this.serial(this.publications, [owner.documentId, ...found.map(envelope => envelope.documentId)], async () => {
        const current = await Promise.all(found.map(envelope => this.load(this.filename(envelope.documentId))))
        return action(current.filter((envelope): envelope is Envelope => !!envelope && this.matches(owner, envelope)))
      })
    })
  }
  private filename(documentId: string) { return path.join(this.directory, `${documentDigest({ documentId })}.inputs-v2.json`) }
  private envelope(owner: Owner, records: StoredRecord[] = []): Envelope {
    return { schemaVersion: 2, documentId: owner.documentId, epoch: owner.epoch, binding: structuredClone(owner.binding), kind: owner.model.kind,
      ...(owner.model.kind === 'course-v10' ? { projectId: owner.model.project.id } : {}), records }
  }
  private async load(file: string): Promise<Envelope | null> {
    try { return envelopeSchema.parse(JSON.parse(await fs.readFile(file, 'utf8'))) }
    catch (error) { if (absent(error)) return null; throw error }
  }
  private async publish(envelope: Envelope): Promise<void> {
    const filename = this.filename(envelope.documentId), temporary = `${filename}.${randomUUID()}.tmp`
    if (!envelope.records.length) { await fs.rm(filename, { force: true }); return }
    await fs.mkdir(this.directory, { recursive: true })
    try {
      const handle = await fs.open(temporary, 'wx')
      try { await handle.writeFile(JSON.stringify(envelope)); await handle.sync() } finally { await handle.close() }
      await fs.rename(temporary, filename)
    } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
  }
  private async envelopes(): Promise<Envelope[]> {
    let names: string[]
    try { names = await fs.readdir(this.directory) } catch (error) { if (absent(error)) return []; throw error }
    const found: Envelope[] = []
    for (const name of names.filter(name => name.endsWith('.inputs-v2.json'))) {
      const envelope = await this.load(path.join(this.directory, name)); if (envelope) found.push(envelope)
    }
    return found
  }
  private matches(owner: Owner, envelope: Envelope): boolean {
    if (envelope.documentId === owner.documentId) return true
    if (envelope.legacyLocator && owner.model.kind === 'course-v10' && envelope.legacyLocator === this.legacyCourseLocator(owner)) return true
    if (owner.binding.kind !== 'file' || envelope.binding.kind !== 'file'
      || canonicalPath(owner.binding.path) !== canonicalPath(envelope.binding.path) || envelope.kind !== owner.model.kind) return false
    return owner.model.kind !== 'course-v10' || envelope.projectId === owner.model.project.id
  }
  private legacyCourseLocator(owner: Owner): string {
    return documentDigest({ projectId: owner.model.kind === 'course-v10' ? owner.model.project.id : null,
      file: owner.binding.kind === 'file' ? (process.platform === 'win32' ? owner.binding.path.toLowerCase() : owner.binding.path) : null })
  }
  /** One-time old filenames are read and merged before the source is consumed. */
  private async migrate(owner: Owner): Promise<void> {
    const sources = [path.join(this.directory, `${documentDigest({ documentId: owner.documentId })}.json`)]
    if (owner.model.kind === 'course-v10') sources.push(path.join(this.directory, `${documentDigest({ projectId: owner.model.project.id,
      file: owner.binding.kind === 'file' ? (process.platform === 'win32' ? owner.binding.path.toLowerCase() : owner.binding.path) : null })}.json`))
    for (const file of [...new Set(sources)]) {
      // The overwhelmingly common path must not queue behind another document's legacy publication.
      try { await fs.access(file) } catch (error) { if (absent(error)) continue; throw error }
      await this.migrateAuthoringFile(file, owner)
    }
    await this.migrateLegacyFlow(owner)
  }
  private async migrateAuthoringFile(filename: string, owner?: Owner): Promise<void> {
    await this.maintain(async () => {
      let drafts: AuthoringDraftRecovery
      try { drafts = authoringDraftRecoverySchema.parse(JSON.parse(await fs.readFile(filename, 'utf8'))) }
      catch (error) { if (absent(error) || !owner) return; throw error }
      const targets = new Map<string, Envelope>()
      for (const [kind, value] of values(drafts)) {
        let documentId = owner?.documentId ?? `unclaimed-input:${path.basename(filename, '.json')}`, epoch = owner?.epoch ?? 'legacy-input'
        if ('documentId' in value && typeof value.documentId === 'string') { documentId = value.documentId; epoch = typeof value.epoch === 'string' ? value.epoch : epoch }
        else if ('bindingKey' in value) { try { const key = JSON.parse(value.bindingKey); if (Array.isArray(key) && typeof key[0] === 'string' && typeof key[1] === 'string') [documentId, epoch] = key } catch { /* Keep the exact-locator candidate. */ } }
        const projectId = 'projectId' in value && typeof value.projectId === 'string' ? value.projectId : undefined
        const target: Envelope = targets.get(documentId) ?? (owner ? { ...this.envelope(owner), documentId, epoch }
          : { schemaVersion: 2, documentId, epoch, binding: { kind: 'untitled', suggestedName: '未认领的原始输入' },
            kind: projectId ? 'course-v10' : 'text', ...(projectId ? { projectId } : {}), legacyLocator: path.basename(filename, '.json'), records: [] })
        const digest = contentDigest(kind, value)
        target.records = merge(target.records, [{ id: digest, digest, ownerDocumentId: documentId, ownerEpoch: epoch, kind, value, active: false }])
        targets.set(documentId, target)
      }
      await this.serial(this.publications, [...targets.keys()], async () => {
        for (const candidate of targets.values()) {
          const target = await this.load(this.filename(candidate.documentId)) ?? { ...candidate, records: [] }
          await this.publish({ ...target, records: merge(target.records, candidate.records) })
        }
        // All targets ACK possession before the shared old source is consumed. A retry deduplicates content.
        await fs.rm(filename, { force: true })
      })
    })
  }
  private flowEnvelope(value: z.infer<typeof flowDocumentRecoverySchema>): Envelope {
    const documentId = value.documentId ?? `unclaimed-flow:${documentDigest({ projectId: value.projectId, path: value.projectPath })}`
    return { schemaVersion: 2, documentId, epoch: String(value.documentEpoch ?? value.epoch),
      kind: 'course-v10', projectId: value.projectId, binding: value.projectPath === null
        ? { kind: 'untitled', suggestedName: '未认领的 Flow 原文' }
        : { kind: 'file', path: value.projectPath, version: null, bindingVersion: 1 }, records: [] }
  }
  private async migrateLegacyFlow(owner?: Owner): Promise<void> {
    if (!this.legacyFlowDirectory) return
    for (const source of await readLegacyFlowDocumentInputs(this.legacyFlowDirectory)) {
      if (owner && !this.matches(owner, this.flowEnvelope(source.record))) continue
      await this.maintain(async () => {
        // Another reader may already have migrated and consumed this source while we waited.
        let value: z.infer<typeof flowDocumentRecoverySchema>
        try { value = flowDocumentRecoverySchema.parse(JSON.parse(await fs.readFile(source.filename, 'utf8'))) }
        catch (error) { if (absent(error)) return; throw error }
        const candidate = this.flowEnvelope(value), { documentId, epoch } = candidate
        await this.serial(this.publications, [documentId], async () => {
          const target = await this.load(this.filename(documentId)) ?? candidate
          const digest = contentDigest('flow', value)
          target.records = merge(target.records, [{ id: digest, digest, ownerDocumentId: documentId, ownerEpoch: epoch, kind: 'flow', value, active: false }])
          await this.publish(target); await fs.rm(source.filename, { force: true })
        })
      })
    }
  }
  private async discoverLegacyAuthoring(): Promise<void> {
    let names: string[]
    try { names = await fs.readdir(this.directory) } catch (error) { if (absent(error)) return; throw error }
    for (const name of names.filter(name => name.endsWith('.json') && !name.endsWith('.inputs-v2.json'))) {
      await this.migrateAuthoringFile(path.join(this.directory, name))
    }
  }
  material(envelope: Envelope): { kind: 'text'; source: string; resources: { assets: {}; components: {} } } {
    const source = [`原始输入材料\n原文档：${envelope.documentId}\n原来源：${envelope.binding.kind === 'file' ? envelope.binding.path : envelope.binding.suggestedName}${envelope.projectId ? `\n原工程：${envelope.projectId}` : ''}`,
      ...envelope.records.map((item, index) => {
        const value = item.value
        const target = 'key' in value ? value.key : 'bindingKey' in value ? value.bindingKey
          : 'surfaceId' in value ? `${value.surfaceId} · revision ${value.revision}` : 'Source conflict'
        const raw = 'source' in value && typeof value.source === 'string' ? value.source : 'raw' in value ? value.raw
          : 'payload' in value ? typeof value.payload === 'string' ? value.payload : JSON.stringify(value.payload, null, 2) : JSON.stringify(value, null, 2)
        return `记录 ${index + 1} · ${item.kind}\n记录身份：${item.id}\n原目标：${target}\n${raw}${item.kind === 'sourceConflict' ? `\n冲突输入：\n${(value as NonNullable<AuthoringDraftRecovery['sourceConflict']>).hunks.map(hunk => `${hunk.id}\n${hunk.text}`).join('\n\n')}` : ''}`
      })].join('\n\n')
    return { kind: 'text', source, resources: { assets: {}, components: {} } }
  }
  read(owner: Owner): Promise<AuthoringDraftRecovery | null> { return this.request(owner.documentId, async () => {
    await this.migrate(owner)
    return this.candidates(owner, async envelopes => {
      const records = merge([], envelopes.flatMap(envelope => envelope.records))
      if (!records.length) return null
      const advanced = records.filter(item => item.kind === 'advanced').map(item => item.value) as AuthoringDraftRecovery['advanced']
      const properties = records.filter(item => item.kind === 'properties').map(item => item.value) as AuthoringDraftRecovery['properties']
      const sourceConflicts = records.filter(item => item.kind === 'sourceConflict').map(item => item.value) as NonNullable<AuthoringDraftRecovery['sourceConflicts']>
      const flow = records.filter(item => item.kind === 'flow').map(item => item.value) as NonNullable<AuthoringDraftRecovery['flow']>
      return { advanced, properties, sourceConflicts, ...(sourceConflicts.length === 1 ? { sourceConflict: sourceConflicts[0] } : {}), flow,
        recoveryRecords: records.map(({ ownerEpoch: _, active: __, ...item }) => item) }
    })
  }) }
  write(owner: Owner, input: AuthoringDraftWrite, assertActive: () => void = () => {}): Promise<void> { return this.request(owner.documentId, async () => {
    assertActive()
    const drafts = authoringDraftWriteSchema.parse(input)
    await this.migrate(owner)
    await this.serial(this.publications, [owner.documentId], async () => {
      const current = await this.load(this.filename(owner.documentId)) ?? this.envelope(owner)
      for (const candidate of drafts.retainedRecords ?? []) {
        const original = current.records.find(item => item.id === candidate.id && item.digest === candidate.digest)
        if (original) original.active = false
      }
      const kinds = new Set<StoredRecord['kind']>(Object.keys(drafts).filter(key => ['advanced', 'properties', 'sourceConflict', 'sourceConflicts', 'flow'].includes(key)).map(key => key === 'sourceConflicts' ? 'sourceConflict' : key) as StoredRecord['kind'][])
      const retained = current.records.filter(item => !item.active || item.ownerEpoch !== owner.epoch || !kinds.has(item.kind)
        || item.kind === 'flow' && drafts.flowSurfaceId && (item.value as { surfaceId: string }).surfaceId !== drafts.flowSurfaceId)
      assertActive()
      await this.publish(this.envelope(owner, merge(retained, values(drafts).map(([kind, value]) => record(owner, kind, value, true)))))
    })
  }) }
  claim(owner: Owner, claims: readonly AuthoringRecoveryClaim[], assertActive: () => void = () => {}): Promise<void> { return this.request(owner.documentId, async () => {
    assertActive()
    await this.migrate(owner)
    await this.candidates(owner, async envelopes => {
      const selected = claims.map(claim => {
        const found = envelopes.flatMap(envelope => envelope.records).find(item => item.id === claim.id && item.digest === claim.digest)
        if (!found) throw new Error('原始输入已改变或不属于当前文档，未消费恢复记录')
        return found
      })
      const current = await this.load(this.filename(owner.documentId)) ?? this.envelope(owner)
      assertActive()
      await this.publish(this.envelope(owner, merge(current.records, selected.map(item => ({ ...item, ownerDocumentId: owner.documentId, ownerEpoch: owner.epoch, active: true })))))
      // Publication above ACKs possession. Only the selected identities leave previous owners.
      for (const envelope of envelopes) if (envelope.documentId !== owner.documentId) {
        const retained = envelope.records.filter(item => !selected.some(value => item.id === value.id && item.digest === value.digest))
        if (retained.length !== envelope.records.length) await this.publish({ ...envelope, records: retained })
      }
    })
  }) }
  refresh(owner: Owner): Promise<void> { return this.request(owner.documentId, async () => {
    await this.migrate(owner)
    await this.serial(this.publications, [owner.documentId], async () => {
      const current = await this.load(this.filename(owner.documentId))
      if (current) await this.publish(this.envelope(owner, current.records))
    })
  }) }
  relocate(action: WorkspaceMutationAction): Promise<void> {
    const prior = [...this.requests.values(), this.maintenanceTail]
    return Promise.all(prior).then(() => this.maintain(async () => {
      for (const candidate of await this.envelopes()) {
        await this.serial(this.publications, [candidate.documentId], async () => {
          const envelope = await this.load(this.filename(candidate.documentId))
          if (!envelope || envelope.binding.kind !== 'file') return
          const before = envelope.binding
          const destination = relocatedDocumentPath(action, before.path)
          if (destination) await this.publish({ ...envelope, binding: { ...before, path: destination, bindingVersion: before.bindingVersion + 1 } })
          else if (action.kind === 'trash' && action.sources.some(source => {
            const relative = path.relative(source.resolvedPath, before.path)
            return source.kind === 'directory' ? relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
              : canonicalPath(source.resolvedPath) === canonicalPath(before.path)
          })) await this.publish({ ...envelope, binding: { kind: 'untitled', suggestedName: path.basename(before.path) } })
        })
      }
    }))
  }
  clear(owner: Owner): Promise<void> { return this.write(owner, { advanced: [], properties: [], sourceConflicts: [], flow: [] }) }
  discard(documentId: string): Promise<void> { return this.request(documentId, () => this.serial(this.publications, [documentId], async () => {
    await fs.rm(this.filename(documentId), { force: true })
  })) }
  list(): Promise<Envelope[]> {
    const prior = [...this.requests.values(), this.maintenanceTail]
    return Promise.all(prior).then(async () => {
      await this.discoverLegacyAuthoring()
      await this.migrateLegacyFlow()
      return this.maintain(() => this.envelopes())
    })
  }
}
