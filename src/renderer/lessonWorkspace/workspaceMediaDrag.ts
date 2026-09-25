import type { WorkspaceFilesAPI, WorkspaceListItem, ResolvedWorkspaceEntry, WorkspaceMediaFile } from '../../shared/workbench/workspaceFiles'

/** File moves remain a separate tree operation. Neither drag format grants file access. */
export const WORKSPACE_ENTRIES_DRAG_TYPE = 'application/x-guoling-workspace-entries'
export const WORKSPACE_MEDIA_DRAG_TYPE = 'application/x-guoling-workspace-media'

const MAX_DRAG_ENTRIES = 200
const MAX_MEDIA_ENTRIES = 200
const MAX_PAYLOAD_LENGTH = 64 * 1024

export type WorkspaceMediaKind = 'image' | 'video' | 'audio'
export type WorkspaceMediaDrag = { version: 1; workspaceId: string; entryIds: string[] }
export type ResolvedWorkspaceMedia = ResolvedWorkspaceEntry & { kind: 'file'; mediaKind: WorkspaceMediaKind }
type AccessibleEntry = Extract<WorkspaceListItem, { status: 'accessible' }>

const mediaExtensions: Record<string, WorkspaceMediaKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', svg: 'image',
  mp4: 'video', webm: 'video',
  mp3: 'audio', ogg: 'audio', wav: 'audio', m4a: 'audio',
}

export function workspaceMediaKind(name: string): WorkspaceMediaKind | null {
  const extension = /\.([^.\\/]+)$/.exec(name)?.[1]?.toLowerCase()
  return extension ? mediaExtensions[extension] ?? null : null
}

function validIds(value: unknown, maximum: number): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= maximum
    && value.every(id => typeof id === 'string' && id.length > 0 && id.length <= 256)
    && new Set(value).size === value.length
}

function validWorkspaceId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
}

/** Source hints are for drop affordances only; target-side validation is authoritative. */
export function writeWorkspaceEntryDrag(dataTransfer: Pick<DataTransfer, 'setData' | 'effectAllowed'>, workspaceId: string, entries: readonly AccessibleEntry[]): void {
  if (!validWorkspaceId(workspaceId) || !validIds(entries.map(entry => entry.entryId), MAX_DRAG_ENTRIES)) return
  const ids = entries.map(entry => entry.entryId)
  dataTransfer.setData(WORKSPACE_ENTRIES_DRAG_TYPE, JSON.stringify({ workspaceId, ids }))
  if (ids.length <= MAX_MEDIA_ENTRIES && entries.every(entry => entry.kind === 'file' && workspaceMediaKind(entry.name))) {
    dataTransfer.setData(WORKSPACE_MEDIA_DRAG_TYPE, JSON.stringify({ version: 1, workspaceId, entryIds: ids } satisfies WorkspaceMediaDrag))
  }
  dataTransfer.effectAllowed = 'copyMove'
}

export function parseWorkspaceEntryDrag(raw: string): { workspaceId: string; ids: string[] } | null {
  if (!raw) return null
  if (raw.length > MAX_PAYLOAD_LENGTH) throw new Error('资源树拖拽数据无效')
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error('资源树拖拽数据无效') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('资源树拖拽数据无效')
  const data = value as Record<string, unknown>
  if (!validWorkspaceId(data.workspaceId) || !validIds(data.ids, MAX_DRAG_ENTRIES)) throw new Error('资源树拖拽数据无效')
  return { workspaceId: data.workspaceId, ids: data.ids }
}

export function parseWorkspaceMediaDrag(raw: string): WorkspaceMediaDrag | null {
  if (!raw) return null
  if (raw.length > MAX_PAYLOAD_LENGTH) throw new Error('媒体拖拽数据无效')
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error('媒体拖拽数据无效') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('媒体拖拽数据无效')
  const data = value as Record<string, unknown>
  if (data.version !== 1 || !validWorkspaceId(data.workspaceId) || !validIds(data.entryIds, MAX_MEDIA_ENTRIES)
    || Object.keys(data).some(key => !['version', 'workspaceId', 'entryIds'].includes(key))) throw new Error('媒体拖拽数据无效')
  return { version: 1, workspaceId: data.workspaceId, entryIds: data.entryIds }
}

/** Resolves fresh host handles; returned paths must still pass the normal media importer. */
export async function resolveWorkspaceMediaDrag(raw: string, directory: string, files: WorkspaceFilesAPI): Promise<ResolvedWorkspaceMedia[] | null> {
  const drag = parseWorkspaceMediaDrag(raw)
  if (!drag) return null
  const root = await files({ type: 'root', directory })
  if (drag.workspaceId !== root.workspaceId) throw new Error('媒体不属于当前工作空间')
  const resolved = await Promise.all(drag.entryIds.map(entryId => files({ type: 'resolve', workspaceId: root.workspaceId, entryId })))
  return resolved.map((entry, index) => {
    const mediaKind = workspaceMediaKind(entry.resolvedPath)
    if (entry.workspaceId !== root.workspaceId || entry.entryId !== drag.entryIds[index] || entry.kind !== 'file' || !mediaKind) {
      throw new Error('媒体文件已变化，请从资源管理器重新拖入')
    }
    return { ...entry, kind: 'file', mediaKind }
  })
}

/** Every file is read through the host before a target begins any document mutation. */
export async function readWorkspaceMediaDrag(raw: string, directory: string, files: WorkspaceFilesAPI): Promise<WorkspaceMediaFile[] | null> {
  const resolved = await resolveWorkspaceMediaDrag(raw, directory, files)
  if (!resolved) return null
  const items = await Promise.all(resolved.map(entry => files({ type: 'read-media', workspaceId: entry.workspaceId, entryId: entry.entryId })))
  return items.map((item, index) => {
    const expected = resolved[index]
    if (item.workspaceId !== expected.workspaceId || item.entryId !== expected.entryId || item.mediaKind !== expected.mediaKind
      || !ArrayBuffer.isView(item.bytes) || Object.prototype.toString.call(item.bytes) !== '[object Uint8Array]') {
      throw new Error('媒体文件已变化，请从资源管理器重新拖入')
    }
    return { ...item, bytes: Uint8Array.from(item.bytes) }
  })
}
