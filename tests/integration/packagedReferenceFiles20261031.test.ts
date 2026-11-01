// @vitest-environment node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { workbenchReferenceLibrary } from '../../src/main/workbench/referenceLibrary'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import type { AgentFileContext } from '../../src/core/tools/AgentFileTools'
import type { ModelProvider, ModelSelection } from '../../src/shared/workbench/modelProvider'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }) })
const selection: ModelSelection = { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture',
  protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture' },
  billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
async function fixture() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'packaged-reference-')); roots.push(root)
  const workspace = path.join(root, 'workspace'), resources = path.join(root, 'package', 'resources')
  const library = path.join(resources, 'reference-library'), filename = path.join(library, 'creative-reference', 'README.md')
  await fs.mkdir(workspace); await fs.mkdir(path.dirname(filename), { recursive: true })
  await fs.writeFile(filename, 'Installed reference: keep the original read-only.')
  const outside = path.join(resources, 'not-reference.md'); await fs.writeFile(outside, 'This is not in the bundled reference grant.')
  const location = workbenchReferenceLibrary({ isPackaged: true, resourcesPath: resources, appPath: path.join(resources, 'app.asar') })
  const host = new DocumentHostService(path.join(root, 'journal'), {}, { readOnlyFileRoots: location.readOnlyRoots })
  return { root, workspace, resources, library, filename, outside, location, host }
}
async function run(h: Awaited<ReturnType<typeof fixture>>, permission: 'read-only' | 'full',
  steps: Array<{ name: string; input: Record<string, unknown> }>, workspaceRoot = h.workspace) {
  let turn = 0
  const provider: ModelProvider = { async *stream(request) {
    const step = steps[turn++]
    const calls = step ? [{ id: `call-${turn}`, type: 'function' as const,
      function: { name: step.name, arguments: JSON.stringify(step.input) } }] : []
    yield { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: `response-${turn}`,
      actualModel: 'fixture', nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop',
      toolCalls: calls.map(call => ({ id: call.id, name: call.function.name, argumentsText: call.function.arguments })),
      assistant: { role: 'assistant', content: calls.length ? '' : '已检查真实文件权限回执。', ...(calls.length ? { tool_calls: calls } : {}) } }
  } }
  const engine = new ExecutionEngine({ registry: h.host.registry, gateway: h.host.tools, provider, files: h.host.agentFiles,
    runs: new ExecutionRunStore(path.join(h.root, 'runs')), events: new ExecutionEventStore({ directory: path.join(h.root, 'events') }) })
  const started = await engine.start({ conversationId: 'references', taskId: 'read-installed-library', instruction: '检查随包参考范围，不授予其他根',
    documents: [], workspaceRoot, permission, selection })
  return engine.wait(started.runId)
}

it('uses the same narrow packaged root while a development Skill override grants no repository access', async () => {
  const h = await fixture()
  expect(h.location).toEqual({ referenceRoot: await fs.realpath(h.library), readOnlyRoots: [await fs.realpath(h.library)] })
  expect(workbenchReferenceLibrary({ isPackaged: false, resourcesPath: h.resources, appPath: h.workspace }))
    .toEqual({ referenceRoot: h.workspace, readOnlyRoots: [] })
  const invalidResources = path.join(h.root, 'invalid-resources'); await fs.mkdir(invalidResources)
  await fs.symlink(h.workspace, path.join(invalidResources, 'reference-library'), process.platform === 'win32' ? 'junction' : 'dir')
  expect(workbenchReferenceLibrary({ isPackaged: true, resourcesPath: invalidResources, appPath: h.workspace }).readOnlyRoots).toEqual([])
  const missingResources = path.join(h.root, 'missing-resources'); await fs.mkdir(missingResources)
  expect(workbenchReferenceLibrary({ isPackaged: true, resourcesPath: missingResources, appPath: h.workspace }).readOnlyRoots).toEqual([])
})

it('the actual Engine file.read sees installed references without a caller-supplied read root and rejects their siblings', async () => {
  const h = await fixture()
  const ended = await run(h, 'read-only', [
    { name: 'file.read', input: { path: h.filename } },
    { name: 'file.read', input: { path: h.outside } },
  ])
  expect(ended.tools[0]?.result).toMatchObject({ kind: 'read', data: { text: 'Installed reference: keep the original read-only.', dirty: false } })
  expect(ended.tools[1]?.result).toMatchObject({ kind: 'error', code: 'file-tool-failed' })
  expect(await fs.readdir(h.workspace)).toEqual([])
})

