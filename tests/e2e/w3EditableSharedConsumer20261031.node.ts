/** Opt-in real built-in AI consumer. Import/zero preparation makes no model request.
 * Run zero, live and cold in separate Electron processes after the existing
 * original-owner crypto bootstrap switches domain storage to this output root. */
import assert from 'node:assert/strict'
import { app } from 'electron'
import { constants, promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium, expect, type BrowserContext, type Page } from '@playwright/test'
import { documentHost } from '../../src/main/workbench/documentHost'
import { installWorkbenchToolServices } from '../../src/main/workbench/workbenchToolServices'
import { ExecutionEngine, loadToolsDefinition } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { EditSessionService } from '../../src/main/workbench/execution/EditSessionService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { OAuthDesktopService } from '../../src/main/workbench/providers/OAuthDesktopService'
import { createElectronCredentialEncryption } from '../../src/main/workbench/providers/providerCredentials'
import { ChatGPTResponsesProvider } from '../../src/main/workbench/providers/ChatGPTResponsesProvider'
import { modelFetch } from '../../src/main/workbench/providers/modelFetch'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform'
import { agentFileTools } from '../../src/core/tools/AgentFileTools'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform'
import { buildComponentSingleHtml } from '../../src/core/publish/componentPlatform/buildSingleHtml'
import { SHARED_EXPERIMENT } from '../fixtures/creation/editableSharedExperiment'
import { noteCredentialFailure } from './delegationDirectoryConsumer20261030.node'
import { assertExperimentNetworkReady } from './experimentOwnerBootstrap20261031.node'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import type { ToolResult } from '../../src/shared/workbench/tools'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection, ModelStreamOptions, PreparedModelRequest } from '../../src/shared/workbench/modelProvider'

