import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeTargetEditSession } from '@/renderer/authoring/runtimeTargetEditSession'
import { isFlowEditorTransactionFrame } from '@/renderer/course/flowEditorSlice'
import { isSlideAuthoringTransactionFrame } from '@/renderer/course/slideEditorCommands'
import { isSpatialAuthoringTransactionFrame } from '@/renderer/course/spatialAuthoringHistory'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
} from '@/renderer/project/courseProjectArchive'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import {
  captureCourseRuntimeContentTextTarget,
  type CourseRuntimeContentTextTarget,
} from '@/renderer/runtime/runtimeContentTextAuthoringCommands'
import {
  selectActiveCourseProjectDocument,
  selectMediaAssetFiles,
  useEditorStore,
} from '@/renderer/store/editorStore'
import { Workspace } from '@/renderer/ui/Workspace'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  RuntimeLayerItem,
} from '@/shared/courseProjectTypes'
import {
  PLAYER_AUTHORING_MESSAGE_TYPES,
  PLAYER_AUTHORING_PROTOCOL_VERSION,
} from '@/shared/playerAuthoringProtocol'
import type { RuntimeAuthoringTarget } from '@/shared/runtimeTypes'

vi.mock('@/renderer/export/loadPlayerBundle', () => ({
  loadPlayerBundle: () => '/* Runtime content text vertical slice Player bundle */',
}))

vi.mock('@/renderer/authoring/authoringReadiness', () => ({
  isAuthoringCanvasInteractive: () => true,
}))

vi.mock('@/renderer/phaser/createEditorGame', () => ({
  createEditorGame: () => {
    const methods = new Map<PropertyKey, (...args: unknown[]) => unknown>()
    const bridge = new Proxy<Record<PropertyKey, unknown>>({}, {
      get: (_target, property) => {
        let method = methods.get(property)
        if (!method) {
          method = String(property).startsWith('on')
            ? () => () => undefined
            : () => undefined
          methods.set(property, method)
        }
        return method
      },
    })
    return {
      bridge,
      game: { scale: { refresh: () => undefined } },
      destroy: () => undefined,
    }
  },
}))

const CREATED_AT = '2026-08-24T00:00:00.000Z'
const ARCHIVE_TIME = '2026-08-24T12:00:00.000Z'
const CONTENT_KEY = 'title/~lesson'
const FALLBACK_ASSET_ID = 'runtime-content-fallback'
const PREVIEW_TOKEN = '00000000-0000-4000-8000-000000000010'

type FixtureKind =
  | 'slide-scene'
  | 'slide-surface'
  | 'slide-global'
  | 'flow-surface'
  | 'flow-global'
  | 'spatial-surface'
  | 'spatial-world'
  | 'spatial-global'

type HistoryKind = 'slide' | 'flow' | 'spatial'

interface RuntimeContentFixture {
  readonly kind: FixtureKind
  readonly project: CourseProjectDocument
  readonly assetFiles: Record<string, Uint8Array>
  readonly locationId: string
  readonly surfaceId: string
  readonly sceneId: string | null
  readonly owner: 'global' | 'surface' | 'scene' | 'world'
  readonly itemId: string
  readonly historyKind: HistoryKind
  readonly initialValue: string
  readonly nextValue: string
}

function runtimeLayer(input: {
  readonly id: string
  readonly api: 2 | 3
  readonly value: string
  readonly order?: number
  readonly visible?: boolean
  readonly locked?: boolean
}): RuntimeLayerItem {
  const common = {
    kind: 'runtime' as const,
    layerItemId: input.id,
    label: `Runtime ${input.id}`,
    frame: { mode: 'absolute' as const, x: 100, y: 80, width: 640, height: 360 },
    order: input.order ?? 1,
    visible: input.visible ?? false,
    locked: input.locked ?? false,
    rotation: 5,
    opacity: 0.85,
    hitPolicy: 'surface' as const,
    playbackInitialVisibility: 'hidden' as const,
  }
  const content = {
    values: {
      [CONTENT_KEY]: input.value,
      untouched: 'preserve-this-value',
    },
    metadata: {
      [CONTENT_KEY]: { label: '课程标题', multiline: false, maxLength: 120 },
      untouched: { label: '不可改字段', multiline: true },
    },
  }
  return input.api === 2
    ? {
        ...common,
        runtime: {
          protocol: 'canvas-runtime',
          runtimeApiVersion: 2,
          enabled: true,
          renderMode: 'hybrid',
          source: 'CoursewareRuntime.define({runtimeApiVersion:2,create(){return{destroy(){}}}})',
          content,
          assets: { hero: { assetId: FALLBACK_ASSET_ID } },
          nodeBindings: input.visible ? {} : { untouched: 'runtime-node-binding' },
          staticFallback: { assetId: FALLBACK_ASSET_ID, coverage: 'scene' },
        },
      }
    : {
        ...common,
        runtime: {
          protocol: 'surface-runtime',
          runtimeApiVersion: 3,
          enabled: false,
          renderMode: 'dom',
          source: 'CoursewareRuntime.define({runtimeApiVersion:3,protocol:"surface-runtime",create(){return{destroy(){}}}})',
          content,
          assets: { hero: { assetId: FALLBACK_ASSET_ID } },
          nodeBindings: input.visible ? {} : { untouched: 'runtime-node-binding' },
          staticFallback: { assetId: FALLBACK_ASSET_ID, coverage: 'surface' },
        },
      }
}

