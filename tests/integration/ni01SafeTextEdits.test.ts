// @vitest-environment node
import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createTextComponentData } from '../../src/components/text/data'
import { createTableData, parseTableData } from '../../src/components/table/data'
import { WEB_DEFINITION } from '../../src/components/web/data'
import { plainDocumentText } from '../../src/shared/document/content'
import { parseDocumentMarkdown } from '../../src/shared/document/markdown'
import { mapDocumentSelectionToSource } from '../../src/shared/document/markdownSourceMap'
import { textSelectionTarget, flowTextSelectionTarget, readEditableTargetContent } from '../../src/core/tools/ToolTargets'
import { flowTextStyleEdits } from '../../src/renderer/componentPlatform/surfaces/flow/documentSelection'
import type { ToolTarget } from '../../src/shared/workbench/tools'
import type { DocumentPoint } from '../../src/shared/document/ports'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import type { DocumentResources } from '../../src/shared/workbench/document'
import { readComponentProjectFileInput, prepareComponentProjectFileSource } from '../../src/main/workbench/projectFiles/componentPlatformFileInput'
import { projectFlowDocument } from '../../src/core/components/document/flowDocumentProjection'
import { toEditorDocument, editorPositionToPoint } from '../../src/renderer/document/documentAdapter'
import { componentCompilationInput } from '../../src/core/components/compilation/componentCompilationInput'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { interactionBehavior, interactionRules } from '../../src/shared/componentInteractionData'
import { flowParagraphAnchoredFrame } from '../../src/shared/flowParagraphAnchors'
import { DOCUMENT_BLOCK_DEFINITION } from '../../src/components/document-block'
import { TEACHER_CONTROLLER_DEFINITION } from '../../src/components/teacher-controller/data'

async function fixture(kind: 'text' | 'table' | 'web', path: string[], from: number, to: number, scope: 'range' | 'field' | 'object' = 'range', initialText = '前OLD后',
  setup?: (project: CourseProjectV10, resources: DocumentResources) => void) {
  const project = createBlankCourseProjectV10('安全正文'), surfaceId = project.surfaces[0].id
  const definitionId = `guoling.${kind}`
  project.definitions[definitionId] = kind === 'web' ? WEB_DEFINITION : { id: definitionId, role: 'mixed', title: kind, implementation: { kind: 'builtin', key: definitionId } }
  const data = kind === 'text' ? createTextComponentData(initialText) : kind === 'web' ? { html: '<p>OLD</p>' } : createTableData({ rows: 1, columns: 1 })
  if (kind === 'table') (data as ReturnType<typeof createTableData>).rows[0].cells[0].text = initialText
  project.instances.a = { id: 'a', definitionId, data: JSON.parse(JSON.stringify(data)), frame: { width: 400, height: 120, transform: [1, 0, 0, 1, 30, 40] } }
  project.surfaces[0].childIds.push('a')
  const resources: DocumentResources = { assets: {}, components: {} }
  setup?.(project, resources)
  const driver = new CourseV10Driver(), registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create({ kind: 'course-v10', project, resources }, 'safe.h5lesson')
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  const target: ToolTarget = { kind: 'course-instance', surfaceId, instanceId: 'a', ...(scope !== 'object' ? { dataPath: path } : {}), ...(scope === 'range' ? { from, to } : {}) }
  await gateway.beginRun({ runId: 'safe', actor: 'agent', documents: [{ documentId: session.documentId, writable: [target] }] })
  const handle = await gateway.issueTarget('safe', session.documentId, target)
  const replace = (content: string, target = handle) => gateway.execute('safe', randomUUID(), { name: 'text.replace', input: { target, content, format: 'html' } })
  const model = () => { const model = session.read().model; if (model.kind !== 'course-v10') throw new Error('Expected V10'); return model }
  return { project, driver, registry, session, gateway, target, handle, replace, model }
}

it.each(['<svg viewBox="0 0 10 10"><text>图形</text></svg>', '<canvas width="100" height="80"></canvas>'])(
  'keeps the original rich text and rejected input instead of committing a lossy projection: %s', async html => {
    const h = await fixture('text', ['content'], 1, 4)
    expect(await h.replace(html)).toMatchObject({ kind: 'error', code: 'invalid-content', data: { rejectedContent: html } })
    expect(h.model().project.instances.a.data).toEqual(h.project.instances.a.data)
    expect(h.session.read().undoDepth).toBe(0)
  })

