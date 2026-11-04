// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { applyOfficeContent, inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { OfficeFileService } from '../../src/main/workbench/office/OfficeFileService'
import { descendants, NS, OfficePackage } from '../../src/main/workbench/office/officePackage'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'
import { complexPptxFixture } from '../helpers/officeComplexFixture20261103'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('fixture outside temp')
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
  }
})
const selection: ModelSelection = {
  model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
    baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture' }, billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } },
}
function complete(request: ModelRequest, id?: string, name?: string, input?: unknown): Extract<ModelEvent, { type: 'response.completed' }> {
  const calls = id && name ? [{ id, type: 'function' as const, function: { name, arguments: JSON.stringify(input) } }] : []
  return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: `response-${request.requestId}`, actualModel: 'fixture', nativeResponse: {},
    finishReason: calls.length ? 'tool_calls' : 'stop', toolCalls: calls.map(call => ({ id: call.id, name: call.function.name, argumentsText: call.function.arguments })),
    assistant: { role: 'assistant', content: calls.length ? '' : '已完成。', ...(calls.length ? { tool_calls: calls } : {}) } }
}
async function fixture(provider: ModelProvider) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'unified-office-engine-')); roots.push(directory)
  const workspace = path.join(directory, 'workspace'), lesson = path.join(workspace, 'lesson'); await fs.mkdir(lesson, { recursive: true })
  const host = new DocumentHostService(path.join(directory, 'owner'))
  host.tools.configureHostServices({ office: { execute: async ({ grant, operationId, name, input, approvedPaths, assertActive }) => {
    const access = grant.fileAccess!
    const result = await host.agentFiles.executeOffice({ runId: grant.runId, workspaceRoot: access.workspaceRoot!,
      permission: access.permission, conversationHome: access.conversationHome, conversationHomeRoot: access.conversationHomeRoot,
      boundPaths: Object.values(access.boundPaths ?? {}), approvedOutsidePaths: approvedPaths, assertActive }, name, input, operationId)
    return { kind: 'read', data: result.data }
  } } })
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, files: host.agentFiles, provider,
    runs: new ExecutionRunStore(path.join(directory, 'runs')), events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
  return { host, engine, workspace, lesson }
}

