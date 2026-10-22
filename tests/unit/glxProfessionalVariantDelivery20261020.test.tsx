// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { CourseProjectV11 } from '../../src/shared/contracts/component-platform/project'
import type { DocumentModel } from '../../src/shared/workbench/document'
import { builtInWorkAsset } from '../../src/core/components/library/workAssets'
import { prepareComponentLibraryInsertion } from '../../src/core/components/library'
import { componentSourceAuthoringEdits } from '../../src/core/components/source/sourceAuthoringEdits'
import { shapeDataSchema } from '../../src/components/shape'
import { PropertiesTab } from '../../src/renderer/ui/PropertiesTab'
import { componentPropertiesView } from '../../src/renderer/ui/properties/componentProperties'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { buildPublishedCourseV4 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { loadBuiltinComponentSource } from '../../src/core/components/source/builtinSources'

const evidenceBase = join(process.cwd(), 'output/glx-work-containers-20261020/professional-variant-facts')
const work = (): CourseProjectV11 => ({ schemaVersion: 11, id: 'a17-shape', revision: 0, title: '源码形状专业编辑', rootIds: ['slide'], entry: { rootInstanceId: 'slide' },
  definitions: { slide: { id: 'slide', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.container.slide' } } },
  instances: { slide: { id: 'slide', definitionId: 'slide', data: {}, childIds: [], container: { kind: 'slide', designSize: { width: 640, height: 360 } } } },
  assets: {}, global: { underlay: [], overlay: [] } })
const api = (service: DocumentHostService): DocumentHostAPI => {
  const unavailable = async (): Promise<never> => { throw new Error('No dialog is needed for this evidence') }
  return { ...service.internalAPI, bootstrapCourse: () => service.bootstrapCourse(), subscribe: listener => service.subscribeEvents(listener),
    saveWithDialog: unavailable, close: unavailable, closeWithDialog: unavailable, discardRecovery: unavailable }
}

it('keeps the deep shape source variant editable through the actual PropertiesTab, Undo, GLX cold read and real sandbox canvas', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
  for (const name of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'MutationObserver', 'Event', 'MouseEvent', 'CustomEvent'] as const)
    vi.stubGlobal(name, name === 'window' ? dom.window : dom.window[name])
  vi.stubGlobal('getComputedStyle', dom.window.getComputedStyle.bind(dom.window))
  vi.stubGlobal('requestAnimationFrame', dom.window.requestAnimationFrame.bind(dom.window))
  vi.stubGlobal('cancelAnimationFrame', dom.window.cancelAnimationFrame.bind(dom.window))
  const { act, cleanup, fireEvent, render, waitFor, within } = await import('@testing-library/react/pure'), screen = within(document.body)
  await mkdir(evidenceBase, { recursive: true })
  const directory = await mkdtemp(join(evidenceBase, 'run-'))
  const service = new DocumentHostService(join(directory, 'warm-recovery'))
  const existing = builtInWorkAsset('guoling.work.template.mixed-program')!, initial = work()
  initial.definitions['guoling.image'] = existing.definitions['guoling.image']
  initial.assets = structuredClone(existing.assets)
  initial.instances['existing-image'] = { ...existing.example.instances.picture, id: 'existing-image', frame: { width: 48, height: 24, transform: [1, 0, 0, 1, 580, 320] } }
  initial.instances.slide.childIds = ['existing-image']
  const created = await service.internalAPI.create({ kind: 'course-v10', project: initial, resources: { assets: existing.resources.assets, components: {} } }, 'a17-initial.glx')
  await useEditorStore.getState().connectCourseDocuments(api(service))
  const bridge = useEditorStore.getState().courseBridge, id = created.documentId
  const model = async (owner = service, documentId = id) => {
    const value = await owner.internalAPI.read(documentId)
    if (value.model.kind !== 'course-v10') throw new Error('Expected the formal author work')
    return value.model
  }
  await loadBuiltinComponentSource('guoling.shape')
  const asset = builtInWorkAsset('guoling.work.professional.shape-source')!
  const first = prepareComponentLibraryInsertion((await model()).project, asset, { container: { kind: 'instance', instanceId: 'slide' }, index: 0 })
  await bridge.edit(first.command.edits)
  const second = prepareComponentLibraryInsertion((await model()).project, asset, { container: { kind: 'instance', instanceId: 'slide' }, index: 1 })
  const siblingFrame = structuredClone(asset.example.instances[asset.example.rootIds[0]!].frame!)
  siblingFrame.transform[4] = 330
  await bridge.edit([...second.command.edits, { type: 'frame.set', instanceId: second.rootIds[0]!, frame: siblingFrame }])
  const selectedId = first.rootIds[0]!, siblingId = second.rootIds[0]!, original = await model(), sibling = structuredClone(original.project.instances[siblingId])
  expect(Object.keys(original.resources.assets)).toEqual(['mixed-image'])
  const selected = original.project.instances[selectedId]!, definition = original.project.definitions[selected.definitionId]!
  expect(componentPropertiesView(selected, definition).type).toBe('shape')
  expect(shapeDataSchema.parse(selected.data).style.fillColor).toBe('#38bdf8')
  expect(definition.professionalBuiltinKey).toBe('guoling.shape')
  const implementation = definition.implementation
  if (implementation.kind !== 'source' || typeof implementation.source !== 'string') throw new Error('Expected the actual inline source-derived shape')
  const { workspace: _workspace, source: _source, ...inlineMetadata } = implementation
  const localSource = { ...inlineMetadata, source: implementation.source.replace('5px 8px', '9px 8px') }
  await bridge.edit(componentSourceAuthoringEdits({ kind: 'instance', instanceId: selectedId }, localSource))
  expect((await model()).project.instances[siblingId]).toEqual(sibling)
  await bridge.undo(id)
  expect((await model()).project.instances[selectedId]).toEqual(selected)
  expect((await model()).resources).toEqual(original.resources)
  await bridge.redo(id)
  const sourceEdited = await model()
  expect(sourceEdited.project.instances[selectedId].implementationOverride).toEqual(localSource)
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
  const errors: string[] = [], facts: Record<string, any> = { directory, selectedId, siblingId, schema: 'shapeDataSchema', professionalKey: definition.professionalBuiltinKey,
    sourceIsolationUndo: true, renders: {}, errors }
  page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(6_000)
  const runtime = await build({ stdin: { contents: `export {mountPublishedCourseV4} from './src/player/componentPlatform/publishedPlayer';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'browser', target: 'es2022', format: 'iife', globalName: 'A17Player' })
  const bundle = runtime.outputFiles[0]!.text
  const renderActual = async (label: string, value: Extract<DocumentModel, { kind: 'course-v10' }>, color: string) => {
    const published = await buildPublishedCourseV4({ project: value.project, assetBytes: value.resources.assets, componentFiles: value.resources.components },
      { compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()) })
    expect(published.diagnostics).toEqual([])
    await writeFile(join(directory, `${label}.published.json`), JSON.stringify(published.payload, null, 2))
    await page.evaluate(async () => { await (window as any).a17Player?.dispose() })
    await page.setContent('<!doctype html><style>html,body,#root{width:100%;height:100%;margin:0}</style><main id="root"></main>')
    await page.addScriptTag({ content: bundle })
    await page.evaluate(async serialized => { const payload = JSON.parse(serialized); (window as any).a17Player = await (window as any).A17Player.mountPublishedCourseV4(payload, document.getElementById('root'), { keyboardNavigation: false }) }, JSON.stringify(published.payload))
    const host = page.locator(`[data-component-instance-id="${selectedId}"] iframe`)
    await expect.poll(() => host.count()).toBe(1)
    const frame = await (await host.elementHandle())!.contentFrame()
    if (!frame) throw new Error('The actual professional Source sandbox is missing')
    const canvas = frame.locator('canvas[data-component-shape-canvas]')
    await canvas.waitFor({ state: 'visible' })
    const pixel = await canvas.evaluate((node: HTMLCanvasElement) => ({ pixel: [...node.getContext('2d')!.getImageData(Math.floor(node.width / 2), Math.floor(node.height / 2), 1, 1).data],
      width: node.width, height: node.height, filter: (node.parentElement as HTMLElement).style.filter }))
    expect(pixel.pixel).toEqual([parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16), 255])
    expect(pixel.filter).toContain('9px 8px')
    facts.renders[label] = pixel
    await page.screenshot({ path: join(directory, `${label}.png`) })
    if (label === 'cold-continued') await writeFile(join(directory, 'cold-continued.published.html'), `<!doctype html><meta charset="utf-8"><style>html,body,#root{width:100%;height:100%;margin:0}</style><main id="root"></main><script>${bundle}</script><script>A17Player.mountPublishedCourseV4(${JSON.stringify(published.payload).replace(/</g, '\\u003c')},document.getElementById('root'))</script>`)
  }
  let failure: unknown, coldBridge: typeof bridge | undefined
  try {
    await renderActual('source-deep-edit', sourceEdited, '#38bdf8')
    const actions = useEditorStore.getState()
    actions.cancelTextEdit(); actions.setPreviewBackgroundColor(null); actions.setEditingScope('scene'); actions.selectNode(selectedId)
    render(<PropertiesTab onReplaceImage={() => {}} />)
    expect(screen.getByTestId('shape-properties')).toBeVisible()
    const changeFill = async (color: string) => {
      const input = screen.getByLabelText('填充色')
      fireEvent.focus(input); fireEvent.change(input, { target: { value: color } })
      await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); await useEditorStore.getState().courseKernel.waitForCommit() })
      await waitFor(() => expect(shapeDataSchema.parse(useEditorStore.getState().courseKernel.readDocument().instances[selectedId].data).style.fillColor).toBe(color))
    }
    await changeFill('#ef4444')
    facts.panelEdited = { label: '填充色', value: (screen.getByLabelText('填充色') as HTMLInputElement).value }
    await writeFile(join(directory, 'actual-properties-panel.html'), document.body.outerHTML)
    const changed = await model()
    expect(changed.project.instances[siblingId]).toEqual(sibling)
    expect(changed.project.instances[selectedId].frame).toEqual(selected.frame)
    expect(changed.project.instances[selectedId].implementationOverride).toEqual(localSource)
    await renderActual('panel-edited', changed, '#ef4444')
    await act(async () => { await bridge.undo(id) })
    expect((await model()).project.instances[selectedId]).toEqual(sourceEdited.project.instances[selectedId])
    expect((await model()).resources).toEqual(sourceEdited.resources)
    await renderActual('panel-undone', await model(), '#38bdf8')
    await act(async () => { await bridge.redo(id) })
    const glx = join(directory, 'a17-saved.glx')
    const saved = await service.internalAPI.save(id, glx)
    const coldDisk = new CourseV10Driver().load(new Uint8Array(await readFile(glx)))
    expect(coldDisk).toEqual(saved.model)
    cleanup(); bridge.dispose()
    const cold = new DocumentHostService(join(directory, 'cold-recovery')), reopened = await cold.internalAPI.open(glx)
    expect(reopened.model).toEqual(saved.model); expect(reopened.dirty).toBe(false)
    await useEditorStore.getState().connectCourseDocuments(api(cold))
    coldBridge = useEditorStore.getState().courseBridge
    await coldBridge.activate(reopened.documentId)
    useEditorStore.getState().setEditingScope('scene'); useEditorStore.getState().selectNode(selectedId)
    render(<PropertiesTab onReplaceImage={() => {}} />)
    expect(screen.getByTestId('shape-properties')).toBeVisible()
    expect(screen.getByLabelText('填充色')).toHaveValue('#ef4444')
    facts.coldPanel = { label: '填充色', value: (screen.getByLabelText('填充色') as HTMLInputElement).value }
    await renderActual('cold-reopened', await model(cold, reopened.documentId), '#ef4444')
    await changeFill('#22c55e')
    facts.coldContinuedPanel = { label: '填充色', value: (screen.getByLabelText('填充色') as HTMLInputElement).value }
    const continued = await model(cold, reopened.documentId)
    expect(continued.project.instances[siblingId]).toEqual(sibling)
    expect(continued.project.instances[selectedId].implementationOverride).toEqual(localSource)
    await renderActual('cold-continued', continued, '#22c55e')
    await cold.internalAPI.save(reopened.documentId, join(directory, 'a17-continued.glx'))
    expect(errors).toEqual([])
    Object.assign(facts, { saved: glx, coldProfile: join(directory, 'cold-recovery'), panelUndo: true, sourceRetained: localSource, siblingUnchanged: true, framePreserved: true,
      resourceIds: Object.keys(original.resources.assets), resourcesRetained: true, continuedEditing: true })
  } catch (error) { failure = error; throw error }
  finally {
    facts.status = failure ? 'failed' : 'passed'; if (failure) facts.failure = String(failure)
    await writeFile(join(directory, 'facts.json'), JSON.stringify(facts, null, 2))
    cleanup(); bridge.dispose(); coldBridge?.dispose(); await browser.close(); dom.window.close(); vi.unstubAllGlobals()
  }
}, 90_000)
