import { describe, expect, it, vi } from 'vitest'
import type {
  PublishedCanvasRuntimeMountHandle,
  PublishedCanvasRuntimeMountOptions,
} from '@/player/surfaces/runtime/publishedCanvasRuntimeMount'

const mountCalls = vi.hoisted(() => new Map<string, string[]>())

vi.mock('@/player/surfaces/runtime/publishedCanvasRuntimeMount', () => ({
  mountPublishedCanvasRuntime(
    container: HTMLElement,
    options: PublishedCanvasRuntimeMountOptions,
  ): PublishedCanvasRuntimeMountHandle {
    const calls: string[] = []
    mountCalls.set(options.instanceId, calls)
    return {
      ok: true,
      element: container,
      setVisible(visible: boolean) {
        calls.push(`visible:${visible}`)
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
  it('continues moving other records when one suspend call throws and reports that item once', () => {
    mountCalls.clear()
    const fixture = createPublishedCanvasRuntimeV2Fixture([
      { itemId: 'owner-lifecycle-failure', renderMode: 'dom', source: validSource },
      { itemId: 'owner-lifecycle-healthy', renderMode: 'dom', source: validSource },
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
      item: { ...item, order: 1_000 + index, hitPolicy: 'auto' as const },
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
    expect(mountCalls.get('owner-lifecycle-healthy')).toEqual([
      'visible:true',
      'resume',
      'visible:false',
      'suspend',
      'visible:true',
      'resume',
    ])
    expect(diagnostics.filter((message) => message.includes('lifecycle失败'))).toHaveLength(1)

    expect(() => owner.moveTo(slideSurfaceId)).not.toThrow()
    expect(diagnostics.filter((message) => message.includes('lifecycle失败'))).toHaveLength(1)
    owner.destroy()
  })
})
