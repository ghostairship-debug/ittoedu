import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { componentPackagesFromArchive } from '@/renderer/components/componentPackageStore'
import {
  selectActiveCourseProjectDocument,
  useEditorStore,
} from '@/renderer/store/editorStore'
import { AutomationTab } from '@/renderer/ui/AutomationTab'
import { PropertiesTab } from '@/renderer/ui/PropertiesTab'
import type {
  CourseProjectDocument,
  LayerItem,
  SlideSceneDocument,
} from '@/shared/courseProjectTypes'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'
import {
  bootTriageCourseHost,
  formalCourse,
  formalProject,
  projectCourse,
  settleCourse,
  type TriageCourseHost,
} from '../helpers/triage-t7-courseHost'

const SLIDE_LOCATION_ID = 'location-slide'
const FLOW_LOCATION_ID = 'location-flow'
const SPATIAL_LOCATION_ID = 'location-spatial'
const SLIDE_SCENE_ID = 'scene-1'
const ACTIVE_STATE_ID = 'state-question'
const TITLE_ITEM_ID = 'slide-title'
const GLOBAL_ITEM_ID = 'global-banner'

let host: TriageCourseHost

function mixedProject(withSlideState = false): CourseProjectDocument {
  const fixture = listCourseProjectV9Fixtures().find(
    (candidate) => candidate.id === 'mixed',
  )
  if (!fixture) throw new Error('Missing mixed Course Project V9 fixture')

  const project = structuredClone(fixture.data.project)
  if (withSlideState) {
    const location = project.locations.find(
      (candidate) => candidate.id === SLIDE_LOCATION_ID,
    )
    const scene = slideScene(project)
    if (!location || location.kind !== 'slide-scene') {
      throw new Error('Missing representative Slide location')
    }
    delete location.stateId
    scene.presentation = {
      initialStateId: ACTIVE_STATE_ID,
      thumbnailStateId: ACTIVE_STATE_ID,
      states: [{
        id: ACTIVE_STATE_ID,
        name: '提问',
        layerItemOverrides: {},
      }],
    }
  }
  return project
}

/**
 * 2.0 opens every course through the main-owned DocumentSession with the fixture's real
 * asset and component bytes. The removed `loadCourseProject` shortcut never connected a
 * document host, so the renderer projection kept the startup blank document.
 */
async function openMixedProject(withSlideState = false): Promise<void> {
  const fixture = listCourseProjectV9Fixtures().find(
    (candidate) => candidate.id === 'mixed',
  )
  if (!fixture) throw new Error('Missing mixed Course Project V9 fixture')
  const project = mixedProject(withSlideState)
  await projectCourse(
    host,
    project,
    fixture.data.assetFiles,
    componentPackagesFromArchive(project, fixture.data.componentFiles),
  )
}

function loadMixedProject(withSlideState = false): Promise<void> {
  return openMixedProject(withSlideState)
}

function activeProject(): CourseProjectDocument {
  const project = selectActiveCourseProjectDocument(useEditorStore.getState())
  if (!project) throw new Error('Expected an active Course Project V9')
  return project
}

function slideScene(project: CourseProjectDocument): SlideSceneDocument {
  const surface = project.surfaces.find((candidate) => candidate.type === 'slide')
  const scene = surface?.type === 'slide'
    ? surface.scenes.find((candidate) => candidate.id === SLIDE_SCENE_ID)
    : undefined
  if (!scene) throw new Error('Missing representative Slide scene')
  return scene
}

function slideLocation(project: CourseProjectDocument) {
  const location = project.locations.find(
    (candidate) => candidate.id === SLIDE_LOCATION_ID,
  )
  if (!location || location.kind !== 'slide-scene') {
    throw new Error('Missing representative Slide location')
  }
  return location
}

