/** One bounded new-work transfer attempt. No fixed object tree or source is
 * supplied to the model. Candidate-specific interaction acceptance comes after
 * the original candidate is frozen; this fixture never self-awards quality. */
import assert from 'node:assert/strict'
import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { documentHost } from '../../src/main/workbench/documentHost'
import { installWorkbenchToolServices, disposeHeadlessWorkbenchWorkers } from '../../src/main/workbench/workbenchToolServices'
import { resolveRendererEntryUrl } from '../../src/main/rendererEntry'
import { ExecutionEngine, loadToolsDefinition } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { EditSessionService } from '../../src/main/workbench/execution/EditSessionService'
import { contextReadTool } from '../../src/main/workbench/execution/ContextReadTool'
import { taskNoteTool } from '../../src/core/tools/TaskNoteTools'
import { canonicalMutationTools, familyOfTool } from '../../src/core/tools/ToolCatalog'
import { agentFileTools, type AgentFileService as AgentFilePort } from '../../src/core/tools/AgentFileTools'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { OAuthDesktopService } from '../../src/main/workbench/providers/OAuthDesktopService'
import { createElectronCredentialEncryption } from '../../src/main/workbench/providers/providerCredentials'
import { ChatGPTResponsesProvider } from '../../src/main/workbench/providers/ChatGPTResponsesProvider'
import { modelFetch } from '../../src/main/workbench/providers/modelFetch'
import { providerSessionAffinityHeaders } from '../../src/main/workbench/providers/providerSessionAffinity'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform'
import { liveSourceOwners } from '../../src/core/components/compilation/liveSourceReferences'
import { componentDefinitionBuiltinKey } from '../../src/shared/contracts/component-platform'
import { assertExperimentNetworkReady } from './experimentOwnerBootstrap20261031.node'
import { noteCredentialFailure } from './delegationDirectoryConsumer20261030.node'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection, ModelStreamOptions, PreparedModelRequest } from '../../src/shared/workbench/modelProvider'
import type { ToolResult } from '../../src/shared/workbench/tools'

export interface CreationMigrationConfig {
  root: string; out: string; originalProfile: string; phase: 'zero' | 'live' | 'cold'
  /** Wrapper-owned wall clock, set before this phase's Electron process starts. */
  attemptStartedAt: number; budgetMs?: number
  /** Explicit review-guided follow-up in a new out directory; never reseeds a raw trial. */
  repairHandoff?: string
}
export const CREATION_BRIEF = `请从一个新建的空白工程开始，创作《社区温室：把水留给下一班》。

这是一份用于教学的假想实验，有两个各具作用的场景：“实验台”和“交接记录”。水箱初始为60 L；学习者可选择本次用水量，范围0–60 L、步长10 L。点击“执行灌溉”后产生一次真实结果（本次用量、余量），并解锁交接记录。每次执行都是从同一初始60 L比较当前方案，余量为60 L减去本次选择；后续执行更新上一次结果。交接记录须显示真实初值以及实际结果的后续更新，不能用演示数字冒充。返回实验台保留当前结果；“重新试验”是显式复位，清除记录并恢复初始状态。

标题、说明和一张可替换配图应有普通原生编辑边界，教师可以直接接手。两处业务内容共用同一个持有常量和结果结构的业务模块。统一视觉和清楚的状态反馈，适合课堂演示；明确这是教学假想模型。把成品保存到当前工作空间，提供可继续编辑的GLX和断网可运行的单HTML。

创作前请阅读果铃现有的内置创作方法指引：orchestrate-courseware 的 SKILL.md、references/creation-method.md 和 references/teacher-controller.md。请按当前软件能力自主组织内容和实现，不照搬先前作品。` 
const REPAIR_BRIEF = `请接手当前工作空间中的《社区温室-教师接手.glx》独立副本，完成一次审阅后定点续修。

原brief明确要求两处业务内容共用同一个持有常量和结果结构的业务模块。原候选自己已经说明：增强时两幕分别收录了 greenhouse-model.js 依赖副本，尚不能认定为工程内唯一共享模块。请解决这一个缺口，使实验台和交接记录真实引用同一份正式业务模块，后续只在共享作者入口修改这份逻辑，两处都能得到更新。不要把两个相同代码副本或只相同的运行态键当作已经共用一个作者模块。

实际离线操作已确认：初值60 L、选择0–60 L且10 L步长、0和60边界、后次结果覆盖、往返保留以及两个入口的重新试验均符合原brief。键盘可以到未解锁占位，但不会显示虚假有效结果；这不需要修。请保留这些现有行为，不改变初值、步长、计算关系或复位含义。

教师已经通过正式App修改了标题和说明、拖动说明，并替换了配图；该版本已保存并在独立App进程冷开通过。必须保留全部原生对象身份、正文、人改、图片及来源资源、几何与其余作者内容。只改共享业务代码的组织和必要的模块连接，不重建页面，不把整页封成程序，不改图或额外调用模型。

先实际阅读当前内置 orchestrate-courseware 的 SKILL.md、references/creation-method.md、references/teacher-controller.md，并阅读当前工程 references/component-api5.md 中的 Source 说明，了解正式共享模块连接能力。请自主决定最小组织方式，使用果铃当前正式工具完成，报告你实际采用的共享入口。最后由你正式保存本副本GLX，并导出同一版本的离线单HTML；说明任何未完成项。`
const briefFor = (config: CreationMigrationConfig) => config.repairHandoff ? REPAIR_BRIEF : CREATION_BRIEF
const VERSION = 'creation-migration-20261031-v1', SKILL = 'orchestrate-courseware'
const GUIDES = ['SKILL.md', 'references/creation-method.md', 'references/teacher-controller.md']
const families = ['content', 'layout', 'navigation', 'interaction', 'build', 'media'] as const
// Ordinary source discovery/adoption and native media transactions are available.
// Asset-library maintenance and paid generation are outside this creation trial.
const mediaNames = new Set(['media.apply', 'media.insert', 'course.media', 'image.search', 'image.preview', 'image.fetch', 'asset.search', 'asset.use'])
const fileNames = new Set(['file.list', 'file.open', 'file.create', 'file.read', 'file.grep', 'file.write', 'file.patch', 'file.mkdir'])
const extras = new Set(['skills.list', 'skills.read', 'read', 'inspect', 'listChildren', 'batch', 'project.list', 'project.read', 'project.apply',
  'file.save', 'document.export', 'tools.load', 'context.read', 'task.note', 'artifact.save', 'job.status', 'job.wait', ...mediaNames])
