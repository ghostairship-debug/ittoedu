import { testContainerInstance } from '../helpers/glxWorkFixture'
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { jsonValueSchema } from '../../src/shared/contracts/component-platform'
import { createTextComponentData } from '../../src/components/text/data'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { readTarget, targetFootprint } from '../../src/core/tools/ToolTargets'
import type { ToolResult } from '../../src/shared/workbench/tools'
import type { HostToolServices } from '../../src/core/tools/HostToolServices'

async function fixture(services?: HostToolServices) {
  const project = createBlankCourseProjectV10('Semantic read')
  project.definitions.text = { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } }
  project.definitions.business = { id: 'business', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default { mount() {} };' } }
  const data = createTextComponentData({ inlines: [{ type: 'text', text: '第一段', style: { bold: true } }, { type: 'text', text: ' 第二段' }] })
  const source = 'export default { mount() {} };\n// Explicit Source content only'
  project.instances.text = { id: 'text', definitionId: 'text', data: jsonValueSchema.parse(data),
    frame: { width: 320, height: 180, transform: [1, 0, 0, 1, 40, 60] },
    implementationOverride: { kind: 'source', language: 'javascript', source } }
  project.instances.business = { id: 'business', definitionId: 'business', data: { marker: '实际业务数据', values: [1, 2] },
    implementationOverride: { kind: 'source', language: 'javascript', source } }
  testContainerInstance(project, 0).childIds = ['text', 'business']
  testContainerInstance(project, 0).container.presentation = { states: [{ id: 'second', title: '第二幕', overrides: { business: { data: { hiddenDetail: source } } } }] }
  const resources = { assets: {}, components: {} }, driver = new CourseV10Driver()
  const registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('No save requested') } } })
  const session = await registry.create({ kind: 'course-v10', project, resources }, 'semantic.glx')
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID, { ...(services ? { services } : {}), componentContent: {
    async source() { throw new Error('No external Source read requested') },
    async apply() { throw new Error('No content apply requested') },
  } })
  await gateway.beginRun({ runId: 'semantic', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  const target = await gateway.issueTarget('semantic', session.documentId, { kind: 'course-instance', surfaceId: componentSurfaces(project)[0].id, instanceId: 'text' })
  const call = (name: string, input: unknown) => gateway.execute('semantic', randomUUID(), { name, input })
  return { project, resources, session, gateway, target, call, source }
}

function readData(result: ToolResult) {
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read' })
  if (result.kind !== 'read') throw new Error('Expected read')
  return result.data as { target: string; text: string; authoring?: unknown }
}

it('reads exact body once by default, preserving explicit full objects and Source reads', async () => {
  const h = await fixture(), before = h.session.read()
  try {
    const ordinary = readData(await h.call('read', { target: h.target }))
    expect(ordinary.text).toBe('第一段 第二段')
    expect(ordinary.authoring).toBeUndefined()
    expect(JSON.stringify(ordinary)).not.toContain('appearance')
    const full = JSON.parse(readData(await h.call('read', { target: h.target, detail: 'object' })).text)
    expect(full).toEqual(h.project.instances.text)
    expect(full.implementationOverride.source).toBe(h.source)
    const file = componentProjectFiles(h.project, h.resources).find(file => file.binding?.kind === 'instance-source' && file.binding.instanceId === 'text' && !file.authorSource?.dependencyId)!
    expect(await h.call('project.read', { path: file.path })).toMatchObject({ kind: 'read', data: { content: file.content } })
    const address = { kind: 'course-instance' as const, surfaceId: componentSurfaces(h.project)[0].id, instanceId: 'text' }
    expect(readTarget(before.model, address)).toEqual(h.project.instances.text)
    expect(targetFootprint(h.session.read().model, address)).toBe(targetFootprint(before.model, address))
    expect(h.session.read()).toEqual(before)
  } finally { await h.gateway.stop('semantic') }
})

it('keeps real non-text data and surface structure without attaching project directories or state Source', async () => {
  const h = await fixture()
  try {
    const business = await h.gateway.issueTarget('semantic', h.session.documentId, { kind: 'course-instance', surfaceId: componentSurfaces(h.project)[0].id, instanceId: 'business' })
    expect(JSON.parse(readData(await h.call('read', { target: business })).text)).toEqual({ id: 'business', definitionId: 'business', data: h.project.instances.business.data })
    const surface = await h.gateway.issueTarget('semantic', h.session.documentId, { kind: 'course-surface', surfaceId: componentSurfaces(h.project)[0].id })
    const result = readData(await h.call('read', { target: surface }))
    expect(result.authoring).toBeUndefined()
    expect(JSON.parse(result.text)).toMatchObject({ childIds: ['text', 'business'], presentation: { states: [{ id: 'second', title: '第二幕' }] } })
    expect(result.text).not.toContain('Explicit Source')
    const document = await h.gateway.issueTarget('semantic', h.session.documentId, { kind: 'document' })
    expect(readData(await h.call('read', { target: document })).authoring).toBeUndefined()
  } finally { await h.gateway.stop('semantic') }
})

it('continues a semantic initial preview with the ordinary read cursor', async () => {
  const h = await fixture()
  try {
    const preview = await h.gateway.previewTarget('semantic', h.target, 3)
    expect(preview).toMatchObject({ text: '第一段', total: 7, truncated: true, nextCursor: expect.any(String) })
    const rest = readData(await h.call('read', { target: h.target, cursor: preview.nextCursor }))
    expect(rest.text).toBe(' 第二段')
  } finally { await h.gateway.stop('semantic') }
})

it('reports one local shape error with the real batch index and target in execution and preflight', async () => {
  const h = await fixture(), before = h.session.read()
  try {
    const input = { operations: [
      { name: 'object.update', input: { target: h.target, properties: { visible: true } } },
      { name: 'object.update', input: { target: h.target, properties: { frame: { width: 'wide' } } } },
    ] }
    const expected = { kind: 'error', code: 'invalid-input', data: { tool: 'object.update', operationIndex: 1, target: h.target,
      field: 'properties.frame.width', expected: expect.stringContaining('number'), read: { name: 'read', input: { target: h.target, detail: 'object' } } } }
    const result = await h.call('batch', input)
    expect(result).toMatchObject(expected)
    if (result.kind !== 'error') throw new Error('Expected input diagnostic')
    expect(result.message).toContain('operations[1]')
    expect(result.message.length).toBeLessThan(400)
    expect(result.message).not.toContain('invalid_union')
    expect(await h.gateway.preflightBatch('semantic', input)).toMatchObject(expected)
    expect(await h.call('object.update', input.operations[1].input)).toMatchObject({ kind: 'error', data: { target: h.target, field: 'properties.frame.width' } })
    expect(h.session.read()).toEqual(before)
  } finally { await h.gateway.stop('semantic') }
})

it('keeps actual project.apply file paths when a single or batch content value has the wrong shape', async () => {
  const h = await fixture(), before = h.session.read()
  try {
    const path = componentProjectFiles(h.project, h.resources).find(file => file.binding?.kind === 'instance-source' && file.binding.instanceId === 'text' && !file.authorSource?.dependencyId)!.path
    const result = await h.call('project.apply', { path, content: 23 })
    expect(result).toMatchObject({ kind: 'error', code: 'invalid-input', data: { tool: 'project.apply', target: path,
      field: 'content', expected: expect.stringContaining('string'), read: { name: 'project.read', input: { path } } } })
    const batch = await h.call('project.apply', { operations: [{ path, content: h.source }, { path, content: 23 }] })
    expect(batch).toMatchObject({ kind: 'error', code: 'invalid-input', data: { tool: 'project.apply', target: path, operationIndex: 1,
      field: 'content', expected: expect.stringContaining('string'), read: { name: 'project.read', input: { path } } } })
    expect(h.session.read()).toEqual(before)
  } finally { await h.gateway.stop('semantic') }
})

it.each(['text', 'content-edit'] as const)('narrows the %s initial catalog while restoring explicitly loaded layout tools', async profile => {
  const h = await fixture()
  try {
    h.gateway.setInitialToolProfile('semantic', profile)
    const initial = (await h.gateway.describeRun('semantic')).map(tool => tool.name)
    expect(initial).toEqual(expect.arrayContaining(['read', 'text.replace', 'text.format', 'batch']))
    expect(initial).not.toContain('object.update')
    expect(initial.includes('project.read')).toBe(profile === 'content-edit')
    await h.gateway.loadToolFamilies('semantic', ['layout'])
    expect((await h.gateway.describeRun('semantic')).map(tool => tool.name)).toContain('object.update')
    h.gateway.setInitialToolProfile('semantic', 'text')
    expect((await h.gateway.describeRun('semantic')).map(tool => tool.name)).toContain('object.update')
  } finally { await h.gateway.stop('semantic') }
})

it('executes an authorized tool outside the narrow initial catalog and reveals its family', async () => {
  const h = await fixture(), before = h.session.read()
  try {
    h.gateway.setInitialToolProfile('semantic', 'text')
    expect((await h.gateway.describeRun('semantic')).map(tool => tool.name)).not.toContain('object.update')
    expect(await h.call('object.update', { target: h.target, properties: { visible: false } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const after = h.session.read()
    expect(after.model).toMatchObject({ kind: 'course-v10', project: { instances: { text: { visible: false, data: h.project.instances.text.data } } } })
    expect(after.undoDepth).toBe(before.undoDepth + 1)
    expect((await h.gateway.describeRun('semantic')).map(tool => tool.name)).toContain('object.update')
  } finally { await h.gateway.stop('semantic') }
})

it('loads an authorized tool by its actual name even without a family and returns its canonical schema', async () => {
  const h = await fixture({ skills: { async read({ skill }) { return { status: 'unknown-skill', skill } }, async catalog() { return [] } } })
  try {
    h.gateway.setInitialToolProfile('semantic', 'text')
    expect((await h.gateway.describeRun('semantic')).map(tool => tool.name)).not.toContain('skills.list')
    await h.gateway.loadToolFamilies('semantic', [], ['skills.list'])
    const loaded = await h.gateway.describeRun('semantic')
    expect(loaded.find(tool => tool.name === 'skills.list')).toEqual((await h.gateway.describe(['skills.list']))[0])
    expect(loaded.map(tool => tool.name)).not.toContain('skills.read')
    expect(await h.call('skills.list', {})).toMatchObject({ kind: 'read', data: { entries: [] } })
    expect(await h.gateway.resolveRunTool('semantic', 'skills.read')).toMatchObject({ name: 'skills.read', schema: { properties: { skill: { type: 'string' } } } })
    await expect(h.gateway.loadToolFamilies('semantic', [], ['not-an-actual-tool'])).rejects.toMatchObject({ code: 'not-authorized' })
    expect((await h.gateway.describeRun('semantic')).map(tool => tool.name)).not.toContain('not-an-actual-tool')
  } finally { await h.gateway.stop('semantic') }
})
