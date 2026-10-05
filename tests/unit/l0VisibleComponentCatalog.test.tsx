import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TextEncoder as NodeTextEncoder } from 'node:util'
import { compileFunction, constants } from 'node:vm'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { scanComponentCatalogSources } from '../../src/main/componentCatalogSources'
import { readCatalogComponentPackage } from '../../src/main/componentCatalogScanner'
import { importComponentLibraryArchive } from '../../src/core/components/library/archive'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { componentCompilationInput } from '../../src/core/components/compilation/componentCompilationInput'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { ComponentLibraryDialog, ComponentsTab } from '../../src/renderer/ui/ComponentsTab'
import { useComponentLibrary, type ComponentLibraryPorts } from '../../src/renderer/app/useComponentLibrary'
import type { AvailableComponentCatalogPackage } from '../../src/shared/componentCatalog'
import type { EditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import type { CourseV10ViewState, CapturedComponentOperation, CapturedCourseTarget } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform/operations'
import type { ComponentInstance, CourseProjectV10, JsonObject, JsonValue } from '../../src/shared/contracts/component-platform/project'
import type { ComponentRuntimeImplementation, ComponentRuntimeScope } from '../../src/shared/contracts/component-platform/runtime'
import type { DocumentModel } from '../../src/shared/workbench/document'

const store = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('../../src/renderer/store/editorStore', () => ({
  useEditorStore: Object.assign((selector: (state: unknown) => unknown) => selector(store.state), { getState: () => store.state }),
  selectActiveCourseProjectDocument: (state: { courseView: CourseV10ViewState }) => state.courseView.project,
  selectEditingScope: () => 'scene',
}))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('sends only catalog identity fields for batch Flow insertion, preparation, update and deletion', async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-l0-catalog-reference-'))
  try {
    const scan = await scanComponentCatalogSources(process.cwd(), userData)
    const packages = [...scan.sources.values()].flatMap(source => source.packages)
    expect(packages).toHaveLength(4)
    const identity = (entry: AvailableComponentCatalogPackage) => ({ sourceId: entry.sourceId, packageId: entry.packageId, version: entry.version })
    const reads: unknown[] = [], deletes: unknown[] = []
    const assertReference = (input: Parameters<ComponentLibraryPorts['readCatalogPackage']>[0]) => {
      // Main's read/delete handlers have the same strict three-field reference contract.
      expect(Object.keys(input).sort()).toEqual(['packageId', 'sourceId', 'version'])
      const entry = packages.find(pkg => pkg.sourceId === input.sourceId && pkg.packageId === input.packageId && pkg.version === input.version)
      expect(entry).toBeDefined()
      expect(input).toEqual(identity(entry!))
    }
    let model: Extract<DocumentModel, { kind: 'course-v10' }> = { kind: 'course-v10',
      project: { schemaVersion: 10, id: 'flow-course', revision: 0, title: 'Flow', definitions: {}, instances: {}, assets: {},
        surfaces: [{ id: 'flow-page', kind: 'flow', title: '正文', childIds: [] }], global: { underlay: [], overlay: [] } },
      resources: { assets: {}, components: {} } }
    let view = { project: model.project, activeDocumentId: 'flow-course', surfaceId: 'flow-page', selectedInstanceIds: [],
      views: [{ documentId: 'flow-course', model }] } as unknown as CourseV10ViewState
    const listeners = new Set<() => void>(), commands: CapturedComponentOperation[] = [], driver = new CourseV10Driver()
    const kernel = { bridge: { subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) } },
      readView: () => view, readDocument: () => model.project, readResources: () => model.resources,
      captureTarget: () => ({ documentId: 'flow-course', epoch: 'epoch', project: model.project, resources: model.resources,
        editingProject: model.project, activeStateId: null, surfaceId: 'flow-page', instanceIds: [], instanceId: null }),
      capture: (edits: ComponentEdit[], target: CapturedCourseTarget) => ({ ...captureComponentOperation(target.project, edits), documentId: target.documentId, epoch: target.epoch }),
      async editCaptured(captured: CapturedComponentOperation) {
        commands.push(captured)
        const { documentId: _documentId, epoch: _epoch, ...command } = captured
        model = driver.apply(model, command) as typeof model
        view = { ...view, project: model.project, views: [{ documentId: 'flow-course', model }] }
        listeners.forEach(listener => listener())
        return { status: 'applied', revision: model.project.revision }
      }, selectInstances: vi.fn(), setFeedback: vi.fn(),
    } as unknown as EditorStoreKernel
    const busy: Promise<unknown>[] = []
    const ports: ComponentLibraryPorts = { kernel, desktopAvailable: () => true, loadCatalog: async () => ({ packages, sources: [], issues: [] }),
      async readCatalogPackage(input) {
        assertReference(input); reads.push(input)
        return readCatalogComponentPackage(scan.sources.get(input.sourceId)!, input.packageId, input.version)
      }, async deleteCatalogPackage(input) {
        assertReference(input); deletes.push(input)
        return { packages, sources: [], issues: [] }
      }, selectComponentPackage: async () => null, selectComponentPackages: async () => null,
      runBusy(operation) { const pending = operation(); busy.push(pending); return pending }, commitStatus: vi.fn(), reportError: vi.fn() }
    const hook = renderHook(() => useComponentLibrary(ports))
    await act(async () => { await busy[0] })
    await act(async () => { expect(await hook.result.current.prepareCatalogPackage(packages[0])).toMatchObject({ id: packages[0].packageId }) })
    await act(async () => { expect(await hook.result.current.addCatalogPackages(packages)).toBe(true) })
    expect(reads).toEqual([identity(packages[0]), ...packages.map(identity)])
    expect(commands).toHaveLength(1)
    expect(commands[0]).toMatchObject({ documentId: 'flow-course', epoch: 'epoch' })
    expect(commands[0].edits.filter(edit => edit.type === 'instance.insert')).toHaveLength(4)
    expect(model.project.surfaces[0].childIds).toHaveLength(4)
    const roots = [...model.project.surfaces[0].childIds]
    act(() => hook.result.current.requestCatalogUpdate(packages[0]))
    expect(hook.result.current.catalogUpdateRequest).not.toBeNull()
    await act(async () => { hook.result.current.confirmCatalogUpdate(); await busy.at(-1) })
    expect(reads.at(-1)).toEqual(identity(packages[0]))
    expect(commands).toHaveLength(2)
    expect(model.project.surfaces[0].childIds).toEqual(roots)
    await act(async () => { await hook.result.current.deleteCatalogPackage(packages[0]) })
    expect(deletes).toEqual([identity(packages[0])])
    expect(ports.reportError).not.toHaveBeenCalled()
  } finally { await fs.rm(userData, { recursive: true, force: true }) }
})

