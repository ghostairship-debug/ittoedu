/**
 * V8-shaped video authoring diagnostics retained until r11-054.
 * Product truth for these codes is collectCourseProjectControllerMediaHealth.
 */
import {
  ensureScenePresentation,
  materializeScene,
} from './presentation'
import type {
  InteractionRule,
} from './interactionTypes'
import type {
  ProjectDocument,
  VideoNode,
} from './projectTypes'
import type { ProjectHealthCode } from './diagnosticCodes'

export type ProjectDiagnosticCode = Extract<
  ProjectHealthCode,
  'video-click-interaction-conflict' | 'looping-video-ended-unreachable'
>

export interface ProjectDiagnostic {
  severity: 'warning'
  code: ProjectDiagnosticCode
  message: string
  sceneId: string
  sceneName: string
  nodeId: string
  nodeName: string
  ruleIds: string[]
  stateIds: string[]
}

interface MutableDiagnostic {
  severity: 'warning'
  code: ProjectDiagnosticCode
  sceneId: string
  sceneName: string
  nodeId: string
  nodeName: string
  ruleIds: Set<string>
  stateIds: Set<string>
}

function ruleAppliesInState(rule: InteractionRule, stateId: string): boolean {
  return rule.conditions.every((condition) => {
    switch (condition.type) {
      case 'presentation.in':
        return condition.stateIds.includes(stateId)
      case 'course-state.exists':
      case 'course-state.compare':
        return true
    }
  })
}

function addDiagnostic(
  diagnostics: Map<string, MutableDiagnostic>,
  code: ProjectDiagnosticCode,
  scene: ProjectDocument['scenes'][number],
  node: VideoNode,
  rule: InteractionRule,
  stateId: string,
): void {
  const key = `${code}:${scene.id}:${node.id}`
  let diagnostic = diagnostics.get(key)
  if (!diagnostic) {
    diagnostic = {
      severity: 'warning',
      code,
      sceneId: scene.id,
      sceneName: scene.name,
      nodeId: node.id,
      nodeName: node.name,
      ruleIds: new Set(),
      stateIds: new Set(),
    }
    diagnostics.set(key, diagnostic)
  }
  diagnostic.ruleIds.add(rule.id)
  diagnostic.stateIds.add(stateId)
}

function diagnosticMessage(diagnostic: MutableDiagnostic): string {
  const stateCount = diagnostic.stateIds.size
  const ruleCount = diagnostic.ruleIds.size
  if (diagnostic.code === 'video-click-interaction-conflict') {
    return `视频“${diagnostic.nodeName}”在 ${stateCount} 个状态中启用了内置播放点击区，会覆盖该视频的 ${ruleCount} 条元素单击规则。请关闭“点击切换播放/暂停”和画布播放控件，或改用独立按钮触发。`
  }
  return `视频“${diagnostic.nodeName}”在 ${stateCount} 个状态中循环播放，因此其 ${ruleCount} 条“视频播放结束”规则无法由自然播放到达。请关闭循环，或改用视频时间点/运行时事件。`
}

/**
 * Collect non-blocking authoring diagnostics that require comparing effective
 * presentation states with declarative interaction rules. Schema/reference
 * validation remains responsible for malformed or missing references.
 */
export function collectProjectDiagnostics(
  project: Pick<ProjectDocument, 'scenes'>,
): ProjectDiagnostic[] {
  const diagnostics = new Map<string, MutableDiagnostic>()

  for (const scene of project.scenes) {
    const presentation = ensureScenePresentation(scene)
    const relevantRules = scene.interactions.filter((rule) => (
      rule.enabled && (
        rule.trigger.type === 'node.click' ||
        rule.trigger.type === 'video.ended'
      )
    ))
    if (relevantRules.length === 0) continue

    for (const state of presentation.states) {
      const effectiveScene = materializeScene(scene, state.id)
      const videos = new Map(
        effectiveScene.nodes
          .filter((node): node is VideoNode => node.type === 'video')
          .map((node) => [node.id, node]),
      )

      for (const rule of relevantRules) {
        if (!ruleAppliesInState(rule, state.id)) continue
        const trigger = rule.trigger
        if (trigger.type !== 'node.click' && trigger.type !== 'video.ended') continue
        const node = videos.get(trigger.nodeId)
        if (!node?.visible) continue

        if (
          trigger.type === 'node.click' &&
          (node.clickToToggle || node.showControls)
        ) {
          addDiagnostic(
            diagnostics,
            'video-click-interaction-conflict',
            scene,
            node,
            rule,
            state.id,
          )
        } else if (trigger.type === 'video.ended' && node.loop) {
          addDiagnostic(
            diagnostics,
            'looping-video-ended-unreachable',
            scene,
            node,
            rule,
            state.id,
          )
        }
      }
    }
  }

  return [...diagnostics.values()].map((diagnostic) => ({
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnosticMessage(diagnostic),
    sceneId: diagnostic.sceneId,
    sceneName: diagnostic.sceneName,
    nodeId: diagnostic.nodeId,
    nodeName: diagnostic.nodeName,
    ruleIds: [...diagnostic.ruleIds],
    stateIds: [...diagnostic.stateIds],
  }))
}
