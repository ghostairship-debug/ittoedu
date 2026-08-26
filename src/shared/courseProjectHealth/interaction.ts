import type {
  InteractionActionPayload,
  InteractionRule,
} from '../interactionTypes'
import { composeCourseProjectLocation } from '../courseLayerComposition'
import type {
  CourseProjectDocument,
  LayerItem,
  SlideSceneDocument,
} from '../courseProjectTypes'
import {
  allLayerVisits,
  courseProjectComposedLayerPath,
  effectiveLayerItem,
  finalizeCourseProjectHealthFindings,
  slideScenes,
} from './internal'
import type {
  CourseProjectHealthArchiveFiles,
  CourseProjectHealthFinding,
  CourseProjectHealthFindingDraft,
} from './types'

interface RuleScope {
  scene?: SlideSceneDocument
  path: Array<string | number>
  possibleScenes: SlideSceneDocument[]
  projectScenes: readonly SlideSceneDocument[]
}

function itemMatchesExpectedType(
  item: LayerItem,
  expected: 'component' | 'video',
): boolean {
  return expected === 'component'
    ? item.kind === 'component'
    : item.kind === 'native' && item.content.nativeType === 'video'
}

function expectedTypeLabel(expected: 'component' | 'video'): string {
  return expected === 'component' ? '组件' : '视频'
}

function possibleGlobalScenes(
  projectScenes: readonly SlideSceneDocument[],
  rule: InteractionRule,
): SlideSceneDocument[] {
  const conditions = rule.conditions.filter((condition) => condition.type === 'scene.in')
  if (conditions.length === 0) return [...projectScenes]
  return projectScenes.filter((scene) => conditions.every(
    (condition) => condition.type === 'scene.in' && condition.sceneIds.includes(scene.id),
  ))
}

function stateIds(scene: SlideSceneDocument): Set<string> {
  return new Set(scene.presentation?.states.map((state) => state.id) ?? [])
}

function addStateReferenceFinding(
  drafts: CourseProjectHealthFindingDraft[],
  rule: InteractionRule,
  stateId: string,
  scope: RuleScope,
  path: Array<string | number>,
  mode: 'reference' | 'presentation-target' = 'reference',
): void {
  if (scope.scene) {
    if (stateIds(scope.scene).has(stateId)) return
    drafts.push({
      severity: 'error',
      code: 'interaction-state-reference-missing',
      message: `交互规则“${rule.name ?? rule.id}”引用了不存在的状态“${stateId}”。`,
      path,
    })
    return
  }
  const candidateScenes = mode === 'presentation-target'
    ? scope.possibleScenes
    : scope.projectScenes
  if (candidateScenes.length === 0) {
    if (mode === 'reference') {
      drafts.push({
        severity: 'error',
        code: 'interaction-state-reference-missing',
        message: `全局交互规则“${rule.name ?? rule.id}”引用了不存在的状态“${stateId}”。`,
        path,
      })
    }
    return
  }
  const invalidScenes = candidateScenes.filter((scene) => !stateIds(scene).has(stateId))
  if (invalidScenes.length === 0) return
  if (invalidScenes.length === candidateScenes.length) {
    drafts.push({
      severity: 'error',
      code: 'interaction-state-reference-missing',
      message: `全局交互规则“${rule.name ?? rule.id}”引用了所有可能场景中都不存在的状态“${stateId}”。`,
      path,
    })
    return
  }
  // Legacy partial-target semantics apply only to presentation.set. A global
  // trigger or condition merely needs the referenced state to exist somewhere.
  if (mode === 'reference') return
  drafts.push({
    severity: 'warning',
    code: 'global-interaction-state-target-partial',
    message: `全局交互规则“${rule.name ?? rule.id}”的目标状态“${stateId}”在 ${invalidScenes.map((scene) => `“${scene.name}”`).join('、')} 中不存在，请用“当前场景”条件缩小作用域。`,
    path,
  })
}

function checkTypedNodeReference(
  drafts: CourseProjectHealthFindingDraft[],
  itemsById: ReadonlyMap<string, LayerItem[]>,
  rule: InteractionRule,
  nodeId: string,
  expected: 'component' | 'video',
  path: Array<string | number>,
): void {
  const matches = itemsById.get(nodeId) ?? []
  // Missing ids are rejected by V9 Schema. Ambiguous ids are handled by the
  // stable-id guard; this collector must not guess which owner will win.
  if (matches.length !== 1 || itemMatchesExpectedType(matches[0]!, expected)) return
  drafts.push({
    severity: 'error',
    code: 'interaction-node-type-mismatch',
    message: `交互规则“${rule.name ?? rule.id}”要求${expectedTypeLabel(expected)}图层，但“${nodeId}”不是该类型。`,
    path,
    layerItemId: nodeId,
  })
}

