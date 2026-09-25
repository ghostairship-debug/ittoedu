import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream, watch, promises as fs } from 'node:fs'
import type { BigIntStats, Dirent, Stats } from 'node:fs'
import path from 'node:path'

import type { WorkspaceEntryKind, WorkspaceOperationStatus, WorkspaceMutationKind, RegisteredWorkspaceRoot, ResolvedWorkspaceEntry, WorkspaceListItem, WorkspaceListPage, WorkspaceItemResult, WorkspaceOperationResult, WorkspaceMutationAction } from '../../shared/workbench/workspaceFiles'
import type { DocumentKind } from '../../shared/workbench/document'
export type { WorkspaceEntryKind, WorkspaceOperationStatus, WorkspaceMutationKind, RegisteredWorkspaceRoot, ResolvedWorkspaceEntry, WorkspaceListItem, WorkspaceListPage, WorkspaceItemResult, WorkspaceOperationResult, WorkspaceMutationAction } from '../../shared/workbench/workspaceFiles'
import { markdownReferences, readDocumentFileVersion } from './documentJournal'
import { prepareMarkdownMoveResources } from './markdownMoveResources'

export type WorkspaceAroundMutation = (
  action: WorkspaceMutationAction,
  perform: () => Promise<WorkspaceItemResult>,
) => Promise<WorkspaceItemResult>

export interface WorkspaceFilesDependencies {
  createId?: () => string
  trashItem?: (resolvedPath: string) => Promise<void>
  showItemInFolder?: (resolvedPath: string) => void
  aroundMutation?: WorkspaceAroundMutation
  aroundOperation?: (perform: () => Promise<WorkspaceOperationResult>) => Promise<WorkspaceOperationResult>
  fileOperations?: Partial<{
    rename: (source: string, target: string) => Promise<void>
    remove: (target: string) => Promise<void>
    copy: (source: string, target: string, kind: WorkspaceEntryKind) => Promise<void>
  }>
}

export class WorkspaceFilesError extends Error {
  constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WorkspaceFilesError'
  }
}

export class WorkspaceOperationCancelledError extends WorkspaceFilesError {
  constructor(message = '操作已取消') { super('cancelled', message); this.name = 'WorkspaceOperationCancelledError' }
}

interface EntryRecord {
  workspaceId: string
  entryId: string
  kind: WorkspaceEntryKind
  resolvedPath: string
  identity?: string
}

interface RootRecord extends RegisteredWorkspaceRoot {}

interface MutationExecution {
  result: WorkspaceItemResult
  commit?: () => Promise<void> | void
  rollback?: () => Promise<void>
}

interface ReplayRecord {
  digest: string
  result: Promise<WorkspaceOperationResult>
}

type WorkspaceDestination = NonNullable<WorkspaceMutationAction['target']>
type TreeSnapshot = Array<{ relative: string; kind: WorkspaceEntryKind; size?: number; hash?: string;
  identity?: string; mtimeNs: string; ctimeNs: string }>

