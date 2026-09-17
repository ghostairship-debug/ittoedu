import { buildPublishedFixture as buildPublishedCourseV2Payload } from '../fixtures/teacherController'
import { controllerPackages } from '../fixtures/teacherController'
import { nativeInteractionChecks, verifyNativeInteractions } from '@/renderer/authoring/generation/nativeInteractionVerification'
import { generationNavigationContext } from '@/renderer/authoring/generation/generationNavigationContext'
import { createGenerationCandidateCoordinator } from '@/renderer/authoring/generation/prepareGenerationCandidate'
import { generationRequestSchema, readGenerationFailure } from '@/shared/generationContract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { slideInteractionTool, slideInteractionToolInputSchema } from '@/renderer/authoring/tools/slideInteractionTool'
import { describeAuthoringToolDiscovery } from '@/renderer/authoring/tools/authoringToolFacade'
import { executeAuthoringTool, type AuthoringToolDefinition } from '@/renderer/authoring/tools/executeAuthoringTool'
import { courseAuthoringScopeFromLocation } from '@/renderer/authoring/courseAuthoringScope'
import { applyEditorTransactionStep, type EditorTransactionStep } from '@/renderer/authoring/editorTransaction'
import { commitEditorTransactionToAuthoringHistory, createResourceAwareAuthoringHistory } from '@/renderer/authoring/resourceAwareAuthoringHistory'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createShapeNode, createTextNode } from '@/renderer/project/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { addCourseFlowPage, addCourseScene } from '@/renderer/course/courseLocationCommands'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { CourseProjectDocument, SlideSceneDocument } from '@/shared/courseProjectTypes'
import type { AuthoringToolCreateScopeV1, AuthoringToolDestinationV1 } from '@/shared/authoringToolContract'
import type { HistoryResourceState } from '@/renderer/store/courseResourceState'
import { createPublishedCourseSession, type PublishedCourseSession } from '@/player/surfaces/publishedDynamicHosts'
import { failureReasonKey } from '../../src/main/localAgent/candidateChangeKey'

const NOW = '2026-08-17T21:00:00.000Z'

function requireOk<T extends { ok: boolean; reason?: string }>(result: T): T & { ok: true } {
  if (!result.ok) throw new Error(result.reason ?? 'command failed')
  return result as T & { ok: true }
}

/**
 * 多呈现步骤 fixture：场景 A 三个呈现状态（观察/点亮/总结），两种灯泡图形状态
 * 与解释、总结文字按明确 override 同步显隐；场景 B 之后是 Flow 位置，顺序
 * next-scene 必须跨 Surface 到达。场景与 Flow 位置由真实课程位置命令创建。
 */
function fixtureProject(): CourseProjectDocument {
  let project = createBlankCourseProject({ now: NOW })
  const slide = project.surfaces.find((surface) => surface.type === 'slide')!
  project = requireOk(addCourseScene(project, { surfaceId: slide.id, now: NOW, expectedRevision: project.revision })).project
  project = requireOk(addCourseFlowPage(project, { now: NOW, expectedRevision: project.revision })).project
  const surface = project.surfaces.find((entry) => entry.type === 'slide')!
  const [sceneA, sceneB] = surface.scenes as [SlideSceneDocument, SlideSceneDocument]
  const item = (node: Parameters<typeof sceneNodeToCourseLayerItem>[0], order: number) => sceneNodeToCourseLayerItem(node, order)
  sceneA.layerItems.push(
    item(createShapeNode('ellipse', { id: 'bulb-off', name: '熄灭的灯泡', x: 120, y: 140, width: 160, height: 160, style: { fillColor: '#9ca3af', borderColor: '#4b5563' } }), 10),
    item(createShapeNode('ellipse', { id: 'bulb-on', name: '点亮的灯泡', x: 120, y: 140, width: 160, height: 160, style: { fillColor: '#ffd60a', borderColor: '#b45309' } }), 11),
    item(createTextNode({ id: 'explanation', name: '解释', text: '闭合回路后电流通过灯丝，灯泡发光。', x: 360, y: 160, width: 420, height: 120 }), 12),
    item(createTextNode({ id: 'summary', name: '总结', text: '电路闭合用电器才工作。', x: 360, y: 320, width: 420, height: 80 }), 13),
    item(createTextNode({ id: 'btn-switch', name: '开关', text: '闭合开关', x: 120, y: 420, width: 180, height: 64 }), 20),
    item(createTextNode({ id: 'btn-next', name: '下一步', text: '下一步', x: 320, y: 420, width: 180, height: 64 }), 21),
    item(createTextNode({ id: 'btn-skip', name: '跳过本页', text: '跳过本页', x: 520, y: 420, width: 180, height: 64 }), 22),
    { ...item(createTextNode({ id: 'decor', name: '装饰', text: '背景装饰', x: 720, y: 420, width: 180, height: 64 }), 23), hitPolicy: 'pass-through' as const },
  )
  sceneB.layerItems.push(
    item(createTextNode({ id: 'btn-flow', name: '进入讲义', text: '进入讲义', x: 120, y: 420, width: 200, height: 64 }), 10),
  )
  sceneA.presentation = {
    initialStateId: 'state-observe',
    states: [
      {
        id: 'state-observe', name: '观察', layerItemOverrides: {
          'bulb-on': { playbackInitialVisibility: 'hidden' },
          explanation: { playbackInitialVisibility: 'hidden' },
          summary: { playbackInitialVisibility: 'hidden' },
        },
      },
      {
        id: 'state-lit', name: '点亮', layerItemOverrides: {
          'bulb-off': { playbackInitialVisibility: 'hidden' },
          summary: { playbackInitialVisibility: 'hidden' },
        },
      },
      {
        id: 'state-summary', name: '总结', layerItemOverrides: {
          'bulb-off': { playbackInitialVisibility: 'hidden' },
        },
      },
    ],
  }
  return courseProjectDocumentSchema.parse(project)
}