function checkAction(
  projectScenes: readonly SlideSceneDocument[],
  drafts: CourseProjectHealthFindingDraft[],
  itemsById: ReadonlyMap<string, LayerItem[]>,
  rule: InteractionRule,
  action: InteractionActionPayload,
  scope: RuleScope,
  path: Array<string | number>,
): void {
  if (action.type === 'presentation.set') {
    addStateReferenceFinding(
      drafts,
      rule,
      action.stateId,
      scope,
      path,
      'presentation-target',
    )
    return
  }
  if (action.type === 'scene.go') {
    const targetScenes = projectScenes.filter((scene) => scene.id === action.sceneId)
    if (targetScenes.length === 0) {
      drafts.push({
        severity: 'error',
        code: 'interaction-scene-reference-missing',
        message: `交互规则“${rule.name ?? rule.id}”要跳转到不存在的 Slide 场景“${action.sceneId}”。`,
        path,
      })
    } else if (
      action.targetStateId
      && !targetScenes.some((scene) => stateIds(scene).has(action.targetStateId!))
    ) {
      drafts.push({
        severity: 'error',
        code: 'interaction-state-reference-missing',
        message: `交互规则“${rule.name ?? rule.id}”要跳转到场景“${action.sceneId}”中不存在的状态“${action.targetStateId}”。`,
        path,
      })
    }
    return
  }
  if (action.type.startsWith('video.') && 'nodeId' in action) {
    checkTypedNodeReference(drafts, itemsById, rule, action.nodeId, 'video', path)
  }
}

function targetInitiallyVisibleForRule(
  target: LayerItem,
  rule: InteractionRule,
  scope: RuleScope,
): boolean {
  const baseVisible = target.visible
    && target.playbackInitialVisibility === 'inherit'
  const stateConditions = rule.conditions.filter(
    (condition) => condition.type === 'presentation.in',
  )
  const candidateScenes = scope.scene ? [scope.scene] : scope.possibleScenes
  if (candidateScenes.length === 0) {
    return stateConditions.length === 0
      && !rule.conditions.some((condition) => condition.type === 'scene.in')
      && baseVisible
  }
  return candidateScenes.some((scene) => {
    if (rule.conditions.some((condition) => (
      condition.type === 'scene.in' && !condition.sceneIds.includes(scene.id)
    ))) return false
    const states = scene.presentation?.states ?? []
    if (states.length === 0) return stateConditions.length === 0 && baseVisible
    return states.some((state) => {
      if (!stateConditions.every((condition) => (
        condition.type === 'presentation.in' && condition.stateIds.includes(state.id)
      ))) return false
      const effective = effectiveLayerItem(
        target,
        state.layerItemOverrides[target.layerItemId],
      )
      return effective.visible
        && effective.playbackInitialVisibility === 'inherit'
    })
  })
}

