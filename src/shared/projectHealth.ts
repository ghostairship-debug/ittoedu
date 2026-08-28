import { collectComponentPackageUsages } from './componentPackageLifecycle'
import { collectProjectDiagnostics } from './projectDiagnostics'
import {
  ensureScenePresentation,
  materializeScene,
} from './presentation'
import type {
  InteractionAction,
  InteractionCondition,
  InteractionRule,
  InteractionTrigger,
} from './interactionTypes'
import { isTerminalNavigationAction } from './interactionTypes'
import { analyzeInformationRelease } from './informationRelease'
import type {
  AssetKind,
  ExternalComponentNode,
  ProjectDocument,
  SceneDocument,
  SceneNode,
  TeacherControllerNode,
} from './projectTypes'
import type { RuntimeDocument } from './runtimeTypes'
import type { ComponentPackageData } from './componentTypes'
import {
  analyzeProjectAssetReferences,
} from './assetReferences'
import type { ProjectHealthCode } from './diagnosticCodes'
import { compareStableStrings } from './stableOrder'
import { hasDeliveryVisibleTeacherController } from './teacherControllerConsistency'

export type ProjectHealthSeverity = 'error' | 'warning' | 'info'
export type ProjectHealthScope =
  | 'project'
  | 'scene'
  | 'state'
  | 'node'
  | 'interaction'
  | 'runtime'
  | 'asset'
  | 'component-package'
  | 'controller'

export interface ProjectHealthLocation {
  scope: ProjectHealthScope
  /** Schema-compatible segments, suitable for selecting the related editor field. */
  path: Array<string | number>
  sceneId?: string
  stateId?: string
  nodeId?: string
  ruleId?: string
  actionIndex?: number
  assetId?: string
  packageId?: string
  packageKey?: string
}

export interface ProjectHealthDiagnostic extends ProjectHealthLocation {
  severity: ProjectHealthSeverity
  code: ProjectHealthCode
  message: string
}

export interface ProjectHealthSummary {
  error: number
  warning: number
  info: number
  total: number
  canExport: boolean
}

interface HealthCollector {
  diagnostics: ProjectHealthDiagnostic[]
  keys: Set<string>
  add(
    severity: ProjectHealthSeverity,
    code: ProjectHealthCode,
    message: string,
    location: ProjectHealthLocation,
  ): void
}

interface RuleScope {
  scene?: SceneDocument
  nodes: Map<string, SceneNode>
  stateIds: Set<string>
  path: Array<string | number>
}

function createCollector(): HealthCollector {
  const diagnostics: ProjectHealthDiagnostic[] = []
  const keys = new Set<string>()
  return {
    diagnostics,
    keys,
    add(severity, code, message, location) {
      const key = JSON.stringify([
        severity,
        code,
        location.path,
        location.sceneId,
        location.stateId,
        location.nodeId,
        location.ruleId,
        location.actionIndex,
        location.assetId,
        location.packageId,
        location.packageKey,
      ])
      if (keys.has(key)) return
      keys.add(key)
      diagnostics.push({ severity, code, message, ...location })
    },
  }
}

function duplicateValues(values: string[]): Set<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  values.forEach((value) => {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  })
  return duplicates
}

function checkAsset(
  project: ProjectDocument,
  collector: HealthCollector,
  assetId: string | null | undefined,
  expectedKind: AssetKind | undefined,
  label: string,
  location: ProjectHealthLocation,
): void {
  if (!assetId) return
  const asset = project.assets[assetId]
  if (!asset) {
    collector.add(
      'error',
      'asset-reference-missing',
      `${label}引用了不存在的素材“${assetId}”。`,
      { ...location, assetId },
    )
    return
  }
  if (expectedKind && asset.kind !== expectedKind) {
    collector.add(
      'error',
      'asset-kind-mismatch',
      `${label}需要${expectedKind}素材，但“${assetId}”实际是 ${asset.kind}。`,
      { ...location, assetId },
    )
  }
}

function checkNodeAssets(
  project: ProjectDocument,
  collector: HealthCollector,
  node: SceneNode,
  location: ProjectHealthLocation,
): void {
  if (node.type === 'image') {
    checkAsset(project, collector, node.assetId, 'image', '图片节点', {
      ...location,
      path: [...location.path, 'assetId'],
    })
    return
  }
  if (node.type !== 'video') return
  checkAsset(project, collector, node.assetId, 'video', '视频节点', {
    ...location,
    path: [...location.path, 'assetId'],
  })
  if (node.poster.mode === 'image') {
    checkAsset(project, collector, node.poster.assetId, 'image', '视频封面', {
      ...location,
      path: [...location.path, 'poster', 'assetId'],
    })
  }
}