function sceneLocationId(document: CourseProjectDocument, sceneId: string): string {
  const location = document.locations.find((entry) => entry.kind === 'slide-scene' && entry.sceneId === sceneId)
  if (!location) throw new Error(`missing location for scene ${sceneId}`)
  return location.id
}

function interactionScope(document: CourseProjectDocument, locationId: string): AuthoringToolCreateScopeV1 {
  const scope = courseAuthoringScopeFromLocation({ project: document, locationId, owner: 'scene' })
  const surfaceType = document.surfaces.find((surface) => surface.id === scope.surfaceId)!.type
  return {
    projectId: document.id, documentRevision: document.revision, revisionPolicy: { kind: 'exact' }, sessionGeneration: 1,
    surfaceType, surfaceId: scope.surfaceId, locationId: scope.locationId, stateId: scope.stateId, owner: scope.owner, ownerKey: scope.ownerKey,
    parent: { kind: 'owner' }, insertion: { kind: 'append' },
  }
}

function harness(project: CourseProjectDocument, resources: HistoryResourceState = { assetFiles: {}, componentPackages: {} }) {
  let history = createResourceAwareAuthoringHistory(project)
  const steps: EditorTransactionStep[] = []
  return {
    steps,
    document: () => history.present,
    async run<T>(definition: AuthoringToolDefinition<T>, input: unknown, destination: AuthoringToolDestinationV1) {
      return executeAuthoringTool({ version: 1, requestId: `request-${steps.length}`, tool: definition.name, destination, input }, definition, {
        readDocument: () => history.present,
        readResources: () => resources,
        validateDestination: () => null,
        commit(step) { history = commitEditorTransactionToAuthoringHistory(history, step); steps.push(step); return true },
      })
    },
  }
}

function stripInteractions(document: CourseProjectDocument): CourseProjectDocument {
  return {
    ...document,
    // revision/updatedAt 由每次命令提交递增，不属于“指定对象”差异。
    revision: 0,
    updatedAt: '',
    surfaces: document.surfaces.map((surface) => surface.type === 'slide'
      ? { ...surface, scenes: surface.scenes.map((scene) => ({ ...scene, interactions: [] })) }
      : surface),
  }
}

const sessions: PublishedCourseSession[] = []

async function settle(turns = 12): Promise<void> {
  for (let index = 0; index < turns; index += 1) await Promise.resolve()
}

/**
 * 真实点击触发的导航在宏任务里才释放 navigator 挂起计数（hasPendingNavigation）
 * 与会话导航门闩；只刷微任务时后续点击导航与 replayScene 会被门闩拒绝。
 * 每次真实点击后改用本函数等待导航完全落地。
 */
async function settleNavigation(): Promise<void> {
  await settle()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await settle()
}

function renderedItem(container: HTMLElement, itemId: string): HTMLElement {
  const item = container.querySelector<HTMLElement>(`[data-slide-layer-item="${itemId}"]`)
  expect(item, `expected rendered item ${itemId}`).not.toBeNull()
  return item!
}