function fixture(
  kind: FixtureKind,
  options: {
    readonly visible?: boolean
    readonly locked?: boolean
    readonly secondRuntime?: boolean
  } = {},
): RuntimeContentFixture {
  let sequence = 0
  const base = createBlankCourseProject({
    id: `runtime-content-${kind}`,
    title: `Runtime content ${kind}`,
    now: CREATED_AT,
    includeDefaultController: false,
    controls: 'none',
    idFactory: () => `runtime-content-fixture-${++sequence}`,
  })
  const api = kind.startsWith('flow-') || kind.startsWith('spatial-') ? 3 : 2
  const itemId = `runtime-content-${kind}`
  const initialValue = `${kind} initial`
  const nextValue = `${kind} committed`
  const primary = runtimeLayer({
    id: itemId,
    api,
    value: initialValue,
    visible: options.visible,
    locked: options.locked,
  })
  const localItems = [
    primary,
    ...(options.secondRuntime
      ? [runtimeLayer({
          id: `${itemId}-second`,
          api,
          value: `${kind} second`,
          order: 900,
          visible: options.visible,
        })]
      : []),
  ]
  const scopedItems = localItems.map((item) => ({
    item,
    visibility: { mode: 'all' as const, locationIds: [] },
  }))
  const fallbackBytes = Uint8Array.from([7, 5, 3, 1])
  const assets = {
    [FALLBACK_ASSET_ID]: {
      id: FALLBACK_ASSET_ID,
      filename: 'runtime-content-fallback.png',
      mimeType: 'image/png',
      kind: 'image' as const,
      path: 'assets/runtime-content-fallback.png',
      byteLength: fallbackBytes.byteLength,
      width: 16,
      height: 16,
    },
  }

  if (kind.startsWith('slide-')) {
    const surface = base.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('Expected Slide surface')
    const scene = structuredClone(surface.scenes[0]!)
    scene.layerItems = kind === 'slide-scene' ? localItems : []
    const project = courseProjectDocumentSchema.parse({
      ...base,
      assets,
      globalLayerItems: kind === 'slide-global' ? scopedItems : [],
      surfaces: [{
        ...surface,
        surfaceLayerItems: kind === 'slide-surface' ? scopedItems : [],
        scenes: [scene],
      }],
    })
    return {
      kind,
      project,
      assetFiles: { [FALLBACK_ASSET_ID]: fallbackBytes },
      locationId: project.locations[0]!.id,
      surfaceId: surface.id,
      sceneId: kind === 'slide-scene' ? scene.id : null,
      owner: kind === 'slide-global'
        ? 'global'
        : kind === 'slide-surface'
          ? 'surface'
          : 'scene',
      itemId,
      historyKind: 'slide',
      initialValue,
      nextValue,
    }
  }

  if (kind.startsWith('flow-')) {
    const surfaceId = 'runtime-content-flow-surface'
    const locationId = 'runtime-content-flow-location'
    const blockId = 'runtime-content-flow-heading'
    const project = courseProjectDocumentSchema.parse({
      ...base,
      assets,
      globalLayerItems: kind === 'flow-global' ? scopedItems : [],
      locations: [{
        id: locationId,
        label: 'Runtime content Flow',
        kind: 'flow-block',
        surfaceId,
        blockId,
      }],
      startLocationId: locationId,
      surfaces: [{
        id: surfaceId,
        title: 'Runtime content Flow',
        type: 'flow',
        layout: { readingWidth: 760, wideContentWidth: 1120 },
        surfaceLayerItems: kind === 'flow-surface' ? scopedItems : [],
        blocks: [{ id: blockId, type: 'heading', level: 1, text: 'Flow' }],
      }],
    })
    return {
      kind,
      project,
      assetFiles: { [FALLBACK_ASSET_ID]: fallbackBytes },
      locationId,
      surfaceId,
      sceneId: null,
      owner: kind === 'flow-global' ? 'global' : 'surface',
      itemId,
      historyKind: 'flow',
      initialValue,
      nextValue,
    }
  }

  const surfaceId = 'runtime-content-spatial-surface'
  const locationId = 'runtime-content-spatial-location'
  const cameraFrameId = 'runtime-content-spatial-camera'
  const project = courseProjectDocumentSchema.parse({
    ...base,
    assets,
    globalLayerItems: kind === 'spatial-global' ? scopedItems : [],
    locations: [{
      id: locationId,
      label: 'Runtime content Spatial',
      kind: 'spatial-camera',
      surfaceId,
      cameraFrameId,
    }],
    startLocationId: locationId,
    surfaces: [{
      id: surfaceId,
      title: 'Runtime content Spatial',
      type: 'spatial-2d',
      surfaceLayerItems: kind === 'spatial-surface' ? scopedItems : [],
      world: {
        bounds: { mode: 'infinite' },
        layerItems: kind === 'spatial-world' ? localItems : [],
      },
      camera: {
        home: { x: 0, y: 0, zoom: 1 },
        frames: [{ id: cameraFrameId, name: 'Home', x: 0, y: 0, zoom: 1 }],
      },
      semanticZoom: [],
    }],
  })
  return {
    kind,
    project,
    assetFiles: { [FALLBACK_ASSET_ID]: fallbackBytes },
    locationId,
    surfaceId,
    sceneId: null,
    owner: kind === 'spatial-global'
      ? 'global'
      : kind === 'spatial-surface'
        ? 'surface'
        : 'world',
    itemId,
    historyKind: 'spatial',
    initialValue,
    nextValue,
  }
}

