import { flowRecoveryStorageIdentity, type FlowDocumentRecoveryIdentity } from '../../shared/flowDocumentRecovery'
import { useCallback, useEffect, useRef } from 'react'
import { recoverFlowDocumentDraft, serializeFlowDocumentRecovery, type FlowDocumentDraft, type FlowDocumentRecoveryPort, type FlowDocumentRecoveryTarget } from '../authoring/flowDocumentDraft'

function recoveryActivationKey(target: FlowDocumentRecoveryTarget): string {
  return JSON.stringify([flowRecoveryStorageIdentity(target), target.epoch])
}

function createRecoveryIdentity(target: FlowDocumentRecoveryTarget): FlowDocumentRecoveryIdentity {
  return { projectId: target.projectId, projectPath: target.projectPath, surfaceId: target.surfaceId, epoch: crypto.randomUUID() }
}

interface FlowDocumentRecoveryOptions {
  target: FlowDocumentRecoveryTarget | null
  draft: FlowDocumentDraft | null | undefined
  port: FlowDocumentRecoveryPort | null
  onRestore(draft: FlowDocumentDraft): void
  onError(message: string): void
}
/** Serial writes keep late recovery IO bound to its original project and surface. */
export function useFlowDocumentRecovery(options: FlowDocumentRecoveryOptions): { flush(): Promise<boolean> } {
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
    if (!isCurrent(target)) return
    failed.current = true
    report(error)
  }, [isCurrent, report])
  const enqueue = useCallback((operation: () => Promise<void>, target: FlowDocumentRecoveryIdentity) => {
    writes.current = writes.current.then(operation).then(
      () => { if (isCurrent(target)) failed.current = false },
      error => settle(target, error),
    )
  }, [isCurrent, settle])

  useEffect(() => {
    const { target, port } = options
    if (!target || !port || !identity) return
    failed.current = false
    let active = true
    const registration = writes.current.then(() => port.read(identity))
    writes.current = registration.then(() => undefined, error => settle(identity, error))
    void registration.then(record => {
      if (!active || !record || latest.current.options.draft || !isCurrent(identity) || latest.current.options.target?.revision !== target.revision) return
      try {
        latest.current.options.onRestore(recoverFlowDocumentDraft(record, target))
      } catch (error) {
        settle(identity, error)
      }
    }, () => undefined)
    return () => { active = false }
    // Source edits must not trigger a fresh read of an older disk draft.
  }, [activationKey, options.port, identity, isCurrent, report])

  useEffect(() => {
    const { target, draft, port } = options
    if (!target || !port || !identity) { previous.current = null; return }
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
  }, [activationKey, identity, options.target?.revision, options.draft, options.port, enqueue])

  return { flush: useCallback(async () => { await writes.current; return !failed.current }, []) }
}