const nativeMutations = new Set<string>(canonicalMutationTools.map(tool => tool.name))
function allowed(name: string) {
  if (/^(?:image\.(?:generate|edit|status)$|media\.(?:start|discover)$|delegate\.|compute\.|local\.)/.test(name)) return false
  const family = familyOfTool(name)
  return extras.has(name) || fileNames.has(name) || nativeMutations.has(name) || /^view\.(?:observe|click|input|scroll|hover)$/.test(name)
    || !!family && family !== 'media' && (families as readonly string[]).includes(family)
}
const allowedFor = (config: CreationMigrationConfig, name: string) => allowed(name) && (!config.repairHandoff || name !== 'file.create')
const json = (value: unknown) => JSON.stringify(value, (_key, item) => item instanceof Uint8Array ? [...item] : item, 2)
const plain = (value: unknown) => JSON.parse(json(value))
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex')
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const modelHash = (value: unknown) => hash(JSON.stringify(canonical(plain(value))))
const write = (filename: string, value: unknown) => fs.writeFile(filename, json(value))
const readJson = async (filename: string) => JSON.parse(await fs.readFile(filename, 'utf8'))
function resourceFacts(resources: Extract<DocumentSnapshot['model'], { kind: 'course-v10' }>['resources']) {
  const fact = (bytes: Uint8Array) => ({ bytes: bytes.byteLength, sha256: hash(bytes) })
  return { assets: Object.fromEntries(Object.entries(resources.assets).map(([id, value]) => [id, fact(value)])),
    components: Object.fromEntries(Object.entries(resources.components).map(([id, files]) => [id,
      Object.fromEntries(Object.entries(files).map(([name, value]) => [name, fact(value)]))])) }
}
async function repairFacts(config: CreationMigrationConfig) {
  if (!config.repairHandoff) return undefined
  assert(path.isAbsolute(config.repairHandoff))
  const handoff = await readJson(config.repairHandoff), producer = await readJson(handoff.sourceProducer)
  assert.equal(handoff.status, 'ready-for-review-guided-ai-repair')
  for (const key of ['originalFilesUnchanged', 'nativeText', 'nativeLayout', 'nativeImageImport', 'humanUndoRedo', 'savedAndColdRendered']) assert.equal(handoff[key], true)
  assert.equal(hash(await fs.readFile(handoff.document)), handoff.sha256)
  assert.equal(handoff.sourceDocumentSha256, producer.document.sha256)
  assert.equal(hash(await fs.readFile(path.join(producer.original, producer.document.relative))), producer.document.sha256)
  assert.equal(hash(await fs.readFile(path.join(producer.original, producer.html.relative))), producer.html.sha256)
  assert.equal(handoff.trialStartedAt, producer.trialStartedAt)
  return { handoffPath: config.repairHandoff, handoffSha256: hash(await fs.readFile(config.repairHandoff)),
    sourceDocument: handoff.document, sourceSha256: handoff.sha256, authorEvidence: handoff.authorEvidence,
    authorEvidenceSha256: hash(await fs.readFile(handoff.authorEvidence)), originalProducer: handoff.sourceProducer,
    originalProducerSha256: hash(await fs.readFile(handoff.sourceProducer)), originalTrialStartedAt: producer.trialStartedAt,
    originalModelRequests: producer.modelFetchInvocations, originalRunId: producer.runId, human: handoff.human }
}
function containsStringHash(value: unknown, expected: string): boolean {
  if (typeof value === 'string') return hash(value) === expected
  if (Array.isArray(value)) return value.some(item => containsStringHash(item, expected))
  return !!value && typeof value === 'object' && Object.values(value).some(item => containsStringHash(item, expected))
}
function outputContainsHash(output: string, expected: string) {
  try { return containsStringHash(JSON.parse(output), expected) } catch { return hash(output) === expected }
}
const inside = (root: string, filename: string) => { const relative = path.relative(path.resolve(root), path.resolve(filename))
  return !relative || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) }
