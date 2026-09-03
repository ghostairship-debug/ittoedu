import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { strToU8, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import {
  createCourseProjectArchive,
  detectCourseProjectArchiveFormat,
} from '@/renderer/project/courseProjectArchive'
import { shouldOfferCourseProjectRecovery } from '@/renderer/project/courseProjectLifecycle'
import { COURSE_PROJECT_REJECTION_INPUTS } from '../fixtures/course-project-v9'
import { REBUILD_USER_DATA_DIRECTORY_NAME } from '../../src/main/applicationIdentity'
import {
  readRecoveryProject,
  writeRecoveryProject,
} from '../../src/main/projectPersistence'

const electronState = vi.hoisted(() => ({
  userDataPath: '',
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error(`Unexpected Electron path: ${name}`)
      return electronState.userDataPath
    },
  },
  dialog: {},
}))

function makeV8ArchiveBytes(): Uint8Array {
  return COURSE_PROJECT_REJECTION_INPUTS['v8-unsupported']
}

function makeV9ArchiveBytes(): Uint8Array {
  return createCourseProjectArchive({
    project: createBlankCourseProject(),
    assetFiles: {},
    componentFiles: {},
  })
}

function makeFutureVersionArchiveBytes(): Uint8Array {
  return zipSync({
    'project.json': strToU8(
      JSON.stringify({
        schemaVersion: 10,
        id: 'future-recovery',
        revision: 0,
        locations: [],
        surfaces: [],
      }),
    ),
  })
}

describe('projectFormatIsolation', () => {
  let testRoot = ''

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'h5lesson-format-isolation-'))
    electronState.userDataPath = testRoot
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    electronState.userDataPath = ''
    if (testRoot) await fs.rm(testRoot, { recursive: true, force: true })
  })

  it('rebuild AppData 目录名与共享产品隔离', () => {
    expect(REBUILD_USER_DATA_DIRECTORY_NAME).toBe('ittoedu-courseware-editor-v8-rebuild')
    expect(REBUILD_USER_DATA_DIRECTORY_NAME).not.toBe('ittoedu-courseware-editor')
  })

  it('读层拒绝 V8 recovery 并清除本地副本', async () => {
    const v8Bytes = makeV8ArchiveBytes()
    expect(detectCourseProjectArchiveFormat(v8Bytes).kind).toBe('unsupported')

    const storagePath = path.join(testRoot, 'project-data')
    await fs.mkdir(storagePath, { recursive: true })
    const packagePath = path.join(storagePath, 'recovery.h5lesson')
    const metadataPath = path.join(storagePath, 'recovery.json')
    await fs.writeFile(packagePath, v8Bytes)
    await fs.writeFile(
      metadataPath,
      `${JSON.stringify({
        version: 1,
        projectName: '旧版.h5lesson',
        savedAt: Date.now(),
        sha256: crypto.createHash('sha256').update(v8Bytes).digest('hex'),
      })}\n`,
    )

    expect(await readRecoveryProject()).toBeNull()
    await expect(fs.access(packagePath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.access(metadataPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('读层拒绝未来 schemaVersion recovery 并清除本地副本', async () => {
    const futureBytes = makeFutureVersionArchiveBytes()
    expect(detectCourseProjectArchiveFormat(futureBytes).kind).toBe('unsupported')

    const storagePath = path.join(testRoot, 'project-data')
    await fs.mkdir(storagePath, { recursive: true })
    const packagePath = path.join(storagePath, 'recovery.h5lesson')
    const metadataPath = path.join(storagePath, 'recovery.json')
    await fs.writeFile(packagePath, futureBytes)
    await fs.writeFile(
      metadataPath,
      `${JSON.stringify({
        version: 1,
        projectName: '未来版本.h5lesson',
        savedAt: Date.now(),
        sha256: crypto.createHash('sha256').update(futureBytes).digest('hex'),
      })}\n`,
    )

    expect(await readRecoveryProject()).toBeNull()
    await expect(fs.access(packagePath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.access(metadataPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('写层只接受 Course Project V9 recovery 包', async () => {
    const v8Bytes = makeV8ArchiveBytes()
    await expect(
      writeRecoveryProject({
        projectName: '旧版.h5lesson',
        bytes: v8Bytes,
      }),
    ).rejects.toMatchObject({ code: 'RECOVERY_UNSUPPORTED_VERSION' })

    const futureBytes = makeFutureVersionArchiveBytes()
    await expect(
      writeRecoveryProject({
        projectName: '未来.h5lesson',
        bytes: futureBytes,
      }),
    ).rejects.toMatchObject({ code: 'RECOVERY_UNSUPPORTED_VERSION' })

    const v9Bytes = makeV9ArchiveBytes()
    await writeRecoveryProject({
      projectName: '当前课程.h5lesson',
      bytes: v9Bytes,
    })
    const restored = await readRecoveryProject()
    expect(restored).not.toBeNull()
    expect(detectCourseProjectArchiveFormat(restored!.bytes).kind).toBe('v9')
  })

  it('lifecycle 层对 V8 recovery 返回 ignore-legacy-default，V9 可 offer', () => {
    expect(
      shouldOfferCourseProjectRecovery({
        recovery: {
          schemaVersion: 8,
          projectId: 'legacy',
          revision: 0,
          updatedAt: null,
          title: null,
        },
        official: null,
      }),
    ).toBe('ignore-legacy-default')

    expect(
      shouldOfferCourseProjectRecovery({
        recovery: {
          schemaVersion: 10,
          projectId: 'future',
          revision: 0,
          updatedAt: null,
          title: null,
        },
        official: null,
      }),
    ).toBe('ignore-legacy-default')

    expect(
      shouldOfferCourseProjectRecovery({
        recovery: {
          schemaVersion: 9,
          projectId: 'current',
          revision: 2,
          updatedAt: '2026-08-17T12:00:00.000Z',
          title: '当前',
        },
        official: {
          schemaVersion: 9,
          projectId: 'current',
          revision: 1,
          updatedAt: '2026-08-17T11:00:00.000Z',
          title: '当前',
        },
      }),
    ).toBe('offer')
  })
})
