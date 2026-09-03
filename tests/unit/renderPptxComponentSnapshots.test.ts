import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPublishedCourseV2Payload } from '../../src/renderer/export/course/buildPublishedCourse'
import type { CoursePublishSources } from '../../src/renderer/export/course/buildPublishedCourse'
import { componentPackagesFromArchive } from '../../src/renderer/components/componentPackageStore'
import {
  pptxComponentSnapshotKey,
  pptxGlobalComponentSnapshotKey,
} from '../../src/renderer/export/pptxShared'
import {
  PUBLISHED_COURSE_V2_SEAM_LEGACY_ERROR,
} from '../../src/player/surfaces/CoursePlayer'
import {
  listCourseProjectV9Fixtures,
  type CourseProjectV9FixtureId,
} from '../fixtures/course-project-v9'
import type { ComponentLayerItem } from '../../src/shared/courseProjectTypes'
import type { PublishedCourseV2Payload } from '../../src/shared/publishedCourseTypes'

const captureCalls = vi.hoisted(() => [] as Array<{
  payload: unknown
  locationId?: string
  surfaceId?: string
  layerItemId?: string
  includeGlobalLayerItems?: boolean
}>)
const captureFailAt = vi.hoisted(() => new Set<number>())
const captureMetrics = vi.hoisted(() => ({
  active: 0,
  maxActive: 0,
  destroyed: 0,
}))

vi.mock('../../src/renderer/export/playerCapture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/export/playerCapture')>()
  return {
    ...actual,
    capturePublishedCourseV2Stage: vi.fn(async (input: {
      payload: unknown
      locationId?: string
      surfaceId?: string
      layerItemId?: string
      includeGlobalLayerItems?: boolean
    }) => {
      captureMetrics.active += 1
      captureMetrics.maxActive = Math.max(captureMetrics.maxActive, captureMetrics.active)
      try {
        const attempt = captureCalls.length
        captureCalls.push(input)
        if (captureFailAt.has(attempt)) {
          throw new Error(`component capture ${attempt} failed`)
        }
        return 'data:image/png;base64,VTI='
      } finally {
        captureMetrics.active -= 1
        captureMetrics.destroyed += 1
      }
    }),
  }
})

import { renderPptxComponentSnapshots } from '../../src/renderer/export/renderPptxComponentSnapshots'

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

function publishedFrom(id: CourseProjectV9FixtureId): PublishedCourseV2Payload {
  return buildPublishedCourseV2Payload(v9Sources(id))
}

function dynamicItems(payload: unknown): Array<{ kind: string; layerItemId: string }> {
  const published = payload as PublishedCourseV2Payload
  const surface = published.surfaces[0]
  if (!surface || surface.type !== 'slide') return []
  return [
    ...surface.scenes.flatMap((scene) => scene.layerItems),
    ...surface.surfaceLayerItems.map((entry) => entry.item),
    ...published.globalLayerItems.map((entry) => entry.item),
  ].filter((item) => item.kind === 'component' || item.kind === 'runtime')
}

beforeEach(() => {
  captureCalls.length = 0
  captureFailAt.clear()
  captureMetrics.active = 0
  captureMetrics.maxActive = 0
  captureMetrics.destroyed = 0
  vi.clearAllMocks()
})

describe('PPTX component snapshot capture semantics', () => {
  it('rejects a retired V8-era export package before probing a player host', async () => {
    await expect(renderPptxComponentSnapshots({
      project: { schemaVersion: 8, scenes: [] },
      assets: {},
      components: {},
    })).rejects.toThrow(PUBLISHED_COURSE_V2_SEAM_LEGACY_ERROR)
    expect(captureCalls).toHaveLength(0)
  })

  it('captures the V9 component fixture through the Published V2 seam', async () => {
    const published = publishedFrom('component')
    const snapshots = await renderPptxComponentSnapshots(published)

    expect(captureCalls).toHaveLength(1)
    expect(captureCalls[0]).toMatchObject({
      locationId: published.startLocationId,
      layerItemId: 'slide-quiz',
    })
    expect(dynamicItems(captureCalls[0]!.payload)).toMatchObject([
      { kind: 'component', layerItemId: 'slide-quiz' },
    ])
    expect(snapshots.get(pptxComponentSnapshotKey('scene-1', 'slide-quiz')))
      .toBe('data:image/png;base64,VTI=')
  })

  it('isolates each component instance and never keeps two captures alive', async () => {
    const sources = v9Sources('component')
    const slide = sources.project.surfaces.find((surface) => surface.type === 'slide')
    if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
    const quiz = slide.scenes[0]!.layerItems.find((item): item is ComponentLayerItem => (
      item.kind === 'component'
    ))
    if (!quiz) throw new Error('expected component item')
    slide.scenes[0]!.layerItems.push({
      ...structuredClone(quiz),
      layerItemId: 'slide-quiz-2',
      order: quiz.order + 1,
      frame: { ...quiz.frame, y: quiz.frame.y + 260 },
    })
    sources.project.globalLayerItems.push({
      item: {
        ...structuredClone(quiz),
        layerItemId: 'global-quiz',
        order: 900,
      },
      visibility: { mode: 'all', locationIds: [] },
      plane: 'overlay',
    })
    const published = buildPublishedCourseV2Payload(sources)

    const snapshots = await renderPptxComponentSnapshots(published)

    expect(captureCalls).toHaveLength(3)
    expect(captureMetrics).toEqual({ active: 0, maxActive: 1, destroyed: 3 })
    for (const call of captureCalls) {
      expect(dynamicItems(call.payload)).toHaveLength(1)
    }
    expect(snapshots.has(pptxComponentSnapshotKey('scene-1', 'slide-quiz'))).toBe(true)
    expect(snapshots.has(pptxComponentSnapshotKey('scene-1', 'slide-quiz-2'))).toBe(true)
    expect(snapshots.has(pptxGlobalComponentSnapshotKey('scene-1', 'global-quiz'))).toBe(true)
  })

  it('单个组件快照失败时保留前后实例，并只报告失败实例', async () => {
    const sources = v9Sources('component')
    const slide = sources.project.surfaces.find((surface) => surface.type === 'slide')
    if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
    const quiz = slide.scenes[0]!.layerItems.find((item): item is ComponentLayerItem => (
      item.kind === 'component'
    ))
    if (!quiz) throw new Error('expected component item')
    slide.scenes[0]!.layerItems.push(
      {
        ...structuredClone(quiz),
        layerItemId: 'slide-quiz-2',
        order: quiz.order + 1,
      },
      {
        ...structuredClone(quiz),
        layerItemId: 'slide-quiz-3',
        order: quiz.order + 2,
      },
    )
    const published = buildPublishedCourseV2Payload(sources)
    const onFailure = vi.fn()
    captureFailAt.add(1)

    const snapshots = await renderPptxComponentSnapshots(published, { onFailure })

    expect(snapshots.has(pptxComponentSnapshotKey('scene-1', 'slide-quiz'))).toBe(true)
    expect(snapshots.has(pptxComponentSnapshotKey('scene-1', 'slide-quiz-2'))).toBe(false)
    expect(snapshots.has(pptxComponentSnapshotKey('scene-1', 'slide-quiz-3'))).toBe(true)
    expect(onFailure).toHaveBeenCalledOnce()
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({
      snapshotKey: pptxComponentSnapshotKey('scene-1', 'slide-quiz-2'),
      sceneId: 'scene-1',
      nodeId: 'slide-quiz-2',
    }))
    expect(captureMetrics).toEqual({ active: 0, maxActive: 1, destroyed: 3 })
  })
})