export interface W3SharedConsumerConfig {
  root: string; out: string; originalProfile: string; sourceFile: string; handoffEvidence: string
  phase: 'zero' | 'live' | 'cold'; budgetMs?: number
}
const VERSION = 'editable-shared-consumer-20261031-v1'
const SKILL = 'orchestrate-courseware', GUIDE = 'references/teacher-controller.md'
const GUIDE_MARKERS = ['局部增强的最短路径', 'project.apply', 'enhancementPath']
const BEFORE = 'energyScale: 120', AFTER = 'energyScale: 140'
const ALLOWED = ['skills.list', 'skills.read', 'file.open', 'tools.load', 'project.list', 'project.read', 'project.apply', 'file.save']
const PROMPT = '请通过果铃正式领域工具接手当前工作空间中的 editable-shared-handoff.glx。先实际调用 skills.read 读取内置 orchestrate-courseware 的 SKILL.md，以及 references/teacher-controller.md 中“局部增强的最短路径”一节；使用当前随附版本，不能用源码仓库或用户 Skill 的同名副本代替。随后 file.open，按需 tools.load，project.list/read 找到“共享实验参数与结果结构”的共享 Source 文件。仅将其中唯一的 energyScale: 120 原样替换为 energyScale: 140，使用 project.apply 的局部 edits；保持其余源码字节、两个增强的共同引用、原生标题和说明、教师图片、布局、资源、解锁与结果状态结构全部原样。若目标不唯一或原值不是120，停止并说明。不要重包增强、复制参数、重建页面、调用其他模型、联网、shell或导出。最后必须通过 file.save 正式保存本副本并核实回执，报告实际路径和唯一修改。只使用给定的果铃工具。'
const json = (value: unknown) => JSON.stringify(value, (_key, item) => item instanceof Uint8Array ? [...item] : item, 2)
const plain = (value: unknown) => JSON.parse(json(value))
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex')
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const modelHash = (value: unknown) => hash(JSON.stringify(canonical(plain(value))))
const write = (filename: string, value: unknown) => fs.writeFile(filename, json(value))
const readJson = async (filename: string) => JSON.parse(await fs.readFile(filename, 'utf8'))
async function cleanup(out: string, phase: string, primaryFailed: boolean,
  steps: Array<{ name: string; run(): unknown | Promise<unknown> }>) {
  const failures: Array<{ step: string; error: string }> = []
  // Stop native activity before flushing the receipts it may still produce.
  for (const step of steps) try { await step.run() }
  catch (error) { failures.push({ step: step.name, error: error instanceof Error ? error.message.slice(0, 1000) : 'unknown-cleanup-error' }) }
  try { await write(path.join(out, `${phase}-cleanup.json`), { status: failures.length ? 'failed' : 'complete', primaryFailed, failures }) }
  catch { failures.push({ step: 'cleanup-evidence', error: 'could-not-write-cleanup-evidence' }) }
  if (failures.length && !primaryFailed) throw new Error(`${phase} cleanup failed; inspect cleanup evidence`)
}
const inside = (root: string, filename: string) => {
  const relative = path.relative(path.resolve(root), path.resolve(filename))
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
const course = (snapshot: DocumentSnapshot) => {
  assert.equal(snapshot.model.kind, 'course-v10')
  return snapshot.model as Extract<DocumentSnapshot['model'], { kind: 'course-v10' }>
}
function source(model: any): string {
  assert.equal(model.kind, 'course-v10')
  const definition = model.project.definitions[SHARED_EXPERIMENT.modelDefinition]
  assert.equal(definition?.implementation?.kind, 'source', 'The shared author Source must remain the same definition')
  assert.equal(definition.title, '共享实验参数与结果结构')
  return definition.implementation.source
}
function verifyChange(before: any, after: any) {
  const original = source(before)
  assert.equal(original.split(BEFORE).length, 2, 'The exact original parameter must be unique')
  assert.equal(source(after), original.replace(BEFORE, AFTER), 'Shared Source changed outside the requested literal')
  const expected = structuredClone(before)
  expected.project.revision = after.project.revision
  expected.project.definitions[SHARED_EXPERIMENT.modelDefinition].implementation.source = original.replace(BEFORE, AFTER)
  assert.deepEqual(after, expected, 'A native human edit, other Source, binding, layout or resource changed')
  return { definitionId: SHARED_EXPERIMENT.modelDefinition, from: BEFORE, to: AFTER, wholeAuthorModelVerified: true }
}
function readResult(result: ToolResult, label: string): any {
  assert.equal(result.kind, 'read', `${label}: ${result.kind === 'error' ? `${result.code} ${result.message}` : result.kind}`)
  return (result as Extract<ToolResult, { kind: 'read' }>).data
}
function selectionFact(selection: ModelSelection) {
  assert.equal(selection.model, 'gpt-6.1-terra'); assert.equal(selection.connection.protocol, 'chatgpt-responses')
  assert.equal((selection.parameters?.reasoning as { effort?: unknown })?.effort, 'xhigh')
  return { model: selection.model, parameters: selection.parameters, protocol: selection.connection.protocol,
    connectionId: selection.connection.id, connectionRevision: selection.connection.revision }
}
async function account(config: W3SharedConsumerConfig) {
  // A previous same-process bootstrap must have initialized safeStorage in its
  // existing owner context. The fixture never logs in, copies keys or reads tokens.
  const probe = await readJson(path.join(config.out, 'credential-preflight.json'))
  assert.equal(probe.status, 'decryption-readable-token-validity-unprobed')
  assert.equal(probe.originalStartupContextRequired, true)
  assert.equal(probe.startupUserDataMatched, true)
  assert.equal(probe.credentialReadableAfterDomainSwitch, true)
  assert.equal(path.resolve(probe.credentialOwnerProfile), path.resolve(config.originalProfile))
  assert.equal(path.resolve(probe.domainProfile), path.resolve(app.getPath('userData')))
  assert.equal(path.resolve(probe.domainSessionData), path.resolve(app.getPath('sessionData')))
  const store = new ExecutionSettingsStore({ directory: path.join(config.originalProfile, 'workbench-v2/settings'),
    encryption: await createElectronCredentialEncryption() })
  const profile = (await store.read()).profile, current = await store.snapshot('conversation')
  assert.equal(current.connection.auth.kind, 'oauth')
  const selection = await store.captureDelegationSelection({ connectionId: current.connection.id, model: 'gpt-6.1-terra',
    parameters: { reasoning: { effort: 'xhigh' } } }, current)
  const scope = selectionFact(selection)
  return { store, selection, scope, unchanged: async () => assert.deepEqual((await store.read()).profile, profile,
    'Profile roles or selected model changed; normal encrypted OAuth refresh is not a profile-role change') }
}
async function inputFacts(config: W3SharedConsumerConfig) {
  const evidence = await readJson(config.handoffEvidence), bytes = await fs.readFile(config.sourceFile), sha256 = hash(bytes)
  assert.equal(evidence.sampleSha256, sha256, 'Input must be the exact successfully tested human-handoff GLX')
  for (const key of ['nativeTitle', 'nativeDescription', 'pointerLayout', 'nativeImageMenu', 'oneStepUndoRedo', 'newProcessColdOpen'])
    assert.equal(evidence.authoring?.[key], true, `Missing real manual handoff evidence: ${key}`)
  assert.equal(evidence.runtime?.firstResult, 77); assert.equal(evidence.runtime?.subsequentResult, 120)
  assert.equal(evidence.runtime?.returnPreserves, true); assert.equal(evidence.runtime?.replayResets, true)
  assert.deepEqual(evidence.runtime?.remoteRequests, []); assert.deepEqual(evidence.runtime?.errors, [])
  assert.equal(evidence.rootCount, 2)
  // The parent preserves the whole successful output together. Its JSON keeps
  // the historical test-results path; later Playwright runs may clear that path.
  const preservedOfflineHtml = path.join(path.dirname(config.handoffEvidence), path.basename(evidence.offlineHtml))
  assert.equal(hash(await fs.readFile(preservedOfflineHtml)), evidence.offlineHtmlSha256, 'Preserved manual offline artifact differs from its original evidence')
  return { sha256, evidenceSha256: hash(await fs.readFile(config.handoffEvidence)),
    replacementAssetSha256: evidence.authoring.replacementAssetSha256, offlineHtmlSha256: evidence.offlineHtmlSha256 }
}
async function zero(config: W3SharedConsumerConfig, host: ReturnType<typeof documentHost>, filename: string, input: Awaited<ReturnType<typeof inputFacts>>) {
  const access = await account(config), runId = `w3-zero-${randomUUID()}`, receipts: unknown[] = []
  const opened = await host.open(filename), baseline = plain(opened.model)
  assert.equal(source(baseline).split(BEFORE).length, 2)
  assert.equal(opened.dirty, false)
  assert(JSON.stringify(baseline.project.instances[SHARED_EXPERIMENT.title].data).includes('教师接手'))
  assert(JSON.stringify(baseline.project.instances[SHARED_EXPERIMENT.description].data).includes('请比较两种方案'))
  const imageId = baseline.project.instances[SHARED_EXPERIMENT.image].data.assetId
  assert.equal(hash(Uint8Array.from(baseline.resources.assets[imageId])), input.replacementAssetSha256)
  await host.tools.beginRun({ runId, actor: 'agent', documents: [], fileAccess: { permission: 'workspace', workspaceRoot: path.dirname(filename) } })
  const call = async (name: string, args: unknown) => {
    const callId = `zero-${receipts.length}`
    let result: ToolResult
    if (name === 'file.open') {
      const outcome = await host.agentFiles.execute({ runId, workspaceRoot: path.dirname(filename), permission: 'workspace' },
        'file.open', args, host.tools.operationIdentity(runId, callId))
      assert(outcome.opened)
      const admitted = await host.tools.completeOpenedDocument(runId, outcome.opened, { selection: 'select' })
      result = { kind: 'read', data: { ...outcome.data as object, target: admitted.target, writable: admitted.writable } }
    } else result = await host.tools.execute(runId, callId, { name, input: args })
    receipts.push({ name, input: args, result })
    await write(path.join(config.out, 'zero-tool-receipts.json'), receipts)
    return readResult(result, name)
  }
  let gate: any, primaryFailed = false
  try {
    await host.tools.describeRun(runId)
    await call('file.open', { path: path.basename(filename) })
    const skill = await call('skills.read', { skill: SKILL, path: 'SKILL.md', limit: 64_000 })
    assert.equal(skill.status, 'read'); assert.equal(skill.truncated, false)
    const guide = await call('skills.read', { skill: SKILL, path: GUIDE, limit: 64_000 })
    assert.equal(guide.status, 'read'); assert.equal(guide.truncated, false)
    for (const marker of GUIDE_MARKERS) assert(guide.content.includes(marker), `Bundled guide lacks ${marker}`)
    // Same gateway disclosure owner called by ExecutionEngine's tools.load.
    // This is zero-model plumbing evidence, not a fabricated model tool call.
    await host.tools.loadToolFamilies(runId, ['content'], ALLOWED)
    const files: any[] = []; let offset = 0
    for (;;) {
      const page = await call('project.list', { offset, limit: 1000 }); files.push(...page.files)
      if (page.nextOffset === undefined) break
      assert(page.nextOffset > offset); offset = page.nextOffset
    }
    const model = course(opened), file = componentProjectFiles(model.project, model.resources).find(item => item.kind === 'source'
      && item.binding?.kind === 'definition-source' && item.binding.definitionId === SHARED_EXPERIMENT.modelDefinition && !item.authorSource?.dependencyId)
    assert(file && files.some(item => item.path === file.path), 'The actual public listing must expose the shared Source')
    const observed = await call('project.read', { path: file.path, full: true })
    assert.equal(observed.content, source(baseline))
    const definitions = await host.tools.describeRun(runId)
    const schemas = Object.fromEntries(ALLOWED.map(name => {
      if (name === 'tools.load') return [name, loadToolsDefinition.inputSchema]
      if (name === 'file.open') return [name, agentFileTools.find(tool => tool.name === name)!.inputSchema]
      const definition = definitions.find(item => item.name === name)
      assert(definition, `Current connected catalog lacks ${name}`); return [name, definition.schema]
    }))
    assert.deepEqual(plain((await host.internalAPI.read(opened.documentId)).model), baseline)
    assert.equal(hash(await fs.readFile(filename)), input.sha256)
    await access.unchanged()
    gate = { version: VERSION, status: 'zero-pass', modelRequests: 0, input, filename, sourcePath: file.path,
      sourceModelSha256: modelHash(baseline), selection: access.scope, allowedTools: ALLOWED, schemas: canonical(schemas),
      promptSha256: hash(PROMPT), skill: { name: SKILL, path: 'SKILL.md', version: skill.version, contentSha256: hash(skill.content) },
      guide: { skill: SKILL, path: GUIDE, version: guide.version, contentSha256: hash(guide.content), markersVerified: true },
      disclosure: 'Real AgentFileService file.open/completeOpenedDocument and Gateway reads/loadToolFamilies; current Engine tools.load schema; no Provider used',
      profileRolesUnchanged: true, network: assertExperimentNetworkReady(), pid: process.pid, finishedAt: new Date().toISOString() }
    await write(path.join(config.out, 'baseline-model.json'), baseline)
    await write(path.join(config.out, 'zero-tool-receipts.json'), receipts)
  } catch (error) { primaryFailed = true; throw error }
  finally { await cleanup(config.out, 'zero', primaryFailed, [
    { name: 'gateway-stop', run: () => host.tools.stop(runId) }, { name: 'file-run-release', run: () => host.agentFiles.releaseRun(runId) },
  ]) }
  await write(path.join(config.out, 'zero-preflight.json'), gate)
  return gate
}
function guideConsumption(ended: ExecutionRunRecord, gate: any, providerFacts: any[]) {
  const reads = ended.tools.filter(tool => tool.call.name === 'skills.read' && (tool.call.input as any)?.skill === SKILL
    && (tool.call.input as any)?.path === GUIDE && tool.result?.kind === 'read')
  assert(reads.length, 'Real model did not consume the current bundled enhancement guide')
  const chunks = reads.map(tool => {
    const data = readResult(tool.result!, 'skills.read'); assert.equal(data.status, 'read')
    assert.equal(data.version, gate.guide.version); assert.equal(data.skill, SKILL); assert.equal(data.path, GUIDE)
    return { tool, data }
  })
  const text = chunks.map(chunk => chunk.data.content).join('\n')
  for (const marker of GUIDE_MARKERS) assert(text.includes(marker), `Guide read did not return ${marker}`)
  const mainReads = ended.tools.filter(tool => tool.call.name === 'skills.read' && (tool.call.input as any)?.skill === SKILL
    && ((tool.call.input as any)?.path ?? 'SKILL.md') === 'SKILL.md' && tool.result?.kind === 'read'
    && (tool.result.data as any)?.version === gate.skill.version)
  assert(mainReads.length, 'Real model did not read the same bundled SKILL.md')
  const guideCallIds = new Set(reads.map(tool => tool.providerCallId)), mainCallIds = new Set(mainReads.map(tool => tool.providerCallId))
  const sent = providerFacts.filter(fact => fact.actualModel === 'gpt-6.1-terra' && Number.isFinite(fact.timing?.fetchStartedAt))
    .flatMap(fact => (fact.skillOutputs ?? []).map((output: any) => ({ requestId: fact.requestId, ...output })))
  const guideSent = sent.filter((output: any) => guideCallIds.has(output.callId) && output.guideVersion)
  for (const marker of GUIDE_MARKERS) assert(guideSent.some((output: any) => output.markers.includes(marker)),
    `The real provider payload did not contain ${marker}; a raw unprojected receipt is insufficient`)
  assert(sent.some((output: any) => mainCallIds.has(output.callId) && output.skillVersion), 'SKILL.md version was not delivered to the real provider')
  return { reads: chunks.map(({ tool, data }) => ({ callId: tool.callId, providerCallId: tool.providerCallId, version: data.version,
    offset: (tool.call.input as any)?.offset ?? 0, contentSha256: hash(data.content), truncated: data.truncated })), deliveries: guideSent }
}
async function live(config: W3SharedConsumerConfig, host: ReturnType<typeof documentHost>, filename: string, input: Awaited<ReturnType<typeof inputFacts>>, gate: any) {
  const access = await account(config)
  assert.deepEqual(access.scope, gate.selection, 'Selection changed after the zero-model gate')
  const opened = await host.open(filename), baseline = await readJson(path.join(config.out, 'baseline-model.json'))
  assert.equal(modelHash(baseline), gate.sourceModelSha256)
  assert.deepEqual(plain(opened.model), baseline); assert.equal(hash(await fs.readFile(filename)), input.sha256)
  const marker = await fs.open(path.join(config.out, 'live-started.json'), 'wx')
  await marker.writeFile(json({ pid: process.pid, at: new Date().toISOString() })); await marker.close()
  const oauth = new OAuthDesktopService({ store: access.store, openExternal: async () => { throw new Error('No login flow in this consumer') } })
  // A reference guard delegates unchanged to production modelFetch. The shared
  // bootstrap installs the production system-proxy dispatcher, including OAuth.
  const transport = modelFetch()
  const actual = new ChatGPTResponsesProvider({ fetch: (input, init) => { assertExperimentNetworkReady(); return transport(input, init) },
    credentialResolver: async connection => {
    try { assertExperimentNetworkReady(); return await oauth.resolveCredential(connection) }
    catch (error) { await noteCredentialFailure(config.out, error, 'w3-oauth-resolver'); throw error }
  } })
  const facts: any[] = [], allowed = new Set(ALLOWED), events = new ExecutionEventStore({ directory: path.join(config.out, 'events') })
  const filtered = (request: Omit<ModelRequest, 'requestId'>) => {
    assert.deepEqual(selectionFact(request.selection), gate.selection)
    return { ...request, tools: (request.tools ?? []).filter(tool => allowed.has(tool.name)).map(tool => {
      assert.deepEqual(canonical(tool.inputSchema), gate.schemas[tool.name], `Schema changed since zero: ${tool.name}`); return tool
    }) }
  }
  const monitored = async function* (requestId: string, prepared: PreparedModelRequest, options?: ModelStreamOptions): AsyncGenerator<ModelEvent> {
    assertExperimentNetworkReady()
    const wire = JSON.parse(prepared.serialized)
    assert.equal(wire.model, 'gpt-6.1-terra'); assert.equal(wire.reasoning?.effort, 'xhigh')
    const fact: any = { requestId, enteredAt: Date.now(), selectedModel: wire.model, wireEffort: wire.reasoning.effort,
      serializedSha256: hash(prepared.serialized), tools: wire.tools?.map((tool: any) => tool.name) ?? [],
      skillOutputs: (wire.input ?? []).filter((item: any) => item.type === 'function_call_output' && typeof item.output === 'string')
        .filter((item: any) => item.output.includes(gate.guide.version) || item.output.includes(gate.skill.version))
        .map((item: any) => ({ callId: item.call_id, outputSha256: hash(item.output),
          guideVersion: item.output.includes(gate.guide.version), skillVersion: item.output.includes(gate.skill.version),
          markers: GUIDE_MARKERS.filter(marker => item.output.includes(marker)) })) }; facts.push(fact)
    try {
      for await (const event of prepared.stream(requestId, { ...options, onTiming: timing => { fact.timing = { ...timing }; options?.onTiming?.(timing) } })) {
        fact.firstEventAt ??= Date.now()
        if (event.type === 'response.started' && event.actualModel) fact.actualModel = event.actualModel
        if (event.type === 'response.completed') {
          fact.actualModel = event.actualModel ?? fact.actualModel; fact.usage = event.usage; fact.finishedAt = Date.now()
          for (const tool of event.toolCalls) assert(allowed.has(tool.name), `Out-of-scope tool ${tool.name}; stop before dispatch`)
        }
        if (event.type === 'response.failed') fact.failure = { outcome: event.failure.outcome, code: event.failure.code, kind: event.failure.kind }
        yield event
      }
    } finally { await write(path.join(config.out, 'provider-facts.json'), facts) }
  }
  const provider: ModelProvider = { retrySafety: actual.retrySafety,
    prepare(request, accounting) { const prepared = actual.prepare(filtered(request), accounting)
      return { serialized: prepared.serialized, tokens: prepared.tokens, stream: (requestId, options) => monitored(requestId, prepared, options) } },
    stream(request, options) { return monitored(request.requestId, actual.prepare(filtered(request)), options) },
  }
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider, files: host.agentFiles,
    runs: new ExecutionRunStore(path.join(config.out, 'runs')), events, edits: new EditSessionService(host.registry, host.tools),
    subscribeDocumentEvents: listener => host.subscribeEvents(listener) })
  let budgetStopped = false, primaryFailed = false, produced: any
  const budget = new AbortController()
  const routeStart = Date.now(), timer = setTimeout(() => { budgetStopped = true; budget.abort() }, config.budgetMs ?? 300_000)
  try {
    const started = await engine.start({ conversationId: `w3-${randomUUID()}`, taskId: randomUUID(), instruction: PROMPT,
      selection: access.selection, permission: 'workspace', workspaceRoot: path.dirname(filename), documents: [] }, undefined, undefined, { signal: budget.signal })
    const ended = await engine.wait(started.runId)
    await write(path.join(config.out, 'run.json'), ended)
    assert.equal(ended.status, 'completed', json(ended.failure)); assert.equal(budgetStopped, false, 'Explicit model-run budget reached')
    assert(ended.requests.length > 0 && ended.requests.every(request => request.actualModel === 'gpt-6.1-terra'), 'Missing or mismatched actual model identity')
    assert(facts.length > 0 && facts.every(fact => fact.actualModel === 'gpt-6.1-terra' && fact.wireEffort === 'xhigh'))
    const successful = (name: string) => ended.tools.some(tool => tool.call.name === name && tool.state === 'returned' && tool.result && tool.result.kind !== 'error')
    for (const name of ['file.open', 'project.list', 'project.read', 'project.apply', 'file.save']) assert(successful(name), `Real model did not complete ${name}`)
    const consumedGuide = guideConsumption(ended, gate, facts), after = await host.internalAPI.read(opened.documentId)
    assert.equal(after.dirty, false, 'The model left an unsaved draft; the fixture will not save for it')
    const change = verifyChange(baseline, plain(after.model)), savedSha256 = hash(await fs.readFile(filename))
    assert.notEqual(savedSha256, input.sha256)
    assert.equal(hash(await fs.readFile(config.sourceFile)), input.sha256, 'The original human handoff changed')
    produced = { version: VERSION, status: 'producer-verified-awaiting-cold', input, filename, change, consumedGuide,
      savedSha256, modelSha256: modelHash(after.model), selection: access.scope, actualModelConfirmed: true, promptSha256: hash(PROMPT),
      runId: ended.runId, requestRecords: ended.requests.length, toolRecords: ended.tools.length, routeStart, routeEnd: Date.now(),
      modelFetchInvocations: facts.filter(fact => Number.isFinite(fact.timing?.fetchStartedAt)).length,
      networkCountDefinition: 'Provider fetch-start observations; excludes OAuth refresh and does not assert billing or server acceptance',
      profileRolesUnchanged: true, network: assertExperimentNetworkReady(), pid: process.pid, finishedAt: new Date().toISOString() }
  } catch (error) { primaryFailed = true; throw error }
  finally {
    clearTimeout(timer)
    await cleanup(config.out, 'live', primaryFailed, [
      { name: 'engine-shutdown', run: () => engine.shutdown() }, { name: 'event-flush', run: () => events.flushPending() },
      { name: 'profile-roles-unchanged', run: () => access.unchanged() },
    ])
  }
  await write(path.join(config.out, 'producer-result.json'), produced)
  return produced
}
/** Use displayed iframe geometry only after both documents confirm the physical
 * hit. This checks trusted pointer input without force or script button.click. */
