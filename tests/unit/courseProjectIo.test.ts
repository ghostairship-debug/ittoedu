import { strToU8, zipSync } from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import {
  createCourseProjectArchive,
  detectCourseProjectArchiveFormat,
  openCourseProjectArchive,
  openCourseProjectArchiveAsync,
} from '@/renderer/project/courseProjectArchive'
import {
  openDefaultCourseProject,
  openDefaultCourseProjectAsync,
} from '@/renderer/project/courseProjectIo'
import type { CourseProjectArchiveData } from '@/renderer/project/courseProjectArchive'
import { saveProject, saveProjectAsync } from '@/renderer/project/saveProject'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'

const archiveProbe = vi.hoisted(() => ({
  detectCalls: 0,
}))

vi.mock('@/renderer/project/courseProjectArchive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/project/courseProjectArchive')>()
  return {
    ...actual,
    detectCourseProjectArchiveFormat(bytes: Uint8Array) {
      archiveProbe.detectCalls += 1
      return actual.detectCourseProjectArchiveFormat(bytes)
    },
  }
})

const FIXTURE_MTIME = '2026-08-28T00:00:00.000Z'

function componentArchiveData(): CourseProjectArchiveData {
  const fixture = listCourseProjectV9Fixtures().find(({ id }) => id === 'component')
  if (!fixture) throw new Error('component Course Project V9 fixture is missing')
  return fixture.data
}

function archiveBytesByKey(files: Record<string, Uint8Array>): Record<string, number[]> {
  return Object.fromEntries(
    Object.entries(files).map(([key, bytes]) => [key, [...bytes]]),
  )
}

function componentArchiveBytes(
  files: Record<string, Record<string, Uint8Array>>,
): Record<string, Record<string, number[]>> {
  return Object.fromEntries(
    Object.entries(files).map(([key, packageFiles]) => [key, archiveBytesByKey(packageFiles)]),
  )
}

function createLargeCourseArchive(byteLength = 12 * 1024 * 1024): Uint8Array {
  const project = createBlankCourseProject({
    id: 'course-open-large-asset',
    title: '大素材打开测试',
    now: FIXTURE_MTIME,
  })
  const assetId = 'large-video'
  const bytes = new Uint8Array(byteLength)
  project.assets[assetId] = {
    id: assetId,
    filename: 'large-video.mp4',
    mimeType: 'video/mp4',
    kind: 'video',
    path: 'assets/large-video.mp4',
    byteLength,
    width: 1920,
    height: 1080,
    duration: 60,
  }
  return createCourseProjectArchive({
    project,
    assetFiles: { [assetId]: bytes },
    componentFiles: {},
  }, { mtime: FIXTURE_MTIME })
}

beforeEach(() => {
  archiveProbe.detectCalls = 0
})

describe('default Course Project V9 sync open', () => {
  it('uses the V9 archive parser directly without a second format-detection unzip', () => {
    const source = componentArchiveData()
    const bytes = createCourseProjectArchive(source, { mtime: FIXTURE_MTIME })
    const expected = openCourseProjectArchive(bytes)

    detectCourseProjectArchiveFormat(bytes)
    expect(archiveProbe.detectCalls).toBe(1)
    archiveProbe.detectCalls = 0

    const opened = openDefaultCourseProject(bytes)

    expect(archiveProbe.detectCalls).toBe(0)
    expect(opened).toEqual(expected)
  })
})

