import { buildPublishedFixture as buildPublishedCourseV2Payload } from '../fixtures/teacherController'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { slideInteractionTool } from '@/renderer/authoring/tools/slideInteractionTool'
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
    renderedItem(container, 'btn-next').click()
    await settleNavigation()
    await vi.waitFor(() => expect(session.getPlaybackProgress()).toMatchObject({ sceneIndex: 0, stepIndex: 2, stepName: '总结' }))
    expect(session.navigator.current?.locationId).toBe(locationA)
    expectVisibility(container, 'summary', true)

    // scene.next 跳过剩余步骤：经公开的 session.replayScene() 重挂场景 A 回到首步，
    // 真实点击“跳过本页”直接到下一场景（同位置 goToIndex 是不重置呈现状态的 no-op）。
    expect(await session.replayScene()).toBe(true)
    await settle()
    expect(session.getPlaybackProgress()).toMatchObject({ sceneIndex: 0, stepIndex: 0 })
    renderedItem(container, 'btn-skip').click()
    await settleNavigation()
    await vi.waitFor(() => expect(session.navigator.current?.locationId).toBe(locationB))
    expect(session.getPlaybackProgress()).toMatchObject({ sceneIndex: 1, stepIndex: 0 })

    // 跨 Surface 目的地：scene.next 已真实导航到新挂载的场景 B（点击武装为全新），
    // 真实点击“进入讲义”，顺序跨 Surface 复用既有 nextScene，到达 Flow 位置。
    renderedItem(container, 'btn-flow').click()
    await settleNavigation()
    await vi.waitFor(() => expect(session.navigator.current?.locationId).toBe(payload.locations[2]!.id))
    expect(session.navigator.current).toMatchObject({ kind: 'flow', index: 2 })
    container.remove()
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
