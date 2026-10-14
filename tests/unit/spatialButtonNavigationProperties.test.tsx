import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { PropertiesTab } from '../../src/renderer/ui/PropertiesTab'
import { InteractionEditor } from '../../src/renderer/ui/InteractionEditor'
import { componentInteractionView } from '../../src/renderer/interactions/componentInteractionAuthoring'
import { componentClickNavigationEdits, componentClickNavigationView, componentRuleEdits, interactionBehavior, interactionRules } from '../../src/shared/componentInteractionData'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { CourseProjectV10, ComponentTarget } from '../../src/shared/contracts/component-platform'
import { buttonNavigationProject } from '../helpers/buttonNavigationProject'
import { createV10StoreHost, deferred } from '../helpers/courseV10StoreHost'

const folders: string[] = []
afterEach(async () => { cleanup(); vi.restoreAllMocks(); useEditorStore.getState().courseBridge.dispose(); for (const folder of folders.splice(0)) await fs.rm(folder, { recursive: true, force: true }) })
async function mainHost(project: CourseProjectV10) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-button-camera-ui-')); folders.push(folder)
  const service = new DocumentHostService(path.join(folder, 'recovery'))
  const first = await service.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'UI')
  const unavailable = async (): Promise<never> => { throw new Error('No native dialog in isolated fixture') }
  const api: DocumentHostAPI = { ...service.internalAPI, bootstrapCourse: () => service.bootstrapCourse(), subscribe: listener => service.subscribeEvents(listener),
    close: unavailable, closeWithDialog: unavailable, saveWithDialog: unavailable, discardRecovery: unavailable }
  await useEditorStore.getState().connectCourseDocuments(api)
  const read = () => service.internalAPI.read(first.documentId)
  async function cold() { const file = path.join(folder, 'configured.glx'); await service.internalAPI.save(first.documentId, file); return new DocumentHostService(path.join(folder, 'cold')).internalAPI.open(file) }
  return { service, first, read, cold }
}
const rules = (project: CourseProjectV10, target: ComponentTarget) => interactionRules(interactionBehavior(project, target))
async function chooseJump(read: () => Promise<{ revision: number }>, base = 0) {
  fireEvent.change(screen.getByRole('combobox', { name: '点击动作' }), { target: { value: 'scene.go' } })
  await waitFor(async () => expect((await read()).revision).toBe(base + 1))
  await waitFor(() => expect(screen.getByRole('combobox', { name: '目标页面' })).not.toBeDisabled())
  fireEvent.change(screen.getByRole('combobox', { name: '目标页面' }), { target: { value: 'B' } })
  await waitFor(async () => expect((await read()).revision).toBe(base + 2))
  await waitFor(() => expect(screen.getByRole('combobox', { name: '进入镜头' })).not.toBeDisabled())
  fireEvent.change(screen.getByRole('combobox', { name: '进入镜头' }), { target: { value: 'b-last' } })
  await waitFor(async () => expect((await read()).revision).toBe(base + 3))
}
for (const kind of ['slide', 'flow', 'spatial'] as const) it(`actual ${kind} object properties creates no default rule and saves the explicit non-first camera through Main/cold open`, async () => {
  const project = buttonNavigationProject(kind), untouched = structuredClone(project.instances['global-button']), h = await mainHost(project)
  act(() => useEditorStore.getState().selectNode('button'))
  render(<PropertiesTab onReplaceImage={() => {}} />)
  expect(screen.getByTestId('component-click-navigation-properties')).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: '点击动作' })).toHaveValue('')
  expect((await h.read()).undoDepth).toBe(0); expect(rules(project, { kind: 'surface', surfaceId: 'A' })).toEqual([])
  await chooseJump(h.read)
  const saved = await h.read(), cold = await h.cold()
  expect(saved.undoDepth).toBe(3)
  if (cold.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(rules(cold.model.project, { kind: 'surface', surfaceId: 'A' })[0]).toMatchObject({ trigger: { type: 'node.click', nodeId: 'button' },
    actions: [{ action: { type: 'scene.go', sceneId: 'B', targetStateId: 'b-last' } }] })
  expect(cold.model.project.instances['global-button']).toEqual(untouched)
  await act(async () => useEditorStore.getState().courseBridge.undo(h.first.documentId))
  expect(screen.getByRole('combobox', { name: '进入镜头' })).toHaveValue('')
})
it('replaces a legacy page jump in place, preserves other actions/rules, and leaves conditional programs to the professional editor', () => {
  let project = buttonNavigationProject('slide')
  const target = { kind: 'surface' as const, surfaceId: 'A' }, other = { id: 'other', name: 'Other', enabled: true,
    trigger: { type: 'scene.enter' as const }, conditions: [], actions: [{ id: 'other-step', start: 'after-previous' as const, delayMs: 0, action: { type: 'course-state.set' as const, key: 'other', value: true } }] }
  const click = { id: 'click', name: 'Authored click', enabled: true, trigger: { type: 'node.click' as const, nodeId: 'button' }, conditions: [],
    actions: [{ id: 'kept', start: 'after-previous' as const, delayMs: 17, action: { type: 'course-state.set' as const, key: 'kept', value: true } },
      { id: 'nav', start: 'after-previous' as const, delayMs: 29, action: { type: 'location.go' as const, locationId: 'B' } }] }
  const apply = (edits: Parameters<typeof captureComponentOperation>[1]) => { const model = new CourseV10Driver().apply({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, captureComponentOperation(project, edits)); if (model.kind !== 'course-v10') throw new Error('Expected V10'); project = model.project }
  apply(componentRuleEdits(project, target, [click, other]))
  const authoring = () => ({ project, surfaceId: 'A', instanceId: 'button', activeStateId: null })
  expect(componentClickNavigationView(authoring()).action).toEqual({ type: 'scene.go', sceneId: 'B' })
  apply(componentClickNavigationEdits(authoring(), { type: 'scene.go', sceneId: 'B', targetStateId: 'b-last' }))
  expect(rules(project, target)[0].actions).toEqual([click.actions[0], { ...click.actions[1], action: { type: 'scene.go', sceneId: 'B', targetStateId: 'b-last' } }])
  expect(rules(project, target)[1]).toEqual(other)
  const conditional = { ...rules(project, target)[0], conditions: [{ type: 'scene.in' as const, sceneIds: ['A'] }] }
  apply(componentRuleEdits(project, target, [conditional, other]))
  const before = structuredClone(project)
  expect(componentClickNavigationView(authoring()).unavailableReason).toContain('带条件')
  expect(() => componentClickNavigationEdits(authoring(), null)).toThrow('带条件'); expect(project).toEqual(before)
})
it('actual global properties in a Slide named state keeps the project rule owner and respects a locked hotspot', async () => {
  const project = buttonNavigationProject('slide'); project.surfaces[0].presentation = { states: [{ id: 'state', title: 'Named', overrides: {} }] }
  const h = await mainHost(project)
  act(() => { useEditorStore.getState().courseBridge.selectPresentationState(h.first.documentId, 'state', 'A'); useEditorStore.getState().selectNode('global-button') })
  render(<PropertiesTab onReplaceImage={() => {}} />)
  expect(useEditorStore.getState().courseView.activeStateId).toBe('state')
  expect(screen.getByRole('combobox', { name: '点击动作' })).not.toBeDisabled()
  await chooseJump(h.read)
  const saved = await h.read(); if (saved.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(rules(saved.model.project, { kind: 'project' })[0].trigger).toEqual({ type: 'node.click', nodeId: 'global-button' })
  expect(saved.model.project.surfaces[0].presentation!.states[0].overrides).toEqual({})
  await act(async () => useEditorStore.getState().courseKernel.editCaptured(useEditorStore.getState().courseKernel.capture([
    { type: 'instance.patch', instanceId: 'global-button', patch: { locked: true } },
  ], useEditorStore.getState().courseKernel.captureTarget())))
  expect(screen.getByRole('combobox', { name: '点击动作' })).toBeDisabled()
})
it('teacher button properties uses the same page/camera choices and saves its explicit camera action', async () => {
  const project = buttonNavigationProject(), teacher = project.global.overlay[0], otherButtons = structuredClone((project.instances[teacher].data as any).buttons.slice(1)), h = await mainHost(project)
  act(() => useEditorStore.getState().selectNode(teacher)); render(<PropertiesTab onReplaceImage={() => {}} />)
  const summary = screen.getByText('按钮与动作', { selector: 'summary' })
  fireEvent.click(summary)
  const row = within(summary.closest('details')!.querySelector('fieldset')!)
  fireEvent.change(row.getByRole('combobox', { name: '点击动作' }), { target: { value: 'scene.go' } })
  await waitFor(async () => expect((await h.read()).revision).toBe(1))
  fireEvent.change(row.getByRole('combobox', { name: '目标页面' }), { target: { value: 'B' } })
  await waitFor(async () => expect((await h.read()).revision).toBe(2))
  fireEvent.change(row.getByRole('combobox', { name: '进入镜头' }), { target: { value: 'b-last' } })
  await waitFor(async () => expect((await h.read()).revision).toBe(3))
  const cold = await h.cold(); if (cold.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect((cold.model.project.instances[teacher].data as any).buttons[0].action).toEqual({ type: 'scene.go', sceneId: 'B', targetStateId: 'b-last' })
  expect((cold.model.project.instances[teacher].data as any).buttons.slice(1)).toEqual(otherButtons)
})
it('a delayed property ACK keeps the captured hotspot after selection changes', async () => {
  const h = await createV10StoreHost(buttonNavigationProject(), undefined, false)
  await useEditorStore.getState().connectCourseDocuments(h.api)
  act(() => useEditorStore.getState().selectNode('button')); render(<PropertiesTab onReplaceImage={() => {}} />)
  const kernel = useEditorStore.getState().courseKernel, original = kernel.editCaptured.bind(kernel), gate = deferred()
  vi.spyOn(kernel, 'editCaptured').mockImplementationOnce(async captured => { await gate.promise; return original(captured) })
  fireEvent.change(screen.getByRole('combobox', { name: '点击动作' }), { target: { value: 'scene.go' } })
  expect(h.first.read().revision).toBe(0)
  act(() => useEditorStore.getState().selectNode('global-button'))
  await act(async () => { gate.resolve() })
  await waitFor(() => expect(h.first.read().revision).toBe(1))
  expect(rules(h.model().project, { kind: 'surface', surfaceId: 'A' })[0].trigger).toEqual({ type: 'node.click', nodeId: 'button' })
  expect(rules(h.model().project, { kind: 'project' })).toEqual([])
})
it('the professional click editor lists real Spatial frames separately from presentation states', () => {
  const project = buttonNavigationProject(), target = { kind: 'surface' as const, surfaceId: 'A' }
  const result = new CourseV10Driver().apply({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, captureComponentOperation(project,
    componentClickNavigationEdits({ project, surfaceId: 'A', instanceId: 'button', activeStateId: null }, { type: 'scene.go', sceneId: 'B' })))
  if (result.kind !== 'course-v10') throw new Error('Expected V10')
  const view = componentInteractionView(result.project, target.surfaceId), update = vi.fn()
  render(<InteractionEditor scene={view.scene} selectedNode={view.nodes.find(node => node.id === 'button')!} activeStateId={null}
    scenes={view.scenes} locations={view.locations} sounds={view.sounds} onAddRule={() => {}} onUpdateRule={update} onDeleteRule={() => {}} />)
  expect(screen.getByRole('combobox', { name: '进入镜头' })).toHaveTextContent('B last')
  expect(view.scenes[1].presentation).toBeUndefined()
  fireEvent.change(screen.getByRole('combobox', { name: '进入镜头' }), { target: { value: 'b-last' } })
  expect(update.mock.calls[0][1].actions[0].action).toEqual({ type: 'scene.go', sceneId: 'B', targetStateId: 'b-last' })
})