async function clickVisible(page: Page, id: string, name: string, out: string) {
  const iframe = page.locator(`[data-component-object="${id}"] iframe`), button = iframe.contentFrame().getByRole('button', { name, exact: true })
  await expect(button).toBeVisible(); await expect(button).toBeEnabled()
  const outer = await iframe.evaluate(element => { const frame = element as HTMLIFrameElement, rect = frame.getBoundingClientRect()
    return { x: rect.x, y: rect.y, sx: rect.width / frame.offsetWidth, sy: rect.height / frame.offsetHeight, left: frame.clientLeft, top: frame.clientTop } })
  const local = await button.evaluate(element => { const rect = element.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2
    const hit = element.ownerDocument.elementFromPoint(x, y); return { x, y, hit: hit === element || Boolean(hit && element.contains(hit)) } })
  const point = { x: outer.x + (outer.left + local.x) * outer.sx, y: outer.y + (outer.top + local.y) * outer.sy }
  const topHit = await iframe.evaluate((element, point) => element.ownerDocument.elementFromPoint(point.x, point.y) === element, point)
  await fs.appendFile(path.join(out, 'offline-pointer-evidence.jsonl'), JSON.stringify({ id, name, outer, local, point, topHit }) + '\n')
  assert(local.hit && topHit, 'Visible action is obstructed; do not force the test through it')
  await page.mouse.click(point.x, point.y)
}
async function cold(config: W3SharedConsumerConfig, host: ReturnType<typeof documentHost>, filename: string, gate: any) {
  const producer = await readJson(path.join(config.out, 'producer-result.json'))
  assert.equal(producer.status, 'producer-verified-awaiting-cold'); assert.notEqual(producer.pid, process.pid, 'Cold verification requires a fresh process')
  assert.equal(hash(await fs.readFile(filename)), producer.savedSha256)
  const opened = await host.open(filename), model = course(opened)
  assert.equal(opened.dirty, false); assert.equal(modelHash(model), producer.modelSha256)
  verifyChange(await readJson(path.join(config.out, 'baseline-model.json')), plain(model))
  const published = await buildPublishedCourseV3({ project: model.project, assetBytes: model.resources.assets, componentFiles: model.resources.components },
    { compilation: host.compilation, singleHtmlMode: 'offline-portable' })
  assert.deepEqual(published.diagnostics.filter(item => item.code !== 'source-compile-warning'), []); assert.equal(published.offlineComplete, true)
  const bundled = await build({ stdin: { contents: 'export * from "./src/player/componentPlatform/entry"', resolveDir: config.root }, bundle: true,
    platform: 'browser', format: 'iife', globalName: 'CoursewarePlayer', write: false, loader: { '.css': 'empty' }, logLevel: 'silent' })
  const html = path.join(config.out, 'ai-handoff-offline.html')
  await fs.writeFile(html, buildComponentSingleHtml(published.payload, bundled.outputFiles[0]!.text))
  const browser = await chromium.launch(), remoteRequests: string[] = [], errors: string[] = []
  let context: BrowserContext | undefined, screenshotPage: Page | undefined, resultFact: any, primaryFailed = false
  try {
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, offline: true })
    const page = await context.newPage(); screenshotPage = page
    page.setDefaultTimeout(15_000); page.setDefaultNavigationTimeout(20_000)
    page.on('request', request => { if (/^https?:/i.test(request.url())) remoteRequests.push(request.url()) })
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(pathToFileURL(html).href)
    await page.waitForFunction(() => Boolean((window as any).coursePlayer || (window as any).__coursePlaybackFailed), undefined, { timeout: 20_000 })
    assert.equal(await page.evaluate(() => (window as any).__coursePlaybackFailed ?? false), false)
    const experiment = page.locator(`[data-component-object="${SHARED_EXPERIMENT.experiment}"] iframe`).contentFrame()
    const result = page.locator(`[data-component-object="${SHARED_EXPERIMENT.result}"] iframe`).contentFrame()
    await expect(page.locator(`[data-component-object="${SHARED_EXPERIMENT.title}"]`)).toContainText('教师接手')
    assert.equal(await page.evaluate(id => (window as any).coursePlayer.go(id), SHARED_EXPERIMENT.resultScene), false)
    const slider = experiment.getByRole('slider', { name: '海水比例' }); await expect(slider).toHaveValue('35')
    await slider.focus(); await slider.press('Home'); for (let i = 0; i < 20; i++) await slider.press('ArrowRight')
    await clickVisible(page, SHARED_EXPERIMENT.experiment, '运行实验', config.out)
    await expect(experiment.locator('[data-result]')).toContainText('能量比较指数 90')
    await clickVisible(page, SHARED_EXPERIMENT.experiment, '查看相邻结论', config.out)
    await expect(result.locator('[data-energy]')).toHaveText('90')
    await expect(result.locator('[data-trial]')).toHaveText('第 1 次实验的真实结果')
    await page.screenshot({ path: path.join(config.out, 'ai-handoff-offline.png') })
    await clickVisible(page, SHARED_EXPERIMENT.result, '返回实验', config.out); await expect(slider).toHaveValue('20')
    await clickVisible(page, SHARED_EXPERIMENT.experiment, '重播本幕', config.out); await expect(slider).toHaveValue('35')
    assert.equal(await page.evaluate(key => (window as any).coursePlayer.runtime.getState(key), SHARED_EXPERIMENT.resultKey), null)
    assert.equal(await page.evaluate(id => (window as any).coursePlayer.go(id), SHARED_EXPERIMENT.resultScene), false)
    assert.deepEqual(remoteRequests, []); assert.deepEqual(errors, [])
    assert.equal(hash(await fs.readFile(filename)), producer.savedSha256)
    assert.equal(hash(await fs.readFile(config.sourceFile)), gate.input.sha256)
    resultFact = { ...producer, status: 'qualified', independentColdOpen: true, coldPid: process.pid,
      offline: { html, htmlSha256: hash(await fs.readFile(html)), savedFileSha256: producer.savedSha256, sharedResult: 90,
        guardBeforeComplete: 'blocked', returnPreserves: true, replayResets: true, remoteRequests, errors },
      finishedAt: new Date().toISOString() }
  } catch (error) {
    primaryFailed = true
    await write(path.join(config.out, 'offline-failure.json'), { error: String(error), remoteRequests, errors }).catch(() => undefined)
    await screenshotPage?.screenshot({ path: path.join(config.out, 'offline-failure.png'), timeout: 5_000 }).catch(() => undefined)
    throw error
  } finally { await cleanup(config.out, 'cold', primaryFailed, [
    { name: 'offline-context-close', run: () => context?.close() }, { name: 'offline-browser-close', run: () => browser.close() },
  ]) }
  await write(path.join(config.out, 'result.json'), resultFact)
  return resultFact
}

