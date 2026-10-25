// @vitest-environment node
import { componentSurfaces, resolveComponentPresentation } from '../../src/shared/contracts/component-platform/project'
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { TextDriver } from '../../src/core/drivers/TextDriver'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createTextComponentData, TEXT_DEFINITION } from '../../src/components/text'
import { createFormulaComponentData, formulaComponentDataSchema, textComponentDataSchema } from '../../src/components/text/data'
import { FORMULA_DEFINITION } from '../../src/components/text/adapters'
import { formulaComponentHtml } from '../../src/components/text/render'
import { componentPropertiesEdits } from '../../src/renderer/ui/properties/componentProperties'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { plainDocumentText } from '../../src/shared/document/content'
import { parseDocumentMarkdown } from '../../src/shared/document/markdown'
import { textSelectionTarget } from '../../src/core/tools/ToolTargets'
import type { DocumentDriver, DocumentModel } from '../../src/shared/workbench/document'
import type { ToolTarget } from '../../src/shared/workbench/tools'

async function fixture(driver: DocumentDriver, model: DocumentModel, writable: ToolTarget[]) {
  let saved = new Uint8Array()
  const registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save(input) { saved = input.bytes.slice();
      if (input.binding.kind !== 'file') throw new Error('file required'); return { ...input.binding, version: 'saved' } } } })
  const session = await registry.create(model, 'format.test')
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  await gateway.beginRun({ runId: 'format', actor: 'agent', documents: [{ documentId: session.documentId, writable }] })
  return { registry, session, gateway, saved: () => saved }
}

function project() {
  const value = createBlankCourseProjectV10('格式测试')
  value.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  const a = createTextComponentData('A：来源'), b = createTextComponentData('B：原文😀')
  a.appearance.color = '#ffff00'; a.appearance.fontSize = 52
  b.appearance.fontSize = 31; b.appearance.fontFamily = 'serif'; b.sizing.mode = 'fixed'
  value.instances.a = { id: 'a', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(a)),
    style: { textShadow: '2px 3px 4px #000000, -1px -2px 0px #ff0000' }, frame: { width: 160, height: 60, transform: [1, 0, 0, 1, 20, 30] } }
  value.instances.b = { id: 'b', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(b)),
    frame: { width: 200, height: 90, transform: [1, 0, 0, 1, 500, 300] } }
  testContainerInstance(value, 0).childIds = ['a', 'b']
  return value
}

function mixedText() {
  return createTextComponentData({ inlines: [
    { type: 'text', text: '显式😀', rangeIds: ['range-original'], link: { href: 'https://example.test/original', title: '原链接' },
      style: { fontSize: 42, color: '#123456', italic: true, highlightColor: '#ffeeaa', bold: false } },
    { type: 'math', formulaId: 'inline-formula-original', latex: 'x+1', accessibleText: 'x 加一', style: { fontSize: 36, color: '#345678' } },
    { type: 'text', text: '继承默认', style: { underline: true } },
  ] })
}

