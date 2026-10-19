import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { componentEntranceMotionEdits, componentExitMotionEdits, componentMotionPropertiesView, DEFAULT_COMPONENT_MOTION } from '../../src/shared/componentMotionAuthoring'
import { componentRuleEdits, interactionBehavior, interactionRules } from '../../src/shared/componentInteractionData'
import { PropertiesTab } from '../../src/renderer/ui/PropertiesTab'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { TEXT_DEFINITION, createTextData } from '../../src/components/text'
import { resolveComponentPresentation, type CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import type { InteractionRule } from '../../src/shared/interactionTypes'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
import { onComponentMotionPreview } from '../../src/renderer/interactions/componentMotionPreview'
import { ComponentPlatformRuntime } from '../../src/player/components/ComponentPlatformRuntime'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import { discardPropertiesDrafts, hasPropertiesDrafts, PropertyDraftBoundary } from '../../src/renderer/ui/properties/PropertyControls'
import { ComponentMotionProperties, type ComponentMotionPropertiesContext } from '../../src/renderer/ui/properties/ComponentMotionProperties'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
function fixture() {
  const project = createBlankCourseProjectV10('动效属性'), surfaceId = project.surfaces[0]!.id
  project.definitions.text = { ...TEXT_DEFINITION, id: 'text' }
  project.instances.text = { id: 'text', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextData('点击内容'))),
    frame: { width: 240, height: 80, transform: [1, 0, 0, 1, 20, 40] } }
  project.surfaces[0]!.childIds.push('text')
  return { project, surfaceId, instanceId: 'text', activeStateId: null }
}
function apply(project: CourseProjectV10, edits: Parameters<typeof captureComponentOperation>[1]) {
  return applyComponentOperation(project, captureComponentOperation(project, edits))
}
it('writes presets to the ordinary V10 rule owner, retains identities, and disables without hiding the object', () => {
  const target = fixture(), before = structuredClone(target.project.instances.text)
  let project = apply(target.project, componentEntranceMotionEdits(target, DEFAULT_COMPONENT_MOTION, true))
  const initial = componentMotionPropertiesView({ ...target, project }).entrance!
  expect(initial.config).toEqual(DEFAULT_COMPONENT_MOTION)
  expect(project.instances.text).toEqual(before)
  expect(interactionRules(interactionBehavior(project, { kind: 'surface', surfaceId: target.surfaceId }))[0]).toMatchObject({
    enabled: true, trigger: { type: 'node.activated', nodeId: 'text' }, actions: [{ action: { type: 'node.enter', effect: 'fade' } }],
  })
  project = apply(project, componentEntranceMotionEdits({ ...target, project }, { ...DEFAULT_COMPONENT_MOTION, effect: 'slide', direction: 'right', durationMs: 450, delayMs: 120 }, true))
  expect(componentMotionPropertiesView({ ...target, project }).entrance).toMatchObject({ ruleId: initial.ruleId, stepId: initial.stepId,
    config: { effect: 'slide', direction: 'right', durationMs: 450, delayMs: 120 } })
  project = apply(project, componentEntranceMotionEdits({ ...target, project }, DEFAULT_COMPONENT_MOTION, false))
  expect(componentMotionPropertiesView({ ...target, project }).entrance).toMatchObject({ enabled: false, ruleId: initial.ruleId, stepId: initial.stepId })
  expect(project.instances.text).toEqual(before)
})
it('retains explicit exit triggers, conditions, sibling actions and completion references while editing parameters', () => {
  const target = fixture(), owner = { kind: 'surface' as const, surfaceId: target.surfaceId }
  const rules: InteractionRule[] = [{ id: 'exit-rule', name: '按钮反馈', enabled: true,
    trigger: { type: 'node.click', nodeId: 'text' }, conditions: [], actions: [
      { id: 'state-step', start: 'after-previous', delayMs: 0, action: { type: 'course-state.set', key: 'clicked', value: true } },
      { id: 'exit-step', start: 'after-previous', delayMs: 200, action: { type: 'node.exit', nodeId: 'text', effect: 'fade', durationMs: 320, easing: 'ease-out' } },
    ] }, { id: 'completed', enabled: true, trigger: { type: 'animation.completed', actionId: 'exit-step' }, conditions: [],
    actions: [{ id: 'done-step', start: 'after-previous', delayMs: 0, action: { type: 'course-state.set', key: 'done', value: true } }] }]
  const project = apply(target.project, componentRuleEdits(target.project, owner, rules)), view = componentMotionPropertiesView({ ...target, project })
  expect(view.exits).toHaveLength(1)
  const updated = apply(project, componentExitMotionEdits({ ...target, project }, view.exits[0]!, { effect: 'none', durationMs: 100, easing: 'linear', delayMs: 20 }))
  const actual = interactionRules(interactionBehavior(updated, owner)), expected = structuredClone(rules)
  expected[0]!.actions[1] = { ...expected[0]!.actions[1]!, delayMs: 20, action: { type: 'node.exit', nodeId: 'text', effect: 'none', durationMs: 0, easing: 'linear' } }
  expect(actual).toEqual(expected)
  expect(componentMotionPropertiesView(target).exits).toEqual([])
})
it('keeps state entrance rules in their authored scope and leaves advanced entrance programs to the rule editor', () => {
  const base = fixture()
  base.project.surfaces[0]!.presentation = { states: [{ id: 'state', title: '状态', overrides: {} }] }
  const target = { ...base, activeStateId: 'state' }
  const project = apply(target.project, componentEntranceMotionEdits(target, DEFAULT_COMPONENT_MOTION, true))
  expect(componentMotionPropertiesView({ ...target, project }).entrance).not.toBeNull()
  expect(componentMotionPropertiesView({ ...base, project }).entrance).toBeNull()
  const owner = { kind: 'surface' as const, surfaceId: target.surfaceId }
  const rule = interactionRules(interactionBehavior(project, owner))[0]!
  const advanced = apply(project, componentRuleEdits(project, owner, [{ ...rule, conditions: [{ type: 'course-state.exists', key: 'ready', exists: true }] }]))
  expect(componentMotionPropertiesView({ ...base, project: advanced }).entranceUnavailableReason).toContain('已有条件或编排')
  expect(() => componentEntranceMotionEdits({ ...base, project: advanced }, DEFAULT_COMPONENT_MOTION, true)).toThrow('已有条件或编排')
})
it('runs an enabled entrance from real World activation through the existing host Motion and keeps a disabled entrance visible', async () => {
  const target = fixture()
  for (const enabled of [true, false]) {
    const configured = apply(target.project, componentEntranceMotionEdits(target, DEFAULT_COMPONENT_MOTION, true))
    const project = enabled ? configured : apply(configured, componentEntranceMotionEdits({ ...target, project: configured }, DEFAULT_COMPONENT_MOTION, false))
    const navigation = new ComponentNavigationOwner({ project: () => project, surfaceId: () => target.surfaceId, select() {} })
    const world = new ComponentPlatformRuntime(`motion-properties-${enabled}`, { teacherController: navigation })
    const root = document.createElement('div'), cancel = vi.fn(), animate = vi.fn(() => ({ finished: Promise.resolve(), cancel }))
    Object.defineProperty(root, 'animate', { value: animate })
    document.body.append(root); world.bind('text', root); world.bindTarget('text', root)
    try {
      await world.sync(project, { assets: {}, components: {} })
      if (enabled) await waitFor(() => expect(animate).toHaveBeenCalled())
      else { await Promise.resolve(); expect(animate).not.toHaveBeenCalled() }
      expect(root.hidden).toBe(false)
      if (enabled) expect(animate.mock.calls[0]).toEqual([
        [{ offset: undefined, easing: undefined, transform: 'none' }, { offset: undefined, easing: undefined, transform: 'none' }],
        expect.objectContaining({ duration: 320, easing: 'ease-out' }),
      ])
    } finally { await world.dispose(); navigation.dispose(); root.remove() }
  }
})
it.each([null, 'state'])('connects PropertiesTab in %s scope to canonical edits, host preview, undo and archive reload', async activeStateId => {
  const target = { ...fixture(), activeStateId }
  if (activeStateId) target.project.surfaces[0]!.presentation = { states: [{ id: activeStateId, title: '当前状态', overrides: {} }] }
  const host = await createV10StoreHost(target.project), previews = vi.fn(), stop = onComponentMotionPreview(previews)
  await useEditorStore.getState().connectCourseDocuments(host.api)
  if (activeStateId) useEditorStore.getState().courseBridge.selectPresentationState(host.first.documentId, activeStateId, target.surfaceId)
  useEditorStore.getState().selectNode('text')
  const view = () => componentMotionPropertiesView({ ...target, project: resolveComponentPresentation(host.model().project, target.surfaceId, activeStateId) })
  try {
    render(<PropertiesTab onReplaceImage={() => {}} />)
    fireEvent.click(screen.getByRole('checkbox', { name: '启用进入时出现' }))
    await waitFor(() => expect(view().entrance?.enabled).toBe(true))
    fireEvent.change(screen.getByRole('combobox', { name: '进入效果' }), { target: { value: 'none' } })
    await waitFor(() => expect(view().entrance?.config).toMatchObject({ effect: 'none', durationMs: 0 }))
    fireEvent.change(screen.getByRole('combobox', { name: '进入效果' }), { target: { value: 'scale' } })
    await waitFor(() => expect(view().entrance?.config).toMatchObject({ effect: 'scale', durationMs: 320 }))
    const duration = screen.getByLabelText('进入时长（毫秒）')
    fireEvent.focus(duration); fireEvent.change(duration, { target: { value: '475' } }); fireEvent.blur(duration)
    await waitFor(() => expect(view().entrance?.config.durationMs).toBe(475))
    expect(screen.getByLabelText('进入时长（毫秒）')).toHaveValue('475')
    fireEvent.click(screen.getByRole('button', { name: '预览进入' }))
    expect(previews).toHaveBeenCalledOnce()
    expect(previews.mock.calls[0]![0]).toMatchObject({ target: { documentId: host.first.documentId, instanceId: 'text' },
      action: { type: 'node.enter', nodeId: 'text', effect: 'scale', durationMs: 475 }, delayMs: 0 })
    expect(screen.queryByRole('button', { name: '预览退出' })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: '启用进入时出现' }))
    await waitFor(() => expect(view().entrance?.enabled).toBe(false))
    await act(async () => { await useEditorStore.getState().courseKernel.navigateHistory('undo') })
    expect(screen.getByRole('checkbox', { name: '启用进入时出现' })).toBeChecked()
    await host.api.save(host.first.documentId, 'motion.glx')
    const loaded = await host.driver.load(host.disk.get('motion.glx')!)
    if (loaded.kind !== 'course-v10') throw new Error('Expected V10')
    expect(componentMotionPropertiesView({ ...target, project: resolveComponentPresentation(loaded.project, target.surfaceId, activeStateId) }).entrance)
      .toMatchObject({ enabled: true, config: { effect: 'scale', durationMs: 475 } })
    expect(loaded.project.instances.text).toEqual(target.project.instances.text)
  } finally { stop(); useEditorStore.getState().courseBridge.dispose(); host.bridge.dispose() }
})
it('keeps surface-owned programs on their actual page while project-owned motion stays global', () => {
  const target = fixture(), a = target.surfaceId
  target.project.surfaces.push({ id: 'b', kind: 'slide', title: 'B', childIds: [] })
  target.project.surfaces[0]!.childIds = []
  target.project.global.overlay = ['text']
  const rule: InteractionRule = { id: 'b-enter', enabled: true, trigger: { type: 'node.activated', nodeId: 'text' }, conditions: [],
    actions: [{ id: 'b-enter-step', start: 'after-previous', delayMs: 0, action: { type: 'node.enter', nodeId: 'text', effect: 'fade', durationMs: 900, easing: 'linear' } }] }
  let project = apply(target.project, componentRuleEdits(target.project, { kind: 'surface', surfaceId: 'b' }, [rule]))
  expect(componentMotionPropertiesView({ ...target, project }).entrance).toBeNull()
  expect(componentMotionPropertiesView({ ...target, project, surfaceId: 'b' }).entrance?.config.durationMs).toBe(900)
  project = apply(project, componentRuleEdits(project, { kind: 'surface', surfaceId: a }, [{ ...rule, id: 'a-enter', actions: [{ ...rule.actions[0]!, id: 'a-step' }] }]))
  expect(componentMotionPropertiesView({ ...target, project }).entrance?.ruleId).toBe('a-enter')
  expect(componentMotionPropertiesView({ ...target, project }).entranceUnavailableReason).toBeNull()
})
it('keeps a rejected numeric draft until the canonical commit succeeds', async () => {
  const target = fixture(), configured = apply(target.project, componentEntranceMotionEdits(target, DEFAULT_COMPONENT_MOTION, true))
  const host = await createV10StoreHost(configured)
  await useEditorStore.getState().connectCourseDocuments(host.api); useEditorStore.getState().selectNode('text')
  try {
    host.controls.before = async () => { throw new Error('提交被拒绝，保留当前输入') }
    render(<PropertiesTab onReplaceImage={() => {}} />)
    const duration = screen.getByLabelText('进入时长（毫秒）')
    fireEvent.focus(duration); fireEvent.change(duration, { target: { value: '475' } }); fireEvent.blur(duration)
    await waitFor(() => expect(duration).toHaveAttribute('aria-invalid', 'true'))
    expect(duration).toHaveValue('475'); expect(hasPropertiesDrafts(host.first.documentId)).toBe(true)
    expect(componentMotionPropertiesView({ ...target, project: host.model().project }).entrance?.config.durationMs).toBe(320)
  } finally { discardPropertiesDrafts(host.first.documentId); useEditorStore.getState().courseBridge.dispose(); host.bridge.dispose() }
})
it('keeps buffered exit drafts bound to stable action identities after rule reordering', async () => {
  const changed = vi.fn(), config = { ...DEFAULT_COMPONENT_MOTION }
  const exit = (id: string) => ({ behaviorId: 'behavior', ruleId: `rule-${id}`, stepId: id, label: id, enabled: true, config })
  const a = exit('a'), b = exit('b'), context: ComponentMotionPropertiesContext = { entrance: null, entranceUnavailableReason: null,
    exits: [a, b], disabled: false, instanceId: 'text', onChangeEntrance() {}, onChangeExit: changed, onPreview() {}, onOpenProfessional() {}, onOpenSource() {} }
  const bindingKey = JSON.stringify(['motion-draft', 'epoch', 'surface', null, ['text'], false])
  const form = (exits: typeof context.exits) => <PropertyDraftBoundary bindingKey={bindingKey} onStale={() => {}}>
    <ComponentMotionProperties context={{ ...context, exits }} /></PropertyDraftBoundary>
  const ui = render(form([a, b])), first = screen.getAllByLabelText('退出时长（毫秒）')[0]!
  fireEvent.focus(first); fireEvent.change(first, { target: { value: '475' } }); ui.unmount()
  render(form([b, a]))
  expect(screen.getAllByLabelText('退出时长（毫秒）')[0]).toHaveValue('320')
  const restored = screen.getAllByLabelText('退出时长（毫秒）')[1]!
  expect(restored).toHaveValue('475'); fireEvent.blur(restored)
  await waitFor(() => expect(changed).toHaveBeenCalledWith(a, { ...config, durationMs: 475 }))
  discardPropertiesDrafts('motion-draft')
})
