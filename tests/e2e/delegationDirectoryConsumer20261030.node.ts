/** Opt-in owner-path consumer. The parent is scripted; only live child's provider is real. */
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { app } from 'electron'
import { documentHost } from '../../src/main/workbench/documentHost'
import { installWorkbenchToolServices, setWorkbenchNativeExecution, workbenchDelegationService } from '../../src/main/workbench/workbenchToolServices'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { EditSessionService } from '../../src/main/workbench/execution/EditSessionService'
import { ProgrammaticToolRunner, type ProgrammaticToolExecution } from '../../src/main/workbench/execution/ProgrammaticToolRunner'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { OAuthDesktopService } from '../../src/main/workbench/providers/OAuthDesktopService'
import { createElectronCredentialEncryption } from '../../src/main/workbench/providers/providerCredentials'
import { ChatGPTResponsesProvider } from '../../src/main/workbench/providers/ChatGPTResponsesProvider'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform'
import { prepareComponentProjectFileSource } from '../../src/core/projectFiles/componentPlatform/projection'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

const TARGET = 'bd9debae-82a1-4d44-8fa3-37c51649af94'
const SOURCE_PATH = 'pages/01-第 1 页/01-06-00 · 清晨步道.view.js'
const OUTPUT = 'dawn.js'
const TITLE = '清晨步道'
const MARKER = '目录来源：'
const CHILD_TOOLS = new Set(['file.list', 'file.read', 'file.grep', 'file.write', 'file.patch', 'material.list', 'material.read',
  'material.inspect', 'tools.load', 'context.read', 'task.note', 'task.finish', 'delegate.message', 'programmatic.read'])
function childCallScopeError(name: string, input: unknown): string | null {
  if (!CHILD_TOOLS.has(name)) return `Test scope does not authorize ${name}`
  if (name !== 'file.write' && name !== 'file.patch') return null
  const value = input && typeof input === 'object' ? input as { path?: unknown } : {}
  return typeof value.path === 'string' && !path.isAbsolute(value.path) && path.normalize(value.path) === OUTPUT
    ? null : 'The child may write only its one relative candidate file dawn.js'
}
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
const json = (value: unknown) => JSON.stringify(value, (_key, item) => item instanceof Uint8Array ? [...item] : item, 2)
const write = (filename: string, value: unknown) => fs.writeFile(filename, json(value))
function credentialFailure(error: unknown, phase: string) {
  const value = error && typeof error === 'object' ? error as any : {}
  const name = ['Error', 'TypeError', 'RangeError', 'ExecutionSettingsError', 'ChatGPTOAuthError', 'AbortError', 'DOMException'].includes(value.name) ? value.name : 'OtherError'
  const code = typeof value.code === 'string' && /^(?:credential-|oauth-|secure-storage-|encryption-|invalid-oauth-|stale-)[a-z0-9-]{1,70}$/.test(value.code) ? value.code : null
  const status = value.httpStatus ?? value.status
  const message = typeof value.message === 'string' ? value.message : ''
  const machineError = /safeStorage.*temporarily unavailable/i.test(message) ? 'safe-storage-temporarily-unavailable'
    : /decrypt.*ciphertext|ciphertext.*decrypt/i.test(message) ? 'safe-storage-decrypt-failed'
    : /safeStorage.*before.*ready/i.test(message) ? 'safe-storage-not-ready'
    : /Expected.*buffer/i.test(message) ? 'safe-storage-input-type'
    : typeof value.cause?.code === 'string' && /^E[A-Z0-9_]{1,50}$/.test(value.cause.code) ? value.cause.code : null
  return { name, code, phase, httpStatus: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null, machineError }
}
export async function noteCredentialFailure(out: string, error: unknown, phase: string) {
  await fs.appendFile(path.join(out, 'credential-diagnostics.jsonl'), JSON.stringify(credentialFailure(error, phase)) + '\n')
}
async function observedEncryption(out: string) {
  const encryption = await createElectronCredentialEncryption()
  return { isEncryptionAvailable: () => encryption.isEncryptionAvailable(),
    encryptString: async (plaintext: string) => { try { return await encryption.encryptString(plaintext) }
      catch (error) { await noteCredentialFailure(out, error, 'safe-storage-encrypt'); throw error } },
    decryptString: async (ciphertext: Uint8Array) => { try { return await encryption.decryptString(ciphertext) }
      catch (error) { await noteCredentialFailure(out, error, 'safe-storage-decrypt'); throw error } } }
}

