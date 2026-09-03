import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPublishedCourseV2Payload } from '../../src/renderer/export/course/buildPublishedCourse'
import type { CoursePublishSources } from '../../src/renderer/export/course/buildPublishedCourse'
import { componentPackagesFromArchive } from '../../src/renderer/components/componentPackageStore'
import {
  PUBLISHED_COURSE_V2_SEAM_LEGACY_ERROR,
} from '../../src/player/surfaces/CoursePlayer'
import {
  listCourseProjectV9Fixtures,
  type CourseProjectV9FixtureId,
} from '../fixtures/course-project-v9'
import type { RuntimeLayerItem } from '../../src/shared/courseProjectTypes'
import type { PublishedCourseV2Payload } from '../../src/shared/publishedCourseTypes'

const captureCalls = vi.hoisted(() => [] as Array<{
  payload: unknown
  locationId?: string
  surfaceId?: string
  layerItemId?: string
}>)
const captureFailAt = vi.hoisted(() => new Set<number>())

vi.mock('../../src/renderer/export/playerCapture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/export/playerCapture')>()
  return {
    ...actual,
    capturePublishedCourseV2Stage: vi.fn(async (input: {
      payload: unknown
      locationId?: string
      surfaceId?: string
      layerItemId?: string
    }) => {
      const attempt = captureCalls.length
      captureCalls.push(input)
      if (captureFailAt.has(attempt)) {
        throw new Error(`runtime capture ${attempt} failed`)
      }
      return 'data:image/png;base64,VTI='
    }),
  }
})

import {
  pptxRuntimeSnapshotKey,
  renderPptxRuntimeSnapshots,
} from '../../src/renderer/export/renderPptxRuntimeSnapshots'

function v9Sources(id: CourseProjectV9FixtureId): CoursePublishSources {
  const fixture = listCourseProjectV9Fixtures().find((candidate) => candidate.id === id)
  if (!fixture) throw new Error(`missing Course Project V9 fixture ${id}`)
  return {
    project: structuredClone(fixture.data.project),
    assetFiles: { ...fixture.data.assetFiles },
    components: Object.keys(fixture.data.componentFiles).length === 0
      ? {}
      : componentPackagesFromArchive(fixture.data.project, fixture.data.componentFiles),
  }
}

function layerItems(payload: unknown): Array<{ kind: string; layerItemId: string }> {
  const published = payload as PublishedCourseV2Payload
  const surface = published.surfaces[0]
  if (!surface || surface.type !== 'slide') return []
  return [
    ...surface.scenes.flatMap((scene) => scene.layerItems),
    ...surface.surfaceLayerItems.map((entry) => entry.item),
    ...published.globalLayerItems.map((entry) => entry.item),
  ]
}

beforeEach(() => {
  captureCalls.length = 0
  captureFailAt.clear()
  vi.clearAllMocks()
})

describe('PPTX runtime snapshot isolation', () => {
  it('rejects a retired V8-era export package before probing a player host', async () => {
    await expect(renderPptxRuntimeSnapshots({
      project: { schemaVersion: 8, scenes: [] },
      assets: {},
      components: {},
    })).rejects.toThrow(PUBLISHED_COURSE_V2_SEAM_LEGACY_ERROR)
    expect(captureCalls).toHaveLength(0)
  })

  it('captures the V9 canvas-runtime fixture without mounting sibling native objects', async () => {
    const published = buildPublishedCourseV2Payload(v9Sources('canvas-runtime'))
    const snapshots = await renderPptxRuntimeSnapshots(published)

    expect(captureCalls).toHaveLength(1)
    expect(captureCalls[0]).toMatchObject({
      locationId: published.startLocationId,
      layerItemId: 'slide-canvas-runtime',
    })
    expect(layerItems(captureCalls[0]!.payload)).toMatchObject([
      { kind: 'runtime', layerItemId: 'slide-canvas-runtime' },
    ])
    expect(snapshots.get(pptxRuntimeSnapshotKey('scene-1', 'slide-canvas-runtime')))
      .toBe('data:image/png;base64,VTI=')
  })

  it('isolates a global runtime from authored native nodes', async () => {
    const sources = v9Sources('canvas-runtime')
    const slide = sources.project.surfaces.find((surface) => surface.type === 'slide')
    if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
    const runtime = slide.scenes[0]!.layerItems.find((item): item is RuntimeLayerItem => (
      item.kind === 'runtime'
    ))
    if (!runtime) throw new Error('expected runtime item')
    slide.scenes[0]!.layerItems = slide.scenes[0]!.layerItems.filter((item) => (
      item.layerItemId !== runtime.layerItemId
    ))
    sources.project.globalLayerItems.push({
      item: {
        ...structuredClone(runtime),
        layerItemId: 'global-canvas-runtime',
        order: 50,
      },
      visibility: { mode: 'all', locationIds: [] },
      plane: 'overlay',
    })
    const published = buildPublishedCourseV2Payload(sources)
    const snapshots = await renderPptxRuntimeSnapshots(published)

    expect(captureCalls).toHaveLength(1)
    expect(layerItems(captureCalls[0]!.payload)).toMatchObject([
      { kind: 'runtime', layerItemId: 'global-canvas-runtime' },
    ])
    expect(snapshots.has(pptxRuntimeSnapshotKey(
      'scene-1',
      'global-canvas-runtime',
      true,
    ))).toBe(true)
  })

  it('单个运行时快照失败时保留前后条目的成功快照', async () => {
    const sources = v9Sources('canvas-runtime')
    const slide = sources.project.surfaces.find((surface) => surface.type === 'slide')
    if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
    const runtime = slide.scenes[0]!.layerItems.find((item): item is RuntimeLayerItem => (
      item.kind === 'runtime'
    ))
    if (!runtime) throw new Error('expected runtime item')
    const maxOrder = Math.max(...slide.scenes[0]!.layerItems.map((item) => item.order))
    slide.scenes[0]!.layerItems.push(
      {
        ...structuredClone(runtime),
        layerItemId: 'slide-canvas-runtime-2',
        order: maxOrder + 1,
      },
      {
        ...structuredClone(runtime),
        layerItemId: 'slide-canvas-runtime-3',
        order: maxOrder + 2,
      },
    )
    const published = buildPublishedCourseV2Payload(sources)
    const onFailure = vi.fn()
    captureFailAt.add(1)

    const snapshots = await renderPptxRuntimeSnapshots(published, { onFailure })

    expect(snapshots.has(pptxRuntimeSnapshotKey('scene-1', 'slide-canvas-runtime'))).toBe(true)
    expect(snapshots.has(pptxRuntimeSnapshotKey('scene-1', 'slide-canvas-runtime-2'))).toBe(false)
    expect(snapshots.has(pptxRuntimeSnapshotKey('scene-1', 'slide-canvas-runtime-3'))).toBe(true)
    expect(onFailure).toHaveBeenCalledOnce()
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({
      entryKey: pptxRuntimeSnapshotKey('scene-1', 'slide-canvas-runtime-2'),
      snapshotKey: pptxRuntimeSnapshotKey('scene-1', 'slide-canvas-runtime-2'),
      sceneId: 'scene-1',
      layerItemId: 'slide-canvas-runtime-2',
      scope: 'scene',
    }))
  })
})
