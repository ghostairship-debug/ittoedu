// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { ContentApplyService } from '../../src/main/workbench/contentApply/applyService'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { componentCompilationInput } from '../../src/core/components/compilation/componentCompilationInput'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { readComponentProjectFileInput, prepareComponentProjectFileSource } from '../../src/main/workbench/projectFiles/componentPlatformFileInput'
import { frozenImageRoles } from '../../src/main/workbench/images/frozenImageRoles'
import { collectComponentProjectHealth } from '../../src/core/components/componentProjectHealth'
import type { HostToolServices } from '../../src/core/tools/HostToolServices'
import type { ComponentOperationBatch } from '../../src/shared/contracts/component-platform'
import type { ToolResult } from '../../src/shared/workbench/tools'
import type { ExecutionSelectionSnapshot } from '../../src/shared/workbench/executionSettings'

async function fixture(options: { workspaceRoot?: string; services?: HostToolServices } = {}) {
  const project = createBlankCourseProjectV10('Gateway behavior')
  project.definitions.shared = { id: 'shared', role: 'content', implementation: { kind: 'source', language: 'javascript',
    source: 'export default { mount() { return { update() {}, dispose() {} }; } };' } }
  project.logic = { courseState: [{ key: 'score', valueType: 'number', defaultValue: 0 }, { key: 'total', valueType: 'number', defaultValue: 1 }], navigationGuards: [] }
  for (const [index, id] of ['a', 'b'].entries()) project.instances[id] = { id, definitionId: 'shared', data: { marker: id },
    stateBindings: { input: 'score' }, frame: { width: 300, height: 160, transform: [1, 0, 0, 1, 40 + index * 340, 80] } }
  project.surfaces[0].childIds = ['a', 'b']
  const resources = { assets: {}, components: {} }
  const driver = new CourseV10Driver(), registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID,
    bindingKey: binding => binding.path, persistence: { async append() {}, async save() { throw new Error('No save requested') } } })
  const session = await registry.create({ kind: 'course-v10', project, resources }, 'gateway.glx')
  const compiler = createEsbuildComponentCompiler(), compilation = new InMemoryComponentCompilation(compiler)
  const commands: ComponentOperationBatch[] = []
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID, { services: options.services, componentContent: {
    source: (from, fileAccess, sourceHtml) => readComponentProjectFileInput({ from, fileAccess, sourceHtml }),
    prepareSource: prepareComponentProjectFileSource,
    async apply(input) {
      return new ContentApplyService({ compilation, session: { project: () => input.baseline.model.project,
        resources: () => input.baseline.model.resources, dispatch: async command => {
          input.assertActive(); commands.push(command)
          return session.execute({ documentId: input.baseline.documentId, epoch: input.baseline.epoch,
            baseRevision: input.baseline.revision, operationId: input.operationId, requestDigest: input.requestDigest,
            actor: input.actor, runId: input.runId, runLeaseId: input.runLeaseId, mutation: { type: 'command', command } })
        } }, async measure() { throw new Error('Enhancement must not measure or reconstruct content') } }).apply(input.request)
    },
  } })
  await gateway.beginRun({ runId: 'behavior', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }],
    ...(options.workspaceRoot ? { fileAccess: { workspaceRoot: options.workspaceRoot, permission: 'workspace' as const } } : {}) })
  const call = (name: string, input: Record<string, unknown>) => gateway.execute('behavior', randomUUID(), { name, input })
  const model = () => { const current = session.read().model; if (current.kind !== 'course-v10') throw new Error('Expected V10'); return current }
  await call('project.list', {})
  const file = componentProjectFiles(project, resources).find(file => file.binding?.kind === 'instance-source' && file.binding.instanceId === 'a' && !file.authorSource?.dependencyId)!
  return { project, resources, driver, session, compiler, gateway, commands, call, model, file }
}

function receipt(result: ToolResult) {
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read', data: { commit: 'committed', receipt: { status: 'applied' } } })
  if (result.kind !== 'read') throw new Error('Expected read receipt')
  return result.data as { enhancementPath?: string; files?: { path: string; content?: string }[]; diagnostics?: { code: string; message: string }[] }
}