function layer(project: CourseProjectDocument, layerItemId: string): LayerItem {
  const items: LayerItem[] = [
    ...project.globalLayerItems.map((entry) => entry.item),
    ...project.surfaces.flatMap((surface) => [
      ...surface.surfaceLayerItems.map((entry) => entry.item),
      ...(surface.type === 'slide'
        ? surface.scenes.flatMap((scene) => scene.layerItems)
        : surface.type === 'spatial-2d'
          ? surface.world.layerItems
          : []),
    ]),
  ]
  const item = items.find((candidate) => candidate.layerItemId === layerItemId)
  if (!item) throw new Error(`Missing representative layer ${layerItemId}`)
  return item
}

/**
 * The renderer authoring session is a projection of the main-owned DocumentSession in
 * 2.0 and its cursor is built as `{ present, past: [], future: [] }`, so it can never
 * grow. It is kept here as the truthful compatibility check; undo/redo depth and the
 * shape of the newest frame are read from the formal document instead.
 */
function rendererSessionHistory() {
  const state = useEditorStore.getState()
  if (state.spatialSession) return state.spatialSession.history
  if (state.flowSession) return state.flowSession.history
  if (state.slideBackend?.kind === 'slide-authoring') {
    return state.slideBackend.getSession().history
  }
  throw new Error('Expected an active V9 authoring history')
}

function formalHistoryDepths(): { undoDepth: number; redoDepth: number } {
  const snapshot = formalCourse(host)
  return { undoDepth: snapshot.undoDepth, redoDepth: snapshot.redoDepth }
}

function byteFileSnapshot(files: Record<string, Uint8Array>) {
  return Object.fromEntries(
    Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, bytes]) => [path, Array.from(bytes)]),
  )
}

function formalResourceSnapshot() {
  const snapshot = formalCourse(host)
  if (snapshot.model.kind !== 'course-v9') throw new Error('Expected a course document')
  return {
    assets: byteFileSnapshot(snapshot.model.resources.assets),
    components: Object.fromEntries(
      Object.entries(snapshot.model.resources.components)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, files]) => [key, byteFileSnapshot(files)]),
    ),
  }
}

/**
 * The 2.0 form of the removed renderer frame
 * `{ kind: 'editor-transaction', resourceChanges: {} }`: exactly one new undoable frame,
 * authored by a human editor transaction, that carried no resource payload.
 */
function expectOneUndoableFrameWithoutResourceChange(before: {
  undoDepth: number
  redoDepth: number
  resources: ReturnType<typeof formalResourceSnapshot>
}): void {
  const snapshot = formalCourse(host)
  expect({ undoDepth: snapshot.undoDepth, redoDepth: snapshot.redoDepth })
    .toEqual({ undoDepth: before.undoDepth + 1, redoDepth: before.redoDepth })
  expect(snapshot.undoHead?.actor).toBe('human')
  expect(formalResourceSnapshot()).toEqual(before.resources)
}

function openGlobalAutomationAt(locationId: string): void {
  useEditorStore.getState().activateCourseLocation(locationId)
  useEditorStore.getState().setEditingScope('global')
  render(<AutomationTab />)
}

beforeEach(async () => {
  host = await bootTriageCourseHost()
  await loadMixedProject()
})

afterEach(() => {
  cleanup()
})

