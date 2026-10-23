import { useCallback, useEffect, useRef, useState } from 'react'
import { recoverFlowDocumentDraft, serializeFlowDocumentRecovery, type FlowDocumentDraft, type FlowDocumentRecoveryPort, type FlowDocumentRecoveryTarget, type FlowDocumentRecoveryCandidate } from '../authoring/flowDocumentDraft'

function recoveryActivationKey(target: FlowDocumentRecoveryTarget): string {
  return JSON.stringify([target.documentId, target.surfaceId, target.epoch])
}

function createRecoveryIdentity(target: FlowDocumentRecoveryTarget): FlowDocumentRecoveryTarget {
  return { ...target, epoch: crypto.randomUUID(), documentEpoch: target.epoch }
}

interface FlowDocumentRecoveryOptions {
  target: FlowDocumentRecoveryTarget | null
  draft: FlowDocumentDraft | null | undefined
  port: FlowDocumentRecoveryPort | null
  /** True only when this provider actually accepted the raw input. */
  onRestore(draft: FlowDocumentDraft): boolean
  onError(message: string): void
}
export interface FlowDocumentRecoveryEntry {
  target: FlowDocumentRecoveryTarget
  draft: FlowDocumentDraft
}
/** Serial provider IO shares the document host's stable recovery owner. */
export function useFlowDocumentRecovery(options: FlowDocumentRecoveryOptions): {
  retained: readonly FlowDocumentRecoveryCandidate[]
  flush(): Promise<boolean>
  flushAll(entries: readonly FlowDocumentRecoveryEntry[], options?: { retain?: boolean }): Promise<boolean>
  suspendForClose(epochs: readonly (string | number)[]): void
  resumeAfterCloseCancelled(epochs: readonly (string | number)[]): void
} {
  const [retained, setRetained] = useState<FlowDocumentRecoveryCandidate[]>([])
  const [resumeVersion, setResumeVersion] = useState(0)
  const suspended = useRef(new Set<string | number>())
  const activation = useRef<{ key: string; identity: FlowDocumentRecoveryTarget } | null>(null)
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
  const isCurrent = useCallback((target: FlowDocumentRecoveryTarget) => (
    latest.current.identity !== null
      && target.documentId === latest.current.identity.documentId
      && target.surfaceId === latest.current.identity.surfaceId
      && target.epoch === latest.current.identity.epoch
  ), [])
  const settle = useCallback((target: FlowDocumentRecoveryTarget, error: unknown) => {
    if (!isCurrent(target) || target.documentEpoch !== undefined && suspended.current.has(target.documentEpoch)) return
    failed.current = true
    report(error)
  }, [isCurrent, report])
  const enqueue = useCallback((operation: () => Promise<void>, target: FlowDocumentRecoveryTarget) => {
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
      const records = await port.read(identity)
      if (!active || !isCurrent(identity) || suspended.current.has(target.epoch)) return
      setRetained(records)
      if (latest.current.options.target?.revision !== target.revision) return
      const candidates = records.filter(record => record.projectId === target.projectId && record.surfaceId === target.surfaceId && record.revision === target.revision)
      const currentDraft = latest.current.options.draft
      if (currentDraft) {
        // This provider already holds the same raw source. Its current
        // diagnostics and IME state remain authoritative after adoption.
        const held = candidates.filter(record => record.source === currentDraft.source && record.surfaceId === currentDraft.surfaceId && record.revision === currentDraft.revision)
        for (const record of held) {
          if (!active || !isCurrent(identity) || suspended.current.has(target.epoch)) return
          await port.claim(identity, record)
          if (active && isCurrent(identity)) setRetained(current => current.filter(value => value.recovery.id !== record.recovery.id || value.recovery.digest !== record.recovery.digest))
        }
        return
      }
      if (candidates.length !== 1) {
        if (records.length) report(new Error(candidates.length > 1 ? '存在多份不同正文原稿，已保留供查看；当前内容可以正常保存。' : '旧版本正文恢复稿已保留，可查看原文；当前内容可以正常保存。'))
        return
      }
      const record = candidates[0]!
      try {
        const restored = recoverFlowDocumentDraft(record, target)
        if (!latest.current.options.onRestore(restored)) return
        if (!active || !isCurrent(identity) || suspended.current.has(target.epoch)) return
        // The host persists the selected raw under this document before
        // consuming its former owner. Other candidates remain unclaimed.
        await port.claim(identity, record)
        if (active && isCurrent(identity)) setRetained(records.filter(value => value.recovery.id !== record.recovery.id))
      } catch (error) { if (active && isCurrent(identity)) report(error) }
    })
    // Reading candidates is a diagnostic, not failure to persist current input.
    writes.current = registration.catch(error => { if (active && isCurrent(identity)) report(error) })
    return () => { active = false }
    // Source edits must not trigger a fresh read of an older disk draft.
  }, [activationKey, options.port, identity, isCurrent, report])

  useEffect(() => {
    const { target, draft, port } = options
    if (!target || !port || !identity) { previous.current = null; return }
    if (suspended.current.has(target.epoch)) return
    const currentIdentity = { ...identity, projectPath: target.projectPath, revision: target.revision }
    if (draft && draft.surfaceId === target.surfaceId && draft.revision === target.revision) {
      const record = serializeFlowDocumentRecovery(currentIdentity, draft)
      enqueue(() => port.write(record, currentIdentity), identity)
      previous.current = { key: activationKey, hadDraft: true }
    } else {
      if (previous.current?.key === activationKey && previous.current.hadDraft && !draft) {
        enqueue(() => port.clear(currentIdentity), identity)
      }
      previous.current = { key: activationKey, hadDraft: false }
    }
  }, [activationKey, identity, options.target?.revision, options.target?.projectPath, options.draft, options.port, enqueue, resumeVersion])

  return {
    retained,
    suspendForClose: useCallback(epochs => { for (const epoch of epochs) suspended.current.add(epoch) }, []),
    resumeAfterCloseCancelled: useCallback(epochs => { for (const epoch of epochs) suspended.current.delete(epoch); setResumeVersion(value => value + 1) }, []),
    flush: useCallback(async () => { await writes.current; return !failed.current }, []),
    flushAll: useCallback(async (entries: readonly FlowDocumentRecoveryEntry[], options?: { retain?: boolean }) => {
      const frozen = structuredClone(entries), port = latest.current.options.port
      if (!frozen.length) { await writes.current; return true }
      if (!port) { report(new Error('正文恢复服务不可用，输入仍保留')); return false }
      let complete = true
      const pending = writes.current.then(async () => {
        const identities = new Map<string, FlowDocumentRecoveryTarget>()
        for (const { target, draft } of frozen) {
          if (suspended.current.has(target.epoch)) continue
          const active = latest.current.identity
          const bindingKey = recoveryActivationKey(target)
          const activeIdentity = active && active.documentId === target.documentId && active.surfaceId === target.surfaceId && active.documentEpoch === target.epoch ? active : undefined
          const existingIdentity = activeIdentity ?? identities.get(bindingKey)
          const recoveryIdentity = existingIdentity ?? createRecoveryIdentity(target)
          // Background surfaces need the same unadopted-candidate protection
          // before their current input replaces this provider's active slice.
          if (!existingIdentity) {
            const records = await port.read(recoveryIdentity)
            for (const record of records.filter(record => record.projectId === target.projectId && record.surfaceId === draft.surfaceId && record.revision === draft.revision && record.source === draft.source))
              await port.claim(recoveryIdentity, record)
          }
          identities.set(bindingKey, recoveryIdentity)
          const currentIdentity = { ...recoveryIdentity, projectPath: target.projectPath, revision: target.revision }
          const record = serializeFlowDocumentRecovery(currentIdentity, draft)
          await port.write(record, currentIdentity)
          if (options?.retain) {
            if (!port.retain) throw new Error('正文原稿保留服务尚未连接，当前输入继续保留')
            await port.retain(record, currentIdentity)
            const retained = await port.read(currentIdentity)
            if (isCurrent(recoveryIdentity)) setRetained(retained)
          }
          if (isCurrent(recoveryIdentity)) failed.current = false
        }
      }).catch(error => { complete = false; report(error) })
      writes.current = pending
      await pending
      return complete && !failed.current
    }, [report, isCurrent]),
  }
}
