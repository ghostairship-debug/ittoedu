import { isNativeProjectFilename } from '../shared/nativeProjectFile'
import crypto from 'node:crypto'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { unzipSync } from 'fflate'
import { app } from 'electron'
import type {
  RecentProjectEntry,
  RecoveryProjectInput,
  RecoveryProjectResult,
} from '../shared/ipcTypes'
import { COURSE_PROJECT_SCHEMA_VERSION } from '../shared/courseProjectTypes'
import { DesktopOperationError } from './errors'

const MAX_RECENT_PROJECTS = 12
const RECENT_FILE_VERSION = 1
const RECOVERY_METADATA_VERSION = 1
const PROJECT_DOCUMENT_PATH = 'project.json'

interface RecentProjectsFile {
  version: typeof RECENT_FILE_VERSION
  projects: RecentProjectEntry[]
}

interface RecoveryMetadataFile {
  version: typeof RECOVERY_METADATA_VERSION
  projectName: string
  projectPath?: string
  savedAt: number
  sha256: string
}

let persistenceQueue: Promise<void> = Promise.resolve()

function withPersistenceLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = persistenceQueue.then(operation, operation)
  persistenceQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

function persistenceDirectory(): string {
  return path.join(app.getPath('userData'), 'project-data')
}

function recentProjectsPath(): string {
  return path.join(persistenceDirectory(), 'recent-projects.json')
}

function recoveryPackagePath(): string {
  return path.join(persistenceDirectory(), 'recovery.h5lesson')
}

function recoveryMetadataPath(): string {
  return path.join(persistenceDirectory(), 'recovery.json')
}

function canonicalPath(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved
}

function hasProjectExtension(value: string): boolean {
  return isNativeProjectFilename(value)
}

function hasZipSignature(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08))
  )
}

function declaredSchemaVersion(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null
  const version = Reflect.get(value, 'schemaVersion')
  return typeof version === 'number' && Number.isInteger(version) ? version : null
}

type RecoveryArchiveKind = 'v9' | 'unsupported' | 'corrupted'

/** Shallow zip probe for recovery isolation; main must not import renderer archive code. */
function classifyRecoveryArchive(bytes: Uint8Array): RecoveryArchiveKind {
  try {
    const files = unzipSync(bytes)
    const projectBytes = files[PROJECT_DOCUMENT_PATH]
    if (!projectBytes) return 'corrupted'
    const value = JSON.parse(new TextDecoder().decode(projectBytes)) as unknown
    const schemaVersion = declaredSchemaVersion(value)
    if (schemaVersion === COURSE_PROJECT_SCHEMA_VERSION) return 'v9'
    if (schemaVersion !== null) return 'unsupported'
    return 'corrupted'
  } catch {
    return 'corrupted'
  }
}

function isRecoverableCourseProjectArchive(bytes: Uint8Array): boolean {
  return classifyRecoveryArchive(bytes) === 'v9'
}

function recoveryArchiveRejectionError(kind: Exclude<RecoveryArchiveKind, 'v9'>): DesktopOperationError {
  if (kind === 'unsupported') {
    return new DesktopOperationError(
      'RECOVERY_UNSUPPORTED_VERSION',
      '自动恢复保存失败',
      '恢复数据的格式版本不受当前编辑器支持。',
      '请使用能打开该文件的编辑器版本，或从备份恢复。当前不会转换不受支持的工程。',
    )
  }
  return new DesktopOperationError(
    'RECOVERY_ARCHIVE_INVALID',
    '自动恢复保存失败',
    '恢复数据不是有效的 Course Project V9 工程包。',
    '请立即手动保存工程；若问题持续出现，请重新启动编辑器。',
  )
}

function assertRecoverableCourseProjectArchive(bytes: Uint8Array): void {
  const kind = classifyRecoveryArchive(bytes)
  if (kind === 'v9') return
  throw recoveryArchiveRejectionError(kind)
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function parseRecentProject(value: unknown): RecentProjectEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.path !== 'string' ||
    candidate.path.length === 0 ||
    !path.isAbsolute(candidate.path) ||
    !hasProjectExtension(candidate.path) ||
    typeof candidate.name !== 'string' ||
    candidate.name.length === 0 ||
    !isFiniteTimestamp(candidate.lastOpenedAt)
  ) {
    return null
  }
  return {
    path: path.resolve(candidate.path),
    name: path.basename(candidate.path),
    lastOpenedAt: candidate.lastOpenedAt,
  }
}

