import { app } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { flowDocumentRecoverySchema, flowDocumentRecoveryTargetSchema, flowRecoveryStorageIdentity, normalizedFlowRecoveryPath, type FlowDocumentRecoveryIdentity } from '../shared/flowDocumentRecovery'
const requestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('read'), target: flowDocumentRecoveryTargetSchema }).strict(),
  z.object({ operation: z.literal('clear'), target: flowDocumentRecoveryTargetSchema }).strict(),
  z.object({ operation: z.literal('write'), record: flowDocumentRecoverySchema }).strict(),
])

/** One serialized disk owner, with ephemeral session fences independent of persisted epochs. */
export function createFlowDocumentRecoveryStore(root: string) {
  let queue: Promise<unknown> = Promise.resolve()
  const sessions = new Map<string, { binding: string; retired: Set<string> }>()
  const scope = (target: FlowDocumentRecoveryIdentity) => JSON.stringify([target.projectId])
  const binding = (target: FlowDocumentRecoveryIdentity) => JSON.stringify([target.projectPath === null ? `unsaved:${target.projectId}` : normalizedFlowRecoveryPath(target.projectPath), target.epoch])
  const assertActive = (target: FlowDocumentRecoveryIdentity) => {
    if (sessions.get(scope(target))?.binding !== binding(target)) throw new Error('正文恢复稿会话已失效')
  }
  return function operate(request: unknown) {
    const input = requestSchema.parse(request)
    const target = input.operation === 'write' ? input.record : input.target
    if (target.projectPath !== null && !path.isAbsolute(target.projectPath) && !path.win32.isAbsolute(target.projectPath)) throw new Error('正文恢复稿需要绝对工程路径')
    // Register before queueing IO so a new read invalidates already queued old writes.
    if (input.operation === 'read') {
      const current = sessions.get(scope(target))
      const next = binding(target)
      if (current?.retired.has(next)) throw new Error('正文恢复稿会话已失效')
      if (current && current.binding !== next) current.retired.add(current.binding)
      sessions.set(scope(target), { binding: next, retired: current?.retired ?? new Set() })
    }
    const action = async () => {
      assertActive(target)
      const identity = flowRecoveryStorageIdentity(target)
      const filename = path.join(root, `${createHash('sha256').update(identity).digest('hex')}.json`)
      if (input.operation === 'clear') { assertActive(target); await fs.rm(filename, { force: true }); return }
      if (input.operation === 'read') {
        try {
          const result = flowDocumentRecoverySchema.parse(JSON.parse(await fs.readFile(filename, 'utf8')))
          assertActive(target)
          if (flowRecoveryStorageIdentity(result) !== identity) throw new Error('正文恢复稿目标不一致')
          return result // Its persisted epoch may belong to a previous app run.
        } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
      }
      await fs.mkdir(root, { recursive: true })
      const temporary = `${filename}.${randomUUID()}.tmp`
      try {
        await fs.writeFile(temporary, JSON.stringify(input.record), { flag: 'wx' })
        assertActive(target)
        await fs.rename(temporary, filename)
      } finally { await fs.rm(temporary, { force: true }) }
    }
    const pending = queue.then(action, action)
    queue = pending.catch(() => {})
    return pending
  }
}
let store: ReturnType<typeof createFlowDocumentRecoveryStore> | undefined
export function operateFlowDocumentRecovery(request: unknown) {
  store ??= createFlowDocumentRecoveryStore(path.join(app.getPath('userData'), 'flow-document-recovery', 'v1'))
  return store(request)
}
