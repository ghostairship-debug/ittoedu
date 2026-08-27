import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { strToU8, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronState = vi.hoisted(() => ({
  userDataPath: '',
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error(`Unexpected Electron path: ${name}`)
      return electronState.userDataPath
    },
  },
  dialog: {
    showOpenDialog: electronState.showOpenDialog,
    showSaveDialog: electronState.showSaveDialog,
  },
}))

import { REBUILD_USER_DATA_DIRECTORY_NAME } from '../../src/main/applicationIdentity'
import {
  confirmProjectOpen,
  openProjectFile,
  openRecentProjectFile,
  saveProjectFile,
} from '../../src/main/fileDialogs'
import {
  listRecentProjects,
  MAX_RECOVERY_PROJECT_BYTES,
  readRecoveryProject,
  recordRecentProject,
  writeRecoveryProject,
} from '../../src/main/projectPersistence'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import {
  createCourseProjectArchive,
  detectCourseProjectArchiveFormat,
} from '../../src/renderer/project/courseProjectArchive'

function makeV9RecoveryArchive(label: string): Uint8Array {
  const project = createBlankCourseProject()
  project.title = label
  project.id = `recovery-${label}`
  return createCourseProjectArchive({
    project,
    assetFiles: {},
    componentFiles: {},
  })
}

function makeArchive(label: string): Uint8Array {
  return zipSync({
    'project.json': strToU8(JSON.stringify({ label })),
  })
}

async function writeProjectFile(filePath: string, label: string): Promise<Uint8Array> {
  const bytes = makeArchive(label)
  await fs.writeFile(filePath, bytes)
  return bytes
}

