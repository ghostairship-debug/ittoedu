/** Opt-in real built-in AI consumer of the successful original-work human handoff. Import/zero preparation makes no model request.
 * Run zero, live and cold in separate Electron processes after the existing
 * original-owner crypto bootstrap switches domain storage to this output root. */
import assert from 'node:assert/strict'
import { app, nativeImage } from 'electron'
import { constants, promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { chromium, expect, type BrowserContext, type Page } from '@playwright/test'
import { documentHost } from '../../src/main/workbench/documentHost'
import { installWorkbenchToolServices, disposeHeadlessWorkbenchWorkers } from '../../src/main/workbench/workbenchToolServices'
import { resolveRendererEntryUrl } from '../../src/main/rendererEntry'
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
import { OASIS_04_SHA256, OASIS_HANDOFF_DESCRIPTION, OASIS_HANDOFF_TEACHER_NOTE } from '../fixtures/creation/repairOasisAuthorHandoff'
import { noteCredentialFailure } from './delegationDirectoryConsumer20261030.node'
import { assertExperimentNetworkReady } from './experimentOwnerBootstrap20261031.node'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import type { ToolResult } from '../../src/shared/workbench/tools'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection, ModelStreamOptions, PreparedModelRequest } from '../../src/shared/workbench/modelProvider'

export interface OasisAuthorHandoffAIConfig {
  root: string; out: string; originalProfile: string; sourceFile: string; handoffEvidence: string
  phase: 'zero' | 'live' | 'cold'; budgetMs?: number
}
const VERSION = 'oasis-original-author-handoff-ai-20261031-v1'
const SKILL = 'orchestrate-courseware', GUIDE = 'references/teacher-controller.md'
const GUIDE_MARKERS = ['局部增强的最短路径', 'project.apply', 'enhancementPath']
const EDITS = [{ old: 'advance(); schedule(); }, 2200);', new: 'advance(); schedule(); }, 3000);' },
  { old: '约每2秒推进一个。', new: '约每3秒推进一个。' }] as const