function checkRules(
  projectScenes: readonly SlideSceneDocument[],
  drafts: CourseProjectHealthFindingDraft[],
  itemsById: ReadonlyMap<string, LayerItem[]>,
  rules: readonly InteractionRule[],
  baseScope: Omit<RuleScope, 'possibleScenes' | 'projectScenes'>,
): void {
  const motionActionIds = new Set(rules.flatMap((rule) => rule.actions
    .filter(({ action }) => action.type === 'node.enter' || action.type === 'node.exit')
    .map(({ id }) => id)))

  rules.forEach((rule, ruleIndex) => {
    const rulePath = [...baseScope.path, ruleIndex]
    const scope: RuleScope = {
      ...baseScope,
      projectScenes,
      possibleScenes: baseScope.scene
        ? [baseScope.scene]
        : possibleGlobalScenes(projectScenes, rule),
    }
    const triggerPath = [...rulePath, 'trigger']
    const trigger = rule.trigger
    if (trigger.type === 'component.event') {
      checkTypedNodeReference(
        drafts,
        itemsById,
        rule,
        trigger.nodeId,
        'component',
        triggerPath,
      )
    } else if (trigger.type.startsWith('video.') && 'nodeId' in trigger) {
      checkTypedNodeReference(
        drafts,
        itemsById,
        rule,
        trigger.nodeId,
        'video',
        triggerPath,
      )
    } else if (trigger.type === 'presentation.enter') {
      addStateReferenceFinding(drafts, rule, trigger.stateId, scope, triggerPath)
    } else if (
      trigger.type === 'animation.completed'
      && !motionActionIds.has(trigger.actionId)
    ) {
      drafts.push({
        severity: 'error',
        code: 'interaction-action-reference-missing',
        message: `交互规则“${rule.name ?? rule.id}”引用了不存在的动画动作“${trigger.actionId}”。`,
        path: triggerPath,
      })
    }

    if (
      trigger.type === 'animation.completed'
      && rule.actions.some((step) => (
        step.id === trigger.actionId
        && (step.action.type === 'node.enter' || step.action.type === 'node.exit')
      ))
    ) {
      drafts.push({
        severity: 'warning',
        code: 'interaction-animation-self-loop',
        message: `交互规则“${rule.name ?? rule.id}”会由自身动画完成再次触发，可能形成循环。`,
        path: triggerPath,
      })
    }

    rule.conditions.forEach((condition, conditionIndex) => {
      if (condition.type !== 'presentation.in') return
      condition.stateIds.forEach((stateId, stateIndex) => addStateReferenceFinding(
        drafts,
        rule,
        stateId,
        scope,
        [...rulePath, 'conditions', conditionIndex, 'stateIds', stateIndex],
      ))
    })

    rule.actions.forEach((step, actionIndex) => {
      const actionPath = [...rulePath, 'actions', actionIndex, 'action']
      checkAction(projectScenes, drafts, itemsById, rule, step.action, scope, actionPath)
      if (step.action.type !== 'node.enter' || trigger.type === 'node.activated') return
      const matches = itemsById.get(step.action.nodeId) ?? []
      if (matches.length !== 1) return
      const target = matches[0]!
      const targetNodeId = step.action.nodeId
      const hiddenEarlier = rule.actions.slice(0, actionIndex).some((earlier) => (
        earlier.action.type === 'node.exit'
        && earlier.action.nodeId === targetNodeId
      ))
      if (
        targetInitiallyVisibleForRule(target, rule, scope)
        && !hiddenEarlier
      ) {
        drafts.push({
          severity: 'warning',
          code: 'interaction-enter-target-initially-visible',
          message: `元素“${target.label}”在入场动作触发前已默认显示；如需等待事件后出现，请将播放初始状态设为隐藏。`,
          path: actionPath,
          layerItemId: target.layerItemId,
        })
      }
    })
  })
}

