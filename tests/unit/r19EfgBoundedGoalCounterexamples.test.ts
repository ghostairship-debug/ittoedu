/**
 * R19 E/F/G 批次 · G 工作包免费反例检查（不消耗模型额度）。
 *
 * 覆盖方案 6.1 的三类已知失败，全部基于当前已存在 API：
 * 1. 状态切换在 Player 未执行的反例——真实 PublishedInteractionController 绑定路径：
 *    不支持的 presentation.set 组合在绑定时整规则拒绝并给出具体原因，点击零执行。
 * 2. step.next vs scene.next 目的地语义——真实课例 fixture（ARCH-0 slide-heavy，
 *    即有界共同目标任务包副本的源）经正式 Published payload 构建播放序列。
 * 3. 只预检未交付的识别——宿主结果合同与任务守卫：prechecked 不是宿主结果；
 *    checked（只预检）不能声明提交后行为、不能完成任务。
 *
 * 待 E/F 落地后启用（本文件不覆盖，见 output/r19-efg-coordination/bounded-goal/）：
 * - 真实宿主点击穿透：实际 Electron/Player 中点击标题与标注，核对真实 locationId/stateId；
 * - 正式交付链：模型候选经 canonical 事务 committed 后保存重开再核对 R1–R5。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import { PublishedInteractionController } from '@/player/interactions/PublishedInteractionController'
import type {
  PublishedInteractionDiagnostic,
  PublishedInteractionSessionPort,
  PublishedInteractionSurfacePort,
} from '@/player/interactions/PublishedInteractionSurfacePort'
import { CourseStateStore } from '@/player/CourseStateStore'
import type {
  InteractionActionPayload,
  InteractionActionStep,
  InteractionCondition,
  InteractionRule,
} from '@/shared/contracts/interaction-v1/types'
import { publishedPresentationSetUnsupportedReason } from '@/shared/publishedInteractionSupport'
import { openCourseProjectArchive } from '@/renderer/project/courseProjectArchive'
import { componentPackagesFromArchive } from '@/renderer/components/componentPackageStore'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import {
  adjacentPlaybackTarget,
  buildCoursePlaybackSequence,
  playbackNavigationProgress,
} from '@/player/navigation/coursePlaybackSequence'
import {
  aiHostResultSchema,
  aiObservationSchema,
  aiProposalSchema,
  aiTaskSchema,
} from '@/shared/localAgentTaskContract'
import { acceptAiHostResult } from '@/shared/localAgentTaskGuards'

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', 'fixtures', 'architecture-baseline', 'slide-heavy.h5lesson',
)

function actionStep(
  id: string,
  action: InteractionActionPayload,
  options: Partial<Pick<InteractionActionStep, 'start' | 'delayMs'>> = {},
): InteractionActionStep {
  return { id, start: options.start ?? 'after-previous', delayMs: options.delayMs ?? 0, action }
}

function clickRule(
  id: string,
  nodeId: string,
  actions: InteractionActionStep[],
  conditions: InteractionCondition[] = [],
): InteractionRule {
  return { id, enabled: true, trigger: { type: 'node.click', nodeId }, conditions, actions }
}

function surfaceHarness() {
  const listeners = new Map<string, () => void>()
  const surface: PublishedInteractionSurfacePort = {
    bindNodeClick: (nodeId, listener) => {
      listeners.set(nodeId, listener)
      return () => listeners.delete(nodeId)
    },
    executeNodeMotion: () => true,
  }
  return { surface, listeners }
}

function sessionHarness(initialSceneId: string | null = 'slide-scene-intro') {
  let sceneId = initialSceneId
  const goToScene = vi.fn((_target: string, _state: string | undefined, _signal: AbortSignal) => true)
  const session: PublishedInteractionSessionPort = {
    courseState: new CourseStateStore(),
    currentSceneId: () => sceneId,
    executeAudioAction: () => true,
    bindAudioEnded: () => () => undefined,
    goToScene,
    nextScene: () => true,
    previousScene: () => true,
    replayScene: () => true,
    restartCourse: () => true,
  }
  return { session, goToScene, setSceneId: (next: string | null) => { sceneId = next } }
}

describe('反例 1：状态切换在 Player 未执行——绑定期整规则拒绝并给出具体原因', () => {
  it('满足支持条件的 presentation.set 真实执行：点击后按当前场景切换状态', async () => {
    const host = surfaceHarness()
    const navigation = sessionHarness('slide-scene-intro')
    const diagnostics: PublishedInteractionDiagnostic[] = []
    const rule = clickRule('reveal', 'slide-intro-title', [
      actionStep('reveal-step', { type: 'presentation.set', stateId: 'slide-state-evidence' }),
    ])
    expect(publishedPresentationSetUnsupportedReason(rule, 0)).toBeNull()
    const controller = new PublishedInteractionController({
      surfaceId: 'slide-surface', rules: [rule],
      surface: host.surface, session: navigation.session,
      reportDiagnostic: diagnostic => diagnostics.push(diagnostic),
    })
    expect(diagnostics).toEqual([])
    host.listeners.get('slide-intro-title')?.()
    await vi.waitFor(() => expect(navigation.goToScene).toHaveBeenCalledWith(
      'slide-scene-intro', 'slide-state-evidence', expect.any(AbortSignal),
    ))
    controller.destroy()
  })

  const unsupportedVariants: Array<{
    name: string
    rule: () => InteractionRule
    scope?: 'scene' | 'global'
    triggerNode: string | null
  }> = [
    {
      name: '带 transition',
      rule: () => clickRule('with-transition', 'slide-intro-title', [
        actionStep('set', { type: 'presentation.set', stateId: 'slide-state-evidence', transition: { duration: 300 } }),
      ]),
      triggerNode: 'slide-intro-title',
    },
    {
      name: '不是最后一个动作',
      rule: () => clickRule('not-final', 'slide-intro-title', [
        actionStep('set', { type: 'presentation.set', stateId: 'slide-state-evidence' }),
        actionStep('tail', { type: 'course-state.set', key: 'answered', value: true }),
      ]),
      triggerNode: 'slide-intro-title',
    },
    {
      name: '未独占最后执行组',
      rule: () => clickRule('shared-group', 'slide-intro-title', [
        actionStep('first', { type: 'course-state.set', key: 'answered', value: true }),
        actionStep('set', { type: 'presentation.set', stateId: 'slide-state-evidence' }, { start: 'with-previous' }),
      ]),
      triggerNode: 'slide-intro-title',
    },
    {
      name: 'scene.enter 触发',
      rule: () => ({
        id: 'on-enter', enabled: true,
        trigger: { type: 'scene.enter' }, conditions: [],
        actions: [actionStep('set', { type: 'presentation.set', stateId: 'slide-state-evidence' })],
      }),
      triggerNode: null,
    },
    {
      name: '全局规则缺 scene.in',
      rule: () => clickRule('global-set', 'slide-intro-title', [
        actionStep('set', { type: 'presentation.set', stateId: 'slide-state-evidence' }),
      ]),
      scope: 'global',
      triggerNode: 'slide-intro-title',
    },
  ]

  it.each(unsupportedVariants)('$name：整规则拒绝、原因明确、点击零执行', async ({ rule: build, scope, triggerNode }) => {
    const rule = build()
    const actionIndex = rule.actions.findIndex(step => step.action.type === 'presentation.set')
    const reason = publishedPresentationSetUnsupportedReason(rule, actionIndex, scope ?? 'scene')
    expect(reason, '共享支持判断必须先给出具体原因').not.toBeNull()

    const host = surfaceHarness()
    const navigation = sessionHarness('slide-scene-intro')
    const diagnostics: PublishedInteractionDiagnostic[] = []
    const controller = new PublishedInteractionController({
      surfaceId: 'slide-surface', rules: [rule],
      surface: host.surface, session: navigation.session,
      ...(scope ? { scope } : {}),
      reportDiagnostic: diagnostic => diagnostics.push(diagnostic),
    })
    // 同一判断：Player 绑定路径给出的诊断与共享支持函数的原因一致。
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({ code: 'unsupported-action', ruleId: rule.id, message: reason })
    // 整规则拒绝：不安装点击绑定；即使触发也零执行，不是静默丢动作。
    expect(triggerNode === null ? [] : [...host.listeners.keys()]).toEqual([])
    if (triggerNode) host.listeners.get(triggerNode)?.()
    controller.enterScene()
    await Promise.resolve()
    expect(navigation.goToScene).not.toHaveBeenCalled()
    controller.destroy()
  })
})

describe('反例 2：step.next vs scene.next 目的地语义（真实课例播放序列）', () => {
  function publishedSequence() {
    const archive = openCourseProjectArchive(new Uint8Array(readFileSync(FIXTURE_PATH)))
    const components = componentPackagesFromArchive(archive.project, archive.componentFiles)
    const payload = buildPublishedCourseV2Payload({
      project: archive.project, assetFiles: archive.assetFiles, components,
    })
    return buildCoursePlaybackSequence(payload)
  }

  it('从基础态出发：step.next 只推进到证据态步骤，scene.next 才到练习页', () => {
    const scenes = publishedSequence()
    // 导入页两个位置同属一个播放场景（基础态 → 证据态两个步骤），之后是练习页、总结页。
    expect(scenes.map(scene => [scene.kind, scene.steps.length])).toEqual([
      ['slide', 2], ['slide', 1], ['slide', 1],
    ])
    const atBase = playbackNavigationProgress(scenes, 'slide-location-intro', 'slide-state-base')
    expect(atBase).toMatchObject({ sceneIndex: 0, stepIndex: 0, stepCount: 2 })

    // 教师要求“进入练习页”时，step.next 的实际目的地仍是导入页的证据态步骤——已知失败模式。
    const stepNext = adjacentPlaybackTarget(scenes, atBase, 'step', 'next')
    expect(stepNext).toMatchObject({ locationId: 'slide-location-evidence', stateId: 'slide-state-evidence' })
    // scene.next 跳过剩余呈现步骤，目的地才是练习页第一步。
    const sceneNext = adjacentPlaybackTarget(scenes, atBase, 'scene', 'next')
    expect(sceneNext).toMatchObject({ locationId: 'slide-location-practice' })
    expect(sceneNext?.locationId).not.toBe(stepNext?.locationId)
  })

  it('呈现步骤用尽后 step.next 才落到下一场景：证据态再下一步是练习页', () => {
    const scenes = publishedSequence()
    const atEvidence = playbackNavigationProgress(scenes, 'slide-location-evidence', 'slide-state-evidence')
    expect(atEvidence).toMatchObject({ sceneIndex: 0, stepIndex: 1 })
    expect(adjacentPlaybackTarget(scenes, atEvidence, 'step', 'next'))
      .toMatchObject({ locationId: 'slide-location-practice' })
    // 最后一个播放场景之后没有下一步：目的地为空而非臆造。
    const atSummary = playbackNavigationProgress(scenes, 'slide-location-summary', null)
    expect(adjacentPlaybackTarget(scenes, atSummary, 'step', 'next')).toBeNull()
    expect(adjacentPlaybackTarget(scenes, atSummary, 'scene', 'next')).toBeNull()
  })
})

describe('反例 3：只预检未交付——合同与守卫均不承认', () => {
  function fixture() {
    const workspace = { version: 1 as const, projectId: 'lesson', normalizedPath: 'c:/lessons/example.h5lesson' }
    const taskId = randomUUID(), sessionId = randomUUID(), observationId = randomUUID()
    const requestId = randomUUID(), candidateId = randomUUID()
    const destination = { kind: 'update' as const, target: { projectId: 'lesson', documentRevision: 7, revisionPolicy: { kind: 'exact' as const }, sessionGeneration: 3, surfaceType: 'slide' as const, surfaceId: 'slide', locationId: 'page', stateId: null, owner: 'scene' as const, ownerKey: 'scene:page', itemId: 'title', authoringAddress: 'page/title' } }
    const task = aiTaskSchema.parse({ version: 1, taskId, epoch: 0, workspace, sessionId, adapter: 'codex', goal: '标题放大', intent: 'edit', applyPolicy: 'auto', readScope: { kind: 'location', surfaceId: 'slide', locationId: 'page' }, writeDestinations: [destination], status: 'running', observationId, committedResultIds: [] })
    const observation = aiObservationSchema.parse({ version: 1, taskId, epoch: 0, workspace, observationId, capturedAt: 1, documentRevision: 7, sessionGeneration: 3, draftEpoch: 0, viewEpoch: 1, runtime: null, surfaceId: 'slide', locationId: 'page', stateId: null, source: 'authoring', readScope: task.readScope, files: [] })
    const proposal = aiProposalSchema.parse({ version: 1, taskId, epoch: 0, workspace, observationId, requestId, candidateId, candidate: { version: 1, requestId, candidateId, summary: '标题放大', steps: [{ id: 'title', tool: 'native.item.update', carrier: 'native', destination, input: { fontSize: 48 } }] } })
    const committed = aiHostResultSchema.parse({ version: 1, taskId, epoch: 0, workspace, observationId, requestId, candidateId, resultId: randomUUID(), status: 'committed', beforeRevision: 7, afterRevision: 8, receipts: [{ version: 1, requestId, candidateId, workspace, status: 'committed', beforeRevision: 7, afterRevision: 8, affected: [{ id: 'title', operation: 'updated', ownerKey: 'scene:page', authoringAddress: 'page/title' }], resources: { assetIds: [], packageIds: [] } }], summary: '已放大', diagnostics: [] })
    return { task, observation, proposal, committed }
  }

  it('helper 的 prechecked 不是宿主结果；未交付结果不能声明提交后行为', () => {
    const { committed } = fixture()
    // candidate-helper --check 的干跑状态永远进不了宿主结果合同。
    expect(aiHostResultSchema.safeParse({ ...committed, status: 'prechecked' }).success).toBe(false)
    // 未正式应用的结果（rejected/checked）不能携带 afterCommit.finish：
    // “只有正式应用结果可以决定提交后行为”。
    const rejected = aiHostResultSchema.parse({
      ...committed, resultId: randomUUID(), status: 'rejected',
      afterRevision: committed.beforeRevision, receipts: [], summary: '预检失败',
    })
    expect(aiHostResultSchema.safeParse({ ...rejected, afterCommit: { version: 1, action: 'finish' } }).success).toBe(false)
  })

  it('checked（只预检）结果不能完成任务；committed + finish 才算正式交付', () => {
    const { task, proposal, committed } = fixture()
    const checked = aiHostResultSchema.parse({
      ...committed, resultId: randomUUID(), status: 'checked',
      afterRevision: committed.beforeRevision, receipts: [], summary: '只预检通过',
    })
    const afterChecked = acceptAiHostResult({ ...task, status: 'checking' }, proposal, checked, []).task
    expect(afterChecked.status).not.toBe('completed')
    expect(afterChecked.completion).toBeUndefined()
    expect(afterChecked.committedResultIds).toEqual([])

    const finishProposal = aiProposalSchema.parse({
      ...proposal,
      candidate: { ...proposal.candidate, afterCommit: { version: 1, action: 'finish' } },
    })
    const finishResult = aiHostResultSchema.parse({ ...committed, afterCommit: { version: 1, action: 'finish' } })
    const afterCommit = acceptAiHostResult({ ...task, status: 'committing' }, finishProposal, finishResult, []).task
    expect(afterCommit.status).toBe('completed')
    expect(afterCommit.completion).toMatchObject({ outcome: 'modified', resultId: finishResult.resultId })
    expect(afterCommit.committedResultIds).toEqual([finishResult.resultId])
  })
})
