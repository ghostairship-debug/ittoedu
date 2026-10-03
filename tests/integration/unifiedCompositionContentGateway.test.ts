// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { locateCourseLayer } from '../../src/core/drivers/course/layerProperties'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { findCompositionNode } from '../../src/shared/composition/content'
import type { CompositionLayerItem } from '../../src/shared/courseProjectTypes'
import type { DocumentModel, DocumentPersistence, DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ToolResult, ToolTarget } from '../../src/shared/workbench/tools'
import { compositionFragmentFixture, fragmentPrompt } from '../helpers/compositionFragmentFixture'

type CourseModel = Extract<DocumentModel, { kind: 'course-v9' }>
type ContentTarget = { target: string; kind: 'text' | 'style'; label: string; text?: string; style?: string }
const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    const relative = path.relative(os.tmpdir(), root)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe fixture directory')
    await fs.rm(root, { recursive: true, force: true })
  }
})

function fixture(): { model: CourseModel; target: ToolTarget } {
  const source = compositionFragmentFixture()
  return {
    model: { kind: 'course-v9', project: source.project, resources: { assets: source.assetFiles, components: {} } },
    target: { kind: 'course-object', locationId: source.project.locations[0]!.id, itemId: source.item.layerItemId },
  }
}

function composition(model: DocumentModel): CompositionLayerItem {
  if (model.kind !== 'course-v9') throw new Error('Course model required')
  const item = locateCourseLayer(model.project, 'quality-composition')?.item
  if (item?.kind !== 'composition') throw new Error('Composition required')
  return item
}

function paragraph(model: DocumentModel): string {
  const node = findCompositionNode(composition(model).content.root, 'paragraph-text')
  if (node?.kind !== 'text') throw new Error('Paragraph required')
  return node.text
}

function leftStyle(model: DocumentModel): string {
  const node = findCompositionNode(composition(model).content.root, 'left')
  if (node?.kind !== 'element') throw new Error('Left card required')
  return node.attributes.style ?? ''
}

function harness() {
  const driver = new CourseV9Driver()
  const persistence: DocumentPersistence = {
    async append() {},
    async save(input) {
      if (input.binding.kind !== 'file') throw new Error('File binding required')
      await fs.writeFile(input.binding.path, input.bytes)
      return { ...input.binding, version: `revision-${input.revision}` }
    },
  }
  const registry = new DocumentRegistry({ drivers: [driver], persistence, createId: randomUUID, bindingKey: binding => binding.path })
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  return { driver, registry, gateway }
}

async function discover(gateway: DocumentToolGateway, runId: string, target: string): Promise<ContentTarget[]> {
  const result = await gateway.execute(runId, randomUUID(), { name: 'content.targets', input: { target } })
  expect(result).toMatchObject({ kind: 'read' })
  if (result.kind !== 'read') throw new Error('Content discovery failed')
  return (result.data as { targets: ContentTarget[] }).targets
}

function textTarget(targets: ContentTarget[], text: string): ContentTarget {
  const found = targets.find(target => target.kind === 'text' && target.text === text)
  if (!found) throw new Error('Expected text target missing')
  return found
}

function affected(result: ToolResult): string {
  if (result.kind !== 'document-operation' || !result.affected[0]) throw new Error('Fresh object handle required')
  return result.affected[0]
}

function operation(snapshot: DocumentSnapshot, mutation: Parameters<ReturnType<DocumentRegistry['get']>['execute']>[0]['mutation']) {
  return { documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: randomUUID(), actor: 'human' as const,
    baseRevision: snapshot.revision, mutation }
}