async function runW3EditableSharedConsumer(config: W3SharedConsumerConfig) {
  await app.whenReady()
  for (const key of ['root', 'out', 'originalProfile', 'sourceFile', 'handoffEvidence'] as const)
    assert(path.isAbsolute(config[key]), `${key} must be absolute`)
  assert(['zero', 'live', 'cold'].includes(config.phase)); assert(!inside(config.originalProfile, config.out))
  assert.equal(path.resolve(app.getAppPath()), path.resolve(config.root), 'Bootstrap must keep the production app/reference root before installing bundled Skills')
  assert(inside(config.out, app.getPath('userData')) && inside(config.out, app.getPath('sessionData')), 'Domain storage must be isolated after the existing crypto-owner bootstrap')
  assert(Number.isSafeInteger(config.budgetMs ?? 300_000) && (config.budgetMs ?? 300_000) > 0 && (config.budgetMs ?? 300_000) <= 600_000)
  await fs.mkdir(config.out, { recursive: true })
  if (config.phase !== 'cold') assertExperimentNetworkReady()
  const input = await inputFacts(config), workspace = path.join(config.out, 'workspace'), filename = path.join(workspace, 'editable-shared-handoff.glx')
  assert.notEqual(path.resolve(filename), path.resolve(config.sourceFile))
  if (config.phase === 'zero') {
    await fs.mkdir(workspace, { recursive: true })
    try { await fs.copyFile(config.sourceFile, filename, constants.COPYFILE_EXCL) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; assert.equal(hash(await fs.readFile(filename)), input.sha256) }
  }
  if (config.phase !== 'cold') installWorkbenchToolServices({ getMainWindow: () => null,
    getRendererEntryUrl: () => pathToFileURL(path.join(config.root, 'dist-renderer/index.html')).href, headless: true })
  const host = documentHost()
  if (config.phase === 'zero') return zero(config, host, filename, input)
  const gate = await readJson(path.join(config.out, 'zero-preflight.json'))
  assert.deepEqual({ version: gate.version, status: gate.status, input: gate.input, promptSha256: gate.promptSha256 },
    { version: VERSION, status: 'zero-pass', input, promptSha256: hash(PROMPT) }, 'Exact current input and prompt must pass zero first')
  return config.phase === 'live' ? live(config, host, filename, input, gate) : cold(config, host, filename, gate)
}
export async function executeW3EditableSharedConsumer(config: W3SharedConsumerConfig) {
  try { return await runW3EditableSharedConsumer(config) }
  catch (error) {
    if (path.isAbsolute(config.out) && !inside(config.originalProfile, config.out)) {
      const value = error as { name?: unknown; code?: unknown; message?: unknown }
      await write(path.join(config.out, 'failure.json'), { phase: config.phase,
        name: typeof value?.name === 'string' ? value.name : 'unknown',
        code: typeof value?.code === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value.code) ? value.code : null,
        // Assertion explanations concern this fixed sample. Provider/credential
        // errors retain their existing sanitized owner diagnostics instead.
        assertion: value?.name === 'AssertionError' && typeof value.message === 'string' ? value.message.slice(0, 3000) : null,
        at: new Date().toISOString() }).catch(() => undefined)
    }
    throw error
  }
}
export async function installW3EditableSharedConsumer(config: W3SharedConsumerConfig) {
  await app.whenReady(); app.on('window-all-closed', () => undefined)
  ;(globalThis as { __w3EditableSharedConsumer?: () => Promise<unknown> }).__w3EditableSharedConsumer = () => executeW3EditableSharedConsumer(config)
}