const ALLOWED = ['skills.list', 'skills.read', 'file.open', 'tools.load', 'project.list', 'project.read', 'project.apply', 'file.save']
const PROMPT = '请接手当前工作空间中的 oasis-human-handoff.glx。先实际调用 skills.read 读取当前内置 orchestrate-courseware 的 SKILL.md 和 references/teacher-controller.md，不能用源码或用户副本代替。'
  + '通过正式 file.open、project.list/read 找到 intro.js。只把第一幕自动下潜推进由 2200 毫秒改为 3000 毫秒，并把该说明中“约每2秒推进一个。”改为“约每3秒推进一个。”。'
  + '必须在同一次 project.apply 中使用这两处精确 edits：advance(); schedule(); }, 2200); → advance(); schedule(); }, 3000);，以及约每2秒推进一个。 → 约每3秒推进一个。若目标不唯一或旧值不符，停止并说明。'
  + '完整保留教师新增文字、替换图片、局部布局、instance.authoring、现有 SVG 图片渐变、所有资源、其余七模块、五截面、档案封存和章节解锁。'
  + '不重建页面，不更换素材，不委派，不调用其他模型，不联网，不运行 shell，不导出。最后必须通过 file.save 正式保存此副本，核实回执，报告实际路径和唯一逻辑调整。'
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
function originalRoot(model: any) {
  assert.equal(model.kind, 'course-v10'); assert.equal(model.project.rootIds.length, 1)
  const id = model.project.rootIds[0]
  assert.equal(model.project.entry.rootInstanceId, id); assert.equal(Object.keys(model.project.instances).length, 1)
  return model.project.instances[id]
}
function source(model: any): string {
  const instance = originalRoot(model)
  assert.equal(Object.keys(instance.data.modules).length, 8)
  assert.equal(typeof instance.data.modules['intro.js'], 'string')
  return instance.data.modules['intro.js']
}
function replaceLogic(original: string): string {
  let next = original
  for (const edit of EDITS) { assert.equal(next.split(edit.old).length, 2, `The intended logic anchor must occur exactly once: ${edit.old}`); next = next.replace(edit.old, edit.new) }
  return next
}
function verifyChange(before: any, after: any) {
  const changed = replaceLogic(source(before)), expected = structuredClone(before)
  expected.project.revision = after.project.revision; originalRoot(expected).data.modules['intro.js'] = changed
  assert.equal(source(after), changed, 'Intro changed outside the two requested literals')
  assert.deepEqual(after, expected, 'Human authoring, another module, resources, definition or work structure changed')
  return { module: 'intro.js', edits: EDITS, rootId: before.project.rootIds[0], exactAuthoringPreserved: true,
    otherSevenModulesPreserved: true, allResourceBytesPreserved: true, wholeAuthorModelVerified: true }
}
function resourceDigests(model: any) {
  const digest = (bytes: any) => ({ bytes: bytes.length ?? bytes.byteLength, sha256: hash(Uint8Array.from(bytes)) })
  return { assets: Object.fromEntries(Object.entries(model.resources.assets).map(([id, bytes]) => [id, digest(bytes)])),
    components: Object.fromEntries(Object.entries(model.resources.components).map(([id, files]) => [id,
      Object.fromEntries(Object.entries(files as object).map(([name, bytes]) => [name, digest(bytes)]))])) }
}
function humanFacts(model: any, input: Awaited<ReturnType<typeof inputFacts>>) {
  const instance = originalRoot(model), records = instance.authoring?.records
  assert(records && Object.keys(records).length === 2)
  assert.equal(instance.id, input.rootId)
  const text = records[input.humanTextKey], picture = records[input.humanImageKey]
  assert.equal(text?.kind, 'text'); assert.equal(text.binding.baseline, OASIS_HANDOFF_DESCRIPTION)
  assert.equal(text.overrides.text, OASIS_HANDOFF_DESCRIPTION + OASIS_HANDOFF_TEACHER_NOTE)
  assert(text.overrides.geometry && Math.abs(text.overrides.geometry.translateX ?? 0) + Math.abs(text.overrides.geometry.translateY ?? 0) > 0)
  assert.equal(picture?.kind, 'image'); assert.equal(typeof picture.overrides.src, 'string')
  assert(Object.entries(picture.scope ?? {}).some(([key, value]) => key.endsWith('data-scene-state') && value === 'power'))
  const assetId = instance.authoring.resourceBindings[picture.overrides.src]
  assert.equal(hash(Uint8Array.from(model.resources.assets[assetId])), input.replacementSha256)
  assert(source(model).includes('oasis-intro-scene-shade') && source(model).includes('data-scene-key="intro-illustration"'))
  return { textKey: input.humanTextKey, imageKey: input.humanImageKey, assetId, geometry: text.overrides.geometry }
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
async function account(config: OasisAuthorHandoffAIConfig) {
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
async function inputFacts(config: OasisAuthorHandoffAIConfig) {
  const evidence = await readJson(config.handoffEvidence), bytes = await fs.readFile(config.sourceFile), sha256 = hash(bytes)
  assert.equal(evidence.status, 'zero-model-human-handoff-passed', 'Only a completed real original-work App consumer may enter AI')
  assert.equal(evidence.modelRequests, 0); assert.equal(evidence.originalHash, OASIS_04_SHA256)
  assert.equal(evidence.handoff?.sha256, sha256); assert.equal(path.resolve(evidence.handoff.document), path.resolve(config.sourceFile))
  for (const key of ['originalUnchanged', 'fullBuiltApp', 'realTextInput', 'realPictureImport', 'realPointerGeometry', 'geometryUndoRedo',
    'realSceneRemount', 'formalSaveShortcut', 'independentProcessColdOpen', 'completeAppColdRender', 'exactModulesPreservedDuringHumanEdits', 'originalResourcesPreserved'])
    assert.equal(evidence[key], true, `Missing actual original-work consumer evidence: ${key}`)
  assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.remoteRequests, [])
  const humanFile = path.join(path.dirname(config.handoffEvidence), 'handoff-before-ai.json')
  const requested = await readJson(path.join(path.dirname(config.handoffEvidence), 'ai-handoff-request.json'))
  assert.equal(requested.status, 'ready-for-real-built-in-ai'); assert.equal(requested.sha256, sha256)
  assert.deepEqual(requested.expectedEdits, EDITS)
  assert.equal(requested.requiredModel, 'gpt-6.1-terra'); assert.equal(requested.requiredReasoning, 'xhigh')
  assert.equal(hash(await fs.readFile(evidence.original)), OASIS_04_SHA256, 'The accepted 04 artifact must still be unchanged')
  return { sha256, evidenceSha256: hash(await fs.readFile(config.handoffEvidence)), humanFile, humanSnapshotSha256: hash(await fs.readFile(humanFile)),
    rootId: evidence.rootId, projectId: evidence.projectId, original: evidence.original, originalHash: evidence.originalHash,
    humanTextKey: requested.humanTextKey, humanImageKey: requested.humanImageKey, replacementSha256: evidence.importedBytesFromExistingWork,
    modulePath: requested.modulePath }
}
async function zero(config: OasisAuthorHandoffAIConfig, host: ReturnType<typeof documentHost>, filename: string, input: Awaited<ReturnType<typeof inputFacts>>) {
  const access = await account(config), runId = `oasis-handoff-zero-${randomUUID()}`, receipts: unknown[] = []
  const opened = await host.open(filename), baseline = plain(opened.model)
  replaceLogic(source(baseline)); assert.equal(opened.dirty, false)
  humanFacts(baseline, input)
  const human = await readJson(input.humanFile)
  assert.deepEqual(baseline.project, human.project); assert.deepEqual(resourceDigests(baseline), human.resources)
  assert.equal(baseline.project.id, input.projectId)

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
    const model = course(opened), file = componentProjectFiles(model.project, model.resources).find(item => item.webModule?.path === 'intro.js'
      && item.target?.kind === 'instance' && item.target.instanceId === input.rootId)
    assert(file && files.some(item => item.path === file.path), 'The actual public listing must expose this original author module')
    assert.equal(file.path, input.modulePath)

    // `full` requests the whole source but does not bypass the production
    // delivery budget. Continue the same captured version through nextOffset;
    // a final nonzero-offset page has complete:false and hasMore:false.
    const sourcePages: any[] = []
    let observedSource = '', sourceOffset = 0, sourceVersion: unknown
    for (;;) {
      const observed = await call('project.read', { path: file.path, full: true, ...(sourceOffset ? { offset: sourceOffset } : {}) })
      assert.equal(observed.path, file.path); assert.equal(typeof observed.content, 'string')
      assert.equal(observed.offset ?? 0, sourceOffset); assert.equal(typeof observed.hasMore, 'boolean')
      const version = { documentId: observed.documentId, epoch: observed.epoch, revision: observed.revision }
      if (sourceVersion === undefined) sourceVersion = version
      else assert.deepEqual(version, sourceVersion, 'Source continuation changed its captured document/version')
      assert.equal(observed.basis, sourceOffset ? 'captured' : 'current')
      if (observed.total !== undefined) assert.equal(observed.total, source(baseline).length)
      observedSource += observed.content
      sourcePages.push({ ...version, offset: sourceOffset, characters: observed.content.length,
        complete: observed.complete, hasMore: observed.hasMore, basis: observed.basis,
        ...(observed.nextOffset === undefined ? {} : { nextOffset: observed.nextOffset }) })
      if (!observed.hasMore) { assert.equal(observed.nextOffset, undefined); break }
      assert(Number.isSafeInteger(observed.nextOffset) && observed.nextOffset > sourceOffset)
      assert.equal(observed.nextOffset, sourceOffset + observed.content.length, 'Source continuation must not skip or repeat characters')
      sourceOffset = observed.nextOffset
    }
    assert.equal(observedSource, source(baseline), 'All formal source pages must exactly equal the successful human handoff module')
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
      sourceModelSha256: modelHash(baseline), sourceRead: { contentSha256: hash(observedSource), pages: sourcePages },
      selection: access.scope, allowedTools: ALLOWED, schemas: canonical(schemas),
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
async function live(config: OasisAuthorHandoffAIConfig, host: ReturnType<typeof documentHost>, filename: string, input: Awaited<ReturnType<typeof inputFacts>>, gate: any) {
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
    catch (error) { await noteCredentialFailure(config.out, error, 'oasis-handoff-oauth-resolver'); throw error }
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
    const started = await engine.start({ conversationId: `oasis-handoff-${randomUUID()}`, taskId: randomUUID(), instruction: PROMPT,
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
    const change = verifyChange(baseline, plain(after.model)), modelSavedSha256 = hash(await fs.readFile(filename))
    humanFacts(plain(after.model), input)
    assert.notEqual(modelSavedSha256, input.sha256)
    assert.equal(after.undoDepth, opened.undoDepth + 1, 'The two literals must be one formal source History entry')
    assert.equal(ended.tools.filter(tool => tool.call.name === 'project.apply' && tool.result?.kind === 'read'
      && (tool.result.data as any).commit === 'committed').length, 1)
    await fs.writeFile(path.join(config.out, 'ai-saved-before-history.glx'), await fs.readFile(filename), { flag: 'wx' })
    // The model has already saved successfully. A separately recorded formal
    // human History round-trip proves preservation; its revision is not passed
    // off as the model's own save or model-produced file hash.
    let history = after
    const undo = await host.internalAPI.dispatch({ documentId: history.documentId, epoch: history.epoch, baseRevision: history.revision,
      actor: 'human', operationId: `oasis-ai-undo-${randomUUID()}`, mutation: { type: 'undo' } })
    assert.equal(undo.status, 'applied'); history = await host.internalAPI.read(opened.documentId)
    const expectedHuman = structuredClone(baseline); expectedHuman.project.revision = course(history).project.revision
    assert.deepEqual(plain(history.model), expectedHuman, 'Undo must return to the exact human handoff')
    const redo = await host.internalAPI.dispatch({ documentId: history.documentId, epoch: history.epoch, baseRevision: history.revision,
      actor: 'human', operationId: `oasis-ai-redo-${randomUUID()}`, mutation: { type: 'redo' } })
    assert.equal(redo.status, 'applied'); history = await host.internalAPI.read(opened.documentId)
    verifyChange(baseline, plain(history.model)); humanFacts(plain(history.model), input)
    await host.internalAPI.save(opened.documentId, filename)
    const verified = await host.internalAPI.read(opened.documentId), savedSha256 = hash(await fs.readFile(filename))
    assert.equal(verified.dirty, false)
    assert.equal(hash(await fs.readFile(config.sourceFile)), input.sha256, 'The original human handoff changed')
    assert.equal(hash(await fs.readFile(input.original)), OASIS_04_SHA256)

    produced = { version: VERSION, status: 'producer-verified-awaiting-cold', input, filename, change, consumedGuide,
      savedSha256, modelSavedSha256, modelSavedBeforeHistory: true, formalUndoRedo: true, fixtureSavedAfterHistory: true,
      modelSha256: modelHash(verified.model), selection: access.scope, actualModelConfirmed: true, promptSha256: hash(PROMPT),
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
      { name: 'worker-dispose', run: disposeHeadlessWorkbenchWorkers },
    ])
  }
  await write(path.join(config.out, 'producer-result.json'), produced)
  return produced
}
async function readOfflineProgress(page: Page, workId: string): Promise<any> {
  return page.evaluate(async id => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('guoling-learning-progress-v1', 1)
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    try {
      const location = new URL(window.location.href); location.hash = ''; location.search = ''
      return await new Promise((resolve, reject) => {
        const request = database.transaction('snapshots', 'readonly').objectStore('snapshots')
          .get(JSON.stringify([location.href, id, 'glimmer.unlit-oasis.save.v1']))
        request.onsuccess = () => resolve(request.result?.value); request.onerror = () => reject(request.error)
      })
    } finally { database.close() }
  }, workId)
}

async function cold(config: OasisAuthorHandoffAIConfig, host: ReturnType<typeof documentHost>, filename: string, gate: any) {
  const producer = await readJson(path.join(config.out, 'producer-result.json'))
  assert.equal(producer.status, 'producer-verified-awaiting-cold'); assert.notEqual(producer.pid, process.pid, 'Use a fresh Electron process for cold verification')
  assert.equal(hash(await fs.readFile(filename)), producer.savedSha256)
  const opened = await host.open(filename), model = course(opened), baseline = await readJson(path.join(config.out, 'baseline-model.json'))
  assert.equal(opened.dirty, false); assert.equal(modelHash(model), producer.modelSha256)
  verifyChange(baseline, plain(model)); const manual = humanFacts(plain(model), gate.input)
  const runId = `oasis-handoff-export-${randomUUID()}`, exportPath = path.join(config.out, 'oasis-human-ai-offline.html')
  await host.tools.beginRun({ runId, actor: 'human', documents: [], fileAccess: { permission: 'workspace', workspaceRoot: config.out } })
  const remoteRequests: string[] = [], errors: string[] = [], checkpoints: unknown[] = []
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined, context: BrowserContext | undefined
  let screenshotPage: Page | undefined, resultFact: any, primaryFailed = false
  try {
    const callId = 'cold-open-for-formal-export'
    const outcome = await host.agentFiles.execute({ runId, workspaceRoot: config.out, permission: 'workspace' },
      'file.open', { path: filename }, host.tools.operationIdentity(runId, callId))
    assert(outcome.opened)
    const admitted = await host.tools.completeOpenedDocument(runId, outcome.opened, { selection: 'select' })
    await host.tools.describeRun(runId); await host.tools.loadToolFamilies(runId, ['build'], ['document.export'])
    const exportReceipt = await host.tools.execute(runId, 'export-original-human-ai-copy', { name: 'document.export',
      input: { target: admitted.target, format: 'html-offline', destination: exportPath } })
    await write(path.join(config.out, 'formal-export-receipt.json'), exportReceipt)
    const exported = readResult(exportReceipt, 'document.export')
    assert.equal(exported.status, 'written'); assert.equal(path.resolve(exported.path), path.resolve(exportPath))
    assert((await fs.stat(exportPath)).isFile())
    browser = await chromium.launch()
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, offline: true, reducedMotion: 'no-preference' })
    const page = await context.newPage(); screenshotPage = page
    page.setDefaultTimeout(15_000); page.setDefaultNavigationTimeout(20_000)
    page.on('request', request => { if (/^https?:/i.test(request.url())) remoteRequests.push(request.url()) })
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(pathToFileURL(exportPath).href)
    const content = page.frameLocator('iframe').first()
    await expect(content.locator('#start-button')).toBeEnabled({ timeout: 25_000 })
    await content.locator('#start-button').click()
    const description = content.locator('.og-intro .panel .stack > p.muted')
    await expect(description).toHaveText(OASIS_HANDOFF_DESCRIPTION + OASIS_HANDOFF_TEACHER_NOTE)
    const image = content.locator('[data-scene-key="intro-illustration"]')
    const imagePixels = async () => {
      const comparison = await image.evaluate(async element => {
        const encode = async (image: HTMLImageElement | null) => {
          if (!image) throw new Error('Missing original-work picture')
          await image.decode()
          const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
          const context = canvas.getContext('2d'); if (!context || !canvas.width || !canvas.height) throw new Error('Decoded picture is unavailable')
          context.drawImage(image, 0, 0)
          return { png: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, src: image.currentSrc || image.src }
        }
        return { actual: await encode(element as HTMLImageElement), reference: await encode(document.querySelector<HTMLImageElement>('#asset-descent')),
          filter: getComputedStyle(element).filter, objectFit: getComputedStyle(element).objectFit }
      })
      const decode = ({ png, ...metadata }: typeof comparison.actual) => ({ ...metadata, decodedPngSha256: hash(Buffer.from(png.slice(png.indexOf(',') + 1), 'base64')) })
      return { actual: decode(comparison.actual), reference: decode(comparison.reference), filter: comparison.filter, objectFit: comparison.objectFit }
    }
    const pixels = await imagePixels()
    assert.equal(pixels.actual.decodedPngSha256, pixels.reference.decodedPngSha256, 'Offline image must retain the real human picture')
    assert(pixels.filter.includes('oasis-intro-scene-shade')); assert.equal(pixels.objectFit, 'cover')
    const geometry = await description.evaluate(element => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect()
      return { translate: style.translate, transform: style.transform, rect: rect.toJSON() }
    })
    const translated = geometry.translate.split(/\s+/).map(value => parseFloat(value))
    assert.equal(translated[0], manual.geometry.translateX); assert.equal(translated[1], manual.geometry.translateY)
    const scenePng = await image.screenshot({ path: path.join(config.out, 'offline-human-picture.png') })
    const raster = nativeImage.createFromBuffer(scenePng); assert(!raster.isEmpty())
    await page.screenshot({ path: path.join(config.out, 'offline-human-first-act.png') })
    const pictureVisual = { file: 'offline-human-picture.png', sha256: hash(scenePng), size: raster.getSize(),
      decodedImageIdentity: pixels, cssGeometry: geometry, judgment: 'Actual filtered screenshot saved for visual review; pixels are not a subjective visual-quality score' }
    await expect(content.locator('#next-button')).toBeDisabled()
    await expect(content.locator('#route-list button').nth(1)).toBeDisabled()

    // Read-only event/mutation timestamps measure the actual new timer. No fake
    // clock, program state injection or direct mount/navigation call is used.
    await content.locator('body').evaluate(() => {
      const trace = { powerAt: null as number | null, firstStepAt: null as number | null }
      ;(window as any).__oasisHandoffTiming = trace
      document.addEventListener('click', event => {
        if ((event.target as Element | null)?.closest('[data-action="power"]')) trace.powerAt = performance.now()
      }, { capture: true, once: true })
      const observer = new MutationObserver(() => {
        if (trace.powerAt !== null && trace.firstStepAt === null && /^200\s*m$/.test(document.querySelector('.og-intro .depth')?.textContent?.trim() ?? '')) {
          trace.firstStepAt = performance.now(); observer.disconnect()
        }
      })
      observer.observe(document.getElementById('module-host')!, { subtree: true, childList: true, characterData: true })
    })
    await content.locator('[data-action="power"]').click()
    await expect(content.locator('.og-intro .panel')).toContainText('约每3秒推进一个。')
    await expect(content.locator('[data-action="pause"]')).toHaveText('暂停推进')
    await expect(content.locator('.og-intro .depth')).toHaveText(/200\s*m/, { timeout: 8_000 })
    const timing = await content.locator('body').evaluate(() => (window as any).__oasisHandoffTiming)
    assert(Number.isFinite(timing.powerAt) && Number.isFinite(timing.firstStepAt))
    const firstStepMs = timing.firstStepAt - timing.powerAt
    assert(firstStepMs >= 2800 && firstStepMs < 8000, `The actual first automatic step must consume the new 3000 ms timer, observed ${firstStepMs}`)
    await content.locator('[data-action="step"]').click()
    await expect(content.locator('.og-intro .depth')).toHaveText(/1000\s*m/)
    await expect(image).toHaveAttribute('data-scene-state', 'descent')
    const descentPixels = await imagePixels()
    assert.notEqual(descentPixels.actual.decodedPngSha256, pixels.reference.decodedPngSha256,
      'The power-screen picture override must not replace the later seabed image')
    await content.locator('[data-action="skip"]').click()
    await expect(content.locator('#module-host')).not.toContainText(OASIS_HANDOFF_TEACHER_NOTE.trim())
    for (const [index, choice] of ['fact', 'inference', 'open'].entries()) {
      await content.locator(`[data-action="record-${index}"]`).click()
      await content.locator(`[data-action="class-${choice}"]`).click()
    }
    await content.locator('[data-action="seal"]').click(); await expect(content.locator('#next-button')).toBeEnabled()
    await expect(content.locator('#save-indicator')).toHaveText('已在本设备保存')
    const sealed = await readOfflineProgress(page, model.project.id)
    assert.equal(sealed.modules.intro.initialRecords.length, 3); assert(sealed.completed.intro)
    checkpoints.push({ name: 'intro-sealed', saved: sealed })
    await content.locator('#next-button').click()
    await expect(content.locator('#stage-heading')).toContainText('让微光号停下来')
    await expect(content.locator('#route-list button').nth(1)).toHaveAttribute('aria-current', 'step')
    await content.locator('#route-list button').nth(0).click()
    await expect(content.locator('#next-button')).toBeEnabled()
    await expect(content.locator('#save-indicator')).toHaveText('已在本设备保存')
    const returned = await readOfflineProgress(page, model.project.id)
    assert.deepEqual(returned.modules.intro.initialRecords, sealed.modules.intro.initialRecords)
    assert.deepEqual(returned.completed.intro, sealed.completed.intro)
    checkpoints.push({ name: 'adjacent-act-round-trip', saved: returned })
    await page.screenshot({ path: path.join(config.out, 'offline-adjacent-edge-returned.png') })
    await page.reload(); await expect(content.locator('#continue-button')).toBeEnabled({ timeout: 25_000 })
    await content.locator('#continue-button').click(); await expect(content.locator('#next-button')).toBeEnabled()
    const restored = await readOfflineProgress(page, model.project.id)
    assert.deepEqual(restored.modules.intro.initialRecords, sealed.modules.intro.initialRecords)
    checkpoints.push({ name: 'offline-page-reload', saved: restored })
    await content.locator('#pause-button').click(); await content.locator('#return-home-button').click()
    await content.locator('#start-button').click(); await content.locator('#confirm-restart-button').click()
    await expect(description).toHaveText(OASIS_HANDOFF_DESCRIPTION + OASIS_HANDOFF_TEACHER_NOTE)
    const restartedPixels = await imagePixels()
    assert.equal(restartedPixels.actual.decodedPngSha256, pixels.reference.decodedPngSha256)
    const restartedTranslate = await description.evaluate(element => getComputedStyle(element).translate)
    assert.equal(restartedTranslate, geometry.translate)
    await expect(content.locator('#next-button')).toBeDisabled()
    await page.screenshot({ path: path.join(config.out, 'offline-reset-retains-human-authoring.png') })
    await write(path.join(config.out, 'offline-checkpoints.json'), checkpoints)
    assert.deepEqual(remoteRequests, []); assert.deepEqual(errors, [])
    assert.equal(hash(await fs.readFile(filename)), producer.savedSha256)
    assert.equal(hash(await fs.readFile(config.sourceFile)), gate.input.sha256)
    assert.equal(hash(await fs.readFile(gate.input.original)), OASIS_04_SHA256)
    resultFact = { ...producer, status: 'qualified', independentColdOpen: true, coldPid: process.pid,
      offline: { html: exportPath, htmlSha256: hash(await fs.readFile(exportPath)), formalExport: exported,
        humanTextPreserved: true, humanImageDecodedPixelsPreserved: true, humanGeometryPreserved: true,
        sceneScopedPicture: true, firstAutomaticStepMs: firstStepMs, requestedTimerMs: 3000,
        blockedBeforeComplete: true, firstActRealCompletion: true, adjacentActRoundTrip: true, restoreRetainsEvidence: true,
        restartRetainsHumanAuthoring: true, pictureVisual, remoteRequests, errors },
      finishedAt: new Date().toISOString() }
  } catch (error) {
    primaryFailed = true
    await write(path.join(config.out, 'offline-failure.json'), { error: String(error).slice(0, 3000), remoteRequests, errors, checkpoints }).catch(() => undefined)
    await screenshotPage?.screenshot({ path: path.join(config.out, 'offline-failure.png'), timeout: 5_000 }).catch(() => undefined)
    throw error
  } finally { await cleanup(config.out, 'cold', primaryFailed, [
    { name: 'offline-context-close', run: () => context?.close() }, { name: 'offline-browser-close', run: () => browser?.close() },
    { name: 'worker-dispose', run: disposeHeadlessWorkbenchWorkers }, { name: 'gateway-stop', run: () => host.tools.stop(runId) },
    { name: 'file-run-release', run: () => host.agentFiles.releaseRun(runId) },
  ]) }
  await write(path.join(config.out, 'result.json'), resultFact)
  return resultFact
}

