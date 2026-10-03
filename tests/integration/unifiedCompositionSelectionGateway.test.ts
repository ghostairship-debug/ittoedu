// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { locateCourseLayer } from '../../src/core/drivers/course/layerProperties'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { mutationCallSchema } from '../../src/core/tools/ToolCatalog'
import { findCompositionNode } from '../../src/shared/composition/content'
import type { CompositionLayerItem } from '../../src/shared/courseProjectTypes'
import type { DocumentModel, DocumentPersistence, DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ToolResult, ToolTarget } from '../../src/shared/workbench/tools'
import { compositionFragmentFixture, fragmentPrompt } from '../helpers/compositionFragmentFixture'

type ContentTarget = { target: string; kind: 'text' | 'style' | 'image'; text?: string; style?: string }
type SelectedRead = { itemId: string; compositionNodeId: string; node: CompositionLayerItem['content']['root']; locked: boolean }
const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(os.tmpdir(), root)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe fixture directory')
    await fs.rm(root, { recursive: true, force: true })
  }
})

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

function operation(snapshot: DocumentSnapshot, mutation: Parameters<ReturnType<DocumentRegistry['get']>['execute']>[0]['mutation']) {
  return { documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: randomUUID(), actor: 'human' as const,
    baseRevision: snapshot.revision, mutation }
}

async function harness(runId: string) {
  const source = compositionFragmentFixture()
  const model: Extract<DocumentModel, { kind: 'course-v9' }> = {
    kind: 'course-v9', project: source.project, resources: { assets: source.assetFiles, components: {} },
  }
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
  const session = await registry.create(model, 'selection.h5lesson')
  const target: ToolTarget = { kind: 'course-object', locationId: source.project.locations[0]!.id,
    itemId: source.item.layerItemId, compositionNodeId: 'left' }
  await gateway.beginRun({ runId, actor: 'agent', documents: [{ documentId: session.documentId, writable: [target] }] })
  const selected = await gateway.issueTarget(runId, session.documentId, target)
  return { driver, registry, gateway, session, target, selected }
}

async function read(gateway: DocumentToolGateway, runId: string, target: string): Promise<SelectedRead> {
  const result = await gateway.execute(runId, randomUUID(), { name: 'read', input: { target, limit: 640 } })
  expect(result).toMatchObject({ kind: 'read', data: { truncated: false } })
  if (result.kind !== 'read') throw new Error('Selection read failed')
  return JSON.parse((result.data as { text: string }).text) as SelectedRead
}

async function discover(gateway: DocumentToolGateway, runId: string, target: string): Promise<ContentTarget[]> {
  const result = await gateway.execute(runId, randomUUID(), { name: 'content.targets', input: { target } })
  expect(result).toMatchObject({ kind: 'read' })
  if (result.kind !== 'read') throw new Error('Content discovery failed')
  return (result.data as { targets: ContentTarget[] }).targets
}

function textTarget(targets: ContentTarget[]): ContentTarget {
  const found = targets.find(target => target.kind === 'text' && target.text === fragmentPrompt)
  if (!found) throw new Error('Selected paragraph target missing')
  return found
}

function affected(result: ToolResult): string {
  if (result.kind !== 'document-operation' || !result.affected[0]) throw new Error('Fresh selected handle required')
  return result.affected[0]
}

it('reads and discovers only the selected composition subtree and refuses whole-layer mutations without history', async () => {
  const runId = 'selection-range', { gateway, session, target, selected } = await harness(runId)
  const before = session.read()
  const content = await read(gateway, runId, selected)
  expect(content).toMatchObject({ itemId: 'quality-composition', compositionNodeId: 'left', locked: false })
  expect(content.node).toEqual(findCompositionNode(composition(before.model).content.root, 'left'))
  expect(Object.keys(content).sort()).toEqual(['compositionNodeId', 'itemId', 'location', 'locked', 'node', 'owner'])
  for (const id of ['html', 'heading-text', 'right', 'chart', 'css']) expect(findCompositionNode(content.node, id)).toBeUndefined()
  const fields = await discover(gateway, runId, selected)
  expect(fields.filter(field => field.kind === 'text').map(field => field.text)).toEqual([fragmentPrompt])
  expect(fields.filter(field => field.kind === 'image')).toHaveLength(1)
  const children = await gateway.execute(runId, randomUUID(), { name: 'listChildren', input: { target: selected } })
  expect(children).toMatchObject({ kind: 'read' })
  if (children.kind !== 'read') throw new Error('Selected children missing')
  const childHandles = children.data as { target: string; kind: string }[]
  expect(childHandles.map(child => child.kind)).toEqual(['course-object', 'course-object', 'course-object'])
  const readChildren = []
  for (const child of childHandles) {
    readChildren.push(await read(gateway, runId, child.target))
    expect(await gateway.execute(runId, randomUUID(), { name: 'inspect', input: { target: child.target } }))
      .toMatchObject({ kind: 'read', data: { writable: true } })
  }
  expect(readChildren.map(child => child.compositionNodeId)).toEqual(['paragraph', 'picture', 'interaction'])
  expect(readChildren.map(child => child.node.id)).toEqual(['paragraph', 'picture', 'interaction'])
  const inspection = await gateway.execute(runId, randomUUID(), { name: 'inspect', input: { target: selected } })
  expect(inspection).toMatchObject({ kind: 'read', data: { writable: true } })
  if (inspection.kind !== 'read') throw new Error('Selection inspection failed')
  const advertised = (inspection.data as { tools: string[] }).tools
  for (const name of ['object.update', 'layer.delete', 'selection.replace']) expect(advertised).not.toContain(name)
  for (const mutation of [
    { name: 'object.update', input: { target: selected, properties: { opacity: 0.4 } } },
    { name: 'layer.delete', input: { target: selected } },
    { name: 'selection.replace', input: { target: selected, replacement: childHandles[0]!.target } },
  ]) {
    expect(mutationCallSchema.safeParse(mutation).success).toBe(true)
    expect(await gateway.execute(runId, randomUUID(), mutation)).toMatchObject({ kind: 'error' })
    expect(session.read()).toEqual(before)
  }
  if (target.kind !== 'course-object') throw new Error('Object target required')
  for (const hostTarget of [
    { kind: 'course-object' as const, locationId: target.locationId, itemId: target.itemId },
    { ...target, compositionNodeId: 'right' },
  ]) {
    const escaped = await gateway.issueTarget(runId, session.documentId, hostTarget)
    expect(await gateway.execute(runId, randomUUID(), { name: 'inspect', input: { target: escaped } }))
      .toMatchObject({ kind: 'read', data: { writable: false } })
    expect(await gateway.execute(runId, randomUUID(), { name: 'object.update', input: { target: escaped, properties: { opacity: 0.4 } } }))
      .toMatchObject({ kind: 'error' })
    expect(session.read()).toEqual(before)
  }
})

