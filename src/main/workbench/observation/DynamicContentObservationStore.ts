/** @deprecated Historical V9/CLI consumer only; current production uses Project V10 and the canonical Gateway. */
import { lightEditTextOverrideSchema } from '../../../shared/contracts/runtime/lightEdit'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import type { DynamicContentObservedTarget, DynamicContentTargetsPublication } from '../../../shared/workbench/dynamicContentTargets'

export interface DynamicContentPublication extends DynamicContentTargetsPublication {
  readonly senderId: number
}

export interface DynamicContentReadIdentity {
  readonly documentId: string
  readonly epoch: string
  readonly revision: number
  readonly locationId: string
}

interface ActivePublication extends DynamicContentReadIdentity {
  readonly viewGeneration: string
  readonly source: DynamicContentPublication['source']
  readonly targets: readonly DynamicContentObservedTarget[]
  readonly truncatedItemIds?: readonly string[]
}

interface SenderDocumentState {
  maxSeq: number
  retiredGenerations: Set<string>
  lastGeneration: string | null
  active: ActivePublication | null
}

function shortString(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
}

function normalizeTarget(value: unknown, publication: DynamicContentPublication): DynamicContentObservedTarget | null {
  if (!value || typeof value !== 'object') return null
  const hit = value as Record<string, unknown>
  if (hit.source !== 'auto' || hit.revision !== publication.revision
    || hit.locationId !== publication.locationId || !shortString(hit.itemId)) return null
  if (hit.kind === 'runtime.text' || hit.kind === 'component.text') {
    const rule = lightEditTextOverrideSchema.safeParse({ original: hit.original,
      ...(hit.region === undefined ? {} : { region: hit.region }), text: hit.text })
    if (!rule.success) return null
    return { kind: hit.kind, source: 'auto', revision: publication.revision,
      locationId: publication.locationId, itemId: hit.itemId, original: rule.data.original,
      ...(rule.data.region === undefined ? {} : { region: rule.data.region }), text: rule.data.text }
  }
  if (hit.kind === 'component.image' && shortString(hit.assetKey, 200)
    && !['__proto__', 'prototype', 'constructor'].includes(hit.assetKey)) {
    return { kind: 'component.image', source: 'auto', revision: publication.revision,
      locationId: publication.locationId, itemId: hit.itemId, assetKey: hit.assetKey }
  }
  return null
}

function sameIdentity(a: DynamicContentReadIdentity, b: DynamicContentReadIdentity): boolean {
  return a.documentId === b.documentId && a.epoch === b.epoch
    && a.revision === b.revision && a.locationId === b.locationId
}

/** Main-only transient cache for M15 host hits. It cannot grant write authority. */
export class DynamicContentObservationStore {
  private readonly senders = new Map<number, Map<string, SenderDocumentState>>()
  private readonly documentBarriers = new Map<string, number>()
  private readonly senderBarriers = new Map<number, number>()

  constructor(private readonly snapshot: (documentId: string) => Promise<DocumentSnapshot | null>) {}

  private state(senderId: number, documentId: string): SenderDocumentState {
    let documents = this.senders.get(senderId)
    if (!documents) { documents = new Map(); this.senders.set(senderId, documents) }
    let state = documents.get(documentId)
    if (!state) { state = { maxSeq: -1, retiredGenerations: new Set(), lastGeneration: null, active: null }; documents.set(documentId, state) }
    return state
  }

