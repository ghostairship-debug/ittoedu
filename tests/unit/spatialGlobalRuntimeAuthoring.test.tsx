import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { RuntimeAuthoringTargetUpdate } from '@/shared/runtimeTypes'

const ownerInstances = vi.hoisted(() => [] as Array<{
  options: {
    payload: import('@/shared/publishedCourseTypes').PublishedCourseV2Payload
    hosts: Array<{
      id: string
      getPublishedGlobalRuntimeMountTarget(itemId: string): HTMLElement | null
    }>
    authoring?: {
      onTargetsChanged(update: RuntimeAuthoringTargetUpdate): void
    }
    resolveAsset(assetId: string): string | undefined
  }
  mounted: number
  moves: string[]
  applied: Array<[string, string, string]>
  destroyed: number
}>)

vi.mock('phaser', () => ({}))
vi.mock('@/player/surfaces/runtime/publishedGlobalCanvasRuntimeOwner', () => ({
  PublishedGlobalCanvasRuntimeOwner: class PublishedGlobalCanvasRuntimeOwner {
    readonly record: (typeof ownerInstances)[number]

    constructor(options: (typeof ownerInstances)[number]['options']) {
      this.record = {
        options,
        mounted: 0,
        moves: [],
        applied: [],
        destroyed: 0,
      }
      ownerInstances.push(this.record)
    }

    mount(): void {
      this.record.mounted += 1
    }

    moveTo(surfaceId: string): void {
      this.record.moves.push(surfaceId)
      const runtime = this.record.options.payload.globalLayerItems.find((entry) => (
        entry.item.kind === 'runtime'
        && entry.item.runtime.protocol === 'canvas-runtime'
        && entry.item.runtime.runtimeApiVersion === 2
      ))?.item
      if (!runtime || runtime.kind !== 'runtime') return
      const target = this.record.options.hosts[0]
        ?.getPublishedGlobalRuntimeMountTarget(runtime.layerItemId)
      if (!target) return
      const rendered = target.ownerDocument.createElement('strong')
      rendered.dataset.runtimeProbe = runtime.layerItemId
      rendered.textContent = runtime.runtime.content.values.title
      target.replaceChildren(rendered)
      this.record.options.authoring?.onTargetsChanged({
        revision: 1,
        scope: 'global',
        targets: [{
          targetId: 'title',
          nodeId: runtime.layerItemId,
          scope: 'global',
          kind: 'text',
          key: 'title',
          label: 'Runtime title',
          multiline: false,
          layer: 'overlay',
          source: 'registered',
          bounds: {
            x: runtime.frame.x + 8,
            y: runtime.frame.y + 12,
            width: 180,
            height: 36,
          },
        }],
      })
    }

    applyAuthoringContentValue(itemId: string, key: string, value: string): Promise<boolean> {
      this.record.applied.push([itemId, key, value])
      return Promise.resolve(true)
    }

    destroy(): void {
      this.record.destroyed += 1
    }
  },
}))

import { buildCourseAuthoringSessionForProject } from '@/renderer/authoring/courseAuthoringSession'
import type { RuntimeTargetEditSession } from '@/renderer/authoring/runtimeTargetEditSession'
import { projectEffectiveLayers } from '@/renderer/course/effectiveLayerProjection'
import {
  buildSpatialEditorView,
  captureSpatialEditorAuthoringTarget,
  spatialEditorStableTargets,
} from '@/renderer/course/spatialEditorView'
import { createChartLayerItem, createChartNode } from '@/renderer/project/nativeNodeFactories'
import { createRuntimeAuthoringActions } from '@/renderer/runtime/commitRuntimeAuthoring'
import { SpatialLocationWorkspace } from '@/renderer/ui/workspaces/SpatialLocationWorkspace'
import {
  SpatialGlobalRuntimeAuthoring,
  SpatialGlobalRuntimeMountTarget,
} from '@/renderer/ui/workspaces/spatial/SpatialGlobalRuntimeAuthoring'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { CourseProjectDocument, RuntimeLayerItem } from '@/shared/courseProjectTypes'
import { createPublishedCanvasRuntimeV2Fixture } from '../fixtures/publishedCanvasRuntimeV2Fixture'

