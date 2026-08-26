import { describe, expect, it, vi } from 'vitest'
import type {
  PublishedCanvasRuntimeMountHandle,
  PublishedCanvasRuntimeMountOptions,
} from '@/player/surfaces/runtime/publishedCanvasRuntimeMount'
import type { RuntimeAuthoringTargetUpdate } from '@/shared/runtimeTypes'

const mountCalls = vi.hoisted(() => new Map<string, string[]>())
const mountedOptions = vi.hoisted(
  () => new Map<string, PublishedCanvasRuntimeMountOptions>(),
)
const restartOnVisible = vi.hoisted(() => new Set<string>())

vi.mock('@/player/surfaces/runtime/publishedCanvasRuntimeMount', () => ({
  mountPublishedCanvasRuntime(
    container: HTMLElement,
    options: PublishedCanvasRuntimeMountOptions,
  ): PublishedCanvasRuntimeMountHandle {
    const calls: string[] = []
    mountCalls.set(options.instanceId, calls)
    mountedOptions.set(options.instanceId, options)
    return {
      ok: true,
      element: container,
      applyAuthoringContentValue: () => false,
      waitForReady: () => {
        calls.push('ready')
        return Promise.resolve()
      },
      waitForCaptureReady: () => Promise.resolve(),
      restoreAfterCapture() {},
      setVisible(visible: boolean) {
        calls.push(`visible:${visible}`)
        if (visible && restartOnVisible.delete(options.instanceId)) {
          options.actions?.restartCourse()
        }
      },
      suspend() {
        calls.push('suspend')
        if (options.instanceId !== 'owner-lifecycle-failure') return
        const fallback = container.ownerDocument.createElement('div')
        fallback.dataset.runtimeFallback = 'true'
        container.replaceChildren(fallback)
        throw new Error('owner suspend failed intentionally')
      },
      resume() {
        calls.push('resume')
      },
      destroy() {
        calls.push('destroy')
      },
    }
  },
}))

import { PublishedGlobalCanvasRuntimeOwner } from '@/player/surfaces/runtime/publishedGlobalCanvasRuntimeOwner'
import { CourseStateStore } from '@/player/CourseStateStore'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { RuntimeLayerItem } from '@/shared/courseProjectTypes'
import { createPublishedCanvasRuntimeV2Fixture } from '../fixtures/publishedCanvasRuntimeV2Fixture'

const validSource = `
  CoursewareRuntime.define({
    runtimeApiVersion: 2,
    create() { return { destroy() {} }; }
  });
`