function checkRuntime(
  project: ProjectDocument,
  collector: HealthCollector,
  runtime: RuntimeDocument | undefined,
  availableNodeIds: ReadonlySet<string>,
  location: ProjectHealthLocation,
): void {
  if (!runtime) return
  if (runtime.enabled && !runtime.staticFallback) {
    collector.add(
      'warning',
      'runtime-static-fallback-missing',
      '已启用的运行时没有 staticFallback，静态导出、缩略图或运行时失败时可能无可用画面。',
      { ...location, path: [...location.path, 'staticFallback'] },
    )
  }
  for (const [bindingKey, binding] of Object.entries(runtime.assets)) {
    checkAsset(project, collector, binding.assetId, undefined, '运行时素材绑定', {
      ...location,
      path: [...location.path, 'assets', bindingKey, 'assetId'],
    })
  }
  if (runtime.staticFallback) {
    checkAsset(
      project,
      collector,
      runtime.staticFallback.assetId,
      'image',
      '运行时静态兜底',
      { ...location, path: [...location.path, 'staticFallback', 'assetId'] },
    )
  }
  for (const [bindingKey, nodeId] of Object.entries(runtime.nodeBindings ?? {})) {
    if (availableNodeIds.has(nodeId)) continue
    collector.add(
      'error',
      'runtime-node-reference-missing',
      `运行时节点绑定“${bindingKey}”引用了不存在的节点“${nodeId}”。`,
      {
        ...location,
        nodeId,
        path: [...location.path, 'nodeBindings', bindingKey],
      },
    )
  }
}

function checkComponentNode(
  project: ProjectDocument,
  collector: HealthCollector,
  node: ExternalComponentNode,
  location: ProjectHealthLocation,
): void {
  const packages = Object.entries(project.componentPackages).filter(
    ([, meta]) => meta.packageId === node.component.packageId,
  )
  const exact = packages.find(([, meta]) => meta.version === node.component.version)
  if (exact) return
  if (packages.length === 0) {
    collector.add(
      'error',
      'component-package-missing',
      `组件实例“${node.name}”引用了未导入的组件包“${node.component.packageId}”。`,
      {
        ...location,
        packageId: node.component.packageId,
        path: [...location.path, 'component'],
      },
    )
    return
  }
  collector.add(
    'error',
    'component-version-missing',
    `组件实例“${node.name}”要求 ${node.component.packageId}@${node.component.version}，工程中仅有版本 ${packages.map(([, meta]) => meta.version).join('、')}。`,
    {
      ...location,
      packageId: node.component.packageId,
      path: [...location.path, 'component', 'version'],
    },
  )
}

function checkController(
  project: ProjectDocument,
  collector: HealthCollector,
  node: TeacherControllerNode,
  location: ProjectHealthLocation,
): void {
  for (const buttonId of duplicateValues(node.buttons.map((button) => button.id))) {
    collector.add(
      'error',
      'controller-button-id-duplicate',
      `控制器“${node.name}”含有重复按钮 ID“${buttonId}”。`,
      { ...location, path: [...location.path, 'buttons'] },
    )
  }
  node.buttons.forEach((button, buttonIndex) => {
    const action = button.action
    if (action.type !== 'scene.go') return
    const targetScene = project.scenes.find((scene) => scene.id === action.sceneId)
    const buttonLocation = {
      ...location,
      path: [...location.path, 'buttons', buttonIndex, 'action'],
    }
    if (!targetScene) {
      collector.add(
        'error',
        'controller-scene-target-missing',
        `控制器按钮“${button.label}”指向了不存在的场景“${action.sceneId}”。`,
        buttonLocation,
      )
      return
    }
    if (
      action.targetStateId &&
      !ensureScenePresentation(targetScene).states.some(
        (state) => state.id === action.targetStateId,
      )
    ) {
      collector.add(
        'error',
        'controller-state-target-missing',
        `控制器按钮“${button.label}”指向了场景“${targetScene.name}”中不存在的状态“${action.targetStateId}”。`,
        { ...buttonLocation, sceneId: targetScene.id, stateId: action.targetStateId },
      )
    }
  })
}

function addMissingNodeReference(
  collector: HealthCollector,
  scope: RuleScope,
  rule: InteractionRule,
  nodeId: string,
  expectedType: SceneNode['type'] | undefined,
  path: Array<string | number>,
): void {
  const node = scope.nodes.get(nodeId)
  const location: ProjectHealthLocation = {
    scope: 'interaction',
    path,
    sceneId: scope.scene?.id,
    nodeId,
    ruleId: rule.id,
  }
  if (!node) {
    collector.add(
      'error',
      'interaction-node-reference-missing',
      `交互规则“${rule.name ?? rule.id}”引用了不存在的节点“${nodeId}”。`,
      location,
    )
  } else if (expectedType && node.type !== expectedType) {
    collector.add(
      'error',
      'interaction-node-type-mismatch',
      `交互规则“${rule.name ?? rule.id}”要求 ${expectedType} 节点，但“${node.name}”实际是 ${node.type}。`,
      location,
    )
  }
}

