import { app } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { flowDocumentRecoverySchema, flowDocumentRecoveryTargetSchema, flowRecoveryStorageIdentity, normalizedFlowRecoveryPath, type FlowDocumentRecoveryIdentity, type FlowDocumentRecoveryRecord } from '../shared/flowDocumentRecovery'
const requestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('read'), target: flowDocumentRecoveryTargetSchema }).strict(),
  z.object({ operation: z.literal('clear'), target: flowDocumentRecoveryTargetSchema }).strict(),
  z.object({ operation: z.literal('retained'), target: flowDocumentRecoveryTargetSchema }).strict(),
  z.object({ operation: z.literal('claim'), target: flowDocumentRecoveryTargetSchema,
    recordEpoch: flowDocumentRecoveryTargetSchema.shape.epoch, revision: z.number().int().nonnegative() }).strict(),
  z.object({ operation: z.literal('write'), record: flowDocumentRecoverySchema }).strict(),
])

export type FlowRecoveryDocumentIdentity = Pick<FlowDocumentRecoveryIdentity, 'projectId' | 'projectPath' | 'epoch'>
type RecoverySession = { binding: string; documentEpoch?: string | number; retired: Set<string>; claimed: Set<string> }

/** One serialized disk owner. Retained versions are never part of current-input cleanup. */
export function createFlowDocumentRecoveryStore(root: string) {
  let queue: Promise<unknown> = Promise.resolve()
  const sessions = new Map<string, RecoverySession>()
  const scope = (target: Pick<FlowDocumentRecoveryIdentity, 'projectId' | 'projectPath'>) => JSON.stringify([target.projectId,
    target.projectPath === null ? null : normalizedFlowRecoveryPath(target.projectPath)])
  const binding = (target: FlowDocumentRecoveryIdentity) => String(target.epoch)
  const storageKey = (target: FlowDocumentRecoveryIdentity) => createHash('sha256').update(flowRecoveryStorageIdentity(target)).digest('hex')
  const recordKey = (record: FlowDocumentRecoveryRecord) => JSON.stringify([flowRecoveryStorageIdentity(record), record.epoch, record.revision])
  const filename = (target: FlowDocumentRecoveryIdentity) => path.join(root, `${storageKey(target)}.json`)
  const assertActive = (target: FlowDocumentRecoveryIdentity) => {
    if (sessions.get(scope(target))?.binding !== binding(target)) throw new Error('正文恢复稿会话已失效')
  }
  const owns = (target: FlowDocumentRecoveryIdentity, record: FlowDocumentRecoveryRecord) => record.epoch === target.epoch
    || Boolean(sessions.get(scope(target))?.claimed.has(recordKey(record)))
  const readFile = async (file: string): Promise<FlowDocumentRecoveryRecord | null> => {
    try { return flowDocumentRecoverySchema.parse(JSON.parse(await fs.readFile(file, 'utf8'))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  }
  const writeFile = async (file: string, record: FlowDocumentRecoveryRecord, beforePublish?: () => void) => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, JSON.stringify(record), { flag: 'wx' })
      beforePublish?.()
      await fs.rename(temporary, file)
    } finally { await fs.rm(temporary, { force: true }) }
  }
  const retain = async (record: FlowDocumentRecoveryRecord) => {
    const id = createHash('sha256').update(recordKey(record)).digest('hex')
    const file = path.join(root, 'retained', `${storageKey(record)}-${id}.json`)
    if (!await readFile(file)) await writeFile(file, record)
  }
  const listRetained = async (target: FlowDocumentRecoveryIdentity) => {
    let names: string[]
    try { names = await fs.readdir(path.join(root, 'retained')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    const records: FlowDocumentRecoveryRecord[] = []
    for (const name of names.filter(value => value.startsWith(`${storageKey(target)}-`) && value.endsWith('.json'))) {
      const record = await readFile(path.join(root, 'retained', name))
      if (record && flowRecoveryStorageIdentity(record) === flowRecoveryStorageIdentity(target)) records.push(record)
    }
    return records.sort((a, b) => b.revision - a.revision)
  }
  const serialize = <T>(action: () => Promise<T>): Promise<T> => {
    const pending = queue.then(action, action)
    queue = pending.catch(() => undefined)
    return pending
  }
  const operate = (request: unknown) => {
    const input = requestSchema.parse(request)
    const target = input.operation === 'write' ? input.record : input.target
    if (target.projectPath !== null && !path.isAbsolute(target.projectPath) && !path.win32.isAbsolute(target.projectPath)) throw new Error('正文恢复稿需要绝对工程路径')
    if (input.operation === 'read') {
      const current = sessions.get(scope(target)), next = binding(target)
      if (current?.retired.has(next)) throw new Error('正文恢复稿会话已失效')
      if (current && current.binding !== next) current.retired.add(current.binding)
      sessions.set(scope(target), { binding: next, documentEpoch: target.documentEpoch,
        retired: current?.retired ?? new Set(), claimed: current?.documentEpoch === target.documentEpoch ? current?.claimed ?? new Set() : new Set() })
    }
    return serialize(async () => {
      assertActive(target)
      if (input.operation === 'retained') return listRetained(target)
      const record = await readFile(filename(target))
      if (record && flowRecoveryStorageIdentity(record) !== flowRecoveryStorageIdentity(target)) throw new Error('正文恢复稿目标不一致')
      if (input.operation === 'read') {
        if (record && target.revision !== undefined && record.revision !== target.revision) await retain(record)
        assertActive(target)
        return record
      }
      if (input.operation === 'claim') {
        if (record && record.epoch === input.recordEpoch && record.revision === input.revision)
          sessions.get(scope(target))!.claimed.add(recordKey(record))
        return
      }
      if (input.operation === 'clear') {
        if (record && owns(target, record)) { assertActive(target); await fs.rm(filename(target), { force: true }) }
        return
      }
      if (record && (record.revision !== input.record.revision || !owns(target, record))) await retain(record)
      await writeFile(filename(target), input.record, () => assertActive(target))
    })
  }
  const discardDocument = (target: FlowRecoveryDocumentIdentity) => {
    const session = sessions.get(scope(target))
    const claimed = session?.documentEpoch === target.epoch ? new Set(session.claimed) : new Set<string>()
    if (session?.documentEpoch === target.epoch) { session.retired.add(session.binding); session.binding = '' }
    return serialize(async () => {
      let names: string[]
      try { names = await fs.readdir(root) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
      for (const name of names.filter(value => value.endsWith('.json'))) {
        const file = path.join(root, name), record = await readFile(file)
        if (record && scope(record) === scope(target) && (record.documentEpoch === target.epoch || claimed.has(recordKey(record))))
          await fs.rm(file, { force: true })
      }
    })
  }
  return Object.assign(operate, { discardDocument })
}
let store: ReturnType<typeof createFlowDocumentRecoveryStore> | undefined
function recoveryStore() {
  return store ??= createFlowDocumentRecoveryStore(path.join(app.getPath('userData'), 'flow-document-recovery', 'v1'))
}
export function operateFlowDocumentRecovery(request: unknown) { return recoveryStore()(request) }
export function discardFlowDocumentRecovery(target: FlowRecoveryDocumentIdentity) { return recoveryStore().discardDocument(target) }
