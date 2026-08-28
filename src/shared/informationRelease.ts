import type {
  InteractionActionStep,
  InteractionRule,
  InteractionTrigger,
} from './interactionTypes'
import { ensureScenePresentation, materializeScene } from './presentation'
import type { ProjectDocument, SceneDocument, SceneNode } from './projectTypes'

export interface InformationReleaseStep {
  nodeId: string
  nodeName: string
  ruleId: string
  actionId: string
  stage: number
}

export interface InformationReleaseStateReport {
  sceneId: string
  sceneName: string
  stateId: string
  stateName: string
  initialVisibleNodeIds: string[]
  initiallyHiddenNodeIds: string[]
  reachableRuleIds: string[]
  revealSteps: InformationReleaseStep[]
  hiddenWithoutRevealNodeIds: string[]
  hiddenSelfTriggeredNodeIds: string[]
}

export interface InformationReleaseReport {
  states: InformationReleaseStateReport[]
  summary: {
    stateCount: number
    initiallyHiddenCount: number
    revealedCount: number
    hiddenWithoutRevealCount: number
    hiddenSelfTriggeredCount: number
  }
}

function ruleAllowedInState(
  rule: InteractionRule,
  sceneId: string,
  stateId: string,
): boolean {
  return rule.enabled && rule.conditions.every((condition) => {
    if (condition.type === 'scene.in') return condition.sceneIds.includes(sceneId)
    if (condition.type === 'presentation.in') return condition.stateIds.includes(stateId)
    return true
  })
}

function triggerSeedReachable(
  trigger: InteractionTrigger,
  scene: SceneDocument,
  stateId: string,
): boolean {
  // A scene can be entered directly at any authored targetStateId. At runtime
  // scene.enter is dispatched against that resolved current state, not only
  // against the scene's default initial state.
  if (trigger.type === 'scene.enter') return true
  if (trigger.type === 'presentation.enter') return trigger.stateId === stateId
  if (trigger.type === 'node.click' || trigger.type === 'animation.completed') return false
  // Component/runtime/media/presenter and node activation events are possible
  // external inputs. The inspector intentionally does not pretend to know
  // whether a teacher or runtime will actually emit them.
  return true
}

function revealActions(rule: InteractionRule): InteractionActionStep[] {
  return rule.actions.filter((step) => step.action.type === 'node.enter')
}

function nodeMap(nodes: readonly SceneNode[]): Map<string, SceneNode> {
  return new Map(nodes.map((node) => [node.id, node]))
}

function analyzeState(
  scene: SceneDocument,
  stateId: string,
  stateName: string,
): InformationReleaseStateReport {
  const effectiveScene = materializeScene(scene, stateId)
  const nodes = nodeMap(effectiveScene.nodes)
  const initialVisible = new Set(
    effectiveScene.nodes
      .filter((node) => node.visible && node.playbackInitialVisibility !== 'hidden')
      .map((node) => node.id),
  )
  const initiallyHidden = effectiveScene.nodes
    .filter((node) => node.visible && node.playbackInitialVisibility === 'hidden')
    .map((node) => node.id)
  const candidateRules = scene.interactions.filter(
    (rule) => ruleAllowedInState(rule, scene.id, stateId),
  )
  const reachableRules = new Map<string, number>()
  const completedActionStages = new Map<string, number>()
  const visibleOrRevealed = new Map<string, number>(
    [...initialVisible].map((nodeId) => [nodeId, 0]),
  )
  const revealSteps = new Map<string, InformationReleaseStep>()

  let changed = true
  let pass = 0
  while (changed && pass <= candidateRules.length + effectiveScene.nodes.length + 1) {
    changed = false
    pass += 1
    for (const rule of candidateRules) {
      if (reachableRules.has(rule.id)) continue
      const trigger = rule.trigger
      let triggerStage: number | undefined
      if (triggerSeedReachable(trigger, scene, stateId)) {
        triggerStage = 0
      } else if (trigger.type === 'node.click') {
        triggerStage = visibleOrRevealed.get(trigger.nodeId)
      } else if (trigger.type === 'animation.completed') {
        triggerStage = completedActionStages.get(trigger.actionId)
      }
      if (triggerStage === undefined) continue

      const ruleStage = triggerStage + 1
      reachableRules.set(rule.id, ruleStage)
      changed = true
      for (const step of rule.actions) {
        if (step.action.type === 'node.enter' || step.action.type === 'node.exit') {
          completedActionStages.set(
            step.id,
            Math.max(completedActionStages.get(step.id) ?? 0, ruleStage),
          )
        }
        if (step.action.type !== 'node.enter') continue
        const target = nodes.get(step.action.nodeId)
        if (!target || !target.visible) continue
        const previousStage = visibleOrRevealed.get(target.id)
        if (previousStage === undefined || ruleStage < previousStage) {
          visibleOrRevealed.set(target.id, ruleStage)
          revealSteps.set(target.id, {
            nodeId: target.id,
            nodeName: target.name,
            ruleId: rule.id,
            actionId: step.id,
            stage: ruleStage,
          })
        }
      }
    }
  }

  const hiddenWithoutRevealNodeIds = initiallyHidden.filter(
    (nodeId) => !visibleOrRevealed.has(nodeId),
  )
  const hiddenSelfTriggeredNodeIds = hiddenWithoutRevealNodeIds.filter((nodeId) => (
    candidateRules.some((rule) => (
      rule.trigger.type === 'node.click' &&
      rule.trigger.nodeId === nodeId &&
      revealActions(rule).some((step) => step.action.type === 'node.enter' && step.action.nodeId === nodeId)
    ))
  ))

  return {
    sceneId: scene.id,
    sceneName: scene.name,
    stateId,
    stateName,
    initialVisibleNodeIds: [...initialVisible],
    initiallyHiddenNodeIds: initiallyHidden,
    reachableRuleIds: [...reachableRules.keys()],
    revealSteps: [...revealSteps.values()].sort((left, right) => (
      left.stage - right.stage || left.nodeId.localeCompare(right.nodeId)
    )),
    hiddenWithoutRevealNodeIds,
    hiddenSelfTriggeredNodeIds,
  }
}

/**
 * Read-only reachability analysis over authored V8 states and interactions.
 * It deliberately reports possibilities, not a simulated teaching session:
 * runtime/media/component events are treated as externally reachable inputs.
 */
export function analyzeInformationRelease(
  project: ProjectDocument,
): InformationReleaseReport {
  const states = project.scenes.flatMap((scene) => {
    const presentation = ensureScenePresentation(scene)
    return presentation.states.map((state) => analyzeState(
      scene,
      state.id,
      state.name,
    ))
  })
  return {
    states,
    summary: {
      stateCount: states.length,
      initiallyHiddenCount: states.reduce(
        (total, state) => total + state.initiallyHiddenNodeIds.length,
        0,
      ),
      revealedCount: states.reduce(
        (total, state) => total + state.revealSteps.length,
        0,
      ),
      hiddenWithoutRevealCount: states.reduce(
        (total, state) => total + state.hiddenWithoutRevealNodeIds.length,
        0,
      ),
      hiddenSelfTriggeredCount: states.reduce(
        (total, state) => total + state.hiddenSelfTriggeredNodeIds.length,
        0,
      ),
    },
  }
}