const resultData = (result: ToolResult, label: string): any => {
  assert.equal(result.kind, 'read', `${label}: ${result.kind === 'error' ? result.code : result.kind}`)
  return (result as Extract<ToolResult, { kind: 'read' }>).data
}
const validAffinity = (value: string | null | undefined) => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
function affinityZero(selection: ModelSelection) {
  const first = { selection, sessionAffinity: { key: randomUUID() } }, second = { selection, sessionAffinity: { key: randomUUID() } }
  const a = providerSessionAffinityHeaders(first)['session-id'], repeated = providerSessionAffinityHeaders(first)['session-id']
  const b = providerSessionAffinityHeaders(second)['session-id']
  assert(validAffinity(a) && validAffinity(b)); assert.equal(a, repeated); assert.notEqual(a, b)
  return { owner: 'providerSessionAffinityHeaders', format: 'uuid-v5', stableSameScope: true, separatedConversationScopes: true,
    firstScopeSha256: hash(a!), secondScopeSha256: hash(b!), evidence: 'Zero-network pure production-owner projection; not a second live-conversation comparison' }
}
function selectionFact(selection: ModelSelection) {
  assert.equal(selection.model, 'gpt-6.1-terra'); assert.equal(selection.connection.protocol, 'chatgpt-responses')
  assert.equal((selection.parameters?.reasoning as any)?.effort, 'xhigh')
  return { model: selection.model, parameters: selection.parameters, protocol: selection.connection.protocol,
    connectionId: selection.connection.id, connectionRevision: selection.connection.revision }
}
async function account(config: CreationMigrationConfig) {
  const probe = await readJson(path.join(config.out, 'credential-preflight.json'))
  assert.equal(probe.status, 'decryption-readable-token-validity-unprobed'); assert.equal(probe.originalStartupContextRequired, true)
  assert.equal(probe.credentialReadableAfterDomainSwitch, true)
  assert.equal(path.resolve(probe.credentialOwnerProfile), path.resolve(config.originalProfile))
  const store = new ExecutionSettingsStore({ directory: path.join(config.originalProfile, 'workbench-v2/settings'), encryption: await createElectronCredentialEncryption() })
  const profile = (await store.read()).profile, current = await store.snapshot('conversation')
  const selection = await store.captureDelegationSelection({ connectionId: current.connection.id, model: 'gpt-6.1-terra', parameters: { reasoning: { effort: 'xhigh' } } }, current)
  return { store, selection, fact: selectionFact(selection), unchanged: async () => assert.deepEqual((await store.read()).profile, profile) }
}
async function bounded<T>(label: string, milliseconds: number, run: () => Promise<T> | T, cancel?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error(label), { code: 'EXPERIMENT_TIMEOUT' }))
      try { cancel?.() } catch { /* The primary deadline remains the reported failure. */ }
    }, milliseconds)
  })
  try { return await Promise.race([Promise.resolve().then(run), expired]) }
  finally { if (timer !== undefined) clearTimeout(timer) }
}
async function cleanup(config: CreationMigrationConfig, primaryFailed: boolean, steps: Array<{ name: string; run(): unknown | Promise<unknown> }>) {
  const failures: Array<{ step: string; message: string }> = []
  for (const step of steps) try { await bounded(`cleanup-timeout:${step.name}`, 10_000, step.run) }
  catch (error) { failures.push({ step: step.name, message: error instanceof Error ? error.message.slice(0, 800) : 'unknown' }) }
  await write(path.join(config.out, `${config.phase}-cleanup.json`), { failures, primaryFailed, finishedAt: Date.now() }).catch(() => {
    failures.push({ step: 'cleanup-evidence', message: 'write-failed' })
  })
  if (failures.length && !primaryFailed) throw new Error('migration-cleanup-failed')
}
async function manifest(directory: string) {
  const files: Array<{ path: string; bytes: number; sha256: string }> = []
  const visit = async (relative: string) => {
    for (const entry of (await fs.readdir(path.join(directory, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = path.join(relative, entry.name); assert(!entry.isSymbolicLink(), 'Candidate cannot contain a symlink')
      if (entry.isDirectory()) await visit(name)
      else { assert(entry.isFile()); const bytes = await fs.readFile(path.join(directory, name)); files.push({ path: name, bytes: bytes.length, sha256: hash(bytes) }) }
    }
  }
  await visit(''); return files
}
async function copyCandidate(source: string, destination: string) {
  const sourceStat = await fs.lstat(source)
  assert(sourceStat.isDirectory() && !sourceStat.isSymbolicLink(), 'Candidate copy source must be a real directory')
  // Intentionally avoid fs.cp/cpSync: both crashed in the actual Windows runtime.
  // Every destination is new; no links or special files are followed or copied.
  await fs.mkdir(destination)
  for (const entry of (await fs.readdir(source)).sort()) {
    const from = path.join(source, entry), to = path.join(destination, entry), stat = await fs.lstat(from)
    assert(!stat.isSymbolicLink(), 'Candidate cannot contain a symlink')
    if (stat.isDirectory()) await copyCandidate(from, to)
    else { assert(stat.isFile(), 'Candidate cannot contain a special file'); await fs.writeFile(to, await fs.readFile(from), { flag: 'wx' }) }
  }
}
async function zero(config: CreationMigrationConfig, host: ReturnType<typeof documentHost>, workspace: string) {
  assert.deepEqual(await fs.readdir(workspace), [], 'The model candidate workspace must start empty')
  const repair = await repairFacts(config)
  if (repair) {
    const opened = await host.open(repair.sourceDocument)
    assert.equal(opened.model.kind, 'course-v10'); assert.equal(opened.dirty, false)
    const model = opened.model as Extract<DocumentSnapshot['model'], { kind: 'course-v10' }>
    assert.deepEqual({ project: plain(model.project), resources: resourceFacts(model.resources) }, await readJson(repair.authorEvidence))
    await host.operate({ type: 'close', documentId: opened.documentId, discardDirty: false })
  }
  const access = await account(config), probeRoot = path.join(config.out, 'entry-probe'), runId = `migration-zero-${randomUUID()}`
  await fs.mkdir(probeRoot, { recursive: true })
  const fileContext = { runId, workspaceRoot: probeRoot, permission: 'workspace' as const }, receipts: unknown[] = [], guides: any[] = []
  await host.tools.beginRun({ runId, actor: 'agent', documents: [], fileAccess: { permission: 'workspace', workspaceRoot: probeRoot } })
  let gate: any, primaryFailed = false
  const call = async (name: string, input: unknown) => {
    const operation = `zero-${receipts.length}`
    await fs.appendFile(path.join(config.out, 'zero-activity.jsonl'), JSON.stringify({ name, operation, status: 'started', at: Date.now() }) + '\n')
    const result = await host.tools.execute(runId, operation, { name, input }); receipts.push({ name, input, result })
    await write(path.join(config.out, 'zero-receipts.json'), receipts)
    await fs.appendFile(path.join(config.out, 'zero-activity.jsonl'), JSON.stringify({ name, operation, status: 'returned', kind: result.kind, at: Date.now() }) + '\n')
    return resultData(result, name)
  }
  try {
    const outcome = await host.agentFiles.execute(fileContext, 'file.create', { name: 'empty-probe.glx', kind: 'course-v10' }, host.tools.operationIdentity(runId, 'zero-create'))
    assert(outcome.opened); const admitted = await host.tools.completeOpenedDocument(runId, outcome.opened, { selection: 'select' })
    const factory = await host.internalAPI.read(outcome.opened.documentId)
    await write(path.join(config.out, 'zero-factory-author.json'), factory)
    for (const relative of GUIDES) {
      const data = await call('skills.read', { skill: SKILL, path: relative, limit: 64000 })
      assert.equal(data.status, 'read'); assert.equal(data.truncated, false); assert(data.content.length > 100)
      guides.push({ path: relative, version: data.version, contentSha256: hash(data.content) })
    }
    await host.tools.loadToolFamilies(runId, families, [...extras, ...nativeMutations])
    const definitions = await host.tools.describeRun(runId)
    const tools = [...definitions.map(tool => ({ name: tool.name, schema: tool.schema })),
      ...agentFileTools.map(tool => ({ name: tool.name, schema: tool.inputSchema })),
      ...[loadToolsDefinition, contextReadTool, taskNoteTool].map(tool => ({ name: tool.name, schema: tool.inputSchema }))].filter(tool => allowedFor(config, tool.name))
    const schemas = Object.fromEntries(tools.map(tool => [tool.name, canonical(tool.schema)]))
    for (const name of [...(repair ? [] : ['file.create']), 'project.apply', 'file.save', 'document.export', 'view.observe', 'skills.read', 'media.insert', 'media.apply', 'asset.search']) assert(schemas[name], `Missing connected entry ${name}`)
    for (const name of ['image.generate', 'image.edit', 'media.start', 'delegate.agent', 'delegate.readonly', 'compute.run', 'local.run']) assert(!schemas[name], `Unexpected paid or delegated entry ${name}`)
    let sourceApiReference: { path: string; contentSha256: string } | undefined
    if (repair) {
      assert(!schemas['file.create']); assert(JSON.stringify(schemas['project.apply']).includes('source.imports'))
      const sourceApi = await call('project.read', { path: 'references/component-api5.md', full: true })
      assert.equal(sourceApi.complete, true); assert(sourceApi.content.includes('source.imports'))
      sourceApiReference = { path: sourceApi.path, contentSha256: hash(sourceApi.content) }
    }
    const save = await call('file.save', { target: admitted.target })
    assert.equal(save.status, 'saved')
    const exported = await bounded('zero-formal-export-timeout', 45_000, () => call('document.export', {
      target: admitted.target, format: 'html-offline', destination: path.join(probeRoot, 'empty-probe.html'),
    }), disposeHeadlessWorkbenchWorkers)
    assert.equal(exported.status, 'written'); assert(await fs.stat(exported.path).then(stat => stat.isFile()))
    assert.deepEqual(await fs.readdir(workspace), [], 'Probe may not prepopulate the candidate workspace')
    await access.unchanged()
    const briefPath = path.join(config.out, 'frozen-brief.md')
    await fs.writeFile(briefPath, briefFor(config), { flag: 'wx' })
    gate = { version: VERSION, status: 'zero-pass', modelRequests: 0, briefSha256: hash(briefFor(config)), guides, schemas,
      ...(repair ? { repair, sourceApiReference, experimentKind: 'review-guided-follow-up' } : {}),
      selection: access.fact, affinity: affinityZero(access.selection), candidateWorkspaceEmpty: true, probe: { location: probeRoot, factoryModelSha256: modelHash(factory.model),
        actualFormalSave: true, actualFormalOfflineExport: true, exportedSha256: hash(await fs.readFile(exported.path)) },
      network: assertExperimentNetworkReady(), rendererOwner: await readJson(path.join(config.out, 'renderer-owner-preflight.json')),
      profileRolesUnchanged: true, preparationStartedAt: config.attemptStartedAt, preparationFinishedAt: Date.now(), pid: process.pid }
  } catch (error) { primaryFailed = true; throw error }
  finally { await cleanup(config, primaryFailed, [{ name: 'worker-dispose', run: disposeHeadlessWorkbenchWorkers },
    { name: 'gateway-stop', run: () => host.tools.stop(runId) }, { name: 'file-run-release', run: () => host.agentFiles.releaseRun(runId) }]) }
  await write(path.join(config.out, 'zero-preflight.json'), gate); return gate
}
function verifySchema(name: string, schema: any, gate: any) {
  const expected = structuredClone(gate.schemas[name]); assert(expected, `Unprobed schema ${name}`)
  if (name === 'batch') {
    const names = schema.properties.operations.items.properties.name.enum as string[]
    assert(names.every(item => nativeMutations.has(item) && expected.properties.operations.items.properties.name.enum.includes(item)))
    expected.properties.operations.items.properties.name.enum = names
  }
  assert.deepEqual(canonical(schema), expected, `Connected schema changed since zero: ${name}`)
}
function authorIndex(snapshot: DocumentSnapshot) {
  assert.equal(snapshot.model.kind, 'course-v10')
  const model = snapshot.model as Extract<DocumentSnapshot['model'], { kind: 'course-v10' }>
  return { rootIds: model.project.rootIds, instances: Object.values(model.project.instances).map(instance => ({ id: instance.id, name: instance.name,
    definitionId: instance.definitionId, builtin: componentDefinitionBuiltinKey(model.project.definitions[instance.definitionId]),
    frame: instance.frame, container: instance.container, childIds: instance.childIds, dataKeys: Object.keys(instance.data ?? {}) })),
    files: componentProjectFiles(model.project, model.resources).map(file => ({ path: file.path, kind: file.kind, binding: file.binding })),
    sourceBindings: Object.values(model.project.definitions).filter(definition => definition.implementation.kind === 'source').map(definition => ({ id: definition.id,
      title: definition.title, role: definition.role, implementation: definition.implementation })) }
}
function inspectRepairAuthor(before: DocumentSnapshot, after: DocumentSnapshot) {
  assert.equal(before.model.kind, 'course-v10'); assert.equal(after.model.kind, 'course-v10')
  const original = before.model as Extract<DocumentSnapshot['model'], { kind: 'course-v10' }>
  const current = after.model as typeof original, findings: string[] = []
  const businessDefinitions = ['f0afc316-8238-4056-9a16-e3ce2224af62', '33cd7162-ae9a-46d6-b558-f86fe157afeb']
  const businessInstances = ['16e486c9-d8a9-4993-a092-890e21ee6e10', 'a39a6f90-99ab-4d9f-be93-020c8088ab1f']
  const businessOwners = new Set(businessDefinitions.flatMap(id => {
    const implementation = original.project.definitions[id]?.implementation
    return implementation?.kind === 'source' && implementation.workspace ? [implementation.workspace.ownerId] : []
  }))
  const graphs = businessInstances.map(id => {
    const instance = current.project.instances[id]
    assert(instance, `Missing original business instance ${id}`)
    return { instanceId: id, graph: liveSourceOwners(current.project,
      instance.implementationOverride ?? current.project.definitions[instance.definitionId]!.implementation, current.resources) }
  })
  const liveDefinitions = new Set(graphs.flatMap(({ graph }) => [...graph.definitions]))
  const liveOwners = new Set(graphs.flatMap(({ graph }) => [...graph.owners]))
  const protectedProject = (project: typeof current.project, candidate: boolean) => {
    const value = plain(project); delete value.revision
    for (const id of businessDefinitions) if (value.definitions[id]) { delete value.definitions[id].implementation; delete value.definitions[id].title }
    for (const id of businessInstances) if (value.instances[id]) delete value.instances[id].implementationOverride
    if (candidate) for (const [id, definition] of Object.entries(current.project.definitions)) if (!original.project.definitions[id]) {
      if (definition.implementation.kind !== 'source' || !liveDefinitions.has(id)) findings.push(`Unexpected new non-business definition: ${id}`)
      delete value.definitions[id]
    }
    return value
  }
  let authorPreserved = true, resourcesPreserved = true
  try { assert.deepEqual(protectedProject(current.project, true), protectedProject(original.project, false)) }
  catch { authorPreserved = false; findings.push('Protected native objects, human edits or non-business author content changed') }
  const originalResources = resourceFacts(original.resources), currentResources = resourceFacts(current.resources)
  try {
    assert.deepEqual(currentResources.assets, originalResources.assets)
    for (const [owner, files] of Object.entries(originalResources.components)) if (!businessOwners.has(owner))
      assert.deepEqual(currentResources.components[owner], files)
    for (const owner of Object.keys(currentResources.components)) if (!Object.hasOwn(originalResources.components, owner))
      assert(liveOwners.has(owner), `New component resource is not used by the repaired business: ${owner}`)
  } catch { resourcesPreserved = false; findings.push('Unrelated source or original human image resource bytes changed') }
  // Exact original business bytes prove shared author identity without equating
  // identical dormant copies with live dependencies. Rewritten business logic
  // needs explicit subsequent review rather than a fabricated automatic pass.
  const businessBodySha256 = 'fa691bf63fa96cc4ea97ca8292f2c4578464edab6b6ce19d951a9f0a309a1dc9'
  const shared = graphs.map(({ instanceId, graph }) => {
    const identities: string[] = []
    for (const [implementation, texts] of graph.sources) if (texts.some(text => hash(text) === businessBodySha256)) {
      if (implementation.workspace) {
        for (const [file, bytes] of Object.entries(current.resources.components[implementation.workspace.ownerId] ?? {}))
          if (hash(bytes) === businessBodySha256) identities.push(`${implementation.workspace.ownerId}/${file}`)
      } else for (const definition of Object.values(current.project.definitions)) if (definition.implementation === implementation)
        identities.push(`definition:${definition.id}`)
    }
    return { instanceId, liveBusinessIdentities: [...new Set(identities)], liveDefinitions: [...graph.definitions], liveOwners: [...graph.owners] }
  })
  const singleSharedBusinessOwner = shared.every(item => item.liveBusinessIdentities.length === 1)
    && shared[0]!.liveBusinessIdentities[0] === shared[1]!.liveBusinessIdentities[0]
  if (!singleSharedBusinessOwner) findings.push('The exact original business module does not yet have one proven shared live author identity; review required')
  return { authorPreserved, resourcesPreserved, businessBodySha256, singleSharedBusinessOwner, shared, findings }
}
async function inspectRepairHistory(config: CreationMigrationConfig, host: ReturnType<typeof documentHost>,
  workspace: string, before: DocumentSnapshot, candidate: DocumentSnapshot) {
  const content = (snapshot: DocumentSnapshot) => {
    assert.equal(snapshot.model.kind, 'course-v10')
    const model = plain(snapshot.model); delete model.project.revision; return model
  }
  const originalFiles = await manifest(workspace), originalContent = content(before), candidateContent = content(candidate)
  const transitions: any[] = [], count = candidate.undoDepth - before.undoDepth
  const startedAt = Date.now(); let current = candidate, result: any
  try {
    assert(count > 0 && count <= 200, 'The repaired document needs a finite formal History chain from the opened human input')
    assert.equal(candidate.redoDepth, 0)
    await bounded('repair-history-timeout', 30_000, async () => {
      for (const direction of ['undo', 'redo'] as const) {
        for (let index = 0; index < count; index++) {
          const previousRevision = current.revision
          const receipt = await host.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch,
            baseRevision: current.revision, actor: 'human', operationId: `greenhouse-repair-${direction}-${randomUUID()}`,
            mutation: { type: direction } })
          assert.equal(receipt.status, 'applied')
          current = await host.internalAPI.read(candidate.documentId)
          transitions.push({ direction, index, previousRevision, revision: current.revision,
            undoDepth: current.undoDepth, redoDepth: current.redoDepth })
          await write(path.join(config.out, 'repair-history-steps.json'), transitions)
        }
        assert.deepEqual(content(current), direction === 'undo' ? originalContent : candidateContent,
          direction === 'undo' ? 'Undo must restore all teacher author content and resource bytes' : 'Redo must restore the complete AI candidate')
        assert.equal(current.undoDepth, direction === 'undo' ? before.undoDepth : candidate.undoDepth)
      }
    })
    assert.deepEqual(await manifest(workspace), originalFiles, 'History inspection must not change model-saved GLX, HTML or workspace files')
    result = { status: 'verified', undoCount: count, redoCount: count, restoredExactHumanInput: true,
      restoredExactCandidate: true, workspaceFilesUnchanged: true }
  } catch (error) {
    result = { status: 'failed', code: (error as any)?.code ?? null,
      assertion: error instanceof assert.AssertionError ? error.message.slice(0, 800) : null }
  }
  const evidence = { ...result, transitions, startedAt, finishedAt: Date.now(),
    originalContentSha256: modelHash(originalContent), candidateContentSha256: modelHash(candidateContent),
    modelSavedRevision: candidate.revision, historySessionRevision: current.revision, historySessionDirty: current.dirty,
    fixtureSavedAfterHistory: false, originalFiles }
  await write(path.join(config.out, 'repair-history-evidence.json'), evidence)
  return evidence
}
async function live(config: CreationMigrationConfig, host: ReturnType<typeof documentHost>, workspace: string, gate: any) {
  assert.deepEqual(await fs.readdir(workspace), [], 'Every new trial or isolated follow-up starts with an empty workspace')
  const repair = await repairFacts(config); assert.deepEqual(repair, gate.repair)
  assert.deepEqual((await readJson(path.join(config.out, 'renderer-owner-preflight.json'))).critical, gate.rendererOwner.critical,
    'Compiled export owners changed since the zero-model gate')
  const access = await account(config); assert.deepEqual(access.fact, gate.selection)
  const marker = await fs.open(path.join(config.out, 'live-started.json'), 'wx')
  await marker.writeFile(json({ trialStartedAt: repair?.originalTrialStartedAt ?? config.attemptStartedAt,
    phaseStartedAt: config.attemptStartedAt, experimentKind: repair ? 'review-guided-follow-up' : 'new-creation', pid: process.pid })); await marker.close()
  const originals: any[] = [], fileOwner = host.agentFiles, facts: any[] = [], observedGuides: any[] = [], networkFacts: any[] = []
  let repairInput: DocumentSnapshot | undefined
  if (repair) {
    const filename = path.join(workspace, '社区温室-教师接手.glx')
    await fs.writeFile(filename, await fs.readFile(repair.sourceDocument), { flag: 'wx' })
    assert.equal(hash(await fs.readFile(filename)), repair.sourceSha256)
    repairInput = await host.open(filename); assert.equal(repairInput.dirty, false)
    await write(path.join(config.out, 'repair-input-author.json'), repairInput)
    originals.push({ documentId: repairInput.documentId, initialPath: 'repair-input-author.json', origin: 'exact-human-handoff-copy',
      modelSha256: modelHash(repairInput.model), sourceSha256: repair.sourceSha256, recordedAt: Date.now() })
  }
  // Only observe the existing native file creator's returned blank model. No
  // fixture body/source is admitted, and the model receives no extra content.
  const files: AgentFilePort = { preflightCreate: (...args) => fileOwner.preflightCreate(...args), preflightMutation: (...args) => fileOwner.preflightMutation(...args),
    preflightOffice: (...args) => fileOwner.preflightOffice(...args), executeOffice: (...args) => fileOwner.executeOffice(...args), releaseRun: id => fileOwner.releaseRun(id),
    execute: async (...args) => { const outcome = await fileOwner.execute(...args)
      if (args[1] === 'file.create' && outcome.opened?.kind === 'course-v10') {
        const initial = await host.internalAPI.read(outcome.opened.documentId)
        const initialPath = `factory-initial-${originals.length + 1}.json`
        await write(path.join(config.out, initialPath), initial)
        originals.push({ documentId: initial.documentId, initialPath, modelSha256: modelHash(initial.model), operationId: args[3], recordedAt: Date.now() })
      }
      return outcome
    } }
  const oauth = new OAuthDesktopService({ store: access.store, openExternal: async () => { throw new Error('No login flow in migration experiment') } }), transport = modelFetch()
  const actual = new ChatGPTResponsesProvider({ fetch: async (input, init) => {
      assertExperimentNetworkReady()
      // Read only the final production header. Never record the header value,
      // other headers, token, account or endpoint, and never override it.
      const value = new Headers(init?.headers).get('session-id')
      const observation: any = { at: Date.now(), bodySha256: hash(String(init?.body)), present: value !== null,
        formatValid: validAffinity(value), scopeSha256: value ? hash(value) : null, fetchInvoked: false }
      networkFacts.push(observation)
      try {
        assert(observation.present && observation.formatValid, 'Production session-id missing or invalid; no fixture substitution')
        observation.fetchInvoked = true
        const response = await transport(input, init); observation.httpStatus = response.status; observation.httpSuccess = response.ok
        return response
      } finally { await write(path.join(config.out, 'network-facts.json'), networkFacts) }
    },
    credentialResolver: async connection => { try { assertExperimentNetworkReady(); return await oauth.resolveCredential(connection) }
      catch (error) { await noteCredentialFailure(config.out, error, 'migration-oauth-resolver'); throw error } } })
  const filtered = (request: Omit<ModelRequest, 'requestId'>) => {
    assert.deepEqual(selectionFact(request.selection), gate.selection)
    return { ...request, tools: (request.tools ?? []).filter(tool => allowedFor(config, tool.name)).map(tool => { verifySchema(tool.name, tool.inputSchema, gate); return tool }) }
  }
  const monitor = async function* (requestId: string, prepared: PreparedModelRequest, options?: ModelStreamOptions): AsyncGenerator<ModelEvent> {
    assertExperimentNetworkReady(); const wire = JSON.parse(prepared.serialized)
    assert.equal(wire.model, 'gpt-6.1-terra'); assert.equal(wire.reasoning?.effort, 'xhigh')
    const fact: any = { requestId, enteredAt: Date.now(), model: wire.model, effort: wire.reasoning.effort, bodySha256: hash(prepared.serialized),
      toolNames: wire.tools?.map((tool: any) => tool.name) ?? [], guideOutputs: (wire.input ?? []).filter((item: any) => item.type === 'function_call_output' && typeof item.output === 'string')
        .flatMap((item: any) => gate.guides.filter((guide: any) => item.output.includes(guide.version)).map((guide: any) => ({ path: guide.path, version: guide.version,
          callId: item.call_id, outputSha256: hash(item.output) }))),
      sourceApiOutputs: gate.sourceApiReference ? (wire.input ?? []).filter((item: any) => item.type === 'function_call_output'
        && typeof item.output === 'string' && outputContainsHash(item.output, gate.sourceApiReference.contentSha256))
        .map((item: any) => ({ callId: item.call_id, outputSha256: hash(item.output) })) : [] }; facts.push(fact)
    try {
      for await (const event of prepared.stream(requestId, { ...options, onTiming: timing => { fact.timing = { ...timing }; options?.onTiming?.(timing) } })) {
        if (event.type === 'response.started' && event.actualModel) fact.actualModel = event.actualModel
        if (event.type === 'response.completed') { fact.actualModel = event.actualModel ?? fact.actualModel; fact.usage = event.usage; fact.finishedAt = Date.now()
          for (const tool of event.toolCalls) assert(allowedFor(config, tool.name), `Unadvertised external/model/local tool ${tool.name}; stop before dispatch`) }
        if (event.type === 'response.failed') fact.failure = { outcome: event.failure.outcome, kind: event.failure.kind, code: event.failure.code }
        yield event
      }
    } finally { await write(path.join(config.out, 'provider-facts.json'), facts) }
  }
  const provider: ModelProvider = { retrySafety: actual.retrySafety,
    prepare(request, accounting) { const prepared = actual.prepare(filtered(request), accounting)
      return { serialized: prepared.serialized, tokens: prepared.tokens, stream: (requestId, options) => monitor(requestId, prepared, options) } },
    stream(request, options) { return monitor(request.requestId, actual.prepare(filtered(request)), options) } }
  const routeStart = Date.now(), remaining = (config.budgetMs ?? 600000) - (routeStart - config.attemptStartedAt)
  assert(remaining > 0, 'Bootstrap consumed the bounded candidate time; no model sent')
  const events = new ExecutionEventStore({ directory: path.join(config.out, 'events') }), engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools,
    provider, files, runs: new ExecutionRunStore(path.join(config.out, 'runs')), events, edits: new EditSessionService(host.registry, host.tools),
    subscribeDocumentEvents: listener => host.subscribeEvents(listener) })
  const controller = new AbortController()
  let budgetStopped = false, primaryFailed = false, cleanupFailed = false, ended: any, failure: { name: string; code: unknown } | undefined
  const timer = setTimeout(() => { budgetStopped = true; controller.abort() }, remaining)
  try {
    const started = await engine.start({ conversationId: `migration-${randomUUID()}`, taskId: randomUUID(), instruction: briefFor(config),
      selection: access.selection, permission: 'workspace', workspaceRoot: workspace, documents: [] }, undefined, undefined, { signal: controller.signal })
    ended = await engine.wait(started.runId)
    // Canonical RunStore owns the complete record. This review copy excludes
    // account/credential identities; no token is ever part of ModelSelection.
    const reviewRun = structuredClone(ended)
    if (reviewRun.input?.selection) reviewRun.input.selection = selectionFact(ended.input.selection)
    await write(path.join(config.out, 'run.json'), reviewRun)
  } catch (error) { primaryFailed = true; failure = { name: error instanceof Error ? error.name : 'unknown', code: (error as any)?.code ?? null } }
  finally { clearTimeout(timer); await cleanup(config, primaryFailed, [
    { name: 'worker-dispose', run: disposeHeadlessWorkbenchWorkers }, { name: 'engine-shutdown', run: () => engine.shutdown() },
    { name: 'event-flush', run: () => events.flushPending() }, { name: 'profile-roles-unchanged', run: () => access.unchanged() },
  ]).catch(() => { cleanupFailed = true }) }
  const cleanupReport = await readJson(path.join(config.out, 'live-cleanup.json')).catch(() => null)
  cleanupFailed ||= !cleanupReport || cleanupReport.failures.length > 0
  const profileRolesUnchanged = cleanupReport ? !cleanupReport.failures.some((failure: any) => failure.step === 'profile-roles-unchanged') : null
  const routeEnd = Date.now(), findings: string[] = [], candidate = originals.length === 1 ? await host.internalAPI.read(originals[0].documentId) : undefined
  if (originals.length !== 1) findings.push(repair ? 'Expected exactly one isolated human-handoff document' : 'Expected exactly one actually created native blank course')
  if (!ended || ended.status !== 'completed') findings.push(`Engine did not finish normally: ${ended?.status ?? failure?.name ?? 'unknown'}`)
  if (budgetStopped) findings.push('Ten-minute candidate time reached')
  if (cleanupFailed) findings.push('Cleanup did not complete; candidate is preserved as incomplete')
  const identityUnobserved = facts.filter(fact => !fact.actualModel).map(fact => ({ requestId: fact.requestId, failure: fact.failure ?? null, timing: fact.timing }))
  if (!facts.length || facts.some(fact => fact.effort !== 'xhigh' || fact.actualModel && fact.actualModel !== 'gpt-6.1-terra')
    || !facts.some(fact => fact.actualModel === 'gpt-6.1-terra') || !repair && identityUnobserved.length)
    findings.push('Actual model identity is incomplete or mismatched')
  const actualNetwork = networkFacts.filter(fact => fact.fetchInvoked), affinityScopes = new Set(actualNetwork.map(fact => fact.scopeSha256))
  if (!actualNetwork.length || affinityScopes.size !== 1 || !actualNetwork.every(fact => fact.present && fact.formatValid && (repair || fact.httpSuccess)))
    findings.push('Production session affinity or HTTP success was not stable across this actual conversation')
  const tools: any[] = ended?.tools ?? [], saveReceipts = tools.filter(tool => tool.call.name === 'file.save' && tool.result?.kind === 'read')
    .map(tool => tool.result.data), exportReceipts = tools.filter(tool => tool.call.name === 'document.export' && tool.result?.kind === 'read').map(tool => tool.result.data)
  for (const guide of gate.guides) {
    const calls = tools.filter(tool => tool.call.name === 'skills.read' && tool.call.input?.skill === SKILL
      && (tool.call.input.path ?? 'SKILL.md') === guide.path && tool.result?.kind === 'read' && tool.result.data.version === guide.version)
    const delivered = facts.filter(fact => Number.isFinite(fact.timing?.fetchStartedAt) && fact.actualModel === 'gpt-6.1-terra')
      .flatMap(fact => (fact.guideOutputs ?? []).filter((output: any) => output.path === guide.path && calls.some(call => call.providerCallId === output.callId))
        .map((output: any) => ({ requestId: fact.requestId, ...output })))
    if (!calls.length || !delivered.length) findings.push(`Current bundled guide was not delivered: ${guide.path}`)
    observedGuides.push({ ...guide, calls: calls.map(tool => tool.callId), delivered })
  }
  let sourceApiConsumer: any, repairAuthor: ReturnType<typeof inspectRepairAuthor> | undefined
  if (repair) {
    const reads = tools.filter(tool => tool.call.name === 'project.read' && tool.result?.kind === 'read'
      && tool.result.data.path === gate.sourceApiReference.path && typeof tool.result.data.content === 'string'
      && hash(tool.result.data.content) === gate.sourceApiReference.contentSha256)
    const delivered = facts.filter(fact => Number.isFinite(fact.timing?.fetchStartedAt) && fact.actualModel === 'gpt-6.1-terra')
      .flatMap(fact => (fact.sourceApiOutputs ?? []).filter((output: any) => reads.some(read => read.providerCallId === output.callId))
        .map((output: any) => ({ requestId: fact.requestId, ...output })))
    const bindings = tools.filter(tool => tool.call.name === 'project.apply' && tool.call.input?.intent === 'source.imports'
      && tool.result?.kind === 'read' && tool.result.data.importChanges && tool.result.data.usability !== 'unusable')
    sourceApiConsumer = { reference: gate.sourceApiReference, reads: reads.map(tool => tool.callId), delivered,
      appliedBindings: bindings.map(tool => ({ callId: tool.callId, path: tool.call.input.path, changes: tool.result.data.importChanges })) }
    if (!reads.length || !delivered.length || !bindings.length) findings.push('Current formal source.imports capability was not read, delivered and successfully consumed')
    if (candidate && repairInput) {
      try { repairAuthor = inspectRepairAuthor(repairInput, candidate); findings.push(...repairAuthor.findings) }
      catch { findings.push('Repair author inspection could not establish the protected original structure') }
      await write(path.join(config.out, 'repair-author-check.json'), repairAuthor ?? { status: 'inspection-failed', preserved: false })
    }
    try { assert.deepEqual(await repairFacts(config), repair) }
    catch { findings.push('Original candidate or human handoff evidence changed during repair') }
  }
  let document: any, html: any
  if (candidate) {
    await write(path.join(config.out, 'candidate-live-author.json'), candidate)
    await write(path.join(config.out, 'candidate-author-index.json'), authorIndex(candidate))
    if (candidate.dirty || candidate.binding.kind !== 'file') findings.push('Candidate is not formally saved; fixture did not save for the model')
    if (candidate.binding.kind === 'file') {
      assert(inside(workspace, candidate.binding.path))
      document = { path: candidate.binding.path, relative: path.relative(workspace, candidate.binding.path), dirty: candidate.dirty,
        sha256: hash(await fs.readFile(candidate.binding.path)), modelSha256: modelHash(candidate.model), revision: candidate.revision, documentId: candidate.documentId }
      if (!saveReceipts.some(receipt => receipt.status === 'saved' && receipt.documentId === candidate.documentId && receipt.savedRevision === candidate.revision && !receipt.dirty))
        findings.push('No current formal save receipt from the model')
      const exported = [...exportReceipts].reverse().find(receipt => receipt.status === 'written' && receipt.format === 'html-offline'
        && receipt.documentId === candidate.documentId && receipt.exportedRevision === candidate.revision && typeof receipt.path === 'string')
      if (exported) { assert(inside(workspace, exported.path)); html = { path: exported.path, relative: path.relative(workspace, exported.path),
        sha256: hash(await fs.readFile(exported.path)), exportedRevision: exported.exportedRevision } }
      else findings.push('No written offline HTML of the same author revision from the model')
    }
  }
  // The snapshot/receipts above remain the model's own saved revision. This
  // separate same-Session History consumer never saves or replaces its files.
  let repairHistory: any
  if (repair && repairInput && candidate) {
    repairHistory = await inspectRepairHistory(config, host, workspace, repairInput, candidate)
    if (repairHistory.status !== 'verified') findings.push('AI repair History did not restore the exact human input and candidate')
  }
  const before = await manifest(workspace), original = path.join(config.out, 'candidate-original')
  await copyCandidate(workspace, original)
  const frozen = await manifest(original); assert.deepEqual(frozen, before); assert.deepEqual(await manifest(workspace), before)
  const produced = { version: VERSION, status: findings.length ? 'candidate-preserved-incomplete' : 'candidate-produced-awaiting-review',
    briefSha256: gate.briefSha256, selection: access.fact, originals, document, html, original, manifest: frozen, findings, observedGuides,
    ...(repair ? { experimentKind: 'review-guided-follow-up', repair, repairAuthor, repairHistory, sourceApiConsumer,
      followupStartedAt: config.attemptStartedAt, reviewInterventionCount: 1,
      originalRunId: repair.originalRunId, originalModelRequests: repair.originalModelRequests,
      transportCoverage: { identityUnobserved, failedOrUnobservedHttp: actualNetwork.filter(fact => !fact.httpSuccess) } } : {}),
    engineStatus: ended?.status ?? 'failed-before-completion', runId: ended?.runId ?? null, requestRecords: ended?.requests?.length ?? null,
    modelFetchInvocations: actualNetwork.length, toolRecords: tools.length,
    affinity: { productionHeadersUnchangedByFixture: true, present: actualNetwork.every(fact => fact.present),
      formatValid: actualNetwork.every(fact => fact.formatValid), stableSameConversation: affinityScopes.size === 1,
      scopeSha256: [...affinityScopes], allHttpSuccess: actualNetwork.every(fact => fact.httpSuccess), separationProbe: gate.affinity },
    failedToolCalls: tools.filter(tool => tool.result?.kind === 'error').map(tool => ({ callId: tool.callId, name: tool.call.name, code: tool.result.code })),
    inRunSteeringCount: ended?.steering?.length ?? 0, fixtureProvidedAuthorContent: false, candidateCount: originals.length, budgetStopped,
    trialStartedAt: repair?.originalTrialStartedAt ?? config.attemptStartedAt, routeStart, routeEnd, candidateFrozenAt: Date.now(), firstQualifiedAt: null,
    environmentPreparation: { startedAt: gate.preparationStartedAt, finishedAt: gate.preparationFinishedAt },
    timingQualification: 'Total first-qualified wall time remains open through candidate-specific UI, human handoff and cold/offline acceptance; no A/B or general ten-minute claim.',
    profileRolesUnchanged, network: assertExperimentNetworkReady(), pid: process.pid }
  await write(path.join(config.out, 'producer-result.json'), produced); return produced
}
async function cold(config: CreationMigrationConfig, host: ReturnType<typeof documentHost>) {
  const producer = await readJson(path.join(config.out, 'producer-result.json'))
  assert(producer.document && producer.html && !producer.document.dirty, 'The preserved candidate needs targeted completion before cold export review')
  assert.notEqual(producer.pid, process.pid)
  const filename = path.join(producer.original, producer.document.relative), html = path.join(producer.original, producer.html.relative)
  assert.equal(hash(await fs.readFile(filename)), producer.document.sha256); assert.equal(hash(await fs.readFile(html)), producer.html.sha256)
  const snapshot = await host.open(filename); assert.equal(snapshot.dirty, false); assert.equal(modelHash(snapshot.model), producer.document.modelSha256)
  await write(path.join(config.out, 'candidate-cold-author.json'), snapshot)
  const browser = await chromium.launch(), remoteRequests: string[] = [], errors: string[] = []
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined, result: any, primaryFailed = false
  try {
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, offline: true })
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(20000)
    page.on('request', request => { if (/^https?:/i.test(request.url())) remoteRequests.push(request.url()) }); page.on('pageerror', error => errors.push(error.message))
    await page.goto(pathToFileURL(html).href)
    await page.waitForFunction(() => Boolean((window as any).coursePlayer || (window as any).__coursePlaybackFailed), undefined, { timeout: 20000 })
    await page.waitForTimeout(600)
    await page.screenshot({ path: path.join(config.out, 'candidate-offline-initial.png') })
    const frames = await Promise.all(page.frames().map(async frame => {
      try { return await frame.evaluate(() => ({ url: location.href.startsWith('data:') ? 'data:document' : location.href,
        text: document.body?.innerText?.slice(0, 16000), controls: [...document.querySelectorAll('button,input,select,[role="button"]')].slice(0, 100).map(element => ({
          tag: element.tagName, text: element.textContent?.trim(), ariaLabel: element.getAttribute('aria-label'),
          type: element.getAttribute('type'), min: element.getAttribute('min'), max: element.getAttribute('max'), step: element.getAttribute('step'),
        })) })) } catch { return { unavailable: true } }
    }))
    await write(path.join(config.out, 'candidate-offline-observation.json'), { frames, remoteRequests, errors })
    result = { version: VERSION, status: 'candidate-cold-ready-for-review', independentColdOpen: true, coldPid: process.pid,
      savedSha256: producer.document.sha256, exportedHtmlSha256: producer.html.sha256, modelSha256: producer.document.modelSha256,
      remoteRequests, errors, candidateSpecificAcceptancePending: true, firstQualifiedAt: null, trialStartedAt: producer.trialStartedAt, observedAt: Date.now() }
  } catch (error) { primaryFailed = true; throw error }
  finally { await cleanup(config, primaryFailed, [{ name: 'context-close', run: () => context?.close() }, { name: 'browser-close', run: () => browser.close() }]) }
  await write(path.join(config.out, 'cold-result.json'), result); return result
}
export async function executeCreationMigration(config: CreationMigrationConfig) {
  try {
    await app.whenReady()
    for (const key of ['root', 'out', 'originalProfile'] as const) assert(path.isAbsolute(config[key]))
    assert(['zero', 'live', 'cold'].includes(config.phase)); assert(!inside(config.originalProfile, config.out))
    assert.equal(path.resolve(app.getAppPath()), path.resolve(config.root))
    assert(inside(config.out, app.getPath('userData')) && inside(config.out, app.getPath('sessionData')))
    assert(Number.isSafeInteger(config.attemptStartedAt) && config.attemptStartedAt <= Date.now())
    assert((config.budgetMs ?? 600000) > 0 && (config.budgetMs ?? 600000) <= 600000)
    await fs.mkdir(config.out, { recursive: true }); const workspace = path.join(config.out, 'workspace'); await fs.mkdir(workspace, { recursive: true })
    if (config.phase !== 'cold') {
      const rendererOwner = await readJson(path.join(config.out, 'renderer-owner-preflight.json'))
      assert.equal(rendererOwner.pid, process.pid); assert.equal(rendererOwner.status, 'installed')
      assert.equal(rendererOwner.entry, resolveRendererEntryUrl()); assert.equal(rendererOwner.entry, 'courseware-editor://app/index.html')
      assertExperimentNetworkReady(); installWorkbenchToolServices({ getMainWindow: () => null,
        getRendererEntryUrl: resolveRendererEntryUrl, headless: true })
    }
    const host = documentHost()
    if (config.phase === 'zero') return await zero(config, host, workspace)
    const gate = await readJson(path.join(config.out, 'zero-preflight.json'))
    assert.equal(gate.version, VERSION); assert.equal(gate.status, 'zero-pass'); assert.equal(gate.briefSha256, hash(briefFor(config)))
    assert.equal(await fs.readFile(path.join(config.out, 'frozen-brief.md'), 'utf8'), briefFor(config))
    assert.deepEqual(await repairFacts(config), gate.repair)
    return config.phase === 'live' ? await live(config, host, workspace, gate) : await cold(config, host)
  } catch (error) {
    const value = error as any
    await write(path.join(config.out, 'failure.json'), { phase: config.phase, name: value?.name ?? 'unknown',
      code: typeof value?.code === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value.code) ? value.code : null,
      assertion: value?.name === 'AssertionError' ? String(value.message).slice(0, 3000) : null, at: Date.now() }).catch(() => undefined)
    throw error
  }
}
