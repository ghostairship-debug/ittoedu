import { describe, expect, it } from 'vitest'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import {
  createCourseProjectArchiveAsync,
  openCourseProjectArchiveAsync,
  type CourseProjectArchiveData,
} from '@/renderer/project/courseProjectArchive'

function makeLargeArchiveData(byteLength = 12 * 1024 * 1024): CourseProjectArchiveData {
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const bytes = new Uint8Array(byteLength)
  project.assets.largeVideo = {
    id: 'largeVideo',
    filename: 'large-video.mp4',
    mimeType: 'video/mp4',
    kind: 'video',
    path: 'assets/large-video.mp4',
    byteLength,
    duration: 60,
  }
  return {
    project,
    assetFiles: { largeVideo: bytes },
    componentFiles: {},
  }
}

async function recordTimerBefore<T>(operation: Promise<T>): Promise<T> {
  const events: string[] = []
  const timer = new Promise<void>((resolve) => {
    setTimeout(() => {
      events.push('timer')
      resolve()
    }, 0)
  })
  const observed = operation.then((value) => {
    events.push('archive')
    return value
  })
  const [result] = await Promise.all([observed, timer])
  expect(events[0]).toBe('timer')
  return result
}

describe('asynchronous Course Project V9 archive', () => {
  it('压缩和解压大素材时保持事件循环可响应', async () => {
    const source = makeLargeArchiveData()
    const bytes = await recordTimerBefore(createCourseProjectArchiveAsync(source, {
      mtime: '2026-07-22T00:00:00.000Z',
    }))
    const restored = await recordTimerBefore(openCourseProjectArchiveAsync(bytes))

    expect(restored.project.id).toBe(source.project.id)
    expect(restored.project.schemaVersion).toBe(9)
    expect(restored.assetFiles.largeVideo?.byteLength).toBe(12 * 1024 * 1024)
  }, 30_000)

  it('可取消过期的后台压缩', async () => {
    const controller = new AbortController()
    const operation = createCourseProjectArchiveAsync(makeLargeArchiveData(), {
      signal: controller.signal,
    })
    controller.abort()
    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
  })
})
