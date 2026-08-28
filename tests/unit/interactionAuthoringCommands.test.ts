import { createEditorTransactionStep } from '@/renderer/authoring/editorTransaction'
import {
  planApplyInteractionTemplate,
  planUpdateInteractionRule,
  type InteractionAuthoringTarget,
} from '@/renderer/interactions/interactionAuthoringCommands'
import {
  SCENE_ENTER_REVEAL_SEQUENCE_TEMPLATE_ID,
  type SceneEnterRevealSequenceTemplateRequest,
} from '@/renderer/interactions/interactionTemplates'
import { historyResourceChangesAreEmpty } from '@/renderer/store/history'
import type {
  CourseProjectDocument,
  LayerItem,
  SlideSceneDocument,
} from '@/shared/courseProjectTypes'
import {
  MAX_SCENE_INTERACTIONS,
  type InteractionRule,
} from '@/shared/interactionTypes'
import { describe, expect, it } from 'vitest'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'

const NOW = '2026-08-24T08:00:00.000Z'
const LATER = '2026-08-24T08:05:00.000Z'

function mixedProject(): CourseProjectDocument {
  const fixture = listCourseProjectV9Fixtures().find((candidate) => candidate.id === 'mixed')
  if (!fixture) throw new Error('missing mixed fixture')
  const project = structuredClone(fixture.data.project)
  const scene = slideScene(project)
  const detail = structuredClone(scene.layerItems[0]!)
  detail.layerItemId = 'slide-detail'
  detail.label = '演示详情'
  detail.order = 2
  scene.layerItems.push(detail)
  return project
}

function slideScene(project: CourseProjectDocument): SlideSceneDocument {
  const surface = project.surfaces.find((candidate) => candidate.type === 'slide')
  const scene = surface?.type === 'slide' ? surface.scenes[0] : undefined
  if (!scene) throw new Error('missing slide scene')
  return scene
}