async function runOasisAuthorHandoffAI(config: OasisAuthorHandoffAIConfig) {
  await app.whenReady()
  for (const key of ['root', 'out', 'originalProfile', 'sourceFile', 'handoffEvidence'] as const)
    assert(path.isAbsolute(config[key]), `${key} must be absolute`)
  assert(['zero', 'live', 'cold'].includes(config.phase)); assert(!inside(config.originalProfile, config.out))
  assert.equal(path.resolve(app.getAppPath()), path.resolve(config.root), 'Bootstrap must keep the production app/reference root before installing bundled Skills')
  assert(inside(config.out, app.getPath('userData')) && inside(config.out, app.getPath('sessionData')), 'Domain storage must be isolated after the existing crypto-owner bootstrap')
  assert(Number.isSafeInteger(config.budgetMs ?? 300_000) && (config.budgetMs ?? 300_000) > 0 && (config.budgetMs ?? 300_000) <= 600_000)
  await fs.mkdir(config.out, { recursive: true })
  if (config.phase !== 'cold') assertExperimentNetworkReady()
  const input = await inputFacts(config), workspace = path.join(config.out, 'workspace'), filename = path.join(workspace, 'oasis-human-handoff.glx')
  assert.notEqual(path.resolve(filename), path.resolve(config.sourceFile))
  if (config.phase === 'zero') {
    await fs.mkdir(workspace, { recursive: true })
    try { await fs.copyFile(config.sourceFile, filename, constants.COPYFILE_EXCL) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; assert.equal(hash(await fs.readFile(filename)), input.sha256) }
  }
  installWorkbenchToolServices({ getMainWindow: () => null, getRendererEntryUrl: resolveRendererEntryUrl, headless: true })
  const host = documentHost()
  if (config.phase === 'zero') return zero(config, host, filename, input)
  const gate = await readJson(path.join(config.out, 'zero-preflight.json'))
  assert.deepEqual({ version: gate.version, status: gate.status, input: gate.input, promptSha256: gate.promptSha256 },
    { version: VERSION, status: 'zero-pass', input, promptSha256: hash(PROMPT) }, 'Exact current input and prompt must pass zero first')
  return config.phase === 'live' ? live(config, host, filename, input, gate) : cold(config, host, filename, gate)
}
export async function executeOasisAuthorHandoffAI(config: OasisAuthorHandoffAIConfig) {
  try { return await runOasisAuthorHandoffAI(config) }
  catch (error) {
    if (path.isAbsolute(config.out) && !inside(config.originalProfile, config.out)) {
      const value = error as { name?: unknown; code?: unknown; message?: unknown }
      await write(path.join(config.out, 'failure.json'), { phase: config.phase,
        name: typeof value?.name === 'string' ? value.name : 'unknown',
        code: typeof value?.code === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value.code) ? value.code : null,
        // Assertion explanations concern this bounded original-work copy. Provider/credential
        // errors retain their existing sanitized owner diagnostics instead.
        assertion: value?.name === 'AssertionError' && typeof value.message === 'string' ? value.message.slice(0, 3000) : null,
        at: new Date().toISOString() }).catch(() => undefined)
    }
    throw error
  }
}
export async function installOasisAuthorHandoffAI(config: OasisAuthorHandoffAIConfig) {
  await app.whenReady(); app.on('window-all-closed', () => undefined)
  ;(globalThis as { __oasisAuthorHandoffAI?: () => Promise<unknown> }).__oasisAuthorHandoffAI = () => executeOasisAuthorHandoffAI(config)
}