function loadFixture(
  kind: FixtureKind,
  options?: Parameters<typeof fixture>[1],
): RuntimeContentFixture {
  const source = fixture(kind, options)
  useEditorStore.getState().loadCourseProject(
    source.project,
    null,
    source.assetFiles,
    {},
  )
  useEditorStore.getState().activateCourseLocation(source.locationId)
  if (source.owner === 'global') useEditorStore.getState().setEditingScope('global')
  return source
}

function activeProject(): CourseProjectDocument {
  const project = selectActiveCourseProjectDocument(useEditorStore.getState())
  if (!project) throw new Error('Expected active Course Project V9')
  return project
}

function activeHistory() {
  const state = useEditorStore.getState()
  if (state.spatialSession) return { kind: 'spatial' as const, history: state.spatialSession.history }
  if (state.flowSession) return { kind: 'flow' as const, history: state.flowSession.history }
  if (state.slideBackend?.kind === 'slide-authoring') {
    return { kind: 'slide' as const, history: state.slideBackend.getSession().history }
  }
  throw new Error('Expected active authoring history')
}

function runtimeItem(project: CourseProjectDocument, itemId: string): RuntimeLayerItem {
  const global = project.globalLayerItems.find(
    (entry) => entry.item.layerItemId === itemId,
  )?.item
  if (global?.kind === 'runtime') return global
  for (const surface of project.surfaces) {
    const shared = surface.surfaceLayerItems.find(
      (entry) => entry.item.layerItemId === itemId,
    )?.item
    if (shared?.kind === 'runtime') return shared
    if (surface.type === 'slide') {
      for (const scene of surface.scenes) {
        const item = scene.layerItems.find((candidate) => candidate.layerItemId === itemId)
        if (item?.kind === 'runtime') return item
      }
    }
    if (surface.type === 'spatial-2d') {
      const item = surface.world.layerItems.find(
        (candidate) => candidate.layerItemId === itemId,
      )
      if (item?.kind === 'runtime') return item
    }
  }
  throw new Error(`Missing Runtime ${itemId}`)
}

function contentValue(project: CourseProjectDocument, itemId: string): string {
  return runtimeItem(project, itemId).runtime.content.values[CONTENT_KEY] as string
}

