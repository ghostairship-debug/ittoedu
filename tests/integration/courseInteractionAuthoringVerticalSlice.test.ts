import { controllerPackage, createArchiveFixture as createCourseProjectArchive } from '../fixtures/teacherController'
import { buildPublishedFixture as buildPublishedCourseV2Payload } from '../fixtures/teacherController'
import { beforeEach, describe, expect, it } from 'vitest'

import type { InteractionAuthoringTarget } from '@/renderer/interactions/interactionAuthoringCommands'
import {
  SCENE_ENTER_REVEAL_SEQUENCE_TEMPLATE_ID,
  type SceneEnterRevealSequenceTemplateRequest,
} from '@/renderer/interactions/interactionTemplates'
import {
  openCourseProjectArchive,
} from '../../src/core/drivers/codecs/courseProjectArchive'
import { componentPackagesFromArchive } from '@/renderer/components/componentPackageStore'
import {
  selectActiveCourseProjectDocument,
  selectMediaAssetFiles,
  useEditorStore,
} from '@/renderer/store/editorStore'
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
  projectBody,
  projectCourse,
  redoCourse,
  settleCourse,
  undoCourse,
  type TriageCourseHost,
} from '../helpers/triage-t7-courseHost'

const SLIDE_LOCATION_ID = 'location-slide'
const FLOW_LOCATION_ID = 'location-flow'
const SPATIAL_LOCATION_ID = 'location-spatial'
const TITLE_ITEM_ID = 'slide-title'
const DETAIL_ITEM_ID = 'slide-detail'
const LOCAL_RULE_ID = 'rule-reveal-sequence'
const NAMED_STATE_ID = 'state-explain'
const ARCHIVE_TIME = '2026-08-24T12:00:00.000Z'

function mixedProject(): CourseProjectDocument {
  const fixture = listCourseProjectV9Fixtures().find(
    (candidate) => candidate.id === 'mixed',
  )
  if (!fixture) throw new Error('Missing mixed Course Project V9 fixture')

  const project = structuredClone(fixture.data.project)
  const scene = slideScene(project)
  const detail = structuredClone(scene.layerItems[0]!)
  detail.layerItemId = DETAIL_ITEM_ID
  detail.label = '演示详情'
  detail.order = 2
  scene.layerItems.push(detail)
  return project
}

let host: TriageCourseHost

/**
 * 2.0 opens every course through the main-owned DocumentSession; the fixture's real
 * asset and component bytes are the formal resources, not empty placeholders.
 */
async function openMixedProject(project: CourseProjectDocument): Promise<void> {
  const fixture = listCourseProjectV9Fixtures().find(
    (candidate) => candidate.id === 'mixed',
  )
  if (!fixture) throw new Error('Missing mixed Course Project V9 fixture')
  await projectCourse(
    host,
    project,
    fixture.data.assetFiles,
    componentPackagesFromArchive(project, fixture.data.componentFiles),
  )
}

function loadMixedProject(): Promise<void> {
  return openMixedProject(mixedProject())
}

function mixedProjectWithNamedState(): CourseProjectDocument {
  const project = mixedProject()
  const scene = slideScene(project)
  scene.presentation = {
    initialStateId: NAMED_STATE_ID,
    states: [{
      id: NAMED_STATE_ID,
      name: '讲解态',
      layerItemOverrides: {},
    }],
  }
  const location = project.locations.find(
    (candidate) => candidate.id === SLIDE_LOCATION_ID,
  )
  if (!location || location.kind !== 'slide-scene') {
    throw new Error('Missing representative Slide location')
  }
  delete location.stateId
  return project
}

function activeProject(): CourseProjectDocument {
  const project = selectActiveCourseProjectDocument(useEditorStore.getState())
  if (!project) throw new Error('Expected an active Course Project V9')
  return project
}

function activeHistory() {
  const state = useEditorStore.getState()
  if (state.spatialSession) {
    return { kind: 'spatial' as const, history: state.spatialSession.history }
  }
  if (state.flowSession) {
    return { kind: 'flow' as const, history: state.flowSession.history }
  }
  if (state.slideBackend?.kind === 'slide-authoring') {
    return { kind: 'slide' as const, history: state.slideBackend.getSession().history }
  }
  throw new Error('Expected an active V9 authoring history')
}

