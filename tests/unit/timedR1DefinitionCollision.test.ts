// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse, serializeOuter, type DefaultTreeAdapterTypes } from 'parse5'
import { afterEach, expect, it, vi } from 'vitest'
import { WEB_DEFINITION, HTML_PROGRAM_DEFINITION } from '../../src/components/web/data'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData, textComponentDataSchema } from '../../src/components/text/data'
import { IMAGE_DEFINITION } from '../../src/components/image'
import { createImageData, imageDataSchema } from '../../src/components/image/data'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { componentSourceAuthoringEdits } from '../../src/core/components/source/sourceAuthoringEdits'
import { assembleMeasuredHtml, sourceProgramAssembly, type HtmlDesignCapture, type MeasuredHtmlElement } from '../../src/core/contentApply/assembly/htmlAssembly'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { ContentApplyService } from '../../src/main/workbench/contentApply/applyService'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { jsonValueSchema, type ComponentDefinition, type CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import type { DocumentModel, DocumentSnapshot } from '../../src/shared/workbench/document'

type CourseModel = Extract<DocumentModel, { kind: 'course-v10' }>
const temporaryDirectories: string[] = []
afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Fixture outside temp')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="red"/></svg>')
const defaults = [WEB_DEFINITION, HTML_PROGRAM_DEFINITION, TEXT_DEFINITION, IMAGE_DEFINITION]

function sourceCustomizedProject(flow = false): CourseModel {
  let sequence = 0
  const project = createBlankCourseProjectV10('Definition collision', () => `seed-${++sequence}`)
  if (flow) { project.surfaces[0]!.kind = 'flow'; delete project.surfaces[0]!.designSize }
  project.assets.old = { id: 'old', path: 'assets/old.svg', mimeType: 'image/svg+xml' }
  defaults.forEach((definition, index) => {
    project.definitions[definition.id] = structuredClone(definition)
    const id = `old-${index}`
    project.instances[id] = { id, definitionId: definition.id,
      data: definition.id === TEXT_DEFINITION.id ? jsonValueSchema.parse(createTextComponentData('原有文字'))
        : definition.id === IMAGE_DEFINITION.id ? jsonValueSchema.parse(createImageData('old', '原有图片')) : { html: '<div>原有内容</div>' },
      frame: { width: 80, height: 30, transform: [1, 0, 0, 1, 900, 500 + index * 40] } }
    project.surfaces[0]!.childIds.push(id)
  })
  const model: CourseModel = { kind: 'course-v10', project, resources: { assets: { old: svg }, components: {} } }
  const edited = new CourseV10Driver().apply(model, captureComponentOperation(project, defaults.flatMap(definition =>
    componentSourceAuthoringEdits({ kind: 'definition', definition },
      { kind: 'source', language: 'javascript', source: `export default { name: ${JSON.stringify(definition.id)}, mount() {} };` }))))
  if (edited.kind !== 'course-v10') throw new Error('Expected V10')
  return edited
}

/** Fixed browser-capture input exercises the real assembly and canonical writer. */
function measuredAssembly(html: string, viewport: { width: number; height: number }, coupled: boolean) {
  const document = parse(html)
  const root = document.childNodes.find((node): node is DefaultTreeAdapterTypes.Element => 'tagName' in node)!
  const body = root.childNodes.find((node): node is DefaultTreeAdapterTypes.Element => 'tagName' in node && node.tagName === 'body')!
  const elements: MeasuredHtmlElement[] = []
  const append = (node: DefaultTreeAdapterTypes.Element, sourcePath: number[]): number => {
    const index = elements.length
    const value: MeasuredHtmlElement = { sourcePath, tagName: node.tagName, attributes: Object.fromEntries(node.attrs.map(attr => [attr.name, attr.value])),
      sourceHtml: serializeOuter(node), style: { display: !sourcePath.length && coupled ? 'grid' : 'block',
        'font-family': 'sans-serif', 'font-size': '16px', color: '#112233', 'line-height': '24px', 'text-align': 'left' },
      pseudoElements: {}, children: [], frame: sourcePath.length
        ? { width: 140, height: 40, transform: [1, 0, 0, 1, 10, 10 + sourcePath[0]! * 50] }
        : { ...viewport, transform: [1, 0, 0, 1, 0, 0] } }
    elements.push(value)
    node.childNodes.forEach((child, childIndex) => {
      if ('tagName' in child) value.children.push({ kind: 'element', index: append(child, [...sourcePath, childIndex]) })
      else if (child.nodeName === '#text') value.children.push({ kind: 'text', text: (child as DefaultTreeAdapterTypes.TextNode).value })
    })
    return index
  }
  const capture: HtmlDesignCapture = { viewport, body: append(body, []), pageStyle: {}, elements, diagnostics: [] }
  return assembleMeasuredHtml(capture, { html })
}