function checkSoundReference(
  project: ProjectDocument,
  collector: HealthCollector,
  rule: InteractionRule,
  soundId: string,
  location: ProjectHealthLocation,
): void {
  if (project.media.audio.sounds[soundId]) return
  collector.add(
    'error',
    'interaction-sound-reference-missing',
    `交互规则“${rule.name ?? rule.id}”引用了不存在的声音“${soundId}”。`,
    location,
  )
}

function checkTrigger(
  project: ProjectDocument,
  collector: HealthCollector,
  rule: InteractionRule,
  trigger: InteractionTrigger,
  scope: RuleScope,
  rulePath: Array<string | number>,
  motionActionIds: ReadonlySet<string>,
): void {
  const path = [...rulePath, 'trigger']
  if (trigger.type === 'node.click' || trigger.type === 'node.activated') {
    addMissingNodeReference(collector, scope, rule, trigger.nodeId, undefined, path)
  } else if (trigger.type === 'component.event') {
    addMissingNodeReference(
      collector,
      scope,
      rule,
      trigger.nodeId,
      'external-component',
      path,
    )
  } else if (trigger.type.startsWith('video.')) {
    addMissingNodeReference(
      collector,
      scope,
      rule,
      (trigger as Extract<InteractionTrigger, { nodeId: string }>).nodeId,
      'video',
      path,
    )
  } else if (trigger.type === 'audio.ended') {
    checkSoundReference(project, collector, rule, trigger.soundId, {
      scope: 'interaction',
      path,
      sceneId: scope.scene?.id,
      ruleId: rule.id,
    })
  } else if (trigger.type === 'presentation.enter' && !scope.stateIds.has(trigger.stateId)) {
    collector.add(
      'error',
      'interaction-state-reference-missing',
      `交互规则“${rule.name ?? rule.id}”引用了不存在的状态“${trigger.stateId}”。`,
      {
        scope: 'interaction',
        path,
        sceneId: scope.scene?.id,
        stateId: trigger.stateId,
        ruleId: rule.id,
      },
    )
  } else if (
    trigger.type === 'animation.completed' &&
    !motionActionIds.has(trigger.actionId)
  ) {
    collector.add(
      'error',
      'interaction-action-reference-missing',
      `交互规则“${rule.name ?? rule.id}”引用了不存在的动画动作“${trigger.actionId}”。`,
      {
        scope: 'interaction',
        path,
        sceneId: scope.scene?.id,
        ruleId: rule.id,
      },
    )
  }
}

function checkCondition(
  project: ProjectDocument,
  collector: HealthCollector,
  rule: InteractionRule,
  condition: InteractionCondition,
  scope: RuleScope,
  path: Array<string | number>,
): void {
  if (condition.type === 'scene.in') {
    const sceneIds = new Set(project.scenes.map((scene) => scene.id))
    condition.sceneIds.forEach((sceneId) => {
      if (sceneIds.has(sceneId)) return
      collector.add(
        'error',
        'interaction-scene-reference-missing',
        `交互规则“${rule.name ?? rule.id}”的条件引用了不存在的场景“${sceneId}”。`,
        { scope: 'interaction', path, sceneId, ruleId: rule.id },
      )
    })
    return
  }
  if (condition.type !== 'presentation.in') return
  condition.stateIds.forEach((stateId) => {
    if (scope.stateIds.has(stateId)) return
    collector.add(
      'error',
      'interaction-state-reference-missing',
      `交互规则“${rule.name ?? rule.id}”的条件引用了不存在的状态“${stateId}”。`,
      {
        scope: 'interaction',
        path,
        sceneId: scope.scene?.id,
        stateId,
        ruleId: rule.id,
      },
    )
  })
}

function globalRuleScenes(
  project: ProjectDocument,
  rule: InteractionRule,
): SceneDocument[] {
  const sceneConditions = rule.conditions.filter(
    (condition): condition is Extract<InteractionCondition, { type: 'scene.in' }> =>
      condition.type === 'scene.in',
  )
  if (sceneConditions.length === 0) return project.scenes
  return project.scenes.filter((scene) => sceneConditions.every(
    (condition) => condition.sceneIds.includes(scene.id),
  ))
}