it('applies business-only enhancement through the observed main Source, returning its real dependency content in one undo', async () => {
  const h = await fixture(), before = h.session.read(), business = 'export default ({scope}) => { scope.state.set("score", 8); };'
  expect(await h.call('project.read', { path: h.file.path })).toMatchObject({ kind: 'read', data: { content: h.file.content } })
  const data = receipt(await h.call('project.apply', { path: h.file.path, intent: 'enhance', content: business }))
  expect(h.commands).toHaveLength(1)
  expect(h.commands[0].type).toBe('component-platform.apply')
  expect(h.session.read().undoDepth).toBe(before.undoDepth + 1)
  expect(h.model().project.instances.a.frame).toEqual(h.project.instances.a.frame)
  expect(h.model().project.instances.b).toEqual(h.project.instances.b)
  expect(h.model().project.definitions.shared).toEqual(h.project.definitions.shared)
  const implementation = h.model().project.instances.a.implementationOverride
  if (implementation?.kind !== 'source') throw new Error('Expected Source composition')
  const dependencyId = implementation.moduleBindings!['./enhancement']
  expect(h.model().project.definitions[dependencyId].implementation).toMatchObject({ kind: 'source', source: business })
  const actual = componentProjectFiles(h.model().project, h.model().resources).find(file => file.authorSource?.dependencyId === dependencyId && file.binding?.kind === 'instance-source' && file.binding.instanceId === 'a')!
  expect(data.enhancementPath).toBe(actual.path)
  expect(data.files).toContainEqual(expect.objectContaining({ path: actual.path, content: business }))
  expect(await h.call('project.read', { path: data.enhancementPath! })).toMatchObject({ kind: 'read', data: { content: business } })
  expect((await h.compiler.compile(componentCompilationInput(h.model().project, implementation, h.model().resources))).status).toBe('ready')
  const current = h.session.read()
  await h.session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
    operationId: randomUUID(), actor: 'human', mutation: { type: 'undo' } })
  expect(h.model().project.instances).toEqual(h.project.instances)
  expect(h.model().project.definitions).toEqual(h.project.definitions)
})