function discoverySession(
  source: RuntimeContentFixture,
  targetId = `runtime:${source.kind}:discovery-only`,
): RuntimeTargetEditSession {
  return {
    projectId: activeProject().id,
    scope: source.owner === 'global' ? 'global' : 'scene',
    sceneId: useEditorStore.getState().activeSceneId,
    targetId,
    kind: 'text',
    key: CONTENT_KEY,
  }
}

function captureDirectTarget(source: RuntimeContentFixture): CourseRuntimeContentTextTarget {
  const state = useEditorStore.getState()
  const session = state.courseAuthoringSession
  if (!session) throw new Error('Expected Course authoring session')
  return captureCourseRuntimeContentTextTarget({
    sessionToken: session.token,
    projectId: activeProject().id,
    surfaceId: source.surfaceId,
    stateId: state.activePresentationStateId,
    owner: source.owner,
    sceneId: source.sceneId,
    itemId: source.itemId,
    contentKey: CONTENT_KEY,
    initialValue: source.initialValue,
  })
}

function captureProjectedTarget(source: RuntimeContentFixture): CourseRuntimeContentTextTarget {
  const target = useEditorStore.getState().captureRuntimeContentTextTarget(
    discoverySession(source),
  )
  if (!target) throw new Error('Expected projected Runtime text target')
  return target
}

function targetForStore(source: RuntimeContentFixture): CourseRuntimeContentTextTarget {
  return source.kind === 'slide-scene' || source.kind === 'slide-global'
    ? captureProjectedTarget(source)
    : captureDirectTarget(source)
}

function compatibilityDepths() {
  const state = useEditorStore.getState()
  return {
    sidecarPast: state.slideCandidateSidecarPast.length,
    sidecarFuture: state.slideCandidateSidecarFuture.length,
    componentPast: state.slideCandidateComponentPackagesPast.length,
    componentFuture: state.slideCandidateComponentPackagesFuture.length,
  }
}

function byteMap(files: Readonly<Record<string, Uint8Array>>) {
  return Object.fromEntries(
    Object.entries(files).map(([id, bytes]) => [id, [...bytes]]),
  )
}

function authoritativeSnapshot() {
  const state = useEditorStore.getState()
  return {
    project: structuredClone(activeProject()),
    derivedProject: structuredClone(state.project),
    activeHistory: structuredClone(activeHistory().history),
    storeHistory: structuredClone(state.history),
    files: byteMap(selectMediaAssetFiles(state)),
    compatibility: compatibilityDepths(),
    packages: structuredClone(state.componentPackages),
    courseSession: structuredClone(state.courseAuthoringSession),
    dirty: state.dirty,
  }
}

function newestTransactionResourceChanges() {
  const active = activeHistory()
  const frame = active.history.past.at(-1)
  const isTransaction = active.kind === 'slide'
    ? Boolean(frame && isSlideAuthoringTransactionFrame(frame))
    : active.kind === 'flow'
      ? Boolean(frame && isFlowEditorTransactionFrame(frame))
      : Boolean(frame && isSpatialAuthoringTransactionFrame(frame))
  expect(isTransaction).toBe(true)
  if (!frame || !('kind' in frame) || frame.kind !== 'editor-transaction') {
    throw new Error('Expected current editor transaction')
  }
  return frame.resourceChanges
}

let targetRevision = 0

async function publishRuntimeTextTarget(input: {
  readonly scope: 'scene' | 'global'
  readonly sceneId: string
  readonly targetId?: string
  readonly targets?: readonly RuntimeAuthoringTarget[]
}): Promise<void> {
  const frame = await screen.findByTitle('统一编辑画布') as HTMLIFrameElement
  if (!frame.contentWindow) throw new Error('Preview iframe has no contentWindow')
  targetRevision += 1
  const target: RuntimeAuthoringTarget = {
    targetId: input.targetId ?? `runtime:${input.scope}:text-target`,
    scope: input.scope,
    ...(input.scope === 'scene' ? { sceneId: input.sceneId } : {}),
    kind: 'text',
    key: CONTENT_KEY,
    label: input.scope === 'global' ? '全局课程标题' : '场景课程标题',
    multiline: false,
    maxLength: 120,
    layer: 'overlay',
    source: 'registered',
    bounds: { x: 100, y: 90, width: 320, height: 48 },
  }
  await act(async () => {
    window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      data: {
        type: PLAYER_AUTHORING_MESSAGE_TYPES.runtimeTargets,
        token: PREVIEW_TOKEN,
        protocolVersion: PLAYER_AUTHORING_PROTOCOL_VERSION,
        sessionId: PREVIEW_TOKEN,
        revision: targetRevision,
        update: {
          revision: targetRevision,
          scope: input.scope,
          ...(input.scope === 'scene' ? { sceneId: input.sceneId } : {}),
          targets: input.targets ?? [target],
        },
      },
    }))
  })
}