function expectVisibility(container: HTMLElement, itemId: string, visible: boolean): void {
  const item = renderedItem(container, itemId)
  expect(item.dataset.interactionVisibility, `${itemId} interactionVisibility`).toBe(visible ? 'visible' : 'hidden')
  expect(item.style.visibility).toBe(visible ? 'visible' : 'hidden')
}

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.destroy()))
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('slide.interaction compose', () => {
  it('composes a Native click into an exact Flow location and verifies the real cross-Surface destination', async () => {
    const before = fixtureProject()
    const test = harness(before)
    const sourceScene = before.surfaces.find((surface) => surface.type === 'slide')!.scenes[0]!
    const sourceLocationId = sceneLocationId(before, sourceScene.id)
    const target = before.locations.find((location) => location.kind === 'flow-block')
    if (!target) throw new Error('missing Flow destination')

    const receipt = await test.run(slideInteractionTool, {
      operation: 'compose',
      trigger: { kind: 'click', node: 'btn-switch' },
      effects: [{ kind: 'go-to-location', location: target.label }],
    }, { kind: 'create', scope: interactionScope(test.document(), sourceLocationId) })

    expect(receipt.status).toBe('committed')
    const rule = test.document().surfaces.find((surface) => surface.type === 'slide')!
      .scenes[0]!.interactions[0]!
    expect(rule.actions).toEqual([
      expect.objectContaining({
        start: 'after-previous',
        action: { type: 'location.go', locationId: target.id },
      }),
    ])
    const report = await verifyNativeInteractions({
      before,
      document: test.document(),
      resources: { assetFiles: {}, componentPackages: controllerPackages },
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 30_000,
    })
    expect(report.checked).toEqual([rule.id])
    expect(report.skipped).toEqual([])

    const missing = harness(fixtureProject())
    const rejected = await missing.run(slideInteractionTool, {
      operation: 'compose',
      trigger: { kind: 'click', node: 'btn-switch' },
      effects: [{ kind: 'go-to-location', location: '不存在的位置' }],
    }, { kind: 'create', scope: interactionScope(missing.document(), missing.document().startLocationId) })
    expect(rejected.status).toBe('failed')
    expect(missing.steps).toHaveLength(0)
  })

  it('rejects unmounted state-hidden motion targets but keeps mounted playback-hidden reveal usable', async () => {
    const project = fixtureProject(), scene = project.surfaces.find(surface => surface.type === 'slide')!.scenes[0]!
    const locationId = sceneLocationId(project, scene.id)
    scene.presentation!.states[0]!.layerItemOverrides.explanation = { visible: false }
    const test = harness(project)
    const run = (effects: unknown[]) => test.run(slideInteractionTool, { operation: 'compose', trigger: { kind: 'click', node: 'btn-switch' }, effects }, { kind: 'create', scope: interactionScope(test.document(), locationId) })
    const rejected = await run([{ kind: 'show', nodes: ['explanation'] }, { kind: 'set-state', state: 'state-lit' }])
    expect(rejected.status).toBe('failed')
    expect(rejected.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'compose-motion-target-unmounted', path: ['input', 'effects', 0, 'nodes', 0] })]))
    expect(test.steps).toHaveLength(0)
    expect((await run([{ kind: 'set-state', state: 'state-lit' }])).status).toBe('committed')
    const mounted = harness(fixtureProject())
    expect((await mounted.run(slideInteractionTool, { operation: 'compose', trigger: { kind: 'click', node: 'btn-switch' }, effects: [{ kind: 'show', nodes: ['explanation'] }] },
      { kind: 'create', scope: interactionScope(mounted.document(), mounted.document().startLocationId) })).status).toBe('committed')
  })

  it('checks changed clicks with the real Player, rejects motion failure, and leaves existing failures and style-only edits alone', async () => {
    const before = fixtureProject(), test = harness(before)
    const scene = before.surfaces.find(surface => surface.type === 'slide')!.scenes[0]!
    const locationId = sceneLocationId(before, scene.id)
    await test.run(slideInteractionTool, { operation: 'compose', trigger: { kind: 'click', node: 'btn-switch' }, effects: [{ kind: 'set-state', state: 'state-lit' }] },
      { kind: 'create', scope: interactionScope(test.document(), locationId) })
    const good = test.document()
    const input = { before, document: good, resources: { assetFiles: {}, componentPackages: controllerPackages }, signal: new AbortController().signal, deadlineAt: Date.now() + 30_000 }
    const result = await verifyNativeInteractions(input)
    expect(result.checked).toHaveLength(1)
    expect(result.skipped).toEqual([])
    const bad = structuredClone(good), badScene = bad.surfaces.find(surface => surface.type === 'slide')!.scenes[0]!
    badScene.presentation!.states[0]!.layerItemOverrides.explanation = { visible: false }
    badScene.interactions[0]!.actions.unshift({ id: 'unmounted-motion', start: 'after-previous', delayMs: 0,
      action: { type: 'node.enter', nodeId: 'explanation', effect: 'none', durationMs: 0, easing: 'linear' } })
    await expect(verifyNativeInteractions({ ...input, document: bad })).rejects.toMatchObject({ diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'native-interaction-result-mismatch' })]) })
    const baseline = structuredClone(bad)
    baseline.surfaces.find(surface => surface.type === 'slide')!.scenes[0]!.interactions = []
    let live = baseline
    const destination = { kind: 'create' as const, scope: interactionScope(live, locationId) }
    const request = generationRequestSchema.parse({ version: 1, requestId: crypto.randomUUID(),
      workspace: { version: 1, projectId: live.id, normalizedPath: 'c:/lessons/native-click.h5lesson' },
      documentRevision: live.revision, sessionGeneration: 1, purpose: 'local-edit', instruction: '点击后切换状态',
      context: {}, allowedCarriers: ['native'], destinations: [destination] })
    const commits: EditorTransactionStep[] = []
    const coordinator = createGenerationCandidateCoordinator({ readDocument: () => live, readResources: () => input.resources,
      readWorkspace: () => request.workspace, readSessionGeneration: () => 1, verifyInteractions: verifyNativeInteractions,
      commit(step) { live = step.nextDocument; commits.push(step); return true } })
    const { id: _badId, ...badRule } = badScene.interactions[0]!
    const candidate = { version: 1, requestId: request.requestId, candidateId: crypto.randomUUID(), summary: '点击显示',
      afterCommit: { version: 1, action: 'finish' }, steps: [{ id: 'click-rule', tool: 'slide.interaction', carrier: 'native', destination, input: { operation: 'insert', rule: badRule } }] }
    const failure = readGenerationFailure(await coordinator.prepare(request, candidate).catch(error => error))
    expect(failure).toMatchObject({ stage: 'prepare', stepId: 'click-rule', tool: 'slide.interaction', recovery: { action: 'repair-candidate' },
      diagnostics: [expect.objectContaining({ code: 'native-interaction-result-mismatch', path: ['input'] })] })
    expect(commits).toHaveLength(0)
    expect(live).toEqual(baseline)
    const { id: _goodId, ...goodRule } = good.surfaces.find(surface => surface.type === 'slide')!.scenes[0]!.interactions[0]!
    const repaired = await coordinator.prepare(request, { ...candidate, candidateId: crypto.randomUUID(), steps: [{ ...candidate.steps[0], input: { operation: 'insert', rule: goodRule } }] })
    expect(repaired.interactionChecks?.checked).toHaveLength(1)
    expect(coordinator.apply(repaired.previewId).status).toBe('committed')
    expect(commits).toHaveLength(1)
    const styleOnly = structuredClone(bad)
    styleOnly.title = '仅修改标题'
    expect(nativeInteractionChecks(bad, styleOnly)).toEqual({ checks: [], skipped: [] })
    expect(document.querySelector('[aria-hidden="true"][style*="-10000px"]')).toBeNull()
  })

  it('builds consistent rules from explicit config in one scoped transaction each, surviving save/reopen and undo/redo', async () => {
    const fixture = fixtureProject()
    const test = harness(fixture)
    const locationA = sceneLocationId(fixture, fixture.surfaces.find((surface) => surface.type === 'slide')!.scenes[0]!.id)
    const sceneBId = fixture.surfaces.find((surface) => surface.type === 'slide')!.scenes[1]!.id
    const locationB = sceneLocationId(fixture, sceneBId)

    // 明确配置：模型只给触发对象、目标状态（id 或唯一名称）与效果；
    // 产品生成一致引用、步骤 id、分组与收尾导航。
    const setState = await test.run(slideInteractionTool, {
      operation: 'compose', name: '闭合开关',
      trigger: { kind: 'click', node: '开关' },
      effects: [{ kind: 'set-state', state: '点亮' }],
    }, { kind: 'create', scope: interactionScope(test.document(), locationA) })
    expect(setState.status, JSON.stringify(setState.diagnostics)).toBe('committed')
    expect(setState.affected).toHaveLength(1)
    expect(setState.affected[0]!.operation).toBe('created')

    const stepNext = await test.run(slideInteractionTool, {
      operation: 'compose',
      trigger: { kind: 'click', node: 'btn-next' },
      effects: [{ kind: 'next-step' }],
    }, { kind: 'create', scope: interactionScope(test.document(), locationA) })
    expect(stepNext.status, JSON.stringify(stepNext.diagnostics)).toBe('committed')

    const sceneNext = await test.run(slideInteractionTool, {
      operation: 'compose',
      trigger: { kind: 'click', node: 'btn-skip' },
      effects: [{ kind: 'next-scene' }],
    }, { kind: 'create', scope: interactionScope(test.document(), locationA) })
    expect(sceneNext.status, JSON.stringify(sceneNext.diagnostics)).toBe('committed')

    const toFlow = await test.run(slideInteractionTool, {
      operation: 'compose',
      trigger: { kind: 'click', node: '进入讲义' },
      effects: [{ kind: 'next-scene' }],
    }, { kind: 'create', scope: interactionScope(test.document(), locationB) })
    expect(toFlow.status, JSON.stringify(toFlow.diagnostics)).toBe('committed')
    expect(test.steps).toHaveLength(4)

    // 静态结构：生成的规则使用规范 id，呈现切换无 transition 且独占收尾组，
    // 导航动作是最后的 after-previous 组。
    const document = test.document()
    const sceneA = document.surfaces.find((surface) => surface.type === 'slide')!.scenes[0]!
    const [setStateRule, stepRule, skipRule] = sceneA.interactions
    expect(sceneA.interactions).toHaveLength(3)
    expect(setStateRule).toMatchObject({
      id: setState.affected[0]!.id,
      name: '闭合开关',
      enabled: true,
      trigger: { type: 'node.click', nodeId: 'btn-switch' },
      conditions: [],
    })
    expect(setStateRule!.actions).toEqual([
      { id: `${setState.affected[0]!.id}-a1`, start: 'after-previous', delayMs: 0, action: { type: 'presentation.set', stateId: 'state-lit' } },
    ])
    expect(stepRule!.actions).toEqual([
      { id: `${stepNext.affected[0]!.id}-a1`, start: 'after-previous', delayMs: 0, action: { type: 'step.next' } },
    ])
    expect(skipRule!.actions[0]!.action).toEqual({ type: 'scene.next' })
    const sceneB = document.surfaces.find((surface) => surface.type === 'slide')!.scenes[1]!
    expect(sceneB.interactions).toHaveLength(1)
    expect(sceneB.interactions[0]!.actions[0]!.action).toEqual({ type: 'scene.next' })

    // 事务只改指定对象：除 interactions 与 revision 时间外工程完全一致。
    expect(stripInteractions(document)).toEqual(stripInteractions(fixture))
    expect(document.revision).toBe(fixture.revision + 4)

    // 保存/重开往返保留规则；发布产物携带同一规则。
    const reopened = courseProjectDocumentSchema.parse(JSON.parse(JSON.stringify(document)))
    expect(reopened).toEqual(document)
    const payload = buildPublishedCourseV2Payload({ project: reopened, assetFiles: {}, components: {} })
    const publishedSlide = payload.surfaces.find((surface) => surface.type === 'slide')!
    expect(publishedSlide.scenes[0]!.interactions.map((rule) => rule.id)).toEqual(sceneA.interactions.map((rule) => rule.id))

    // Undo/Redo：逐步逆应用恢复 fixture，再正向重放。
    let undone = { document, resources: { assetFiles: {}, componentPackages: {} } }
    for (let index = test.steps.length - 1; index >= 0; index -= 1) {
      undone = applyEditorTransactionStep(undone, test.steps[index]!, 'inverse')
    }
    expect(undone.document).toEqual(fixture)
    let redone = undone
    for (const step of test.steps) redone = applyEditorTransactionStep(redone, step, 'forward')
    expect(redone.document).toEqual(document)
  })

  it('rejects unsupported combinations and dangling references at the boundary with zero writes', async () => {
    const fixture = fixtureProject()
    const test = harness(fixture)
    const locationA = sceneLocationId(fixture, fixture.surfaces.find((surface) => surface.type === 'slide')!.scenes[0]!.id)
    const run = (input: unknown) => test.run(slideInteractionTool, input, { kind: 'create', scope: interactionScope(test.document(), locationA) })

    // presentation.set 与导航同规则：复用同一支持判断在边界明确拒绝，不静默丢动作。
    const mixed = await run({ operation: 'compose', trigger: { kind: 'click', node: 'btn-next' }, effects: [{ kind: 'set-state', state: '点亮' }, { kind: 'next-scene' }] })
    expect(mixed.status).toBe('failed')
    expect(JSON.stringify(mixed.diagnostics)).toContain('必须是最后一个动作')

    const navigationFirst = await run({ operation: 'compose', trigger: { kind: 'click', node: 'btn-next' }, effects: [{ kind: 'next-scene' }, { kind: 'show', nodes: ['解释'] }] })
    expect(navigationFirst.status).toBe('failed')
    expect(JSON.stringify(navigationFirst.diagnostics)).toContain('导航效果必须是最后一个效果')

    const sceneEnterSetState = await run({ operation: 'compose', trigger: { kind: 'scene-enter' }, effects: [{ kind: 'set-state', state: '点亮' }] })
    expect(sceneEnterSetState.status).toBe('failed')
    expect(JSON.stringify(sceneEnterSetState.diagnostics)).toContain('scene.enter')

    const missingState = await run({ operation: 'compose', trigger: { kind: 'click', node: 'btn-switch' }, effects: [{ kind: 'set-state', state: '不存在的状态' }] })
    expect(missingState.status).toBe('failed')
    expect(JSON.stringify(missingState.diagnostics)).toContain('不存在')

    const unbindable = await run({ operation: 'compose', trigger: { kind: 'click', node: 'decor' }, effects: [{ kind: 'next-step' }] })
    expect(unbindable.status).toBe('failed')
    expect(JSON.stringify(unbindable.diagnostics)).toContain('自动命中')

    const missingScene = await run({ operation: 'compose', trigger: { kind: 'click', node: 'btn-next' }, effects: [{ kind: 'go-to-scene', scene: '不存在的场景' }] })
    expect(missingScene.status).toBe('failed')
    expect(JSON.stringify(missingScene.diagnostics)).toContain('不存在')

    const undeclaredState = await run({ operation: 'compose', trigger: { kind: 'click', node: 'btn-next' }, effects: [{ kind: 'set-course-state', key: 'score', value: 1 }] })
    expect(undeclaredState.status).toBe('failed')
    expect(JSON.stringify(undeclaredState.diagnostics)).toContain('尚未声明')

    expect(test.steps).toHaveLength(0)
    expect(test.document()).toEqual(fixture)
  })

  it('exposes compose through the same discovery card other planners read', () => {
    const card = describeAuthoringToolDiscovery().find((tool) => tool.name === 'slide.interaction')!
    expect(card.supportedScopes).toEqual(['slide:scene'])
    expect(card.variants.map((variant) => variant.operation)).toEqual(['compose', 'insert', 'replace', 'delete'])
    expect(card.description).toContain('next-step')
    expect(card.description).toContain('next-scene')
    expect(card.conditions?.some((condition) => condition.operations?.includes('compose'))).toBe(true)
  })

  it('plays the composed fixture with real clicks: step advance, cross-Surface destination and synchronized state visibility', async () => {
    const fixture = fixtureProject()
    const test = harness(fixture)
    const slide = fixture.surfaces.find((surface) => surface.type === 'slide')!
    const locationA = sceneLocationId(fixture, slide.scenes[0]!.id)
    const locationB = sceneLocationId(fixture, slide.scenes[1]!.id)
    for (const [locationId, input] of [
      [locationA, { operation: 'compose', trigger: { kind: 'click', node: '开关' }, effects: [{ kind: 'set-state', state: '点亮' }] }],
      [locationA, { operation: 'compose', trigger: { kind: 'click', node: '下一步' }, effects: [{ kind: 'next-step' }] }],
      [locationA, { operation: 'compose', trigger: { kind: 'click', node: '跳过本页' }, effects: [{ kind: 'next-scene' }] }],
      [locationB, { operation: 'compose', trigger: { kind: 'click', node: '进入讲义' }, effects: [{ kind: 'next-scene' }] }],
    ] as const) {
      const receipt = await test.run(slideInteractionTool, input, { kind: 'create', scope: interactionScope(test.document(), locationId) })
      expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed')
    }

    const payload = buildPublishedCourseV2Payload({ project: test.document(), assetFiles: {}, components: {} })
    const session = createPublishedCourseSession(payload)
    sessions.push(session)
    const container = document.createElement('div')
    document.body.appendChild(container)
    await session.mount(container)

    // 初始“观察”状态：点亮的灯泡、解释与总结隐藏，熄灭的灯泡可见。
    expect(session.getPlaybackProgress()).toMatchObject({ sceneIndex: 0, stepIndex: 0, stepCount: 3 })
    expectVisibility(container, 'bulb-off', true)
    expectVisibility(container, 'bulb-on', false)
    expectVisibility(container, 'explanation', false)
    expectVisibility(container, 'summary', false)

    // 两种灯泡图形状态与解释显隐同步：真实点击“闭合开关”，一次 presentation.set
    // 同时切换 bulb-off/bulb-on 并显示解释，仍在同一课程位置。
    renderedItem(container, 'btn-switch').click()
    await settleNavigation()
    await vi.waitFor(() => expect(session.getPlaybackProgress()).toMatchObject({ sceneIndex: 0, stepIndex: 1, stepName: '点亮' }))
    expect(session.navigator.current?.locationId).toBe(locationA)
    expectVisibility(container, 'bulb-off', false)
    expectVisibility(container, 'bulb-on', true)
    expectVisibility(container, 'explanation', true)
    expectVisibility(container, 'summary', false)

    // 步骤推进：同一挂载内连续第二次真实点击“下一步”，step.next 走到“总结”步骤，
    // 仍复用当前页呈现步骤而不离开课程位置。
    const expectedStep = generationNavigationContext(test.document(), locationA, 'state-lit').current.nextStep!
    renderedItem(container, 'btn-next').click()
    await settleNavigation()
    await vi.waitFor(() => expect(session.getPlaybackProgress()).toMatchObject({ sceneIndex: 0, stepIndex: 2, stepName: '总结' }))
    expect(session.navigator.current?.locationId).toBe(locationA)
    expect(session.navigator.current?.locationId).toBe(expectedStep.locationId)
    expect(session.getPlaybackProgress()?.stepName).toBe(expectedStep.stepName)
    expectVisibility(container, 'summary', true)

    // scene.next 跳过剩余步骤：经公开的 session.replayScene() 重挂场景 A 回到首步，
    // 真实点击“跳过本页”直接到下一场景（同位置 goToIndex 是不重置呈现状态的 no-op）。
    expect(await session.replayScene()).toBe(true)
    await settle()
    expect(session.getPlaybackProgress()).toMatchObject({ sceneIndex: 0, stepIndex: 0 })
    const expectedScene = generationNavigationContext(test.document(), locationA, 'state-observe').current.nextScene!
    renderedItem(container, 'btn-skip').click()
    await settleNavigation()
    await vi.waitFor(() => expect(session.navigator.current?.locationId).toBe(locationB))
    expect(session.getPlaybackProgress()).toMatchObject({ sceneIndex: 1, stepIndex: 0 })
    expect(session.navigator.current?.locationId).toBe(expectedScene.locationId)

    // 跨 Surface 目的地：scene.next 已真实导航到新挂载的场景 B（点击武装为全新），
    // 真实点击“进入讲义”，顺序跨 Surface 复用既有 nextScene，到达 Flow 位置。
    renderedItem(container, 'btn-flow').click()
    await settleNavigation()
    await vi.waitFor(() => expect(session.navigator.current?.locationId).toBe(payload.locations[2]!.id))
    expect(session.navigator.current).toMatchObject({ kind: 'flow', index: 2 })
    container.remove()
  })
})