function checkAction(
  project: ProjectDocument,
  collector: HealthCollector,
  rule: InteractionRule,
  action: InteractionAction,
  scope: RuleScope,
  actionIndex: number,
  path: Array<string | number>,
): void {
  const location: ProjectHealthLocation = {
    scope: 'interaction',
    path,
    sceneId: scope.scene?.id,
    ruleId: rule.id,
    actionIndex,
  }
  if (action.type === 'presentation.set') {
    if (!scope.scene) {
      const possibleScenes = globalRuleScenes(project, rule)
      const invalidScenes = possibleScenes.filter((scene) => (
        !ensureScenePresentation(scene).states.some((state) => state.id === action.stateId)
      ))
      if (possibleScenes.length > 0 && invalidScenes.length === possibleScenes.length) {
        collector.add(
          'error',
          'interaction-state-reference-missing',
          `全局交互规则“${rule.name ?? rule.id}”要切换到不存在的状态“${action.stateId}”。`,
          { ...location, stateId: action.stateId },
        )
      } else if (invalidScenes.length > 0) {
        collector.add(
          'warning',
          'global-interaction-state-target-partial',
          `全局交互规则“${rule.name ?? rule.id}”的目标状态“${action.stateId}”在 ${invalidScenes.map((scene) => `“${scene.name}”`).join('、')} 中不存在，请用“当前场景”条件缩小作用域。`,
          { ...location, stateId: action.stateId },
        )
      }
    } else if (!scope.stateIds.has(action.stateId)) {
      collector.add(
        'error',
        'interaction-state-reference-missing',
        `交互规则“${rule.name ?? rule.id}”要切换到不存在的状态“${action.stateId}”。`,
        { ...location, stateId: action.stateId },
      )
    }
    return
  }
  if (action.type === 'scene.go') {
    const targetScene = project.scenes.find((scene) => scene.id === action.sceneId)
    if (!targetScene) {
      collector.add(
        'error',
        'interaction-scene-reference-missing',
        `交互规则“${rule.name ?? rule.id}”要跳转到不存在的场景“${action.sceneId}”。`,
        { ...location, sceneId: action.sceneId },
      )
    } else if (
      action.targetStateId &&
      !ensureScenePresentation(targetScene).states.some(
        (state) => state.id === action.targetStateId,
      )
    ) {
      collector.add(
        'error',
        'interaction-state-reference-missing',
        `交互规则“${rule.name ?? rule.id}”要跳转到场景“${targetScene.name}”中不存在的状态“${action.targetStateId}”。`,
        { ...location, sceneId: targetScene.id, stateId: action.targetStateId },
      )
    }
    return
  }
  if (action.type === 'audio.play') {
    checkSoundReference(project, collector, rule, action.soundId, location)
    return
  }
  if (
    (action.type === 'audio.pause' ||
      action.type === 'audio.resume' ||
      action.type === 'audio.stop' ||
      action.type === 'audio.toggle-mute') &&
    action.target.kind === 'sound'
  ) {
    checkSoundReference(project, collector, rule, action.target.soundId, location)
    return
  }
  if (action.type.startsWith('video.')) {
    addMissingNodeReference(
      collector,
      scope,
      rule,
      (action as Extract<InteractionAction, { nodeId: string }>).nodeId,
      'video',
      path,
    )
    return
  }
  if (action.type === 'node.enter' || action.type === 'node.exit') {
    addMissingNodeReference(
      collector,
      scope,
      rule,
      action.nodeId,
      undefined,
      path,
    )
  }
}

function checkRules(
  project: ProjectDocument,
  collector: HealthCollector,
  rules: InteractionRule[],
  scope: RuleScope,
): void {
  for (const duplicate of duplicateValues(rules.map((rule) => rule.id))) {
    collector.add(
      'error',
      'interaction-rule-id-duplicate',
      `交互规则 ID“${duplicate}”重复。`,
      {
        scope: 'interaction',
        path: scope.path,
        sceneId: scope.scene?.id,
        ruleId: duplicate,
      },
    )
  }
  const allActionIds = rules.flatMap((rule) => rule.actions.map((step) => step.id))
  const motionActionIds = new Set(rules.flatMap((rule) => rule.actions
    .filter((step) => step.action.type === 'node.enter' || step.action.type === 'node.exit')
    .map((step) => step.id)))
  for (const duplicate of duplicateValues(allActionIds)) {
    collector.add(
      'error',
      'interaction-action-id-duplicate',
      `动作 ID“${duplicate}”在同一交互作用域中重复。`,
      {
        scope: 'interaction',
        path: scope.path,
        sceneId: scope.scene?.id,
      },
    )
  }
  rules.forEach((rule, ruleIndex) => {
    const rulePath = [...scope.path, ruleIndex]
    checkTrigger(project, collector, rule, rule.trigger, scope, rulePath, motionActionIds)
    const completedActionId = rule.trigger.type === 'animation.completed'
      ? rule.trigger.actionId
      : undefined
    if (
      completedActionId !== undefined &&
      rule.actions.some((step) => (
        step.id === completedActionId &&
        (step.action.type === 'node.enter' || step.action.type === 'node.exit')
      ))
    ) {
      collector.add(
        'warning',
        'interaction-animation-self-loop',
        `交互规则“${rule.name ?? rule.id}”会由自身动画完成再次触发，可能形成循环。`,
        {
          scope: 'interaction',
          path: [...rulePath, 'trigger'],
          sceneId: scope.scene?.id,
          ruleId: rule.id,
        },
      )
    }
    rule.conditions.forEach((condition, conditionIndex) => checkCondition(
      project,
      collector,
      rule,
      condition,
      scope,
      [...rulePath, 'conditions', conditionIndex],
    ))
    rule.actions.forEach((step, actionIndex) => {
      if (
        isTerminalNavigationAction(step.action) &&
        (actionIndex !== rule.actions.length - 1 || step.start !== 'after-previous')
      ) {
        collector.add(
          'error',
          'interaction-navigation-not-terminal',
          '场景导航、重播或重开动作必须是最后一个独立动作组。',
          {
            scope: 'interaction',
            path: [...rulePath, 'actions', actionIndex],
            sceneId: scope.scene?.id,
            ruleId: rule.id,
            actionIndex,
          },
        )
      }
      checkAction(
        project,
        collector,
        rule,
        step.action,
        scope,
        actionIndex,
        [...rulePath, 'actions', actionIndex, 'action'],
      )
      if (step.action.type === 'node.enter' && rule.trigger.type !== 'node.activated') {
        const enterNodeId = step.action.nodeId
        const target = scope.nodes.get(enterNodeId)
        const hiddenEarlier = rule.actions.slice(0, actionIndex).some((earlier) => (
          earlier.action.type === 'node.exit' &&
          earlier.action.nodeId === enterNodeId
        ))
        if (
          target?.visible &&
          target.playbackInitialVisibility === 'inherit' &&
          !hiddenEarlier
        ) {
          collector.add(
            'warning',
            'interaction-enter-target-initially-visible',
            `元素“${target.name}”在入场动作触发前已默认显示；如需等待事件后出现，请将播放初始状态设为隐藏。`,
            {
              scope: 'interaction',
              path: [...rulePath, 'actions', actionIndex, 'action'],
              sceneId: scope.scene?.id,
              nodeId: target.id,
              ruleId: rule.id,
              actionIndex,
            },
          )
        }
      }
    })
  })
}