async function fixture(model: CourseModel, coupled = false) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-r1-definition-'))
  temporaryDirectories.push(directory)
  const host = new DocumentHostService(path.join(directory, 'documents'))
  let snapshot = await host.internalAPI.create(model, 'collision.h5lesson'), sequence = 0
  const course = (value: DocumentSnapshot = snapshot): CourseModel => {
    if (value.model.kind !== 'course-v10') throw new Error('Expected V10')
    return value.model
  }
  const compile = vi.fn(async () => { throw new Error('HTML defaults must not compile the old shared source') })
  const service = new ContentApplyService({ createId: () => `new-${++sequence}`, compilation: { compile },
    measure: async request => request.html.includes('<script')
      ? sourceProgramAssembly(request.viewport, { html: request.html }, 'script')
      : measuredAssembly(request.html, request.viewport, coupled),
    session: { project: () => course().project, resources: () => course().resources,
      dispatch: async command => {
        const receipt = await host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch,
          baseRevision: snapshot.revision, operationId: `operation-${++sequence}`, actor: 'agent', mutation: { type: 'command', command } })
        snapshot = await host.internalAPI.read(snapshot.documentId)
        return receipt
      } } })
  return { host, service, compile, directory, course, snapshot: () => snapshot,
    async history(type: 'undo' | 'redo') {
      const receipt = await host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch,
        baseRevision: snapshot.revision, operationId: `operation-${++sequence}`, actor: 'human', mutation: { type } })
      snapshot = await host.internalAPI.read(snapshot.documentId)
      return receipt
    } }
}
const insertedRoots = (project: CourseProjectV10, old: CourseProjectV10) => project.surfaces[0]!.childIds.filter(id => !old.instances[id])
function builtinKey(project: CourseProjectV10, definitionId: string) {
  const implementation = project.definitions[definitionId]?.implementation
  return implementation?.kind === 'builtin' ? implementation.key : undefined
}
function retained(model: CourseModel, original: CourseModel) {
  for (const definition of defaults) expect(model.project.definitions[definition.id]).toEqual(original.project.definitions[definition.id])
  for (const [id, instance] of Object.entries(original.project.instances)) expect(model.project.instances[id]).toEqual(instance)
  expect(model.resources.assets.old).toEqual(original.resources.assets.old)
}

it('inserts and redoes Web/program HTML after shared source edits, retaining old objects and reusing default aliases', async () => {
  const original = sourceCustomizedProject()
  original.project.definitions['guoling.web.builtin'] = { ...original.project.definitions[WEB_DEFINITION.id]!, id: 'guoling.web.builtin' }
  const test = await fixture(original), target = { kind: 'container' as const, container: { kind: 'surface' as const, surfaceId: original.project.surfaces[0]!.id } }
  const web = await test.service.apply({ intent: 'insert', target, viewport: { width: 320, height: 200 }, source: { kind: 'html', html: '<button>新按钮</button>' } })
  expect(web).toMatchObject({ commit: 'committed', receipt: { status: 'applied' } })
  const webId = insertedRoots(test.course().project, original.project)[0]!, alias = test.course().project.instances[webId]!.definitionId
  expect(alias).not.toBe(WEB_DEFINITION.id)
  expect(alias).not.toBe('guoling.web.builtin')
  const definitionsBeforeRedo = Object.keys(test.course().project.definitions)
  const redo = await test.service.apply({ intent: 'redo', target: { kind: 'instance', instanceId: webId }, source: { kind: 'html', html: '<button>重做按钮</button>' } })
  expect(redo.commit).toBe('committed')
  expect(Object.keys(test.course().project.definitions)).toEqual(definitionsBeforeRedo)
  expect(redo.insertedIds.every(id => test.course().project.instances[id]!.definitionId === alias)).toBe(true)
  const program = await test.service.apply({ intent: 'insert', target, viewport: { width: 320, height: 200 },
    source: { kind: 'html', html: '<div>完整程序</div><script>document.body.dataset.ready="1"</script>' } })
  expect(program).toMatchObject({ commit: 'committed', usability: 'unverified' })
  const programInstance = test.course().project.instances[program.insertedIds[0]!]!
  expect(programInstance.definitionId).not.toBe(HTML_PROGRAM_DEFINITION.id)
  expect(test.course().project.definitions[programInstance.definitionId]!.implementation).toEqual(HTML_PROGRAM_DEFINITION.implementation)
  expect(programInstance.data).toMatchObject({ html: expect.stringContaining('<script>') })
  retained(test.course(), original)
  expect(test.compile).not.toHaveBeenCalled()
})