function snapshotContent(snapshot: TreeSnapshot) {
  return snapshot.map(({ relative, kind, size, hash }) => ({ relative, kind, size, hash }))
}

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i
const INVALID_WINDOWS_NAME = /[<>:"/\\|?*\u0000-\u001f]/
// Document saves stage bytes beside the destination before the final rename.
// A directory watch can fire while that file exists, then miss the rename on Windows.
const ATOMIC_DOCUMENT_TEMPORARY_NAME = /^\..+\.[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.tmp$/i

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code : undefined
}

function workspaceError(error: unknown, fallback = 'file-operation-failed'): WorkspaceFilesError {
  if (error instanceof WorkspaceFilesError) return error
  return new WorkspaceFilesError(errorCode(error) ?? fallback, error instanceof Error ? error.message : '文件操作失败', { cause: error })
}

function publicFailure(error: unknown, base: Omit<WorkspaceItemResult, 'status' | 'error'>): WorkspaceItemResult {
  const known = workspaceError(error)
  return { ...base, status: known instanceof WorkspaceOperationCancelledError ? 'cancelled' : 'failed', error: { code: known.code, message: known.message } }
}

function operationStatus(items: WorkspaceItemResult[]): WorkspaceOperationStatus {
  if (items.length === 0) return 'failed'
  if (items.every(item => item.status === 'success')) return 'success'
  if (items.every(item => item.status === 'cancelled')) return 'cancelled'
  if (items.some(item => item.status === 'success' || item.status === 'partial')) return 'partial'
  return 'failed'
}

function stableDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function validateOperationId(operationId: string): void {
  if (!operationId || operationId.length > 256) throw new WorkspaceFilesError('invalid-operation-id', 'operationId 必须是非空短标识')
}

export function validateWorkspaceEntryName(name: string): void {
  if (!name || name === '.' || name === '..' || name.length > 255 || INVALID_WINDOWS_NAME.test(name)
    || /[ .]$/.test(name) || WINDOWS_RESERVED_NAME.test(name)) {
    throw new WorkspaceFilesError('invalid-entry-name', `Windows 文件名无效：${name || '<empty>'}`)
  }
}

export class WorkspaceFiles {
  private readonly roots = new Map<string, RootRecord>()
  private readonly rootsByPath = new Map<string, string>()
  private readonly entries = new Map<string, EntryRecord>()
  private readonly entriesByPath = new Map<string, string>()
  private readonly entriesByIdentity = new Map<string, Set<string>>()
  private readonly replay = new Map<string, ReplayRecord>()
  private readonly createId: () => string
  private readonly renamePath: (source: string, target: string) => Promise<void>
  private readonly removePath: (target: string) => Promise<void>
  private readonly copyPath: (source: string, target: string, kind: WorkspaceEntryKind) => Promise<void>

  constructor(private readonly dependencies: WorkspaceFilesDependencies = {}) {
    this.createId = dependencies.createId ?? randomUUID
    this.renamePath = dependencies.fileOperations?.rename ?? ((source, target) => fs.rename(source, target))
    this.removePath = dependencies.fileOperations?.remove ?? (target => fs.rm(target, { recursive: true, force: false }))
    this.copyPath = dependencies.fileOperations?.copy ?? (async (source, target, kind) => {
      if (kind === 'directory') await fs.cp(source, target, { recursive: true, errorOnExist: true, force: false, dereference: false })
      else await fs.copyFile(source, target, constants.COPYFILE_EXCL)
    })
  }

  async registerRoot(absoluteDirectory: string): Promise<RegisteredWorkspaceRoot> {
    if (!path.isAbsolute(absoluteDirectory)) throw new WorkspaceFilesError('root-not-absolute', '工作区根必须是显式授权的绝对目录')
    const resolvedPath = await fs.realpath(absoluteDirectory)
    const stat = await fs.lstat(resolvedPath)
    if (!stat.isDirectory()) throw new WorkspaceFilesError('root-not-directory', '工作区根必须是目录')
    const existingId = this.rootsByPath.get(this.pathKey(resolvedPath))
    if (existingId) return this.registeredRoot(existingId)
    const workspaceId = this.createId(), rootEntryId = this.createId()
    const root = { workspaceId, rootEntryId, resolvedPath }
    this.roots.set(workspaceId, root)
    this.rootsByPath.set(this.pathKey(resolvedPath), workspaceId)
    this.remember({ workspaceId, entryId: rootEntryId, kind: 'directory', resolvedPath })
    return { ...root }
  }

  registeredRoot(workspaceId: string): RegisteredWorkspaceRoot {
    const root = this.roots.get(workspaceId)
    if (!root) throw new WorkspaceFilesError('unknown-workspace', '工作区句柄无效')
    return { ...root }
  }

  /** The document writer calls this only after an acknowledged atomic save. */
  async acknowledgeDocumentSave(filename: string, kind: DocumentKind, expectedVersion: string | null): Promise<boolean> {
    if (!expectedVersion) return false
    const known = [...this.entries.values()].filter(entry => entry.kind === 'file' && this.pathKey(entry.resolvedPath) === this.pathKey(filename))
    if (!known.length) return false
    try {
      const [resolvedPath, stat, version] = await Promise.all([
        fs.realpath(filename), fs.lstat(filename, { bigint: true }), readDocumentFileVersion(filename, kind),
      ])
      if (!stat.isFile() || stat.isSymbolicLink() || version !== expectedVersion) return false
      const identity = this.fileIdentity(stat)
      for (const entry of known) {
        if (this.pathKey(entry.resolvedPath) !== this.pathKey(resolvedPath)) continue
        this.remember({ ...entry, identity })
      }
      return true
    } catch { return false }
  }

  watch(workspaceId: string, changed: () => void): () => void {
    const watcher = watch(this.registeredRoot(workspaceId).resolvedPath, { recursive: true, persistent: false }, changed)
    watcher.on('error', changed)
    return () => watcher.close()
  }

  async resolveEntry(workspaceId: string, entryId: string): Promise<ResolvedWorkspaceEntry> {
    const record = this.entry(workspaceId, entryId)
    const resolvedPath = await fs.realpath(record.resolvedPath).catch(error => {
      if (isMissing(error)) throw new WorkspaceFilesError('entry-missing', '文件项已不存在', { cause: error })
      throw error
    })
    this.assertContained(workspaceId, resolvedPath)
    const stat = await fs.lstat(record.resolvedPath, { bigint: true })
    const kind = this.kindOf(stat)
    const identity = this.fileIdentity(stat)
    if (this.pathKey(resolvedPath) !== this.pathKey(record.resolvedPath) || kind !== record.kind
      || (record.identity && record.identity !== identity)) {
      this.forgetTree(workspaceId, record.resolvedPath)
      throw new WorkspaceFilesError('entry-changed', '文件项已被外部替换，请刷新后重试')
    }
    this.remember({ ...record, resolvedPath, kind, identity })
    return { workspaceId, entryId, kind, resolvedPath }
  }

  async listChildren(input: { workspaceId: string; directoryEntryId: string; cursor?: string; limit?: number }): Promise<WorkspaceListPage> {
    const directory = await this.resolveEntry(input.workspaceId, input.directoryEntryId)
    if (directory.kind !== 'directory') throw new WorkspaceFilesError('not-directory', '只能列出目录内容')
    const limit = input.limit ?? 50
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new WorkspaceFilesError('invalid-page-size', 'limit 必须在 1 到 200 之间')
    const offset = input.cursor === undefined ? 0 : Number(input.cursor)
    if (!Number.isSafeInteger(offset) || offset < 0) throw new WorkspaceFilesError('invalid-cursor', '分页 cursor 无效')
    const children = (await fs.readdir(directory.resolvedPath, { withFileTypes: true }))
      .filter(child => !ATOMIC_DOCUMENT_TEMPORARY_NAME.test(child.name))
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }))
    const page = children.slice(offset, offset + limit)
    const entries: WorkspaceListItem[] = []
    for (const child of page) entries.push(await this.listItem(input.workspaceId, directory.resolvedPath, child))
    const next = offset + page.length
    return { entries, ...(next < children.length ? { nextCursor: String(next) } : {}) }
  }

  createFile(input: { operationId: string; workspaceId: string; targetDirectoryId: string; name: string;
    format: 'markdown' | 'course-v9' | 'file'; bytes: Uint8Array; overwrite?: boolean }): Promise<WorkspaceOperationResult> {
    const bytes = Uint8Array.from(input.bytes)
    const digest = stableDigest({ ...input, bytes: createHash('sha256').update(bytes).digest('hex') })
    return this.runOnce(input.operationId, digest, async () => {
      const expected = input.format === 'file' ? null : input.format === 'markdown' ? '.md' : '.h5lesson'
      validateWorkspaceEntryName(input.name)
      if (expected && path.extname(input.name).toLowerCase() !== expected) throw new WorkspaceFilesError('format-extension-mismatch', `该格式要求 ${expected} 文件名`)
      const target = await this.destination(input.workspaceId, input.targetDirectoryId, input.name)
      const action = this.action(input.operationId, input.workspaceId, 'create-file', [], target, !!input.overwrite)
      const result = await this.coordinate(action, async () => {
        await this.requireAvailableTarget(target.resolvedPath, !!input.overwrite)
        const temporary = this.temporarySibling(target.resolvedPath, input.operationId)
        await fs.writeFile(temporary, bytes, { flag: 'wx' })
        try { await this.renamePath(temporary, target.resolvedPath) }
        catch (error) { await fs.rm(temporary, { force: true }).catch(() => {}); throw error }
        const entry = await this.provisionalEntry(input.workspaceId, target.resolvedPath, 'file')
        return {
          result: { status: 'success', entryId: entry.entryId, targetPath: target.resolvedPath, affectedPaths: [target.resolvedPath] },
          rollback: async () => { await this.removePath(target.resolvedPath); this.forgetTree(input.workspaceId, target.resolvedPath) },
          commit: () => this.remember(entry),
        }
      })
      return this.aggregate(input.operationId, [result])
    })
  }

  mkdir(input: { operationId: string; workspaceId: string; targetDirectoryId: string; name: string; overwrite?: boolean }): Promise<WorkspaceOperationResult> {
    const digest = stableDigest(input)
    return this.runOnce(input.operationId, digest, async () => {
      validateWorkspaceEntryName(input.name)
      const target = await this.destination(input.workspaceId, input.targetDirectoryId, input.name)
      const action = this.action(input.operationId, input.workspaceId, 'mkdir', [], target, !!input.overwrite)
      const result = await this.coordinate(action, async () => {
        await this.requireAvailableTarget(target.resolvedPath, !!input.overwrite)
        await fs.mkdir(target.resolvedPath)
        const entry = await this.provisionalEntry(input.workspaceId, target.resolvedPath, 'directory')
        return {
          result: { status: 'success', entryId: entry.entryId, targetPath: target.resolvedPath, affectedPaths: [target.resolvedPath] },
          rollback: async () => { await fs.rmdir(target.resolvedPath); this.forgetTree(input.workspaceId, target.resolvedPath) },
          commit: () => this.remember(entry),
        }
      })
      return this.aggregate(input.operationId, [result])
    })
  }

  rename(input: { operationId: string; workspaceId: string; sourceEntryId: string; name: string; overwrite?: boolean }): Promise<WorkspaceOperationResult> {
    const digest = stableDigest(input)
    return this.runOnce(input.operationId, digest, async () => {
      validateWorkspaceEntryName(input.name)
      const source = await this.resolveMutableSource(input.workspaceId, input.sourceEntryId)
      const parent = path.dirname(source.resolvedPath)
      const parentEntry = await this.issueEntry(input.workspaceId, parent)
      const target = await this.destination(input.workspaceId, parentEntry.entryId, input.name)
      const result = await this.renameOrMove(input.operationId, input.workspaceId, 'rename', source, target, !!input.overwrite)
      return this.aggregate(input.operationId, [result])
    })
  }

  copy(input: { operationId: string; workspaceId: string; sourceEntryIds: string[]; targetDirectoryId: string; overwrite?: boolean; resourcePolicy?: 'copy' | 'cancel' }): Promise<WorkspaceOperationResult> {
    return this.transferMany('copy', input)
  }

  move(input: { operationId: string; workspaceId: string; sourceEntryIds: string[]; targetWorkspaceId?: string;
    targetDirectoryId: string; overwrite?: boolean; resourcePolicy?: 'copy' | 'cancel' }): Promise<WorkspaceOperationResult> {
    return this.transferMany('move', input)
  }

  trash(input: { operationId: string; workspaceId: string; entryIds: string[] }): Promise<WorkspaceOperationResult> {
    const digest = stableDigest(input)
    return this.runOnce(input.operationId, digest, async () => {
      const items: WorkspaceItemResult[] = []
      for (const selected of await this.topLevelSources(input.workspaceId, input.entryIds)) {
        if (!selected.source) { items.push(selected.failure!); continue }
        const { entryId, source } = selected
        const action = this.action(input.operationId, input.workspaceId, 'trash', [source], undefined, false)
        items.push(await this.coordinate(action, async () => {
          if (!this.dependencies.trashItem) throw new WorkspaceFilesError('trash-unavailable', '系统回收站接口不可用')
          await this.dependencies.trashItem(source.resolvedPath)
          return {
            result: { status: 'success', sourceEntryId: entryId, sourcePath: source.resolvedPath, affectedPaths: [source.resolvedPath] },
            commit: () => this.forgetTree(input.workspaceId, source.resolvedPath),
          }
        }))
      }
      return this.aggregate(input.operationId, items)
    })
  }

  reveal(input: { operationId: string; workspaceId: string; entryId: string }): Promise<WorkspaceOperationResult> {
    const digest = stableDigest(input)
    return this.runOnce(input.operationId, digest, async () => {
      let item: WorkspaceItemResult
      try {
        const entry = await this.resolveEntry(input.workspaceId, input.entryId)
        if (!this.dependencies.showItemInFolder) throw new WorkspaceFilesError('reveal-unavailable', '系统定位接口不可用')
        this.dependencies.showItemInFolder(entry.resolvedPath)
        item = { status: 'success', sourceEntryId: entry.entryId, sourcePath: entry.resolvedPath, affectedPaths: [] }
      } catch (error) { item = publicFailure(error, { sourceEntryId: input.entryId, affectedPaths: [] }) }
      return this.aggregate(input.operationId, [item])
    })
  }

  private async transferMany(kind: 'copy' | 'move', input: { operationId: string; workspaceId: string;
    sourceEntryIds: string[]; targetWorkspaceId?: string; targetDirectoryId: string; overwrite?: boolean;
    resourcePolicy?: 'copy' | 'cancel' }): Promise<WorkspaceOperationResult> {
    const digest = stableDigest({ kind, ...input })
    return this.runOnce(input.operationId, digest, async () => {
      const targetWorkspaceId = kind === 'move' ? input.targetWorkspaceId ?? input.workspaceId : input.workspaceId
      const targetDirectory = await this.resolveEntry(targetWorkspaceId, input.targetDirectoryId)
      if (targetDirectory.kind !== 'directory') throw new WorkspaceFilesError('not-directory', '目标句柄不是目录')
      const items: WorkspaceItemResult[] = []
      for (const selected of await this.topLevelSources(input.workspaceId, input.sourceEntryIds)) {
        if (!selected.source) { items.push(selected.failure!); continue }
        const source = selected.source, sourceEntryId = selected.entryId
        const target = await this.destination(targetWorkspaceId, targetDirectory.entryId, path.basename(source.resolvedPath))
        if (source.kind === 'directory' && this.isSameOrDescendant(target.resolvedDirectoryPath, source.resolvedPath)) {
          items.push(publicFailure(new WorkspaceFilesError('target-inside-source', '不能把目录移动或复制到自身后代'), {
            sourceEntryId, sourcePath: source.resolvedPath, targetPath: target.resolvedPath,
            affectedPaths: [source.resolvedPath, target.resolvedPath],
          })); continue
        }
        if (kind === 'move') items.push(await this.renameOrMove(input.operationId, input.workspaceId, kind, source, target, !!input.overwrite, input.resourcePolicy))
        else items.push(await this.copyOne(input.operationId, input.workspaceId, source, target, !!input.overwrite, input.resourcePolicy))
      }
      return this.aggregate(input.operationId, items)
    })
  }

  private async topLevelSources(workspaceId: string, entryIds: string[]): Promise<Array<{
    entryId: string; source?: ResolvedWorkspaceEntry; failure?: WorkspaceItemResult
  }>> {
    const unique = [...new Set(entryIds)]
    const selected = await Promise.all(unique.map(async entryId => {
      try { return { entryId, source: await this.resolveMutableSource(workspaceId, entryId) } }
      catch (error) { return { entryId, failure: publicFailure(error, { sourceEntryId: entryId, affectedPaths: [] }) } }
    }))
    // Selecting a folder already includes its descendants. Repeating a nested item
    // would split a move or report a false partial failure after trashing the folder.
    return selected.filter(item => !item.source || !selected.some(other => other !== item && other.source?.kind === 'directory'
      && this.isSameOrDescendant(item.source!.resolvedPath, other.source.resolvedPath)))
  }

  private async copyOne(operationId: string, workspaceId: string, source: ResolvedWorkspaceEntry,
    target: WorkspaceDestination, overwrite: boolean, resourcePolicy?: 'copy' | 'cancel'): Promise<WorkspaceItemResult> {
    const action = { ...this.action(operationId, workspaceId, 'copy', [source], target, overwrite), resourcePolicy }
    return this.coordinate(action, async () => {
      await this.requireAvailableTarget(target.resolvedPath, overwrite)
      await this.assertTreeClosed(workspaceId, source.resolvedPath)
      await this.copyVerified(source.resolvedPath, target.resolvedPath, source.kind, operationId)
      const copied = await this.provisionalEntry(workspaceId, target.resolvedPath, source.kind)
      return {
        result: { status: 'success', sourceEntryId: source.entryId, entryId: copied.entryId, sourcePath: source.resolvedPath,
          targetPath: target.resolvedPath, affectedPaths: [source.resolvedPath, target.resolvedPath] },
        rollback: async () => { await this.removePath(target.resolvedPath); this.forgetTree(workspaceId, target.resolvedPath) },
        commit: () => this.remember(copied),
      }
    })
  }

  private async renameOrMove(operationId: string, workspaceId: string, kind: 'rename' | 'move', source: ResolvedWorkspaceEntry,
    target: WorkspaceDestination, overwrite: boolean, resourcePolicy?: 'copy' | 'cancel'): Promise<WorkspaceItemResult> {
    const affectedPaths = [source.resolvedPath, target.resolvedPath]
    const action = { ...this.action(operationId, workspaceId, kind, [source], target, overwrite), resourcePolicy }
    // Two separately authorized roots can overlap. Moving into the same real
    // directory entry is a no-op even when the root handles differ; copying it
    // over itself and then deleting the source would delete the only file.
    if (this.pathKey(source.resolvedPath) === this.pathKey(target.resolvedPath)) {
      return { status: 'success', sourceEntryId: source.entryId, entryId: source.entryId, sourcePath: source.resolvedPath,
        targetPath: target.resolvedPath, affectedPaths }
    }
    return this.coordinate(action, async () => {
      if (this.pathKey(source.resolvedPath) !== this.pathKey(target.resolvedPath)) await this.requireAvailableTarget(target.resolvedPath, overwrite)
      await this.assertTreeClosed(workspaceId, source.resolvedPath)
      if (workspaceId === target.workspaceId) {
        try {
          await this.renamePath(source.resolvedPath, target.resolvedPath)
          return {
            result: { status: 'success', sourceEntryId: source.entryId, entryId: source.entryId, sourcePath: source.resolvedPath,
              targetPath: target.resolvedPath, affectedPaths },
            commit: () => this.moveRememberedTree(workspaceId, source.resolvedPath, target.resolvedPath),
            rollback: () => this.renamePath(target.resolvedPath, source.resolvedPath),
          }
        } catch (error) {
          if (errorCode(error) !== 'EXDEV') throw error
        }
      }
      const verifiedSource = await this.copyVerified(source.resolvedPath, target.resolvedPath, source.kind, operationId)
      let copiedIdentities: Map<string, string | undefined>
      try {
        copiedIdentities = await this.rememberedIdentities(workspaceId, source.resolvedPath, target.resolvedPath)
      } catch (error) {
        await this.removePath(target.resolvedPath)
        throw error
      }
      const sourceUnchanged = await this.snapshotTree(source.resolvedPath)
        .then(current => JSON.stringify(current) === JSON.stringify(verifiedSource), () => false)
      if (!sourceUnchanged) {
        const copied = await this.issueEntry(target.workspaceId, target.resolvedPath)
        return { result: { status: 'partial', sourceEntryId: source.entryId, entryId: copied.entryId,
          sourcePath: source.resolvedPath, targetPath: target.resolvedPath, affectedPaths,
          error: { code: 'source-changed-after-copy', message: '副本已验证，但源项在删除前发生变化；原件未删除，请检查两份内容' } } }
      }
      try { await this.removePath(source.resolvedPath) }
      catch (error) {
        const copied = await this.issueEntry(target.workspaceId, target.resolvedPath)
        const known = workspaceError(error, 'source-delete-failed')
        return { result: { status: 'partial', sourceEntryId: source.entryId, entryId: copied.entryId,
          sourcePath: source.resolvedPath, targetPath: target.resolvedPath, affectedPaths,
          error: { code: 'source-delete-failed', message: `副本已验证，但源项未删除：${known.message}` } } }
      }
      return {
        result: { status: 'success', sourceEntryId: source.entryId, entryId: source.entryId, sourcePath: source.resolvedPath,
          targetPath: target.resolvedPath, affectedPaths },
        commit: () => this.moveRememberedTree(workspaceId, source.resolvedPath, target.resolvedPath, copiedIdentities, target.workspaceId),
        rollback: async () => {
          await this.copyVerified(target.resolvedPath, source.resolvedPath, source.kind, `${operationId}-rollback`)
          const restoredIdentities = await this.rememberedIdentities(workspaceId, source.resolvedPath, source.resolvedPath)
          await this.removePath(target.resolvedPath)
          this.updateRememberedIdentities(workspaceId, source.resolvedPath, restoredIdentities)
        },
      }
    })
  }

  private async coordinate(action: WorkspaceMutationAction, perform: () => Promise<MutationExecution>): Promise<WorkspaceItemResult> {
    let execution: MutationExecution | undefined
    let resources: Awaited<ReturnType<typeof prepareMarkdownMoveResources>> | undefined
    let calls = 0
    const invoke = async () => {
      if (++calls !== 1) throw new WorkspaceFilesError('mutation-performed-twice', '协调钩子只能执行一次文件操作')
      await this.assertMutationPathsCurrent(action)
      const source = action.sources[0], target = action.target
      if ((action.kind === 'move' || action.kind === 'copy') && source?.kind === 'file' && target
        && /\.(md|markdown)$/i.test(source.resolvedPath)
        && this.pathKey(path.dirname(source.resolvedPath)) !== this.pathKey(target.resolvedDirectoryPath)) {
        const references = await markdownReferences(await fs.readFile(source.resolvedPath, 'utf8'))
        if (references.length) {
          if (action.resourcePolicy === 'cancel') throw new WorkspaceOperationCancelledError('已取消，正文和附件保持原位置')
          if (action.resourcePolicy !== 'copy') throw new WorkspaceFilesError('resource-choice-required', '此文档引用本地附件，请选择一并复制附件或取消')
          await this.requireAvailableTarget(target.resolvedPath, action.overwrite)
          resources = await prepareMarkdownMoveResources(source.resolvedPath, target.resolvedPath)
          if (await readDocumentFileVersion(source.resolvedPath, 'markdown') !== resources.sourceVersion) throw new WorkspaceFilesError('file-conflict', '操作期间源文档或附件已改变')
        }
      }
      // A coordinator can wait for an open document. Recheck after that wait and
      // before touching disk, since a directory may have become a junction.
      await this.assertMutationPathsCurrent(action)
      execution = await perform()
      return execution.result
    }
    try {
      const result = this.dependencies.aroundMutation ? await this.dependencies.aroundMutation(action, invoke) : await invoke()
      if (calls === 0) {
        if (result.status === 'success' || result.status === 'partial') throw new WorkspaceFilesError('mutation-not-performed', '协调钩子未执行文件操作，不能返回成功')
        return result
      }
      await execution?.commit?.()
      return result
    } catch (error) {
      const base = { sourceEntryId: action.sources[0]?.entryId, sourcePath: action.sources[0]?.resolvedPath,
        targetPath: action.target?.resolvedPath, affectedPaths: action.affectedPaths }
      if (!execution || execution.result.status === 'failed' || execution.result.status === 'cancelled') {
        await resources?.rollback()
        return publicFailure(error, base)
      }
      if (!execution.rollback) {
        await execution.commit?.()
        const known = workspaceError(error, 'coordination-failed-after-mutation')
        return { ...base, status: 'partial', entryId: execution.result.entryId,
          error: { code: 'coordination-failed-after-mutation', message: `文件操作已发生，但协调提交失败且不可回滚：${known.message}` } }
      }
      try {
        await execution.rollback()
        await resources?.rollback()
        return publicFailure(new WorkspaceFilesError('coordination-rolled-back', '协调提交失败，文件操作已回滚', { cause: error }), base)
      } catch (rollbackError) {
        await execution.commit?.()
        return { ...base, status: 'partial', entryId: execution.result.entryId,
          error: { code: 'rollback-failed', message: `协调提交失败且文件回滚失败：${workspaceError(rollbackError).message}` } }
      }
    }
  }

  private async assertMutationPathsCurrent(action: WorkspaceMutationAction): Promise<void> {
    for (const source of action.sources) {
      const current = await fs.realpath(source.resolvedPath)
      this.assertContained(action.workspaceId, current)
      if (this.pathKey(current) !== this.pathKey(source.resolvedPath)) {
        throw new WorkspaceFilesError('source-changed', '操作期间源项位置已改变，请刷新后重试')
      }
    }
    if (action.target) {
      const current = await fs.realpath(action.target.resolvedDirectoryPath)
      this.assertContained(action.target.workspaceId, current)
      if (this.pathKey(current) !== this.pathKey(action.target.resolvedDirectoryPath)) {
        throw new WorkspaceFilesError('target-directory-changed', '操作期间目标目录位置已改变，请刷新后重试')
      }
    }
  }

  private async copyVerified(source: string, target: string, kind: WorkspaceEntryKind, operationId: string): Promise<TreeSnapshot> {
    const before = await this.snapshotTree(source)
    const temporary = this.temporarySibling(target, operationId)
    await fs.rm(temporary, { recursive: true, force: true })
    try {
      await this.copyPath(source, temporary, kind)
      const [afterSource, copied] = await Promise.all([this.snapshotTree(source), this.snapshotTree(temporary)])
      if (JSON.stringify(before) !== JSON.stringify(afterSource)
        || JSON.stringify(snapshotContent(before)) !== JSON.stringify(snapshotContent(copied))) {
        throw new WorkspaceFilesError('copy-verification-failed', '复制后的目录结构或文件内容校验不一致')
      }
      await this.renamePath(temporary, target)
      return before
    } catch (error) {
      await fs.rm(temporary, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }

  private async snapshotTree(root: string): Promise<TreeSnapshot> {
    const output: TreeSnapshot = []
    const visit = async (current: string, relative: string): Promise<void> => {
      const stat = await fs.lstat(current, { bigint: true })
      if (stat.isSymbolicLink()) throw new WorkspaceFilesError('unsupported-reparse-point', '复制或移动目录不能包含符号链接或 junction')
      const metadata = { identity: this.fileIdentity(stat), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) }
      if (stat.isDirectory()) {
        output.push({ relative, kind: 'directory', ...metadata })
        const children = (await fs.readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
        for (const child of children) await visit(path.join(current, child.name), relative ? path.join(relative, child.name) : child.name)
        return
      }
      if (!stat.isFile()) throw new WorkspaceFilesError('unsupported-entry', '仅支持普通文件和目录')
      output.push({ relative, kind: 'file', size: Number(stat.size), hash: await this.hashFile(current), ...metadata })
    }
    await visit(root, '')
    return output
  }

  private hashFile(filename: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256'), stream = createReadStream(filename)
      stream.on('data', chunk => hash.update(chunk))
      stream.on('error', reject)
      stream.on('end', () => resolve(hash.digest('hex')))
    })
  }

  private async assertTreeClosed(workspaceId: string, root: string): Promise<void> {
    const visit = async (current: string): Promise<void> => {
      const resolved = await fs.realpath(current)
      this.assertContained(workspaceId, resolved)
      const stat = await fs.lstat(current)
      if (stat.isSymbolicLink()) throw new WorkspaceFilesError('unsupported-reparse-point', '符号链接或 junction 不能作为受控文件操作源')
      if (!stat.isDirectory()) return
      for (const child of await fs.readdir(current, { withFileTypes: true })) await visit(path.join(current, child.name))
    }
    await visit(root)
  }

  private async listItem(workspaceId: string, parent: string, child: Dirent): Promise<WorkspaceListItem> {
    const candidate = path.join(parent, child.name)
    try {
      const resolved = await fs.realpath(candidate)
      this.assertContained(workspaceId, resolved)
      const stat = await fs.lstat(candidate, { bigint: true })
      const kind = this.kindOf(stat)
      const entry = await this.issueEntry(workspaceId, resolved, kind, stat)
      return { status: 'accessible', entryId: entry.entryId, name: child.name, kind }
    } catch (error) {
      if (error instanceof WorkspaceFilesError && error.code === 'outside-workspace') return { status: 'blocked', name: child.name, reason: 'outside-workspace' }
      return { status: 'blocked', name: child.name, reason: 'unsupported-entry' }
    }
  }

  private async resolveMutableSource(workspaceId: string, entryId: string): Promise<ResolvedWorkspaceEntry> {
    const root = this.registeredRoot(workspaceId)
    if (entryId === root.rootEntryId) throw new WorkspaceFilesError('root-mutation-forbidden', '不能修改已授权工作区根本身')
    return this.resolveEntry(workspaceId, entryId)
  }

  private async destination(workspaceId: string, directoryEntryId: string, name: string): Promise<WorkspaceDestination> {
    validateWorkspaceEntryName(name)
    const directory = await this.resolveEntry(workspaceId, directoryEntryId)
    if (directory.kind !== 'directory') throw new WorkspaceFilesError('not-directory', '目标句柄不是目录')
    const resolvedPath = path.join(directory.resolvedPath, name)
    this.assertContained(workspaceId, resolvedPath)
    return { workspaceId, directoryEntryId, resolvedDirectoryPath: directory.resolvedPath, resolvedPath }
  }

  private async requireAvailableTarget(target: string, overwrite: boolean): Promise<void> {
    try {
      await fs.lstat(target)
      if (overwrite) throw new WorkspaceFilesError('overwrite-not-supported', '该受控操作尚不支持覆盖；请先使用明确的独立处理')
      throw new WorkspaceFilesError('same-name-conflict', '目标已存在，默认不覆盖')
    } catch (error) { if (!isMissing(error)) throw error }
  }

  private action(operationId: string, workspaceId: string, kind: WorkspaceMutationKind, sources: ResolvedWorkspaceEntry[],
    target: WorkspaceDestination | undefined, overwrite: boolean): WorkspaceMutationAction {
    const affectedPaths = [...new Set([...sources.map(source => source.resolvedPath), ...(target ? [target.resolvedPath] : [])])]
    return { operationId, workspaceId, kind,
      sources: sources.map(source => ({ entryId: source.entryId, resolvedPath: source.resolvedPath, kind: source.kind })),
      ...(target ? { target } : {}), affectedPaths, overwrite }
  }

  private aggregate(operationId: string, items: WorkspaceItemResult[]): WorkspaceOperationResult {
    return { operationId, status: operationStatus(items), items,
      affectedPaths: [...new Set(items.flatMap(item => item.affectedPaths))] }
  }

  private runOnce(operationId: string, digest: string, execute: () => Promise<WorkspaceOperationResult>): Promise<WorkspaceOperationResult> {
    validateOperationId(operationId)
    const previous = this.replay.get(operationId)
    if (previous) {
      if (previous.digest !== digest) return Promise.reject(new WorkspaceFilesError('operation-payload-mismatch', '同一 operationId 不能用于不同载荷'))
      return previous.result
    }
    const result = (this.dependencies.aroundOperation ? this.dependencies.aroundOperation(execute) : execute())
      .catch(error => this.aggregate(operationId, [publicFailure(error, { affectedPaths: [] })]))
    this.replay.set(operationId, { digest, result })
    return result
  }

  private entry(workspaceId: string, entryId: string): EntryRecord {
    const entry = this.entries.get(entryId)
    if (!entry || entry.workspaceId !== workspaceId) throw new WorkspaceFilesError('unknown-entry', '文件项句柄无效或不属于该工作区')
    return entry
  }

  private async issueEntry(workspaceId: string, candidate: string, knownKind?: WorkspaceEntryKind, knownStat?: Stats | BigIntStats): Promise<EntryRecord> {
    const resolvedPath = await fs.realpath(candidate)
    this.assertContained(workspaceId, resolvedPath)
    const key = this.entryPathKey(workspaceId, resolvedPath)
    const stat = knownStat ?? await fs.lstat(candidate, { bigint: true })
    const kind = knownKind ?? this.kindOf(stat)
    const identity = this.fileIdentity(stat)
    const existingId = this.entriesByPath.get(key)
    const existing = existingId ? this.entry(workspaceId, existingId) : undefined
    if (existing && existing.identity === identity) return existing
    // A watcher may discover a physical rename before the application performed it.
    // Keep its handle, including descendants of a renamed directory, so UI selection
    // and expansion continue to refer to the same item. A hard link still present at
    // the old path is a distinct tree item and must receive its own handle.
    if (identity) {
      const matches = [...(this.entriesByIdentity.get(this.identityKey(workspaceId, identity)) ?? [])]
        .map(entryId => this.entry(workspaceId, entryId)).filter(entry => entry.kind === kind)
      const missing = [] as EntryRecord[]
      for (const entry of matches) {
        if (await fs.lstat(entry.resolvedPath).then(() => false, isMissing)) missing.push(entry)
      }
      if (missing.length === 1) {
        const previous = missing[0]!
        if (existing && existing.entryId !== previous.entryId) this.forgetTree(workspaceId, resolvedPath)
        if (kind === 'directory') this.moveRememberedTree(workspaceId, previous.resolvedPath, resolvedPath)
        else this.remember({ ...previous, resolvedPath })
        return this.entry(workspaceId, previous.entryId)
      }
    }
    if (existing && existing.identity === undefined) {
      const updated = { ...existing, kind, identity }
      this.remember(updated)
      return updated
    }
    if (existing) this.forgetTree(workspaceId, resolvedPath)
    const entry = { workspaceId, entryId: this.createId(), kind, resolvedPath, identity }
    this.remember(entry)
    return entry
  }

  private fileIdentity(stat: Stats | BigIntStats): string | undefined {
    return stat.ino ? `${stat.dev}:${stat.ino}` : undefined
  }

  private async provisionalEntry(workspaceId: string, resolvedPath: string, kind: WorkspaceEntryKind): Promise<EntryRecord> {
    const identity = this.fileIdentity(await fs.lstat(resolvedPath, { bigint: true }))
    const existingId = this.entriesByPath.get(this.entryPathKey(workspaceId, resolvedPath))
    if (existingId) this.forgetTree(workspaceId, resolvedPath)
    return { workspaceId, entryId: this.createId(), kind, resolvedPath, identity }
  }

  private remember(entry: EntryRecord): void {
    const previous = this.entries.get(entry.entryId)
    if (previous) {
      this.entriesByPath.delete(this.entryPathKey(previous.workspaceId, previous.resolvedPath))
      this.forgetIdentity(previous)
    }
    this.entries.set(entry.entryId, entry)
    this.entriesByPath.set(this.entryPathKey(entry.workspaceId, entry.resolvedPath), entry.entryId)
    if (entry.identity) {
      const key = this.identityKey(entry.workspaceId, entry.identity)
      const known = this.entriesByIdentity.get(key) ?? new Set<string>()
      known.add(entry.entryId)
      this.entriesByIdentity.set(key, known)
    }
  }

  private rememberedTree(workspaceId: string, source: string): EntryRecord[] {
    return [...this.entries.values()].filter(entry => entry.workspaceId === workspaceId && this.isSameOrDescendant(entry.resolvedPath, source))
  }

  private async rememberedIdentities(workspaceId: string, source: string, target: string): Promise<Map<string, string | undefined>> {
    const identities = new Map<string, string | undefined>()
    for (const entry of this.rememberedTree(workspaceId, source)) {
      const relative = path.relative(source, entry.resolvedPath)
      const stat = await fs.lstat(relative ? path.join(target, relative) : target, { bigint: true })
      identities.set(entry.entryId, this.fileIdentity(stat))
    }
    return identities
  }

  private updateRememberedIdentities(workspaceId: string, root: string, identities: Map<string, string | undefined>): void {
    for (const entry of this.rememberedTree(workspaceId, root)) {
      this.forgetIdentity(entry)
      entry.identity = identities.get(entry.entryId)
      if (!entry.identity) continue
      const key = this.identityKey(workspaceId, entry.identity)
      const known = this.entriesByIdentity.get(key) ?? new Set<string>()
      known.add(entry.entryId)
      this.entriesByIdentity.set(key, known)
    }
  }

  private moveRememberedTree(workspaceId: string, source: string, target: string,
    copiedIdentities?: Map<string, string | undefined>, targetWorkspaceId = workspaceId): void {
    const records = this.rememberedTree(workspaceId, source)
    for (const entry of records) {
      const relative = path.relative(source, entry.resolvedPath)
      this.remember({ ...entry, workspaceId: targetWorkspaceId,
        resolvedPath: relative ? path.join(target, relative) : target,
        identity: copiedIdentities?.get(entry.entryId) ?? entry.identity })
    }
  }

  private forgetTree(workspaceId: string, root: string): void {
    for (const entry of [...this.entries.values()]) if (entry.workspaceId === workspaceId && this.isSameOrDescendant(entry.resolvedPath, root)) {
      this.entries.delete(entry.entryId)
      this.entriesByPath.delete(this.entryPathKey(workspaceId, entry.resolvedPath))
      this.forgetIdentity(entry)
    }
  }

  private forgetIdentity(entry: EntryRecord): void {
    if (!entry.identity) return
    const key = this.identityKey(entry.workspaceId, entry.identity)
    const known = this.entriesByIdentity.get(key)
    known?.delete(entry.entryId)
    if (!known?.size) this.entriesByIdentity.delete(key)
  }

  private kindOf(stat: Stats | BigIntStats): WorkspaceEntryKind {
    if (stat.isDirectory()) return 'directory'
    if (stat.isFile()) return 'file'
    throw new WorkspaceFilesError('unsupported-entry', '仅支持普通文件和目录')
  }

  private assertContained(workspaceId: string, candidate: string): void {
    const root = this.registeredRoot(workspaceId).resolvedPath
    if (!this.isSameOrDescendant(candidate, root)) throw new WorkspaceFilesError('outside-workspace', '路径的真实位置超出已授权工作区')
  }

  private isSameOrDescendant(candidate: string, parent: string): boolean {
    const relative = path.relative(this.pathKey(parent), this.pathKey(candidate))
    return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  }

  private pathKey(value: string): string {
    const normalized = path.normalize(value)
    return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
  }

  private entryPathKey(workspaceId: string, resolvedPath: string): string { return `${workspaceId}\u0000${this.pathKey(resolvedPath)}` }
  private identityKey(workspaceId: string, identity: string): string { return `${workspaceId}\u0000${identity}` }

  private temporarySibling(target: string, operationId: string): string {
    const safe = createHash('sha256').update(operationId).digest('hex').slice(0, 12)
    return path.join(path.dirname(target), `.${path.basename(target)}.g20-${safe}-${this.createId()}.tmp`)
  }
}
