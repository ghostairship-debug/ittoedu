import { buildPublishedFixture as buildPublishedCourseV2Payload } from '../fixtures/teacherController'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('phaser', () => ({}))

import { createPublishedAuthoringReadonlyState } from '@/player/surfaces/publishedDynamicHosts'
import { PublishedGlobalCanvasRuntimeOwner } from '@/player/surfaces/runtime/publishedGlobalCanvasRuntimeOwner'

import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { RuntimeLayerItem } from '@/shared/courseProjectTypes'
import type { RuntimeAuthoringTargetUpdate } from '@/shared/runtimeTypes'
import { createPublishedCanvasRuntimeV2Fixture } from '../fixtures/publishedCanvasRuntimeV2Fixture'

const frames: HTMLIFrameElement[] = []

afterEach(() => {
  frames.splice(0).forEach((frame) => frame.remove())
})

const source = `
  CoursewareRuntime.define({
    runtimeApiVersion: 2,
    authoringApiVersion: 1,
    create(ctx) {
      var probe = window.__spatialGlobalAuthoringProbe || { creates: 0, destroys: 0 };
      window.__spatialGlobalAuthoringProbe = probe;
      probe.creates += 1;
      var title = document.createElement('h1');
      title.dataset.spatialRuntimeTitle = ctx.content.get('title');
      title.textContent = ctx.content.get('title');
      ctx.dom.root.appendChild(title);
      var unregister = ctx.authoring.register({
        kind: 'text',
        key: 'title',
        label: 'Spatial Runtime title',
        getBounds: function () {
          return { x: 64, y: 72, width: 320, height: 96 };
        }
      });
      return {
        destroy() {
          probe.destroys += 1;
          unregister();
          title.remove();
        }
      };
    }
  });
`

function publishedSpatialGlobalFixture() {
  const fixture = createPublishedCanvasRuntimeV2Fixture([
    { itemId: 'spatial-real-one', renderMode: 'dom', source },
    { itemId: 'spatial-real-two', renderMode: 'dom', source },
  ], { includeSpatial: true })
  const project = structuredClone(fixture.project)
  const runtimes: RuntimeLayerItem[] = []
  for (const surface of project.surfaces) {
    if (surface.type !== 'slide') continue
    for (const scene of surface.scenes) {
      runtimes.push(...scene.layerItems.filter((item): item is RuntimeLayerItem => (
        item.kind === 'runtime' && fixture.itemIds.includes(item.layerItemId)
      )))
      scene.layerItems = scene.layerItems.filter(
        (item) => !fixture.itemIds.includes(item.layerItemId),
      )
    }
  }
  runtimes.forEach((runtime, index) => {
    runtime.order = 100 + index
    runtime.frame = {
      mode: 'absolute',
      x: 100 + index * 420,
      y: 140,
      width: 360,
      height: 220,
    }
    runtime.runtime.content.values.title = index === 0 ? 'Alpha' : 'Beta'
    project.globalLayerItems.push({
      item: runtime,
      visibility: { mode: 'all', locationIds: [] },
      plane: index === 0 ? 'underlay' : 'overlay',
    })
  })
  const locationId = fixture.spatialLocationId
  if (!locationId) throw new Error('expected Spatial fixture location')
  const location = project.locations.find((candidate) => candidate.id === locationId)
  if (!location || location.kind !== 'spatial-camera') throw new Error('expected Spatial location')
  project.startLocationId = locationId
  const parsed = courseProjectDocumentSchema.parse(project)
  return {
    payload: buildPublishedCourseV2Payload({
      project: parsed,
      assetFiles: {},
      components: {},
    }),
    surfaceId: location.surfaceId,
    itemIds: fixture.itemIds,
  }
}

function runtimeTitle(wrapper: HTMLElement | undefined): HTMLElement | null {
  return wrapper
    ?.querySelector<HTMLElement>('[data-canvas-runtime-dom-overlay]')
    ?.querySelector<HTMLElement>('.lesson-runtime-mount')
    ?.shadowRoot
    ?.querySelector<HTMLElement>('[data-spatial-runtime-title]')
    ?? null
}

