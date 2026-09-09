import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

type FileStamp = { size: number; mtimeMs: number; ctimeMs: number; ino: number }
type Baseline = { digest: string; stamp?: FileStamp }
export interface ProjectFileStatus { status: 'current' | 'changed' | 'unavailable'; message: string }
const loaded = new Map<string, Baseline>()
const key = (filename: string) => process.platform === 'win32' ? path.resolve(filename).toLowerCase() : path.resolve(filename)
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const sameStamp = (a: FileStamp, b: FileStamp) => a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.ino === b.ino

/** Identity of the actual bytes read or written by the existing project lifecycle. */
export function rememberProjectFileBytes(filename: string, bytes: Uint8Array): void {
  loaded.set(key(filename), { digest: digest(bytes) })
}
export function prepareProjectFileObservation(filename: string, bytes: Uint8Array): () => void {
  const baseline = { digest: digest(bytes) }
  return () => { loaded.set(key(filename), baseline) }
}

export async function projectFileStatus(filename: string): Promise<ProjectFileStatus> {
  const baseline = loaded.get(key(filename))
  if (!baseline) return { status: 'unavailable', message: '当前工程缺少已打开文件的身份，请重新打开或另存为后继续' }
  try {
    const stamp = await fs.stat(filename)
    if (!stamp.isFile()) return { status: 'changed', message: '工程文件已被替换或删除' }
    if (baseline.stamp && sameStamp(stamp, baseline.stamp)) return { status: 'current', message: '工程文件与已打开版本一致' }
    // Compare content only after an actual file-state change or the first check.
    if (stamp.size > 256 * 1024 * 1024) return { status: 'changed', message: '磁盘工程文件已被外部程序替换' }
    const bytes = await fs.readFile(filename)
    const after = await fs.stat(filename)
    if (!sameStamp(stamp, after) || digest(bytes) !== baseline.digest) return { status: 'changed', message: '磁盘工程已被 CLI 或其他程序修改；内存草稿已保留，请另存为或重新打开磁盘版本' }
    baseline.stamp = after
    return { status: 'current', message: '工程文件与已打开版本一致' }
  } catch { return { status: 'changed', message: '工程文件已被删除、移动或暂时无法读取；内存草稿已保留' } }
}

export async function assertProjectFileCurrent(filename: string): Promise<void> {
  const status = await projectFileStatus(filename)
  if (status.status !== 'current') throw new Error(`stale：${status.message}`)
}