describe('Office content tools in the general execution engine', () => {
  it('merges a neighboring human edit and lets the same AI task reread and resolve a real Office conflict', async () => {
    let turn = 0, filename = '', office: OfficeFileService
    let observedVersion = ''
    const change = (cell: string, value: number) => ({ format: 'xlsx' as const, edits: [{ sheet: 'Budget', cell, value }] })
    const human = async (cell: string, value: number) => office.edit(await office.bindWorking(filename),
      { ...change(cell, value), operation: 'edit' }, { actor: 'human' })
    const version = async () => (await office.bindWorking(filename)).fileVersion
    const read = (request: ModelRequest, id: string) => complete(request, id, 'office.inspect', { path: filename })
    const edit = (request: ModelRequest, id: string, value: number) => complete(request, id, 'office.edit', {
      path: filename, expectedVersion: observedVersion, content: change('A1', value),
    })
    const model: ModelProvider = { async *stream(request) {
      turn++
      if (turn === 1) {
        observedVersion = await version()
        yield read(request, 'inspect-before-neighbor')
      } else if (turn === 2) {
        await human('B1', 11)
        yield edit(request, 'merge-neighbor', 2)
      } else if (turn === 3) {
        observedVersion = await version()
        yield read(request, 'inspect-before-conflict')
      } else if (turn === 4) {
        await human('A1', 3)
        yield edit(request, 'conflicting-change', 4)
      } else if (turn === 5) {
        expect(JSON.stringify(request.messages)).toContain('office-merge-conflict')
        observedVersion = await version()
        yield read(request, 'reread-current')
      } else if (turn === 6) {
        const reread = request.messages.find(message => message.role === 'tool' && message.tool_call_id === 'reread-current')
        expect(reread?.content).toContain('"value":3')
        yield edit(request, 'resolve-with-current-value', 34)
      } else if (turn === 7) yield complete(request)
      else throw new Error('unexpected AI continuation')
    } }
    const f = await fixture(model)
    filename = path.join(f.lesson, 'concurrent.xlsx')
    office = new OfficeFileService(f.host)
    const original = await applyOfficeContent(undefined, { format: 'xlsx', operation: 'create', sheets: [{ name: 'Budget', rows: [[1, 10]] }] })
    await fs.writeFile(filename, original.bytes)
    const opened = await office.bindWorking(filename, true)
    const started = await f.engine.start({ conversationId: 'conversation', taskId: 'merge-then-resolve',
      instruction: '修改 A1，保留其他单元格。如果有人同时修改 A1，读取当前值后再决定新值。',
      documents: [], workspaceRoot: f.workspace, permission: 'workspace', selection,
      fileContext: { openFiles: [], references: [], officeCard: { ...opened, selection: { format: 'xlsx', sheet: 'Budget', range: 'A1' } } } })
    const final = await f.engine.wait(started.runId)
    expect(turn, JSON.stringify(final.tools)).toBe(7)
    expect(final.tools.map(tool => tool.call.name)).toEqual(['office.inspect', 'office.edit', 'office.inspect', 'office.edit', 'office.inspect', 'office.edit'])
    expect(final.tools[1].result).toMatchObject({ kind: 'read', data: { status: 'draft', applied: true } })
    expect(final.tools[3].result).toMatchObject({ kind: 'error', code: 'office-merge-conflict',
      message: expect.stringMatching(/A1/) })
    expect(final.tools[5].result).toMatchObject({ kind: 'read', data: { status: 'draft', applied: true } })
    expect(final.status).toBe('completed')
    const values = (bytes: Uint8Array) => {
      const inspection = inspectOfficeContent(bytes, 'xlsx')
      if (inspection.format !== 'xlsx') throw new Error('expected Excel')
      return inspection.sheets[0].cells.map(({ cell, value }) => [cell, value])
    }
    const latest = await office.bindWorking(filename)
    expect(values(await office.readWorking(latest))).toEqual([['A1', 34], ['B1', 11]])
    expect(values(await fs.readFile(filename))).toEqual([['A1', 1], ['B1', 10]])
    expect((await office.history(latest)).entries.map(entry => entry.actor)).toEqual(['human', 'ai', 'human', 'ai'])
    const undone = await office.moveHistory(latest, 'undo')
    expect(values(await office.readWorking(undone.binding))).toEqual([['A1', 3], ['B1', 11]])
    const redone = await office.moveHistory(undone.binding, 'redo')
    await office.saveWorking(redone.binding)
    const cold = new OfficeFileService(new DocumentHostService(path.join(path.dirname(f.workspace), 'owner')))
    expect(values(await cold.readWorking(await cold.bindWorking(filename, true)))).toEqual([['A1', 34], ['B1', 11]])
  }, 30_000)

  it('adds a native PowerPoint run and its relationship through AI, preserving a concurrent same-slide edit and undo', async () => {
    const original = await complexPptxFixture()
    const readDeck = (bytes: Uint8Array) => {
      const inspection = inspectOfficeContent(bytes, 'pptx')
      if (inspection.format !== 'pptx') throw new Error('expected PowerPoint')
      return inspection
    }
    const page = readDeck(original).slides[0]
    const title = page.shapes.find(shape => shape.name === 'title')!
    const chart = page.shapes.find(shape => shape.name === 'revenue-chart')!
    const movedX = chart.frame!.x + 72
    const relationship = 'rIdOfficeDepth'
    const url = 'https://example.org/lesson'
    const target = { slide: 0, part: page.part, partVersion: page.partVersion, shapeId: title.shapeId }
    let turn = 0, filename = '', office: OfficeFileService
    const provider: ModelProvider = { async *stream(request) {
      turn++
      if (turn === 1) yield complete(request, 'read-native-title', 'office.inspect', {
        path: filename, object: { format: 'pptx', target: { slide: 0, shapeId: title.shapeId } },
      })
      else if (turn === 2) {
        expect(JSON.stringify(request.messages)).toContain('Complex original title')
        await office.edit(await office.bindWorking(filename), { format: 'pptx', operation: 'edit', edits: [{
          type: 'transform', slide: 0, part: page.part, partVersion: page.partVersion, shapeId: chart.shapeId, x: movedX,
        }] }, { actor: 'human' })
        yield complete(request, 'native-add-linked-run', 'office.deepEdit', {
          path: filename, content: { format: 'pptx', target, edit: {
            path: [{ name: 'p:txBody', index: 0 }, { name: 'a:p', index: 0 }],
            xml: `<a:p><a:r><a:rPr><a:hlinkClick r:id="${relationship}"/></a:rPr><a:t>Open proof</a:t></a:r><a:r><a:t xml:space="preserve"> edition</a:t></a:r><a:endParaRPr/></a:p>`,
            dependencies: { relationships: [{ id: relationship, type: NS.officeRelationship + '/hyperlink', target: url, targetMode: 'External' }] },
          } },
        })
      } else if (turn === 3) yield complete(request)
      else throw new Error('unexpected AI continuation')
    } }
    const f = await fixture(provider)
    filename = path.join(f.lesson, 'concurrent.pptx')
    await fs.writeFile(filename, original)
    office = new OfficeFileService(f.host)
    const opened = await office.bindWorking(filename, true)
    const started = await f.engine.start({ conversationId: 'conversation', taskId: 'deep-ppt-concurrent',
      instruction: '在标题内添加一个有外链的文字段和一段后缀，保留图表及其他对象。',
      documents: [], workspaceRoot: f.workspace, permission: 'workspace', selection,
      fileContext: { openFiles: [], references: [], officeCard: { ...opened,
        selection: { format: 'pptx', page: 0, part: page.part, shapeIds: [title.shapeId] } } } })
    const final = await f.engine.wait(started.runId)
    expect(turn, JSON.stringify(final.tools)).toBe(3)
    expect(final.tools[1].result).toMatchObject({ kind: 'read', data: { status: 'draft', applied: true, saved: false } })
    const latest = await office.bindWorking(filename)
    const changed = await office.readWorking(latest)
    const projected = readDeck(changed).slides[0]
    expect(projected.shapes.find(shape => shape.shapeId === title.shapeId)?.text).toBe('Open proof edition')
    expect(projected.shapes.find(shape => shape.shapeId === chart.shapeId)?.frame?.x).toBeCloseTo(movedX)
    expect(projected.animations).toEqual(page.animations)
    expect(readDeck(await fs.readFile(filename))).toEqual(readDeck(original))
    const relation = (bytes: Uint8Array) => {
      const pkg = new OfficePackage(bytes)
      return descendants(pkg.xml('ppt/slides/_rels/slide1.xml.rels'), NS.relationship, 'Relationship')
        .find(node => node.getAttribute('Id') === relationship)?.getAttribute('Target')
    }
    const link = descendants(new OfficePackage(changed).xml(page.part), NS.drawing, 'hlinkClick')
      .find(node => node.getAttributeNS(NS.officeRelationship, 'id') === relationship)
    expect(link).toBeDefined()
    expect(relation(changed)).toBe(url)
    const undone = await office.moveHistory(latest, 'undo')
    const undoneBytes = await office.readWorking(undone.binding), undonePage = readDeck(undoneBytes).slides[0]
    expect(undonePage.shapes.find(shape => shape.shapeId === title.shapeId)?.text).toBe(title.text)
    expect(undonePage.shapes.find(shape => shape.shapeId === chart.shapeId)?.frame?.x).toBeCloseTo(movedX)
    expect(relation(undoneBytes)).toBeUndefined()
    const redone = await office.moveHistory(undone.binding, 'redo')
    await office.saveWorking(redone.binding)
    const cold = new OfficeFileService(new DocumentHostService(path.join(path.dirname(f.workspace), 'owner')))
    const saved = await cold.readWorking(await cold.bindWorking(filename, true))
    expect(readDeck(saved).slides[0]).toEqual(projected)
    expect(relation(saved)).toBe(url)
  }, 30_000)

  it.each(['docx', 'xlsx'] as const)('routes a native %s structure change into the working draft and undo', async format => {
    const original = await applyOfficeContent(undefined, format === 'docx'
      ? { format, operation: 'create', blocks: [{ type: 'paragraph', text: 'Original link caption' }, { type: 'paragraph', text: 'Keep' }] }
      : { format, operation: 'create', sheets: [{ name: 'Sheet1', rows: [['Original caption', 'Keep']] }] })
    const target = format === 'docx' ? { kind: 'paragraph', paragraph: 0 } : { sheet: 'Sheet1', cell: 'A1' }
    const relationship = 'rIdWordDepth', url = 'https://example.org/word'
    const native = format === 'docx' ? {
      path: [],
      xml: `<w:p><w:hyperlink r:id="${relationship}"><w:r><w:t>Native link</w:t></w:r></w:hyperlink></w:p>`,
      dependencies: { relationships: [{ id: relationship, type: NS.officeRelationship + '/hyperlink', target: url, targetMode: 'External' }] },
    } : {
      path: [],
      xml: '<c r="A1" t="inlineStr"><is><r><rPr><b/></rPr><t>Rich</t></r><r><t xml:space="preserve"> cell</t></r></is></c>',
    }
    let turn = 0, filename = ''
    const provider: ModelProvider = { async *stream(request) {
      turn++
      if (turn === 1) yield complete(request, 'inspect-native', 'office.inspect', { path: filename, object: { format, target } })
      else if (turn === 2) yield complete(request, 'native-structure', 'office.deepEdit', { path: filename, content: { format, target, native } })
      else if (turn === 3) yield complete(request)
      else throw new Error('unexpected AI continuation')
    } }
    const f = await fixture(provider)
    filename = path.join(f.lesson, 'native.' + format)
    await fs.writeFile(filename, original.bytes)
    const office = new OfficeFileService(f.host)
    const opened = await office.bindWorking(filename, true)
    const started = await f.engine.start({ conversationId: 'conversation', taskId: 'deep-native-' + format,
      instruction: format === 'docx' ? '给第一段添加超链接，保留后续段落。' : '给 A1 写入有加粗部分的富文本，保留 B1。',
      documents: [], workspaceRoot: f.workspace, permission: 'workspace', selection,
      fileContext: { openFiles: [], references: [], officeCard: opened } })
    const final = await f.engine.wait(started.runId)
    expect(turn, JSON.stringify(final.tools)).toBe(3)
    expect(final.tools[1].result).toMatchObject({ kind: 'read', data: { status: 'draft', applied: true, saved: false } })
    const current = await office.bindWorking(filename)
    const draft = await office.readWorking(current)
    const pkg = new OfficePackage(draft)
    if (format === 'docx') {
      const link = descendants(pkg.xml(pkg.main()), NS.word, 'hyperlink')[0]
      expect(link?.getAttributeNS(NS.officeRelationship, 'id')).toBe(relationship)
      const rels = pkg.xml('word/_rels/document.xml.rels')
      expect(descendants(rels, NS.relationship, 'Relationship').find(node => node.getAttribute('Id') === relationship)?.getAttribute('Target')).toBe(url)
      expect(inspectOfficeContent(draft, 'docx')).toMatchObject({ paragraphs: [{ text: 'Native link' }, { text: 'Keep' }] })
    } else {
      const cell = descendants(pkg.xml('xl/worksheets/sheet1.xml'), NS.sheet, 'c').find(node => node.getAttribute('r') === 'A1')!
      expect(descendants(cell, NS.sheet, 'b')).toHaveLength(1)
      expect(inspectOfficeContent(draft, 'xlsx')).toMatchObject({ sheets: [{ cells: [
        expect.objectContaining({ cell: 'A1', value: 'Rich cell' }), expect.objectContaining({ cell: 'B1', value: 'Keep' }),
      ] }] })
    }
    expect(inspectOfficeContent(await fs.readFile(filename), format)).toEqual(inspectOfficeContent(original.bytes, format))
    const undone = await office.moveHistory(current, 'undo')
    expect(undone.inspection).toEqual(inspectOfficeContent(original.bytes, format))
  }, 30_000)

  it('applies a confirmed selection edit to an open draft outside the workspace, leaving the original for manual save', async () => {
    let turn = 0, filename = ''
    const provider: ModelProvider = { async *stream(request) {
      turn++
      const names = request.tools?.map(tool => tool.name) ?? []
      expect(names).toEqual(['ask_user', 'office.inspect', 'office.edit', 'office.deepEdit'])
      if (turn === 1) yield complete(request, 'inspect-draft', 'office.inspect', { path: filename })
      else if (turn === 2) {
        expect(JSON.stringify(request.messages)).toContain('Before word after')
        yield complete(request, 'edit-selection', 'office.edit', { path: filename, content: { format: 'docx', edits: [{
          type: 'replaceRange', start: { paragraph: 0, offset: 7 }, end: { paragraph: 0, offset: 11 },
          paragraphs: [{ runs: [{ text: 'edited' }] }],
        }] } })
      } else yield complete(request)
    } }
    const f = await fixture(provider)
    filename = path.join(path.dirname(f.workspace), 'external.docx')
    const original = await applyOfficeContent(undefined, { format: 'docx', operation: 'create', blocks: [{ type: 'paragraph', text: 'Original' }] })
    await fs.writeFile(filename, original.bytes)
    const office = new OfficeFileService(f.host)
    const opened = await office.bindWorking(filename, true)
    const human = await office.edit(opened, { format: 'docx', operation: 'edit', edits: [{ type: 'paragraph', index: 0, text: 'Before word after' }] }, { actor: 'human' })
    let resolveApproval!: (value: { runId: string; callId: string }) => void
    const approval = new Promise<{ runId: string; callId: string }>(resolve => { resolveApproval = resolve })
    f.engine.subscribe(event => { if (event.type === 'tool' && event.data.status === 'approval') resolveApproval({ runId: event.runId, callId: event.itemId }) })
    const started = await f.engine.start({ conversationId: 'conversation', taskId: 'office-selection-edit', instruction: '把所选文字改成 edited。',
      documents: [], workspaceRoot: f.workspace, permission: 'ask', selection, fileContext: { openFiles: [], references: [],
        officeCard: { ...human.binding, restrictToSelection: true, selection: { format: 'docx', start: { paragraph: 0, offset: 7 }, end: { paragraph: 0, offset: 11 } } },
      } })
    const pending = await Promise.race([approval, f.engine.wait(started.runId).then(final => { throw new Error(JSON.stringify(final.failure ?? final.tools)) })])
    const diskText = async () => inspectOfficeContent(await fs.readFile(filename), 'docx')
    expect(await diskText()).toMatchObject({ paragraphs: [{ text: 'Original' }] })
    await f.engine.decide({ ...pending, decision: 'allow' })
    const final = await f.engine.wait(started.runId)
    expect(final.tools[1]?.result).toMatchObject({ kind: 'read', data: { status: 'draft', applied: true, saved: false } })
    const latest = await office.bindWorking(filename)
    expect((await office.inspect(latest, 'docx')).inspection).toMatchObject({ paragraphs: [{ text: 'Before edited after' }] })
    expect(await diskText()).toMatchObject({ paragraphs: [{ text: 'Original' }] })
    await office.saveWorking(latest)
    expect(await diskText()).toMatchObject({ paragraphs: [{ text: 'Before edited after' }] })
  }, 20_000)

  it('applies related changes outside the starting cell directly and groups the structured and deep edits', async () => {
    let turn = 0, filename = ''
    const provider: ModelProvider = { async *stream(request) {
      turn++
      if (turn === 1) yield complete(request, 'inspect', 'office.inspect', { path: filename })
      else if (turn === 2) yield complete(request, 'update-related-cell', 'office.edit', { path: filename,
        content: { format: 'xlsx', edits: [{ sheet: 'Budget', cell: 'B1', value: 12 }] } })
      else if (turn === 3) yield complete(request, 'inspect-native-cell', 'office.inspect', { path: filename,
        object: { format: 'xlsx', target: { sheet: 'Budget', cell: 'B1' } } })
      else if (turn === 4) yield complete(request, 'format-related-cell', 'office.deepEdit', { path: filename,
        content: { format: 'xlsx', target: { sheet: 'Budget', cell: 'B1' }, style: { numberFormat: '0.00' } } })
      else yield complete(request)
    } }
    const f = await fixture(provider)
    filename = path.join(f.lesson, 'budget.xlsx')
    const original = await applyOfficeContent(undefined, { format: 'xlsx', operation: 'create', sheets: [{ name: 'Budget', rows: [['Total', 10, 'Keep']] }] })
    await fs.writeFile(filename, original.bytes)
    const office = new OfficeFileService(f.host)
    const opened = await office.bindWorking(filename, true)
    const approvals: string[] = []
    f.engine.subscribe(event => { if (event.type === 'tool' && event.data.status === 'approval') {
      approvals.push(event.itemId)
      void f.engine.decide({ runId: event.runId, callId: event.itemId, decision: 'deny' })
    } })
    const started = await f.engine.start({ conversationId: 'conversation', taskId: 'office-contextual-edit',
      instruction: '以 A1 为起点，把旁边的金额改为 12，显示两位小数。', documents: [], workspaceRoot: f.workspace, permission: 'workspace',
      selection, fileContext: { openFiles: [], references: [], officeCard: { ...opened, selection: { format: 'xlsx', sheet: 'Budget', range: 'A1' } } } })
    const final = await f.engine.wait(started.runId)
    expect(approvals).toEqual([])
    expect(final.tools.slice(1).map(tool => tool.result)).toMatchObject([
      { kind: 'read', data: { status: 'draft', applied: true, saved: false } },
      { kind: 'read', data: { object: { format: 'xlsx', target: { sheet: 'Budget', cell: 'B1' } } } },
      { kind: 'read', data: { status: 'draft', applied: true, saved: false } },
    ])
    const draft = await office.bindWorking(filename)
    const inspection = (await office.inspect(draft, 'xlsx')).inspection
    expect(inspection).toMatchObject({ sheets: [{ cells: expect.arrayContaining([
      expect.objectContaining({ cell: 'B1', value: 12, display: '12.00' }), expect.objectContaining({ cell: 'C1', value: 'Keep' }),
    ]) }] })
    expect(await office.history(draft)).toMatchObject({ undoDepth: 1 })
    expect(inspectOfficeContent(await fs.readFile(filename), 'xlsx')).toMatchObject({ sheets: [{ cells: expect.arrayContaining([{ cell: 'B1', value: 10 }]) }] })
    await office.saveWorking(draft)
    const reopened = new OfficeFileService(new DocumentHostService(path.join(path.dirname(f.workspace), 'owner')))
    const current = await reopened.bindWorking(filename, true)
    expect((await reopened.inspect(current, 'xlsx')).inspection).toMatchObject({ sheets: [{ cells: expect.arrayContaining([
      expect.objectContaining({ cell: 'B1', value: 12, display: '12.00' }),
    ]) }] })
    const undone = await reopened.moveHistory(current, 'undo')
    expect(undone.inspection).toMatchObject({ sheets: [{ cells: expect.arrayContaining([{ cell: 'B1', value: 10 }]) }] })
  }, 20_000)

  it('reports an unknown Office commit after a reopen failure and ends without replaying it', async () => {
    let turn = 0
    const provider: ModelProvider = { async *stream(request) {
      turn++
      if (turn === 1) yield complete(request, 'load-office', 'tools.load', { families: ['office'] })
      else if (turn === 2) yield complete(request, 'create-word', 'office.create', { path: 'lesson', name: 'lesson.docx', content: {
        format: 'docx', blocks: [{ type: 'paragraph', text: 'Before saved edit' }],
      } })
      else if (turn === 3) yield complete(request, 'edit-word', 'office.edit', { path: 'lesson/lesson.docx', content: {
        format: 'docx', edits: [{ type: 'replaceText', oldText: 'Before saved edit', text: 'Committed new content' }],
      } })
      else if (turn === 4) {
        expect(JSON.stringify(request.messages)).toContain('tool-outcome-unknown')
        const response = complete(request)
        response.assistant.content = '文件修改结果尚未得到正式回执确认，未重复写入。'
        yield response
      } else throw new Error('The fixture has already explained the unknown Office commit')
    } }
    const f = await fixture(provider)
    let committed = false
    const replace = f.host.artifacts.replace.bind(f.host.artifacts)
    const write = vi.spyOn(f.host.artifacts, 'replace').mockImplementation(async (...args) => {
      const saved = await replace(...args)
      committed = true
      return saved
    })
    const read = f.host.artifacts.read.bind(f.host.artifacts)
    vi.spyOn(f.host.artifacts, 'read').mockImplementation((...args) => {
      if (committed) return Promise.reject(new Error('Injected saved-file reopening failure'))
      return read(...args)
    })
    const started = await f.engine.start({ conversationId: 'conversation', taskId: 'office-lost-reopen', instruction: '新建 Word 文档并修改其正文。',
      documents: [], workspaceRoot: f.workspace, conversationHome: { kind: 'folder', path: 'lesson' }, permission: 'workspace', selection })
    const final = await f.engine.wait(started.runId)
    expect.soft(final.status, JSON.stringify({ failure: final.failure, tools: final.tools.map(tool => tool.result) })).toBe('partial')
    expect(final.tools[1].result).toMatchObject({ kind: 'read', data: { status: 'saved', saved: true } })
    expect(final.tools[2].result, JSON.stringify(final.tools[2].result)).toMatchObject({ kind: 'error', code: 'tool-outcome-unknown' })
    expect(final.tools[2].effectPaths).toEqual([path.join(f.lesson, 'lesson.docx')])
    expect(write).toHaveBeenCalledTimes(1)
    expect(turn).toBe(4)
    expect(final.failure).toBeUndefined()
    expect(final.requests.at(-1)).toMatchObject({ state: 'completed', finishReason: 'stop' })
    expect(inspectOfficeContent(await fs.readFile(path.join(f.lesson, 'lesson.docx')), 'docx')).toMatchObject({ paragraphs: [{ text: 'Committed new content' }] })
    expect(await fs.readdir(f.lesson)).toEqual(['lesson.docx'])
    expect(f.host.registry.list()).toHaveLength(0)
  })

  it('blocks a new Office edit call after an unknown commit even when a fresh inspect succeeds', async () => {
    let turn = 0
    const provider: ModelProvider = { async *stream(request) {
      turn++
      if (turn === 1) yield complete(request, 'load-office', 'tools.load', { families: ['office'] })
      else if (turn === 2) yield complete(request, 'create-word', 'office.create', { path: 'lesson', name: 'lesson.docx', content: {
        format: 'docx', blocks: [{ type: 'paragraph', text: 'Before saved edit' }],
      } })
      else if (turn === 3) yield complete(request, 'original-edit', 'office.edit', { path: 'lesson/lesson.docx', content: {
        format: 'docx', edits: [{ type: 'paragraph', index: 0, text: 'Committed once' }],
      } })
      else if (turn === 4) {
        expect(JSON.stringify(request.messages)).toContain('tool-outcome-unknown')
        yield complete(request, 'inspect-committed-version', 'office.inspect', { path: 'lesson/lesson.docx' })
      } else if (turn === 5) {
        expect(JSON.stringify(request.messages)).toContain('Committed once')
        // This is a valid edit against the freshly observed file: neither an old
        // binding nor a missing replaceText match can mask a failed replay guard.
        yield complete(request, 'new-number-same-target', 'office.edit', { path: 'lesson/lesson.docx', content: {
          format: 'docx', edits: [{ type: 'paragraph', index: 0, text: 'Must never be committed' }],
        } })
      } else if (turn === 6) {
        expect(JSON.stringify(request.messages)).toContain('unresolved-prior-tool')
        const response = complete(request)
        response.assistant.content = '已核对当前内容；原写入回执仍未确认，未重放写入。'
        yield response
      } else throw new Error('Unexpected continuation after the blocked Office replay')
    } }
    const f = await fixture(provider)
    let failNextRead = false
    const replace = f.host.artifacts.replace.bind(f.host.artifacts)
    const write = vi.spyOn(f.host.artifacts, 'replace').mockImplementation(async (...args) => {
      const saved = await replace(...args); failNextRead = true; return saved
    })
    const read = f.host.artifacts.read.bind(f.host.artifacts)
    vi.spyOn(f.host.artifacts, 'read').mockImplementation((...args) => {
      if (failNextRead) { failNextRead = false; return Promise.reject(new Error('Injected one saved-file readback failure')) }
      return read(...args)
    })
    const execute = vi.spyOn(f.host.agentFiles, 'executeOffice')
    const started = await f.engine.start({ conversationId: 'conversation', taskId: 'office-no-replay', instruction: '新建并修改 Word；结果未知时核对内容，但不要重放。',
      documents: [], workspaceRoot: f.workspace, conversationHome: { kind: 'folder', path: 'lesson' }, permission: 'workspace', selection })
    const final = await f.engine.wait(started.runId)
    expect(final.status, JSON.stringify({ failure: final.failure, tools: final.tools.map(tool => tool.result) })).toBe('partial')
    expect(final.failure).toBeUndefined()
    expect(final.requests.at(-1)).toMatchObject({ state: 'completed', finishReason: 'stop' })
    expect(final.tools[2].result).toMatchObject({ kind: 'error', code: 'tool-outcome-unknown' })
    expect(final.tools[3].result).toMatchObject({ kind: 'read', data: { inspection: { paragraphs: [{ text: 'Committed once' }] } } })
    expect(final.tools[4].result).toMatchObject({ kind: 'error', code: 'unresolved-prior-tool' })
    expect(execute.mock.calls.filter(([, name]) => name === 'office.edit')).toHaveLength(1)
    expect(write).toHaveBeenCalledTimes(1)
    expect(inspectOfficeContent(await fs.readFile(path.join(f.lesson, 'lesson.docx')), 'docx')).toMatchObject({ paragraphs: [{ text: 'Committed once' }] })
    expect(await fs.readdir(f.lesson)).toEqual(['lesson.docx'])
  })

  it('discovers configured Office on demand, then creates and edits a saved DOCX using software-owned binding', async () => {
    let turn = 0
    const provider: ModelProvider = { async *stream(request) {
      turn++
      const names = request.tools?.map(tool => tool.name) ?? []
      if (turn === 1) {
        expect(names).toContain('tools.load')
        expect(names.filter(name => name.startsWith('office.'))).toEqual([])
        expect(JSON.stringify(request.tools?.find(tool => tool.name === 'tools.load')?.inputSchema)).toContain('office')
        yield complete(request, 'load-office', 'tools.load', { families: ['office'] })
      } else if (turn === 2) {
        expect(names).toEqual(expect.arrayContaining(['office.inspect', 'office.create', 'office.edit']))
        yield complete(request, 'create-word', 'office.create', { path: 'lesson', name: 'lesson.docx', content: { format: 'docx', blocks: [
          { type: 'paragraph', heading: 'title', text: '实验讨论' },
          { type: 'paragraph', text: '先预测结果，再操作观察。' },
          { type: 'paragraph', text: '观察后解释结论。' },
        ] } })
      } else if (turn === 3) {
        // The model supplies meaningful content, not OOXML, bindings, revisions or paragraph bookkeeping.
        yield complete(request, 'edit-word', 'office.edit', { path: 'lesson/lesson.docx', content: { format: 'docx', edits: [
          { type: 'replaceText', oldText: '预测结果', text: '预测并说明理由' },
        ] } })
      } else yield complete(request)
    } }
    const f = await fixture(provider)
    const started = await f.engine.start({ conversationId: 'conversation', taskId: 'office-content', instruction: '新建实验讨论 Word 文档，再完善预测问题。',
      documents: [], workspaceRoot: f.workspace, conversationHome: { kind: 'folder', path: 'lesson' }, permission: 'workspace', selection })
    const final = await f.engine.wait(started.runId)
    expect(final.status, JSON.stringify({ failure: final.failure, tools: final.tools.map(tool => tool.result) })).toBe('completed')
    expect(final.tools.map(tool => tool.call.name)).toEqual(['tools.load', 'office.create', 'office.edit'])
    expect(final.tools[0].result).toMatchObject({ kind: 'read', data: { loaded: ['office'] } })
    for (const tool of final.tools.slice(1)) expect(tool.result).toMatchObject({ kind: 'read', data: { status: 'saved', saved: true } })
    const reopened = inspectOfficeContent(await fs.readFile(path.join(f.lesson, 'lesson.docx')), 'docx')
    expect(reopened).toMatchObject({ paragraphs: [{ text: '实验讨论' }, { text: '先预测并说明理由，再操作观察。' }, { text: '观察后解释结论。' }] })
    expect(f.host.registry.list()).toHaveLength(0)
    expect(await fs.readdir(f.lesson)).toEqual(['lesson.docx'])
    expect(turn).toBe(4)
  })

  it('advertises only inspection for a read-only task and reads the real DOCX without a text session', async () => {
    let turn = 0
    const provider: ModelProvider = { async *stream(request) {
      turn++
      const names = request.tools?.map(tool => tool.name) ?? []
      if (turn === 1) {
        expect(names.filter(name => name.startsWith('office.'))).toEqual([])
        yield complete(request, 'load-readonly-office', 'tools.load', { families: ['office'] })
      } else if (turn === 2) {
        expect(names.filter(name => name.startsWith('office.'))).toEqual(['office.inspect'])
        yield complete(request, 'inspect-word', 'office.inspect', { path: 'lesson/existing.docx' })
      } else yield complete(request)
    } }
    const f = await fixture(provider)
    const content = await applyOfficeContent(undefined, { format: 'docx', operation: 'create', blocks: [{ type: 'paragraph', text: '真实只读内容' }] })
    const filename = path.join(f.lesson, 'existing.docx'); await fs.writeFile(filename, content.bytes)
    const started = await f.engine.start({ conversationId: 'conversation', taskId: 'office-readonly', instruction: '阅读现有 Word 文件。',
      documents: [], workspaceRoot: f.workspace, permission: 'read-only', selection })
    const final = await f.engine.wait(started.runId)
    expect(final.status, JSON.stringify({ failure: final.failure, tools: final.tools.map(tool => tool.result) })).toBe('completed')
    expect(final.tools[0].result).toMatchObject({ kind: 'read', data: { loaded: ['office'], available: expect.arrayContaining([{ family: 'office', description: expect.any(String), count: 1 }]) } })
    expect(final.tools[1].result).toMatchObject({ kind: 'read', data: { writable: false, inspection: { format: 'docx', paragraphs: [{ text: '真实只读内容' }] } } })
    expect(inspectOfficeContent(await fs.readFile(filename), 'docx')).toMatchObject({ paragraphs: [{ text: '真实只读内容' }] })
    expect(f.host.registry.list()).toHaveLength(0)
    expect(await fs.readdir(f.lesson)).toEqual(['existing.docx'])
  })
})