function layer(project: CourseProjectDocument, id: string): LayerItem {
  const all: LayerItem[] = [
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
  const found = all.find((item) => item.layerItemId === id)
  if (!found) throw new Error(`missing layer ${id}`)
  return found
}

function spatialItem(project: CourseProjectDocument): LayerItem {
  const surface = project.surfaces.find((candidate) => candidate.type === 'spatial-2d')
  const item = surface?.type === 'spatial-2d' ? surface.world.layerItems[0] : undefined
  if (!item) throw new Error('missing spatial item')
  return item
}

function localTarget(
  project: CourseProjectDocument,
  locationId = 'location-slide',
): InteractionAuthoringTarget {
  return {
    carrier: 'slide-scene',
    projectId: project.id,
    baseRevision: project.revision,
    locationId,
  }
}

function globalTarget(
  project: CourseProjectDocument,
): Extract<InteractionAuthoringTarget, { carrier: 'global' }> {
  return {
    carrier: 'global',
    projectId: project.id,
    baseRevision: project.revision,
  }
}

function template(
  overrides: Partial<SceneEnterRevealSequenceTemplateRequest> = {},
): SceneEnterRevealSequenceTemplateRequest {
  return {
    templateId: SCENE_ENTER_REVEAL_SEQUENCE_TEMPLATE_ID,
    ruleId: 'rule-reveal-sequence',
    actionIds: ['action-reveal-title', 'action-reveal-detail'],
    targetLayerItemIds: ['slide-title', 'slide-detail'],
    ...overrides,
  }
}

function revealRule(id: string, actionId: string, nodeId = 'slide-title'): InteractionRule {
  return {
    id,
    name: id,
    enabled: true,
    trigger: { type: 'scene.enter' },
    conditions: [],
    actions: [{
      id: actionId,
      start: 'after-previous',
      delayMs: 0,
      action: {
        type: 'node.enter',
        nodeId,
        effect: 'fade',
        durationMs: 240,
        easing: 'ease-out',
      },
    }],
  }
}

describe('interaction authoring transaction plans', () => {
  it('atomically hides selected Slide nodes and creates one standard template rule', () => {
    const project = mixedProject()
    const before = structuredClone(project)
    const result = planApplyInteractionTemplate({
      project,
      target: localTarget(project),
      template: template(),
      now: NOW,
    })

    expect(result).toMatchObject({ ok: true, status: 'planned' })
    if (!result.ok || result.status !== 'planned') throw new Error('expected plan')
    const plan = result.plan
    expect(plan.projectId).toBe(project.id)
    expect(plan.baseRevision).toBe(project.revision)
    expect(plan.nextDocument.revision).toBe(project.revision + 1)
    expect(plan.nextDocument.updatedAt).toBe(NOW)
    expect(historyResourceChangesAreEmpty(plan.resourceChanges)).toBe(true)
    expect(plan.selectionHint).toEqual({
      carrier: 'slide-scene',
      ruleId: 'rule-reveal-sequence',
      locationId: 'location-slide',
    })
    expect(plan.feedback).toEqual({
      kind: 'interaction-template-applied',
      carrier: 'slide-scene',
      ruleId: 'rule-reveal-sequence',
      targetLayerItemIds: ['slide-title', 'slide-detail'],
      locationId: 'location-slide',
    })
    expect(layer(plan.nextDocument, 'slide-title').playbackInitialVisibility).toBe('hidden')
    expect(layer(plan.nextDocument, 'slide-detail').playbackInitialVisibility).toBe('hidden')
    expect(slideScene(plan.nextDocument).interactions).toEqual([{
      id: 'rule-reveal-sequence',
      name: '进入场景后依次出现',
      enabled: true,
      trigger: { type: 'scene.enter' },
      conditions: [],
      actions: [
        {
          id: 'action-reveal-title',
          start: 'after-previous',
          delayMs: 0,
          action: {
            type: 'node.enter',
            nodeId: 'slide-title',
            effect: 'fade',
            durationMs: 240,
            easing: 'ease-out',
          },
        },
        {
          id: 'action-reveal-detail',
          start: 'after-previous',
          delayMs: 80,
          action: {
            type: 'node.enter',
            nodeId: 'slide-detail',
            effect: 'fade',
            durationMs: 240,
            easing: 'ease-out',
          },
        },
      ],
    }])
    expect(project).toEqual(before)
    expect(Object.isFrozen(plan)).toBe(true)
    expect(Object.isFrozen(plan.nextDocument)).toBe(true)
    expect(Object.isFrozen(slideScene(plan.nextDocument).interactions[0])).toBe(true)

    const step = createEditorTransactionStep(project, plan)
    expect(step).not.toBeNull()
    expect(step?.nextDocument.revision).toBe(project.revision + 1)
  })

  it('professionally edits the same stable rule ID and returns a true no-op for equal data', () => {
    const project = mixedProject()
    const created = planApplyInteractionTemplate({
      project,
      target: localTarget(project),
      template: template(),
      now: NOW,
    })
    if (!created.ok || created.status !== 'planned') throw new Error('expected create plan')
    const createdDocument = created.plan.nextDocument
    const originalCreatedDocument = structuredClone(createdDocument)
    const createdRule = slideScene(createdDocument).interactions[0]!
    const actions = structuredClone(createdRule.actions)
    const first = actions[0]!.action
    if (first.type !== 'node.enter') throw new Error('expected enter action')
    first.durationMs = 480

    const updated = planUpdateInteractionRule({
      project: createdDocument,
      target: localTarget(createdDocument),
      ruleId: createdRule.id,
      patch: { name: '专业调整后的依次出现', actions },
      now: LATER,
    })

    expect(updated).toMatchObject({ ok: true, status: 'planned' })
    if (!updated.ok || updated.status !== 'planned') throw new Error('expected update plan')
    const rules = slideScene(updated.plan.nextDocument).interactions
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({
      id: 'rule-reveal-sequence',
      name: '专业调整后的依次出现',
      enabled: true,
      trigger: { type: 'scene.enter' },
    })
    expect(rules[0]!.actions[0]!.action).toMatchObject({ durationMs: 480 })
    expect(rules[0]!.actions).toHaveLength(2)
    expect(updated.plan.selectionHint?.ruleId).toBe(createdRule.id)
    expect(updated.plan.nextDocument.revision).toBe(createdDocument.revision + 1)
    expect(createdDocument).toEqual(originalCreatedDocument)

    const unchanged = planUpdateInteractionRule({
      project: updated.plan.nextDocument,
      target: localTarget(updated.plan.nextDocument),
      ruleId: createdRule.id,
      patch: { name: '专业调整后的依次出现' },
      now: '2026-08-24T08:10:00.000Z',
    })
    expect(unchanged).toEqual({
      ok: true,
      status: 'no-op',
      plan: null,
      feedback: {
        kind: 'interaction-rule-unchanged',
        carrier: 'slide-scene',
        ruleId: 'rule-reveal-sequence',
        targetLayerItemIds: ['slide-title', 'slide-detail'],
        locationId: 'location-slide',
      },
    })
  })

  it('writes effective hidden visibility into the active named state and removes redundant overrides', () => {
    const project = mixedProject()
    const scene = slideScene(project)
    layer(project, 'slide-detail').playbackInitialVisibility = 'hidden'
    scene.presentation = {
      initialStateId: 'state-a',
      states: [{
        id: 'state-a',
        name: '状态 A',
        layerItemOverrides: {
          'slide-title': {
            label: '保留的状态标题',
            playbackInitialVisibility: 'inherit',
          },
          'slide-detail': { playbackInitialVisibility: 'inherit' },
        },
      }],
    }
    const location = project.locations.find((candidate) => candidate.id === 'location-slide')
    if (!location || location.kind !== 'slide-scene') throw new Error('missing slide location')
    location.stateId = 'state-a'
    const before = structuredClone(project)

    const result = planApplyInteractionTemplate({
      project,
      target: localTarget(project),
      template: template({
        conditions: [{ type: 'presentation.in', stateIds: ['state-a'] }],
      }),
      now: NOW,
    })

    expect(result).toMatchObject({ ok: true, status: 'planned' })
    if (!result.ok || result.status !== 'planned') throw new Error('expected state plan')
    const nextScene = slideScene(result.plan.nextDocument)
    const nextState = nextScene.presentation?.states[0]
    expect(layer(result.plan.nextDocument, 'slide-title').playbackInitialVisibility)
      .toBe('inherit')
    expect(layer(result.plan.nextDocument, 'slide-detail').playbackInitialVisibility)
      .toBe('hidden')
    expect(nextState?.layerItemOverrides['slide-title']).toEqual({
      label: '保留的状态标题',
      playbackInitialVisibility: 'hidden',
    })
    expect(nextState?.layerItemOverrides['slide-detail']).toBeUndefined()
    expect(nextScene.interactions[0]?.conditions).toEqual([
      { type: 'presentation.in', stateIds: ['state-a'] },
    ])
    expect(project).toEqual(before)
  })

  it('writes through an explicit live state without persisting session state on the location', () => {
    const project = mixedProject()
    const scene = slideScene(project)
    scene.presentation = {
      initialStateId: 'state-live',
      states: [{
        id: 'state-live',
        name: '实时状态',
        layerItemOverrides: {
          'slide-title': { playbackInitialVisibility: 'inherit' },
        },
      }],
    }
    const location = project.locations.find((candidate) => candidate.id === 'location-slide')
    if (!location || location.kind !== 'slide-scene') throw new Error('missing slide location')
    delete location.stateId
    const before = structuredClone(project)

    const result = planApplyInteractionTemplate({
      project,
      target: { ...localTarget(project), activeStateId: 'state-live' },
      template: template({
        conditions: [{ type: 'presentation.in', stateIds: ['state-live'] }],
      }),
      now: NOW,
    })

    expect(result).toMatchObject({ ok: true, status: 'planned' })
    if (!result.ok || result.status !== 'planned') throw new Error('expected live state plan')
    const nextLocation = result.plan.nextDocument.locations.find(
      (candidate) => candidate.id === 'location-slide',
    )
    const nextState = slideScene(result.plan.nextDocument).presentation?.states[0]
    expect(layer(result.plan.nextDocument, 'slide-title').playbackInitialVisibility)
      .toBe('inherit')
    expect(nextState?.layerItemOverrides['slide-title']).toEqual({
      playbackInitialVisibility: 'hidden',
    })
    expect(slideScene(result.plan.nextDocument).interactions[0]?.conditions).toEqual([
      { type: 'presentation.in', stateIds: ['state-live'] },
    ])
    expect(nextLocation).not.toHaveProperty('stateId')
    expect(project).toEqual(before)
  })

  it('accepts a valid explicit live state for the global carrier without persisting it', () => {
    const project = mixedProject()
    const scene = slideScene(project)
    scene.presentation = {
      initialStateId: 'state-live',
      states: [{ id: 'state-live', name: '实时状态', layerItemOverrides: {} }],
    }
    const location = project.locations.find((candidate) => candidate.id === 'location-slide')
    if (!location || location.kind !== 'slide-scene') throw new Error('missing slide location')
    delete location.stateId

    const result = planApplyInteractionTemplate({
      project,
      target: {
        ...globalTarget(project),
        activeLocationId: 'location-slide',
        activeStateId: 'state-live',
      },
      template: template({
        ruleId: 'global-live-state-reveal',
        actionIds: ['global-live-state-action'],
        targetLayerItemIds: ['global-banner'],
        conditions: [
          { type: 'scene.in', sceneIds: ['scene-1'] },
          { type: 'presentation.in', stateIds: ['state-live'] },
        ],
      }),
      now: NOW,
    })

    expect(result).toMatchObject({ ok: true, status: 'planned' })
    if (!result.ok || result.status !== 'planned') throw new Error('expected global state plan')
    expect(result.plan.nextDocument.globalInteractions[0]?.conditions).toEqual([
      { type: 'scene.in', sceneIds: ['scene-1'] },
      { type: 'presentation.in', stateIds: ['state-live'] },
    ])
    expect(result.plan.nextDocument.locations.find(
      (candidate) => candidate.id === 'location-slide',
    )).not.toHaveProperty('stateId')
  })

  it('uses the same planner for the one project-global carrier', () => {
    const project = mixedProject()
    const result = planApplyInteractionTemplate({
      project,
      target: globalTarget(project),
      template: template({
        ruleId: 'global-reveal',
        actionIds: ['global-reveal-action'],
        targetLayerItemIds: ['global-banner'],
      }),
      now: NOW,
    })

    expect(result).toMatchObject({ ok: true, status: 'planned' })
    if (!result.ok || result.status !== 'planned') throw new Error('expected global plan')
    expect(result.plan.nextDocument.globalInteractions).toEqual([
      expect.objectContaining({ id: 'global-reveal' }),
    ])
    expect(layer(result.plan.nextDocument, 'global-banner').playbackInitialVisibility)
      .toBe('hidden')
    expect(slideScene(result.plan.nextDocument).interactions).toEqual([])
    expect(result.plan.selectionHint).toEqual({
      carrier: 'global',
      ruleId: 'global-reveal',
    })
  })

  it('authors only declared and type-correct course-state conditions and actions', () => {
    const project = mixedProject()
    project.courseState = [{
      key: 'ready',
      valueType: 'boolean',
      defaultValue: false,
    }]
    slideScene(project).interactions.push({
      id: 'course-state-rule',
      enabled: true,
      trigger: { type: 'scene.enter' },
      conditions: [{
        type: 'course-state.compare',
        key: 'ready',
        operator: 'eq',
        value: false,
      }],
      actions: [{
        id: 'set-ready',
        start: 'after-previous',
        delayMs: 0,
        action: { type: 'course-state.set', key: 'ready', value: true },
      }],
    })

    const valid = planUpdateInteractionRule({
      project,
      target: localTarget(project),
      ruleId: 'course-state-rule',
      patch: { name: '状态解锁' },
      now: NOW,
    })
    expect(valid).toMatchObject({ ok: true, status: 'planned' })

    expect(planUpdateInteractionRule({
      project,
      target: localTarget(project),
      ruleId: 'course-state-rule',
      patch: {
        actions: [{
          id: 'set-ready',
          start: 'after-previous',
          delayMs: 0,
          action: { type: 'course-state.set', key: 'ready', value: 'true' },
        }],
      },
      now: NOW,
    })).toMatchObject({ ok: false, code: 'invalid-rule' })

    expect(planUpdateInteractionRule({
      project,
      target: localTarget(project),
      ruleId: 'course-state-rule',
      patch: {
        conditions: [{
          type: 'course-state.exists',
          key: 'missing',
          exists: true,
        }],
      },
      now: NOW,
    })).toMatchObject({ ok: false, code: 'invalid-rule' })
  })

  it.each([
    undefined,
    'location-flow',
    'location-spatial',
  ] as const)('edits a scene-scoped global state rule from active location %s', (activeLocationId) => {
    const project = mixedProject()
    const scene = slideScene(project)
    scene.presentation = {
      initialStateId: 'state-a',
      states: [{ id: 'state-a', name: '状态 A', layerItemOverrides: {} }],
    }
    project.globalInteractions.push({
      id: 'global-state-rule',
      name: '全局状态规则',
      enabled: true,
      trigger: { type: 'scene.enter' },
      conditions: [
        { type: 'scene.in', sceneIds: ['scene-1'] },
        { type: 'presentation.in', stateIds: ['state-a'] },
      ],
      actions: [{
        id: 'set-state-a',
        start: 'after-previous',
        delayMs: 0,
        action: { type: 'presentation.set', stateId: 'state-a' },
      }],
    })
    const target: InteractionAuthoringTarget = {
      ...globalTarget(project),
      ...(activeLocationId === undefined ? {} : { activeLocationId }),
    }

    const result = planUpdateInteractionRule({
      project,
      target,
      ruleId: 'global-state-rule',
      patch: { name: '从任意 Surface 修改名称' },
      now: NOW,
    })

    expect(result).toMatchObject({ ok: true, status: 'planned' })
    if (!result.ok || result.status !== 'planned') throw new Error('expected global edit')
    expect(result.plan.nextDocument.globalInteractions[0]).toMatchObject({
      id: 'global-state-rule',
      name: '从任意 Surface 修改名称',
      conditions: [
        { type: 'scene.in', sceneIds: ['scene-1'] },
        { type: 'presentation.in', stateIds: ['state-a'] },
      ],
    })
  })

  it.each([
    undefined,
    'location-flow',
  ] as const)('edits a global state rule without scene.in from context %s', (activeLocationId) => {
    const project = mixedProject()
    const scene = slideScene(project)
    scene.presentation = {
      initialStateId: 'state-a',
      states: [{ id: 'state-a', name: '状态 A', layerItemOverrides: {} }],
    }
    project.globalInteractions.push({
      id: 'global-unscoped-state-rule',
      name: '未限定场景的全局状态规则',
      enabled: true,
      trigger: { type: 'scene.enter' },
      conditions: [{ type: 'presentation.in', stateIds: ['state-a'] }],
      actions: [{
        id: 'set-unscoped-state-a',
        start: 'after-previous',
        delayMs: 0,
        action: { type: 'presentation.set', stateId: 'state-a' },
      }],
    })
    const target: InteractionAuthoringTarget = {
      ...globalTarget(project),
      ...(activeLocationId === undefined ? {} : { activeLocationId }),
    }

    expect(planUpdateInteractionRule({
      project,
      target,
      ruleId: 'global-unscoped-state-rule',
      patch: { name: '无论当前 Surface 都可修改' },
      now: NOW,
    })).toMatchObject({ ok: true, status: 'planned' })
  })

  it('treats multiple scene.in IDs as OR candidates for global state references', () => {
    const project = mixedProject()
    const slideSurface = project.surfaces.find((surface) => surface.type === 'slide')
    if (!slideSurface || slideSurface.type !== 'slide') throw new Error('missing slide surface')
    const firstScene = slideSurface.scenes[0]!
    firstScene.presentation = {
      initialStateId: 'state-a',
      states: [{ id: 'state-a', name: '状态 A', layerItemOverrides: {} }],
    }
    slideSurface.scenes.push({
      id: 'scene-2',
      name: '演示页 2',
      backgroundColor: '#ffffff',
      layerItems: [],
      presentation: {
        initialStateId: 'state-b',
        states: [{ id: 'state-b', name: '状态 B', layerItemOverrides: {} }],
      },
      interactions: [],
    })
    project.locations.push({
      id: 'location-slide-2',
      label: '演示页 2',
      kind: 'slide-scene',
      surfaceId: slideSurface.id,
      sceneId: 'scene-2',
    })
    const printEntry = project.mixedPrintPlan?.entries.find(
      (entry) => entry.kind === 'slide-scenes' && entry.surfaceId === slideSurface.id,
    )
    if (printEntry?.kind === 'slide-scenes') printEntry.sceneIds.push('scene-2')
    project.globalInteractions.push({
      id: 'global-or-state-rule',
      name: '多场景 OR 状态规则',
      enabled: true,
      trigger: { type: 'scene.enter' },
      conditions: [
        { type: 'scene.in', sceneIds: ['scene-1', 'scene-2'] },
        { type: 'presentation.in', stateIds: ['state-a'] },
      ],
      actions: [{
        id: 'set-or-state-a',
        start: 'after-previous',
        delayMs: 0,
        action: { type: 'presentation.set', stateId: 'state-a' },
      }],
    })

    expect(planUpdateInteractionRule({
      project,
      target: { ...globalTarget(project), activeLocationId: 'location-flow' },
      ruleId: 'global-or-state-rule',
      patch: { enabled: false },
      now: NOW,
    })).toMatchObject({ ok: true, status: 'planned' })
  })

  it.each([
    ['location-flow', 'no-local-interaction-carrier'],
    ['location-spatial', 'no-local-interaction-carrier'],
    ['missing-location', 'invalid-location'],
  ] as const)('rejects local writes at %s with %s', (locationId, code) => {
    const project = mixedProject()
    const before = structuredClone(project)
    const result = planApplyInteractionTemplate({
      project,
      target: localTarget(project, locationId),
      template: template(),
      now: NOW,
    })
    expect(result).toMatchObject({ ok: false, code })
    expect(project).toEqual(before)
  })

  it('rejects stale identity, invalid clocks, duplicates, wrong owners, and locks', () => {
    const project = mixedProject()

    expect(planApplyInteractionTemplate({
      project,
      target: { ...localTarget(project), projectId: 'another-project' },
      template: template(),
      now: NOW,
    })).toMatchObject({ ok: false, code: 'project-mismatch' })
    expect(planApplyInteractionTemplate({
      project,
      target: { ...localTarget(project), baseRevision: project.revision - 1 },
      template: template(),
      now: NOW,
    })).toMatchObject({ ok: false, code: 'revision-conflict' })
    expect(planApplyInteractionTemplate({
      project,
      target: localTarget(project),
      template: template(),
      now: 'not-a-clock',
    })).toMatchObject({ ok: false, code: 'invalid-clock' })
    expect(planApplyInteractionTemplate({
      project,
      target: localTarget(project),
      template: template({
        actionIds: ['shared-action'],
        targetLayerItemIds: ['slide-shared'],
      }),
      now: NOW,
    })).toMatchObject({ ok: false, code: 'invalid-layer-target' })

    slideScene(project).interactions.push(revealRule(
      'rule-reveal-sequence',
      'existing-action',
    ))
    expect(planApplyInteractionTemplate({
      project,
      target: localTarget(project),
      template: template(),
      now: NOW,
    })).toMatchObject({ ok: false, code: 'duplicate-rule' })

    slideScene(project).interactions = []
    layer(project, 'slide-title').locked = true
    expect(planApplyInteractionTemplate({
      project,
      target: localTarget(project),
      template: template(),
      now: NOW,
    })).toMatchObject({ ok: false, code: 'locked-layer' })
  })

  it('rejects stale explicit states and state context outside a Slide location', () => {
    const project = mixedProject()
    const scene = slideScene(project)
    scene.presentation = {
      initialStateId: 'state-a',
      states: [{ id: 'state-a', name: '状态 A', layerItemOverrides: {} }],
    }
    const before = structuredClone(project)

    expect(planApplyInteractionTemplate({
      project,
      target: { ...localTarget(project), activeStateId: 'missing-state' },
      template: template(),
      now: NOW,
    })).toMatchObject({ ok: false, code: 'invalid-location' })
    expect(planApplyInteractionTemplate({
      project,
      target: {
        ...globalTarget(project),
        activeLocationId: 'location-slide',
        activeStateId: 'missing-state',
      },
      template: template({
        ruleId: 'global-missing-state',
        actionIds: ['global-missing-state-action'],
        targetLayerItemIds: ['global-banner'],
      }),
      now: NOW,
    })).toMatchObject({ ok: false, code: 'invalid-location' })
    expect(planApplyInteractionTemplate({
      project,
      target: {
        ...globalTarget(project),
        activeLocationId: 'location-flow',
        activeStateId: 'state-a',
      },
      template: template({
        ruleId: 'global-flow-state',
        actionIds: ['global-flow-state-action'],
        targetLayerItemIds: ['global-banner'],
      }),
      now: NOW,
    })).toMatchObject({ ok: false, code: 'invalid-location' })
    expect(project).toEqual(before)
  })

  it('uses the effective local carrier when another Surface repeats the same layerItemId', () => {
    const localLocked = mixedProject()
    layer(localLocked, 'slide-title').locked = true
    spatialItem(localLocked).layerItemId = 'slide-title'
    spatialItem(localLocked).locked = false
    expect(planApplyInteractionTemplate({
      project: localLocked,
      target: localTarget(localLocked),
      template: template(),
      now: NOW,
    })).toMatchObject({ ok: false, code: 'locked-layer' })

    const spatialLocked = mixedProject()
    layer(spatialLocked, 'slide-title').locked = false
    spatialItem(spatialLocked).layerItemId = 'slide-title'
    spatialItem(spatialLocked).locked = true
    expect(planApplyInteractionTemplate({
      project: spatialLocked,
      target: localTarget(spatialLocked),
      template: template(),
      now: NOW,
    })).toMatchObject({ ok: true, status: 'planned' })
  })

  it('honors an active-state lock instead of the base layer lock value', () => {
    const project = mixedProject()
    const scene = slideScene(project)
    scene.presentation = {
      initialStateId: 'state-a',
      states: [{
        id: 'state-a',
        name: '状态 A',
        layerItemOverrides: { 'slide-title': { locked: true } },
      }],
    }
    const location = project.locations.find((candidate) => candidate.id === 'location-slide')
    if (!location || location.kind !== 'slide-scene') throw new Error('missing slide location')
    location.stateId = 'state-a'
    spatialItem(project).layerItemId = 'slide-title'
    spatialItem(project).locked = false

    expect(planApplyInteractionTemplate({
      project,
      target: localTarget(project),
      template: template(),
      now: NOW,
    })).toMatchObject({ ok: false, code: 'locked-layer' })
  })

  it('enforces the scope limit and template/rule schemas before producing a plan', () => {
    const limited = mixedProject()
    slideScene(limited).interactions = Array.from(
      { length: MAX_SCENE_INTERACTIONS },
      (_, index) => revealRule(`rule-${index}`, `action-${index}`),
    )
    expect(planApplyInteractionTemplate({
      project: limited,
      target: localTarget(limited),
      template: template(),
      now: NOW,
    })).toMatchObject({ ok: false, code: 'interaction-limit' })

    const project = mixedProject()
    expect(planApplyInteractionTemplate({
      project,
      target: localTarget(project),
      template: template({ actionIds: ['only-one-action'] }),
      now: NOW,
    })).toMatchObject({ ok: false, code: 'invalid-template' })
    expect(planApplyInteractionTemplate({
      project,
      target: localTarget(project),
      template: template({ name: '' }),
      now: NOW,
    })).toMatchObject({ ok: false, code: 'invalid-rule' })
    expect(() => planApplyInteractionTemplate({
      project,
      target: localTarget(project),
      template: {
        ...template(),
        templateId: 'unknown-template',
      } as unknown as SceneEnterRevealSequenceTemplateRequest,
      now: NOW,
    })).not.toThrow()
    expect(planApplyInteractionTemplate({
      project,
      target: localTarget(project),
      template: {
        ...template(),
        templateId: 'unknown-template',
      } as unknown as SceneEnterRevealSequenceTemplateRequest,
      now: NOW,
    })).toMatchObject({ ok: false, code: 'invalid-template' })
  })

  it('rejects newly introduced dangling scene, state, animation, and out-of-carrier node references', () => {
    const missingScene = mixedProject()
    slideScene(missingScene).interactions.push(revealRule('rule', 'action'))
    expect(planUpdateInteractionRule({
      project: missingScene,
      target: localTarget(missingScene),
      ruleId: 'rule',
      patch: {
        actions: [{
          id: 'go-missing',
          start: 'after-previous',
          delayMs: 0,
          action: { type: 'scene.go', sceneId: 'missing-scene' },
        }],
      },
      now: NOW,
    })).toMatchObject({ ok: false, code: 'invalid-rule' })

    const missingState = mixedProject()
    const stateScene = slideScene(missingState)
    stateScene.presentation = {
      initialStateId: 'state-a',
      states: [{ id: 'state-a', name: '状态 A', layerItemOverrides: {} }],
    }
    const stateLocation = missingState.locations.find(
      (candidate) => candidate.id === 'location-slide',
    )
    if (!stateLocation || stateLocation.kind !== 'slide-scene') {
      throw new Error('missing slide location')
    }
    stateLocation.stateId = 'state-a'
    stateScene.interactions.push(revealRule('rule', 'action'))
    expect(planUpdateInteractionRule({
      project: missingState,
      target: localTarget(missingState),
      ruleId: 'rule',
      patch: {
        actions: [{
          id: 'set-missing-state',
          start: 'after-previous',
          delayMs: 0,
          action: { type: 'presentation.set', stateId: 'missing-state' },
        }],
      },
      now: NOW,
    })).toMatchObject({ ok: false, code: 'invalid-rule' })

    const missingAction = mixedProject()
    slideScene(missingAction).interactions.push(revealRule('rule', 'action'))
    expect(planUpdateInteractionRule({
      project: missingAction,
      target: localTarget(missingAction),
      ruleId: 'rule',
      patch: { trigger: { type: 'animation.completed', actionId: 'missing-action' } },
      now: NOW,
    })).toMatchObject({ ok: false, code: 'invalid-rule' })

    const nonMotionAction = mixedProject()
    slideScene(nonMotionAction).interactions.push(
      {
        id: 'navigation-source',
        name: '导航源',
        enabled: true,
        trigger: { type: 'scene.enter' },
        conditions: [],
        actions: [{
          id: 'navigation-action',
          start: 'after-previous',
          delayMs: 0,
          action: { type: 'scene.next' },
        }],
      },
      revealRule('listener-rule', 'listener-action', 'slide-detail'),
    )
    expect(planUpdateInteractionRule({
      project: nonMotionAction,
      target: localTarget(nonMotionAction),
      ruleId: 'listener-rule',
      patch: {
        trigger: {
          type: 'animation.completed',
          actionId: 'navigation-action',
        },
      },
      now: NOW,
    })).toMatchObject({ ok: false, code: 'invalid-rule' })

    const removedAction = mixedProject()
    slideScene(removedAction).interactions.push(
      revealRule('source-rule', 'source-action'),
      {
        ...revealRule('completion-rule', 'completion-action', 'slide-detail'),
        trigger: { type: 'animation.completed', actionId: 'source-action' },
      },
    )
    expect(planUpdateInteractionRule({
      project: removedAction,
      target: localTarget(removedAction),
      ruleId: 'source-rule',
      patch: {
        actions: [{
          id: 'source-action',
          start: 'after-previous',
          delayMs: 0,
          action: { type: 'scene.next' },
        }],
      },
      now: NOW,
    })).toMatchObject({ ok: false, code: 'invalid-rule' })

    const spatialReference = mixedProject()
    slideScene(spatialReference).interactions.push(revealRule('rule', 'action'))
    expect(planUpdateInteractionRule({
      project: spatialReference,
      target: localTarget(spatialReference),
      ruleId: 'rule',
      patch: {
        actions: [{
          id: 'reveal-spatial',
          start: 'after-previous',
          delayMs: 0,
          action: {
            type: 'node.enter',
            nodeId: 'spatial-label',
            effect: 'fade',
            durationMs: 240,
            easing: 'ease-out',
          },
        }],
      },
      now: NOW,
    })).toMatchObject({ ok: false, code: 'invalid-rule' })

    const globalSpatialReference = mixedProject()
    globalSpatialReference.globalInteractions.push(
      revealRule('global-rule', 'global-action', 'global-banner'),
    )
    expect(planUpdateInteractionRule({
      project: globalSpatialReference,
      target: globalTarget(globalSpatialReference),
      ruleId: 'global-rule',
      patch: {
        actions: [{
          id: 'global-reveal-spatial',
          start: 'after-previous',
          delayMs: 0,
          action: {
            type: 'node.enter',
            nodeId: 'spatial-label',
            effect: 'fade',
            durationMs: 240,
            easing: 'ease-out',
          },
        }],
      },
      now: NOW,
    })).toMatchObject({ ok: false, code: 'invalid-rule' })
  })

  it('rejects missing, locked, malformed, and scope-conflicting professional updates', () => {
    const project = mixedProject()
    slideScene(project).interactions.push(
      revealRule('first-rule', 'first-action'),
      revealRule('second-rule', 'second-action', 'slide-detail'),
    )

    expect(planUpdateInteractionRule({
      project,
      target: localTarget(project),
      ruleId: 'missing-rule',
      patch: { name: '缺失' },
      now: NOW,
    })).toMatchObject({ ok: false, code: 'rule-missing' })
    expect(planUpdateInteractionRule({
      project,
      target: localTarget(project),
      ruleId: 'first-rule',
      patch: { name: '' },
      now: NOW,
    })).toMatchObject({ ok: false, code: 'invalid-rule' })

    const conflictingActions = structuredClone(slideScene(project).interactions[0]!.actions)
    conflictingActions[0]!.id = 'second-action'
    expect(planUpdateInteractionRule({
      project,
      target: localTarget(project),
      ruleId: 'first-rule',
      patch: { actions: conflictingActions },
      now: NOW,
    })).toMatchObject({ ok: false, code: 'invalid-rule' })

    layer(project, 'slide-title').locked = true
    expect(planUpdateInteractionRule({
      project,
      target: localTarget(project),
      ruleId: 'first-rule',
      patch: { name: '修改锁定规则' },
      now: NOW,
    })).toMatchObject({ ok: false, code: 'locked-layer' })
  })
})
