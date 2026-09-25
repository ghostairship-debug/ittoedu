import { z } from 'zod'
import { documentRelativePathSchema } from '../document/resources'

export type WorkspaceEntryKind = 'file' | 'directory'
export type WorkspaceOperationStatus = 'success' | 'cancelled' | 'partial' | 'failed'
export type WorkspaceMutationKind = 'create-file' | 'mkdir' | 'rename' | 'copy' | 'move' | 'trash'

export interface RegisteredWorkspaceRoot {
  workspaceId: string
  rootEntryId: string
  resolvedPath: string
}

export interface ResolvedWorkspaceEntry {
  workspaceId: string
  entryId: string
  kind: WorkspaceEntryKind
  resolvedPath: string
}

export interface WorkspaceMediaFile {
  workspaceId: string
  entryId: string
  name: string
  mimeType: string
  bytes: Uint8Array
  mediaKind: 'image' | 'video' | 'audio'
}

export type WorkspaceListItem =
  | { status: 'accessible'; entryId: string; name: string; kind: WorkspaceEntryKind }
  | { status: 'blocked'; name: string; reason: 'outside-workspace' | 'unsupported-entry' }

export interface WorkspaceListPage {
  entries: WorkspaceListItem[]
  nextCursor?: string
}

export interface WorkspaceItemResult {
  status: WorkspaceOperationStatus
  sourceEntryId?: string
  entryId?: string
  sourcePath?: string
  targetPath?: string
  affectedPaths: string[]
  error?: { code: string; message: string }
}

export interface WorkspaceOperationResult {
  operationId: string
  status: WorkspaceOperationStatus
  items: WorkspaceItemResult[]
  affectedPaths: string[]
}

export interface WorkspaceMutationAction {
  operationId: string
  workspaceId: string
  kind: WorkspaceMutationKind
  sources: Array<{ entryId: string; resolvedPath: string; kind: WorkspaceEntryKind }>
  target?: { workspaceId: string; directoryEntryId: string; resolvedDirectoryPath: string; resolvedPath: string }
  affectedPaths: string[]
  overwrite: boolean
  resourcePolicy?: 'copy' | 'cancel'
}


const id = z.string().min(1).max(256)
const name = z.string().min(1).max(200)
const scope = { workspaceId: id }
const mutation = { ...scope, operationId: id }
export const workspaceFilesRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('root'), directory: z.string().min(1).max(32767) }).strict(),
  z.object({ type: z.literal('watch'), ...scope }).strict(),
  z.object({ type: z.literal('create-course'), ...mutation, targetDirectoryId: id, name }).strict(),
  z.object({ type: z.literal('create-text'), ...mutation, targetDirectoryId: id, name }).strict(),
  z.object({ type: z.literal('import-files'), ...mutation, targetDirectoryId: id, directories: z.array(documentRelativePathSchema).max(256).optional(), files: z.array(z.object({ name: documentRelativePathSchema, bytes: z.instanceof(Uint8Array) }).strict()).max(32).refine(files => files.reduce((total, file) => total + file.bytes.byteLength, 0) <= 64 * 1024 * 1024, '拖入文件总计不能超过 64 MiB') }).strict(),
  z.object({ type: z.literal('list'), ...scope, directoryEntryId: id, cursor: z.string().optional(), limit: z.number().int().min(1).max(200).optional() }).strict(),
  z.object({ type: z.literal('resolve'), ...scope, entryId: id }).strict(),
  z.object({ type: z.literal('read-media'), ...scope, entryId: id }).strict(),
  z.object({ type: z.literal('create-markdown'), ...mutation, targetDirectoryId: id, name }).strict(),
  z.object({ type: z.literal('mkdir'), ...mutation, targetDirectoryId: id, name }).strict(),
  z.object({ type: z.literal('rename'), ...mutation, sourceEntryId: id, name }).strict(),
  z.object({ type: z.literal('copy'), ...mutation, sourceEntryIds: z.array(id).min(1).max(200), targetDirectoryId: id, resourcePolicy: z.enum(['copy', 'cancel']).optional() }).strict(),
  z.object({ type: z.literal('move'), ...mutation, sourceEntryIds: z.array(id).min(1).max(200), targetWorkspaceId: id.optional(), targetDirectoryId: id, resourcePolicy: z.enum(['copy', 'cancel']).optional() }).strict(),
  z.object({ type: z.literal('trash'), ...mutation, entryIds: z.array(id).min(1).max(200) }).strict(),
  z.object({ type: z.literal('reveal'), ...mutation, entryId: id }).strict(),
])
export type WorkspaceFilesRequest = z.infer<typeof workspaceFilesRequestSchema>
export type WorkspaceFilesResponse<T extends WorkspaceFilesRequest> = T extends { type: 'root' } ? RegisteredWorkspaceRoot
  : T extends { type: 'watch' } ? { workspaceId: string; watching: boolean }
  : T extends { type: 'list' } ? WorkspaceListPage : T extends { type: 'resolve' } ? ResolvedWorkspaceEntry
  : T extends { type: 'read-media' } ? WorkspaceMediaFile : WorkspaceOperationResult
export interface WorkspaceFilesChange { workspaceId: string }
export interface WorkspaceFilesAPI {
  subscribe?(listener: (event: WorkspaceFilesChange) => void): () => void
  <T extends WorkspaceFilesRequest>(request: T): Promise<WorkspaceFilesResponse<T>>
}