afterEach(() => {
  cleanup()
  ownerInstances.length = 0
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class ResizeObserver {
    observe(): void {}
    disconnect(): void {}
  })
})

const runtimeSource = `
  CoursewareRuntime.define({
    create(ctx) {
      const title = document.createElement('h1');
      title.textContent = ctx.content.get('title');
      ctx.dom.root.appendChild(title);
      ctx.authoring.registerText({ key: 'title', element: title });
      return { destroy() { title.remove(); } };
    }
  });
`

function spatialGlobalFixture(): {
  project: CourseProjectDocument
  assetFiles: Record<string, Uint8Array>
  locationId: string
  surfaceId: string
  itemIds: readonly [string, string]
} {
  const fixture = createPublishedCanvasRuntimeV2Fixture([
    { itemId: 'spatial-global-one', renderMode: 'dom', source: runtimeSource },
    { itemId: 'spatial-global-two', renderMode: 'dom', source: runtimeSource },
  ], { includeSpatial: true })
  const project = structuredClone(fixture.project)
  const runtimes: RuntimeLayerItem[] = []
  for (const surface of project.surfaces) {
    if (surface.type !== 'slide') continue
    for (const scene of surface.scenes) {
      for (const item of scene.layerItems) {
        if (item.kind === 'runtime' && fixture.itemIds.includes(item.layerItemId)) {
          runtimes.push(item)
        }
      }
      scene.layerItems = scene.layerItems.filter(
        (item) => !fixture.itemIds.includes(item.layerItemId),
      )
    }
  }
  runtimes.forEach((item, index) => {
    item.order = 100 + index
    item.frame = {
      mode: 'absolute',
      x: 80 + index * 360,
      y: 100,
      width: 320,
      height: 180,
    }
    item.runtime.content.values.title = index === 0 ? 'First title' : 'Second title'
    project.globalLayerItems.push({
      item,
      visibility: { mode: 'all', locationIds: [] },
      plane: index === 0 ? 'underlay' : 'overlay',
    })
  })
  const runtimeAssetId = 'spatial-runtime-image'
  const runtimeAssetBytes = Uint8Array.from([137, 80, 78, 71])
  project.assets[runtimeAssetId] = {
    id: runtimeAssetId,
    kind: 'image',
    filename: 'spatial-runtime.png',
    mimeType: 'image/png',
    path: 'assets/spatial-runtime.png',
    byteLength: runtimeAssetBytes.byteLength,
    width: 1,
    height: 1,
  }
  runtimes[0]!.runtime.assets.hero = { assetId: runtimeAssetId }
  const locationId = fixture.spatialLocationId
  if (!locationId) throw new Error('expected Spatial fixture location')
  const location = project.locations.find((candidate) => candidate.id === locationId)
  if (!location || location.kind !== 'spatial-camera') throw new Error('expected Spatial location')
  project.startLocationId = locationId
  return {
    project: courseProjectDocumentSchema.parse(project),
    assetFiles: { [runtimeAssetId]: runtimeAssetBytes },
    locationId,
    surfaceId: location.surfaceId,
    itemIds: fixture.itemIds as unknown as readonly [string, string],
  }
}

function layerView(project: CourseProjectDocument, locationId: string) {
  return buildSpatialEditorView({
    project,
    locationId,
    sessionCamera: { x: 0, y: 0, zoom: 1 },
  }).layers
}