function checkScene(
  project: ProjectDocument,
  collector: HealthCollector,
  scene: SceneDocument,
  sceneIndex: number,
): void {
  const scenePath: Array<string | number> = ['scenes', sceneIndex]
  const presentation = ensureScenePresentation(scene)
  const stateIds = new Set(presentation.states.map((state) => state.id))
  const nodeIds = new Set(scene.nodes.map((node) => node.id))

  for (const duplicate of duplicateValues(scene.nodes.map((node) => node.id))) {
    collector.add(
      'error',
      'node-id-duplicate',
      `场景“${scene.name}”含有重复节点 ID“${duplicate}”。`,
      { scope: 'scene', path: [...scenePath, 'nodes'], sceneId: scene.id, nodeId: duplicate },
    )
  }
  for (const duplicate of duplicateValues(presentation.states.map((state) => state.id))) {
    collector.add(
      'error',
      'state-id-duplicate',
      `场景“${scene.name}”含有重复状态 ID“${duplicate}”。`,
      {
        scope: 'scene',
        path: [...scenePath, 'presentation', 'states'],
        sceneId: scene.id,
        stateId: duplicate,
      },
    )
  }
  if (!stateIds.has(scene.presentation?.initialStateId ?? presentation.initialStateId)) {
    collector.add(
      'error',
      'initial-state-reference-missing',
      `场景“${scene.name}”的初始状态不存在。`,
      {
        scope: 'scene',
        path: [...scenePath, 'presentation', 'initialStateId'],
        sceneId: scene.id,
        stateId: scene.presentation?.initialStateId,
      },
    )
  }
  if (scene.presentation?.thumbnailStateId && !stateIds.has(scene.presentation.thumbnailStateId)) {
    collector.add(
      'error',
      'thumbnail-state-reference-missing',
      `场景“${scene.name}”的缩略图状态“${scene.presentation.thumbnailStateId}”不存在。`,
      {
        scope: 'scene',
        path: [...scenePath, 'presentation', 'thumbnailStateId'],
        sceneId: scene.id,
        stateId: scene.presentation.thumbnailStateId,
      },
    )
  }

  presentation.states.forEach((state, stateIndex) => {
    const statePath = [...scenePath, 'presentation', 'states', stateIndex]
    for (const nodeId of Object.keys(state.nodeOverrides)) {
      if (nodeIds.has(nodeId)) continue
      collector.add(
        'error',
        'state-node-reference-missing',
        `状态“${state.name}”的覆盖引用了不存在的节点“${nodeId}”。`,
        {
          scope: 'state',
          path: [...statePath, 'nodeOverrides', nodeId],
          sceneId: scene.id,
          stateId: state.id,
          nodeId,
        },
      )
    }
    for (const nodeId of state.nodeOrder ?? []) {
      if (nodeIds.has(nodeId)) continue
      collector.add(
        'error',
        'state-node-reference-missing',
        `状态“${state.name}”的层级顺序引用了不存在的节点“${nodeId}”。`,
        {
          scope: 'state',
          path: [...statePath, 'nodeOrder'],
          sceneId: scene.id,
          stateId: state.id,
          nodeId,
        },
      )
    }

    const effectiveScene = materializeScene(scene, state.id)
    checkAsset(project, collector, effectiveScene.backgroundAssetId, 'image', '场景背景', {
      scope: 'state',
      path: [...statePath, 'backgroundAssetId'],
      sceneId: scene.id,
      stateId: state.id,
    })
    effectiveScene.nodes.forEach((node, nodeIndex) => checkNodeAssets(
      project,
      collector,
      node,
      {
        scope: 'node',
        path: [...scenePath, 'nodes', nodeIndex],
        sceneId: scene.id,
        stateId: state.id,
        nodeId: node.id,
      },
    ))
  })

  scene.nodes.forEach((node, nodeIndex) => {
    const location: ProjectHealthLocation = {
      scope: node.type === 'teacher-controller' ? 'controller' : 'node',
      path: [...scenePath, 'nodes', nodeIndex],
      sceneId: scene.id,
      nodeId: node.id,
    }
    if (node.type === 'external-component') {
      checkComponentNode(project, collector, node, location)
    } else if (node.type === 'teacher-controller') {
      checkController(project, collector, node, location)
    }
  })
  checkRuntime(project, collector, scene.runtime, nodeIds, {
    scope: 'runtime',
    path: [...scenePath, 'runtime'],
    sceneId: scene.id,
  })
  checkRules(project, collector, scene.interactions, {
    scene,
    nodes: new Map(scene.nodes.map((node) => [node.id, node])),
    stateIds,
    path: [...scenePath, 'interactions'],
  })
}