it('admits an enhancement from a real module/resource closure and compiles its preserved ordinary imports', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-behavior-'))
  try {
    const business = 'import { value } from "./helper.js"; import picture from "./picture.svg"; export default ({root}) => { if(root) root.dataset.result = String(value) + picture; };'
    await fs.writeFile(path.join(root, 'behavior.js'), business)
    await fs.writeFile(path.join(root, 'helper.js'), 'export const value = 11;')
    const image = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'
    await fs.writeFile(path.join(root, 'picture.svg'), image)
    const h = await fixture({ workspaceRoot: root }), before = h.session.read()
    await h.call('project.read', { path: h.file.path })
    const data = receipt(await h.call('project.apply', { path: h.file.path, intent: 'enhance', from: 'behavior.js' }))
    const wrapper = h.model().project.instances.a.implementationOverride
    if (wrapper?.kind !== 'source') throw new Error('Expected wrapper')
    const id = wrapper.moduleBindings!['./enhancement'], dependency = h.model().project.definitions[id].implementation
    if (dependency.kind !== 'source' || !dependency.workspace) throw new Error('Expected ordinary workspace closure')
    const files = h.model().resources.components[dependency.workspace.ownerId]
    expect(new TextDecoder().decode(files[dependency.workspace.entry])).toBe(business)
    expect(new TextDecoder().decode(files['helper.js'])).toBe('export const value = 11;')
    expect(new TextDecoder().decode(files['picture.svg'])).toBe(image)
    expect(data.files).toContainEqual(expect.objectContaining({ path: data.enhancementPath, content: business }))
    const compiled = await h.compiler.compile(componentCompilationInput(h.model().project, wrapper, h.model().resources))
    expect(compiled, JSON.stringify(compiled.status === 'failed' ? compiled.diagnostics : compiled.status)).toMatchObject({ status: 'ready' })
    expect(h.commands).toHaveLength(1)
    expect(h.session.read().undoDepth).toBe(before.undoDepth + 1)
    expect(h.model().project.instances.b).toEqual(h.project.instances.b)
    const reopened = h.driver.load(h.driver.serialize(h.model()))
    expect(reopened).toEqual(h.model())
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

it('merges and removes explicit aliases through object.update and keeps unknown declarations local', async () => {
  const h = await fixture()
  const target = await h.gateway.issueTarget('behavior', h.session.documentId, { kind: 'course-instance', surfaceId: h.project.surfaces[0].id, instanceId: 'a' })
  const update = (stateBindings: Record<string, string | null> | null) => h.call('object.update', { target, properties: { stateBindings } })
  expect(await update({ output: 'total' })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(h.model().project.instances.a.stateBindings).toEqual({ input: 'score', output: 'total' })
  expect(await update({ input: null })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(h.model().project.instances.a.stateBindings).toEqual({ output: 'total' })
  const before = h.session.read()
  expect(await update({ lost: 'unknown' })).toMatchObject({ kind: 'error', message: expect.stringContaining('来源尚未声明') })
  expect(h.session.read().revision).toBe(before.revision)
  expect(h.model().project.instances.a.stateBindings).toEqual({ output: 'total' })
  expect(h.model().project.instances.b).toEqual(h.project.instances.b)
  expect(await update(null)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(h.model().project.instances.a.stateBindings).toBeUndefined()
  const imported = structuredClone(h.model())
  imported.project.instances.a.stateBindings = { lost: 'unknown' }
  const reopened = h.driver.load(h.driver.serialize(imported))
  expect(reopened.kind === 'course-v10' && reopened.project.instances.a.stateBindings).toEqual({ lost: 'unknown' })
  expect(collectComponentProjectHealth(imported.project, imported.resources)).toContainEqual(expect.objectContaining({
    code: 'state-binding-source-missing', severity: 'warning', path: ['instances', 'a', 'stateBindings', 'lost'], target: expect.objectContaining({ instanceId: 'a' }),
  }))
})

it('discloses frozen image readiness and reasons through the media family without credentials or provider execution', async () => {
  const connection = { id: 'private-connection', revision: 1, provider: 'openai', protocol: 'chatgpt-responses', baseURL: 'https://chatgpt.com/backend-api/codex',
    auth: { kind: 'oauth', credentialRef: 'private-credential-ref' }, accountId: 'private-account',
    billing: { kind: 'unknown' }, capabilities: { stream: 'unknown', tools: 'unknown', vision: 'unknown', reasoning: 'unknown' } } as const
  let editReady = false
  const snapshot = vi.fn(async (role: ExecutionSelectionSnapshot['role']): Promise<ExecutionSelectionSnapshot> => {
    if (role === 'imageEdit' && !editReady) throw new Error('private-credential-ref must never become a public error')
    return { role, profileRevision: 1, profileUpdatedAt: '', connection, model: 'private-model', parameters: {} }
  })
  const roles = frozenImageRoles(snapshot)
  const execute = vi.fn(async () => { throw new Error('Discovery must not execute an image request') })
  const h = await fixture({ services: {
    beginRun: grant => roles.beginRun(grant.runId),
    images: { describe: runId => roles.describe(runId), selection: (runId, _documentId, operation) => roles.selection(runId, operation),
      run: execute, read: execute, stop: execute, readResource: execute },
  } })
  editReady = true
  const families = await h.gateway.availableToolFamilies('behavior'), media = families.find(family => family.family === 'media')!
  expect(media.description).toContain('生成：已配置')
  expect(media.description).toContain('编辑：不可用')
  expect(media.description).toContain('开始时图片连接尚未接通')
  expect(media.description).toContain('已配置不代表供应商真实执行成功')
  await h.gateway.describeRun('behavior')
  expect(await h.gateway.availableToolFamilies('behavior')).toEqual(families)
  expect(snapshot).toHaveBeenCalledTimes(2)
  expect(execute).not.toHaveBeenCalled()
  for (const privateFact of ['private-credential-ref', 'private-connection', 'private-account', 'private-model']) expect(JSON.stringify(families)).not.toContain(privateFact)
})