describe('projectPersistence', () => {
  let testRoot = ''

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'h5lesson-persistence-'))
    electronState.userDataPath = testRoot
    electronState.showOpenDialog.mockReset()
    electronState.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    electronState.showSaveDialog.mockReset()
    electronState.showSaveDialog.mockResolvedValue({ canceled: true })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    electronState.userDataPath = ''
    if (testRoot) await fs.rm(testRoot, { recursive: true, force: true })
  })

  it('原子写入并读取恢复包，覆盖旧快照后不遗留临时文件', async () => {
    const sourcePath = path.join(testRoot, '课堂演示.h5lesson')
    const first = makeV9RecoveryArchive('first')
    const second = makeV9RecoveryArchive('second')

    await writeRecoveryProject({
      projectName: '课堂演示.h5lesson',
      projectPath: sourcePath,
      bytes: first,
    })
    await writeRecoveryProject({
      projectName: '课堂演示-新版本.h5lesson',
      projectPath: sourcePath,
      bytes: second,
    })

    const restored = await readRecoveryProject()
    expect(restored).not.toBeNull()
    expect(restored).toMatchObject({
      projectName: '课堂演示-新版本.h5lesson',
      projectPath: sourcePath,
    })
    expect([...restored!.bytes]).toEqual([...second])
    expect(restored!.savedAt).toBeGreaterThan(0)

    const storagePath = path.join(testRoot, 'project-data')
    const files = await fs.readdir(storagePath)
    expect(files.sort()).toEqual(['recovery.h5lesson', 'recovery.json'])
    expect(files.some((name) => name.endsWith('.tmp'))).toBe(false)

    const metadata = JSON.parse(
      await fs.readFile(path.join(storagePath, 'recovery.json'), 'utf8'),
    ) as { sha256: string }
    expect(metadata.sha256).toBe(
      crypto.createHash('sha256').update(second).digest('hex'),
    )
  })

  it('检测哈希不匹配并安全降级，遇到损坏 ZIP 时清除恢复数据', async () => {
    const original = makeV9RecoveryArchive('original')
    const newerValidPackage = makeV9RecoveryArchive('newer')
    await writeRecoveryProject({
      projectName: '原始工程.h5lesson',
      projectPath: path.join(testRoot, '原始工程.h5lesson'),
      bytes: original,
    })

    const storagePath = path.join(testRoot, 'project-data')
    const packagePath = path.join(storagePath, 'recovery.h5lesson')
    const metadataPath = path.join(storagePath, 'recovery.json')
    await fs.writeFile(packagePath, newerValidPackage)

    const mismatched = await readRecoveryProject()
    expect(mismatched).toMatchObject({
      projectName: '恢复的课件.h5lesson',
      projectPath: undefined,
    })
    expect([...mismatched!.bytes]).toEqual([...newerValidPackage])

    await fs.writeFile(packagePath, new Uint8Array([0x50, 0x4b, 0, 0]))
    expect(await readRecoveryProject()).toBeNull()
    await expect(fs.access(packagePath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.access(metadataPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('拒绝空包、超限包和伪 ZIP 恢复数据', async () => {
    await expect(
      writeRecoveryProject({
        projectName: '空工程.h5lesson',
        bytes: new Uint8Array(),
      }),
    ).rejects.toMatchObject({ code: 'RECOVERY_SIZE_INVALID' })

    const oversized = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    Object.defineProperty(oversized, 'byteLength', {
      value: MAX_RECOVERY_PROJECT_BYTES + 1,
    })
    await expect(
      writeRecoveryProject({
        projectName: '超限工程.h5lesson',
        bytes: oversized,
      }),
    ).rejects.toMatchObject({ code: 'RECOVERY_SIZE_INVALID' })

    await expect(
      writeRecoveryProject({
        projectName: '伪造工程.h5lesson',
        bytes: new Uint8Array([1, 2, 3, 4]),
      }),
    ).rejects.toMatchObject({ code: 'RECOVERY_ARCHIVE_INVALID' })
  })

  it('最近工程去重、按最近时间排序并限制为十二项', async () => {
    const projects = Array.from({ length: 14 }, (_, index) =>
      path.join(testRoot, `lesson-${index}.h5lesson`),
    )
    await Promise.all(
      projects.map((filePath, index) => writeProjectFile(filePath, String(index))),
    )

    let timestamp = 1_800_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => ++timestamp)
    for (const filePath of projects) await recordRecentProject(filePath)
    await recordRecentProject(projects[5]!)

    const recent = await listRecentProjects()
    expect(recent).toHaveLength(12)
    expect(recent[0]?.path).toBe(projects[5])
    expect(new Set(recent.map((entry) => entry.path)).size).toBe(12)
    expect(recent.map((entry) => entry.lastOpenedAt)).toEqual(
      [...recent.map((entry) => entry.lastOpenedAt)].sort((a, b) => b - a),
    )

    const persisted = JSON.parse(
      await fs.readFile(
        path.join(testRoot, 'project-data', 'recent-projects.json'),
        'utf8',
      ),
    ) as { projects: unknown[] }
    expect(persisted.projects).toHaveLength(12)
  })

  it('过滤已经缺失的工程，并同步清理持久化列表', async () => {
    const existingPath = path.join(testRoot, 'existing.h5lesson')
    const missingPath = path.join(testRoot, 'missing.h5lesson')
    await writeProjectFile(existingPath, 'existing')
    await writeProjectFile(missingPath, 'missing')
    await recordRecentProject(existingPath)
    await recordRecentProject(missingPath)
    await fs.unlink(missingPath)

    expect(await listRecentProjects()).toEqual([
      expect.objectContaining({ path: existingPath, name: 'existing.h5lesson' }),
    ])

    const persisted = JSON.parse(
      await fs.readFile(
        path.join(testRoot, 'project-data', 'recent-projects.json'),
        'utf8',
      ),
    ) as { projects: Array<{ path: string }> }
    expect(persisted.projects.map((entry) => entry.path)).toEqual([existingPath])
  })

  it('最近工程打开只接受白名单路径，并在通过后校验和读取 ZIP', async () => {
    const approvedPath = path.join(testRoot, 'approved.h5lesson')
    const unlistedPath = path.join(testRoot, 'unlisted.h5lesson')
    const approvedBytes = await writeProjectFile(approvedPath, 'approved')
    await writeProjectFile(unlistedPath, 'unlisted')

    await expect(openRecentProjectFile(unlistedPath)).rejects.toMatchObject({
      code: 'RECENT_PROJECT_NOT_ALLOWED',
    })

    await recordRecentProject(approvedPath)
    const opened = await openRecentProjectFile(approvedPath)
    expect(opened.path).toBe(approvedPath)
    expect(opened.name).toBe('approved.h5lesson')
    expect([...opened.bytes]).toEqual([...approvedBytes])

    await fs.writeFile(approvedPath, new Uint8Array([0x50, 0x4b, 0, 0]))
    await expect(openRecentProjectFile(approvedPath)).rejects.toMatchObject({
      code: 'PROJECT_ARCHIVE_INVALID',
    })
  })

  it('新选择只授权路径，确认幂等记录且成功保存只再记录一次', async () => {
    const selectedPath = path.join(testRoot, 'selected.h5lesson')
    const bytes = makeV9RecoveryArchive('selected')
    await fs.writeFile(selectedPath, bytes)
    electronState.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [selectedPath],
    })
    let timestamp = 1_800_000_000_000
    const now = vi.spyOn(Date, 'now').mockImplementation(() => ++timestamp)

    const opened = await openProjectFile({} as Parameters<typeof openProjectFile>[0])
    expect(opened).not.toBeNull()
    expect(opened).toMatchObject({
      path: selectedPath,
      name: 'selected.h5lesson',
      confirmationId: expect.any(String),
    })
    expect(await listRecentProjects()).toEqual([])

    await Promise.all([
      confirmProjectOpen(opened!.confirmationId),
      confirmProjectOpen(opened!.confirmationId),
    ])
    const confirmed = await listRecentProjects()
    expect(confirmed).toHaveLength(1)
    expect(confirmed[0]).toMatchObject({ path: selectedPath })
    const confirmedAt = confirmed[0]!.lastOpenedAt
    expect(now).toHaveBeenCalledTimes(1)

    await confirmProjectOpen(opened!.confirmationId)
    expect((await listRecentProjects())[0]?.lastOpenedAt).toBe(confirmedAt)
    expect(now).toHaveBeenCalledTimes(1)

    await fs.unlink(selectedPath)
    await expect(saveProjectFile(
      {} as Parameters<typeof saveProjectFile>[0],
      {
        path: selectedPath,
        suggestedName: 'selected.h5lesson',
        bytes,
      },
    )).resolves.toEqual({ path: selectedPath })
    expect(electronState.showSaveDialog).not.toHaveBeenCalled()
    expect((await listRecentProjects())[0]?.lastOpenedAt).toBeGreaterThan(confirmedAt)
    expect(now).toHaveBeenCalledTimes(2)
  })

  it('最近工程候选在 Renderer 确认前不提升，同一确认只提升一次', async () => {
    const recentPath = path.join(testRoot, 'recent-candidate.h5lesson')
    await fs.writeFile(recentPath, makeV9RecoveryArchive('recent-candidate'))
    let timestamp = 1_900_000_000_000
    const now = vi.spyOn(Date, 'now').mockImplementation(() => ++timestamp)
    await recordRecentProject(recentPath)
    const originalOpenedAt = (await listRecentProjects())[0]!.lastOpenedAt

    const opened = await openRecentProjectFile(recentPath)
    expect((await listRecentProjects())[0]?.lastOpenedAt).toBe(originalOpenedAt)
    expect(now).toHaveBeenCalledTimes(1)

    await Promise.all([
      confirmProjectOpen(opened.confirmationId),
      confirmProjectOpen(opened.confirmationId),
    ])
    const promotedAt = (await listRecentProjects())[0]!.lastOpenedAt
    expect(promotedAt).toBeGreaterThan(originalOpenedAt)
    expect(now).toHaveBeenCalledTimes(2)

    await confirmProjectOpen(opened.confirmationId)
    expect((await listRecentProjects())[0]?.lastOpenedAt).toBe(promotedAt)
    expect(now).toHaveBeenCalledTimes(2)
  })

  it('rebuild AppData 目录保持隔离，且恢复层接受当前课程工程 zip', async () => {
    expect(REBUILD_USER_DATA_DIRECTORY_NAME).toBe('ittoedu-courseware-editor-v8-rebuild')
    const bytes = createCourseProjectArchive({
      project: createBlankCourseProject(),
      assetFiles: {},
      componentFiles: {},
    })
    expect(detectCourseProjectArchiveFormat(bytes).kind).toBe('v9')

    await writeRecoveryProject({
      projectName: '当前课程工程.h5lesson',
      bytes,
    })
    const restored = await readRecoveryProject()
    expect(restored).not.toBeNull()
    expect(detectCourseProjectArchiveFormat(restored!.bytes).kind).toBe('v9')
  })
})
