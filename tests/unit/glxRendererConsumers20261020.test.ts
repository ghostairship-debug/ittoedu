import { beforeAll as prepareProgramSourceForTests } from 'vitest'
import { loadBuiltinComponentSource } from '../../src/core/components/source/builtinSources'
prepareProgramSourceForTests(async () => { await loadBuiltinComponentSource('guoling.html-program') })
import { describe, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10, createBlankProgramProject } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { createCourseLifecycleSlice, createCourseProjectContent } from '../../src/renderer/store/slices/courseLifecycleSlice'
import { assertFlowStructureEditsAllowed } from '../../src/renderer/authoring/flowStructureEdits'
import { createCourseDocumentClipboardContext, readCourseDocumentClipboardContext } from '../../src/renderer/document/documentClipboardContext'
import { captureCourseInsertionTarget, insertCourseElement } from '../../src/renderer/media/commitCourseMediaAuthoring'
import { componentContainerBuiltinKey, createComponentContainerInstance, owningContainer } from '../../src/shared/contracts/component-platform/project'
import { componentContainers } from '../../src/shared/contracts/component-platform/project'
import { TEXT_DEFINITION, createTextData } from '../../src/components/text'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform/operations'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
import { createCourseStructureSlice } from '../../src/renderer/store/slices/courseStructureSlice'
import { componentInteractionView } from '../../src/renderer/interactions/componentInteractionAuthoring'
import { INTERACTIONS_DEFINITION } from '../../src/shared/componentInteractionData'
import { IMAGE_DEFINITION, createImageData } from '../../src/components/image'
import { prepareCourseObjectPaste } from '../../src/core/course/courseObjectEdits'
import { createCrossSurfaceCommands } from '../../src/renderer/composition/crossSurfaceCommands'

function nestedFlow() {
  const project = createBlankCourseProjectV10('嵌套正文'), slide = project.instances[project.rootIds[0]]
  const definitionId = componentContainerBuiltinKey('flow')
  project.definitions[definitionId] = { id: definitionId, role: 'mixed', title: '正文', implementation: { kind: 'builtin', key: definitionId } }
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.flow = createComponentContainerInstance({ id: 'flow', kind: 'flow', title: '正文', childIds: ['text', 'peer'],
    flow: { layout: { widthMode: 'reading', readingWidth: 800, wideContentWidth: 1100 } } }, definitionId)
  for (const id of ['text', 'peer']) project.instances[id] = { id, definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextData(id))) }
  slide.childIds!.push('flow')
  return project
}

function nestedSlide() {
  const project = nestedFlow(), definitionId = componentContainerBuiltinKey('slide')
  project.instances.flow.definitionId = definitionId
  project.instances.flow.container = { kind: 'slide', presentation: { states: [{ id: 'local', title: '强调',
    overrides: { text: { visible: false }, peer: { visible: false } } }], initialStateId: 'local' } }
  return project
}

