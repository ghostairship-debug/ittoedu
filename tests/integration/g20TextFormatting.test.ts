// @vitest-environment node
import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { TextDriver } from '../../src/core/drivers/TextDriver'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createTextComponentData, TEXT_DEFINITION } from '../../src/components/text'
import { textComponentDataSchema } from '../../src/components/text/data'
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
  value.surfaces[0].childIds = ['a', 'b']
  return value
}

it('matches only supplied professional color and two shadow layers, preserving B body/size/frame through save and Undo', async () => {
  const p = project(), driver = new CourseV10Driver(), surfaceId = p.surfaces[0].id
  const b: ToolTarget = { kind: 'course-instance', surfaceId, instanceId: 'b' }
  const f = await fixture(driver, { kind: 'course-v10', project: p, resources: { assets: {}, components: {} } }, [b])
  const target = await f.gateway.issueTarget('format', f.session.documentId, b)
  const source = await f.gateway.issueTarget('format', f.session.documentId, { kind: 'course-instance', surfaceId, instanceId: 'a' })
  const observed = await f.gateway.execute('format', 'source-read', { name: 'read', input: { target: source } })
  expect(observed).toMatchObject({ kind: 'read' })
  const original = f.session.read()
  const call = { name: 'object.update', input: { target, properties: { appearanceFrom: { target: source, fields: ['color', 'shadows'] } } } }
  expect(await f.gateway.effectTargets('format', call)).toEqual([{ documentId: f.session.documentId, epoch: original.epoch, target: b }])
  expect(await f.gateway.effectWriteScopes('format', call)).toEqual([{ documentId: f.session.documentId, epoch: original.epoch,
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
  const p = project(), surfaceId = p.surfaces[0].id, original = createTextComponentData({ inlines: [
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
  const p = project(), surfaceId = p.surfaces[0].id
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
