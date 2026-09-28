import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { DocumentSnapshot } from '../../shared/workbench/document'
import type { ExportFormat } from '../../shared/workbench/toolPorts'
import type { ToolRunGrant } from '../../shared/workbench/tools'
import { isInsideRoot } from '../../shared/workbench/executionPermission'
import { EXPORT_MAX_BYTES } from '../../shared/workbench/documentDelivery'
import { startDirectory } from './execution/AgentFileService'

type FileAccess = ToolRunGrant['fileAccess']

async function authorizedPath(candidate: string, scope: FileAccess, bindingDirectory?: string): Promise<string> {
  if (!path.isAbsolute(candidate) || candidate.includes('\u0000')) throw new Error('目标必须是有效的绝对路径')
  const parent = await fs.realpath(path.dirname(candidate))
  if (!(await fs.lstat(parent)).isDirectory()) throw new Error('目标文件夹不可用')
  if (scope?.permission === 'read-only') throw new Error('只读任务不能写入文件')
  if (scope?.permission === 'workspace') {
    if (!scope.workspaceRoot || !isInsideRoot(await fs.realpath(scope.workspaceRoot), parent))
      throw new Error('目标位于工作空间外；当前工具没有此文件夹的写入授权')
  } else if (!scope && (!bindingDirectory || parent !== bindingDirectory)) {
    throw new Error('外部连接没有此导出目录的写入授权')
  }
  return path.join(parent, path.basename(candidate))
}

async function preferredDirectory(scope: NonNullable<FileAccess>): Promise<string> {
  if (!scope.workspaceRoot) throw new Error('本次任务没有已冻结的工作空间目录')
  const preferred = startDirectory({ workspaceRoot: scope.workspaceRoot,
    conversationHomeRoot: scope.conversationHomeRoot, conversationHome: scope.conversationHome }).directory
  try { return await fs.realpath(preferred) }
  catch (error) {
    if (preferred === scope.workspaceRoot || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return fs.realpath(scope.workspaceRoot)
  }
}

export async function resolveSaveDestination(
  runId: string, snapshot: DocumentSnapshot, requested: string | undefined,
  fileAccess: (runId: string) => FileAccess,
): Promise<string | undefined> {
  const scope = fileAccess(runId)
  if (scope?.permission === 'read-only') throw new Error('只读任务不能保存文件')
  if (!requested && snapshot.binding.kind === 'file') {
    if (scope?.permission === 'workspace' && scope.workspaceRoot
      && !isInsideRoot(await fs.realpath(scope.workspaceRoot), await fs.realpath(path.dirname(snapshot.binding.path)))
      && scope.boundPaths?.[snapshot.documentId] !== snapshot.binding.path)
      throw new Error('文档文件绑定已移到工作空间外，请重新发起任务并批准')
    // Pin the exact binding. A concurrent Save As cannot redirect this queued save.
    return snapshot.binding.path
  }
  if (!scope && requested) throw new Error('外部连接只可保存原绑定文件')
  const base = snapshot.binding.kind === 'file' ? path.dirname(snapshot.binding.path)
    : scope ? await preferredDirectory(scope) : null
  if (!base) throw new Error('未命名文档没有已授权的保存文件夹')
  const desired = requested ? path.resolve(base, requested)
    : path.join(base, snapshot.binding.kind === 'untitled' ? snapshot.binding.suggestedName : '')
  const bindingDirectory = snapshot.binding.kind === 'file' ? await fs.realpath(path.dirname(snapshot.binding.path)) : undefined
  return authorizedPath(desired, scope, bindingDirectory)
}

export async function resolveExportDestination(
  runId: string, snapshot: DocumentSnapshot, requested: string | undefined,
  suggestedName: string, _format: ExportFormat, fileAccess: (runId: string) => FileAccess,
): Promise<string | null> {
  const scope = fileAccess(runId)
  if (scope?.permission === 'read-only') throw new Error('只读任务不能导出文件')
  // An external document grant authorizes reading/generating, not a new disk path.
  if (!scope) {
    if (requested) throw new Error('外部连接没有此导出目录的写入授权')
    return null
  }
  const base = snapshot.binding.kind === 'file' ? path.dirname(snapshot.binding.path) : await preferredDirectory(scope)
  const desired = requested ? path.resolve(base, requested) : path.join(base, suggestedName)
  if (!requested && snapshot.binding.kind === 'file' && scope.permission === 'workspace') {
    const bound = await fs.realpath(base)
    if (scope.workspaceRoot && !isInsideRoot(await fs.realpath(scope.workspaceRoot), bound)) {
      if (scope.boundPaths?.[snapshot.documentId] !== snapshot.binding.path)
        throw new Error('文档文件绑定已移到工作空间外，请重新发起任务并批准')
      // Only the original outside document could have received Engine approval.
      return path.join(bound, suggestedName)
    }
  }
  return authorizedPath(desired, scope)
}

function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }

export const workbenchExportWriter = {
  async inspect(filename: string): Promise<{ fileVersion: string; sha256: string } | null> {
    let stat
    try { stat = await fs.lstat(filename) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('导出目标不是普通文件')
    if (stat.size > EXPORT_MAX_BYTES) return { fileVersion: 'oversize', sha256: 'oversize' }
    const digest = sha256(await fs.readFile(filename))
    return { fileVersion: digest, sha256: digest }
  },
  async writeNew(filename: string, bytes: Uint8Array, signal?: AbortSignal): Promise<{ fileVersion: string }> {
    if (bytes.byteLength === 0 || bytes.byteLength > EXPORT_MAX_BYTES) throw new Error('导出字节大小无效')
    signal?.throwIfAborted()
    const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${randomUUID()}.tmp`)
    try {
      const handle = await fs.open(temporary, 'wx')
      try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
      // Hard-link publication is atomic and fails if the target already exists.
      signal?.throwIfAborted()
      await fs.link(temporary, filename)
      return { fileVersion: sha256(bytes) }
    } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
  },
}