/** Zero-model, zero-network probe of the existing credential owner; no cipher/key/token is exported or copied. */
export async function probeDirectoryConsumerCredentials(config: { out: string; originalProfile: string; domainProfile?: string; domainSessionData?: string; requireOriginalStartupContext?: boolean }) {
  await app.whenReady()
  const startupUserDataSwitch = app.commandLine.getSwitchValue('user-data-dir')
  const facts: any = { status: 'started', modelProviderEntries: 0, actualNetworkRequests: 0,
    profile: app.getPath('userData'), credentialOwnerProfile: config.originalProfile, credentialCopied: false,
    sessionDataAtProbe: app.getPath('sessionData'), startupUserDataSwitch,
    originalStartupContextRequired: !!config.requireOriginalStartupContext,
    startupUserDataMatched: !!startupUserDataSwitch && path.resolve(startupUserDataSwitch) === path.resolve(config.originalProfile),
    localStateCopied: false, tokenValidityProbed: false }
  try {
    if (config.requireOriginalStartupContext) {
      assert(facts.startupUserDataMatched, 'Original crypto context requires the original --user-data-dir at process launch')
      assert.equal(path.resolve(facts.profile), path.resolve(config.originalProfile), 'Original userData path differs at decrypt')
      assert.equal(path.resolve(facts.sessionDataAtProbe), path.resolve(config.originalProfile), 'Original sessionData path differs at decrypt')
    }
    const encryption = await observedEncryption(config.out)
    facts.secureStorageAvailable = await encryption.isEncryptionAvailable()
    const store = new ExecutionSettingsStore({ directory: path.join(config.originalProfile, 'workbench-v2/settings'), encryption })
    const before = (await store.read()).profile, selected = await store.snapshot('conversation')
    assert.equal(selected.connection.auth.kind, 'oauth')
    // The store decrypts in memory. Only a presence bit escapes this lexical scope.
    facts.credentialReadable = await store.readOAuthCredential(selected.connection.auth.credentialRef).then(entry => !!entry.credential)
    if (facts.credentialReadable && config.domainProfile) {
      // Explicit test bootstrap: crypto was initialized in its owner context. Domain services are not installed yet.
      app.setPath('userData', config.domainProfile)
      if (config.domainSessionData) app.setPath('sessionData', config.domainSessionData)
      const independentStore = new ExecutionSettingsStore({ directory: path.join(config.originalProfile, 'workbench-v2/settings'),
        encryption: await observedEncryption(config.out) })
      facts.domainProfile = app.getPath('userData')
      facts.domainSessionData = app.getPath('sessionData')
      facts.credentialReadableAfterDomainSwitch = await independentStore.readOAuthCredential(selected.connection.auth.credentialRef).then(entry => !!entry.credential)
      assert(facts.credentialReadableAfterDomainSwitch, 'Credential owner unavailable after domain path switch')
    }
    assert.deepEqual((await store.read()).profile, before)
    facts.status = facts.credentialReadable ? 'decryption-readable-token-validity-unprobed' : 'credential-unavailable'
    facts.profileRolesUnchanged = true
  } catch (error) {
    await noteCredentialFailure(config.out, error, 'credential-store-read')
    facts.status = 'credential-read-failed'; facts.failure = credentialFailure(error, 'credential-store-read')
  }
  await write(path.join(config.out, 'credential-preflight.json'), facts)
  return facts
}
type Config = { root: string; out: string; mode: 'zero' | 'live'; sources: [string, string]; seed: string; originalProfile: string }
type SourceFact = { absolute: string; relative: string; bytes: number; sha256: string }

