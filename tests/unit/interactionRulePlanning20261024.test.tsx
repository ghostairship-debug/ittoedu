import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import type { SceneAutomationEditor } from '../../src/renderer/ui/InteractionEditor'
import { AutomationTab } from '../../src/renderer/ui/AutomationTab'
import { createInteractionAuthoringActions } from '../../src/renderer/interactions/commitInteractionAuthoring'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { componentSurfaces, type JsonValue } from '../../src/shared/contracts/component-platform/project'
import { componentRuleEdits, interactionBehavior, interactionRules } from '../../src/shared/componentInteractionData'
import type { InteractionRule } from '../../src/shared/interactionTypes'

const ui = vi.hoisted(() => ({ read: (): Record<string, unknown> => ({}), error: vi.fn(),
  editor: null as ComponentProps<typeof SceneAutomationEditor> | null }))
vi.mock('../../src/renderer/store/editorStore', () => ({
  useEditorStore: (selector: (state: Record<string, unknown>) => unknown) => selector(ui.read()),
  selectEditingScope: () => 'scene',
}))
// Keep the actual AutomationTab handlers and real Bridge/Session; only the child form is replaced.
vi.mock('../../src/renderer/ui/InteractionEditor', () => ({
  SceneAutomationEditor: (props: ComponentProps<typeof SceneAutomationEditor>) => { ui.editor = props; return null },
  InteractionEditor: () => null,
}))
vi.mock('../../src/renderer/ui/CourseLogicAuthoringPanel', () => ({ CourseLogicAuthoringPanel: () => null }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

const rule = (id: string, name = id): InteractionRule => ({ id, name, enabled: true,
  trigger: { type: 'scene.enter' }, conditions: [],
  actions: [{ id: `${id}-action`, start: 'after-previous', delayMs: 0, action: { type: 'scene.next' } }],
})
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue
async function fixture() {
  let project = createBlankCourseProjectV10('互动规划')
  const surfaceId = componentSurfaces(project)[0]!.id, owner = { kind: 'surface' as const, surfaceId }
  project = applyComponentOperation(project, captureComponentOperation(project, componentRuleEdits(project, owner, [rule('first', 'Base')])))
  const behaviorId = interactionBehavior(project, owner)!.id
  project.instances[surfaceId]!.container!.presentation = { states: [
    { id: 'named', title: '命名状态', overrides: { [behaviorId]: { data: json({ rules: [rule('first', 'Variant'), rule('only', 'Only variant')] }) } } },
    { id: 'other', title: '另一状态', overrides: { [behaviorId]: { data: json({ rules: [rule('first', 'Other')] }) } } },
  ] }
  const h = await createV10StoreHost(project)
  h.bridge.selectPresentationState(h.first.documentId, 'named', surfaceId)
  ui.read = () => ({ courseView: h.kernel.readView(), courseKernel: h.kernel,
    setCanvasMode: vi.fn(), setActiveTab: vi.fn(), setError: ui.error })
  const mounted = render(<AutomationTab />)
  const currentRules = () => interactionRules(interactionBehavior(h.kernel.captureTarget().editingProject, owner))
  const baseRules = () => interactionRules(interactionBehavior(h.model().project, owner))
  const gateway = new DocumentToolGateway(h.registry, [h.driver], () => crypto.randomUUID())
  await gateway.beginRun({ runId: 'rules', actor: 'agent', documents: [{ documentId: h.first.documentId, writable: [{ kind: 'document' }] }] })
  let sequence = 0
  const call = async (change: object) => {
    const target = await gateway.issueTarget('rules', h.first.documentId, { kind: 'course-surface', surfaceId, stateId: 'named' })
    await gateway.execute('rules', `read-${++sequence}`, { name: 'read', input: { target } })
    return gateway.execute('rules', `change-${sequence}`, { name: 'interaction.update', input: { target, change } })
  }
  return { ...h, mounted, owner, surfaceId, currentRules, baseRules, call, gateway,
    dispose: async () => { mounted.unmount(); await gateway.stop('rules'); h.bridge.dispose() } }
}

it('duplicates and deletes the current named rules through the real GUI and Gateway, with one Undo and no base-state writes', async () => {
  const h = await fixture(), initial = h.currentRules(), other = structuredClone(h.model().project.instances[h.surfaceId]!.container!.presentation!.states[1])
  try {
    const duplicate = async (entry: 'gui' | 'gateway') => {
      if (entry === 'gui') await act(async () => {
        ui.editor!.onDuplicateRule!('first')
        await vi.waitFor(() => expect(h.first.read().undoDepth).toBe(1))
      })
      else expect(await h.call({ kind: 'duplicate', ruleId: 'first' })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
      const copied = h.currentRules()[1]!
      expect(h.currentRules().map(value => value.name)).toEqual(['Variant', 'Variant 副本', 'Only variant'])
      expect(copied.id).not.toBe('first'); expect(copied.actions[0]!.id).not.toBe('first-action')
      expect(h.first.read().undoDepth).toBe(1)
      expect(h.baseRules()).toEqual([rule('first', 'Base')])
      expect(h.model().project.instances[h.surfaceId]!.container!.presentation!.states[1]).toEqual(other)
      await h.bridge.undo(); expect(h.currentRules()).toEqual(initial)
      if (entry === 'gui') await act(async () => {
        ui.editor!.onDeleteRule('only')
        await vi.waitFor(() => expect(h.currentRules()).toEqual([initial[0]]))
      })
      else expect(await h.call({ kind: 'remove', ruleId: 'only' })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
      expect(h.currentRules()).toEqual([initial[0]]); expect(h.first.read().undoDepth).toBe(1)
      await h.bridge.undo(); expect(h.currentRules()).toEqual(initial)
    }
    await duplicate('gui'); await duplicate('gateway')
    expect(h.driver.load(h.driver.serialize(h.model()))).toEqual(h.model())
  } finally { await h.dispose() }
})

it('keeps GUI patch and Gateway replacement explicit and aligns the retained authoring adapter with the named projection', async () => {
  const h = await fixture(), initial = h.currentRules()
  try {
    await act(async () => {
      ui.editor!.onUpdateRule('first', { name: 'Patched' })
      await vi.waitFor(() => expect(h.currentRules()[0]!.name).toBe('Patched'))
    })
    expect(h.currentRules()).toEqual([{ ...initial[0], name: 'Patched' }, initial[1]])
    expect(h.baseRules()).toEqual([rule('first', 'Base')]); await h.bridge.undo()
    const replacement = { ...rule('first', 'Replaced'), enabled: false, actions: [rule('replacement').actions[0]!] }
    const { id: _id, ...wireRule } = replacement
    expect(await h.call({ kind: 'update', ruleId: 'first', rule: wireRule })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    expect(h.currentRules()).toEqual([replacement, initial[1]])
    expect(h.first.read().undoDepth).toBe(1); await h.bridge.undo()
    const actions = createInteractionAuthoringActions({ kernel: h.kernel, capture: () => h.kernel.captureTarget() })
    expect(await actions.updateInteractionRule(h.surfaceId, 'only', { name: 'Adapter patch' })).toEqual({ ok: true, status: 'committed' })
    expect(h.currentRules()).toEqual([initial[0], { ...initial[1], name: 'Adapter patch' }])
    expect(h.baseRules()).toEqual([rule('first', 'Base')]); expect(h.first.read().undoDepth).toBe(1)
  } finally { await h.dispose() }
})

it('reports missing rules through GUI and Gateway without committing, and keeps global rules outside named overrides', async () => {
  const h = await fixture(), before = structuredClone(h.model().project)
  try {
    for (const kind of ['duplicate', 'remove'] as const) {
      await act(async () => { if (kind === 'duplicate') ui.editor!.onDuplicateRule!('missing'); else ui.editor!.onDeleteRule('missing') })
      expect(ui.error).toHaveBeenLastCalledWith(expect.stringContaining('互动规则已不存在'))
      expect(await h.call({ kind, ruleId: 'missing' })).toMatchObject({ kind: 'error', code: 'invalid-target' })
    }
    expect(h.model().project).toEqual(before); expect(h.first.read().undoDepth).toBe(0)
    fireEvent.change(screen.getByLabelText('互动作用范围'), { target: { value: 'global' } })
    await act(async () => {
      ui.editor!.onAddRule(rule('global'))
      await vi.waitFor(() => expect(h.first.read().undoDepth).toBe(1))
    })
    expect(interactionRules(interactionBehavior(h.model().project, { kind: 'project' }))).toEqual([rule('global')])
    expect(h.model().project.instances[h.surfaceId]).toEqual(before.instances[h.surfaceId])
    await h.bridge.undo(); expect(h.model().project).toEqual({ ...before, revision: h.model().project.revision })
  } finally { await h.dispose() }
})