it('the actual Engine cannot patch a reference alias at full permission even with an overlapping workspace, but ordinary user writes still work', async () => {
  const h = await fixture(), alias = path.join(h.workspace, 'reference-alias')
  await fs.symlink(h.library, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const ended = await run(h, 'full', [
    { name: 'file.patch', input: { path: path.join(alias, 'creative-reference', 'README.md'), oldText: 'Installed reference', newText: 'Overwritten' } },
    { name: 'file.write', input: { mode: 'create', path: path.join(h.workspace, 'user-note.txt'), content: 'Explicit ordinary user write' } },
  ], h.root)
  expect(ended.tools[0]?.result).toMatchObject({ kind: 'error', code: 'file-tool-failed' })
  expect(ended.tools[1]?.result).toMatchObject({ kind: 'read', data: { saved: true } })
  expect(await fs.readFile(h.filename, 'utf8')).toBe('Installed reference: keep the original read-only.')
  expect(await fs.readFile(path.join(h.workspace, 'user-note.txt'), 'utf8')).toBe('Explicit ordinary user write')
})

it('the sole file owner combines immutable reference roots with current assembly and read-only history without following escaping aliases', async () => {
  const h = await fixture(), runs = new ExecutionRunStore(path.join(h.root, 'assembly-runs'))
  const current = await runs.assemblyDirectory('current'), prior = await runs.assemblyDirectory('prior')
  const recovery = path.join(prior, 'source.md'); await fs.writeFile(recovery, 'Prior continuation source')
  const context: AgentFileContext = { runId: 'current', workspaceRoot: h.workspace, permission: 'workspace',
    assemblyRoot: current, readOnlyRoots: [prior] }
  expect((await h.host.agentFiles.execute(context, 'file.read', { path: h.filename }, 'reference-read')).data)
    .toMatchObject({ text: 'Installed reference: keep the original read-only.' })
  expect((await h.host.agentFiles.execute(context, 'file.read', { path: recovery }, 'prior-read')).data)
    .toMatchObject({ text: 'Prior continuation source' })
  expect((await h.host.agentFiles.execute(context, 'file.write', { mode: 'create', path: path.join(current, 'assembled.txt'), content: 'Mechanical' }, 'assembly-write')).data)
    .toMatchObject({ saved: true, purpose: 'assembly' })
  const patch = { path: h.filename, oldText: 'Installed reference', newText: 'Overwritten' }
  const scope = await h.host.agentFiles.preflightMutation(context, 'file.patch', patch)
  expect(scope.outside).toBe(true)
  await expect(h.host.agentFiles.execute({ ...context, permission: 'full', approvedOutsidePaths: scope.paths }, 'file.patch', patch, 'approved-still-immutable'))
    .rejects.toThrow()
  await expect(h.host.agentFiles.execute({ ...context, permission: 'full' }, 'file.write',
    { mode: 'replace', path: recovery, content: 'Must preserve history' }, 'old-write')).rejects.toThrow()
  const escape = path.join(h.library, 'outside-alias')
  await fs.symlink(h.resources, escape, process.platform === 'win32' ? 'junction' : 'dir')
  await expect(h.host.agentFiles.execute({ ...context, permission: 'read-only' }, 'file.read', { path: path.join(escape, 'not-reference.md') }, 'escaped-read')).rejects.toThrow()
  expect(await fs.readFile(recovery, 'utf8')).toBe('Prior continuation source')
})

it('the actual Engine and prepared-course creation cannot bypass reference immutability, while exact outside-directory approval still creates ordinary files', async () => {
  const h = await fixture(), alias = path.join(h.workspace, 'reference-alias')
  await fs.symlink(h.library, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const ended = await run(h, 'full', [
    { name: 'file.create', input: { path: path.join(alias, 'creative-reference'), name: 'forbidden.txt', kind: 'text' } },
  ], h.root)
  expect(ended.tools[0]?.result).toMatchObject({ kind: 'error', code: 'file-tool-failed' })
  const context: AgentFileContext = { runId: 'create-guard', workspaceRoot: h.workspace, permission: 'workspace',
    approvedOutsideDirectory: await fs.realpath(h.resources) }
  await expect(h.host.agentFiles.createPreparedCourse({ ...context, permission: 'full' },
    { path: path.join(alias, 'creative-reference'), name: 'forbidden.glx', bytes: new Uint8Array() }, 'prepared-denied')).rejects.toThrow()
  await h.host.agentFiles.execute(context, 'file.create',
    { path: h.resources, name: 'ordinary-parent-note.txt', kind: 'text' }, 'approved-create')
  expect(await fs.readFile(path.join(h.resources, 'ordinary-parent-note.txt'), 'utf8')).toBe('')
  expect(await fs.readdir(path.dirname(h.filename))).toEqual(['README.md'])
})

it('destructive directory sources cannot contain protected references, but copying a read-only source into its ordinary parent remains allowed', async () => {
  const h = await fixture(), alias = path.join(h.workspace, 'resources-alias')
  await fs.symlink(h.resources, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const context: AgentFileContext = { runId: 'directory-guard', workspaceRoot: h.root, permission: 'full' }
  await expect(h.host.agentFiles.execute(context, 'file.rename', { path: alias, name: 'renamed-resources' }, 'rename-parent')).rejects.toThrow()
  await expect(h.host.agentFiles.execute(context, 'file.move', { sources: [h.resources], destination: h.workspace }, 'move-parent')).rejects.toThrow()
  await expect(h.host.agentFiles.execute(context, 'file.trash', { paths: [h.resources] }, 'trash-parent')).rejects.toThrow()
  const copied = await h.host.agentFiles.execute(context, 'file.copy',
    { sources: [h.filename], destination: h.resources, sourceVersion: 'disk' }, 'copy-reference-out')
  expect(copied.data).toMatchObject({ operation: { status: 'success' } })
  expect(await fs.readFile(path.join(h.resources, 'README.md'), 'utf8')).toBe('Installed reference: keep the original read-only.')
  expect(await fs.readFile(h.filename, 'utf8')).toBe('Installed reference: keep the original read-only.')
})