function checkPackages(project: ProjectDocument, collector: HealthCollector): void {
  for (const [packageKey, meta] of Object.entries(project.componentPackages)) {
    const location: ProjectHealthLocation = {
      scope: 'component-package',
      path: ['componentPackages', packageKey],
      packageId: meta.packageId,
      packageKey,
    }
    if (!meta.thumbnailPath) {
      collector.add(
        'warning',
        'component-thumbnail-missing',
        `组件包“${meta.name}”没有缩略图，组件库只能显示通用占位图。`,
        { ...location, path: [...location.path, 'thumbnailPath'] },
      )
    }
    if (!meta.sha256) {
      collector.add(
        'warning',
        'component-package-hash-missing',
        `组件包“${meta.name}”没有锁定 SHA-256；无法证明导出时执行的仍是导入时审阅的字节。`,
        { ...location, path: [...location.path, 'sha256'] },
      )
    }
    if (!meta.sourceLabel) {
      collector.add(
        'info',
        'component-package-source-missing',
        `组件包“${meta.name}”没有可读来源记录，后续审阅和更新难以追溯。`,
        { ...location, path: [...location.path, 'sourceLabel'] },
      )
    }
  }
  collectComponentPackageUsages(project)
    .filter((usage) => usage.packageKeys.length > 0 && usage.totalInstanceCount === 0)
    .forEach((usage) => collector.add(
      'info',
      'component-package-unused',
      `组件包“${usage.packageId}”当前没有任何场景或全局实例引用。`,
      {
        scope: 'component-package',
        path: ['componentPackages', usage.packageKeys[0]!],
        packageId: usage.packageId,
        packageKey: usage.packageKeys[0],
      },
    ))
}

function checkPresenter(project: ProjectDocument, collector: HealthCollector): void {
  const presenter = project.playback.presenter
  const presenterRules = [
    ...project.globalInteractions,
    ...project.scenes.flatMap((scene) => scene.interactions),
  ].filter((rule) => rule.enabled && rule.trigger.type === 'presenter.command')
  const commandRules = new Set(presenterRules.map((rule) => (
    rule.trigger.type === 'presenter.command' ? rule.trigger.command : null
  )))

  if (!presenter.enabled && presenterRules.length > 0) {
    collector.add(
      'warning',
      'presenter-rules-disabled',
      `工程含有 ${presenterRules.length} 条演示命令规则，但翻页笔输入已关闭，这些规则不会由演示按键触发。`,
      { scope: 'project', path: ['playback', 'presenter', 'enabled'] },
    )
  }
  if (presenter.enabled && presenter.strategy === 'authored-command') {
    ;(['next', 'previous'] as const).forEach((command) => {
      if (commandRules.has(command)) return
      collector.add(
        'warning',
        'presenter-command-unhandled',
        `翻页笔使用“作者命令”模式，但没有启用的“${command === 'next' ? '下一步' : '上一步'}”规则；对应按键会给出未处理提示。`,
        { scope: 'project', path: ['playback', 'presenter', 'strategy'] },
      )
    })
  }
  if (presenter.enabled && presenter.strategy === 'scene-navigation' && presenterRules.length > 0) {
    collector.add(
      'info',
      'presenter-rules-bypassed',
      '翻页笔当前使用“直接切换场景”模式，presenter.command 规则不会由翻页笔触发。',
      { scope: 'project', path: ['playback', 'presenter', 'strategy'] },
    )
  }
  presenter.additionalBindings.forEach((binding, index) => {
    if (binding.key !== 'F5') return
    collector.add(
      'warning',
      'presenter-f5-browser-reserved',
      'F5 通常由浏览器或系统用于刷新，发布环境可能先截获该按键；建议改用翻页笔实际发送的其他键。',
      {
        scope: 'project',
        path: ['playback', 'presenter', 'additionalBindings', index, 'key'],
      },
    )
  })
}