async function originalFacts(sources: readonly string[]): Promise<SourceFact[]> {
  const facts: SourceFact[] = []
  const visit = async (absolute: string, relative: string) => {
    const stat = await fs.lstat(absolute)
    assert(!stat.isSymbolicLink(), 'Verification inputs may not contain links')
    if (stat.isDirectory()) for (const name of (await fs.readdir(absolute)).sort()) await visit(path.join(absolute, name), `${relative}/${name}`)
    else { assert(stat.isFile(), 'Verification inputs must be regular files'); const bytes = await fs.readFile(absolute)
      facts.push({ absolute, relative, bytes: bytes.byteLength, sha256: hash(bytes) }) }
  }
  for (const source of sources) await visit(source, path.basename(source))
  return facts
}
function completed(request: ModelRequest, calls: Array<{ name: string; input: unknown }> = [], content = '隔离消费者控制步骤完成'):
  Extract<ModelEvent, { type: 'response.completed' }> {
  const toolCalls = calls.map((call, i) => ({ id: `${request.requestId}-${i}`, name: call.name, argumentsText: JSON.stringify(call.input) }))
  const protocol = request.selection.connection.protocol
  const responses = protocol === 'chatgpt-responses' || protocol === 'openai-responses'
  const output = responses ? [
    ...(content ? [{ id: `fixture-message-${request.requestId}`, type: 'message', status: 'completed', role: 'assistant',
      content: [{ type: 'output_text', text: content, annotations: [] }] }] : []),
    ...toolCalls.map(call => ({ id: `fixture-item-${call.id}`, type: 'function_call', status: 'completed', call_id: call.id,
      name: modelToolWireName(call.name), arguments: call.argumentsText })),
  ] : []
  return { type: 'response.completed', requestId: request.requestId, sequence: 1, responseId: request.requestId,
    actualModel: 'scripted-consumer-fixture', finishReason: calls.length ? 'tool_calls' : 'stop',
    nativeResponse: responses ? { id: request.requestId, status: 'completed', output } : {}, toolCalls,
    assistant: { role: 'assistant', content,
      ...(responses ? { nativeResponses: { protocol, responseId: request.requestId, output } } : {}),
      ...(calls.length ? { tool_calls: toolCalls.map(call => ({ id: call.id,
        type: 'function' as const, function: { name: responses ? modelToolWireName(call.name) : call.name, arguments: call.argumentsText } })) } : {}) } }
}
function titleChange(before: string, after: string): string {
  const offset = before.indexOf(TITLE)
  assert(offset >= 0, 'The named source title is absent; stop rather than change a different target')
  const prefix = before.slice(0, offset), suffix = before.slice(offset + TITLE.length)
  assert(after.startsWith(prefix) && after.endsWith(suffix), 'Candidate must preserve all source except the one title literal')
  const replacement = after.slice(prefix.length, after.length - suffix.length)
  assert(replacement.startsWith(MARKER) && replacement.length <= 100 && replacement.length > MARKER.length,
    'Candidate must supply a short directory-derived title')
  return replacement
}
async function run(config: Config) {
  const relativeProfile = path.relative(config.out, app.getPath('userData'))
  assert(relativeProfile !== '..' && !relativeProfile.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeProfile),
    'Domain services must use this attempt\'s isolated profile before installation')
  const startedAt = Date.now(), workspace = path.join(config.out, 'workspace'), filename = path.join(workspace, 'three-units.glx')
  await fs.mkdir(workspace, { recursive: true }); await fs.copyFile(config.seed, filename, fs.constants.COPYFILE_EXCL)
  const originals = await originalFacts(config.sources)
  await write(path.join(config.out, 'original-source-manifest.json'), originals)
  const directoryFiles = originals.filter(item => item.relative.startsWith(path.basename(config.sources[1]) + '/'))
  assert(directoryFiles.length, 'Actual unit1 directory is empty')
  const textSource = directoryFiles.filter(item => /\.(md|markdown|txt|json|csv|js|html|svg)$/i.test(item.relative)).sort((a, b) => a.bytes - b.bytes)[0]
  const chosen = textSource ?? directoryFiles.filter(item => /\.(png|jpe?g|webp)$/i.test(item.relative)).sort((a, b) => a.bytes - b.bytes)[0]
  assert(chosen, 'No supported local text or image source; do not launch a paid child')
  const sourceKind = textSource ? 'text' : 'image'
  const host = documentHost()
  installWorkbenchToolServices({ getMainWindow: () => null,
    getRendererEntryUrl: () => pathToFileURL(path.join(config.root, 'dist-renderer/index.html')).href, headless: true })
  const opened = await host.open(filename)
  assert.equal(opened.model.kind, 'course-v10')
  if (opened.model.kind !== 'course-v10') throw Error('Seed is not GLX')
  const baseline = structuredClone(opened.model)
  assert(baseline.project.instances[TARGET], 'Expected isolated target is absent')
  const sourceFile = componentProjectFiles(baseline.project, baseline.resources).find(item => item.path === SOURCE_PATH)
  assert(sourceFile, 'Expected formal Source projection is absent')
  await prepareComponentProjectFileSource(sourceFile)
  const sourceText = sourceFile.content ?? new TextDecoder('utf-8', { fatal: true }).decode(sourceFile.bytes)
  assert(sourceText.includes(TITLE), 'Seed title changed; no guessed edit')
  await fs.writeFile(path.join(config.out, 'baseline-source.js'), sourceText)

  let actual: ModelProvider | undefined, profileBefore: unknown
  let selection: ModelSelection = { model: 'scripted-consumer-fixture', connection: { id: 'scripted-consumer-fixture', revision: 1,
    provider: 'fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture',
    auth: { kind: 'api-key', credentialRef: 'unused' }, billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', vision: 'supported', stream: 'supported', reasoning: 'unsupported' } } }
  let accountStore: ExecutionSettingsStore | undefined
  if (config.mode === 'live') {
    accountStore = new ExecutionSettingsStore({ directory: path.join(config.originalProfile, 'workbench-v2/settings'),
      encryption: await observedEncryption(config.out) })
    profileBefore = (await accountStore.read()).profile
    const current = await accountStore.snapshot('conversation')
    assert.equal(current.connection.protocol, 'chatgpt-responses', 'Do not substitute another account or paid route')
    selection = await accountStore.captureDelegationSelection({ connectionId: current.connection.id,
      model: 'gpt-6.1-terra', parameters: { reasoning: { effort: 'xhigh' } } }, current)
    const oauth = new OAuthDesktopService({ store: accountStore, openExternal: async () => { throw Error('No login flow in this consumer') } })
    actual = new ChatGPTResponsesProvider({ credentialResolver: async connection => {
      try { return await oauth.resolveCredential(connection) }
      catch (error) { await noteCredentialFailure(config.out, error, 'oauth-resolver'); throw error }
    } })
    await write(path.join(config.out, 'route-facts.json'), { model: selection.model, parameters: selection.parameters,
      connectionId: selection.connection.id, revision: selection.connection.revision, protocol: selection.connection.protocol,
      credentialCopied: false, saveProfileCalled: false, parentProvider: 'scripted-fixture', childProvider: 'official-account-resolver' })
  }

  const delegation = workbenchDelegationService()!
  assert(delegation, 'Production delegation composition missing')
  const originalStart = delegation.startNative.bind(delegation)
  let capture: any[] = [], requestedPermission = '', narrowedPermission = '', jobId = '', parentId = '', childId = ''
  // Test-only least privilege: production full currently propagates full. Do not claim otherwise.
  delegation.startNative = async input => {
    requestedPermission = input.permission; narrowedPermission = 'workspace'
    const prepare = input.prepareSources
    assert(prepare, 'Public delegate must use production taskInputs.freeze')
    return originalStart({ ...input, permission: 'workspace', prepareSources: async signal => {
      const begin = performance.now(), frozen = await prepare(signal)
      capture = frozen.map(item => ({ source: item.source, name: item.name, mimeType: item.mimeType, version: item.version,
        byteLength: item.bytes.byteLength, sha256: hash(item.bytes) }))
      for (const fact of originals) {
        const item = capture.find(item => item.source === fact.absolute)
        assert(item, `Actual source not frozen: ${fact.relative}`)
        assert.equal(item.name, fact.relative, 'Source directory structure was lost')
        assert.equal(item.sha256, fact.sha256, 'Actual source bytes changed during freeze')
      }
      await write(path.join(config.out, 'production-freeze.json'), { milliseconds: performance.now() - begin, inputSources: input.intent.sources,
        requestedPermission, testChildPermission: narrowedPermission, fixtureDifference: 'Explicit full parent / workspace child', capture })
      return frozen
    } })
  }

  const events = new ExecutionEventStore({ directory: path.join(config.out, 'events') })
  const conversationId = `directory-consumer-parent-${randomUUID()}`
  let engine!: ExecutionEngine, fixtureChildTurns = 0, providerEntries = 0, childEnteredAt = 0, budgetStop = ''
  const providerFacts: any[] = []
  const actualNetworkRequests = () => providerFacts.filter(fact => Number.isFinite(fact.timing?.fetchStartedAt)).length
  let stopping: Promise<unknown> | undefined
  const stop = (reason: string) => {
    budgetStop ||= reason
    if (parentId && !stopping) stopping = engine.stop(parentId).catch(error => { budgetStop += `; stop:${String(error)}` })
  }
  const checkToolSafety = (event: ModelEvent) => {
    if (event.type !== 'response.completed') return
    for (const tool of event.toolCalls) {
      // A batch is checked at each actual executeTool callback, never trusted as one opaque allowed call.
      if (tool.name === 'programmatic.execute') continue
      const denied = childCallScopeError(tool.name, JSON.parse(tool.argumentsText))
      assert.equal(denied, null, denied ?? 'Child call exceeded the consumer scope')
    }
  }
  const scopeProgrammaticInput = (input: ProgrammaticToolExecution): ProgrammaticToolExecution => ({ ...input,
    definitions: input.definitions.filter(definition => CHILD_TOOLS.has(definition.name)),
    executeTool: async (callId, call) => {
      const denied = childCallScopeError(call.name, call.input)
      await fs.appendFile(path.join(config.out, 'programmatic-scope.jsonl'), JSON.stringify({ at: Date.now(),
        runId: input.runId, parentCallId: input.callId, callId, name: call.name, decision: denied ? 'denied-before-owner' : 'forwarded-to-owner' }) + '\n')
      if (denied) return { kind: 'error', code: 'consumer-scope-denied', message: denied }
      // Preserve Engine.executeHost, including its grants, file preflight, operation identity and journal.
      return input.executeTool(callId, call)
    } })
  const programmatic = new ProgrammaticToolRunner(), executeProgrammatic = programmatic.execute.bind(programmatic)
  programmatic.execute = input => executeProgrammatic(input.runId === parentId ? input : scopeProgrammaticInput(input))
  // Zero-model callback boundary check: denied calls never reach an owner; accepted paths retain call identity/input.
  let guardOwnerCalls = 0
  const guardSeen: any[] = []
  const guard = scopeProgrammaticInput({ runId: 'scope-preflight', callId: 'scope-preflight', code: '', definitions: [],
    executeTool: async (callId, call) => { guardOwnerCalls++; guardSeen.push({ callId, call }); return { kind: 'read', data: { forwarded: true } } } })
  const deniedCalls = [
    { name: 'file.write', input: { path: chosen.relative } },
    { name: 'file.patch', input: { path: chosen.absolute } },
    { name: 'file.write', input: { path: '../dawn.js' } },
    { name: 'local.run', input: {} }, { name: 'delegate.agent', input: {} },
  ]
  for (const [index, call] of deniedCalls.entries()) {
    const result = await guard.executeTool(`denied-${index}`, call)
    assert(result.kind === 'error' && result.code === 'consumer-scope-denied')
  }
  assert.equal(guardOwnerCalls, 0)
  for (const [index, candidate] of ['./dawn.js', 'dawn.js'].entries()) {
    const call = { name: index ? 'file.patch' : 'file.write', input: { path: candidate } }
    assert.equal((await guard.executeTool(`accepted-${index}`, call)).kind, 'read')
    assert.deepEqual(guardSeen[index], { callId: `accepted-${index}`, call })
  }
  assert.equal(guardOwnerCalls, 2)
  await write(path.join(config.out, 'programmatic-scope-preflight.json'), { status: 'passed-no-model',
    deniedCases: deniedCalls.length, deniedOwnerCalls: 0, acceptedOwnerCalls: guardOwnerCalls,
    execution: 'Callback boundary only; the zero consumer separately exercises the real ProgrammaticToolRunner and Engine.executeHost.' })
  const provider: ModelProvider = { async *stream(request, options) {
    const parent = request.sessionAffinity?.key === `conversation:${conversationId}:main`
    if (!parent) {
      childEnteredAt ||= Date.now()
      if (config.mode === 'live') {
        if (providerEntries >= 6 || Date.now() - childEnteredAt > 180_000 || Date.now() - startedAt > 480_000) {
          stop('consumer-model-budget'); throw Error('Consumer stopped before another model transmission')
        }
        providerEntries++
        const fact: any = { requestId: request.requestId, ordinal: providerEntries, enteredAt: Date.now(), actualModel: null }
        providerFacts.push(fact)
        for await (const event of actual!.stream(request, { ...options, onTiming: timing => {
          fact.timing = { ...timing }; options?.onTiming?.(timing)
        } })) {
          fact.firstEventAt ??= Date.now()
          if (event.type === 'text.delta') fact.firstTextAt ??= Date.now()
          if (event.type === 'tool.delta') fact.firstToolAt ??= Date.now()
          if (event.type === 'response.completed') { fact.actualModel = event.actualModel; fact.finishedAt = Date.now(); fact.usage = event.usage }
          if (event.type === 'response.failed') { fact.failure = { outcome: event.failure.outcome, code: event.failure.code, kind: event.failure.kind } }
          checkToolSafety(event); yield event
        }
        await write(path.join(config.out, 'provider-facts.json'), providerFacts)
        return
      }
      const childSource = capture.find((item: any) => item.source === `${filename}#project:${SOURCE_PATH}`)
      assert(childSource, 'Child did not receive the formal Source descriptor')
      assert(request.messages.some(message => String(message.content ?? '').includes(childSource.name)),
        'Native instruction did not expose its frozen Source path')
      const readPaths = [path.basename(config.sources[0]), chosen.relative, childSource.name]
      const code = `const paths=${JSON.stringify(readPaths)};\n`
        + `await Promise.all(paths.map(path=>tools.call('file.read',{path})));\n`
        + `await tools.call('file.write',${JSON.stringify({ mode: 'create', path: `./${OUTPUT}`, content: sourceText.replace(TITLE, `${MARKER}${path.basename(chosen.relative)}`) })});\n`
        + `return {readPaths:paths,wrote:${JSON.stringify(OUTPUT)}};`
      const steps = [[{ name: 'programmatic.execute', input: { code } }]]
      yield completed(request, steps[fixtureChildTurns++] ?? [], '零模型夹具候选完成；没有实际模型创作'); return
    }
    const record: any = await engine.read(parentId)
    const tools = record?.tools ?? [], find = (name: string) => tools.find((item: any) => item.call?.name === name)
    const fail = tools.find((item: any) => item.result?.kind === 'error')
    if (fail) throw Error(`Formal tool failed: ${fail.call.name}: ${JSON.stringify(fail.result)}`)
    if (!find('project.read')) { yield completed(request, [{ name: 'project.read', input: { project: filename, path: SOURCE_PATH, full: true } }]); return }
    if (!find('delegate.agent')) {
      const readDirectory = sourceKind === 'text'
        ? `用 file.read 读取 ${chosen.relative} 的实际内容。`
        : `目录成员 ${chosen.relative} 是图片：用 material.list 的 path 注册此候选工作区本地路径，再用 material.read representation=image 读取实际图片；不生图、不搜索。`
      const goal = `这是一个已有作品的极小局部修订，只验证真实目录来源可以进入子任务。读取 ${path.basename(config.sources[0])}；${readDirectory}\n`
        + `读取冻结来源中对应 ${SOURCE_PATH} 的 .view.js。只把源文本中第一次出现的“${TITLE}”替换为“${MARKER}”开头的简短标题，后面选目录材料里的一个英文词或短语（不能看清可使用真实文件名）。源码其他每个字节都保留。将完整修改后源码写入 ${OUTPUT}。可以用 programmatic.execute 批量调用允许的文件读取和写入工具；批量内部也只能写这一个相对候选路径。不写其他文件、不改原目录、不委派、不保存GLX、不联网、无其他生成。最后说明读取了哪个目录文件和修改的标题。最多六个模型回合完成。`
      yield completed(request, [{ name: 'delegate.agent', input: { goal, role: '局部 Source 修订者', sharedBrief: '一个清楚的标题局部变更；其余布局、交互和资源逐字保持。由父消费者审查并采用。',
        sources: [...config.sources, filename], sourceVersion: 'current', outputs: [OUTPUT] } }]); return
    }
    jobId ||= String(find('delegate.agent').result.data.job)
    const job = await delegation.status(parentId, jobId)
    childId ||= job.childRunId ?? ''
    if (job.terminal && job.status !== 'ready') throw Error(`Actual job ${job.status}: ${job.reason}`)
    if (job.status !== 'ready') { yield completed(request, [{ name: 'job.wait', input: { job: jobId, milliseconds: 30_000 } }]); return }
    if (!find('delegate.read')) { yield completed(request, [{ name: 'delegate.read', input: { job: jobId, name: OUTPUT } }]); return }
    const sealed = find('delegate.read').result.data
    assert(sealed.verifiedBytes && sealed.candidateComplete && sealed.childRunId === childId, 'Sealed result identity or completion missing')
    titleChange(sourceText, sealed.text)
    if (!find('project.apply')) { yield completed(request, [{ name: 'project.apply', input: { project: filename, path: SOURCE_PATH, from: sealed.source } }]); return }
    yield completed(request, [], '已用正常封存来源完成一次隔离目标采用。')
  } }
  engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider, files: host.agentFiles,
    runs: new ExecutionRunStore(path.join(config.out, 'runs')), events,
    programmatic, edits: new EditSessionService(host.registry, host.tools), subscribeDocumentEvents: listener => host.subscribeEvents(listener) })
  setWorkbenchNativeExecution(engine)
  let monitorBusy = false
  const monitor = setInterval(() => { if (monitorBusy || !parentId) return; monitorBusy = true; void (async () => {
    const parent: any = await engine.read(parentId), child: any = childId ? await engine.read(childId) : null
    const requestRecords = (parent?.requests.length ?? 0) + (child?.requests.length ?? 0)
    await write(path.join(config.out, 'progress.json'), { at: new Date().toISOString(), parentId, childId, jobId,
      parentStatus: parent?.status, childStatus: child?.status, requestRecords, providerEntries,
      actualNetworkRequests: actualNetworkRequests(), elapsedMs: Date.now() - startedAt, budgetStop })
    if (requestRecords >= 20) stop('consumer-tree-request-limit')
    if (Date.now() - startedAt > 480_000 || childEnteredAt && Date.now() - childEnteredAt > 180_000) stop('consumer-wall-time-limit')
  })().catch(error => stop(`monitor:${String(error)}`)).finally(() => { monitorBusy = false }) }, 1000)
  let result: any
  try {
    const prepared = await engine.start({ conversationId, taskId: randomUUID(), instruction: '按隔离消费者既定步骤完成一个实际目录来源的子任务；最终只修改隔离GLX副本。',
      selection, permission: 'full', workspaceRoot: workspace, documents: [{ documentId: opened.documentId, writable: [{ kind: 'document' }] }],
      visionSelection: selection, nativeConcurrencyLimit: 1 }, undefined, async record => { parentId = record.runId })
    const parent: any = await engine.wait(prepared.runId)
    await write(path.join(config.out, 'parent-run.json'), parent)
    if (jobId) { const job = await delegation.status(parentId, jobId); childId ||= job.childRunId ?? ''; await write(path.join(config.out, 'job.json'), job) }
    const child: any = childId ? await engine.read(childId) : null
    await write(path.join(config.out, 'child-run.json'), child)
    await write(path.join(config.out, 'provider-facts.json'), providerFacts)
    assert(!budgetStop, `Stopped with evidence preserved: ${budgetStop}`)
    assert.equal(parent.status, 'completed', JSON.stringify(parent.failure)); assert.equal(child?.status, 'completed', JSON.stringify(child?.failure))
    assert.equal(child.input.permission, 'workspace'); assert.deepEqual(child.input.documents, [])
    assert(child.input.workspaceRoot !== workspace)
    const delegates = parent.tools.filter((item: any) => item.call.name === 'delegate.agent')
    const reads = parent.tools.filter((item: any) => item.call.name === 'delegate.read')
    const applies = parent.tools.filter((item: any) => item.call.name === 'project.apply')
    assert.equal(delegates.length, 1); assert.equal(reads.length, 1); assert.equal(applies.length, 1)
    const sealed = reads[0].result.data
    assert.equal(applies[0].call.input.from, sealed.source)
    assert.deepEqual(applies[0].result.data.receipt.appliedChanges.affectedTargets, [TARGET])
    const produced = await fs.readFile(path.join(child.input.workspaceRoot, OUTPUT))
    assert.equal(hash(produced), sealed.version); assert.equal(produced.toString('utf8'), sealed.text)
    const replacement = titleChange(sourceText, produced.toString('utf8'))
    for (const item of capture.filter(item => originals.some(fact => fact.absolute === item.source))) {
      assert.equal(hash(await fs.readFile(path.join(child.input.workspaceRoot, ...item.name.split('/')))), item.sha256,
        'Child modified a frozen material; no pass')
    }
    if (config.mode === 'zero') {
      const batches = child.tools.filter((item: any) => item.call.name === 'programmatic.execute')
      assert.equal(batches.length, 1, 'Zero consumer must exercise the actual programmatic branch')
      assert.equal(batches[0].result?.data?.status, 'completed')
      const nested = child.tools.filter((item: any) => item.callId.startsWith(`${batches[0].callId}:ptc:`))
      assert.equal(nested.length, 4, 'Actual Engine journal must contain three reads and one candidate write')
      assert.equal(nested.filter((item: any) => item.call.name === 'file.read' && item.result?.kind === 'read').length, 3)
      assert(nested.some((item: any) => item.call.name === 'file.read' && item.call.input.path === chosen.relative))
      assert(nested.some((item: any) => item.call.name === 'file.write' && item.call.input.path === `./${OUTPUT}` && item.result?.kind !== 'error'))
    }
    if (config.mode === 'live') {
      assert(child.requests.length <= 6, 'Child request-record cap exceeded (even if later request was not sent)')
      assert(child.requests.every((item: any) => item.actualModel === 'gpt-6.1-terra'), 'Actual model not fully confirmed')
      const directoryRead = child.tools.find((item: any) => item.call.name === (sourceKind === 'text' ? 'file.read' : 'material.read')
        && item.result?.kind !== 'error')
      assert(directoryRead, 'No successful actual directory-material read; no consumption claim')
      const selectedPath = path.resolve(child.input.workspaceRoot, chosen.relative).toLowerCase()
      const selectedRead = (item: any) => typeof item.call.input.path === 'string'
        && path.resolve(child.input.workspaceRoot, item.call.input.path).toLowerCase() === selectedPath && item.result?.kind !== 'error'
      if (sourceKind === 'text') assert(child.tools.some((item: any) => item.call.name === 'file.read' && selectedRead(item)))
      else assert(child.tools.some((item: any) => item.call.name === 'material.list' && selectedRead(item)),
        'The image was not registered from the selected actual directory member')
    }
    const saved = await host.saveToPath(opened.documentId, filename)
    assert.equal(saved.model.kind, 'course-v10')
    if (saved.model.kind !== 'course-v10') throw Error('Unexpected saved model')
    const expected = structuredClone(baseline.project), implementation: any = saved.model.project.instances[TARGET].implementationOverride
    expected.revision = saved.model.project.revision; expected.instances[TARGET].implementationOverride = structuredClone(implementation)
    assert.deepEqual(saved.model.project, expected, 'A non-target object, geometry or project field changed')
    assert.equal(implementation.workspace.entry, OUTPUT)
    assert.deepEqual(saved.model.resources.assets, baseline.resources.assets)
    assert.deepEqual(saved.model.resources.components, { ...baseline.resources.components,
      [implementation.workspace.ownerId]: { [OUTPUT]: new Uint8Array(produced) } })
    await write(path.join(config.out, 'saved-model.json'), saved.model)
    const after = await originalFacts(config.sources); assert.deepEqual(after, originals, 'User original materials changed')
    if (accountStore) assert(isDeepStrictEqual((await accountStore.read()).profile, profileBefore), 'User model role profile changed; do not overwrite it')
    result = { status: 'passed-producer-awaiting-independent-cold-open', mode: config.mode, parentId, childId, jobId,
      parentProvider: 'scripted-fixture', childProvider: config.mode === 'live' ? 'gpt-6.1-terra' : 'scripted-fixture',
      requestedPermission, testChildPermission: narrowedPermission, permissionFixtureDifference: true,
      sourceKind, selectedDirectorySource: chosen.relative, originalFileCount: originals.length,
      originalBytes: originals.reduce((sum, item) => sum + item.bytes, 0), originalUnchanged: true, frozenBytesUnchanged: true,
      sealedVersion: sealed.version, replacement, sourcePath: SOURCE_PATH, targetId: TARGET, savedFile: filename,
      savedSha256: hash(await fs.readFile(filename)), formalApplyCount: applies.length,
      parentRequestRecords: parent.requests.length, childRequestRecords: child.requests.length,
      totalRequestRecords: parent.requests.length + child.requests.length, providerEntries, actualNetworkRequests: actualNetworkRequests(),
      productionProgrammaticRunnerRetained: true, nestedCallsGuardedBeforeOwner: true,
      programmaticExecuteCalls: child.tools.filter((item: any) => item.call.name === 'programmatic.execute').length,
      networkCountDefinition: 'Provider timing.fetchStartedAt records fetch invocation; not a billing or backend acceptance claim',
      wallMs: Date.now() - startedAt, profileRolesUnchanged: true,
      scope: 'Real directory preparation and one consumer; does not establish natural delegation rate, quality benchmark, or parallel speed.' }
    await write(path.join(config.out, 'producer-result.json'), result)
    return result
  } catch (error) {
    stop('consumer-failed')
    const parent = parentId ? await engine.read(parentId) : null
    if (parent) await write(path.join(config.out, 'parent-run.json'), parent)
    if (jobId) { const job = await delegation.status(parentId, jobId); childId ||= job.childRunId ?? ''; await write(path.join(config.out, 'job.json'), job) }
    if (childId) await write(path.join(config.out, 'child-run.json'), await engine.read(childId))
    await write(path.join(config.out, 'failure.json'), { error: String(error), stack: error instanceof Error ? error.stack : null,
      parentId, childId, jobId, budgetStop, providerEntries, actualNetworkRequests: actualNetworkRequests(), wallMs: Date.now() - startedAt })
    await write(path.join(config.out, 'provider-facts.json'), providerFacts)
    const after = await originalFacts(config.sources)
    await write(path.join(config.out, 'originals-after-failure.json'), { unchanged: isDeepStrictEqual(after, originals), facts: after })
    throw error
  } finally {
    clearInterval(monitor); await stopping; await engine.shutdown(); await events.flushPending()
  }
}