const originalCapture = useEditorStore.getState().captureRuntimeContentTextTarget
const originalUpdate = useEditorStore.getState().updateRuntimeContentTextAtTarget
const originalUpdateSceneRuntime = useEditorStore.getState().updateSceneRuntime
const originalUpdateGlobalRuntime = useEditorStore.getState().updateGlobalRuntime

function installWorkspaceWriteSpies() {
  const capture = vi.fn(originalCapture)
  const update = vi.fn(originalUpdate)
  const updateSceneRuntime = vi.fn(originalUpdateSceneRuntime)
  const updateGlobalRuntime = vi.fn(originalUpdateGlobalRuntime)
  useEditorStore.setState({
    captureRuntimeContentTextTarget: capture,
    updateRuntimeContentTextAtTarget: update,
    updateSceneRuntime,
    updateGlobalRuntime,
  })
  return { capture, update, updateSceneRuntime, updateGlobalRuntime }
}

beforeEach(() => {
  targetRevision = 0
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(PREVIEW_TOKEN)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:runtime-content-preview')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  useEditorStore.getState().createNewProject()
})

afterEach(() => {
  cleanup()
  useEditorStore.setState({
    captureRuntimeContentTextTarget: originalCapture,
    updateRuntimeContentTextAtTarget: originalUpdate,
    updateSceneRuntime: originalUpdateSceneRuntime,
    updateGlobalRuntime: originalUpdateGlobalRuntime,
  })
  useEditorStore.getState().clearV9SlideCandidateBackend()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ARCH-2 Runtime content text Store vertical slice', () => {
  it.each([
    ['slide-scene', 'slide'],
    ['slide-global', 'slide'],
    ['flow-surface', 'flow'],
    ['flow-global', 'flow'],
    ['spatial-world', 'spatial'],
    ['spatial-global', 'spatial'],
  ] as const)(
    'commits %s through one current %s transaction and exactly preserves unrelated fields',
    (fixtureKind, expectedHistoryKind) => {
      const source = loadFixture(fixtureKind)
      const target = targetForStore(source)
      const beforeProject = structuredClone(activeProject())
      const beforeRuntime = structuredClone(runtimeItem(beforeProject, source.itemId))
      const beforeHistoryDepth = activeHistory().history.past.length
      const beforeStoreDepth = useEditorStore.getState().history.past.length
      const beforeCompatibility = compatibilityDepths()

      expect(activeHistory().kind).toBe(expectedHistoryKind)
      expect(useEditorStore.getState().updateRuntimeContentTextAtTarget(
        target,
        source.nextValue,
      )).toMatchObject({
        ok: true,
        status: 'updated',
        feedback: {
          kind: 'runtime-content-text-updated',
          itemId: source.itemId,
          contentKey: CONTENT_KEY,
          previousValue: source.initialValue,
          value: source.nextValue,
        },
      })

      const committed = structuredClone(activeProject())
      const expectedRuntime = structuredClone(beforeRuntime)
      expectedRuntime.runtime.content.values[CONTENT_KEY] = source.nextValue
      expect(runtimeItem(committed, source.itemId)).toEqual(expectedRuntime)
      expect(committed.revision).toBe(beforeProject.revision + 1)
      expect(activeHistory().history.past).toHaveLength(beforeHistoryDepth + 1)
      expect(useEditorStore.getState().history.past).toHaveLength(beforeStoreDepth + 1)
      expect(newestTransactionResourceChanges()).toEqual({})
      expect(compatibilityDepths()).toEqual(beforeCompatibility)

      useEditorStore.getState().undo()
      expect(activeProject()).toEqual(beforeProject)
      expect(contentValue(activeProject(), source.itemId)).toBe(source.initialValue)
      expect(compatibilityDepths()).toEqual(beforeCompatibility)

      useEditorStore.getState().redo()
      expect(activeProject()).toEqual(committed)
      expect(contentValue(activeProject(), source.itemId)).toBe(source.nextValue)
      expect(compatibilityDepths()).toEqual(beforeCompatibility)
    },
  )

  it.each(['slide-scene', 'slide-global'] as const)(
    'captures %s from the projected first Runtime, with host targetId discovery-only',
    (fixtureKind) => {
      const source = loadFixture(fixtureKind, { secondRuntime: true })
      const target = useEditorStore.getState().captureRuntimeContentTextTarget(
        discoverySession(source, 'runtime:host-token-that-must-not-persist'),
      )

      expect(target).toMatchObject({
        contentKey: CONTENT_KEY,
        initialValue: source.initialValue,
        courseTarget: {
          itemId: source.itemId,
          owner: source.owner,
          stateId: null,
        },
      })
      expect(target?.courseTarget.authoringAddress).toContain(
        'field=runtime%2Fcontent%2Fvalues%2Ftitle~1~0lesson',
      )
      expect(JSON.stringify(target)).not.toContain('host-token')
    },
  )

  it.each([
    'slide-surface',
    'flow-surface',
    'flow-global',
    'spatial-surface',
    'spatial-world',
    'spatial-global',
  ] as const)('does not fabricate projected visual capture for %s', (fixtureKind) => {
    const source = loadFixture(fixtureKind)
    expect(useEditorStore.getState().captureRuntimeContentTextTarget(
      discoverySession(source),
    )).toBeNull()
  })

  it('keeps same-value, stale revision, locked and deleted targets at zero authoritative writes', () => {
    let source = loadFixture('slide-scene')
    let target = captureProjectedTarget(source)
    let before = authoritativeSnapshot()

    expect(useEditorStore.getState().updateRuntimeContentTextAtTarget(
      target,
      source.initialValue,
    )).toMatchObject({ ok: true, status: 'unchanged' })
    expect(authoritativeSnapshot()).toEqual(before)

    useEditorStore.getState().renameProject('Runtime text intervening revision')
    before = authoritativeSnapshot()
    expect(useEditorStore.getState().updateRuntimeContentTextAtTarget(
      target,
      source.nextValue,
    )).toMatchObject({ ok: false, code: 'revision-conflict' })
    expect(authoritativeSnapshot()).toEqual(before)

    source = loadFixture('slide-scene', { locked: true })
    expect(useEditorStore.getState().captureRuntimeContentTextTarget(
      discoverySession(source),
    )).toBeNull()
    target = captureDirectTarget(source)
    before = authoritativeSnapshot()
    expect(useEditorStore.getState().updateRuntimeContentTextAtTarget(
      target,
      source.nextValue,
    )).toMatchObject({ ok: false, code: 'target-locked' })
    expect(authoritativeSnapshot()).toEqual(before)

    source = loadFixture('slide-scene')
    target = captureProjectedTarget(source)
    useEditorStore.getState().deleteNode(source.itemId)
    before = authoritativeSnapshot()
    expect(useEditorStore.getState().updateRuntimeContentTextAtTarget(
      target,
      source.nextValue,
    )).toMatchObject({ ok: false, code: 'item-missing' })
    expect(authoritativeSnapshot()).toEqual(before)
  })

  it('preserves an API 3 Runtime through archive reopen and Published V2 reads', () => {
    const source = loadFixture('spatial-world')
    const target = captureDirectTarget(source)
    const beforeRuntime = structuredClone(runtimeItem(activeProject(), source.itemId))
    expect(useEditorStore.getState().updateRuntimeContentTextAtTarget(
      target,
      source.nextValue,
    )).toMatchObject({ ok: true, status: 'updated' })

    const beforeReads = authoritativeSnapshot()
    const archive = createCourseProjectArchive({
      project: activeProject(),
      assetFiles: selectMediaAssetFiles(useEditorStore.getState()),
      componentFiles: {},
    }, { mtime: ARCHIVE_TIME })
    const reopened = openCourseProjectArchive(archive)
    const reopenedRuntime = runtimeItem(reopened.project, source.itemId)
    const expected = structuredClone(beforeRuntime)
    expected.runtime.content.values[CONTENT_KEY] = source.nextValue
    expect(reopenedRuntime).toEqual(expected)
    expect(reopenedRuntime.runtime).toMatchObject({
      protocol: 'surface-runtime',
      runtimeApiVersion: 3,
      renderMode: 'dom',
      enabled: false,
    })

    const published = buildPublishedCourseV2Payload({
      project: reopened.project,
      assetFiles: reopened.assetFiles,
      components: {},
    })
    const spatial = published.surfaces.find(
      (surface) => surface.id === source.surfaceId,
    )
    if (!spatial || spatial.type !== 'spatial-2d') {
      throw new Error('Expected Published Spatial surface')
    }
    const publishedRuntime = spatial.world.layerItems.find(
      (item) => item.layerItemId === source.itemId,
    )
    expect(publishedRuntime).toMatchObject({
      kind: 'runtime',
      runtime: {
        protocol: 'surface-runtime',
        runtimeApiVersion: 3,
        renderMode: 'dom',
        enabled: false,
        content: {
          values: {
            [CONTENT_KEY]: source.nextValue,
            untouched: 'preserve-this-value',
          },
        },
      },
    })
    expect(authoritativeSnapshot()).toEqual(beforeReads)
  })
})