function parseRecoveryMetadata(value: unknown): RecoveryMetadataFile | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  if (
    candidate.version !== RECOVERY_METADATA_VERSION ||
    typeof candidate.projectName !== 'string' ||
    candidate.projectName.length === 0 ||
    !isFiniteTimestamp(candidate.savedAt) ||
    typeof candidate.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(candidate.sha256)
  ) {
    return null
  }
  if (
    candidate.projectPath !== undefined &&
    (typeof candidate.projectPath !== 'string' ||
      candidate.projectPath.length === 0 ||
      !path.isAbsolute(candidate.projectPath) ||
      !hasProjectExtension(candidate.projectPath))
  ) {
    return null
  }
  return {
    version: RECOVERY_METADATA_VERSION,
    projectName: candidate.projectName,
    projectPath:
      typeof candidate.projectPath === 'string'
        ? path.resolve(candidate.projectPath)
        : undefined,
    savedAt: candidate.savedAt,
    sha256: candidate.sha256,
  }
}

async function atomicWrite(filePath: string, data: Uint8Array | string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`,
  )
  try {
    await fs.writeFile(temporaryPath, data, { flag: 'wx' })
    await fs.rename(temporaryPath, filePath)
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

async function readJsonFile(filePath: string): Promise<unknown> {
  try {
    const stats = await fs.stat(filePath)
    if (!stats.isFile() || stats.size <= 0) return null
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    return null
  }
}

async function readRecentProjectsUnsafe(): Promise<RecentProjectEntry[]> {
  const raw = await readJsonFile(recentProjectsPath())
  if (typeof raw !== 'object' || raw === null) return []
  const file = raw as Record<string, unknown>
  if (file.version !== RECENT_FILE_VERSION || !Array.isArray(file.projects)) return []

  const unique = new Map<string, RecentProjectEntry>()
  for (const item of file.projects) {
    const parsed = parseRecentProject(item)
    if (!parsed) continue
    const key = canonicalPath(parsed.path)
    const existing = unique.get(key)
    if (!existing || parsed.lastOpenedAt > existing.lastOpenedAt) unique.set(key, parsed)
  }
  return [...unique.values()]
    .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
    .slice(0, MAX_RECENT_PROJECTS)
}

async function filterExistingProjects(
  projects: RecentProjectEntry[],
): Promise<RecentProjectEntry[]> {
  const checked = await Promise.all(
    projects.map(async (project) => {
      try {
        const stats = await fs.stat(project.path)
        return stats.isFile() && hasProjectExtension(project.path) ? project : null
      } catch {
        return null
      }
    }),
  )
  return checked.filter((project): project is RecentProjectEntry => project !== null)
}

async function writeRecentProjectsUnsafe(projects: RecentProjectEntry[]): Promise<void> {
  const file: RecentProjectsFile = {
    version: RECENT_FILE_VERSION,
    projects: projects.slice(0, MAX_RECENT_PROJECTS),
  }
  await atomicWrite(recentProjectsPath(), `${JSON.stringify(file, null, 2)}\n`)
}

async function readAndPruneRecentProjectsUnsafe(): Promise<RecentProjectEntry[]> {
  const stored = await readRecentProjectsUnsafe()
  const existing = await filterExistingProjects(stored)
  if (existing.length !== stored.length) await writeRecentProjectsUnsafe(existing)
  return existing
}

export function listRecentProjects(): Promise<RecentProjectEntry[]> {
  return withPersistenceLock(() => readAndPruneRecentProjectsUnsafe())
}

export function recordRecentProject(filePath: string): Promise<void> {
  return withPersistenceLock(async () => {
    const resolved = path.resolve(filePath)
    if (!path.isAbsolute(resolved) || !hasProjectExtension(resolved)) return
    try {
      const stats = await fs.stat(resolved)
      if (!stats.isFile()) return
    } catch {
      return
    }

    const existing = await readAndPruneRecentProjectsUnsafe()
    const key = canonicalPath(resolved)
    const next: RecentProjectEntry[] = [
      {
        path: resolved,
        name: path.basename(resolved),
        lastOpenedAt: Date.now(),
      },
      ...existing.filter((project) => canonicalPath(project.path) !== key),
    ]
    await writeRecentProjectsUnsafe(next)
  })
}

export function resolveRecentProjectPath(requestedPath: string): Promise<string> {
  return withPersistenceLock(async () => {
    const projects = await readAndPruneRecentProjectsUnsafe()
    const requestedKey = canonicalPath(requestedPath)
    const approved = projects.find(
      (project) => canonicalPath(project.path) === requestedKey,
    )
    if (!approved) {
      throw new DesktopOperationError(
        'RECENT_PROJECT_NOT_ALLOWED',
        '最近工程打开失败',
        '该文件不在最近工程列表中，或文件已经被移动。',
        '请使用“打开工程”重新选择该文件。',
      )
    }
    return approved.path
  })
}

export function writeRecoveryProject(input: RecoveryProjectInput): Promise<void> {
  return withPersistenceLock(async () => {
    if (input.bytes.byteLength === 0) {
      throw new DesktopOperationError(
        'RECOVERY_SIZE_INVALID',
        '自动恢复保存失败',
        '恢复工程包为空。',
        '请立即手动保存工程；若问题持续出现，请重新启动编辑器。',
      )
    }
    if (!hasZipSignature(input.bytes)) {
      throw new DesktopOperationError(
        'RECOVERY_ARCHIVE_INVALID',
        '自动恢复保存失败',
        '恢复数据不是有效的 果铃工程。',
        '请立即手动保存工程；若问题持续出现，请重新启动编辑器。',
      )
    }
    assertRecoverableCourseProjectArchive(input.bytes)

    const savedAt = Date.now()
    const digest = crypto.createHash('sha256').update(input.bytes).digest('hex')
    const metadata: RecoveryMetadataFile = {
      version: RECOVERY_METADATA_VERSION,
      projectName: input.projectName,
      projectPath: input.projectPath ? path.resolve(input.projectPath) : undefined,
      savedAt,
      sha256: digest,
    }

    try {
      await atomicWrite(recoveryPackagePath(), input.bytes)
      await atomicWrite(
        recoveryMetadataPath(),
        `${JSON.stringify(metadata, null, 2)}\n`,
      )
    } catch (error) {
      throw new DesktopOperationError(
        'RECOVERY_WRITE_FAILED',
        '自动恢复保存失败',
        '编辑器未能写入本地恢复数据。',
        '请检查磁盘空间并立即手动保存工程。',
        { cause: error },
      )
    }
  })
}

export function readRecoveryProject(): Promise<RecoveryProjectResult | null> {
  return withPersistenceLock(async () => {
    const packagePath = recoveryPackagePath()
    let stats
    try {
      stats = await fs.stat(packagePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      return null
    }
    if (!stats.isFile() || stats.size <= 0) {
      await clearRecoveryProjectUnsafe()
      return null
    }

    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await fs.readFile(packagePath))
    } catch {
      return null
    }
    if (!hasZipSignature(bytes)) {
      await clearRecoveryProjectUnsafe()
      return null
    }
    if (!isRecoverableCourseProjectArchive(bytes)) {
      await clearRecoveryProjectUnsafe()
      return null
    }

    const digest = crypto.createHash('sha256').update(bytes).digest('hex')
    const rawMetadata = await readJsonFile(recoveryMetadataPath())
    const metadata = parseRecoveryMetadata(rawMetadata)
    const matchingMetadata = metadata?.sha256 === digest ? metadata : null
    return {
      projectName: matchingMetadata?.projectName ?? '恢复的 果铃工程.glx',
      projectPath: matchingMetadata?.projectPath,
      savedAt: matchingMetadata?.savedAt ?? stats.mtimeMs,
      bytes,
    }
  })
}

async function clearRecoveryProjectUnsafe(): Promise<void> {
  await Promise.all([
    fs.unlink(recoveryPackagePath()).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    }),
    fs.unlink(recoveryMetadataPath()).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    }),
  ])
}

export function clearRecoveryProject(): Promise<void> {
  return withPersistenceLock(async () => {
    try {
      await clearRecoveryProjectUnsafe()
    } catch (error) {
      throw new DesktopOperationError(
        'RECOVERY_CLEAR_FAILED',
        '恢复数据清理失败',
        '编辑器未能清理已经处理的恢复数据。',
        '请重新启动编辑器后再试。',
        { cause: error },
      )
    }
  })
}