describe('slide.interaction compose 能力边界与跨位置同名', () => {
  it('U05-corrected-commit gives distinct typed causes for progressive target repairs and commits the fully corrected composition', async () => {
    const project = fixtureProject(), test = harness(project)
    const destination = { kind: 'create' as const, scope: interactionScope(project, project.startLocationId) }
    const keys: (string | null)[] = [], codes: string[] = []
    for (const [node, shown, state] of [
      ['missing-click', 'missing-show', 'missing-state'], ['btn-switch', 'missing-show', 'missing-state'],
      ['btn-switch', 'explanation', 'missing-state'],
    ]) {
      const receipt = await test.run(slideInteractionTool, { operation: 'compose', trigger: { kind: 'click', node },
        effects: [{ kind: 'show', nodes: [shown] }, { kind: 'set-state', state }] }, destination)
      expect(receipt.status).toBe('failed'); expect(test.steps).toHaveLength(0)
      codes.push(receipt.diagnostics[0]!.code)
      keys.push(failureReasonKey({ version: 1, stage: 'prepare', tool: 'slide.interaction',
        diagnostics: receipt.diagnostics, assetIds: [], packageIds: [] }))
    }
    expect(codes).toEqual(['compose-node-not-found', 'compose-node-not-found', 'compose-state-not-found'])
    expect(keys.every(Boolean)).toBe(true); expect(new Set(keys).size).toBe(3)
    const corrected = await test.run(slideInteractionTool, { operation: 'compose', trigger: { kind: 'click', node: 'btn-switch' },
      effects: [{ kind: 'show', nodes: ['explanation'] }, { kind: 'set-state', state: 'state-lit' }] }, destination)
    expect(corrected.status).toBe('committed'); expect(test.steps).toHaveLength(1)
  })

  it('rejects state-enter trigger and inStates condition at the input Schema and documents the limitation with verified alternatives', () => {
    // 与 Published 播放支持判断矛盾的两类分支不再能经 Schema 构造。
    const effects = [{ kind: 'next-step' }]
    expect(slideInteractionToolInputSchema.safeParse({
      operation: 'compose',
      trigger: { kind: 'state-enter', state: '点亮' },
      effects,
    }).success).toBe(false)
    expect(slideInteractionToolInputSchema.safeParse({
      operation: 'compose',
      trigger: { kind: 'click', node: '开关' },
      when: { inStates: ['点亮'] },
      effects,
    }).success).toBe(false)

    // 工具描述给出限制与经核实替代，模型不再照 Schema 填写后必败。
    expect(slideInteractionTool.description).toContain('presentation.enter')
    expect(slideInteractionTool.description).toContain('presentation.in')
    expect(slideInteractionTool.description).toContain('set-state')
    expect(slideInteractionTool.description).toContain('course-state.compare')
    expect(slideInteractionTool.description).toContain('scene.in')
  })

  it('ignores same-name global layers excluded from the current location but still flags applicable ones as ambiguous', async () => {
    const globalExplanation = () => sceneNodeToCourseLayerItem(
      createTextNode({ id: 'global-explanation', name: '解释', text: '另一位置专属的全局解释', x: 0, y: 0, width: 200, height: 60 }),
      100,
    )
    const composeShow = (fixture: CourseProjectDocument, locationA: string) => {
      const test = harness(fixture)
      return test.run(slideInteractionTool, {
        operation: 'compose',
        trigger: { kind: 'click', node: 'btn-next' },
        effects: [{ kind: 'show', nodes: ['解释'] }],
      }, { kind: 'create', scope: interactionScope(test.document(), locationA) })
    }

    // 多呈现步骤 fixture 上，visibility exclude 当前页的同名 global 图层不参与当前页
    // 重名判定：唯一命中当前页场景内的“解释”，组合正常提交。
    const excludedFixture = fixtureProject()
    const excludedLocationA = sceneLocationId(excludedFixture, excludedFixture.surfaces.find((surface) => surface.type === 'slide')!.scenes[0]!.id)
    excludedFixture.globalLayerItems.push({ item: globalExplanation(), visibility: { mode: 'exclude', locationIds: [excludedLocationA] } })
    const excluded = await composeShow(excludedFixture, excludedLocationA)
    expect(excluded.status, JSON.stringify(excluded.diagnostics)).toBe('committed')

    // visibility include 当前页的同名 global 图层与当前页图层构成真实歧义：仍报多义，不静默选中。
    const includedFixture = fixtureProject()
    const includedLocationA = sceneLocationId(includedFixture, includedFixture.surfaces.find((surface) => surface.type === 'slide')!.scenes[0]!.id)
    includedFixture.globalLayerItems.push({ item: globalExplanation(), visibility: { mode: 'include', locationIds: [includedLocationA] } })
    const included = await composeShow(includedFixture, includedLocationA)
    expect(included.status).toBe('failed')
    expect(JSON.stringify(included.diagnostics)).toContain('匹配到多个同名图层')
  })
})

/*
 * 播放测试时序说明（工作包 E 记录）：
 * 真实点击触发的导航经 `#claimTerminalNavigation` 门闩与 navigator 挂起计数
 * （hasPendingNavigation）串行化；计数在宏任务（tracked promise 的 finally）里才
 * 释放。测试若只刷微任务，紧接着的第二次点击导航或 session.replayScene() 会被
 * 门闩拒绝、表现为“无动作”，这只是测试时序问题而非 Player 缺陷——每次真实点击后
 * 用 settleNavigation()（微任务 + 一次宏任务）等待落地即可连续点击。另外同位置
 * goToIndex/goToLocation 不带 force 是不重置呈现状态的 no-op；需要回到场景首步时
 * 使用公开的 session.replayScene()（force 重挂当前位置且不产生历史记录）。
 */
