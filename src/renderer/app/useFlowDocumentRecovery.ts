import { flowRecoveryStorageIdentity, type FlowDocumentRecoveryIdentity } from '../../shared/flowDocumentRecovery'
import { useCallback, useEffect, useRef, useState } from 'react'
import { recoverFlowDocumentDraft, serializeFlowDocumentRecovery, type FlowDocumentDraft, type FlowDocumentRecoveryPort, type FlowDocumentRecoveryTarget, type FlowDocumentRecoveryRecord } from '../authoring/flowDocumentDraft'

function recoveryActivationKey(target: FlowDocumentRecoveryTarget): string {
  return JSON.stringify([flowRecoveryStorageIdentity(target), target.epoch])
}

function createRecoveryIdentity(target: FlowDocumentRecoveryTarget): FlowDocumentRecoveryIdentity {
  return { projectId: target.projectId, projectPath: target.projectPath, surfaceId: target.surfaceId, epoch: crypto.randomUUID(), documentEpoch: target.epoch, revision: target.revision }
}

interface FlowDocumentRecoveryOptions {
  target: FlowDocumentRecoveryTarget | null
  draft: FlowDocumentDraft | null | undefined
  port: FlowDocumentRecoveryPort | null
  onRestore(draft: FlowDocumentDraft): void
  onError(message: string): void
}
export interface FlowDocumentRecoveryEntry {
  target: FlowDocumentRecoveryTarget
  draft: FlowDocumentDraft
}
/** Serial writes keep late recovery IO bound to its original project and surface. */
export function useFlowDocumentRecovery(options: FlowDocumentRecoveryOptions): {
  retained: readonly FlowDocumentRecoveryRecord[]
  flush(): Promise<boolean>
  flushAll(entries: readonly FlowDocumentRecoveryEntry[]): Promise<boolean>
  suspendForClose(epochs: readonly (string | number)[]): void
  resumeAfterCloseCancelled(epochs: readonly (string | number)[]): void
} {
  const [retained, setRetained] = useState<FlowDocumentRecoveryRecord[]>([])
  const [resumeVersion, setResumeVersion] = useState(0)
  const suspended = useRef(new Set<string | number>())
  const activation = useRef<{ key: string; identity: FlowDocumentRecoveryIdentity } | null>(null)
  const activationKey = options.target ? recoveryActivationKey(options.target) : ''
  if (!options.target) activation.current = null
  else if (activation.current?.key !== activationKey) {
    activation.current = { key: activationKey, identity: createRecoveryIdentity(options.target) }
  }
  const identity = activation.current?.identity ?? null
  const latest = useRef({ options, identity })
  latest.current = { options, identity }
  const writes = useRef<Promise<void>>(Promise.resolve())
  const failed = useRef(false)
  const previous = useRef<{ key: string; hadDraft: boolean } | null>(null)
  const report = useCallback((error: unknown) => latest.current.options.onError(error instanceof Error ? error.message : '无法保存正文恢复稿'), [])
  const isCurrent = useCallback((target: FlowDocumentRecoveryIdentity) => (
    latest.current.identity !== null
      && flowRecoveryStorageIdentity(target) === flowRecoveryStorageIdentity(latest.current.identity)
      && target.epoch === latest.current.identity.epoch
  ), [])
  const settle = useCallback((target: FlowDocumentRecoveryIdentity, error: unknown) => {
    if (!isCurrent(target) || target.documentEpoch !== undefined && suspended.current.has(target.documentEpoch)) return
    failed.current = true
    report(error)
  }, [isCurrent, report])
  const enqueue = useCallback((operation: () => Promise<void>, target: FlowDocumentRecoveryIdentity) => {
    writes.current = writes.current.then(() => {
      if (target.documentEpoch === undefined || !suspended.current.has(target.documentEpoch)) return operation()
    }).then(
      () => { if (isCurrent(target)) failed.current = false },
      error => settle(target, error),
    )
  }, [isCurrent, settle])

  useEffect(() => {
    const { target, port } = options
    setRetained([])
    if (!target || !port || !identity || suspended.current.has(target.epoch)) return
    failed.current = false
    let active = true
    const registration = writes.current.then(async () => {
      if (suspended.current.has(target.epoch)) return
      const record = await port.read(identity)
      const older = await port.retained?.(identity) ?? []
      if (!active || !isCurrent(identity) || suspended.current.has(target.epoch)) return
      setRetained(older)
      if (!record || latest.current.options.draft || latest.current.options.target?.revision !== target.revision) return
      try {
        const restored = recoverFlowDocumentDraft(record, target)
        await port.claim?.(identity, record.epoch, record.revision)
        if (active && isCurrent(identity) && !suspended.current.has(target.epoch) && !latest.current.options.draft)
          latest.current.options.onRestore(restored)
      } catch (error) {
        setRetained(current => current.some(value => value.epoch === record.epoch && value.revision === record.revision) ? current : [...current, record])
        report(error)
      }
    })
    // Reading an old record is a diagnostic, not failure to persist current input.
    writes.current = registration.catch(error => { if (active && isCurrent(identity)) report(error) })
    return () => { active = false }
    // Source edits must not trigger a fresh read of an older disk draft.
  }, [activationKey, options.port, identity, isCurrent, report])

  useEffect(() => {
    const { target, draft, port } = options
    if (!target || !port || !identity) { previous.current = null; return }
    if (suspended.current.has(target.epoch)) return
    if (draft && draft.surfaceId === target.surfaceId && draft.revision === target.revision) {
      const record = serializeFlowDocumentRecovery({ ...identity, revision: target.revision }, draft)
      enqueue(() => port.write(record), identity)
      previous.current = { key: activationKey, hadDraft: true }
    } else {
      if (previous.current?.key === activationKey && previous.current.hadDraft && !draft) {
        enqueue(() => port.clear(identity), identity)
      }
      previous.current = { key: activationKey, hadDraft: false }
    }
  }, [activationKey, identity, options.target?.revision, options.draft, options.port, enqueue, resumeVersion])

  return {
    retained,
    suspendForClose: useCallback(epochs => { for (const epoch of epochs) suspended.current.add(epoch) }, []),
    resumeAfterCloseCancelled: useCallback(epochs => { for (const epoch of epochs) suspended.current.delete(epoch); setResumeVersion(value => value + 1) }, []),
    flush: useCallback(async () => { await writes.current; return !failed.current }, []),
    flushAll: useCallback(async (entries: readonly FlowDocumentRecoveryEntry[]) => {
      // Use the same serialized IO owner as the active view. A background draft
      // must not retire the active view's recovery epoch while closing the window.
      const frozen = structuredClone(entries), port = latest.current.options.port
      if (!frozen.length) { await writes.current; return true }
      if (!port) { report(new Error('正文恢复服务不可用，输入仍保留')); return false }
      let complete = true
      const pending = writes.current.then(async () => {
        const identities = new Map<string, FlowDocumentRecoveryIdentity>()
        for (const { target, draft } of frozen) {
          if (suspended.current.has(target.epoch)) continue
          const active = latest.current.identity
          let recoveryIdentity: FlowDocumentRecoveryIdentity
          if (active && active.projectId === target.projectId && active.projectPath === target.projectPath && active.documentEpoch === target.epoch) recoveryIdentity = active
          else {
            const bindingKey = JSON.stringify([target.projectId, target.projectPath])
            const retained = identities.get(bindingKey)
            if (retained) recoveryIdentity = retained
            else {
              recoveryIdentity = createRecoveryIdentity(target)
              await port.read(recoveryIdentity)
              identities.set(bindingKey, recoveryIdentity)
            }
          }
          await port.write(serializeFlowDocumentRecovery({ ...recoveryIdentity, revision: target.revision }, draft))
          if (isCurrent(recoveryIdentity)) failed.current = false
        }
      }).catch(error => { complete = false; report(error) })
      writes.current = pending
      await pending
      return complete && !failed.current
    }, [report, isCurrent]),
  }
}
