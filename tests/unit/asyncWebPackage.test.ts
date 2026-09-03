import { strFromU8, unzipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { PublishedCourseV2Payload } from '@/shared/publishedCourseTypes'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createVideoNode } from '@/renderer/project/nativeNodeFactories'
import {
  buildPublishedCourseWebPackageAsync,
  buildPublishedCourseWebPackageFiles,
} from '@/renderer/export/course/buildCoursePackages'

afterEach(() => vi.restoreAllMocks())

function makeSources(byteLength: number) {
  const project = createBlankCourseProject({
    includeDefaultController: false,
    controls: 'none',
  })
  const video = new Uint8Array(byteLength)
  video[0] = 17
  video[video.length - 1] = 29
  project.assets.video = {
    id: 'video',
    filename: '课堂视频.mp4',
    mimeType: 'video/mp4',
    kind: 'video',
    path: 'assets/video.mp4',
    byteLength,
    duration: 20,
  }
  const slide = project.surfaces.find((surface) => surface.type === 'slide')
  if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
  slide.scenes[0]!.layerItems.push(sceneNodeToCourseLayerItem(createVideoNode({
    id: 'lesson-video',
    assetId: 'video',
  }), 20))
  project.assets.unused = {
    id: 'unused',
    filename: '作者素材-未使用.png',
    mimeType: 'image/png',
    kind: 'image',
    path: 'assets/unused.png',
    byteLength: 64,
  }
  courseProjectDocumentSchema.parse(project)
  return {
    project,
    assetFiles: { video },
    components: {},
  }
}

function decodeCourseData(bytes: Uint8Array): PublishedCourseV2Payload {
  const source = strFromU8(bytes)
  const assignment = 'window.__H5_COURSE_PAYLOAD__='
  if (!source.startsWith(assignment)) throw new Error('course-data.js 格式无效')
  return JSON.parse(source.slice(assignment.length).replace(/;\s*$/, '')) as PublishedCourseV2Payload
}

describe('asynchronous web package', () => {
  it('直接打包原始素材，不做 Base64 往返', () => {
    const sources = makeSources(1024)
    const atobSpy = vi.spyOn(globalThis, 'atob')
    const files = buildPublishedCourseWebPackageFiles(
      sources,
      'window.__PLAYER__=true;',
    )
    const payload = decodeCourseData(files['course-data.js']!)
    const assetPath = payload.assets.video?.url.replace(/^\.\//, '')

    expect(atobSpy).not.toHaveBeenCalled()
    expect(payload.assets.video?.url).toMatch(/^\.\/assets\//)
    expect(files[assetPath!]).toBe(sources.assetFiles.video)
    expect(payload.assets).not.toHaveProperty('unused')
    expect(Object.keys(files).filter((path) => path.startsWith('assets/')))
      .toEqual([assetPath])
  })

  it('大素材 ZIP 压缩在后台运行', async () => {
    const sources = makeSources(8 * 1024 * 1024)
    const events: string[] = []
    const archive = buildPublishedCourseWebPackageAsync(
      sources,
      'window.__PLAYER__=true;',
    ).then((bytes) => {
      events.push('archive')
      return bytes
    })
    const timer = new Promise<void>((resolve) => {
      setTimeout(() => {
        events.push('timer')
        resolve()
      }, 0)
    })
    const [bytes] = await Promise.all([archive, timer])
    expect(events[0]).toBe('timer')

    const files = unzipSync(bytes)
    const payload = decodeCourseData(files['course-data.js']!)
    const assetPath = payload.assets.video!.url.replace(/^\.\//, '')
    expect(files[assetPath]?.byteLength).toBe(8 * 1024 * 1024)
  }, 30_000)
})
