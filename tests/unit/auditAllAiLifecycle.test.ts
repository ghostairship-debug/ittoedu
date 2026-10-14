// @vitest-environment node
import { readFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { transformSync } from 'esbuild'
import { parse, type Node } from 'acorn'
import { afterEach, expect, it, vi } from 'vitest'
import { AttachmentService } from '../../src/main/workbench/attachments/AttachmentService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { PayloadCompiler } from '../../src/core/execution/PayloadCompiler'
import { dispatchMaterialTool } from '../../src/main/workbench/execution/MaterialReadTools'
const roots: string[] = []
type AdmittedMaterialResult = { data: unknown; admittedSourceIds: string[] }
afterEach(async () => { for (const root of roots.splice(0)) { if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Invalid fixture root'); await fs.rm(root, { recursive: true, force: true }) } })
async function fixture() { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-ai-lifecycle-')); roots.push(directory); return directory }
// Execute a directly selected production expression with only boundary ports replaced.
function expression(filename: string, select: (node: any) => Node | undefined, dependencies: Record<string, unknown>): any {
  const compiled = transformSync(readFileSync(filename, 'utf8'), { loader: 'ts', format: 'esm' }).code
  const ast = parse(compiled, { ecmaVersion: 'latest', sourceType: 'module' }); let selected: Node | undefined
  const visit = (node: Node) => { selected ??= select(node); for (const value of Object.values(node)) { if (Array.isArray(value)) { for (const child of value) { if (child?.type) visit(child) } } else if (value && typeof value === 'object' && 'type' in value) visit(value as Node) } }
  visit(ast); if (!selected) throw new Error(`Production expression missing in ${filename}`)
  return new Function(...Object.keys(dependencies), `return ${compiled.slice(selected.start, selected.end)}`)(...Object.values(dependencies))
}
const selection = { model: 'fixture', role: 'conversation', connection: { id: 'c', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://example.org', accountId: 'a', auth: { kind: 'api-key', credentialRef: 'fixture' }, billing: { kind: 'unknown' }, capabilities: { tools: 'unknown', stream: 'unknown', vision: 'unknown', reasoning: 'unknown' } } } as any
it.each(['source', 'inline'])('CA-153 reads one full snapshot when preparing 40 %s page references for submission and payload', async delivery => {
  const directory = await fixture(), service = new AttachmentService({ directory, extractor: { extract: async () => ({ material: { version: 1, extractorVersion: 'fixture', format: 'docx', fragments: Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, kind: 'text' as const, text: `page${i}`, locator: { part: 'word/document.xml', paragraph: i + 1 } })), assets: [], gaps: [] }, pageImages: [] }) } })
  const source = await service.receiveBytes({ name: 'a.docx', bytes: new TextEncoder().encode('PK fixture'), source: { kind: 'paste' } }), snapshot = await service.extract(source.id)
  const attachments = snapshot.representations.map(rep => ({ attachmentId: snapshot.id, representationId: rep.id, delivery: delivery as any }))
  const readSnapshot = vi.spyOn(service, 'readSnapshot'), current = { workspaceId: 'w', conversationId: 'c' }
  const h = Object.assign(Object.create(ExecutionDesktopService.prototype), { attachments: service, required: async () => current, timing: () => {},
    conversations: { readWorkspace: async () => ({ rootPath: directory }) }, options: { settings: { snapshot: async () => selection, read: async () => ({ profile: { roles: {} } }) } } }) as any
  await h.prepareSubmission({ workspaceId: 'w', conversationId: 'c', submissionId: 's', text: 'read', documents: [], attachments }, current, 'digest', [])
  expect(readSnapshot).toHaveBeenCalledTimes(1); readSnapshot.mockClear()
  const compiler = new PayloadCompiler({ attachments: service, serializePayload: input => JSON.stringify(input.messages) })
  await compiler.compile({ input: { id: 'i', capturedAt: 0, instruction: 'read', context: [], attachments }, selection, tools: [] })
  expect(readSnapshot).toHaveBeenCalledTimes(1)
})
it('CA-214 freezes actual immutable CSV attachment bytes by granted material ID without treating the UUID as a path', async () => {
  const directory = await fixture(), attachments = new AttachmentService({ directory }), original = await attachments.receiveBytes({ name: 'data.csv', bytes: new TextEncoder().encode('a,b\n1,2'), source: { kind: 'paste' } })
  const pathRead = vi.fn(async () => { throw new Error('Material ID is not a file path') })
  const freeze = expression('src/main/workbench/workbenchToolServices.ts', node => node.type === 'Property' && node.key.name === 'computeInputs' ? node.value.properties.find((property: any) => property.key.name === 'freeze')?.value : undefined,
    { host: { agentFiles: { readAuthorizedFile: pathRead } }, fileContext: () => ({ assertActive: () => {} }), materialIds: new Map([['r', new Set([original.id])]]), attachmentsDesktopService: async () => ({ attachments }) })
  expect(await freeze('r', [original.id])).toEqual([{ name: 'data.csv', bytes: new TextEncoder().encode('a,b\n1,2') }]); expect(pathRead).not.toHaveBeenCalled()
})
it('CA-279 registers actual tool-derived sources in the existing conversation owner and releases both managed snapshots on deletion', async () => {
  const directory = await fixture(), service = new AttachmentService({ directory, extractor: { extract: async () => ({ material: { version: 1, extractorVersion: 'fixture', format: 'docx', fragments: [{ id: 'p', kind: 'text', text: 'healthy', locator: { part: 'word/document.xml' } }], assets: [], gaps: [] }, pageImages: [] }) } })
  const original = await service.receiveBytes({ name: 'a.docx', bytes: new TextEncoder().encode('PK fixture'), source: { kind: 'paste' } }), derived = await service.extract(original.id)
  const run = { runId: 'r', status: 'completed', input: { conversationId: 'c', taskId: 't' }, initialPayload: { explicitAttachments: [{ attachmentId: original.id }] }, tools: [{ state: 'returned', call: { name: 'material.read' }, result: { kind: 'read', data: { attachmentId: original.id, admittedSourceIds: [derived.id] } } }] }
  const engine = Object.assign(Object.create(ExecutionEngine.prototype), { options: { materials: service }, continuationLineage: async () => [run], read: async () => run })
  const record = { workspaceId: 'w', conversationId: 'c', revision: 1, attachmentIds: [original.id], inputAttachments: [], messages: [], runIndex: { builtinRunIds: ['r'] } }
  const h = Object.assign(Object.create(ExecutionDesktopService.prototype), { engine, collectReply: async () => {}, startNext: async () => {},
    submissions: { read: async () => ({ workspaceId: 'w' }) }, conversations: { readConversation: async () => record,
      updateConversation: async (input: any) => Object.assign(record, input.patch) } }) as any
  await h.afterRunEnd('r')
  expect(record.attachmentIds).toEqual([original.id, derived.id])
  const owned = await h.ownedConversationAttachments(record)
  expect(owned).toEqual([original.id, derived.id])
  await service.prepareConversationRelease({ version: 1, workspaceId: 'w', conversationId: 'c', attachmentIds: owned }); await service.collectConversationReleases([])
  expect(await fs.readdir(path.join(directory, 'snapshots'))).toEqual([]); expect(await fs.readdir(path.join(directory, 'blobs'))).toEqual([])
})
it.each(['already-returned', 'during-collection', 'new-run-during-collection'])('CA-279 retains a shared derived snapshot used by another run %s before terminal projection', async timing => {
  const directory = await fixture(), service = new AttachmentService({ directory, extractor: { extract: async () => ({ material: { version: 1, extractorVersion: 'fixture', format: 'docx', fragments: [{ id: 'p', kind: 'text', text: 'healthy', locator: { part: 'word/document.xml' } }], assets: [], gaps: [] }, pageImages: [] }) } })
  const original = await service.receiveBytes({ name: 'a.docx', bytes: Uint8Array.of(80, 75, 3, 4, 1), source: { kind: 'paste' } })
  const initial = await dispatchMaterialTool(service, new Set([original.id]), 'material.read', { attachmentId: original.id }) as AdmittedMaterialResult
  const derived = await service.readSnapshot(initial.admittedSourceIds![0])
  const receipt = async () => {
    const result = await dispatchMaterialTool(service, new Set([original.id]), 'material.read', { attachmentId: original.id }) as AdmittedMaterialResult
    expect(result.admittedSourceIds).toContain(derived.id)
    return { state: 'returned', call: { name: 'material.read' }, result: { kind: 'read', data: { ...(result.data as object), admittedSourceIds: result.admittedSourceIds } } }
  }
  let run = { runId: 'b-run', status: timing === 'new-run-during-collection' ? 'completed' : 'running', input: { conversationId: 'b' }, initialPayload: { explicitAttachments: [{ attachmentId: original.id }] }, tools: timing === 'already-returned' ? [await receipt()] : [] }
  const stored = new Map([[run.runId, structuredClone(run)]]), active = new Map(run.status === 'running' ? [[run.runId, { record: run }]] : [])
  const engine = Object.assign(Object.create(ExecutionEngine.prototype), { active, options: { materials: service, runs: { read: async (id: string) => structuredClone(stored.get(id) ?? null) } }, continuationLineage: async (record: any) => [record] })
  const live = { workspaceId: 'w', conversationId: 'b', attachmentIds: [original.id], inputAttachments: [], messages: [], runIndex: { builtinRunIds: [run.runId] } }
  const h = Object.assign(Object.create(ExecutionDesktopService.prototype), { engine, attachments: service,
    conversations: { listWorkspaces: async () => [{ workspaceId: 'w' }], listConversations: async () => [live] } }) as any
  if (timing !== 'already-returned') {
    const collect = service.collectConversationReleases.bind(service)
    vi.spyOn(service, 'collectConversationReleases').mockImplementation(async owners => {
      if (timing === 'new-run-during-collection') { run = { ...run, runId: 'b-new-run', status: 'running', tools: [] }; active.set(run.runId, { record: run }); live.runIndex.builtinRunIds.push(run.runId) }
      run.tools.push(await receipt())
      return collect(owners)
    })
  }
  await service.prepareConversationRelease({ version: 1, workspaceId: 'w', conversationId: 'a', attachmentIds: [original.id, derived.id] })
  await h.collectAttachmentReleases()
  expect((await service.readSnapshot(derived.id)).derivedFrom).toBe(original.id)
  expect((await service.readRepresentation(derived.id, derived.representations[0].id)).bytes.length).toBeGreaterThan(0)
  expect(await service.readSnapshot(original.id)).toBeTruthy()
  expect(live.attachmentIds).toEqual([original.id])
  await service.prepareConversationRelease({ version: 1, workspaceId: 'w', conversationId: 'b', attachmentIds: await h.ownedConversationAttachments(live) })
  vi.restoreAllMocks()
  await service.collectConversationReleases([])
  expect(await fs.readdir(path.join(directory, 'snapshots'))).toEqual([])
  expect(await fs.readdir(path.join(directory, 'blobs'))).toEqual([])
})
it('CA-081 ignores inherited dev variables for packaged attachment and compute workers, selecting installed resources', () => {
  const app = { isPackaged: true, getAppPath: () => 'D:/installed/app.asar' }, taskProcess = { env: { VITE_DEV_SERVER_URL: 'not a valid URL' } }, resolveRendererEntryUrl = vi.fn(() => { throw new Error('Dev URL should not be parsed') })
  const dependencies = { app, process: taskProcess, resolveRendererEntryUrl }
  const dev = expression('src/main/workbench/attachments/attachmentsDesktopService.ts', node => node.type === 'VariableDeclarator' && node.id.name === 'dev' ? node.init : undefined, dependencies)
  const computeDevURL = expression('src/main/workbench/workbenchToolServices.ts', node => node.type === 'VariableDeclarator' && node.id.name === 'computeDevURL' ? node.init : undefined, dependencies)
  expect(dev).toBeUndefined(); expect(computeDevURL).toBeUndefined(); expect(resolveRendererEntryUrl).not.toHaveBeenCalled()
  const options = expression('src/main/workbench/workbenchToolServices.ts', node => node.type === 'NewExpression' && node.callee.name === 'PyodideComputeBackend' ? node.arguments[0] : undefined,
    { app, path, __dirname: 'D:/installed/dist/main/workbench', computeDevURL })
  expect(options.rendererFile.replaceAll('\\', '/')).toBe('D:/installed/app.asar/dist-renderer/compute.html')
  expect(options.runtimeDirectory.replaceAll('\\', '/')).toBe('D:/installed/app.asar/dist-renderer/vendor/compute-runtime')
})
it('CA-082 obtains a current activity count from checkpoint summaries and live runs without reading history bodies', async () => {
  const store = new ExecutionRunStore(await fixture()), run = { schemaVersion: 1, runId: 'r', version: 1, status: 'running', input: { conversationId: 'c', documents: [] }, messages: [], tools: [], requests: [] } as any
  await store.save(run)
  const read = vi.spyOn(store, 'read'), list = vi.spyOn(store, 'list')
  const engine = Object.assign(Object.create(ExecutionEngine.prototype), { options: { runs: store }, active: new Map() }) as any
  expect(engine.activeRunCount()).toBe(1)
  await store.save({ ...run, status: 'completed' }); expect(engine.activeRunCount()).toBe(0)
  expect(read).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled()
})
it('CA-083 launches the Portable outer owner whose existing ExecWait keeps the resident extraction directory alive', () => {
  const executable = 'C:/Temp/extracted/app.exe', portable = 'D:/Portable/果铃.exe'
  const result = expression('src/main/workbench/external/installedMcpBootstrap.ts', node => node.type === 'VariableDeclarator' && node.id.name === 'residentExecutable' ? node.init : undefined, { process: { platform: 'win32', env: { PORTABLE_EXECUTABLE_FILE: portable } }, executable })
  expect(result).toBe(portable)
  const template = readFileSync('node_modules/app-builder-lib/templates/nsis/portable.nsi', 'utf8')
  expect(template).toContain('PORTABLE_EXECUTABLE_FILE'); expect(template).toContain('ExecWait')
})