function informationReleaseFindings(
  project: CourseProjectDocument,
  surfaceIndex: number,
  sceneIndex: number,
  scene: SlideSceneDocument,
  globalInteractions: readonly InteractionRule[],
): CourseProjectHealthFindingDraft[] {
  const drafts: CourseProjectHealthFindingDraft[] = []
  const surface = project.surfaces[surfaceIndex]
  if (surface?.type !== 'slide') return drafts
  const locations = project.locations.filter((location) => (
    location.kind === 'slide-scene'
    && location.surfaceId === surface.id
    && location.sceneId === scene.id
  ))
  const states = scene.presentation?.states.map((state) => ({
    id: state.id as string | undefined,
    name: state.name,
  })) ?? [{ id: undefined, name: '基础画面' }]

  states.forEach((state) => {
    locations.forEach((location) => {
      const composition = composeCourseProjectLocation({
        project,
        locationId: location.id,
        stateId: state.id ?? null,
      })
      const items = new Map(composition.entries.map((entry) => [
        entry.item.layerItemId,
        entry,
      ]))
      const initiallyVisible = new Set(composition.entries
        .filter((entry) => entry.initiallyVisible)
        .map((entry) => entry.item.layerItemId))
      const initiallyHidden = composition.entries.filter((entry) => (
        entry.mounted && !entry.initiallyVisible
      ))
      if (initiallyHidden.length === 0) return

      const candidates = [...globalInteractions, ...scene.interactions].filter((rule) => (
        rule.enabled && rule.conditions.every((condition) => (
          condition.type === 'scene.in'
            ? condition.sceneIds.includes(scene.id)
            : state.id !== undefined && condition.stateIds.includes(state.id)
        ))
      ))
      const reachableRules = new Set<InteractionRule>()
      const completedStages = new Map<string, number>()
      const visibleStages = new Map([...initiallyVisible].map((id) => [id, 0]))
      let changed = true
      let pass = 0
      while (changed && pass <= candidates.length + composition.entries.length + 1) {
        changed = false
        pass += 1
        candidates.forEach((rule) => {
          if (reachableRules.has(rule)) return
          const trigger = rule.trigger
          let triggerStage: number | undefined
          if (trigger.type === 'scene.enter') triggerStage = 0
          else if (trigger.type === 'presentation.enter') {
            if (state.id === trigger.stateId) triggerStage = 0
          } else if (trigger.type === 'node.click') {
            triggerStage = visibleStages.get(trigger.nodeId)
          } else if (trigger.type === 'animation.completed') {
            triggerStage = completedStages.get(trigger.actionId)
          } else {
            triggerStage = 0
          }
          if (triggerStage === undefined) return
          const stage = triggerStage + 1
          reachableRules.add(rule)
          changed = true
          rule.actions.forEach((step) => {
            if (step.action.type === 'node.enter' || step.action.type === 'node.exit') {
              completedStages.set(step.id, Math.max(completedStages.get(step.id) ?? 0, stage))
            }
            if (step.action.type !== 'node.enter') return
            const target = items.get(step.action.nodeId)
            if (!target?.mounted) return
            const previous = visibleStages.get(target.item.layerItemId)
            if (previous === undefined || stage < previous) {
              visibleStages.set(target.item.layerItemId, stage)
            }
          })
        })
      }

      initiallyHidden
        .filter(({ item }) => !visibleStages.has(item.layerItemId))
        .forEach((entry) => {
          const { item } = entry
          const selfTriggered = candidates.some((rule) => (
            rule.trigger.type === 'node.click'
            && rule.trigger.nodeId === item.layerItemId
            && rule.actions.some((step) => (
              step.action.type === 'node.enter'
              && step.action.nodeId === item.layerItemId
            ))
          ))
          drafts.push({
            severity: 'warning',
            code: selfTriggered
              ? 'information-release-hidden-self-trigger'
              : 'information-release-hidden-unreachable',
            message: selfTriggered
              ? `课程位置“${location.label}”（${location.id}）的状态“${state.name}”（${state.id ?? 'base'}）中，元素“${item.label}”初始隐藏，却只能通过点击自身显示；运行时无法完成这次点击。`
              : `课程位置“${location.label}”（${location.id}）的状态“${state.name}”（${state.id ?? 'base'}）中，元素“${item.label}”初始隐藏，但没有从当前可达触发器通向它的显示动作。`,
            path: [
              ...courseProjectComposedLayerPath(
                project,
                surfaceIndex,
                sceneIndex,
                entry.source,
                item.layerItemId,
              ),
              'playbackInitialVisibility',
            ],
            layerItemId: item.layerItemId,
          })
        })
    })
  })
  return drafts
}

export function collectCourseProjectInteractionHealth(
  project: CourseProjectDocument,
  _archiveFiles: CourseProjectHealthArchiveFiles,
): CourseProjectHealthFinding[] {
  const drafts: CourseProjectHealthFindingDraft[] = []
  const scenes = slideScenes(project)
  const sceneIds = new Set<string>()
  const duplicateSceneIds = new Set<string>()
  scenes.forEach(({ scene }) => {
    if (sceneIds.has(scene.id)) duplicateSceneIds.add(scene.id)
    sceneIds.add(scene.id)
  })
  duplicateSceneIds.forEach((sceneId) => drafts.push({
    severity: 'error',
    code: 'scene-id-duplicate',
    message: `不同 Slide surface 含有重复场景 ID“${sceneId}”，场景导航无法唯一解析。`,
    path: ['surfaces'],
  }))

  const itemsById = new Map<string, LayerItem[]>()
  allLayerVisits(project).forEach(({ item }) => {
    const matches = itemsById.get(item.layerItemId) ?? []
    matches.push(item)
    itemsById.set(item.layerItemId, matches)
  })
  const projectScenes = scenes.map(({ scene }) => scene)
  checkRules(projectScenes, drafts, itemsById, project.globalInteractions, {
    path: ['globalInteractions'],
  })
  scenes.forEach(({ scene, path, surfaceIndex, sceneIndex }) => {
    checkRules(projectScenes, drafts, itemsById, scene.interactions, {
      scene,
      path: [...path, 'interactions'],
    })
    drafts.push(...informationReleaseFindings(
      project,
      surfaceIndex,
      sceneIndex,
      scene,
      project.globalInteractions,
    ))
  })
  return finalizeCourseProjectHealthFindings(project, drafts)
}