describe('Spatial global Runtime authoring adapter', () => {
  it('mounts real wrapper targets, edits through formal ports, preserves the owner for camera/content updates, and destroys on exit', async () => {
    const fixture = spatialGlobalFixture()
    const capture = vi.fn((session: Readonly<RuntimeTargetEditSession>) => ({
      courseTarget: {
        projectId: fixture.project.id,
        sessionToken: buildCourseAuthoringSessionForProject(
          fixture.project,
          fixture.locationId,
        ).token,
        surfaceType: 'spatial-2d' as const,
        surfaceId: fixture.surfaceId,
        locationId: fixture.locationId,
        stateId: null,
        owner: 'global' as const,
        ownerKey: 'global',
        itemId: session.nodeId!,
        authoringAddress: `runtime:${session.nodeId}:${session.key}`,
      },
      contentKey: session.key,
      initialValue: 'First title',
    }))
    const update = vi.fn(() => ({
      ok: true as const,
      status: 'updated' as const,
      feedback: {} as never,
    }))
    const firstId = fixture.itemIds[0]
    const renderAdapter = (
      project: CourseProjectDocument,
      cameraX = 0,
      scope: 'global' | 'surface' | 'world' = 'global',
      firstMountKey = 'initial',
      assetFiles: Record<string, Uint8Array> = fixture.assetFiles,
    ) => {
      const layers = buildSpatialEditorView({
        project,
        locationId: fixture.locationId,
        sessionCamera: { x: cameraX, y: 0, zoom: 1 },
      }).layers
      return (
        <SpatialGlobalRuntimeAuthoring
          project={project}
          locationId={fixture.locationId}
          surfaceId={fixture.surfaceId}
          scope={scope}
          layers={layers}
          assetFiles={assetFiles}
          componentPackages={{}}
          content={{
            captureRuntimeContentTextTarget: capture as never,
            updateRuntimeContentTextAtTarget: update as never,
          }}
        >
          <SpatialGlobalRuntimeMountTarget key={firstMountKey} itemId={firstId} />
          <SpatialGlobalRuntimeMountTarget itemId={fixture.itemIds[1]} />
        </SpatialGlobalRuntimeAuthoring>
      )
    }
    const rendered = render(renderAdapter(fixture.project))

    expect(ownerInstances).toHaveLength(1)
    expect(ownerInstances[0]).toMatchObject({
      mounted: 1,
      moves: [fixture.surfaceId],
      destroyed: 0,
    })
    expect(ownerInstances[0]?.options.resolveAsset('spatial-runtime-image'))
      .toBe('data:image/png;base64,iVBORw==')
    expect(document.querySelector(`[data-runtime-probe="${firstId}"]`))
      .toHaveTextContent('First title')
    const target = screen.getByRole('button', { name: /Runtime title，双击编辑文字/ })
    fireEvent.doubleClick(target)
    const editor = screen.getByRole('textbox', { name: 'Runtime title' })
    fireEvent.change(editor, { target: { value: 'Updated title' } })
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      projectId: fixture.project.id,
      scope: 'global',
      sceneId: fixture.locationId,
      nodeId: firstId,
      key: 'title',
    }))
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      contentKey: 'title',
    }), 'Updated title')

    rendered.rerender(renderAdapter(
      fixture.project,
      240,
      'global',
      'initial',
      { ...fixture.assetFiles, unrelated: Uint8Array.from([1]) },
    ))
    expect(ownerInstances).toHaveLength(1)
    expect(ownerInstances[0]?.moves).toEqual([fixture.surfaceId])
    fireEvent.doubleClick(screen.getByRole('button', {
      name: /Runtime title，双击编辑文字/,
    }))
    expect(capture).toHaveBeenLastCalledWith(expect.objectContaining({
      targetId: `${firstId}:title`,
    }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Runtime title' }), {
      key: 'Escape',
    })

    const lockedProject = structuredClone(fixture.project)
    const lockedRuntime = lockedProject.globalLayerItems.find(
      (entry) => entry.item.layerItemId === firstId,
    )?.item
    if (!lockedRuntime) throw new Error('expected first global Runtime')
    lockedRuntime.locked = true
    lockedProject.revision += 1
    rendered.rerender(renderAdapter(courseProjectDocumentSchema.parse(lockedProject), 240))
    expect(screen.queryByRole('button', {
      name: /Runtime title，双击编辑文字/,
    })).toBeNull()

    const unlockedProject = structuredClone(lockedProject)
    const unlockedRuntime = unlockedProject.globalLayerItems.find(
      (entry) => entry.item.layerItemId === firstId,
    )?.item
    if (!unlockedRuntime) throw new Error('expected first global Runtime')
    unlockedRuntime.locked = false
    unlockedProject.revision += 1
    rendered.rerender(renderAdapter(courseProjectDocumentSchema.parse(unlockedProject), 240))
    expect(screen.getByRole('button', {
      name: /Runtime title，双击编辑文字/,
    })).toBeInTheDocument()
    expect(ownerInstances).toHaveLength(1)

    const updatedProject = structuredClone(fixture.project)
    const first = updatedProject.globalLayerItems.find(
      (entry) => entry.item.layerItemId === firstId,
    )?.item
    if (!first || first.kind !== 'runtime') throw new Error('expected first Runtime')
    first.runtime.content.values.title = 'Updated title'
    updatedProject.revision += 1
    rendered.rerender(renderAdapter(courseProjectDocumentSchema.parse(updatedProject), 240))
    await vi.waitFor(() => {
      expect(ownerInstances[0]?.applied).toEqual([
        [firstId, 'title', 'Updated title'],
      ])
    })
    expect(ownerInstances).toHaveLength(1)

    rendered.rerender(renderAdapter(
      courseProjectDocumentSchema.parse(updatedProject),
      240,
      'global',
      'replacement',
    ))
    await vi.waitFor(() => {
      expect(ownerInstances[0]?.moves.length).toBeGreaterThan(1)
    })
    expect(ownerInstances).toHaveLength(1)

    rendered.rerender(renderAdapter(
      courseProjectDocumentSchema.parse(updatedProject),
      240,
      'world',
      'replacement',
    ))
    expect(screen.queryByTestId('spatial-runtime-authoring-targets')).toBeNull()
    expect(ownerInstances).toHaveLength(1)

    rendered.unmount()
    expect(ownerInstances[0]?.destroyed).toBe(1)
  })

  it('captures and commits a Spatial global Runtime through createRuntimeAuthoringActions', () => {
    const fixture = spatialGlobalFixture()
    let project = fixture.project
    let authoringSession = buildCourseAuthoringSessionForProject(project, fixture.locationId)
    const actions = createRuntimeAuthoringActions({
      read: () => ({
        document: project,
        sidecar: null,
        componentPackages: {},
        authoringSession,
        editingScope: 'global',
        activeSceneId: undefined,
        projection: projectEffectiveLayers({
          project,
          locationId: fixture.locationId,
          owner: 'global',
        }),
      }),
      setFeedback: () => undefined,
      persistTransaction: (step) => {
        project = step.nextDocument
        authoringSession = buildCourseAuthoringSessionForProject(project, fixture.locationId)
        return true
      },
      persistSlideCommand: () => ({ ok: false, reason: 'not-slide', historyEntry: false }),
      persistProject: (document) => { project = document },
    })
    const session: RuntimeTargetEditSession = {
      projectId: project.id,
      scope: 'global',
      sceneId: fixture.locationId,
      targetId: `${fixture.itemIds[0]}:title`,
      nodeId: fixture.itemIds[0],
      kind: 'text',
      key: 'title',
    }
    const target = actions.captureRuntimeContentTextTarget(session)
    expect(target?.courseTarget).toMatchObject({
      surfaceType: 'spatial-2d',
      locationId: fixture.locationId,
      surfaceId: fixture.surfaceId,
      owner: 'global',
      ownerKey: 'global',
      itemId: fixture.itemIds[0],
    })
    expect(target?.courseTarget.authoringAddress).toContain(
      `/global/-/-/runtime/${fixture.itemIds[0]}?field=runtime%2Fcontent%2Fvalues%2Ftitle`,
    )
    if (!target) throw new Error('expected formal Runtime content target')
    expect(actions.updateRuntimeContentTextAtTarget(target, 'Spatial committed')).toMatchObject({
      ok: true,
      status: 'updated',
    })
    const committed = project.globalLayerItems.find(
      (entry) => entry.item.layerItemId === fixture.itemIds[0],
    )?.item
    expect(committed?.kind === 'runtime' ? committed.runtime.content.values.title : null)
      .toBe('Spatial committed')
  })

  it('keeps supported Spatial world charts on EditableChartView and routes text edits through the canonical command port', () => {
    const fixture = spatialGlobalFixture()
    const project = structuredClone(fixture.project)
    const chart = createChartLayerItem(createChartNode({
      id: 'spatial-global-chart',
      title: 'Global chart title',
    }), 300)
    chart.layerItemId = 'spatial-global-chart'
    chart.frame = { mode: 'absolute', x: 180, y: 220, width: 440, height: 280 }
    const spatial = project.surfaces.find(
      (surface) => surface.id === fixture.surfaceId && surface.type === 'spatial-2d',
    )
    if (!spatial || spatial.type !== 'spatial-2d') throw new Error('expected Spatial surface')
    spatial.world.layerItems.push(chart)
    const parsed = courseProjectDocumentSchema.parse(project)
    const view = buildSpatialEditorView({
      project: parsed,
      locationId: fixture.locationId,
      sessionCamera: { x: 0, y: 0, zoom: 1 },
    })
    const authoringSession = buildCourseAuthoringSessionForProject(parsed, fixture.locationId)
    const worldTarget = captureSpatialEditorAuthoringTarget({
      view,
      sessionToken: authoringSession.token,
      target: { kind: 'world', field: 'world' },
    })
    const layerTargets = new Map(view.layers.map((layer) => [
      layer.selectionId,
      captureSpatialEditorAuthoringTarget({
        view,
        sessionToken: authoringSession.token,
        target: { kind: 'layer', layerItemId: layer.selectionId, field: 'frame' },
      }),
    ] as const))
    const run = vi.fn(() => ({ ok: false as const, reason: 'probe-stop', historyEntry: false }))
    const mounted = render(
      <SpatialLocationWorkspace
        view={view}
        showCameraFrames={false}
        targets={spatialEditorStableTargets(view)}
        selectionIds={[]}
        graphSelection={null}
        canvasMode="edit"
        scope="world"
        contentEdit={null}
        assetFiles={fixture.assetFiles}
        assetMimeTypes={{}}
        componentPackages={{}}
        project={parsed}
        runtimeContentAuthoring={{
          captureRuntimeContentTextTarget: () => null,
          updateRuntimeContentTextAtTarget: () => ({
            ok: false,
            code: 'invalid-target',
            reason: 'not-used',
          }),
        }}
        worldTarget={worldTarget}
        layerTargets={layerTargets}
        commands={{ run: run as never }}
        onCanvasModeChange={() => undefined}
        onMountTryRun={() => Promise.reject(new Error('not-used'))}
      />,
    )

    const chartWrapper = mounted.container.querySelector(
      '[data-layer-id="spatial-global-chart"]',
    )
    expect(chartWrapper?.querySelector('[data-testid="editable-chart-view"]')).not.toBeNull()
    const label = chartWrapper?.querySelector('[data-chart-text]')
    if (!label) throw new Error('expected global chart text target')
    fireEvent.doubleClick(label)
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 'spatial-global-chart' }),
      expect.objectContaining({ kind: 'begin-content-edit' }),
    )
  })
})
