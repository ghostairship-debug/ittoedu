import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FileArtifactBinding } from '../../../shared/workbench/mediaFiles'
import type { ArtifactHistoryChange, ArtifactHistorySnapshot } from '../FileArtifactHistory'

export interface OfficeDraft {
  sessionId: string
  base: FileArtifactBinding
  baseVersion: string
  binding: FileArtifactBinding
  bytes?: Uint8Array
  original?: Uint8Array
  dirty: boolean
  saving: boolean
  saveOutcomeUnknown?: boolean
  recoveryBinding?: FileArtifactBinding
  recoveryVersion?: string
  offset: number
  branchOffset: number
  history: Map<number, ArtifactHistorySnapshot>
  observations: Map<string, WeakRef<Uint8Array>>
  past: ArtifactHistoryChange[]
  future: ArtifactHistoryChange[]
}

const key = (filename: string) => process.platform === 'win32' ? path.normalize(filename).toLowerCase() : path.normalize(filename)
const same = (a: FileArtifactBinding, b: FileArtifactBinding) =>
  key(a.path) === key(b.path) && a.fileVersion === b.fileVersion && a.bindingVersion === b.bindingVersion
const owners = new WeakMap<object, Map<string, OfficeDraft>>()
type DraftOwner = object & { nextOfficeDraftVersion?(): number }
const observedKey = (binding: FileArtifactBinding) => `${binding.fileVersion}:${binding.bindingVersion}`
const cleanup = new FinalizationRegistry<{ observations: OfficeDraft['observations']; key: string; reference: WeakRef<Uint8Array> }>(
  ({ observations, key, reference }) => { if (observations.get(key) === reference) observations.delete(key) },
)

export function officeDraftSession(fileVersion: string | undefined): string | undefined {
  const parts = fileVersion?.split(':')
  return parts?.length === 3 && parts[0] === 'office-draft' ? parts[1] : undefined
}

function draftBinding(owner: DraftOwner, base: FileArtifactBinding, sessionId: string, previous = base.bindingVersion): FileArtifactBinding {
  return { ...base, fileVersion: `office-draft:${sessionId}:${randomUUID()}`,
    bindingVersion: owner.nextOfficeDraftVersion?.() ?? Math.max(previous, base.bindingVersion) + 1 }
}

export function officeDrafts(owner: object) {
  let drafts = owners.get(owner)
  if (!drafts) { drafts = new Map(); owners.set(owner, drafts) }
  return drafts
}

export function findOfficeDraft(owner: object, filename: string) {
  return officeDrafts(owner).get(key(filename))
}

export function openOfficeDraft(owner: DraftOwner, base: FileArtifactBinding) {
  const existing = findOfficeDraft(owner, base.path)
  if (existing) {
    if (existing.dirty || existing.saving || same(existing.base, base)) return existing
  }
  const sessionId = randomUUID(), binding = draftBinding(owner, base, sessionId)
  const draft: OfficeDraft = { sessionId, base, baseVersion: base.fileVersion, binding, dirty: false, saving: false,
    offset: 0, branchOffset: 0, history: new Map(), observations: new Map(), past: [], future: [] }
  officeDrafts(owner).set(key(base.path), draft)
  return draft
}

export function assertOfficeDraft(owner: object, draft: OfficeDraft, binding: FileArtifactBinding) {
  if (findOfficeDraft(owner, binding.path) !== draft || !same(draft.binding, binding) || draft.saving)
    throw new OfficeDraftUpdatedError()
}

export class OfficeDraftUpdatedError extends Error {
  constructor() { super('Office 草稿已更新，请重新读取后修改。') }
}

export function assertOfficeDraftSession(owner: object, draft: OfficeDraft, binding: FileArtifactBinding) {
  if (findOfficeDraft(owner, binding.path) !== draft || officeDraftSession(binding.fileVersion) !== draft.sessionId)
    throw new Error('Office 草稿会话已改变，请重新打开或读取后修改。')
  if (draft.saving) throw new Error('Office 草稿正在保存，请等待保存结束后继续。')
}

export function readOfficeDraftObservation(draft: OfficeDraft, binding: FileArtifactBinding): Uint8Array | undefined {
  return same(draft.binding, binding) ? draft.bytes : draft.observations.get(observedKey(binding))?.deref()
}

export function advanceOfficeDraft(owner: DraftOwner, draft: OfficeDraft, bytes: Uint8Array, dirty: boolean) {
  if (draft.bytes) {
    const key = observedKey(draft.binding), reference = new WeakRef(draft.bytes)
    draft.observations.set(key, reference)
    cleanup.register(draft.bytes, { observations: draft.observations, key, reference })
  }
  draft.binding = draftBinding(owner, draft.base, draft.sessionId, draft.binding.bindingVersion)
  draft.bytes = bytes
  draft.dirty = dirty
}

export function closeOfficeDraft(owner: object, filename: string) {
  const draft = findOfficeDraft(owner, filename)
  if (draft?.saving) throw new Error('Office 文件仍在保存，请等待完成。')
  officeDrafts(owner).delete(key(filename))
}

export function relocateOfficeDraft(owner: object, previous: FileArtifactBinding, base: FileArtifactBinding) {
  const draft = findOfficeDraft(owner, previous.path)
  if (!draft) return
  officeDrafts(owner).delete(key(previous.path))
  const before = draft.binding
  draft.base = base
  draft.binding = { ...base, fileVersion: before.fileVersion }
  if (draft.recoveryBinding && key(draft.recoveryBinding.path) === key(previous.path))
    draft.recoveryBinding = { ...base }
  officeDrafts(owner).set(key(base.path), draft)
  return { before, binding: draft.binding }
}
