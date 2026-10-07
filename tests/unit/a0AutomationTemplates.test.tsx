// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import type { ComponentDefinition } from '../../src/shared/contracts/component-platform'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { createEditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import { interactionRules } from '../../src/renderer/interactions/componentInteractionAuthoring'
import { AutomationTab } from '../../src/renderer/ui/AutomationTab'

const store = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('../../src/renderer/store/editorStore', () => ({
  useEditorStore: (select: (state: Record<string, unknown>) => unknown) => select(store.state),
  selectEditingScope: (state: Record<string, unknown>) => state.editingScope,
}))
const fixtures: { bridge: CourseV10DocumentBridge; directory: string }[] = []
afterEach(async () => {
  cleanup()
  for (const { bridge, directory } of fixtures.splice(0)) {
    bridge.dispose()
    await fs.rm(directory, { recursive: true, force: true })
  }
})

async function fixture(scope: 'scene' | 'global' = 'scene', teacherSource?: boolean) {
  let serial = 0
  const project = createBlankCourseProjectV10('自动化成熟入口', () => `fixture-${++serial}`)
  const surface = project.surfaces[0], teacherId = project.global.overlay[0]
  project.instances[teacherId].visible = false
  if (teacherSource !== undefined) {
    const alias: ComponentDefinition = { id: 'library-teacher', role: 'mixed', professionalBuiltinKey: 'guoling.navigation',
      implementation: teacherSource ? { kind: 'source', language: 'javascript', source: 'export default {}' } : { kind: 'builtin', key: 'guoling.navigation' } }
    project.definitions[alias.id] = alias
    delete project.definitions['guoling.navigation']
    project.instances[teacherId].definitionId = alias.id
  }
  project.definitions.lesson = { id: 'lesson', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } }
  for (const id of ['first', 'second']) {
    project.instances[id] = { id, definitionId: 'lesson', name: id, data: {}, frame: { width: 100, height: 40, transform: [1, 0, 0, 1, 0, 0] } }
    surface.childIds.push(id)
  }
  surface.presentation = { states: [{ id: 'question', title: '问题', overrides: {} }, { id: 'answer', title: '答案', overrides: {} }] }
  for (const [id, target] of [['local', { kind: 'surface', surfaceId: surface.id }], ['global', { kind: 'project' }]] as const) {
    const definitionId = `library-${id}-rules`
    project.definitions[definitionId] = { id: definitionId, role: 'behavior', professionalBuiltinKey: 'guoling.interactions',
      implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } }
    project.instances[id] = { id, definitionId, attachments: [{ instanceId: id, target }], data: { rules: [{
      id: `existing-${id}`, enabled: true, trigger: { type: 'scene.enter' }, conditions: [],
      actions: [{ id: `existing-action-${id}`, start: 'after-previous', delayMs: 0, action: { type: 'node.enter', nodeId: 'first', effect: 'fade', durationMs: 240, easing: 'ease-out' } }],
    }] } }
    if (id === 'local') surface.childIds.push(id)
    else project.global.underlay.push(id)
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-a0-automation-'))
  const host = new DocumentHostService(directory), bridge = new CourseV10DocumentBridge()
  fixtures.push({ bridge, directory })
  const api: DocumentHostAPI = { ...host.internalAPI, bootstrapCourse: () => host.bootstrapCourse(),
    subscribe: listener => host.subscribeEvents(listener) } as DocumentHostAPI
  await bridge.connect(api)
  await bridge.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } })
  const documentId = bridge.read().activeDocumentId!
  bridge.selectPresentationState(documentId, 'question', surface.id)
  bridge.selectInstances(documentId, ['second'], surface.id)
  const kernel = createEditorStoreKernel({ bridge, commit: vi.fn() })
  const selectInstances = vi.spyOn(kernel, 'selectInstances'), editCaptured = vi.spyOn(kernel, 'editCaptured'), capture = vi.spyOn(kernel, 'capture')
  const setActiveTab = vi.fn(), setError = vi.fn()
  store.state = { courseView: bridge.read(), courseKernel: kernel, editingScope: scope, setActiveTab, setError, setCanvasMode: vi.fn() }
  return { project, teacherId, surfaceId: surface.id, documentId, kernel, selectInstances, editCaptured, capture,
    setActiveTab, setError, read: () => bridge.read().project!, readEditing: () => bridge.read().editingProject! }
}