it.each([{ field: 'fontSize' as const, value: 60 }, { field: 'color' as const, value: '#abcdef' }])(
  'applies whole-text $field when the default already matches, preserving omitted styles and matching the GUI owner', async ({ field, value }) => {
    const p = project(), surfaceId = componentSurfaces(p)[0].id, original = mixedText()
    Object.assign(original.appearance, { [field]: value })
    p.instances.b.data = JSON.parse(JSON.stringify(original))
    const object: ToolTarget = { kind: 'course-instance', surfaceId, instanceId: 'b' }
    const f = await fixture(new CourseV10Driver(), { kind: 'course-v10', project: p, resources: { assets: {}, components: {} } }, [object])
    const target = await f.gateway.issueTarget('format', f.session.documentId, object)
    const call = { name: 'object.update', input: { target, properties: { appearance: { [field]: value } } } }
    const scopes = await f.gateway.effectWriteScopes('format', call)
    expect(scopes, JSON.stringify(scopes)).toEqual([{ documentId: f.session.documentId, epoch: f.session.read().epoch,
      paths: [0, 1].map(index => ['instances', 'b', 'data', 'content', 'inlines', String(index), 'style', field]) }])
    expect(await f.gateway.execute('format', `whole-${field}`, call)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const after = f.session.read(); if (after.model.kind !== 'course-v10') throw new Error('course expected')
    const expected = structuredClone(original)
    for (const inline of expected.content.inlines.slice(0, 2)) Object.assign(inline.style!, { [field]: value })
    expect(after.model.project.instances.b).toEqual({ ...p.instances.b, data: expected })
    expect(after.model.project.instances.a).toEqual(p.instances.a)
    expect(after.undoDepth).toBe(1)
    const gui = applyComponentOperation(p, captureComponentOperation(p,
      componentPropertiesEdits(p.instances.b, p.definitions[TEXT_DEFINITION.id], { style: { [field]: value } })))
    expect(gui.instances.b).toEqual(after.model.project.instances.b)
  })

it('plans combined data and appearance against the new captured-state content and reports its actual inline fields', async () => {
  const p = project(), surfaceId = componentSurfaces(p)[0].id, old = mixedText()
  const state = { id: 'captured', title: 'Captured', order: ['a', 'b'], overrides: { b: { data: JSON.parse(JSON.stringify(old)) } } }
  const other = { id: 'other', title: 'Other', order: ['a', 'b'], overrides: {} }
  testContainerInstance(p, 0).container.presentation = { states: [state, other] }
  const object: ToolTarget = { kind: 'course-instance', surfaceId, instanceId: 'b', stateId: state.id }
  const f = await fixture(new CourseV10Driver(), { kind: 'course-v10', project: p, resources: { assets: {}, components: {} } }, [object])
  const target = await f.gateway.issueTarget('format', f.session.documentId, object)
  const content = { inlines: [{ type: 'text' as const, text: '新正文', style: { color: '#112233', italic: true }, link: { href: 'https://example.test/new' } }] }
  const call = { name: 'object.update', input: { target, properties: { data: { content }, appearance: { color: '#abcdef' } } } }
  const root = ['@surface', surfaceId, '@state', state.id, 'overrides', 'b', 'data']
  const scopes = await f.gateway.effectWriteScopes('format', call)
  const paths = [[...root, 'content'], [...root, 'appearance', 'color'], [...root, 'content', 'inlines', '0', 'style', 'color']]
  expect(scopes, JSON.stringify(scopes)).toEqual([{ documentId: f.session.documentId, epoch: f.session.read().epoch,
    paths: expect.arrayContaining(paths) }])
  expect(scopes![0].paths).toHaveLength(paths.length)
  expect(await f.gateway.execute('format', 'data-and-appearance', call)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const after = f.session.read(); if (after.model.kind !== 'course-v10') throw new Error('course expected')
  const active = resolveComponentPresentation(after.model.project, surfaceId, state.id)
  expect(textComponentDataSchema.parse(active.instances.b.data)).toEqual({ ...old,
    content: { inlines: [{ ...content.inlines[0], rangeIds: ['range-original'], style: { color: '#abcdef', italic: true } }] },
    appearance: { ...old.appearance, color: '#abcdef' } })
  expect(after.model.project.instances.b).toEqual(p.instances.b)
  const otherProject = resolveComponentPresentation(after.model.project, surfaceId, other.id)
  expect(otherProject.instances.a).toEqual(p.instances.a)
  expect(otherProject.instances.b).toEqual(p.instances.b)
  expect(componentSurfaces(after.model.project)[0].presentation!.states[1]).toEqual(other)
  expect(after.model.project.instances[surfaceId].childIds).toEqual(p.instances[surfaceId].childIds)
  expect(after.model.project.instances[surfaceId].frame).toEqual(p.instances[surfaceId].frame)
  expect(after.undoDepth).toBe(1)
  expect(await f.session.execute({ documentId: after.documentId, epoch: after.epoch, baseRevision: after.revision,
    operationId: 'undo-combined', actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  const undone = f.session.read(); if (undone.model.kind !== 'course-v10') throw new Error('course expected')
  expect(undone.model.project.instances).toEqual(p.instances)
})

it('sets the new default together with adjacent run overrides when canonical normalization merges those runs', async () => {
  const p = project(), surfaceId = componentSurfaces(p)[0].id
  const link = { href: 'https://example.test/original', title: '原链接' }
  const original = createTextComponentData({ inlines: [
    { type: 'text', text: '甲', style: { color: '#ff0000' }, link, rangeIds: ['range-original'] },
    { type: 'text', text: '乙', style: { color: '#0000ff' }, link, rangeIds: ['range-original'] },
    { type: 'text', text: '继承默认' },
  ] })
  p.instances.b.data = JSON.parse(JSON.stringify(original))
  const object: ToolTarget = { kind: 'course-instance', surfaceId, instanceId: 'b' }
  const f = await fixture(new CourseV10Driver(), { kind: 'course-v10', project: p, resources: { assets: {}, components: {} } }, [object])
  const target = await f.gateway.issueTarget('format', f.session.documentId, object)
  expect(await f.gateway.execute('format', 'merge-appearance', { name: 'object.update', input: { target,
    properties: { appearance: { color: '#00ff00' } } } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const after = f.session.read(); if (after.model.kind !== 'course-v10') throw new Error('course expected')
  expect(after.model.project.instances.b).toEqual({ ...p.instances.b, data: { ...original,
    appearance: { ...original.appearance, color: '#00ff00' }, content: { inlines: [
      { type: 'text', text: '甲乙', style: { color: '#00ff00' }, link, rangeIds: ['range-original'] }, original.content.inlines[2],
    ] } } })
  expect(after.model.project.instances.a).toEqual(p.instances.a)
  expect(after.undoDepth).toBe(1)
})

it('retains literal data.appearance defaults and inherited locks at the canonical writer', async () => {
  const p = project(), surfaceId = componentSurfaces(p)[0].id, original = mixedText()
  p.instances.b.data = JSON.parse(JSON.stringify(original))
  const object: ToolTarget = { kind: 'course-instance', surfaceId, instanceId: 'b' }
  const f = await fixture(new CourseV10Driver(), { kind: 'course-v10', project: p, resources: { assets: {}, components: {} } }, [object])
  const target = await f.gateway.issueTarget('format', f.session.documentId, object)
  expect(await f.gateway.execute('format', 'literal-default', { name: 'object.update', input: { target,
    properties: { data: { appearance: { fontSize: 60, color: '#abcdef' } } } } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const after = f.session.read(); if (after.model.kind !== 'course-v10') throw new Error('course expected')
  expect(textComponentDataSchema.parse(after.model.project.instances.b.data)).toEqual({ ...original, appearance: { ...original.appearance, fontSize: 60, color: '#abcdef' } })
  testContainerInstance(p, 0).locked = true
  const locked = await fixture(new CourseV10Driver(), { kind: 'course-v10', project: p, resources: { assets: {}, components: {} } }, [object])
  const lockedTarget = await locked.gateway.issueTarget('format', locked.session.documentId, object)
  expect(await locked.gateway.execute('format', 'inherited-lock', { name: 'object.update', input: { target: lockedTarget,
    properties: { appearance: { fontSize: 60, color: '#abcdef' } } } })).toMatchObject({ kind: 'error' })
  expect(locked.session.read()).toMatchObject({ revision: 0, undoDepth: 0, model: { project: p } })
})

it('copies effective formula size and color while mixed-text appearanceFrom keeps its existing defaults', async () => {
  const p = project(), surfaceId = componentSurfaces(p)[0].id, sourceData = mixedText()
  p.instances.a.data = JSON.parse(JSON.stringify(sourceData))
  p.definitions[FORMULA_DEFINITION.id] = FORMULA_DEFINITION
  const formula = createFormulaComponentData('source-formula', 'x+1')
  formula.formula.style = { fontSize: 42, color: '#123456' }
  p.instances.formula = { id: 'formula', definitionId: FORMULA_DEFINITION.id, data: JSON.parse(JSON.stringify(formula)) }
  testContainerInstance(p, 0).childIds.push('formula')
  const object: ToolTarget = { kind: 'course-instance', surfaceId, instanceId: 'b' }
  const f = await fixture(new CourseV10Driver(), { kind: 'course-v10', project: p, resources: { assets: {}, components: {} } }, [object])
  const target = await f.gateway.issueTarget('format', f.session.documentId, object)
  const source = await f.gateway.issueTarget('format', f.session.documentId, { kind: 'course-instance', surfaceId, instanceId: 'formula' })
  expect(await f.gateway.execute('format', 'copy-effective-formula', { name: 'object.update', input: { target,
    properties: { appearanceFrom: { target: source, fields: ['fontSize', 'color'] }, appearance: { color: '#abcdef' } } } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  let after = f.session.read(); if (after.model.kind !== 'course-v10') throw new Error('course expected')
  expect(textComponentDataSchema.parse(after.model.project.instances.b.data).appearance).toMatchObject({ fontSize: 42, color: '#abcdef' })
  const mixed = await f.gateway.issueTarget('format', f.session.documentId, { kind: 'course-instance', surfaceId, instanceId: 'a' })
  const current = await f.gateway.issueTarget('format', f.session.documentId, object)
  expect(await f.gateway.execute('format', 'copy-mixed-default', { name: 'object.update', input: { target: current,
    properties: { appearanceFrom: { target: mixed, fields: ['fontSize', 'color'] } } } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  after = f.session.read(); if (after.model.kind !== 'course-v10') throw new Error('course expected')
  expect(textComponentDataSchema.parse(after.model.project.instances.b.data).appearance).toMatchObject({ fontSize: sourceData.appearance.fontSize, color: sourceData.appearance.color })
  expect(after.model.project.instances.a).toEqual(p.instances.a)
  expect(after.model.project.instances.formula).toEqual(p.instances.formula)
})

it('applies agent whole-formula appearance to its visible override instead of only changing a hidden default', async () => {
  const p = project(), surfaceId = componentSurfaces(p)[0].id
  p.definitions[FORMULA_DEFINITION.id] = FORMULA_DEFINITION
  const data = createFormulaComponentData('formula-original', 'x+1')
  data.formula.style = { fontSize: 42, color: '#123456' }
  p.instances.formula = { id: 'formula', definitionId: FORMULA_DEFINITION.id, data: JSON.parse(JSON.stringify(data)),
    frame: { width: 300, height: 90, transform: [1, 0, 0, 1, 20, 110] } }
  testContainerInstance(p, 0).childIds!.push('formula')
  const object: ToolTarget = { kind: 'course-instance', surfaceId, instanceId: 'formula' }
  const f = await fixture(new CourseV10Driver(), { kind: 'course-v10', project: p, resources: { assets: {}, components: {} } }, [object])
  const target = await f.gateway.issueTarget('format', f.session.documentId, object)
  const result = await f.gateway.execute('format', 'visible-formula', { name: 'object.update', input: {
    target, properties: { appearance: { fontSize: 60, color: '#abcdef' } },
  } })
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const after = f.session.read(); if (after.model.kind !== 'course-v10') throw new Error('course expected')
  const actual = formulaComponentDataSchema.parse(after.model.project.instances.formula.data)
  expect(actual.formula).toEqual({ ...data.formula, style: { fontSize: 60, color: '#abcdef' } })
  expect(formulaComponentHtml(actual)).toContain('60px')
  expect(formulaComponentHtml(actual)).toContain('#abcdef')
  expect(actual.appearance).toEqual(data.appearance)
  expect(after.model.project.instances.formula.frame).toEqual(p.instances.formula.frame)
  expect(after.model.project.instances.a).toEqual(p.instances.a)
  expect(after.undoDepth).toBe(1)
})

it('matches only supplied professional color and two shadow layers, preserving B body/size/frame through save and Undo', async () => {
  const p = project(), driver = new CourseV10Driver(), surfaceId = componentSurfaces(p)[0].id
  const b: ToolTarget = { kind: 'course-instance', surfaceId, instanceId: 'b' }
  const f = await fixture(driver, { kind: 'course-v10', project: p, resources: { assets: {}, components: {} } }, [b])
  const target = await f.gateway.issueTarget('format', f.session.documentId, b)
  const source = await f.gateway.issueTarget('format', f.session.documentId, { kind: 'course-instance', surfaceId, instanceId: 'a' })
  const observed = await f.gateway.execute('format', 'source-read', { name: 'read', input: { target: source } })
  expect(observed).toMatchObject({ kind: 'read' })
  const original = f.session.read()
  const call = { name: 'object.update', input: { target, properties: { appearanceFrom: { target: source, fields: ['color', 'shadows'] } } } }
  expect(await f.gateway.effectTargets('format', call)).toEqual([{ documentId: f.session.documentId, epoch: original.epoch, target: b }])
  const scopes = await f.gateway.effectWriteScopes('format', call)
    expect(scopes, JSON.stringify(scopes)).toEqual([{ documentId: f.session.documentId, epoch: original.epoch,
    paths: [['instances', 'b', 'data', 'appearance', 'color'], ['instances', 'b', 'style', 'textShadow']] }])
  const result = await f.gateway.execute('format', 'match', call)
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const after = f.session.read(); if (after.model.kind !== 'course-v10') throw new Error('course expected')
  const data = textComponentDataSchema.parse(after.model.project.instances.b.data)
  expect(data.content).toEqual(textComponentDataSchema.parse(p.instances.b.data).content)
  expect(data.appearance).toMatchObject({ color: '#ffff00', fontSize: 31, fontFamily: 'serif' })
  expect(after.model.project.instances.b.style?.textShadow).toBe(p.instances.a.style?.textShadow)
  expect(after.model.project.instances.b.frame).toEqual(p.instances.b.frame)
  expect(after.model.project.instances.a).toEqual(p.instances.a)
  await f.registry.save(f.session.documentId, { kind: 'file', path: 'format.h5lesson', version: null, bindingVersion: 0 })
  expect(driver.load(f.saved())).toEqual(after.model)
  const current = f.session.read()
  expect(await f.session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
    operationId: 'undo', actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  const undone = f.session.read(); if (undone.model.kind !== 'course-v10' || original.model.kind !== 'course-v10') throw new Error('course expected')
  expect(undone.model.project.instances).toEqual(original.model.project.instances)
})

it('formats a frozen professional text range without modifying unselected text/formula/appearance or widening to object.update', async () => {
  const p = project(), surfaceId = componentSurfaces(p)[0].id, original = createTextComponentData({ inlines: [
    { type: 'text', text: '左😀', style: { italic: true } }, { type: 'text', text: '选中文', style: { fontSize: 27 } },
    { type: 'math', formulaId: 'formula-a', latex: 'x+1', accessibleText: 'x 加一' }, { type: 'text', text: '右', style: { underline: true } },
  ] })
  p.instances.b.data = JSON.parse(JSON.stringify(original))
  const range: ToolTarget = { kind: 'course-instance', surfaceId, instanceId: 'b', dataPath: ['content'], from: 2, to: 5 }
  const f = await fixture(new CourseV10Driver(), { kind: 'course-v10', project: p, resources: { assets: {}, components: {} } }, [range])
  const aggregate = textSelectionTarget(f.session.read().model, [range]), target = await f.gateway.issueTarget('format', f.session.documentId, aggregate)
  const result = await f.gateway.execute('format', 'range-format', { name: 'text.format', input: { target, style: { bold: true, color: '#ff0000' } } })
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const after = f.session.read(); if (after.model.kind !== 'course-v10') throw new Error('course expected')
  const data = textComponentDataSchema.parse(after.model.project.instances.b.data)
  expect(plainDocumentText(data.content)).toBe(plainDocumentText(original.content))
  expect(data.content.inlines).toEqual([original.content.inlines[0], { type: 'text', text: '选中文', style: { fontSize: 27, bold: true, color: '#ff0000' } }, ...original.content.inlines.slice(2)])
  expect(data.appearance).toEqual(original.appearance)
  const whole = await f.gateway.issueTarget('format', f.session.documentId, { kind: 'course-instance', surfaceId, instanceId: 'b' })
  expect(await f.gateway.execute('format', 'cannot-widen', { name: 'object.update', input: { target: whole, properties: { appearance: { fontSize: 88 } } } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
})

it('formats ordinary Markdown selected inside existing bold and preserves other styles, formula, CRLF, links and unselected blocks', async () => {
  const tail = '\r\n\r\n- 不动列表\r\n\r\n![原图](../media/old.svg)\r\n'
  const source = '# 不动\r\n\r\n前 **甲选中乙** [链接](https://example.test) $x+1$ 后' + tail
  const range: ToolTarget = { kind: 'markdown-range', from: source.indexOf('选中'), to: source.indexOf('选中') + 2 }
  const driver = new MarkdownDriver(), f = await fixture(driver, driver.load(new TextEncoder().encode(source)), [range])
  const target = await f.gateway.issueTarget('format', f.session.documentId, textSelectionTarget(f.session.read().model, [range]))
  const result = await f.gateway.execute('format', 'markdown-format', { name: 'text.format', input: { target, style: { bold: false, italic: true, color: '#ff0000' } } })
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const after = f.session.read(); if (after.model.kind !== 'markdown') throw new Error('markdown expected')
  expect(after.model.source.startsWith('# 不动\r\n\r\n')).toBe(true)
  expect(after.model.source.endsWith(tail)).toBe(true)
  const parsed = parseDocumentMarkdown(after.model.source, { target: 'file', createId: () => randomUUID(),
    resolveImage: () => ({ assetId: 'original', source: { kind: 'relative', path: 'media/old.svg' } }) })
  if (parsed.status !== 'valid') throw new Error(JSON.stringify(parsed.diagnostics))
  const body = parsed.document.content.blocks.find(block => block.type === 'paragraph')
  if (body?.type !== 'paragraph') throw new Error('paragraph expected')
  expect(body.content.inlines.find(inline => inline.type === 'text' && inline.text === '选中')).toMatchObject({ style: { bold: false, italic: true, color: '#ff0000' } })
  expect(body.content.inlines.filter(inline => inline.type === 'text' && ['甲', '乙'].includes(inline.text))).toHaveLength(2)
  expect(body.content.inlines.every(inline => inline.type !== 'text' || !['甲', '乙'].includes(inline.text) || inline.style?.bold)).toBe(true)
  expect(body.content.inlines.some(inline => inline.type === 'math' && inline.latex === 'x+1')).toBe(true)
  expect(body.content.inlines.some(inline => inline.type === 'text' && inline.link?.href === 'https://example.test')).toBe(true)
})

it('does not advertise formatting for a plain text file', async () => {
  const driver = new TextDriver(), f = await fixture(driver, driver.load(new TextEncoder().encode('原文')), [{ kind: 'document' }])
  expect((await f.gateway.describeRun('format')).map(tool => tool.name)).not.toContain('text.format')
})

it('keeps explicit style precedence over copied appearance and rejects an unobserved source before writing', async () => {
  const p = project(), surfaceId = componentSurfaces(p)[0].id
  const b: ToolTarget = { kind: 'course-instance', surfaceId, instanceId: 'b' }
  const f = await fixture(new CourseV10Driver(), { kind: 'course-v10', project: p, resources: { assets: {}, components: {} } }, [b])
  const target = await f.gateway.issueTarget('format', f.session.documentId, b)
  const source = await f.gateway.issueTarget('format', f.session.documentId, { kind: 'course-instance', surfaceId, instanceId: 'a' })
  expect(await f.gateway.execute('format', 'not-observed', { name: 'object.update', input: { target, properties: {
    appearanceFrom: { target: 'client-invented', fields: ['color'] },
  } } })).toMatchObject({ kind: 'error', code: 'invalid-target' })
  expect(f.session.read().revision).toBe(0)
  expect(await f.gateway.execute('format', 'explicit', { name: 'object.update', input: { target, properties: {
    appearanceFrom: { target: source, fields: ['color', 'shadows'] },
    appearance: { shadows: [{ x: 2, y: 2, blur: 0, color: '#ff0000' }] }, style: { textShadow: '3px 3px 0px #00ff00', opacity: .5 },
  } } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const after = f.session.read(); if (after.model.kind !== 'course-v10') throw new Error('course expected')
  expect(after.model.project.instances.b.style).toMatchObject({ textShadow: '3px 3px 0px #00ff00', opacity: .5 })
  expect(textComponentDataSchema.parse(after.model.project.instances.b.data).appearance.color).toBe('#ffff00')
})