  /** False means the message is stale, malformed, or no longer belongs to the formal document. */
  async publish(publication: DynamicContentPublication): Promise<boolean> {
    if (!Number.isSafeInteger(publication.senderId) || publication.senderId < 1
      || !shortString(publication.documentId) || !shortString(publication.epoch)
      || !Number.isSafeInteger(publication.revision) || publication.revision < 0
      || !shortString(publication.locationId) || !shortString(publication.viewGeneration, 200)
      || !Number.isSafeInteger(publication.publicationSeq) || publication.publicationSeq < 0
      || publication.source !== 'authoring' && publication.source !== 'live'
      || !Array.isArray(publication.targets)) return false
    const targets = publication.targets.map(hit => normalizeTarget(hit, publication))
    if (targets.some(hit => !hit)) return false
    const documentBarrier = this.documentBarriers.get(publication.documentId) ?? 0
    const senderBarrier = this.senderBarriers.get(publication.senderId) ?? 0
    let snapshot: DocumentSnapshot | null
    try { snapshot = await this.snapshot(publication.documentId) } catch { return false }
    if (documentBarrier !== (this.documentBarriers.get(publication.documentId) ?? 0)
      || senderBarrier !== (this.senderBarriers.get(publication.senderId) ?? 0)
      || !snapshot || snapshot.documentId !== publication.documentId
      || snapshot.epoch !== publication.epoch || snapshot.revision !== publication.revision
      || snapshot.model.kind !== 'course-v9' || snapshot.model.project.revision !== snapshot.revision
      || !snapshot.model.project.locations.some(location => location.id === publication.locationId)) return false
    const state = this.state(publication.senderId, publication.documentId)
    if (publication.publicationSeq <= state.maxSeq
      || state.retiredGenerations.has(publication.viewGeneration)) return false
    if (state.lastGeneration && state.lastGeneration !== publication.viewGeneration)
      state.retiredGenerations.add(state.lastGeneration)
    state.maxSeq = publication.publicationSeq
    state.lastGeneration = publication.viewGeneration
    state.active = {
      documentId: publication.documentId, epoch: publication.epoch, revision: publication.revision,
      locationId: publication.locationId, viewGeneration: publication.viewGeneration,
      source: publication.source, targets: targets as DynamicContentObservedTarget[],
      ...(Array.isArray(publication.truncatedItemIds) ? {
        truncatedItemIds: publication.truncatedItemIds.filter(value => shortString(value)),
      } : {}),
    }
    return true
  }

  /** Rechecks the canonical snapshot; callers still pass each hit through the core target planner. */
  async read(identity: DynamicContentReadIdentity): Promise<{
    targets: DynamicContentObservedTarget[]; truncatedItemIds?: readonly string[]
  }> {
    let snapshot: DocumentSnapshot | null
    try { snapshot = await this.snapshot(identity.documentId) } catch { return { targets: [] } }
    if (!snapshot || snapshot.documentId !== identity.documentId || snapshot.epoch !== identity.epoch
      || snapshot.revision !== identity.revision || snapshot.model.kind !== 'course-v9'
      || snapshot.model.project.revision !== snapshot.revision
      || !snapshot.model.project.locations.some(location => location.id === identity.locationId)) return { targets: [] }
    const result: DynamicContentObservedTarget[] = []
    const truncatedItemIds = new Set<string>()
    for (const documents of this.senders.values()) {
      const state = documents.get(identity.documentId)
      if (!state?.active || !sameIdentity(state.active, identity)) continue
      result.push(...state.active.targets.map(hit => ({ ...hit })))
      for (const itemId of state.active.truncatedItemIds ?? []) truncatedItemIds.add(itemId)
    }
    return { targets: result, ...(truncatedItemIds.size ? { truncatedItemIds: [...truncatedItemIds] } : {}) }
  }

  private retire(state: SenderDocumentState): void {
    if (state.lastGeneration) state.retiredGenerations.add(state.lastGeneration)
    state.active = null
  }

  /** Called on sender teardown or view replacement. Old generation messages remain tombstoned. */
  clearSender(senderId: number): void {
    this.senderBarriers.set(senderId, (this.senderBarriers.get(senderId) ?? 0) + 1)
    for (const state of this.senders.get(senderId)?.values() ?? []) this.retire(state)
  }

  /** Called on formal change/Undo/close. Same mounted view may publish the new revision. */
  clearDocument(documentId: string): void {
    this.documentBarriers.set(documentId, (this.documentBarriers.get(documentId) ?? 0) + 1)
    for (const documents of this.senders.values()) {
      const state = documents.get(documentId)
      if (state) state.active = null
    }
  }
}