describe('Spatial global Canvas Runtime API 2 real authoring fixture', () => {
  it('mounts exact wrappers, publishes mapped text targets, updates one carrier, and keeps instances across observation moves', async () => {
    const fixture = publishedSpatialGlobalFixture()
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    frames.push(frame)
    const frameDocument = frame.contentDocument
    const frameView = frame.contentWindow
    if (!frameDocument || !frameView) throw new Error('JSDOM iframe realm unavailable')
    const targets = new Map<string, HTMLElement>()
    for (const itemId of fixture.itemIds) {
      const wrapper = frameDocument.createElement('div')
      wrapper.dataset.layerSource = 'global'
      wrapper.dataset.spatialGlobalRuntimeMount = itemId
      frameDocument.body.appendChild(wrapper)
      targets.set(itemId, wrapper)
    }
    const targetUpdates: RuntimeAuthoringTargetUpdate[] = []
    const readonlyState = createPublishedAuthoringReadonlyState(fixture.payload)
    const owner = new PublishedGlobalCanvasRuntimeOwner({
      payload: fixture.payload,
      hosts: [{
        id: fixture.surfaceId,
        getPublishedGlobalRuntimeMountTarget: (itemId) => targets.get(itemId) ?? null,
      }],
      services: readonlyState.services,
      resolveAsset: readonlyState.services.resolveAsset,
      authoring: {
        courseState: readonlyState.courseState,
        onTargetsChanged: (update) => targetUpdates.push(update),
      },
      courseState: readonlyState.courseState,
    })

    owner.mount(frameDocument)
    owner.moveTo(fixture.surfaceId)
    await vi.waitFor(() => {
      expect(runtimeTitle(targets.get(fixture.itemIds[0]))
        ?.dataset.spatialRuntimeTitle).toBe('Alpha')
      expect(runtimeTitle(targets.get(fixture.itemIds[1]))
        ?.dataset.spatialRuntimeTitle).toBe('Beta')
      expect(targetUpdates.at(-1)?.targets).toHaveLength(2)
    })
    expect(targetUpdates.at(-1)?.targets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: fixture.itemIds[0],
        scope: 'global',
        kind: 'text',
        key: 'title',
        bounds: {
          x: 164,
          y: 212,
          width: 320,
          height: expect.closeTo(96, 10),
        },
      }),
    ]))
    expect(readonlyState.courseState.get('missing')).toBeUndefined()
    readonlyState.courseState.set('attempted-write', 'blocked')
    expect(readonlyState.courseState.get('attempted-write')).toBeUndefined()

    const secondInner = targets.get(fixture.itemIds[1])
      ?.querySelector('[data-published-global-runtime-inner]')
    const firstInner = targets.get(fixture.itemIds[0])
      ?.querySelector('[data-published-global-runtime-inner]')
    expect(firstInner).not.toBeNull()
    expect(secondInner).not.toBeNull()
    await expect(owner.applyAuthoringContentValue(
      fixture.itemIds[0]!,
      'title',
      'Alpha updated',
    )).resolves.toBe(true)
    expect(runtimeTitle(targets.get(fixture.itemIds[0]))
      ?.dataset.spatialRuntimeTitle).toBe('Alpha updated')
    expect(targets.get(fixture.itemIds[1])
      ?.querySelector('[data-published-global-runtime-inner]')).toBe(secondInner)
    expect(targets.get(fixture.itemIds[0])
      ?.querySelector('[data-published-global-runtime-inner]')).not.toBe(firstInner)

    const probeBeforeObservationMove = structuredClone(
      Reflect.get(frameView, '__spatialGlobalAuthoringProbe'),
    )
    const firstAfterUpdate = targets.get(fixture.itemIds[0])
      ?.querySelector('[data-published-global-runtime-inner]')
    owner.moveTo(fixture.surfaceId)
    owner.moveTo(fixture.surfaceId)
    expect(targets.get(fixture.itemIds[0])
      ?.querySelector('[data-published-global-runtime-inner]')).toBe(firstAfterUpdate)
    expect(targets.get(fixture.itemIds[1])
      ?.querySelector('[data-published-global-runtime-inner]')).toBe(secondInner)
    expect(Reflect.get(frameView, '__spatialGlobalAuthoringProbe'))
      .toEqual(probeBeforeObservationMove)

    owner.destroy()
    expect(targets.get(fixture.itemIds[0])
      ?.querySelector('[data-published-global-runtime-inner]')).toBeNull()
    expect(targets.get(fixture.itemIds[1])
      ?.querySelector('[data-published-global-runtime-inner]')).toBeNull()
  })
})