async function cold(config: Config) {
  const produced = JSON.parse(await fs.readFile(path.join(config.out, 'producer-result.json'), 'utf8'))
  const before = await fs.readFile(produced.savedFile), host = documentHost(), opened = await host.open(produced.savedFile)
  assert.equal(opened.dirty, false); assert.equal(opened.model.kind, 'course-v10')
  const saved = JSON.parse(await fs.readFile(path.join(config.out, 'saved-model.json'), 'utf8'))
  assert.deepEqual(JSON.parse(json(opened.model)), saved, 'Independent cold open changed saved semantic data')
  assert.equal(hash(before), produced.savedSha256)
  assert.equal(hash(await fs.readFile(produced.savedFile)), produced.savedSha256, 'Cold reader mutated file')
  const after = await originalFacts(config.sources), originals = JSON.parse(await fs.readFile(path.join(config.out, 'original-source-manifest.json'), 'utf8'))
  assert.deepEqual(after, originals)
  const result = { ...produced, status: 'passed', independentElectronColdOpen: true, coldProfile: app.getPath('userData'),
    coldDirty: opened.dirty, coldProjectIdentity: opened.model.kind === 'course-v10' ? opened.model.project.id : null,
    completedAt: new Date().toISOString() }
  await write(path.join(config.out, 'result.json'), result)
  return result
}

export async function installDirectoryConsumer(config: Config) {
  await app.whenReady(); app.on('window-all-closed', () => undefined)
  ;(globalThis as any).__directoryConsumer = async (method: 'run' | 'cold') => method === 'cold' ? cold(config) : run(config)
}
