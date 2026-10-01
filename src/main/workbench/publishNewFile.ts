import { promises as fs, existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { DocumentSaveFailure } from '../../shared/workbench/documentSave'

/** Same-file identity for correlated recovery, never content equality alone. */
export async function publicationIdentity(filename: string): Promise<string | null> {
  const stat = await fs.lstat(filename, { bigint: true })
  return stat.isFile() && !stat.isSymbolicLink() && stat.ino !== 0n ? `${stat.dev}:${stat.ino}` : null
}

const execute = promisify(execFile)
const key = (name: string) => process.platform === 'win32' ? path.resolve(name).toLowerCase() : path.resolve(name)
const nativeCode = (code: number) => ({ 2: 'ENOENT', 3: 'ENOENT', 5: 'EACCES', 17: 'EXDEV', 19: 'EROFS',
  32: 'EBUSY', 33: 'EBUSY', 50: 'ENOTSUP', 80: 'EEXIST', 87: 'EINVAL', 112: 'ENOSPC', 183: 'EEXIST' } as Record<number, string>)[code]

/** Fixed trusted helper. Only a complete, flushed, same-directory temporary file can be published. */
export async function moveNewFile(source: string, target: string, onlyWithoutHardLinks = true): Promise<boolean> {
  if (process.platform !== 'win32') throw new Error('Windows publication primitive unavailable')
  const packaged = process.resourcesPath ? path.join(process.resourcesPath, 'file-publish/file-publish.exe') : ''
  const helper = packaged && existsSync(packaged) ? packaged : path.resolve(__dirname, '../../../resources/file-publish/file-publish.exe')
  let stdout: string
  try { ({ stdout } = await execute(helper, [source, target, onlyWithoutHardLinks ? 'no-hardlinks-only' : 'same-directory'],
    { windowsHide: true, encoding: 'utf8', maxBuffer: 4096 })) }
  catch (error) {
    throw new DocumentSaveFailure((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'not-published' : 'unknown', error)
  }
  let reply: { status?: string; code?: number }
  try { reply = JSON.parse(stdout.replace(/^\uFEFF/, '')) } catch (error) { throw new DocumentSaveFailure('unknown', error) }
  if (reply.status === 'hardlinks-supported') return false
  if (reply.status === 'published') return true
  const code = nativeCode(reply.code ?? 0)
  throw new DocumentSaveFailure(reply.status === 'rejected' && code ? 'not-published' : 'unknown',
    Object.assign(new Error(`文件尚未发布（${code ?? reply.code ?? 'unknown'}）；原目标与完整候选已保留`), { code }))
}

/** No-overwrite publication shared by document, attachment and export owners. */
export async function publishNewFile(source: string, target: string,
  options: { moveNew?: typeof moveNewFile } = {}): Promise<void> {
  if (key(path.dirname(source)) !== key(path.dirname(target)) || key(source) === key(target))
    throw new DocumentSaveFailure('not-published', new Error('新文件发布要求同目录的独立候选'))
  try { await fs.link(source, target) }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    // EPERM is not itself proof of a FAT/exFAT volume. The helper checks the
    // volume capability before selecting the alternate no-replace primitive.
    if (process.platform === 'win32' && ['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS'].includes(code ?? '')
      && await (options.moveNew ?? moveNewFile)(source, target)) return
    // A rejected link syscall has not published bytes. Preserve uncertainty for
    // interrupted I/O or an unclassified failure instead of inferring from paths.
    const rejected = ['EEXIST', 'EACCES', 'EPERM', 'ENOSPC', 'EROFS', 'EXDEV', 'ENOTSUP',
      'EOPNOTSUPP', 'ENOSYS', 'ENOENT', 'EBUSY', 'EINVAL', 'ENOTDIR', 'EISDIR', 'ENAMETOOLONG',
      'EDQUOT', 'EMLINK'].includes(code ?? '')
    throw new DocumentSaveFailure(rejected ? 'not-published' : 'unknown', error)
  }
}