it('selects an existing library rebound or source teacher controller instead of adding another one', async () => {
  for (const source of [false, true]) {
    const current = await fixture('scene', source)
    render(<AutomationTab />)
    fireEvent.click(screen.getByRole('button', { name: '编辑教师控制台' }))
    expect(current.selectInstances).toHaveBeenCalledWith([current.teacherId], current.surfaceId, current.documentId)
    expect(current.setActiveTab).toHaveBeenCalledWith('properties')
    expect(current.editCaptured).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '启用／关闭默认控制台' }))
    expect(current.editCaptured).toHaveBeenCalledOnce()
    await expect(current.editCaptured.mock.results[0].value).resolves.toMatchObject({ status: 'applied' })
    expect(current.read().instances[current.teacherId].data).toMatchObject({ enabled: false })
    expect(Object.keys(current.read().instances)).toEqual(Object.keys(current.project.instances))
    expect(current.read().instances[current.teacherId].definitionId).toBe('library-teacher')
    expect(current.setError).not.toHaveBeenCalled()
    cleanup()
  }
})

it('persists the current named-state condition for scene and global reveal templates while preserving targets and existing rules', async () => {
  for (const scope of ['scene', 'global'] as const) {
    const current = await fixture(scope), behaviorId = scope === 'scene' ? 'local' : 'global'
    const existing = structuredClone(interactionRules(current.project.instances[behaviorId]))
    const mounted = render(<AutomationTab />)
    fireEvent.change(screen.getByLabelText('常用规则模板'), { target: { value: 'scene-enter-sequence' } })
    fireEvent.click(screen.getByRole('button', { name: '使用模板' }))
    expect(current.editCaptured).toHaveBeenCalledOnce()
    await expect(current.editCaptured.mock.results[0].value).resolves.toMatchObject({ status: 'applied' })
    expect(interactionRules(current.readEditing().instances[behaviorId])).toHaveLength(2)
    const rules = interactionRules(current.readEditing().instances[behaviorId])
    expect(rules[0]).toEqual(existing[0])
    expect(rules[1].conditions).toEqual([
      ...(scope === 'global' ? [{ type: 'scene.in', sceneIds: [current.surfaceId] }] : []),
      { type: 'presentation.in', stateIds: ['question'] },
    ])
    expect(rules[1].actions.map(step => 'nodeId' in step.action ? step.action.nodeId : null)).toEqual(['first', 'second'])
    expect(current.capture.mock.calls[0][0]).toEqual([
      ...['first', 'second'].map(instanceId => ({ type: 'instance.patch', instanceId, patch: { playbackInitialVisibility: 'hidden' } })),
      { type: 'data.set', instanceId: behaviorId, path: ['rules'], value: rules },
    ])
    expect(current.readEditing().instances.first.playbackInitialVisibility).toBe('hidden')
    expect(current.readEditing().instances.second.playbackInitialVisibility).toBe('hidden')
    expect(current.selectInstances).not.toHaveBeenCalled()
    if (scope === 'scene') {
      fireEvent.click(screen.getByRole('button', { name: '使用模板' }))
      await expect(current.editCaptured.mock.results[1].value).resolves.toMatchObject({ status: 'applied' })
      const continued = interactionRules(current.readEditing().instances[behaviorId])
      expect(continued).toHaveLength(3)
      expect(continued.slice(0, 2)).toEqual(rules)
      store.state.courseView = current.kernel.readView()
      mounted.rerender(<AutomationTab />)
      fireEvent.change(within(screen.getByRole('group', { name: '规则 2' })).getByLabelText('规则名称'), { target: { value: '续编辑问题状态规则' } })
      await expect(current.editCaptured.mock.results[2].value).resolves.toMatchObject({ status: 'applied' })
      const edited = interactionRules(current.readEditing().instances[behaviorId])
      expect(edited).toHaveLength(3)
      expect(edited[1]).toEqual({ ...rules[1], name: '续编辑问题状态规则' })
      expect(edited[0]).toEqual(existing[0])
      expect(edited[2]).toEqual(continued[2])
    }
    expect(current.setError).not.toHaveBeenCalled()
    cleanup()
  }
})