describe('Project 11 renderer consumers preserve existing authoring paths', () => {
  it('creates each existing default workspace through canonical container data', () => {
    for (const kind of ['slide', 'flow', 'spatial'] as const) {
      const model = { kind: 'course-v10' as const, ...createCourseProjectContent(kind, { width: 1440, height: 900 }) }
      new CourseV10Driver().validate(model)
      const root = model.project.instances[model.project.rootIds[0]]
      expect(root.container?.kind).toBe(kind)
      expect(root.definitionId).toBe(componentContainerBuiltinKey(kind))
      expect(model.project).not.toHaveProperty('surfaces')
      if (kind === 'slide') expect(root.container?.designSize).toEqual({ width: 1440, height: 900 })
      if (kind === 'flow') expect(root.container?.flow?.layout.readingWidth).toBe(1280)
      if (kind === 'spatial') expect(root.container?.spatial?.home).toEqual({ x: 0, y: 0, zoom: 1 })
    }
  })

  it('keeps locked Flow paragraphs passive when a neighbor is inserted, including the surface alias', () => {
    const project = nestedFlow()
    project.instances.text.locked = true
    const edits: ComponentEdit[] = [
      { type: 'instance.insert', container: { kind: 'instance', instanceId: 'flow' }, index: 0, rootIds: ['new'],
        instances: [{ id: 'new', definitionId: TEXT_DEFINITION.id, data: {} }] },
      { type: 'instance.move', instanceId: 'text', container: { kind: 'surface', surfaceId: 'flow' }, index: 1 },
    ]
    expect(() => assertFlowStructureEditsAllowed(project, edits, true)).not.toThrow()
    expect(() => assertFlowStructureEditsAllowed(project, [{ type: 'instance.move', instanceId: 'text',
      container: { kind: 'instance', instanceId: 'flow' }, index: 1 }], true)).toThrow('对象已锁定')
  })

  it('round trips only selected content with its nearest Flow context', () => {
    const project = nestedFlow()
    project.definitions.behavior = { id: 'behavior', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interactions' } }
    project.instances.behavior = { id: 'behavior', definitionId: 'behavior', data: { rules: [] } }
    project.instances.flow.childIds!.push('behavior')
    project.instances.flow.attachments = [{ instanceId: 'behavior', target: { kind: 'instance', instanceId: 'flow' } }]
    const context = createCourseDocumentClipboardContext({ project, roots: ['text'], resources: { assets: {}, components: {} } })
    const restored = readCourseDocumentClipboardContext(JSON.parse(JSON.stringify(context)))
    expect(restored.roots).toEqual(['text'])
    expect(restored.project.rootIds).toEqual(['flow'])
    expect(Object.keys(restored.project.instances).sort()).toEqual(['flow', 'text'])
    expect(owningContainer(restored.project, 'text')).toEqual({ kind: 'instance', instanceId: 'flow' })
    expect(restored.project.instances.flow.container?.flow).toEqual(project.instances.flow.container?.flow)
    expect(restored.project.instances.flow.container).not.toHaveProperty('presentation')
    expect(restored.project.instances.flow.attachments).toEqual([])
    expect(project.instances.flow.childIds).toEqual(['text', 'peer', 'behavior'])
  })

  it('inserts into an existing program root and retains one formal undo/redo history', async () => {
    const project = createBlankProgramProject('程序'), initialRootId = project.rootIds[0], rootId = 'second-program'
    project.instances[rootId] = { ...structuredClone(project.instances[initialRootId]), id: rootId, name: '第二个程序' }
    project.rootIds.push(rootId)
    const host = await createV10StoreHost(project)
    try {
      host.kernel.selectSurface(rootId)
      const target = captureCourseInsertionTarget(host.kernel)
      expect(target.surfaceId).toBeNull()
      expect(target.rootInstanceId).toBe(rootId)
      const result = await insertCourseElement(host.kernel, target, 'text')
      expect(result.surfaceId).toBeNull()
      expect(host.model().project.instances[rootId].childIds).toEqual(result.instanceIds)
      expect(host.model().project.rootIds).toEqual([initialRootId, rootId])
      expect(host.model().project.instances[initialRootId].childIds).toBeUndefined()
      await host.bridge.undo(target.documentId)
      expect(host.model().project.instances[result.instanceIds[0]]).toBeUndefined()
      await host.bridge.redo(target.documentId)
      expect(host.model().project.instances[rootId].childIds).toEqual(result.instanceIds)
      const commands = createCrossSurfaceCommands({ kernel: host.kernel, slide: {}, flow: {}, spatial: {},
        shell: { read: () => ({ canvasMode: 'edit', editingTextNodeId: null, editingScope: 'scene' }), patch() {} },
        structure: createCourseStructureSlice(host.kernel, { readActiveLocationId: () => null }),
        lifecycle: createCourseLifecycleSlice(host.kernel, { bridge: host.bridge, read: () => ({ projectPath: null, dirty: false }), patch() {} }) })
      expect(commands.createLiveEditorSelectionSnapshot()).toMatchObject({ surfaceKind: 'program', locationId: rootId })
      expect(commands.routeEditorAction('select-all')).toMatchObject({ ok: true, adapter: 'program' })
      expect(host.bridge.read().selectedInstanceIds).toEqual(result.instanceIds)
      expect(commands.routeEditorAction('duplicate')).toMatchObject({ ok: true, adapter: 'program' })
      await vi.waitFor(() => expect(host.model().project.instances[rootId].childIds).toHaveLength(2))
      expect(host.model().project.instances[initialRootId].childIds).toBeUndefined()
      await host.bridge.undo(target.documentId)
      expect(host.model().project.instances[rootId].childIds).toEqual(result.instanceIds)
    } finally { host.bridge.dispose() }
  })

  it('preserves actual root order while adding and reordering pages around program roots', async () => {
    const project = createBlankCourseProjectV10(), first = project.rootIds[0], second = 'second-slide'
    project.instances[second] = { ...structuredClone(project.instances[first]), id: second }
    const program = createBlankProgramProject('程序'), programId = program.rootIds[0]
    Object.assign(project.instances, program.instances); Object.assign(project.definitions, program.definitions)
    project.rootIds = [first, programId, second]
    const host = await createV10StoreHost(project)
    try {
      const structure = createCourseStructureSlice(host.kernel, { readActiveLocationId: () => second })
      const added = await structure.addCourseContent('scene', { surfaceId: second })
      expect(added).toMatchObject({ ok: true })
      expect(host.model().project.rootIds).toEqual([first, programId, second, added.activatedLocationId])
      expect(await structure.reorderCourseSurfaces([added.activatedLocationId!, first, second])).toMatchObject({ ok: true })
      expect(host.model().project.rootIds).toEqual([added.activatedLocationId, programId, first, second])
    } finally { host.bridge.dispose() }
  })

  it('retains only the course state used by copied global interaction rules', () => {
    const project = nestedFlow()
    project.definitions[INTERACTIONS_DEFINITION.id] = INTERACTIONS_DEFINITION
    project.instances.behavior = { id: 'behavior', definitionId: INTERACTIONS_DEFINITION.id,
      attachments: [{ instanceId: 'behavior', target: { kind: 'project' } }], data: { rules: [{ id: 'click', name: '点击', enabled: true,
        trigger: { type: 'node.click', nodeId: 'text' }, conditions: [], actions: [{ id: 'step', start: 'after-previous', delayMs: 0,
          action: { type: 'course-state.set', key: 'selected', value: true } }] }] } }
    project.global.underlay.push('behavior')
    project.logic = { courseState: [{ key: 'selected', valueType: 'boolean', defaultValue: false },
      { key: 'unrelated', valueType: 'string', defaultValue: '不复制' }], navigationGuards: [] }
    const context = createCourseDocumentClipboardContext({ project, roots: ['text'], resources: { assets: {}, components: {} } })
    expect(context.project.global.underlay).toEqual(['behavior'])
    expect(context.project.logic?.courseState).toEqual([project.logic.courseState[0]])
    expect(readCourseDocumentClipboardContext(context).project.instances.behavior).toBeDefined()
  })

  it('preserves resources used only by a copied image named state through actual paste', async () => {
    const source = nestedSlide()
    source.definitions[IMAGE_DEFINITION.id] = IMAGE_DEFINITION
    source.instances.image = { id: 'image', definitionId: IMAGE_DEFINITION.id, data: JSON.parse(JSON.stringify(createImageData('base'))) }
    source.instances.flow.childIds!.push('image')
    source.instances.flow.container!.presentation!.states[0].overrides.image = { data: JSON.parse(JSON.stringify(createImageData('variant'))) }
    for (const id of ['base', 'variant']) source.assets[id] = { id, path: `assets/${id}.png`, mimeType: 'image/png' }
    const resources = { assets: { base: Uint8Array.of(1, 2), variant: Uint8Array.of(3, 4) }, components: {} }
    const context = createCourseDocumentClipboardContext({ project: source, roots: ['image'], resources })
    expect(context.resources.assets.variant).toEqual([3, 4])
    const host = await createV10StoreHost(createBlankCourseProjectV10())
    try {
      const target = host.kernel.captureTarget(), restored = readCourseDocumentClipboardContext(context)
      const plan = prepareCourseObjectPaste(restored, { capturedTarget: target,
        container: { kind: 'instance', instanceId: target.surfaceId! }, index: 0 })
      await host.kernel.editCaptured(host.kernel.capture(plan.edits, target))
      const variantId = plan.assetIds.get('variant')!
      expect(variantId).toBeDefined()
      expect(Array.from(host.model().resources.assets[variantId])).toEqual(Array.from(resources.assets.variant))
      expect(componentContainers(host.model().project).flatMap(container => container.presentation?.states ?? [])
        .some(state => (state.overrides[plan.rootIds[0]]?.data as { assetId?: string })?.assetId === variantId)).toBe(true)
    } finally { host.bridge.dispose() }
  })

  it('offers actual program roots and local interaction targets without requiring a presentation container', () => {
    const project = createBlankProgramProject('程序'), rootId = project.rootIds[0]
    const view = componentInteractionView(project, rootId)
    expect(view.target).toEqual({ kind: 'instance', instanceId: rootId })
    expect(view.nodes.map(node => node.id)).toContain(rootId)
    expect(view.scene).not.toHaveProperty('presentation')
    expect(view.scenes).toEqual([{ id: rootId, name: '程序' }])
    expect(view.locations).toEqual([{ id: rootId, label: '程序' }])
  })

  it('keeps a program root only as local clipboard scope when copying one native child with its rules', () => {
    const project = createBlankProgramProject('程序'), rootId = project.rootIds[0]
    project.instances[rootId].data = { html: '<h1>不复制的程序正文</h1>', css: '' }
    project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
    project.definitions[INTERACTIONS_DEFINITION.id] = INTERACTIONS_DEFINITION
    project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextData('仅复制对象'))) }
    project.instances.behavior = { id: 'behavior', definitionId: INTERACTIONS_DEFINITION.id,
      attachments: [{ instanceId: 'behavior', target: { kind: 'instance', instanceId: rootId } }], data: { rules: [{ id: 'click', name: '点击', enabled: true,
        trigger: { type: 'node.click', nodeId: 'text' }, conditions: [], actions: [{ id: 'step', start: 'after-previous', delayMs: 0,
          action: { type: 'node.exit', nodeId: 'text', effect: 'fade', durationMs: 200, easing: 'ease-out' } }] }] } }
    project.instances[rootId].childIds = ['text', 'behavior']
    const context = createCourseDocumentClipboardContext({ project, roots: ['text'], resources: { assets: {}, components: {} } })
    expect(context.roots).toEqual(['text'])
    expect(context.project.rootIds).toEqual([rootId])
    expect(context.project.instances[rootId].data).toEqual({})
    expect(context.project.instances[rootId].childIds).toEqual(['text', 'behavior'])
    expect(readCourseDocumentClipboardContext(context).project.instances.behavior.attachments?.[0].target).toEqual({ kind: 'instance', instanceId: rootId })
    expect(project.instances[rootId].data).toEqual({ html: '<h1>不复制的程序正文</h1>', css: '' })
  })

  it('copies a state-only local rule family without enabling it in the base or copying unrelated rules', async () => {
    const project = nestedSlide(), selectedData = structuredClone(project.instances.text.data)
    project.definitions[INTERACTIONS_DEFINITION.id] = INTERACTIONS_DEFINITION
    project.instances.behavior = { id: 'behavior', definitionId: INTERACTIONS_DEFINITION.id, data: { rules: [] },
      attachments: [{ instanceId: 'behavior', target: { kind: 'instance', instanceId: 'flow' } }] }
    project.instances.flow.childIds!.push('behavior')
    const rule = (id: string, nodeId: string) => ({ id, name: id, enabled: true, trigger: { type: 'node.click', nodeId }, conditions: [],
      actions: [{ id: `${id}-step`, start: 'after-previous', delayMs: 0, action: { type: 'node.exit', nodeId, effect: 'fade', durationMs: 200, easing: 'ease-out' } }] })
    project.instances.flow.container!.presentation!.states[0].overrides.behavior = { data: JSON.parse(JSON.stringify({ rules: [rule('selected', 'text'), rule('unrelated', 'peer')] })) }
    const context = createCourseDocumentClipboardContext({ project, roots: ['text'], resources: { assets: {}, components: {} } })
    expect(context.project.instances.text.data).toEqual(selectedData)
    expect(context.project.instances.behavior.data).toEqual({ rules: [] })
    const data = context.project.instances.flow.container!.presentation!.states[0].overrides.behavior.data as { rules: { id: string }[] }
    expect(data.rules.map(value => value.id)).toEqual(['selected'])
    const host = await createV10StoreHost(createBlankCourseProjectV10())
    try {
      const target = host.kernel.captureTarget(), plan = prepareCourseObjectPaste(readCourseDocumentClipboardContext(context), {
        capturedTarget: target, container: { kind: 'instance', instanceId: target.surfaceId! }, index: 0 })
      await host.kernel.editCaptured(host.kernel.capture(plan.edits, target))
      const isCopiedRule = (data: unknown) => ((data as { rules?: { trigger?: { nodeId?: string } }[] })?.rules ?? [])
        .some(rule => rule.trigger?.nodeId === plan.rootIds[0])
      expect(Object.values(host.model().project.instances).some(instance => isCopiedRule(instance.data))).toBe(false)
      expect(componentContainers(host.model().project).flatMap(container => container.presentation?.states ?? [])
        .some(state => Object.values(state.overrides).some(override => isCopiedRule(override.data)))).toBe(true)
    } finally { host.bridge.dispose() }
  })
})