describe('ARCH-2 Workspace Runtime content text binding', () => {
  it.each(['slide-scene', 'slide-global'] as const)(
    'captures %s before opening and commits only through the canonical typed action',
    async (fixtureKind) => {
      const source = loadFixture(fixtureKind, { visible: true })
      const spies = installWorkspaceWriteSpies()
      render(
        <Workspace
          onAddImage={() => undefined}
          onAddVideo={() => undefined}
          onSelectImageAsset={async () => null}
        />,
      )
      await publishRuntimeTextTarget({
        scope: source.owner === 'global' ? 'global' : 'scene',
        sceneId: useEditorStore.getState().activeSceneId,
      })
      const label = source.owner === 'global' ? '全局课程标题' : '场景课程标题'
      const button = await screen.findByRole('button', {
        name: `${label}，双击编辑文字`,
      })

      fireEvent.click(button)
      expect(spies.capture).toHaveBeenCalledOnce()
      const editor = await screen.findByTestId('canvas-plain-text-editor')
      const control = screen.getByRole('textbox', { name: label })
      expect(control).toHaveValue(source.initialValue)
      fireEvent.change(control, { target: { value: source.nextValue } })
      fireEvent.keyDown(control, { key: 'Enter' })

      await waitFor(() => {
        expect(contentValue(activeProject(), source.itemId)).toBe(source.nextValue)
      })
      expect(editor).not.toBeInTheDocument()
      expect(spies.update).toHaveBeenCalledOnce()
      expect(spies.update.mock.calls[0]?.[0]).toEqual(
        spies.capture.mock.results[0]?.value,
      )
      expect(spies.updateSceneRuntime).not.toHaveBeenCalled()
      expect(spies.updateGlobalRuntime).not.toHaveBeenCalled()
    },
  )

  it('closes a captured edit when the live host replaces the target and performs zero writes', async () => {
    const source = loadFixture('slide-scene', { visible: true })
    const spies = installWorkspaceWriteSpies()
    render(
      <Workspace
        onAddImage={() => undefined}
        onAddVideo={() => undefined}
        onSelectImageAsset={async () => null}
      />,
    )
    const sceneId = useEditorStore.getState().activeSceneId
    await publishRuntimeTextTarget({ scope: 'scene', sceneId, targetId: 'runtime:text:original' })
    fireEvent.click(await screen.findByRole('button', {
      name: '场景课程标题，双击编辑文字',
    }))
    expect(await screen.findByTestId('canvas-plain-text-editor')).toBeInTheDocument()
    const before = authoritativeSnapshot()

    const replacement: RuntimeAuthoringTarget = {
      targetId: 'runtime:text:replacement',
      scope: 'scene',
      sceneId,
      kind: 'text',
      key: CONTENT_KEY,
      label: '场景课程标题',
      multiline: false,
      layer: 'overlay',
      source: 'registered',
      bounds: { x: 120, y: 100, width: 300, height: 48 },
    }
    await publishRuntimeTextTarget({
      scope: 'scene',
      sceneId,
      targets: [replacement],
    })

    await waitFor(() => {
      expect(screen.queryByTestId('canvas-plain-text-editor')).not.toBeInTheDocument()
    })
    expect(spies.capture).toHaveBeenCalledOnce()
    expect(spies.update).not.toHaveBeenCalled()
    expect(spies.updateSceneRuntime).not.toHaveBeenCalled()
    expect(spies.updateGlobalRuntime).not.toHaveBeenCalled()
    expect(authoritativeSnapshot()).toEqual(before)
  })
})