function checkControllerConsistency(
  project: ProjectDocument,
  collector: HealthCollector,
): void {
  const hasVisibleController = hasDeliveryVisibleTeacherController(project)
  if (project.playback.controls === 'canvas' && !hasVisibleController) {
    collector.add(
      'error',
      'controller-required-for-canvas',
      '成品已启用画布控制，但没有任何交付时可见的全局教师控制器。',
      { scope: 'project', path: ['playback', 'controls'] },
    )
  }
  if (project.playback.controls === 'none' && hasVisibleController) {
    collector.add(
      'error',
      'controller-visible-while-disabled',
      '成品设置为不显示控制器，但全局层仍有交付时可见的教师控制器。',
      { scope: 'project', path: ['playback', 'controls'] },
    )
  }
}

function checkInformationRelease(
  project: ProjectDocument,
  collector: HealthCollector,
): void {
  const report = analyzeInformationRelease(project)
  report.states.forEach((state) => {
    const sceneIndex = project.scenes.findIndex(({ id }) => id === state.sceneId)
    const scene = project.scenes[sceneIndex]
    if (!scene) return
    state.hiddenWithoutRevealNodeIds.forEach((nodeId) => {
      const nodeIndex = scene.nodes.findIndex((node) => node.id === nodeId)
      const node = scene.nodes[nodeIndex]
      if (!node) return
      const selfTriggered = state.hiddenSelfTriggeredNodeIds.includes(nodeId)
      collector.add(
        'warning',
        selfTriggered
          ? 'information-release-hidden-self-trigger'
          : 'information-release-hidden-unreachable',
        selfTriggered
          ? `状态“${state.stateName}”中的节点“${node.name}”初始隐藏，却只能通过点击自身显示；运行时无法完成这次点击。`
          : `状态“${state.stateName}”中的节点“${node.name}”初始隐藏，但没有从当前可达触发器通向它的显示动作。`,
        {
          scope: 'node',
          path: ['scenes', sceneIndex, 'nodes', nodeIndex, 'playbackInitialVisibility'],
          sceneId: scene.id,
          stateId: state.stateId,
          nodeId,
        },
      )
    })
  })
}

/**
 * Performs non-mutating, author-facing integrity checks on an already loaded
 * project. Unlike schema parsing, every issue is retained and carries enough
 * location data for an editor to navigate to the affected object.
 */