it('edits discovered composition styles and text through canonical history, retains manual CSS, and saves and reopens real bytes', async () => {
  const { driver, registry, gateway } = harness(), source = fixture()
  const session = await registry.create(source.model, 'composition.h5lesson')
  expect(await session.execute(operation(session.read(), { type: 'command', command: {
    type: 'composition.edit', layerItemId: 'quality-composition', edit: { type: 'style', nodeId: 'left', patch: {
      padding: '27px', color: '#274e73', '--TeacherInk': 'navy', 'background-image': 'linear-gradient(90deg, red, blue)',
    } },
  } }))).toMatchObject({ status: 'applied' })
  const manual = session.read(), manualStyle = leftStyle(manual.model)
  const agentCommands: string[] = []
  session.subscribeCommits(commit => {
    if (commit.operation.actor === 'agent' && commit.operation.mutation.type === 'command') agentCommands.push(commit.operation.mutation.command.type)
  })
  await gateway.beginRun({ runId: 'author', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  const object = await gateway.issueTarget('author', session.documentId, source.target)
  const targets = await discover(gateway, 'author', object)
  expect(targets.filter(target => target.kind === 'text').map(target => target.text)).toEqual(['用观察解释变化', fragmentPrompt])
  for (const target of targets) {
    for (const key of ['nodeId', 'itemId', 'documentId', 'epoch', 'revision']) expect(target).not.toHaveProperty(key)
  }
  const card = targets.find(target => target.kind === 'style' && target.style === manualStyle)!
  expect(card).toBeDefined()
  const styled = await gateway.execute('author', 'style', { name: 'content.update', input: { target: card.target, style: { gap: '31px' } } })
  expect(styled).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(leftStyle(session.read().model)).toContain(manualStyle)
  expect(leftStyle(session.read().model)).toContain('gap: 31px;')

  const updatedText = '根据实际观察说明结论，并写出支持判断的证据。'
  const nextText = textTarget(await discover(gateway, 'author', affected(styled)), fragmentPrompt)
  const written = await gateway.execute('author', 'text', { name: 'content.update', input: { target: nextText.target, text: updatedText } })
  expect(written).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const after = session.read()
  expect(paragraph(after.model)).toBe(updatedText)
  expect(after.undoDepth).toBe(manual.undoDepth + 2)
  expect(agentCommands).toEqual(['composition.edit', 'composition.edit'])
  const sameText = textTarget(await discover(gateway, 'author', affected(written)), updatedText)
  expect(await gateway.execute('author', 'no-op', { name: 'text.replace', input: { target: sameText.target, content: updatedText } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'unchanged' } })
  expect(session.read().undoDepth).toBe(after.undoDepth)
  expect(session.read().revision).toBe(after.revision)
  expect(await session.execute(operation(session.read(), { type: 'undo' }))).toMatchObject({ status: 'applied' })
  expect(paragraph(session.read().model)).toBe(fragmentPrompt)
  expect(leftStyle(session.read().model)).toBe(leftStyle(after.model))
  expect(await session.execute(operation(session.read(), { type: 'redo' }))).toMatchObject({ status: 'applied' })
  expect(paragraph(session.read().model)).toBe(updatedText)

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'composition-gateway-'))
  roots.push(root)
  const filename = path.join(root, 'editable.h5lesson')
  await registry.save(session.documentId, { kind: 'file', path: filename, version: null, bindingVersion: 0 })
  const reopened = driver.load(new Uint8Array(await fs.readFile(filename)))
  expect(session.read().dirty).toBe(false)
  expect(paragraph(reopened)).toBe(updatedText)
  expect(leftStyle(reopened)).toBe(leftStyle(after.model))
  expect(composition(reopened).frame).toEqual(composition(manual.model).frame)
  for (const nodeId of ['css', 'counter', 'chart', 'picture', 'right']) {
    expect(findCompositionNode(composition(reopened).content.root, nodeId)).toEqual(findCompositionNode(composition(manual.model).content.root, nodeId))
  }
  expect(reopened.resources).toEqual(manual.model.resources)
  expect(composition(reopened).content.assets).toEqual(composition(manual.model).content.assets)
})

