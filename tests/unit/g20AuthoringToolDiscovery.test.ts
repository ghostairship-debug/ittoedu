// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import type { HostToolServices } from '../../src/core/tools/HostToolServices'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { modelToolWireName, serializeModelRequest } from '../../src/main/workbench/providers/OpenAIChatProvider'
import type { ModelSelection, ModelToolDefinition } from '../../src/shared/workbench/modelProvider'
import type { ToolDefinition } from '../../src/shared/workbench/tools'
import { agentFileSchemas, agentFileTools } from '../../src/core/tools/AgentFileTools'

it('serializes the file write create/replace union as an object without changing its canonical branches', () => {
  const write = agentFileTools.find(tool => tool.name === 'file.write')!
  const body = JSON.parse(serializeModelRequest({ selection: {
    model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
      baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture' },
      billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', reasoning: 'unknown', vision: 'unknown' } },
  }, messages: [{ role: 'user', content: 'fixture' }], tools: [write as ModelToolDefinition] }))
  expect(body.tools[0].function.parameters).toMatchObject({ type: 'object', oneOf: [{ type: 'object' }, { type: 'object' }] })
  expect(agentFileSchemas['file.write'].parse({ mode: 'create', path: 'lesson.html', content: '<h1>课例</h1>' }).mode).toBe('create')
  // replace no longer needs a prior read; a supplied expectedVersion is still checked when writing.
  expect(agentFileSchemas['file.write'].parse({ mode: 'replace', path: 'lesson.html', content: '<h1>课例</h1>' }).mode).toBe('replace')
})

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})

async function fixture(withImport = true) {
  const directory = await mkdtemp(path.join(tmpdir(), 'g20-authoring-discovery-'))
  directories.push(directory)
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const unexpectedExecution = async (): Promise<never> => { throw new Error('Discovery must not execute a host service') }
  const services: HostToolServices = {
    builds: { create: unexpectedExecution, lookupCreate: async () => null, execute: unexpectedExecution,
      artifact: unexpectedExecution, cancelRun: unexpectedExecution },
    ...(withImport ? { htmlImports: { import: unexpectedExecution, lookup: async () => null, cancel: unexpectedExecution } } : {}),
  }
  host.tools.configureHostServices(services)
  const document = await host.internalAPI.create({ kind: 'course-v9',
    project: createBlankCourseProject({ includeDefaultController: false, controls: 'none' }),
    resources: { assets: {}, components: {} } }, 'authoring.h5lesson')
  return { host, document }
}

it('advertises HTML import for a writable whole V9 document while build tools still require family loading', async () => {
  const { host, document } = await fixture()
  await host.tools.beginRun({ runId: 'whole', actor: 'agent',
    documents: [{ documentId: document.documentId, writable: [{ kind: 'document' }] }] })
  const baseline = await host.tools.describeRun('whole')
  expect(baseline.filter(tool => tool.name === 'html.import')).toHaveLength(1)
  expect(baseline.some(tool => tool.name.startsWith('build.'))).toBe(false)
  // Reach input validation through the advertised gateway; no import or build executes.
  expect(await host.tools.execute('whole', 'import-input', { name: 'html.import', input: {} }))
    .toMatchObject({ kind: 'error', code: 'invalid-input' })
  expect(await host.tools.execute('whole', 'hidden-build', { name: 'build.create', input: {} }))
    .toMatchObject({ kind: 'error', code: 'tool-not-advertised' })

  await host.tools.loadToolFamilies('whole', ['build'])
  const expanded = await host.tools.describeRun('whole')
  expect(expanded.map(tool => tool.name)).toContain('build.create')
  expect(expanded.filter(tool => tool.name === 'html.import')).toHaveLength(1)
})

it('does not advertise HTML import without a document, with a read-only V9 grant, or without its host service', async () => {
  const { host, document } = await fixture()
  for (const runId of ['no-document', 'read-only']) {
    await host.tools.beginRun({ runId, actor: 'agent',
      documents: runId === 'no-document' ? [] : [{ documentId: document.documentId, writable: [] }] })
    expect((await host.tools.describeRun(runId)).map(tool => tool.name)).not.toContain('html.import')
    await host.tools.loadToolFamilies(runId, ['build'])
    expect((await host.tools.describeRun(runId)).map(tool => tool.name)).not.toContain('html.import')
    expect(await host.tools.execute(runId, `${runId}-import`, { name: 'html.import', input: {} }))
      .toMatchObject({ kind: 'error', code: 'tool-not-advertised' })
  }
  const unwired = await fixture(false)
  await unwired.host.tools.beginRun({ runId: 'unwired', actor: 'agent',
    documents: [{ documentId: unwired.document.documentId, writable: [{ kind: 'document' }] }] })
  expect((await unwired.host.tools.describeRun('unwired')).map(tool => tool.name)).not.toContain('html.import')
})

const selection: ModelSelection = { model: 'fixture-model', connection: {
  id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1',
  accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture-not-resolved' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' },
} }

function serializedCatalog(definitions: readonly ToolDefinition[]) {
  const tools: ModelToolDefinition[] = definitions.map(tool => ({ name: tool.name, description: tool.description,
    inputSchema: tool.schema as ModelToolDefinition['inputSchema'] }))
  const payload = serializeModelRequest({ selection, messages: [{ role: 'user', content: '导入已准备好的 HTML' }], tools })
  const wire = JSON.parse(payload) as { tools: { type: 'function'; function: { name: string } }[] }
  return { tools: wire.tools, stats: { toolCount: wire.tools.length,
    toolBytes: Buffer.byteLength(JSON.stringify(wire.tools), 'utf8'), payloadBytes: Buffer.byteLength(payload, 'utf8') } }
}

it('adds only the HTML import schema to the actual provider request and reports its serialized byte cost', async () => {
  const wired = await fixture(), unwired = await fixture(false)
  for (const { host, document } of [wired, unwired]) await host.tools.beginRun({ runId: 'wire', actor: 'agent',
    documents: [{ documentId: document.documentId, writable: [{ kind: 'document' }] }] })
  const before = serializedCatalog(await unwired.host.tools.describeRun('wire'))
  const after = serializedCatalog(await wired.host.tools.describeRun('wire'))
  const importName = modelToolWireName('html.import')
  expect(after.tools.filter(tool => tool.function.name === importName)).toHaveLength(1)
  expect(after.tools.filter(tool => tool.function.name !== importName)).toEqual(before.tools)
  expect(after.stats.toolCount - before.stats.toolCount).toBe(1)
  expect(after.stats.payloadBytes).toBeGreaterThan(before.stats.payloadBytes)
  expect(after.stats.payloadBytes - before.stats.payloadBytes).toBe(after.stats.toolBytes - before.stats.toolBytes)
  console.info(JSON.stringify({ measurement: 'authoring-tool-discovery', localSerializationOnly: true,
    before: before.stats, after: after.stats, addedToolCount: after.stats.toolCount - before.stats.toolCount,
    addedPayloadBytes: after.stats.payloadBytes - before.stats.payloadBytes }))
})