export function collectProjectHealth(
  project: ProjectDocument,
  componentPackages?: Readonly<Record<string, ComponentPackageData>>,
): ProjectHealthDiagnostic[] {
  const collector = createCollector()
  const sceneIds = new Set(project.scenes.map((scene) => scene.id))
  if (project.scenes.length === 0) {
    collector.add(
      'error',
      'scene-required',
      '工程至少需要一个场景。',
      { scope: 'project', path: ['scenes'] },
    )
  }
  for (const duplicate of duplicateValues(project.scenes.map((scene) => scene.id))) {
    collector.add(
      'error',
      'scene-id-duplicate',
      `工程含有重复场景 ID“${duplicate}”。`,
      { scope: 'project', path: ['scenes'], sceneId: duplicate },
    )
  }

  project.scenes.forEach((scene, sceneIndex) => checkScene(
    project,
    collector,
    scene,
    sceneIndex,
  ))

  const globalNodes = new Map(project.globalLayer.map((item) => [item.node.id, item.node]))
  for (const duplicate of duplicateValues(project.globalLayer.map((item) => item.node.id))) {
    collector.add(
      'error',
      'global-node-id-duplicate',
      `全局层含有重复节点 ID“${duplicate}”。`,
      { scope: 'project', path: ['globalLayer'], nodeId: duplicate },
    )
  }
  project.globalLayer.forEach((item, itemIndex) => {
    const nodePath: Array<string | number> = ['globalLayer', itemIndex, 'node']
    item.visibility.sceneIds.forEach((sceneId) => {
      if (sceneIds.has(sceneId)) return
      collector.add(
        'error',
        'global-visibility-scene-reference-missing',
        `全局节点“${item.node.name}”的可见范围引用了不存在的场景“${sceneId}”。`,
        {
          scope: 'node',
          path: ['globalLayer', itemIndex, 'visibility', 'sceneIds'],
          sceneId,
          nodeId: item.node.id,
        },
      )
    })
    checkNodeAssets(project, collector, item.node, {
      scope: 'node',
      path: nodePath,
      nodeId: item.node.id,
    })
    if (item.node.type === 'external-component') {
      checkComponentNode(project, collector, item.node, {
        scope: 'node',
        path: nodePath,
        nodeId: item.node.id,
      })
    } else if (item.node.type === 'teacher-controller') {
      checkController(project, collector, item.node, {
        scope: 'controller',
        path: nodePath,
        nodeId: item.node.id,
      })
    }
  })
  checkRuntime(project, collector, project.globalRuntime, new Set(globalNodes.keys()), {
    scope: 'runtime',
    path: ['globalRuntime'],
  })

  const allStateIds = new Set(project.scenes.flatMap(
    (scene) => ensureScenePresentation(scene).states.map((state) => state.id),
  ))
  checkRules(project, collector, project.globalInteractions, {
    nodes: globalNodes,
    stateIds: allStateIds,
    path: ['globalInteractions'],
  })

  for (const [soundKey, sound] of Object.entries(project.media.audio.sounds)) {
    if (sound.id !== soundKey) {
      collector.add(
        'error',
        'sound-id-mismatch',
        `声音记录键“${soundKey}”与内部 ID“${sound.id}”不一致。`,
        { scope: 'asset', path: ['media', 'audio', 'sounds', soundKey, 'id'] },
      )
    }
    checkAsset(project, collector, sound.assetId, 'audio', `声音“${sound.name}”`, {
      scope: 'asset',
      path: ['media', 'audio', 'sounds', soundKey, 'assetId'],
      assetId: sound.assetId,
    })
  }

  const assetReferenceAnalysis = analyzeProjectAssetReferences(project, {
    componentPackages,
  })
  for (const [assetId, references] of assetReferenceAnalysis.graph) {
    if (project.assets[assetId] || Object.values(project.assets).some((asset) => asset.id === assetId)) {
      continue
    }
    references
      .filter((reference) => reference.certainty === 'direct')
      .forEach((reference) => collector.add(
        'error',
        'asset-reference-missing',
        `组件或运行位置引用了不存在的素材“${assetId}”。`,
        {
          scope: reference.packageId ? 'component-package' : 'asset',
          path: reference.path,
          assetId,
          ...(reference.sceneId ? { sceneId: reference.sceneId } : {}),
          ...(reference.stateId ? { stateId: reference.stateId } : {}),
          ...(reference.nodeId ? { nodeId: reference.nodeId } : {}),
          ...(reference.packageId ? { packageId: reference.packageId } : {}),
        },
      ))
  }
  assetReferenceAnalysis.missingComponentContexts.forEach((missing) => collector.add(
    'warning',
    'asset-reference-analysis-incomplete',
    `组件“${missing.packageId}@${missing.version}”缺少可执行包上下文；素材引用分析已保守降级，删除不会因此放行。`,
    {
      scope: 'component-package',
      path: missing.path,
      packageId: missing.packageId,
      nodeId: missing.nodeId,
      ...(missing.sceneId ? { sceneId: missing.sceneId } : {}),
      ...(missing.stateId ? { stateId: missing.stateId } : {}),
    },
  ))
  const referencedAssetIds = new Set(assetReferenceAnalysis.graph.keys())
  for (const [assetKey, asset] of Object.entries(project.assets)) {
    if (referencedAssetIds.has(assetKey) || referencedAssetIds.has(asset.id)) continue
    collector.add(
      'info',
      'asset-unused',
      `素材“${asset.filename}”当前没有任何工程引用（${asset.byteLength} 字节）。`,
      {
        scope: 'asset',
        path: ['assets', assetKey],
        assetId: asset.id,
      },
    )
  }

  checkPackages(project, collector)
  checkControllerConsistency(project, collector)
  checkPresenter(project, collector)
  checkInformationRelease(project, collector)
  collectProjectDiagnostics(project).forEach((diagnostic) => collector.add(
    'warning',
    diagnostic.code,
    diagnostic.message,
    {
      scope: 'interaction',
      path: ['scenes', project.scenes.findIndex((scene) => scene.id === diagnostic.sceneId), 'interactions'],
      sceneId: diagnostic.sceneId,
      nodeId: diagnostic.nodeId,
      ruleId: diagnostic.ruleIds[0],
      stateId: diagnostic.stateIds[0],
    },
  ))

  const severityOrder: Record<ProjectHealthSeverity, number> = {
    error: 0,
    warning: 1,
    info: 2,
  }
  return collector.diagnostics.sort((left, right) => (
    severityOrder[left.severity] - severityOrder[right.severity] ||
    compareStableStrings(JSON.stringify(left.path), JSON.stringify(right.path)) ||
    compareStableStrings(left.code, right.code)
  ))
}

export function summarizeProjectHealth(
  diagnostics: readonly ProjectHealthDiagnostic[],
): ProjectHealthSummary {
  const summary: ProjectHealthSummary = {
    error: 0,
    warning: 0,
    info: 0,
    total: diagnostics.length,
    canExport: true,
  }
  diagnostics.forEach((diagnostic) => {
    summary[diagnostic.severity] += 1
  })
  summary.canExport = summary.error === 0
  return summary
}