it('scopes identical node IDs to their document and run, and refuses read-only, stale, locked and stopped targets without extra AI history', async () => {
  const { registry, gateway } = harness(), sourceA = fixture(), sourceB = fixture()
  const a = await registry.create(sourceA.model, 'a.h5lesson'), b = await registry.create(sourceB.model, 'b.h5lesson')
  for (const [runId, session] of [['run-a', a], ['run-b', b]] as const) {
    await gateway.beginRun({ runId, actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  }
  const objectA = await gateway.issueTarget('run-a', a.documentId, sourceA.target)
  const objectB = await gateway.issueTarget('run-b', b.documentId, sourceB.target)
  const targetA = textTarget(await discover(gateway, 'run-a', objectA), fragmentPrompt)
  const targetB = textTarget(await discover(gateway, 'run-b', objectB), fragmentPrompt)
  const beforeA = a.read(), beforeB = b.read()
  expect(await gateway.execute('run-b', 'foreign', { name: 'content.update', input: { target: targetA.target, text: '跨任务错误修改' } }))
    .toMatchObject({ kind: 'error', code: 'invalid-target' })
  expect(a.read()).toEqual(beforeA)
  expect(b.read()).toEqual(beforeB)
  const applied = await gateway.execute('run-a', 'a-text', { name: 'content.update', input: { target: targetA.target, text: 'A 的独立正文' } })
  expect(applied).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(paragraph(a.read().model)).toBe('A 的独立正文')
  expect(b.read()).toEqual(beforeB)
  expect(await gateway.execute('run-a', 'old-a', { name: 'content.update', input: { target: targetA.target, text: '旧句柄错误续改' } }))
    .toMatchObject({ kind: 'error', code: 'target-conflict' })
  const readOnlyObject = await gateway.issueTarget('run-a', a.documentId, sourceA.target, { readOnly: true })
  const readOnlyText = textTarget(await discover(gateway, 'run-a', readOnlyObject), 'A 的独立正文')
  expect(await gateway.execute('run-a', 'read-only', { name: 'content.update', input: { target: readOnlyText.target, text: '只读错误修改' } }))
    .toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(a.read().undoDepth).toBe(1)
  const freshText = textTarget(await discover(gateway, 'run-a', affected(applied)), 'A 的独立正文')
  expect(await a.execute(operation(a.read(), { type: 'command', command: {
    type: 'course.object.patch', locationId: sourceA.model.project.locations[0]!.id,
    itemId: 'quality-composition', patch: { locked: true },
  } }))).toMatchObject({ status: 'applied' })
  const locked = a.read()
  expect(await gateway.execute('run-a', 'locked', { name: 'content.update', input: { target: freshText.target, text: '锁定错误修改' } }))
    .toMatchObject({ kind: 'error', code: 'target-conflict' })
  const lockedObject = await gateway.issueTarget('run-a', a.documentId, sourceA.target)
  expect(await discover(gateway, 'run-a', lockedObject)).toEqual([])
  expect(a.read()).toEqual(locked)
  await gateway.stop('run-a')
  expect(await gateway.execute('run-a', 'stopped', { name: 'content.update', input: { target: freshText.target, text: '停止后错误修改' } }))
    .toMatchObject({ kind: 'error', code: 'run-stopped' })
  expect(a.read().model).toEqual(locked.model)
  expect(a.read().undoDepth).toBe(locked.undoDepth)
  expect(await gateway.execute('run-b', 'b-text', { name: 'text.replace', input: { target: targetB.target, content: 'B 的独立正文' } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(paragraph(b.read().model)).toBe('B 的独立正文')
  expect(b.read().undoDepth).toBe(1)
  expect(a.read().model).toEqual(locked.model)
})

it('enforces the final Session CAS when a human changes content after AI planning and before canonical submission', async () => {
  const { registry, gateway } = harness(), source = fixture()
  const left = findCompositionNode(composition(source.model).content.root, 'left')
  if (left?.kind !== 'element') throw new Error('Left card required')
  left.attributes.style = 'padding:27px;--TeacherInk:navy;color:#274e73;'
  const session = await registry.create(source.model, 'cas.h5lesson')
  await gateway.beginRun({ runId: 'cas', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  const object = await gateway.issueTarget('cas', session.documentId, source.target)
  const target = textTarget(await discover(gateway, 'cas', object), fragmentPrompt)
  const before = session.read(), execute = session.execute.bind(session)
  const spy = vi.spyOn(session, 'execute').mockImplementationOnce(async request => {
    expect(request).toMatchObject({ actor: 'agent', baseRevision: before.revision,
      mutation: { type: 'command', command: { type: 'composition.edit' } } })
    expect(await execute(operation(before, { type: 'command', command: {
      type: 'composition.edit', layerItemId: 'quality-composition', edit: { type: 'text', nodeId: 'paragraph-text', text: '教师刚刚修改的正文' },
    } }))).toMatchObject({ status: 'applied' })
    return execute(request)
  })
  const result = await gateway.execute('cas', 'racing-text', { name: 'content.update', input: { target: target.target, text: '过期的 AI 正文' } })
  expect(result).toMatchObject({ kind: 'document-operation', result: { status: 'conflict', code: 'stale-revision' } })
  expect(spy).toHaveBeenCalledTimes(1)
  expect(paragraph(session.read().model)).toBe('教师刚刚修改的正文')
  expect(leftStyle(session.read().model)).toBe(leftStyle(before.model))
  expect(session.read().undoDepth).toBe(before.undoDepth + 1)
  expect(session.read().revision).toBe(before.revision + 1)
  expect(session.read().undoHead?.actor).toBe('human')
})