it('uses the existing HTML component field for SVG and live canvas source without text extraction', async () => {
  const h = await fixture('web', ['html'], 0, 10)
  const html = '<svg viewBox="0 0 10 10"><circle r="3"/></svg><canvas id="graph"></canvas><script>document.querySelector("canvas").getContext("2d").fillRect(0,0,3,3)</script>'
  expect(await h.replace(html)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(h.driver.load(h.driver.serialize(h.model()))).toMatchObject({ project: { instances: { a: { data: { html }, frame: h.project.instances.a.frame } } } })
})

it('keeps an observed whole text object whole after its own frame write and detects an intervening human frame write', async () => {
  const h = await fixture('text', ['content'], 1, 4, 'object')
  const width = (value: number) => h.gateway.execute('safe', randomUUID(), { name: 'object.update', input: { target: h.handle, properties: { frame: { width: value } } } })
  expect(await width(410)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(await width(420)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const current = h.session.read(), model = h.model()
  await h.session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, operationId: randomUUID(), actor: 'human',
    mutation: { type: 'command', command: captureComponentOperation(model.project, [{ type: 'frame.set', instanceId: 'a', frame: { ...model.project.instances.a.frame!, width: 999 } }]) } })
  expect(await width(430)).toMatchObject({ kind: 'error', code: 'target-conflict' })
  expect(h.model().project.instances.a.frame?.width).toBe(999)
})

it('continues an exact table cell field grant without offsets after its rich-text upgrade', async () => {
  const h = await fixture('table', ['rows', '0', 'cells', '0', 'text'], 0, 5, 'field')
  expect(await h.replace('<b>前OLD后</b>')).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(await h.replace('<a href="https://example.org">全部新文</a>')).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(parseTableData(h.model().project.instances.a.data).rows[0].cells[0].content?.inlines).toEqual([{ type: 'text', text: '全部新文', link: { href: 'https://example.org' } }])
})

it('maps both original ranges through a table text/content upgrade inside one batch without overwriting the middle or tail', async () => {
  const h = await fixture('table', ['rows', '0', 'cells', '0', 'text'], 0, 10, 'field', '前OLD后NEXT尾')
  const first = await h.gateway.issueTarget('safe', h.session.documentId, { ...h.target, from: 1, to: 4 } as ToolTarget)
  const second = await h.gateway.issueTarget('safe', h.session.documentId, { ...h.target, from: 5, to: 9 } as ToolTarget)
  expect(await h.gateway.execute('safe', randomUUID(), { name: 'batch', input: { operations: [
    { name: 'text.replace', input: { target: first, content: '<b>ABCD</b>', format: 'html' } },
    { name: 'text.replace', input: { target: second, content: '<i>新</i>', format: 'html' } },
  ] } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const cell = parseTableData(h.model().project.instances.a.data).rows[0].cells[0]
  expect(cell.content && plainDocumentText(cell.content)).toBe('前ABCD后新尾')
  expect(h.session.read().undoDepth).toBe(1)
})

it('upgrades the exact default table cell like the human formatter, preserves neighbors and identity, and undoes once', async () => {
  const h = await fixture('table', ['rows', '0', 'cells', '0', 'text'], 1, 4)
  const before = parseTableData(h.project.instances.a.data), cell = before.rows[0].cells[0]
  const point = { blockId: 'a', slot: { kind: 'cell' as const, rowId: before.rows[0].id, columnId: cell.columnId }, affinity: 'after' as const }
  const manual = flowTextStyleEdits(h.project, { kind: 'text', revision: '0', anchor: { ...point, offset: 1 }, head: { ...point, offset: 4 } }, { bold: true })
  const result = await h.replace('<strong>OLD</strong>')
  expect(result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const after = parseTableData(h.model().project.instances.a.data).rows[0].cells[0]
  expect(after).toMatchObject({ id: cell.id, columnId: cell.columnId })
  expect(after).not.toHaveProperty('text')
  expect(after.content && plainDocumentText(after.content)).toBe('前OLD后')
  expect(manual[0]).toMatchObject({ type: 'data.set', value: after })
  expect(h.driver.load(h.driver.serialize(h.model()))).toMatchObject({ project: { instances: { a: { data: h.model().project.instances.a.data } } } })
  expect(h.session.read().undoDepth).toBe(1)
  const current = h.session.read()
  expect(await h.session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
    operationId: randomUUID(), actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  expect(h.model().project.instances.a.data).toEqual(h.project.instances.a.data)
})

it('continues the same observed table cell after its acknowledged rich-text upgrade without asking the model for a new handle', async () => {
  const h = await fixture('table', ['rows', '0', 'cells', '0', 'text'], 1, 4)
  expect(await h.replace('<strong>OLD</strong>')).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(await h.replace('<a href="https://example.org">新文字</a>')).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const after = parseTableData(h.model().project.instances.a.data).rows[0].cells[0]
  expect(after.content && plainDocumentText(after.content)).toBe('前新文字后')
  expect(after.content?.inlines).toContainEqual({ type: 'text', text: '新文字', link: { href: 'https://example.org' } })
  expect(h.session.read().undoDepth).toBe(2)
  const current = h.session.read()
  await h.session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
    operationId: randomUUID(), actor: 'human', mutation: { type: 'undo' } })
  const stale = await h.replace('<b>不得重放</b>')
  expect(stale).toMatchObject({ kind: 'error' })
  if (stale.kind !== 'error') throw new Error('Expected a refused stale scope')
  expect(['target-conflict', 'not-authorized']).toContain(stale.code)
  expect(h.session.read().revision).toBe(current.revision + 1)
  expect(h.session.read().undoDepth).toBe(current.undoDepth - 1)
})

it.each([
  { source: '甲\n\n乙', next: '新甲\n\n新乙', expected: '新甲\n\n新乙' },
  { source: '- 甲\n- 乙', next: '观察结果\n说明理由', expected: '- 观察结果\n- 说明理由' },
  { source: '前 甲**乙**丙[丁](https://example.org) 后', next: '天地玄黄宇宙', expected: '前 天地**玄**黄宇[宙](https://example.org) 后' },
  { source: '甲\n\n乙', next: '甲乙', expected: '甲乙' },
  { source: '- 甲\n- 乙', next: '甲乙', expected: '- 甲乙' },
  { source: '前 甲**乙**丙[丁](https://example.org) 后', next: '新', expected: '前 **新** 后' },
  { source: '前 甲**乙**丙[丁](https://example.org) 后', next: '', expected: '前  后', continueText: '继续*', continued: '前 继续\\* 后' },
])('rewrites every visible Markdown fragment in one transaction while preserving unselected syntax: $source → $next', async ({ source, next, expected, continueText, continued }) => {
  const parsed = parseDocumentMarkdown(source, { target: 'file', createId: () => randomUUID() })
  if (parsed.status !== 'valid') throw new Error(`Fixture parse failed: ${JSON.stringify(parsed.diagnostics)}`)
  const first = parsed.document.content.blocks[0], last = parsed.document.content.blocks.at(-1)!
  const mixed = source.startsWith('前 ')
  const anchor: DocumentPoint = { blockId: first.id, slot: first.type === 'list' ? { kind: 'item', itemId: first.items[0].id } : { kind: 'field', field: 'content' }, offset: mixed ? 2 : 0, affinity: 'after' }
  const head: DocumentPoint = { blockId: last.id, slot: last.type === 'list' ? { kind: 'item', itemId: last.items.at(-1)!.id } : { kind: 'field', field: 'content' }, offset: mixed ? 6 : 1, affinity: 'before' }
  const mapped = mapDocumentSelectionToSource(source, parsed.sourceMap, { kind: 'text', revision: '0', anchor, head })
  if (mapped.status !== 'mapped') throw new Error(mapped.message)
  expect(mapped.ranges.length).toBeGreaterThan(1)
  const driver = new MarkdownDriver(), registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create(driver.load(new TextEncoder().encode(source)), 'fragment.md')
  const target = textSelectionTarget(session.read().model, mapped.ranges.map(range => ({ kind: 'markdown-range', from: range.from, to: range.to })))
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  await gateway.beginRun({ runId: 'fragments', actor: 'agent', documents: [{ documentId: session.documentId, writable: [target], selection: [target] }],
    contentOutput: { kind: 'content', documentId: session.documentId, target } })
  const observed = await gateway.issueTarget('fragments', session.documentId, target)
  expect(await gateway.execute('fragments', randomUUID(), { name: 'text.replace', input: { content: next } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(session.read()).toMatchObject({ model: { source: expected }, undoDepth: 1 })
  expect(new TextDecoder().decode(driver.serialize(session.read().model))).toBe(expected)
  expect(await gateway.previewTarget('fragments', observed, 500)).toMatchObject({ text: next })
  if (continueText !== undefined) {
    expect(await gateway.execute('fragments', randomUUID(), { name: 'text.replace', input: { target: observed, content: continueText } }))
      .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    expect(session.read()).toMatchObject({ model: { source: continued }, undoDepth: 2 })
    expect(await gateway.previewTarget('fragments', observed, 500)).toMatchObject({ text: continueText })
    const current = session.read()
    await session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, operationId: randomUUID(), actor: 'human', mutation: { type: 'undo' } })
    expect(session.read().model).toMatchObject({ source: expected })
  }
  const current = session.read()
  await session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, operationId: randomUUID(), actor: 'human', mutation: { type: 'undo' } })
  expect(session.read().model).toMatchObject({ source })
})

it.each([
  { content: '<b>新甲</b><br><a href="https://example.org">新乙</a>', firstText: '未选新甲', secondText: '新乙未选' },
  { content: '新', firstText: '未选', secondText: '新未选' },
  { content: '', firstText: '未选', secondText: '未选' },
])('captures Flow visible order and rewrites both partial object ranges in one canonical History entry: $content', async ({ content, firstText, secondText }) => {
  const project = createBlankCourseProjectV10('Flow连续正文'), surface = project.surfaces[0]
  surface.kind = 'flow'
  project.definitions['guoling.text'] = { id: 'guoling.text', title: '正文', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.text' } }
  for (const [id, text] of [['first', '未选甲'], ['second', '乙未选']]) project.instances[id] = { id, definitionId: 'guoling.text', data: JSON.parse(JSON.stringify(createTextComponentData(text))) }
  surface.childIds = ['first', 'second']
  const driver = new CourseV10Driver(), registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'flow.h5lesson')
  const target = flowTextSelectionTarget(session.read().model, surface.id, { kind: 'text', revision: '0',
    anchor: { blockId: 'first', slot: { kind: 'field', field: 'content' }, offset: 2, affinity: 'after' },
    head: { blockId: 'second', slot: { kind: 'field', field: 'content' }, offset: 1, affinity: 'before' } })
  expect(readEditableTargetContent(session.read().model, target)).toEqual({ text: '甲<br>乙', format: 'html' })
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  await gateway.beginRun({ runId: 'flow', actor: 'agent', documents: [{ documentId: session.documentId, writable: [target] }] })
  const handle = await gateway.issueTarget('flow', session.documentId, target)
  expect(await gateway.execute('flow', randomUUID(), { name: 'text.replace', input: { target: handle, content, format: 'html' } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const current = session.read(), model = current.model
  if (model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(plainDocumentText((model.project.instances.first.data as any).content)).toBe(firstText)
  expect(plainDocumentText((model.project.instances.second.data as any).content)).toBe(secondText)
  expect(current.undoDepth).toBe(1)
  if (!content) {
    expect(await gateway.execute('flow', randomUUID(), { name: 'text.replace', input: { target: handle, content: '继续', format: 'html' } }))
      .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const next = session.read().model
    if (next.kind !== 'course-v10') throw new Error('Expected V10')
    expect(plainDocumentText((next.project.instances.first.data as any).content)).toBe('未选继续')
    expect(plainDocumentText((next.project.instances.second.data as any).content)).toBe('未选')
  }
})

it('accepts ordinary source text and forks its observed workspace while preserving bindings and other instances', async () => {
  const original = 'export const oldValue = 1', next = 'export const newValue = 2'
  const h = await fixture('text', [], 0, 0, 'object', '正文', (project, resources) => {
    project.definitions['guoling.text'].implementation = { kind: 'source', language: 'javascript', workspace: { ownerId: 'shared', entry: 'entry.js' },
      moduleBindings: { './helper.js': 'helper' }, dependencies: ['helper'] }
    project.definitions.helper = { id: 'helper', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export const helper = 1' } }
    project.instances.b = { ...structuredClone(project.instances.a), id: 'b' }; project.surfaces[0].childIds.push('b')
    resources.components.shared = { 'entry.js': new TextEncoder().encode(original), 'notes.txt': new TextEncoder().encode('保留附件') }
  })
  expect(await h.gateway.execute('safe', randomUUID(), { name: 'object.update', input: { target: h.handle,
    properties: { implementation: { kind: 'source', source: next } } } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const model = h.model(), implementation = model.project.instances.a.implementationOverride
  expect(implementation).toMatchObject({ kind: 'source', language: 'javascript', moduleBindings: { './helper.js': 'helper' }, dependencies: ['helper'] })
  if (implementation?.kind !== 'source' || !implementation.workspace) throw new Error('Expected private source workspace')
  expect(implementation.workspace.ownerId).not.toBe('shared')
  const decoder = new TextDecoder()
  expect(decoder.decode(model.resources.components[implementation.workspace.ownerId]['entry.js'])).toBe(next)
  expect(decoder.decode(model.resources.components[implementation.workspace.ownerId]['notes.txt'])).toBe('保留附件')
  expect(decoder.decode(model.resources.components.shared['entry.js'])).toBe(original)
  expect(model.project.instances.b.implementationOverride).toBeUndefined()
  expect(h.session.read().undoDepth).toBe(1)
  expect(h.driver.load(h.driver.serialize(model))).toMatchObject({ project: { instances: { a: { implementationOverride: implementation } } } })
  expect(await h.gateway.execute('safe', randomUUID(), { name: 'object.update', input: { target: h.handle,
    properties: { implementation: { kind: 'source', source: next, workspace: { ownerId: 'caller-owner', entry: 'entry.js' } } } } })).toMatchObject({ kind: 'error' })
})

it('accepts ordinary chart values through the public professional handler and keeps software identities on the second update', async () => {
  const h = await fixture('table', [], 0, 0, 'object', '表', project => {
    const table = createTableData({ rows: 3, columns: 2 })
    for (const [row, texts] of [['项目', '数量'], ['甲', '2'], ['乙', '3']].entries())
      texts.forEach((text, column) => { table.rows[row].cells[column].text = text })
    table.headerRowCount = 1; project.instances.a.data = JSON.parse(JSON.stringify(table))
  })
  expect(await h.gateway.execute('safe', randomUUID(), { name: 'object.convert', input: { target: h.handle, to: 'chart' } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const change = (values: number[]) => h.gateway.execute('safe', randomUUID(), { name: 'object.author', input: { target: h.handle,
    change: { kind: 'chart', edit: { type: 'data', categories: [{ label: '甲' }, { label: '乙' }], series: [{ name: '数量', values }] } } } })
  expect(await change([4, 6])).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const first = structuredClone(h.model().project.instances.a.data) as any
  expect(await change([8, 9])).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const second = h.model().project.instances.a.data as any
  expect(second.categories).toEqual(first.categories)
  expect(second.series[0].id).toBe(first.series[0].id)
  expect(second.series[0].points.map((point: any) => point.categoryId)).toEqual(first.series[0].points.map((point: any) => point.categoryId))
  expect(second.series[0].points.map((point: any) => point.value)).toEqual([8, 9])
  expect(h.model().project.instances.a.frame).toEqual(h.project.instances.a.frame)
})

it('applies public source.from through the real authorized closure and current source owner in one transaction', async () => {
  const scratchBase = path.resolve('output/ni-source-from'), scratch = path.join(scratchBase, randomUUID()), root = path.join(scratch, 'allowed')
  await fs.mkdir(root, { recursive: true })
  const entry = path.join(root, 'entry.js'), helper = path.join(root, 'helper.js')
  const current = 'import { liveValue } from "./helper.js"; export { liveValue }'
  try {
    await fs.writeFile(entry, 'export const diskOnly = 1'); await fs.writeFile(helper, 'export const diskHelper = 1')
    await fs.writeFile(path.join(scratch, 'outside.js'), 'export const outside = 1')
    const h = await fixture('text', [], 0, 0, 'object')
    const gateway = new DocumentToolGateway(h.registry, [h.driver], randomUUID, { componentContent: {
      apply: async () => { throw new Error('source authoring must use the original canonical writer') },
      source: (from, fileAccess) => readComponentProjectFileInput({ from, fileAccess,
        currentSource: async filename => filename === entry ? current : filename === helper ? 'export const liveValue = 9' : undefined }),
      prepareSource: prepareComponentProjectFileSource,
    } })
    await gateway.beginRun({ runId: 'source-from', actor: 'agent', documents: [{ documentId: h.session.documentId, writable: [h.target] }],
      fileAccess: { workspaceRoot: root, permission: 'workspace' } })
    const handle = await gateway.issueTarget('source-from', h.session.documentId, h.target)
    const apply = (from: string) => gateway.execute('source-from', randomUUID(), { name: 'object.update', input: { target: handle,
      properties: { implementation: { kind: 'source', from } } } })
    expect(await apply('entry.js')).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const model = h.model(), implementation = model.project.instances.a.implementationOverride
    if (implementation?.kind !== 'source' || !implementation.workspace) throw new Error('Expected admitted source workspace')
    const files = model.resources.components[implementation.workspace.ownerId], decoder = new TextDecoder()
    expect(decoder.decode(files[implementation.workspace.entry])).toBe(current)
    expect(decoder.decode(files['helper.js'])).toBe('export const liveValue = 9')
    expect(h.driver.load(h.driver.serialize(model))).toMatchObject({ project: { instances: { a: { implementationOverride: implementation } } } })
    expect(h.session.read().undoDepth).toBe(1)
    expect(await apply('../outside.js')).toMatchObject({ kind: 'error' })
    expect(h.session.read().undoDepth).toBe(1)
    const snapshot = h.session.read()
    await h.session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
      operationId: randomUUID(), actor: 'human', mutation: { type: 'undo' } })
    expect(h.model().project.instances.a.implementationOverride).toBeUndefined()
  } finally {
    if (!path.resolve(scratch).startsWith(`${scratchBase}${path.sep}`)) throw new Error('Unexpected temporary source root')
    await fs.rm(scratch, { recursive: true, force: true })
  }
})

it('captures the editor table caption before its visible cells and never rewrites the unselected cell suffix', async () => {
  const h = await fixture('table', [], 0, 0, 'object', '甲乙', project => {
    project.surfaces[0].kind = 'flow'
    const table = parseTableData(project.instances.a.data)
    table.caption = { inlines: [{ type: 'text', text: '标题' }] }
    project.instances.a.data = JSON.parse(JSON.stringify(table))
  })
  const surfaceId = h.project.surfaces[0].id
  const pm = toEditorDocument(projectFlowDocument(h.model().project, surfaceId).content)
  const visible: { key: string; position: number; text: string }[] = []
  pm.descendants((node, position) => { if (node.type.name === 'slot') visible.push({ key: node.attrs.key, position: position + 1, text: node.textContent }) })
  expect(visible[0]).toMatchObject({ key: 'caption', text: '标题' })
  const cell = visible.find(slot => slot.key.startsWith('cell:'))!
  const anchor = editorPositionToPoint(pm, visible[0].position)!, head = editorPositionToPoint(pm, cell.position + 1)!
  const target = flowTextSelectionTarget(h.model(), surfaceId, { kind: 'text', revision: '0', anchor, head })
  expect(readEditableTargetContent(h.model(), target)).toEqual({ text: '标题<br>甲', format: 'html' })
  const handle = await h.gateway.issueTarget('safe', h.session.documentId, target)
  expect(await h.gateway.execute('safe', randomUUID(), { name: 'text.replace', input: { target: handle, content: '新标题<br>新甲', format: 'html' } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const table = parseTableData(h.model().project.instances.a.data)
  expect(plainDocumentText(table.caption!)).toBe('新标题')
  expect(plainDocumentText(table.rows[0].cells[0].content!)).toBe('新甲乙')
  expect(h.session.read().undoDepth).toBe(1)
})

it('uses public recipe, remix and productivity intents without model generated component identities', async () => {
  const h = await fixture('text', [], 0, 0, 'object')
  await h.gateway.beginRun({ runId: 'recipe-public', actor: 'agent', documents: [{ documentId: h.session.documentId, writable: [{ kind: 'document' }] }] })
  const page = await h.gateway.issueTarget('recipe-public', h.session.documentId, { kind: 'course-surface', surfaceId: h.project.surfaces[0].id })
  expect(await h.gateway.execute('recipe-public', randomUUID(), { name: 'course.recipes', input: {} }))
    .toMatchObject({ kind: 'read', data: { recipes: expect.arrayContaining([expect.objectContaining({ id: 'classify-sort-v1' })]) } })
  expect(await h.gateway.execute('recipe-public', randomUUID(), { name: 'surface.recipe', input: { target: page, recipeId: 'classify-sort-v1',
    slots: { title: '排序题', mode: 'sort', items: '甲\n乙', correctOrder: '乙,甲', success: '正确', failure: '再试' } } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(h.model().project.surfaces).toHaveLength(2)
  const created = h.model().project.surfaces[1]
  const interaction = created.childIds.map(id => h.model().project.instances[id]).find(instance => (instance.data as any).mode === 'sort')!
  const data = interaction.data as any
  expect(data.correctOrder).toEqual([data.items[1].id, data.items[0].id])
  const inspected = await h.gateway.execute('recipe-public', randomUUID(), { name: 'surface.remix.inspect', input: { target: page } })
  if (inspected.kind !== 'read') throw new Error('Expected observed remix slots')
  const view = inspected.data as { target: string; slots: { id: string; original: string }[] }
  expect(view.slots[0].original).toBe('前OLD后')
  expect(view.slots[0]).not.toHaveProperty('instanceId')
  expect(await h.gateway.execute('recipe-public', randomUUID(), { name: 'surface.remix', input: { target: view.target,
    replacements: { [view.slots[0].id]: '新例子' } } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(h.model().project.surfaces).toHaveLength(3)
  expect(await h.gateway.execute('recipe-public', randomUUID(), { name: 'course.productivity', input: { target: page,
    request: { kind: 'text', scope: 'page', find: 'OLD', replacement: 'NEW' } } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(plainDocumentText((h.model().project.instances.a.data as any).content)).toBe('前NEW后')
  expect(h.session.read().undoDepth).toBe(3)
  const current = h.session.read()
  await h.session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, operationId: randomUUID(), actor: 'human', mutation: { type: 'undo' } })
  expect(plainDocumentText((h.model().project.instances.a.data as any).content)).toBe('前OLD后')
  expect(h.model().project.surfaces).toHaveLength(3)
})

it('routes productivity background changes into the observed presentation state without changing the base page', async () => {
  const h = await fixture('text', [], 0, 0, 'object', '甲', project => {
    project.designTokens = { fonts: [], colors: [{ id: 'accent', label: '强调', color: '#123456' }] }
    project.surfaces[0].background = { mode: 'own', color: '#ffffff' }
    project.surfaces[0].presentation = { states: [{ id: 'selected-state', title: '讲解', overrides: {}, background: { color: '#eeeeee' } }] }
  })
  const target: ToolTarget = { kind: 'course-surface', surfaceId: h.project.surfaces[0].id, stateId: 'selected-state' }
  await h.gateway.beginRun({ runId: 'state-productivity', actor: 'agent', documents: [{ documentId: h.session.documentId, writable: [target] }] })
  const page = await h.gateway.issueTarget('state-productivity', h.session.documentId, target)
  expect(await h.gateway.execute('state-productivity', randomUUID(), { name: 'course.productivity', input: { target: page,
    request: { kind: 'color', scope: 'page', property: 'background', tokenId: 'accent' } } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(h.model().project.surfaces[0].background).toEqual(h.project.surfaces[0].background)
  expect(h.model().project.surfaces[0].presentation?.states[0].background?.color).toBe('#123456')
  expect(h.session.read().undoDepth).toBe(1)
  const current = h.session.read()
  await h.session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, operationId: randomUUID(), actor: 'human', mutation: { type: 'undo' } })
  expect(h.model().project.surfaces).toEqual(h.project.surfaces)
})

it('remixes only provided observed slots and permits explicit clearing while preserving omitted content and the original page', async () => {
  const h = await fixture('text', [], 0, 0, 'object', '甲清空', project => {
    project.instances.b = { ...structuredClone(project.instances.a), id: 'b', data: JSON.parse(JSON.stringify(createTextComponentData('乙保留'))) }
    project.instances.b.frame!.transform[4] = 500
    project.surfaces[0].childIds.push('b')
  })
  await h.gateway.beginRun({ runId: 'partial-remix', actor: 'agent', documents: [{ documentId: h.session.documentId, writable: [{ kind: 'document' }] }] })
  const page = await h.gateway.issueTarget('partial-remix', h.session.documentId, { kind: 'course-surface', surfaceId: h.project.surfaces[0].id })
  const inspected = await h.gateway.execute('partial-remix', randomUUID(), { name: 'surface.remix.inspect', input: { target: page } })
  if (inspected.kind !== 'read') throw new Error('Expected observed remix slots')
  const view = inspected.data as { target: string; slots: { id: string; original: string }[] }
  const slot = view.slots.find(value => value.original === '甲清空')!
  expect(slot).not.toHaveProperty('issue')
  expect(await h.gateway.execute('partial-remix', randomUUID(), { name: 'surface.remix', input: { target: view.target, replacements: { [slot.id]: '' } } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const clone = h.model().project.surfaces[1]
  const values = clone.childIds.map(id => h.model().project.instances[id])
  expect(values.map(instance => plainDocumentText((instance.data as any).content))).toEqual(['', '乙保留'])
  expect(values[1].frame).toEqual(h.project.instances.b.frame)
  expect(h.model().project.instances.a).toEqual(h.project.instances.a)
  expect(h.model().project.instances.b).toEqual(h.project.instances.b)
  expect(h.session.read().undoDepth).toBe(1)
  const current = h.session.read()
  await h.session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, operationId: randomUUID(), actor: 'human', mutation: { type: 'undo' } })
  expect(h.model().project.surfaces).toEqual(h.project.surfaces)
  expect(h.model().project.instances).toEqual(h.project.instances)
})

it('uses observed geometry targets and controller defaults in one public batch while preserving parent transforms and locked objects', async () => {
  const h = await fixture('text', [], 0, 0, 'object', '甲', project => {
    project.definitions.group = { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
    project.instances.group = { id: 'group', definitionId: 'group', data: {}, childIds: ['a', 'b', 'locked'],
      frame: { width: 400, height: 300, transform: [0, 2, -2, 0, 100, 200] } }
    for (const [id, x, y, width, height] of [['a', 10, 20, 40, 20], ['b', 100, 60, 60, 30], ['locked', 220, 30, 60, 30]] as const)
      project.instances[id] = { id, definitionId: 'guoling.text', data: JSON.parse(JSON.stringify(createTextComponentData(id))),
        ...(id === 'locked' ? { locked: true } : {}), frame: { width, height, transform: [1, 0, 0, 1, x, y] } }
    project.surfaces[0].childIds = ['group']
    for (const instance of Object.values(project.instances)) if (instance.definitionId === TEACHER_CONTROLLER_DEFINITION.id) {
      delete project.instances[instance.id]; project.global.overlay = project.global.overlay.filter(id => id !== instance.id)
    }
  })
  const readonlyPeer = await h.gateway.issueTarget('safe', h.session.documentId, { ...h.target, kind: 'course-instance', instanceId: 'b' })
  expect(await h.gateway.execute('safe', randomUUID(), { name: 'object.layout', input: { targets: [h.handle, readonlyPeer], intent: { kind: 'align', alignment: 'left' } } }))
    .toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(h.session.read().undoDepth).toBe(0)
  await h.gateway.beginRun({ runId: 'geometry', actor: 'agent', documents: [{ documentId: h.session.documentId, writable: [{ kind: 'document' }] }] })
  await h.gateway.loadToolFamilies('geometry', ['navigation'])
  const surfaceId = h.project.surfaces[0].id
  const targets = await Promise.all(['a', 'b', 'locked'].map(instanceId => h.gateway.issueTarget('geometry', h.session.documentId, { kind: 'course-instance', surfaceId, instanceId })))
  const page = await h.gateway.issueTarget('geometry', h.session.documentId, { kind: 'course-surface', surfaceId })
  const layout = { name: 'object.layout', input: { targets, intent: { kind: 'align', alignment: 'left' } } }
  expect(await h.gateway.effectTargets('geometry', layout)).toHaveLength(3)
  expect(await h.gateway.execute('geometry', randomUUID(), { name: 'batch', input: { operations: [layout, { name: 'teacher.ensure', input: { target: page } }] } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(h.model().project.instances.a.frame?.transform).toEqual([1, 0, 0, 1, 10, 70])
  for (const id of ['b', 'group', 'locked']) expect(h.model().project.instances[id]).toEqual(h.project.instances[id])
  const controller = Object.values(h.model().project.instances).find(instance => instance.definitionId === TEACHER_CONTROLLER_DEFINITION.id)!
  expect(controller.frame).toEqual({ width: 720, height: 80, transform: [1, 0, 0, 1, 20, 20] })
  expect(h.model().project.global.overlay).toEqual([controller.id])
  expect(h.session.read().undoDepth).toBe(1)
  expect(await h.gateway.execute('geometry', randomUUID(), { name: 'teacher.ensure', input: { target: page } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'unchanged' } })
  expect(h.session.read().undoDepth).toBe(1)
  const current = h.session.read()
  await h.session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, operationId: randomUUID(), actor: 'human', mutation: { type: 'undo' } })
  expect(h.model().project.instances).toEqual(h.project.instances)
  expect(h.model().project.global).toEqual(h.project.global)
})

it('inserts a professional table into an observed Flow container using host defaults and one undoable command', async () => {
  const h = await fixture('text', [], 0, 0, 'object', '容器', project => {
    project.surfaces[0].kind = 'flow'; project.instances.a.childIds = []
    project.definitions[DOCUMENT_BLOCK_DEFINITION.id] = DOCUMENT_BLOCK_DEFINITION
    project.instances.a.definitionId = DOCUMENT_BLOCK_DEFINITION.id
    project.instances.a.data = { type: 'section', title: { inlines: [{ type: 'text', text: '容器' }] }, collapsedByDefault: false }
  })
  expect(await h.gateway.execute('safe', randomUUID(), { name: 'object.insert', input: { target: h.handle, kind: 'table' } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const childId = h.model().project.instances.a.childIds![0], instance = h.model().project.instances[childId]
  expect(instance.definitionId).toBe('guoling.table')
  expect(parseTableData(instance.data).rows.length).toBeGreaterThan(0)
  expect(instance.frame).toMatchObject({ width: 600, height: 220 })
  expect(h.model().project.surfaces[0].childIds).toEqual(['a'])
  expect(h.session.read().undoDepth).toBe(1)
  const current = h.session.read()
  await h.session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, operationId: randomUUID(), actor: 'human', mutation: { type: 'undo' } })
  expect(h.model().project.instances.a.childIds).toEqual([])
  expect(h.model().project.instances[childId]).toBeUndefined()
})

it.each([
  { source: '**甲**\n\n**乙**', replacement: '甲乙', expected: '**甲乙**', from: 0, to: 1 },
  { source: '前 **a[](https://example.org)** 后', replacement: '', expected: '前 **[](https://example.org)** 后', from: 2, to: 3 },
  { source: '> **甲\n> 乙**', replacement: '', expected: '', from: 0, to: 3 },
  { source: '> 甲[](https://example.org)', replacement: '', expected: '> [](https://example.org)', from: 0, to: 1, continued: '> 续[](https://example.org)' },
  { source: '**甲**[](https://example.org)\n\n**乙**', replacement: '甲乙', expected: '前言\n\n**甲**[](https://example.org)**乙**', from: 0, to: 1, batchPrefix: '前言\n\n' },
])('applies actual Markdown selection through structural cleanup and precise ACK: $source', async scenario => {
  const { source, replacement, expected, from, to } = scenario
  const parsed = parseDocumentMarkdown(source, { target: 'file', createId: () => randomUUID() })
  if (parsed.status !== 'valid') throw new Error(JSON.stringify(parsed.diagnostics))
  const first = parsed.document.content.blocks[0], last = parsed.document.content.blocks.at(-1)!
  const selected = mapDocumentSelectionToSource(source, parsed.sourceMap, { kind: 'text', revision: '0',
    anchor: { blockId: first.id, slot: { kind: 'field', field: 'content' }, offset: from, affinity: 'after' },
    head: { blockId: last.id, slot: { kind: 'field', field: 'content' }, offset: to, affinity: 'before' } })
  if (selected.status !== 'mapped') throw new Error(selected.message)
  const driver = new MarkdownDriver(), registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create(driver.load(new TextEncoder().encode(source)), 'structural.md')
  const target = textSelectionTarget(session.read().model, selected.ranges.map(range => ({ kind: 'markdown-range', from: range.from, to: range.to })))
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID), runId = 'structural'
  const prefixTarget: ToolTarget = { kind: 'markdown-range', from: 0, to: 0 }
  await gateway.beginRun({ runId, actor: 'agent', documents: [{ documentId: session.documentId, writable: [target, ...('batchPrefix' in scenario ? [prefixTarget] : [])] }] })
  const handle = await gateway.issueTarget(runId, session.documentId, target)
  const mutation = { name: 'text.replace', input: { target: handle, content: replacement } }
  const call = 'batchPrefix' in scenario ? { name: 'batch', input: { operations: [
    { name: 'text.replace', input: { target: await gateway.issueTarget(runId, session.documentId, prefixTarget), content: scenario.batchPrefix } }, mutation,
  ] } } : mutation
  expect(await gateway.execute(runId, randomUUID(), call))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(session.read()).toMatchObject({ model: { source: expected }, undoDepth: 1 })
  expect(await gateway.previewTarget(runId, handle, 500)).toMatchObject({ text: replacement })
  expect(new TextDecoder().decode(driver.serialize(session.read().model))).toBe(expected)
  if (scenario.batchPrefix !== undefined) {
    const changes = session.committedChangesSince(0)[0].textChanges!
    expect(changes.aggregateMappings).toEqual([{ before: target, after: { kind: 'text-selection', fragments: [
      { target: { kind: 'markdown-range', from: expected.indexOf('甲'), to: expected.indexOf('甲') + 1 } },
      { target: { kind: 'markdown-range', from: expected.indexOf('乙'), to: expected.indexOf('乙') + 1 } },
    ] }, sourceIndexes: changes.source.slice(1).map((_, index) => index + 1) }])
    expect(changes.source[0]).toEqual({ from: 0, to: 0, inserted: scenario.batchPrefix.length })
  }
  if ('continued' in scenario) {
    expect(await gateway.execute(runId, randomUUID(), { name: 'text.replace', input: { target: handle, content: '续' } }))
      .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    expect(session.read()).toMatchObject({ model: { source: scenario.continued }, undoDepth: 2 })
    expect(await gateway.previewTarget(runId, handle, 500)).toMatchObject({ text: '续' })
    const current = session.read()
    await session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, operationId: randomUUID(), actor: 'human', mutation: { type: 'undo' } })
    expect(session.read()).toMatchObject({ model: { source: expected }, undoDepth: 1 })
  }
  const current = session.read()
  await session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, operationId: randomUUID(), actor: 'human', mutation: { type: 'undo' } })
  expect(session.read().model).toMatchObject({ source })
})

it('compiles the declared TypeScript entry after public source replacement and keeps the original workspace closure', async () => {
  const h = await fixture('text', [], 0, 0, 'object', '正文', (project, resources) => {
    project.definitions['guoling.text'].implementation = { kind: 'source', language: 'javascript', workspace: { ownerId: 'original-source', entry: 'entry.js' },
      moduleBindings: { helper: 'helper' } }
    project.definitions.helper = { id: 'helper', role: 'content', implementation: { kind: 'source', language: 'typescript',
      workspace: { ownerId: 'helper-source', entry: 'dependency.js' } } }
    project.instances.b = { ...structuredClone(project.instances.a), id: 'b' }; project.surfaces[0].childIds.push('b')
    resources.components['original-source'] = { 'entry.js': new TextEncoder().encode('export const count = 0'), 'note.txt': new TextEncoder().encode('保留') }
    resources.components['helper-source'] = { 'dependency.js': new TextEncoder().encode('export const start:number = 2') }
  })
  expect(await h.gateway.execute('safe', randomUUID(), { name: 'object.update', input: { target: h.handle,
    properties: { implementation: { kind: 'source', language: 'typescript', source: 'import { start } from "helper"; export const count:number = start + 1' } } } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const model = h.model(), implementation = model.project.instances.a.implementationOverride!
  if (implementation.kind !== 'source' || !implementation.workspace) throw new Error('Expected source workspace')
  expect(implementation.workspace.entry).toBe('entry.js')
  expect(new TextDecoder().decode(model.resources.components[implementation.workspace.ownerId]['note.txt'])).toBe('保留')
  expect(model.project.instances.b.implementationOverride).toBeUndefined()
  const { componentCompilationInputSchema } = await import('../../src/shared/workbench/componentCompilation')
  const input = componentCompilationInputSchema.parse(componentCompilationInput(model.project, implementation, model.resources))
  const compiler = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  expect(await compiler.compile(input)).toMatchObject({ status: 'ready', cacheHit: false })
  expect(await compiler.compile(componentCompilationInputSchema.parse({ ...input, entryLanguage: 'javascript' }))).toMatchObject({ status: 'failed', cacheHit: false })
  expect(await compiler.compile(input)).toMatchObject({ status: 'ready', cacheHit: true })
  const originalImplementation = model.project.definitions['guoling.text'].implementation
  if (originalImplementation.kind !== 'source') throw new Error('Original source implementation required')
  const original = componentCompilationInputSchema.parse(componentCompilationInput(model.project, originalImplementation, model.resources))
  expect(original.entryLanguage).toBe('javascript')
  expect(await compiler.compile(original)).toMatchObject({ status: 'ready', cacheHit: false })
})

it('resolves public observed references only in declared fields and delivers its Flow anchor to the actual placement consumer', async () => {
  const h = await fixture('text', [], 0, 0, 'object', '浮层', project => {
    const surface = project.surfaces[0]
    surface.kind = 'flow'
    project.surfaces.push({ id: 'destination', kind: 'slide', title: '讲解页', childIds: [],
      presentation: { states: [{ id: 'teaching-state', title: '讲解', overrides: {} }] } })
    project.instances.b = { ...structuredClone(project.instances.a), id: 'b', data: JSON.parse(JSON.stringify(createTextComponentData('正文段落'))) }
    surface.childIds.push('b')
  })
  const runId = 'public-refs', surfaceId = h.project.surfaces[0].id
  await h.gateway.beginRun({ runId, actor: 'agent', documents: [{ documentId: h.session.documentId, writable: [{ kind: 'document' }] }] })
  await h.gateway.loadToolFamilies(runId, ['interaction', 'layout'])
  const page = await h.gateway.issueTarget(runId, h.session.documentId, { kind: 'course-surface', surfaceId })
  const object = await h.gateway.issueTarget(runId, h.session.documentId, { kind: 'course-instance', surfaceId, instanceId: 'a' })
  const paragraph = await h.gateway.issueTarget(runId, h.session.documentId, { kind: 'course-instance', surfaceId, instanceId: 'b' })
  const destination = await h.gateway.issueTarget(runId, h.session.documentId, { kind: 'course-surface', surfaceId: 'destination' })
  const state = await h.gateway.issueTarget(runId, h.session.documentId, { kind: 'course-surface', surfaceId: 'destination', stateId: 'teaching-state' })
  expect(await h.gateway.execute(runId, randomUUID(), { name: 'batch', input: { operations: [
    { name: 'interaction.update', input: { target: page, change: { kind: 'add', rule: {
      name: object, enabled: true, trigger: { type: 'component.event', nodeId: object, eventName: page },
      conditions: [{ type: 'scene.in', sceneIds: [page] }],
      actions: [{ start: 'after-previous', delayMs: 0, action: { type: 'scene.go', sceneId: destination, targetStateId: state } }],
    } } } },
    { name: 'object.place', input: { target: object, placement: { kind: 'flow-overlay',
      placement: { space: 'paper', plane: 'overlay', paragraphAnchor: { blockId: paragraph, xRatio: 0.25, offsetY: 8 } } } } },
  ] } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const project = h.model().project
  const rules = interactionRules(interactionBehavior(project, { kind: 'surface', surfaceId }))
  expect(rules[0]).toMatchObject({ name: object, trigger: { type: 'component.event', nodeId: 'a', eventName: page },
    conditions: [{ type: 'scene.in', sceneIds: [surfaceId] }], actions: [{ action: { type: 'scene.go', sceneId: 'destination', targetStateId: 'teaching-state' } }] })
  const anchor = project.instances.a.flowPlacement!.paragraphAnchor!
  expect(anchor.blockId).toBe('b')
  expect(flowParagraphAnchoredFrame(anchor, { x: 30, y: 40, width: 400, height: 120 }, 800,
    [{ blockId: 'b', depth: 0, x: 50, y: 160, width: 700, height: 60 }])).toMatchObject({ x: 200, y: 168 })
  expect(h.session.read().undoDepth).toBe(1)
  expect(h.driver.load(h.driver.serialize(h.model()))).toMatchObject({ project: { instances: { a: { flowPlacement: { paragraphAnchor: anchor } } } } })
  const current = h.session.read()
  await h.session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, operationId: randomUUID(), actor: 'human', mutation: { type: 'undo' } })
  expect(h.model().project.instances.a.flowPlacement).toBeUndefined()
  expect(interactionBehavior(h.model().project, { kind: 'surface', surfaceId })).toBeUndefined()
})