describe('interaction authoring UI integration', () => {
  it('applies a local Slide template atomically and updates its stable rule once', async () => {
    render(<AutomationTab />)
    const beforeTemplateRevision = activeProject().revision
    const beforeTemplateDepths = formalHistoryDepths()
    const beforeTemplateResources = formalResourceSnapshot()
    expect(rendererSessionHistory().past).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: '使用模板' }))
    await settleCourse()

    const templatedProject = activeProject()
    const templatedRule = slideScene(templatedProject).interactions[0]
    if (!templatedRule) throw new Error('Expected the UI to create a local rule')
    expect(templatedProject.revision).toBe(beforeTemplateRevision + 1)
    expect(rendererSessionHistory().past).toHaveLength(0)
    expectOneUndoableFrameWithoutResourceChange({
      ...beforeTemplateDepths,
      resources: beforeTemplateResources,
    })
    expect(slideScene(templatedProject).interactions).toHaveLength(1)
    expect(templatedRule).toMatchObject({
      id: expect.stringMatching(/^interaction_/),
      name: '进入场景后依次出现',
      conditions: [],
      actions: [expect.objectContaining({
        action: expect.objectContaining({
          type: 'node.enter',
          nodeId: TITLE_ITEM_ID,
        }),
      })],
    })
    expect(layer(templatedProject, TITLE_ITEM_ID).playbackInitialVisibility)
      .toBe('hidden')

    const stableRuleId = templatedRule.id
    const beforeRenameRevision = templatedProject.revision
    const beforeRenameUndoDepth = formalCourse(host).undoDepth
    fireEvent.change(screen.getByLabelText('规则名称'), {
      target: { value: '专业字段改名后的规则' },
    })
    await settleCourse()

    const renamedProject = activeProject()
    expect(renamedProject.revision).toBe(beforeRenameRevision + 1)
    expect(rendererSessionHistory().past).toHaveLength(0)
    expect(formalCourse(host).undoDepth).toBe(beforeRenameUndoDepth + 1)
    expect(slideScene(renamedProject).interactions).toEqual([
      expect.objectContaining({
        id: stableRuleId,
        name: '专业字段改名后的规则',
      }),
    ])
  })

  it.each([
    FLOW_LOCATION_ID,
    SPATIAL_LOCATION_ID,
  ])('shows no local template authoring at %s', (locationId) => {
    useEditorStore.getState().activateCourseLocation(locationId)
    render(<AutomationTab />)

    expect(screen.getByTestId('local-interaction-unavailable')).toBeVisible()
    expect(screen.queryByRole('button', { name: '使用模板' }))
      .not.toBeInTheDocument()
  })

  it('uses the real Slide scene and presentation state for a global template', async () => {
    await loadMixedProject(true)
    useEditorStore.getState().activateCourseLocation(SLIDE_LOCATION_ID)
    useEditorStore.getState().setActivePresentationState(ACTIVE_STATE_ID)
    expect(useEditorStore.getState().slideCandidateSnapshot?.stateId)
      .toBe(ACTIVE_STATE_ID)
    expect(slideLocation(activeProject()).stateId).toBeUndefined()
    useEditorStore.getState().setEditingScope('global')
    render(<AutomationTab />)

    fireEvent.click(screen.getByRole('button', { name: '使用模板' }))
    await settleCourse()

    expect(activeProject().globalInteractions).toHaveLength(1)
    expect(activeProject().globalInteractions[0]?.conditions).toEqual([
      { type: 'scene.in', sceneIds: [SLIDE_SCENE_ID] },
      { type: 'presentation.in', stateIds: [ACTIVE_STATE_ID] },
    ])
    expect(layer(activeProject(), GLOBAL_ITEM_ID).playbackInitialVisibility)
      .toBe('hidden')
  })

  it('writes a local template into the live named-state override without persisting session state', async () => {
    await loadMixedProject(true)
    useEditorStore.getState().activateCourseLocation(SLIDE_LOCATION_ID)
    useEditorStore.getState().setActivePresentationState(ACTIVE_STATE_ID)
    render(<AutomationTab />)

    fireEvent.click(screen.getByRole('button', { name: '使用模板' }))
    await settleCourse()

    const project = activeProject()
    const location = slideLocation(project)
    const state = slideScene(project).presentation?.states.find(
      (candidate) => candidate.id === ACTIVE_STATE_ID,
    )
    expect(location?.stateId).toBeUndefined()
    expect(layer(project, TITLE_ITEM_ID).playbackInitialVisibility).toBe('inherit')
    expect(state?.layerItemOverrides[TITLE_ITEM_ID]?.playbackInitialVisibility)
      .toBe('hidden')
    expect(slideScene(project).interactions[0]?.conditions).toEqual([
      { type: 'presentation.in', stateIds: [ACTIVE_STATE_ID] },
    ])
  })

  it.each([
    FLOW_LOCATION_ID,
    SPATIAL_LOCATION_ID,
  ])('does not invent a scene condition for a global template at %s', async (locationId) => {
    openGlobalAutomationAt(locationId)

    fireEvent.click(screen.getByRole('button', { name: '使用模板' }))
    await settleCourse()

    const conditions = activeProject().globalInteractions[0]?.conditions
    expect(conditions).toEqual([])
    expect(conditions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'scene.in' }),
    ]))
  })

  it.each([
    [FLOW_LOCATION_ID, 'flow-heading'] as const,
    [SPATIAL_LOCATION_ID, 'spatial-label'] as const,
  ])('does not expose synthetic local click-rule writes in Properties at %s', (
    locationId,
    nodeId,
  ) => {
    useEditorStore.getState().activateCourseLocation(locationId)
    useEditorStore.getState().selectNode(nodeId)
    const before = structuredClone(activeProject())
    const beforeFormalProject = structuredClone(formalProject(host))
    const beforeFormalDepths = formalHistoryDepths()

    render(<PropertiesTab onReplaceImage={() => undefined} />)

    expect(screen.queryByLabelText('快捷连接目标状态')).not.toBeInTheDocument()
    if (locationId === SPATIAL_LOCATION_ID) {
      expect(screen.getByTestId('interaction-properties-unavailable')).toBeVisible()
      expect(screen.getByText(/没有元素级局部 Interaction carrier/)).toBeVisible()
    }
    expect(activeProject()).toEqual(before)
    expect(formalProject(host)).toEqual(beforeFormalProject)
    expect(formalHistoryDepths()).toEqual(beforeFormalDepths)
  })

  it('keeps one mounted Flow Properties instance stable while switching local to global', () => {
    useEditorStore.getState().activateCourseLocation(FLOW_LOCATION_ID)
    useEditorStore.getState().selectNode('flow-heading')
    render(<PropertiesTab onReplaceImage={() => undefined} />)
    expect(screen.queryByTestId('interaction-properties-unavailable'))
      .not.toBeInTheDocument()

    act(() => {
      useEditorStore.getState().setEditingScope('global')
      useEditorStore.getState().selectNode(GLOBAL_ITEM_ID)
    })

    expect(screen.getByTestId('interaction-properties-unavailable')).toBeVisible()
    expect(screen.getByText(/不在元素属性中提供全局点击规则写入/)).toBeVisible()
  })

  it.each([
    FLOW_LOCATION_ID,
    SPATIAL_LOCATION_ID,
  ])('gates synthetic global click-rule writes in Properties at %s', (locationId) => {
    useEditorStore.getState().activateCourseLocation(locationId)
    useEditorStore.getState().setEditingScope('global')
    useEditorStore.getState().selectNode(GLOBAL_ITEM_ID)
    const before = structuredClone(activeProject())
    const beforeFormalProject = structuredClone(formalProject(host))
    const beforeFormalDepths = formalHistoryDepths()

    render(<PropertiesTab onReplaceImage={() => undefined} />)

    expect(screen.getByTestId('interaction-properties-unavailable')).toBeVisible()
    expect(screen.getByText(/不在元素属性中提供全局点击规则写入/)).toBeVisible()
    expect(screen.queryByLabelText('快捷连接目标状态')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '打开互动与动画' }))
    expect(useEditorStore.getState().activeTab).toBe('automation')
    expect(activeProject()).toEqual(before)
    expect(formalProject(host)).toEqual(beforeFormalProject)
    expect(formalHistoryDepths()).toEqual(beforeFormalDepths)
  })

  it.each([
    FLOW_LOCATION_ID,
    SPATIAL_LOCATION_ID,
  ])('keeps the unsupported global click-rule route inside Automation at %s', (
    locationId,
  ) => {
    useEditorStore.getState().activateCourseLocation(locationId)
    useEditorStore.getState().setEditingScope('global')
    useEditorStore.getState().selectNode(GLOBAL_ITEM_ID)
    useEditorStore.getState().setActiveTab('automation')
    render(<AutomationTab />)

    fireEvent.click(screen.getByRole('button', {
      name: '设置选中元素的点击动作',
    }))

    expect(useEditorStore.getState().activeTab).toBe('automation')
    expect(useEditorStore.getState().errorMessage)
      .toMatch(/不在元素属性中提供全局点击规则写入/)
  })
})