it('keeps newly allocated Web and program default frames in Flow and preserves program classification', async () => {
  const original = sourceCustomizedProject(true), test = await fixture(original, true)
  const target = { kind: 'container' as const, container: { kind: 'surface' as const, surfaceId: original.project.surfaces[0]!.id } }
  const web = await test.service.apply({ intent: 'insert', target, viewport: { width: 320, height: 200 },
    source: { kind: 'html', html: '<body style="display:grid"><button>耦合阅读内容</button></body>' } })
  expect(web.commit).toBe('committed')
  const webInstance = test.course().project.instances[web.insertedIds[0]!]!
  expect(webInstance.definitionId).not.toBe(WEB_DEFINITION.id)
  expect(webInstance.frame).toEqual({ width: 320, height: 200, transform: [1, 0, 0, 1, 0, 0] })
  const program = await test.service.apply({ intent: 'insert', target, viewport: { width: 320, height: 180 },
    source: { kind: 'html', html: '<button>动态内容</button><script>document.body.dataset.ready="1"</script>' } })
  expect(program).toMatchObject({ commit: 'committed', usability: 'unverified' })
  expect(test.course().project.instances[program.insertedIds[0]!]!.frame).toEqual({ width: 320, height: 180, transform: [1, 0, 0, 1, 0, 0] })
  retained(test.course(), original)
})

it('retains professional text/image data and admitted resources through conflicting definitions, undo/redo and cold reopen', async () => {
  const original = sourceCustomizedProject()
  const textAlias: ComponentDefinition = { ...TEXT_DEFINITION, id: 'library-default-text' }
  original.project.definitions[textAlias.id] = textAlias
  const test = await fixture(original)
  const result = await test.service.apply({ intent: 'insert',
    target: { kind: 'container', container: { kind: 'surface', surfaceId: original.project.surfaces[0]!.id } }, viewport: { width: 320, height: 200 },
    source: { kind: 'html', html: '<p>可继续专业编辑</p><img src="picture.svg" alt="新图片">', siblingFiles: new Map([['picture.svg', svg]]) } })
  expect(result).toMatchObject({ commit: 'committed', receipt: { status: 'applied' } })
  const model = test.course(), inserted = result.insertedIds.map(id => model.project.instances[id]!)
  const text = inserted.find(instance => builtinKey(model.project, instance.definitionId) === TEXT_DEFINITION.id)!
  const image = inserted.find(instance => builtinKey(model.project, instance.definitionId) === IMAGE_DEFINITION.id)!
  expect(text.definitionId).toBe(textAlias.id)
  expect(textComponentDataSchema.parse(text.data)).toMatchObject({ content: { inlines: [{ type: 'text', text: '可继续专业编辑' }] },
    appearance: { fontSize: 16, lineHeight: 1.5 }, sizing: { mode: 'fixed' } })
  const imageData = imageDataSchema.parse(image.data)
  expect(image.definitionId).not.toBe(IMAGE_DEFINITION.id)
  expect(imageData).toMatchObject({ alt: '新图片', originalAssetId: imageData.assetId, fit: 'stretch' })
  expect(model.project.assets[imageData.assetId]).toBeDefined()
  expect(model.resources.assets[imageData.assetId]!.length).toBeGreaterThan(0)
  expect(text.frame).toEqual({ width: 140, height: 40, transform: [1, 0, 0, 1, 10, 10] })
  expect(result.diagnostics.some(item => item.code === 'html-professional-definition-conflict')).toBe(false)
  retained(model, original)
  expect((await test.history('undo')).status).toBe('applied')
  expect(test.course().project.instances).toEqual(original.project.instances)
  expect((await test.history('redo')).status).toBe('applied')
  const filename = path.join(test.directory, 'collision.h5lesson')
  await test.host.saveToPath(test.snapshot().documentId, filename)
  const reopened = await new DocumentHostService(path.join(test.directory, 'cold-documents')).open(filename)
  expect(reopened.dirty).toBe(false)
  if (reopened.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(reopened.model.project.instances[text.id]).toEqual(text)
  expect(reopened.model.project.instances[image.id]).toEqual(image)
  expect(reopened.model.resources.assets[imageData.assetId]).toEqual(model.resources.assets[imageData.assetId])
  retained(reopened.model, original)
})