function resourceSnapshotDepths() {
  const state = useEditorStore.getState()
  return {
    sidecarPast: state.courseAssetSidecarPast.length,
    sidecarFuture: state.courseAssetSidecarFuture.length,
    componentPast: state.courseComponentPackagesPast.length,
    componentFuture: state.courseComponentPackagesFuture.length,
  }
}

function byteFileSnapshot(files: Record<string, Uint8Array>) {
  return Object.fromEntries(
    Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, bytes]) => [path, Array.from(bytes)]),
  )
}

/**
 * 2.0 keeps the only authoritative History in the main-owned DocumentSession, so a
 * renderer frame that used to read `{kind: 'editor-transaction', resourceChanges: {}}`
 * is now "the document gained exactly one undoable frame and its resources did not move".
 */
function formalUndoDepth(): number {
  return formalCourse(host).undoDepth
}

function formalHistoryDepths() {
  const snapshot = formalCourse(host)
  return { undoDepth: snapshot.undoDepth, redoDepth: snapshot.redoDepth }
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

function expectOneUndoableFrameWithoutResourceChange(before: {
  undoDepth: number
  resources: ReturnType<typeof formalResourceSnapshot>
}): void {
  const snapshot = formalCourse(host)
  expect({ undoDepth: snapshot.undoDepth, redoDepth: snapshot.redoDepth })
    .toEqual({ undoDepth: before.undoDepth + 1, redoDepth: 0 })
  // The added frame is one human editor transaction, i.e. a single document operation
  // committed through the editor path — the 2.0 form of `kind: 'editor-transaction'`.
  expect(snapshot.undoHead?.actor).toBe('human')
  // …and it carried no resource payload — the 2.0 form of `resourceChanges: {}`.
  expect(formalResourceSnapshot()).toEqual(before.resources)
}

function authoringSessionSnapshot() {
  const state = useEditorStore.getState()
  return {
    course: structuredClone(state.courseAuthoringSession),
    slideSnapshot: structuredClone(state.slideCandidateSnapshot),
    slide: state.slideBackend?.kind === 'slide-authoring'
      ? structuredClone(state.slideBackend.getSession())
      : null,
    flow: structuredClone(state.flowSession),
    spatial: structuredClone(state.spatialSession),
  }
}

function authoritativeWriteSnapshot() {
  const state = useEditorStore.getState()
  return {
    project: structuredClone(activeProject()),
    derivedProject: structuredClone(selectActiveCourseProjectDocument(state)!),
    formalProject: structuredClone(formalProject(host)),
    activeHistory: structuredClone(activeHistory().history),
    documentHistory: formalHistoryDepths(),
    formalResources: formalResourceSnapshot(),
    mediaFiles: byteFileSnapshot(selectMediaAssetFiles(state)),
    componentPackages: structuredClone(state.componentPackages),
    sidecarPast: structuredClone(state.courseAssetSidecarPast),
    sidecarFuture: structuredClone(state.courseAssetSidecarFuture),
    componentPast: structuredClone(state.courseComponentPackagesPast),
    componentFuture: structuredClone(state.courseComponentPackagesFuture),
    sessions: authoringSessionSnapshot(),
    dirty: state.dirty,
  }
}

function slideScene(project: CourseProjectDocument): SlideSceneDocument {
  const surface = project.surfaces.find((candidate) => candidate.type === 'slide')
  const scene = surface?.type === 'slide' ? surface.scenes[0] : undefined
  if (!scene) throw new Error('Missing representative Slide scene')
  return scene
}

function layer(project: CourseProjectDocument, layerItemId: string): LayerItem {
  const allItems: LayerItem[] = [
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
  const item = allItems.find((candidate) => candidate.layerItemId === layerItemId)
  if (!item) throw new Error(`Missing representative layer ${layerItemId}`)
  return item
}

function localTarget(
  project: CourseProjectDocument,
  locationId = SLIDE_LOCATION_ID,
): Extract<InteractionAuthoringTarget, { carrier: 'slide-scene' }> {
  return {
    carrier: 'slide-scene',
    projectId: project.id,
    baseRevision: project.revision,
    locationId,
  }
}

function globalTarget(
  project: CourseProjectDocument,
  activeLocationId: string,
  activeStateId?: string | null,
): Extract<InteractionAuthoringTarget, { carrier: 'global' }> {
  return {
    carrier: 'global',
    projectId: project.id,
    baseRevision: project.revision,
    activeLocationId,
    ...(activeStateId === undefined ? {} : { activeStateId }),
  }
}

function localTemplate(): SceneEnterRevealSequenceTemplateRequest {
  return {
    templateId: SCENE_ENTER_REVEAL_SEQUENCE_TEMPLATE_ID,
    ruleId: LOCAL_RULE_ID,
    actionIds: ['action-reveal-title', 'action-reveal-detail'],
    targetLayerItemIds: [TITLE_ITEM_ID, DETAIL_ITEM_ID],
  }
}

function globalTemplate(
  suffix: string,
): SceneEnterRevealSequenceTemplateRequest {
  return {
    templateId: SCENE_ENTER_REVEAL_SEQUENCE_TEMPLATE_ID,
    ruleId: `global-reveal-${suffix}`,
    actionIds: [`global-reveal-action-${suffix}`],
    targetLayerItemIds: ['global-banner'],
  }
}

beforeEach(async () => {
  host = await bootTriageCourseHost()
  await loadMixedProject()
})

describe('Course interaction authoring Store vertical slice', () => {
  it('commits Slide template visibility and rule in one revision and one undoable history frame', async () => {
    const beforeProject = structuredClone(activeProject())
    const beforeUndoDepth = formalUndoDepth()
    const beforeFormalResources = formalResourceSnapshot()
    const beforeResourceSnapshotDepths = resourceSnapshotDepths()

    const result = useEditorStore.getState().applyInteractionTemplateAtTarget(
      localTarget(activeProject()),
      localTemplate(),
    )

    expect(result).toMatchObject({
      ok: true,
      status: 'committed',
      feedback: {
        kind: 'interaction-template-applied',
        carrier: 'slide-scene',
        ruleId: LOCAL_RULE_ID,
        targetLayerItemIds: [TITLE_ITEM_ID, DETAIL_ITEM_ID],
        locationId: SLIDE_LOCATION_ID,
      },
    })
    await settleCourse()
    const committedProject = structuredClone(activeProject())
    expect(committedProject.revision).toBe(beforeProject.revision + 1)
    expect(activeHistory().kind).toBe('slide')
    expectOneUndoableFrameWithoutResourceChange({
      undoDepth: beforeUndoDepth,
      resources: beforeFormalResources,
    })
    expect(resourceSnapshotDepths()).toEqual(beforeResourceSnapshotDepths)
    expect(layer(committedProject, TITLE_ITEM_ID).playbackInitialVisibility)
      .toBe('hidden')
    expect(layer(committedProject, DETAIL_ITEM_ID).playbackInitialVisibility)
      .toBe('hidden')
    expect(slideScene(committedProject).interactions).toEqual([
      expect.objectContaining({
        id: LOCAL_RULE_ID,
        actions: [
          expect.objectContaining({
            id: 'action-reveal-title',
            action: expect.objectContaining({ nodeId: TITLE_ITEM_ID }),
          }),
          expect.objectContaining({
            id: 'action-reveal-detail',
            action: expect.objectContaining({ nodeId: DETAIL_ITEM_ID }),
          }),
        ],
      }),
    ])

    await undoCourse(host)
    expect(projectBody(activeProject())).toEqual(projectBody(beforeProject))
    expect(activeProject().revision).toBeGreaterThan(beforeProject.revision)
    expect(layer(activeProject(), TITLE_ITEM_ID).playbackInitialVisibility)
      .toBe('inherit')
    expect(layer(activeProject(), DETAIL_ITEM_ID).playbackInitialVisibility)
      .toBe('inherit')
    expect(slideScene(activeProject()).interactions).toEqual([])
    expect(resourceSnapshotDepths()).toEqual(beforeResourceSnapshotDepths)

    await redoCourse(host)
    expect(projectBody(activeProject())).toEqual(projectBody(committedProject))
    expect(activeProject().revision).toBeGreaterThan(committedProject.revision)
    expect(layer(activeProject(), TITLE_ITEM_ID).playbackInitialVisibility)
      .toBe('hidden')
    expect(layer(activeProject(), DETAIL_ITEM_ID).playbackInitialVisibility)
      .toBe('hidden')
    expect(slideScene(activeProject()).interactions)
      .toEqual(slideScene(committedProject).interactions)
    expect(resourceSnapshotDepths()).toEqual(beforeResourceSnapshotDepths)
  })

  it('professionally updates the same stable rule ID and returns unchanged for a true no-op', async () => {
    expect(useEditorStore.getState().applyInteractionTemplateAtTarget(
      localTarget(activeProject()),
      localTemplate(),
    )).toMatchObject({ ok: true, status: 'committed' })
    await settleCourse()

    const createdProject = structuredClone(activeProject())
    const createdRule = slideScene(createdProject).interactions[0]
    if (!createdRule) throw new Error('Expected the template-created rule')
    const actions = structuredClone(createdRule.actions)
    const firstAction = actions[0]?.action
    if (!firstAction || firstAction.type !== 'node.enter') {
      throw new Error('Expected the first reveal action')
    }
    firstAction.durationMs = 480
    const beforeUpdateUndoDepth = formalUndoDepth()

    const updated = useEditorStore.getState().updateInteractionRuleAtTarget(
      localTarget(activeProject()),
      LOCAL_RULE_ID,
      { name: '专业调整后的依次出现', actions },
    )

    expect(updated).toMatchObject({
      ok: true,
      status: 'committed',
      feedback: {
        kind: 'interaction-rule-updated',
        carrier: 'slide-scene',
        ruleId: LOCAL_RULE_ID,
      },
    })
    await settleCourse()
    const updatedProject = structuredClone(activeProject())
    expect(updatedProject.revision).toBe(createdProject.revision + 1)
    expect(formalUndoDepth()).toBe(beforeUpdateUndoDepth + 1)
    expect(slideScene(updatedProject).interactions).toHaveLength(1)
    expect(slideScene(updatedProject).interactions[0]).toMatchObject({
      id: LOCAL_RULE_ID,
      name: '专业调整后的依次出现',
    })
    expect(slideScene(updatedProject).interactions[0]?.actions[0]?.action)
      .toMatchObject({ type: 'node.enter', durationMs: 480 })

    const beforeNoOpProject = structuredClone(activeProject())
    const beforeNoOpHistory = structuredClone(activeHistory().history)
    const beforeNoOpDocumentHistory = formalHistoryDepths()
    const unchanged = useEditorStore.getState().updateInteractionRuleAtTarget(
      localTarget(activeProject()),
      LOCAL_RULE_ID,
      { name: '专业调整后的依次出现' },
    )

    expect(unchanged).toMatchObject({
      ok: true,
      status: 'unchanged',
      feedback: {
        kind: 'interaction-rule-unchanged',
        carrier: 'slide-scene',
        ruleId: LOCAL_RULE_ID,
      },
    })
    expect(activeProject()).toEqual(beforeNoOpProject)
    expect(activeHistory().history).toEqual(beforeNoOpHistory)
    expect(formalHistoryDepths()).toEqual(beforeNoOpDocumentHistory)
  })

  it('commits an exact Flow location jump as one undoable Native click-rule transaction and rejects a missing location without writes', async () => {
    expect(useEditorStore.getState().applyInteractionTemplateAtTarget(
      localTarget(activeProject()),
      localTemplate(),
    )).toMatchObject({ ok: true, status: 'committed' })
    await settleCourse()
    const before = structuredClone(activeProject())
    const beforeUndoDepth = formalUndoDepth()

    const committed = useEditorStore.getState().updateInteractionRuleAtTarget(
      localTarget(activeProject()),
      LOCAL_RULE_ID,
      {
        trigger: { type: 'node.click', nodeId: TITLE_ITEM_ID },
        actions: [{
          id: 'action-go-flow',
          start: 'after-previous',
          delayMs: 0,
          action: { type: 'location.go', locationId: FLOW_LOCATION_ID },
        }],
      },
    )

    expect(committed).toMatchObject({ ok: true, status: 'committed' })
    await settleCourse()
    const after = structuredClone(activeProject())
    expect(after.revision).toBe(before.revision + 1)
    expect(formalUndoDepth()).toBe(beforeUndoDepth + 1)
    expect(slideScene(after).interactions[0]).toMatchObject({
      id: LOCAL_RULE_ID,
      trigger: { type: 'node.click', nodeId: TITLE_ITEM_ID },
      actions: [{
        id: 'action-go-flow',
        start: 'after-previous',
        action: { type: 'location.go', locationId: FLOW_LOCATION_ID },
      }],
    })

    await undoCourse(host)
    expect(projectBody(activeProject())).toEqual(projectBody(before))
    expect(activeProject().revision).toBeGreaterThan(before.revision)
    await redoCourse(host)
    expect(projectBody(activeProject())).toEqual(projectBody(after))
    expect(activeProject().revision).toBeGreaterThan(after.revision)

    const writeSnapshot = authoritativeWriteSnapshot()
    expect(useEditorStore.getState().updateInteractionRuleAtTarget(
      localTarget(activeProject()),
      LOCAL_RULE_ID,
      {
        actions: [{
          id: 'action-go-missing',
          start: 'after-previous',
          delayMs: 0,
          action: { type: 'location.go', locationId: 'missing-location' },
        }],
      },
    )).toMatchObject({ ok: false, code: 'invalid-rule' })
    expect(authoritativeWriteSnapshot()).toEqual(writeSnapshot)
  })

  it.each([
    [FLOW_LOCATION_ID, 'flow'] as const,
    [SPATIAL_LOCATION_ID, 'spatial'] as const,
  ])('commits, undoes, and redoes a project-global template at %s in the current %s history', async (locationId, expectedKind) => {
    useEditorStore.getState().activateCourseLocation(locationId)
    expect(activeHistory().kind).toBe(expectedKind)
    const beforeProject = structuredClone(activeProject())
    const beforeUndoDepth = formalUndoDepth()
    const beforeFormalResources = formalResourceSnapshot()
    const beforeResourceSnapshotDepths = resourceSnapshotDepths()
    expect(beforeResourceSnapshotDepths).toEqual({
      sidecarPast: 0,
      sidecarFuture: 0,
      componentPast: 0,
      componentFuture: 0,
    })
    const template = globalTemplate(expectedKind)

    const result = useEditorStore.getState().applyInteractionTemplateAtTarget(
      globalTarget(activeProject(), locationId),
      template,
    )

    expect(result).toMatchObject({
      ok: true,
      status: 'committed',
      feedback: {
        kind: 'interaction-template-applied',
        carrier: 'global',
        ruleId: template.ruleId,
        targetLayerItemIds: ['global-banner'],
      },
    })
    await settleCourse()
    expect(activeHistory().kind).toBe(expectedKind)
    expect(activeProject().revision).toBe(beforeProject.revision + 1)
    expectOneUndoableFrameWithoutResourceChange({
      undoDepth: beforeUndoDepth,
      resources: beforeFormalResources,
    })
    expect(activeProject().globalInteractions).toEqual([
      expect.objectContaining({ id: template.ruleId }),
    ])
    expect(layer(activeProject(), 'global-banner').playbackInitialVisibility)
      .toBe('hidden')
    expect(slideScene(activeProject()).interactions).toEqual([])
    expect(resourceSnapshotDepths()).toEqual(beforeResourceSnapshotDepths)

    const committedProject = structuredClone(activeProject())
    await undoCourse(host)
    expect(activeHistory().kind).toBe(expectedKind)
    expect(projectBody(activeProject())).toEqual(projectBody(beforeProject))
    expect(activeProject().revision).toBeGreaterThan(beforeProject.revision)
    expect(activeProject().globalInteractions).toEqual([])
    expect(layer(activeProject(), 'global-banner').playbackInitialVisibility)
      .toBe('inherit')
    expect(slideScene(activeProject()).interactions).toEqual([])
    expect(resourceSnapshotDepths()).toEqual(beforeResourceSnapshotDepths)

    await redoCourse(host)
    expect(activeHistory().kind).toBe(expectedKind)
    expect(projectBody(activeProject())).toEqual(projectBody(committedProject))
    expect(activeProject().revision).toBeGreaterThan(committedProject.revision)
    expect(activeProject().globalInteractions).toEqual([
      expect.objectContaining({ id: template.ruleId }),
    ])
    expect(layer(activeProject(), 'global-banner').playbackInitialVisibility)
      .toBe('hidden')
    expect(resourceSnapshotDepths()).toEqual(beforeResourceSnapshotDepths)
  })

  it('writes a Slide-context global rule with real scene and named-state conditions without touching the local carrier', async () => {
    await openMixedProject(mixedProjectWithNamedState())
    useEditorStore.getState().setActivePresentationState(NAMED_STATE_ID)
    expect(useEditorStore.getState().slideCandidateSnapshot?.stateId)
      .toBe(NAMED_STATE_ID)
    const beforeProject = structuredClone(activeProject())
    const beforeScene = structuredClone(slideScene(beforeProject))
    const beforeResourceSnapshotDepths = resourceSnapshotDepths()
    const slideLocation = beforeProject.locations.find(
      (location) => location.id === SLIDE_LOCATION_ID,
    )
    if (!slideLocation || slideLocation.kind !== 'slide-scene') {
      throw new Error('Missing representative Slide location')
    }
    expect(slideLocation.stateId).toBeUndefined()
    const template: SceneEnterRevealSequenceTemplateRequest = {
      ...globalTemplate('slide-state'),
      conditions: [
        { type: 'scene.in', sceneIds: ['scene-1'] },
        { type: 'presentation.in', stateIds: [NAMED_STATE_ID] },
      ],
    }

    const result = useEditorStore.getState().applyInteractionTemplateAtTarget(
      globalTarget(activeProject(), SLIDE_LOCATION_ID, NAMED_STATE_ID),
      template,
    )

    expect(result).toMatchObject({
      ok: true,
      status: 'committed',
      feedback: {
        carrier: 'global',
        ruleId: template.ruleId,
      },
    })
    await settleCourse()
    const committedProject = structuredClone(activeProject())
    expect(committedProject.globalInteractions).toEqual([{
      id: template.ruleId,
      name: '进入场景后依次出现',
      enabled: true,
      trigger: { type: 'scene.enter' },
      conditions: [
        { type: 'scene.in', sceneIds: ['scene-1'] },
        { type: 'presentation.in', stateIds: [NAMED_STATE_ID] },
      ],
      actions: [expect.objectContaining({
        id: template.actionIds[0],
        action: expect.objectContaining({ nodeId: 'global-banner' }),
      })],
    }])
    expect(layer(committedProject, 'global-banner').playbackInitialVisibility)
      .toBe('hidden')
    expect(slideScene(committedProject)).toEqual(beforeScene)
    expect(resourceSnapshotDepths()).toEqual(beforeResourceSnapshotDepths)

    const normalizedCommitted = structuredClone(committedProject)
    normalizedCommitted.revision = beforeProject.revision
    normalizedCommitted.updatedAt = beforeProject.updatedAt
    normalizedCommitted.globalInteractions = structuredClone(
      beforeProject.globalInteractions,
    )
    layer(normalizedCommitted, 'global-banner').playbackInitialVisibility =
      layer(beforeProject, 'global-banner').playbackInitialVisibility
    expect(normalizedCommitted).toEqual(beforeProject)
  })

  it.each([
    [FLOW_LOCATION_ID, 'flow'] as const,
    [SPATIAL_LOCATION_ID, 'spatial'] as const,
  ])('rejects a local carrier at %s on %s without writing project or current history', async (locationId, expectedKind) => {
    useEditorStore.getState().activateCourseLocation(locationId)
    expect(activeHistory().kind).toBe(expectedKind)

    const target = localTarget(activeProject(), locationId)
    const beforeTemplateProject = structuredClone(activeProject())
    const beforeTemplateHistory = structuredClone(activeHistory().history)
    const beforeTemplateDocumentHistory = formalHistoryDepths()
    const beforeTemplateDirty = useEditorStore.getState().dirty
    const templateResult = useEditorStore.getState().applyInteractionTemplateAtTarget(
      target,
      localTemplate(),
    )

    expect(templateResult).toMatchObject({
      ok: false,
      code: 'no-local-interaction-carrier',
    })
    expect(activeProject()).toEqual(beforeTemplateProject)
    expect(activeHistory().history).toEqual(beforeTemplateHistory)
    expect(formalHistoryDepths()).toEqual(beforeTemplateDocumentHistory)
    expect(useEditorStore.getState().dirty).toBe(beforeTemplateDirty)

    const beforeUpdateProject = structuredClone(activeProject())
    const beforeUpdateHistory = structuredClone(activeHistory().history)
    const beforeUpdateDocumentHistory = formalHistoryDepths()
    const beforeUpdateDirty = useEditorStore.getState().dirty
    const updateResult = useEditorStore.getState().updateInteractionRuleAtTarget(
      target,
      'missing-local-rule',
      { name: '不可写的局部规则' },
    )

    expect(updateResult).toMatchObject({
      ok: false,
      code: 'no-local-interaction-carrier',
    })
    expect(activeProject()).toEqual(beforeUpdateProject)
    expect(activeHistory().history).toEqual(beforeUpdateHistory)
    expect(formalHistoryDepths()).toEqual(beforeUpdateDocumentHistory)
    expect(useEditorStore.getState().dirty).toBe(beforeUpdateDirty)
  })

  it('rejects stale revisions and switched locations or states without authoritative project, resource, history, session, or dirty writes', async () => {
    const staleLocalTarget = localTarget(activeProject())
    useEditorStore.getState().renameProject('Intervening interaction edit')
    await settleCourse()
    let beforeRejection = authoritativeWriteSnapshot()

    const staleResult = useEditorStore.getState().applyInteractionTemplateAtTarget(
      staleLocalTarget,
      localTemplate(),
    )

    expect(staleResult).toMatchObject({
      ok: false,
      code: 'revision-conflict',
    })
    expect(authoritativeWriteSnapshot()).toEqual(beforeRejection)

    const globalTemplateRequest = globalTemplate('location-guard')
    expect(useEditorStore.getState().applyInteractionTemplateAtTarget(
      globalTarget(activeProject(), SLIDE_LOCATION_ID),
      globalTemplateRequest,
    )).toMatchObject({ ok: true, status: 'committed' })
    await settleCourse()
    const capturedGlobalTarget = globalTarget(activeProject(), SLIDE_LOCATION_ID)
    useEditorStore.getState().activateCourseLocation(FLOW_LOCATION_ID)
    expect(activeHistory().kind).toBe('flow')
    beforeRejection = authoritativeWriteSnapshot()

    const switchedLocationResult = useEditorStore.getState().updateInteractionRuleAtTarget(
      capturedGlobalTarget,
      globalTemplateRequest.ruleId,
      { name: 'Must not land after a location switch' },
    )

    expect(switchedLocationResult).toMatchObject({
      ok: false,
      code: 'revision-conflict',
    })
    expect(authoritativeWriteSnapshot()).toEqual(beforeRejection)

    useEditorStore.getState().activateCourseLocation(SLIDE_LOCATION_ID)
    const capturedLocalTarget = localTarget(activeProject())
    useEditorStore.getState().activateCourseLocation(SPATIAL_LOCATION_ID)
    expect(activeHistory().kind).toBe('spatial')
    beforeRejection = authoritativeWriteSnapshot()

    const switchedLocalResult = useEditorStore.getState().applyInteractionTemplateAtTarget(
      capturedLocalTarget,
      localTemplate(),
    )

    expect(switchedLocalResult).toMatchObject({
      ok: false,
      code: 'revision-conflict',
    })
    expect(authoritativeWriteSnapshot()).toEqual(beforeRejection)

    await openMixedProject(mixedProjectWithNamedState())
    useEditorStore.getState().setActivePresentationState(NAMED_STATE_ID)
    const capturedStateTarget = globalTarget(
      activeProject(),
      SLIDE_LOCATION_ID,
      NAMED_STATE_ID,
    )
    useEditorStore.getState().setActivePresentationState(null)
    beforeRejection = authoritativeWriteSnapshot()

    const switchedStateResult = useEditorStore.getState().applyInteractionTemplateAtTarget(
      capturedStateTarget,
      globalTemplate('state-guard'),
    )

    expect(switchedStateResult).toMatchObject({
      ok: false,
      code: 'revision-conflict',
    })
    expect(authoritativeWriteSnapshot()).toEqual(beforeRejection)
  })

  it('preserves local and global authoring through archive reopen and Published V2 without mutating authoring state', async () => {
    expect(useEditorStore.getState().applyInteractionTemplateAtTarget(
      localTarget(activeProject()),
      localTemplate(),
    )).toMatchObject({ ok: true, status: 'committed' })
    await settleCourse()
    expect(useEditorStore.getState().updateInteractionRuleAtTarget(
      localTarget(activeProject()),
      LOCAL_RULE_ID,
      { name: '保存后的专业规则' },
    )).toMatchObject({ ok: true, status: 'committed' })
    await settleCourse()
    const savedGlobalTemplate = globalTemplate('saved')
    expect(useEditorStore.getState().applyInteractionTemplateAtTarget(
      globalTarget(activeProject(), SLIDE_LOCATION_ID),
      savedGlobalTemplate,
    )).toMatchObject({ ok: true, status: 'committed' })
    await settleCourse()

    const beforeReadEndpoints = structuredClone(activeProject())
    const state = useEditorStore.getState()
    const archive = createCourseProjectArchive({
      project: activeProject(),
      assetFiles: selectMediaAssetFiles(state),
      componentFiles: { [`${controllerPackage.manifest.id}@${controllerPackage.manifest.version}`]: controllerPackage.files },
    }, { mtime: ARCHIVE_TIME })
    const reopened = openCourseProjectArchive(archive)
    expect(reopened.project).toEqual(beforeReadEndpoints)
    expect(slideScene(reopened.project).interactions).toEqual([
      expect.objectContaining({
        id: LOCAL_RULE_ID,
        name: '保存后的专业规则',
      }),
    ])
    expect(layer(reopened.project, TITLE_ITEM_ID).playbackInitialVisibility)
      .toBe('hidden')
    expect(layer(reopened.project, DETAIL_ITEM_ID).playbackInitialVisibility)
      .toBe('hidden')
    expect(reopened.project.globalInteractions).toEqual([
      expect.objectContaining({ id: savedGlobalTemplate.ruleId }),
    ])
    expect(layer(reopened.project, 'global-banner').playbackInitialVisibility)
      .toBe('hidden')

    const published = buildPublishedCourseV2Payload({
      project: reopened.project,
      assetFiles: reopened.assetFiles,
      components: {},
    })
    const publishedSlide = published.surfaces.find(
      (surface) => surface.id === 'surface-slide',
    )
    if (!publishedSlide || publishedSlide.type !== 'slide') {
      throw new Error('Expected the published Slide surface')
    }
    expect(publishedSlide.scenes[0]?.interactions).toEqual([
      expect.objectContaining({
        id: LOCAL_RULE_ID,
        name: '保存后的专业规则',
      }),
    ])
    expect(published.globalInteractions).toEqual([
      expect.objectContaining({ id: savedGlobalTemplate.ruleId }),
    ])
    expect(published.globalLayerItems[0]?.item).toMatchObject({
      layerItemId: 'global-banner',
      playbackInitialVisibility: 'hidden',
    })
    expect(activeProject()).toEqual(beforeReadEndpoints)
  })
})