describe('Published global canvas Runtime owner lifecycle isolation', () => {
  it('isolates lifecycle failure and authoring remount to the affected global Runtime', async () => {
    mountCalls.clear()
    mountedOptions.clear()
    restartOnVisible.clear()
    const fixture = createPublishedCanvasRuntimeV2Fixture([
      { itemId: 'owner-lifecycle-healthy', renderMode: 'dom', source: validSource },
      { itemId: 'owner-lifecycle-failure', renderMode: 'dom', source: validSource },
    ], { includeFlow: true })
    if (!fixture.flowLocationId) throw new Error('expected Flow fixture')
    const project = structuredClone(fixture.project)
    const slide = project.surfaces.find((surface) => surface.id === fixture.slideSurfaceId)
    if (!slide || slide.type !== 'slide') throw new Error('expected Slide fixture')
    const runtimes = slide.scenes.flatMap((scene) => scene.layerItems.filter(
      (item): item is RuntimeLayerItem => item.kind === 'runtime',
    ))
    for (const scene of slide.scenes) {
      scene.layerItems = scene.layerItems.filter((item) => item.kind !== 'runtime')
    }
    project.globalLayerItems.push(...runtimes.map((item, index) => ({
      item: {
        ...item,
        order: 1_000 + index,
        hitPolicy: 'auto' as const,
        runtime: {
          ...item.runtime,
          content: {
            values: {
              ...item.runtime.content.values,
              title: `${item.layerItemId} initial title`,
            },
          },
        },
      },
      visibility: { mode: 'all' as const, locationIds: [] },
    })))
    const payload = buildPublishedCourseV2Payload({
      project: courseProjectDocumentSchema.parse(project),
      assetFiles: {},
      components: {},
    })
    const slideSurfaceId = fixture.slideSurfaceId
    const flowSurfaceId = payload.locations.find(
      (location) => location.id === fixture.flowLocationId,
    )!.surfaceId
    const targets = new Map<string, Map<string, HTMLElement>>()
    for (const surfaceId of [slideSurfaceId, flowSurfaceId]) {
      targets.set(surfaceId, new Map(runtimes.map((item) => {
        const target = document.createElement('div')
        target.dataset.interactionVisibility = 'visible'
        return [item.layerItemId, target]
      })))
    }
    const diagnostics: string[] = []
    const targetUpdates: Readonly<RuntimeAuthoringTargetUpdate>[] = []
    const owner = new PublishedGlobalCanvasRuntimeOwner({
      payload,
      hosts: [slideSurfaceId, flowSurfaceId].map((id) => ({
        id,
        getPublishedGlobalRuntimeMountTarget: (itemId: string) => (
          targets.get(id)?.get(itemId) ?? null
        ),
      })),
      services: {
        navigate: () => undefined,
        getCourseState: () => undefined,
        setCourseState: () => undefined,
        resolveAsset: () => undefined,
        reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic.message),
      },
      resolveAsset: () => undefined,
      authoring: {
        courseState: new CourseStateStore(),
        onTargetsChanged: (update) => targetUpdates.push(update),
      },
    })

    owner.mount(document)
    owner.moveTo(slideSurfaceId)
    expect(() => owner.moveTo(flowSurfaceId)).not.toThrow()

    const failedTarget = targets.get(flowSurfaceId)!.get('owner-lifecycle-failure')!
    const healthyTarget = targets.get(flowSurfaceId)!.get('owner-lifecycle-healthy')!
    expect(failedTarget.dataset.globalRuntimeState).toBe('fallback')
    expect(failedTarget.style.pointerEvents).toBe('none')
    expect(failedTarget.querySelector('[data-runtime-fallback="true"]')).not.toBeNull()
    expect(healthyTarget.dataset.globalRuntimeState).toBe('playback')
    expect(healthyTarget.style.pointerEvents).toBe('auto')
    const healthyGeneration = mountCalls.get('owner-lifecycle-healthy')!
    const failedGeneration = mountCalls.get('owner-lifecycle-failure')!
    expect(healthyGeneration).toEqual([
      'visible:true',
      'resume',
      'visible:false',
      'suspend',
      'visible:true',
      'resume',
    ])
    expect(diagnostics.filter((message) => message.includes('lifecycle失败'))).toHaveLength(1)

    const firstHealthyMount = mountedOptions.get('owner-lifecycle-healthy')!
    firstHealthyMount.authoring?.onTargetsChanged({
      revision: 41,
      scope: 'global',
      targets: [{
        targetId: 'global-title',
        scope: 'global',
        kind: 'text',
        key: 'title',
        layer: 'overlay',
        source: 'registered',
        bounds: { x: 0, y: 0, width: 640, height: 180 },
      }],
    })
    expect(targetUpdates.at(-1)).toMatchObject({
      revision: 1,
      scope: 'global',
      targets: [expect.objectContaining({
        targetId: 'global-title',
        nodeId: 'owner-lifecycle-healthy',
      })],
    })

    expect(() => owner.moveTo(slideSurfaceId)).not.toThrow()
    expect(diagnostics.filter((message) => message.includes('lifecycle失败'))).toHaveLength(1)

    const healthyRuntime = payload.globalLayerItems.find((entry) => (
      entry.item.layerItemId === 'owner-lifecycle-healthy'
      && entry.item.kind === 'runtime'
    ))?.item
    if (!healthyRuntime || healthyRuntime.kind !== 'runtime') {
      throw new Error('expected healthy global Runtime')
    }
    const contentKey = Object.keys(healthyRuntime.runtime.content.values)[0]
    if (!contentKey) throw new Error('expected Runtime content value')
    await expect(owner.applyAuthoringContentValue(
      healthyRuntime.layerItemId,
      contentKey,
      'Updated authoring value',
    )).resolves.toBe(true)
    expect(healthyGeneration.at(-1)).toBe('destroy')
    expect(failedGeneration).not.toContain('destroy')
    expect(mountCalls.get('owner-lifecycle-healthy')).toEqual([
      'visible:true',
      'resume',
      'ready',
    ])
    expect(targetUpdates.at(-1)).toMatchObject({
      revision: 2,
      scope: 'global',
      targets: [],
    })
    const updateCountAfterReplacement = targetUpdates.length
    firstHealthyMount.authoring?.onTargetsChanged({
      revision: 42,
      scope: 'global',
      targets: [],
    })
    expect(targetUpdates).toHaveLength(updateCountAfterReplacement)
    mountedOptions.get('owner-lifecycle-healthy')!.authoring?.onTargetsChanged({
      revision: 1,
      scope: 'global',
      targets: [{
        targetId: 'replacement-title',
        scope: 'global',
        kind: 'text',
        key: 'title',
        layer: 'overlay',
        source: 'registered',
        bounds: { x: 0, y: 0, width: 320, height: 90 },
      }],
    })
    expect(targetUpdates.at(-1)).toMatchObject({
      revision: 3,
      scope: 'global',
      targets: [expect.objectContaining({
        targetId: 'replacement-title',
        nodeId: 'owner-lifecycle-healthy',
      })],
    })
    const updatesAfterFailure = targetUpdates.length
    mountedOptions.get('owner-lifecycle-failure')!.authoring?.onTargetsChanged({
      revision: 99,
      scope: 'global',
      targets: [{
        targetId: 'stale-failed-title',
        scope: 'global',
        kind: 'text',
        key: 'title',
        layer: 'overlay',
        source: 'registered',
        bounds: { x: 0, y: 0, width: 320, height: 90 },
      }],
    })
    expect(targetUpdates).toHaveLength(updatesAfterFailure)
    owner.destroy()
  })

  it('keeps the active generation inert when activation synchronously prepares restart', () => {
    mountCalls.clear()
    mountedOptions.clear()
    restartOnVisible.clear()
    const itemId = 'owner-reentrant-restart'
    const fixture = createPublishedCanvasRuntimeV2Fixture([
      { itemId, renderMode: 'dom', source: validSource },
    ])
    const project = structuredClone(fixture.project)
    const slide = project.surfaces.find((surface) => surface.id === fixture.slideSurfaceId)
    if (!slide || slide.type !== 'slide') throw new Error('expected Slide fixture')
    const runtime = slide.scenes.flatMap((scene) => scene.layerItems).find((item) => (
      item.kind === 'runtime' && item.layerItemId === itemId
    ))
    if (!runtime || runtime.kind !== 'runtime') throw new Error('expected Runtime fixture')
    for (const scene of slide.scenes) {
      scene.layerItems = scene.layerItems.filter((item) => item.layerItemId !== itemId)
    }
    project.globalLayerItems.push({
      item: { ...runtime, order: 1_000, hitPolicy: 'auto' },
      visibility: { mode: 'all', locationIds: [] },
    })
    const payload = buildPublishedCourseV2Payload({
      project: courseProjectDocumentSchema.parse(project),
      assetFiles: {},
      components: {},
    })
    const target = document.createElement('div')
    target.dataset.interactionVisibility = 'visible'
    const courseState = new CourseStateStore()
    let restartRequests = 0
    let owner!: PublishedGlobalCanvasRuntimeOwner
    owner = new PublishedGlobalCanvasRuntimeOwner({
      payload,
      hosts: [{
        id: fixture.slideSurfaceId,
        getPublishedGlobalRuntimeMountTarget: (candidateId: string) => (
          candidateId === itemId ? target : null
        ),
      }],
      services: {
        navigate: () => undefined,
        getCourseState: () => undefined,
        setCourseState: () => undefined,
        resolveAsset: () => undefined,
      },
      resolveAsset: () => undefined,
      courseState,
      runtimeActions: {
        goToScene: () => false,
        nextScene: () => false,
        previousScene: () => false,
        replayScene: () => false,
        restartCourse: () => {
          restartRequests += 1
          owner.prepareRestart()
          return true
        },
      },
    })

    owner.mount(document)
    restartOnVisible.add(itemId)
    owner.moveTo(fixture.slideSurfaceId)

    expect(restartRequests).toBe(1)
    expect(mountCalls.get(itemId)).toEqual([
      'visible:true',
      'visible:false',
      'suspend',
    ])
    expect(mountedOptions.get(itemId)?.actions?.restartCourse()).toBe(false)
    expect(restartRequests).toBe(1)
    owner.destroy()
  })
})