it('keeps a selected field writable after unrelated sibling edits and saves and reopens the local result', async () => {
  const runId = 'selection-save', { driver, registry, gateway, session, selected } = await harness(runId)
  const before = session.read(), field = textTarget(await discover(gateway, runId, selected))
  expect(await session.execute(operation(before, { type: 'command', command: {
    type: 'composition.edit', layerItemId: 'quality-composition', edit: { type: 'style', nodeId: 'right', patch: { padding: '29px' } },
  } }))).toMatchObject({ status: 'applied' })
  const manual = session.read()
  const newText = '比较观察前后的变化，用证据支持自己的解释。'
  const written = await gateway.execute(runId, randomUUID(), { name: 'content.update', input: { target: field.target, text: newText } })
  expect(written).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const after = session.read()
  expect(paragraph(after.model)).toBe(newText)
  expect(after.undoDepth).toBe(manual.undoDepth + 1)
  expect(after.undoHead?.actor).toBe('agent')
  const refreshed = await read(gateway, runId, affected(written))
  expect(refreshed.compositionNodeId).toBe('left')
  expect(refreshed.node.id).toBe('left')
  expect((await discover(gateway, runId, affected(written))).filter(field => field.kind === 'text').map(field => field.text)).toEqual([newText])
  expect(await gateway.execute(runId, randomUUID(), { name: 'text.replace', input: { target: affected(written), content: newText } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'unchanged' } })
  expect(session.read().undoDepth).toBe(after.undoDepth)
  for (const nodeId of ['right', 'heading', 'css', 'counter', 'picture'])
    expect(findCompositionNode(composition(after.model).content.root, nodeId)).toEqual(findCompositionNode(composition(manual.model).content.root, nodeId))
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'composition-selection-'))
  roots.push(root)
  const filename = path.join(root, 'selection.h5lesson')
  await registry.save(session.documentId, { kind: 'file', path: filename, version: null, bindingVersion: 0 })
  const reopened = driver.load(new Uint8Array(await fs.readFile(filename)))
  expect(paragraph(reopened)).toBe(newText)
  expect(findCompositionNode(composition(reopened).content.root, 'right')).toEqual(findCompositionNode(composition(manual.model).content.root, 'right'))
  expect(reopened.resources).toEqual(manual.model.resources)
  expect(session.read().dirty).toBe(false)
})

it('refuses stale selected content, fields moved out of scope, locked layers and removed selection identities', async () => {
  for (const change of ['content', 'move', 'lock', 'remove'] as const) {
    const runId = `selection-${change}`, { gateway, session, target, selected } = await harness(runId)
    const field = textTarget(await discover(gateway, runId, selected))
    if (target.kind !== 'course-object') throw new Error('Object target required')
    const command = change === 'lock'
      ? { type: 'course.object.patch' as const, locationId: target.locationId, itemId: target.itemId, patch: { locked: true } }
      : { type: 'composition.edit' as const, layerItemId: target.itemId, edit: change === 'content'
        ? { type: 'text' as const, nodeId: 'paragraph-text', text: '教师已经改写的正文' }
        : change === 'move' ? { type: 'move' as const, nodeId: 'paragraph-text', parentId: 'right', index: 1 }
          : { type: 'remove' as const, nodeId: 'left' } }
    expect(await session.execute(operation(session.read(), { type: 'command', command }))).toMatchObject({ status: 'applied' })
    const changed = session.read()
    expect(await gateway.execute(runId, randomUUID(), { name: 'content.update', input: { target: field.target, text: '错误覆盖选区外或新正文' } }))
      .toMatchObject({ kind: 'error' })
    expect(session.read()).toEqual(changed)
    expect(session.read().undoHead?.actor).toBe('human')
  }
})