it('shows shipped visual packages and authored definitions, then inserts, reopens and compiles/mounts the API 5 visual content', async () => {
  // Main's compiler receives Node byte arrays; jsdom otherwise replaces that constructor with another realm's.
  vi.stubGlobal('Uint8Array', new NodeTextEncoder().encode('').constructor)
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-l0-visible-library-'))
  try {
    const scan = await scanComponentCatalogSources(process.cwd(), userData)
    const packages = [...scan.sources.values()].flatMap(source => source.packages)
    expect(packages.map(pkg => pkg.name).sort()).toEqual(['图片装饰容器', '文字视觉容器', '汉语拼音标注', '语文朗读标注'].sort())
    expect(packages.every(pkg => pkg.runtimeApiVersion === 5 && pkg.componentSchemaVersion === 1 && pkg.thumbnailDataUrl)).toBe(true)
    expect(scan.issues).toEqual([])
    const read = async (input: { sourceId: string; packageId: string; version: string }) =>
      readCatalogComponentPackage(scan.sources.get(input.sourceId)!, input.packageId, input.version)
    const authored = { id: 'my-card', role: 'content' as const, title: '文字', implementation: { kind: 'source' as const, language: 'javascript' as const, source: 'export default {mount(){return {update(){},dispose(){}}}}' } }
    const project: CourseProjectV10 = { schemaVersion: 10, id: 'course', revision: 0, title: '课程', assets: {},
      definitions: { text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' }, title: '内部文字' },
        formula: { id: 'formula', role: 'content', implementation: { kind: 'builtin', key: 'guoling.formula' }, title: '内部公式' },
        teacher: { id: 'teacher', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.navigation' }, title: '内部教师工作台' },
        block: { id: 'block', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' }, professionalBuiltinKey: 'guoling.document-block', title: '内部文本块' },
        [authored.id]: authored },
      instances: { own: { id: 'own', definitionId: authored.id, data: { title: '用户构件' }, frame: { width: 200, height: 100, transform: [1, 0, 0, 1, 0, 0] } } },
      surfaces: [{ id: 'page', kind: 'slide', title: '页面', childIds: ['own'] }], global: { underlay: [], overlay: [] } }
    let model: Extract<DocumentModel, { kind: 'course-v10' }> = { kind: 'course-v10', project, resources: { assets: {}, components: {} } }
    let view = { project, activeDocumentId: 'course', surfaceId: 'page', selectedInstanceIds: [],
      views: [{ documentId: 'course', model }] } as unknown as CourseV10ViewState
    const listeners = new Set<() => void>(), driver = new CourseV10Driver()
    const kernel = { bridge: { subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) } },
      readView: () => view, readDocument: () => model.project, readResources: () => model.resources,
      captureTarget: () => ({ documentId: 'course', epoch: 'epoch', project: model.project, resources: model.resources,
        editingProject: model.project, activeStateId: null, surfaceId: 'page', instanceIds: [], instanceId: null }),
      capture: (edits: ComponentEdit[], target: CapturedCourseTarget) => ({ ...captureComponentOperation(target.project, edits), documentId: target.documentId, epoch: target.epoch }),
      async editCaptured(captured: CapturedComponentOperation) {
        const { documentId: _documentId, epoch: _epoch, ...command } = captured
        model = driver.apply(model, command) as typeof model
        view = { ...view, project: model.project, views: [{ ...view.views[0], model }] }
        store.state.courseView = view
        listeners.forEach(listener => listener())
        return { status: 'applied', revision: model.project.revision }
      }, selectInstances: vi.fn(), setFeedback: vi.fn(),
    } as unknown as EditorStoreKernel
    store.state = { courseView: view, courseKernel: kernel }
    const ports: ComponentLibraryPorts = { kernel, desktopAvailable: () => true, loadCatalog: async () => ({ packages, sources: [], issues: [] }),
      readCatalogPackage: read, selectComponentPackage: async () => null, selectComponentPackages: async () => null,
      runBusy: operation => operation(), commitStatus: vi.fn(), reportError: vi.fn() }
    let installedIds: string[] = []
    function Library() {
      const library = useComponentLibrary(ports)
      installedIds = library.installedEntries.map(entry => entry.id)
      return <><ComponentsTab componentCatalog={library.componentCatalog} />
        <ComponentLibraryDialog catalog={library.componentCatalog} components={model.project.definitions} onClose={vi.fn()} onAdd={library.addCatalogPackages} /></>
    }
    render(<Library />)
    await screen.findByLabelText('选择文字视觉容器')
    expect(installedIds).toEqual(['my-card'])
    expect(screen.getByTestId('component-my-card')).toBeInTheDocument()
    for (const id of ['text', 'formula', 'teacher', 'block']) expect(screen.queryByTestId(`component-${id}`)).toBeNull()
    fireEvent.click(screen.getByLabelText('选择文字视觉容器'))
    fireEvent.click(screen.getByRole('button', { name: '添加到画布（1）' }))
    await waitFor(() => expect(model.project.surfaces[0].childIds).toHaveLength(2))
    await act(async () => {})
    const reopened = driver.load(driver.serialize(model))
    if (reopened.kind !== 'course-v10') throw new Error('Expected V10 course')
    const visual = reopened.project.instances[reopened.project.surfaces[0].childIds[1]]
    const definition = reopened.project.definitions[visual.definitionId]
    expect(definition.title).toBe('文字视觉容器')
    expect((definition.dataSchema?.['x-editor'] as JsonObject).presets).toHaveLength(3)
    expect(reopened.project.definitions.text).toEqual(project.definitions.text)
    expect(reopened.project.definitions.formula).toEqual(project.definitions.formula)
    expect(reopened.project.definitions.teacher).toEqual(project.definitions.teacher)
    const compiler = createEsbuildComponentCompiler()
    const load = compileFunction('return import(url)', ['url'], { importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER }) as
      (url: string) => Promise<{ default: ComponentRuntimeImplementation }>
    const subscriptions = new Map<string, Set<(value: JsonValue) => void>>()
    const scope = { events: { emit(name: string, value: JsonValue) { subscriptions.get(name)?.forEach(listener => listener(value)) },
      subscribe(name: string, listener: (value: JsonValue) => void) { const group = subscriptions.get(name) ?? new Set(); subscriptions.set(name, group); group.add(listener); return () => group.delete(listener) } } } as unknown as ComponentRuntimeScope
    for (const pkg of packages) {
      const archive = importComponentLibraryArchive((await read(pkg)).bytes)
      const instance = pkg.packageId === visual.definitionId ? visual : archive.entry.example.instances.example
      const source = pkg.packageId === visual.definitionId ? definition.implementation : archive.entry.definitions[pkg.packageId].implementation
      if (source.kind !== 'source') throw new Error('Expected formal source package')
      const owner = pkg.packageId === visual.definitionId ? reopened : { project: { ...project, definitions: archive.entry.definitions }, resources: archive.entry.resources }
      const compiled = await compiler.compile({ ...componentCompilationInput(owner.project, source, owner.resources), options: { sourceMap: false } })
      if (compiled.status !== 'ready') throw new Error(JSON.stringify(compiled.diagnostics))
      const implementation = (await load(`data:text/javascript;base64,${Buffer.from(compiled.artifact.code).toString('base64')}`)).default
      const root = document.createElement('div')
      const mounted = await implementation.mount({ instance, root, scope, resources: { url: id => `https://example.test/${id}.png` } })
      expect(root.children.length).toBeGreaterThan(0)
      if (pkg.packageId.endsWith('text-container')) {
        expect(root.querySelector('.stage')).toHaveAttribute('data-style', 'transparent-glass')
        const data = instance.data as JsonObject
        await mounted.update({ ...instance, data: { ...data, visualStyle: 'sticky-note', content: { ...(data.content as JsonObject), body: '可编辑的正文' } } })
        expect(root.querySelector('.body')).toHaveTextContent('可编辑的正文')
        expect(root.querySelector('.stage')).toHaveAttribute('data-style', 'sticky-note')
      } else if (pkg.packageId.endsWith('image-frame')) {
        await mounted.update({ ...instance, data: { ...(instance.data as JsonObject), assetId: 'photo' } })
        expect(root.querySelector('image')?.getAttribute('href') ?? root.querySelector('img')?.getAttribute('src')).toContain('photo.png')
      } else if (pkg.packageId.endsWith('reading-annotation')) {
        expect(root.querySelector('.pause')).toHaveTextContent('∧')
        expect(root.querySelector('.emphasis')).not.toBeNull()
      } else {
        scope.events.emit('courseware:pinyin-visibility', { visible: false })
        expect(root.querySelector('.shell')).toHaveClass('pinyin-hidden')
      }
      await mounted.dispose()
      expect(root.children).toHaveLength(0)
    }
    expect(subscriptions.get('courseware:pinyin-visibility')?.size).toBe(0)
  } finally {
    const resolved = path.resolve(userData)
    if (path.dirname(resolved) !== path.resolve(os.tmpdir())) throw new Error('Expected direct temporary fixture directory')
    await fs.rm(resolved, { recursive: true, force: true })
  }
})