describe('default Course Project V9 async open', () => {
  it('reuses the async archive parser without running the synchronous format detector', async () => {
    const source = componentArchiveData()
    const bytes = createCourseProjectArchive(source, { mtime: FIXTURE_MTIME })
    const expected = await openCourseProjectArchiveAsync(bytes)

    detectCourseProjectArchiveFormat(bytes)
    expect(archiveProbe.detectCalls).toBe(1)
    archiveProbe.detectCalls = 0

    const opened = await openDefaultCourseProjectAsync(bytes)

    expect(archiveProbe.detectCalls).toBe(0)
    expect(opened).toEqual(expected)
    expect(Object.keys(opened.assetFiles)).toEqual(['quiz-fallback'])
    expect(Object.keys(opened.componentFiles)).toHaveLength(1)
  })

  it.each([
    {
      label: '损坏 ZIP',
      bytes: new Uint8Array([1, 2, 3, 4]),
      title: '课程工程文件损坏',
      message: /无法解压/,
      suggestion: '请重新选择有效的课程工程，或从备份恢复。不要把损坏文件另存覆盖原件。',
    },
    {
      label: '缺少 schemaVersion',
      bytes: zipSync({
        'project.json': strToU8(JSON.stringify({ id: 'missing-version' })),
      }),
      title: '课程工程文件损坏',
      message: /schemaVersion/,
      suggestion: '请重新选择有效的课程工程，或从备份恢复。不要把损坏文件另存覆盖原件。',
    },
    {
      label: '非 V9 整数版本',
      bytes: zipSync({
        'project.json': strToU8(JSON.stringify({
          schemaVersion: 10,
          id: 'future-course-project',
        })),
      }),
      title: '课程工程版本不支持',
      message: /格式版本为 10/,
      suggestion: '请使用支持格式版本 10 的编辑器打开。当前不会转换不受支持的工程。',
    },
  ])('rejects $label with the existing user-facing classification', async ({
    bytes,
    title,
    message,
    suggestion,
  }) => {
    await expect(openDefaultCourseProjectAsync(bytes)).rejects.toMatchObject({
      name: 'UserFacingError',
      title,
      message,
      suggestion,
    })
    expect(archiveProbe.detectCalls).toBe(0)
  })

  it('forwards an already-aborted signal to the async archive parser', async () => {
    const bytes = createCourseProjectArchive(componentArchiveData(), { mtime: FIXTURE_MTIME })
    const controller = new AbortController()
    controller.abort()

    await expect(openDefaultCourseProjectAsync(bytes, {
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(archiveProbe.detectCalls).toBe(0)
  })

  it('yields to the event loop before resolving a large valid archive', async () => {
    const bytes = createLargeCourseArchive()
    const events: string[] = []
    const timer = new Promise<void>((resolve) => {
      setTimeout(() => {
        events.push('timer')
        resolve()
      }, 0)
    })
    const opened = openDefaultCourseProjectAsync(bytes).then((result) => {
      events.push('archive')
      return result
    })

    const [result] = await Promise.all([opened, timer])

    expect(events).toEqual(['timer', 'archive'])
    expect(result.assetFiles['large-video']?.byteLength).toBe(12 * 1024 * 1024)
    expect(archiveProbe.detectCalls).toBe(0)
  }, 30_000)
})

describe('explicit Course Project V9 save helper', () => {
  it('updates updatedAt through the explicit save helper without mutating input', () => {
    const source = structuredClone(componentArchiveData())
    const originalTimestamp = source.project.updatedAt
    const saved = saveProject(source, '2026-07-21T01:02:03.000Z')

    expect(source.project.updatedAt).toBe(originalTimestamp)
    expect(saved.project.updatedAt).toBe('2026-07-21T01:02:03.000Z')
    const reopened = openDefaultCourseProject(saved.bytes)
    expect(reopened.project.updatedAt).toBe('2026-07-21T01:02:03.000Z')
    expect(archiveBytesByKey(reopened.assetFiles)).toEqual(archiveBytesByKey(source.assetFiles))
    expect(componentArchiveBytes(reopened.componentFiles)).toEqual(
      componentArchiveBytes(source.componentFiles),
    )
  })

  it('异步保存更新时间戳但不修改输入工程', async () => {
    const source = structuredClone(componentArchiveData())
    const originalUpdatedAt = source.project.updatedAt
    const saved = await saveProjectAsync(source, '2026-07-22T01:02:03.000Z')

    expect(source.project.updatedAt).toBe(originalUpdatedAt)
    expect(saved.project.updatedAt).toBe('2026-07-22T01:02:03.000Z')
    const reopened = await openDefaultCourseProjectAsync(saved.bytes)
    expect(reopened.project.updatedAt).toBe('2026-07-22T01:02:03.000Z')
    expect(archiveBytesByKey(reopened.assetFiles)).toEqual(archiveBytesByKey(source.assetFiles))
    expect(componentArchiveBytes(reopened.componentFiles)).toEqual(
      componentArchiveBytes(source.componentFiles),
    )
  })
})
