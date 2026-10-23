import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { componentContainerBuiltinKey, createComponentContainerInstance } from '../../src/shared/contracts/component-platform/project'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { EditSessionService } from '../../src/main/workbench/execution/EditSessionService'
import { OpenAIChatProvider } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { mediaFileInput } from '../../src/main/workbench/admittedMediaResource'
import { decodeRunCheckpoint, restoreRunChanges } from '../../src/main/workbench/execution/executionRunCheckpoint'
import { committedFact } from '../../src/core/tools/modelToolResult'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'
import type { ExecutionRunRecord, ExecutionStart } from '../../src/shared/workbench/execution'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ToolRunGrant } from '../../src/shared/workbench/tools'
import { componentCompilationInputSchema } from '../../src/shared/workbench/componentCompilation'

export const LIVE_ROUTE = process.env.AUDIT_P3_OFFICIAL === '1'
  ? { provider: 'deepseek-official', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-flash' } as const
  : { provider: 'teamorouter', baseURL: 'https://api.teamorouter.com/v1', model: 'deepseek-flash' } as const
export const TITLE = '一杯热水怎样降温'
export const EXPLANATION = '观察解释：温差越大，散热通常越快，水温会逐渐接近室温。'
export const REVISED = '观察解释：水温降低，但越接近室温，下降通常越慢。'
export const HUMAN_NOTE = '人工批注：先比较温差，再看变化。'
export const DIAGRAM = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" rx="24" fill="#e8f4f2"/><path d="M155 130h220v135q0 35-35 35H190q-35 0-35-35z" fill="#db6b3b"/><path d="M375 160h35q55 0 55 45t-55 45h-35" fill="none" stroke="#db6b3b" stroke-width="22"/><path d="M205 95q-25-25 0-50m60 50q-25-25 0-50m60 50q-25-25 0-50" fill="none" stroke="#db6b3b" stroke-width="10"/><path d="M480 135v-55m0 0-16 20m16-20 16 20" stroke="#2c786b" stroke-width="8" fill="none"/><text x="85" y="335" font-family="sans-serif" font-size="24" fill="#204e47">示意图：热水向较冷的周围空气散热</text><text x="455" y="170" font-family="sans-serif" font-size="22" fill="#204e47">室温 22°C</text></svg>'

export const creationInstruction = `请把当前空白Flow做成一个可继续编辑的小作品《${TITLE}》。先按用途在软件实际能力目录寻找双列图文、图片与折线图能力，再自行使用找到的正式工具完成作品。
工作区“材料.md”给出本次合成观测材料，“散热示意.svg”是已有示意图。请读取材料，用这张图做图片对象，不生图、不联网采购或搜索素材。作品需要：清楚的标题；真正的原生双列阅读布局，一列放示意图，另一列放解释；其中一个可直接编辑的独立段落全文为“${EXPLANATION}”；另有一段“拓展思考：为什么敞口容器可能降温更快？”。
加入可用专业属性继续编辑的折线图“降温记录”，分类依次是“0分钟”“5分钟”“10分钟”，一个“水温”系列，数值依次80、68、59。不要把图表烘焙为图片。使用软件已有的图表、双列等能力，内容、默认值和对象身份交给软件，不从文件手造实例ID。
再加入一个独立局部按钮互动，保有可继续修改的HTML/JS源码，不把整份Flow包成程序。开始显示“先做预测”；点击“显示结论”后显示“热水向周围散热”；点击“重新预测”恢复“先做预测”。局部程序只占自己的位置，邻近正文仍能直接编辑。可自由设计其清晰外观。
完成这些内容即可结束，不替用户保存或导出，不用测试脚本或预制整作代替创作。`

export function course(snapshot: DocumentSnapshot) {
  if (snapshot.model.kind !== 'course-v10') throw new Error('expected-course-model')
  return snapshot.model
}

const bytes = (value: unknown) => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8')
type WireFact = { requestId: string; round: string; requestedModel: string; fullPayloadBytes: number; toolDefinitionsWireBytes: number;
  toolParametersWireBytes: number; transmittedReceiptMessageBytes: number; toolNames: string[]; adapterEnteredAt: number;
  backendAccepted?: boolean; actualModel?: string; finishReason?: string; failure?: { code: string; kind: string; outcome: string } }

/** This module has no top-level run. The opt-in spec alone constructs the live provider. */
export async function prepareAuditLive(directory: string, credential: string, resumePath?: string) {
  const workspace = join(directory, 'workspace')
  await fs.mkdir(workspace, { recursive: true })
  await fs.writeFile(join(workspace, '材料.md'), `# ${TITLE}\n\n这是用于软件验收的合成观测材料，不是真实实验报告。室温22°C。相同杯中水在0、5、10分钟的温度依次为80、68、59°C。温差越大，散热通常越快；水温逐渐接近室温。已有散热示意.svg可用。\n`)
  await fs.writeFile(join(workspace, '散热示意.svg'), DIAGRAM)
  const host = new DocumentHostService(join(directory, 'documents'))
  // Match the desktop composition's admitted-media path, including its frozen file scope.
  const grants = new Map<string, ToolRunGrant>()
  host.tools.configureHostServices({
    beginRun: async grant => { grants.set(grant.runId, structuredClone(grant)) },
    stopRun: runId => { grants.delete(runId); host.agentFiles.releaseRun(runId) },
    mediaFiles: { read: async (runId, source) => {
      const access = grants.get(runId)?.fileAccess
      if (!access?.workspaceRoot) throw new Error('audit-media:missing-frozen-file-scope')
      return mediaFileInput(await host.agentFiles.readAuthorizedFile({ runId, workspaceRoot: access.workspaceRoot,
        permission: access.permission, conversationHome: access.conversationHome, conversationHomeRoot: access.conversationHomeRoot,
        boundPaths: Object.values(access.boundPaths ?? {}), assertActive: () => {
          if (!grants.has(runId)) throw new Error('audit-media:run-stopped')
        } }, source))
    } },
  })
  const project = createBlankCourseProjectV10(TITLE), originalRoot = project.rootIds[0], originalDefinition = project.instances[originalRoot].definitionId
  delete project.instances[originalRoot]; delete project.definitions[originalDefinition]
  const definitionId = componentContainerBuiltinKey('flow'), rootId = randomUUID()
  project.definitions[definitionId] = { id: definitionId, title: '讲义', role: 'mixed', implementation: { kind: 'builtin', key: definitionId } }
  project.instances[rootId] = createComponentContainerInstance({ id: rootId, kind: 'flow', title: TITLE, childIds: [],
    flow: { layout: { widthMode: 'fluid', readingWidth: 960, wideContentWidth: 1100, toc: 'hidden' } } }, definitionId)
  project.rootIds = [rootId]; project.entry = { rootInstanceId: rootId }
  const resumeCopy = join(workspace, '接续作品.glx')
  if (resumePath) await fs.copyFile(resumePath, resumeCopy)
  const initial = resumePath ? await host.open(resumeCopy)
    : await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, '降温观察.glx')
  let previous: Pick<ExecutionRunRecord, 'status' | 'tools'> | undefined
  let previousEvidence: { providerTransportAttempts?: number; previousProviderRequests?: number; resumedFrom?: string } | undefined
  if (resumePath) {
    const priorDirectory = dirname(resumePath)
    previousEvidence = JSON.parse(await fs.readFile(join(priorDirectory, 'evidence.json'), 'utf8'))
    // The original process is closed. Decode its immutable checkpoint/tail without RunStore repair.
    const creationDirectory = previousEvidence?.resumedFrom ? dirname(previousEvidence.resumedFrom) : priorDirectory
    for (const name of await fs.readdir(join(creationDirectory, 'runs'))) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue
      const filename = join(creationDirectory, 'runs', name)
      const checkpoint = decodeRunCheckpoint(await fs.readFile(filename, 'utf8'))
      const record = checkpoint.generation ? restoreRunChanges(checkpoint,
        await fs.readFile(`${filename}.${checkpoint.generation}.changes`)).record : checkpoint.record
      if (!previous) previous = { status: record.status, tools: record.tools }
      else throw new Error('audit-resume:ambiguous-original-creation-record')
    }
    if (!previous) throw new Error('audit-resume:original-creation-record-missing')
  }
  const selection: ModelSelection = { model: LIVE_ROUTE.model, connection: { id: `audit-p3-owner-${LIVE_ROUTE.provider}`, revision: 1,
    provider: LIVE_ROUTE.provider, protocol: 'openai-chat', baseURL: LIVE_ROUTE.baseURL, accountId: 'owner-authorized-audit',
    auth: { kind: 'api-key', credentialRef: 'runtime-owner-authorized-audit' }, billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
  const wire: WireFact[] = [], transport: Array<{ round: string; fullPayloadBytes: number; httpStatus?: number }> = []
  let round = 'setup'
  const actual = new OpenAIChatProvider({ credentialResolver: async () => credential, fetch: async (input, init) => {
    // Never retain URL, headers, RequestInit, credential or response body.
    const fact = { round, fullPayloadBytes: typeof init?.body === 'string' ? bytes(init.body) : 0, httpStatus: undefined as number | undefined }
    transport.push(fact)
    const response = await fetch(input, init); fact.httpStatus = response.status; return response
  } })
  const recordStream = async function* (requestId: string, input: Omit<ModelRequest, 'requestId'>, serialized: string,
    stream: AsyncIterable<ModelEvent>): AsyncIterable<ModelEvent> {
    const payload = JSON.parse(serialized), tools = payload.tools as Array<{ function?: { parameters?: unknown } }> | undefined
    const fact: WireFact = { requestId, round, requestedModel: input.selection.model, fullPayloadBytes: bytes(serialized),
      toolDefinitionsWireBytes: tools ? bytes(tools) : 0,
      toolParametersWireBytes: tools?.reduce((total, tool) => total + (tool.function?.parameters ? bytes(tool.function.parameters) : 0), 0) ?? 0,
      transmittedReceiptMessageBytes: (payload.messages as Array<{ role: string }>).filter(message => message.role === 'tool').reduce((total, message) => total + bytes(message), 0),
      toolNames: input.tools?.map(tool => tool.name) ?? [], adapterEnteredAt: Date.now() }
    wire.push(fact)
    for await (const event of stream) {
      if (event.type === 'response.started') { fact.backendAccepted = true; fact.actualModel = event.actualModel }
      if (event.type === 'response.completed') { fact.actualModel = event.actualModel ?? fact.actualModel; fact.finishReason = event.finishReason }
      if (event.type === 'response.failed') fact.failure = { code: event.failure.code, kind: event.failure.kind, outcome: event.failure.outcome }
      yield event
    }
  }
  const provider: ModelProvider = { retrySafety: actual.retrySafety,
    prepare(input, accounting) {
      const prepared = actual.prepare(input, accounting)
      return { serialized: prepared.serialized, tokens: prepared.tokens,
        stream: (requestId, options) => recordStream(requestId, input, prepared.serialized, prepared.stream(requestId, options)) }
    },
    stream(request, options) {
      const prepared = actual.prepare(request)
      return recordStream(request.requestId, request, prepared.serialized, prepared.stream(request.requestId, options))
    },
  }
  const events = new ExecutionEventStore({ directory: join(directory, 'events') })
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, files: host.agentFiles, provider,
    edits: new EditSessionService(host.registry, host.tools), runs: new ExecutionRunStore(join(directory, 'runs')), events,
    subscribeDocumentEvents: listener => host.subscribeEvents(listener) })
  const rounds: unknown[] = [], runIds: string[] = [], userAttention: Array<{ runId: string; itemId: string; kind: string }> = []
  engine.subscribe(event => {
    if (event.data.question || event.data.approval) {
      userAttention.push({ runId: event.runId, itemId: event.itemId, kind: event.data.approval ? 'approval-required' : 'answer-required' })
      void engine.stop(event.runId).catch(() => undefined)
    }
  })
  const run = async (name: string, instruction: string, writable: ExecutionStart['documents'][number]['writable'],
    signal: AbortSignal, useful: (snapshot: DocumentSnapshot) => boolean) => {
    round = name
    const usefulOperations = new Set<string>()
    const off = host.subscribeEvents(event => {
      if (event.type === 'changed' && event.operationId && event.snapshot.documentId === initial.documentId && useful(event.snapshot)) usefulOperations.add(event.operationId)
    })
    const startedAt = Date.now()
    const started = await engine.start({ conversationId: 'audit-refactor-p3', taskId: name, selection, instruction,
      documents: [{ documentId: initial.documentId, writable }], workspaceRoot: workspace, permission: 'workspace' }, undefined, undefined, { signal })
      .catch(error => { off(); throw error })
    runIds.push(started.runId)
    const ended = await engine.wait(started.runId).finally(off), timing = await events.readTiming('audit-refactor-p3', name)
    const commits = ended.tools.map(tool => ({ tool, receipt: committedFact(tool.call.name, tool.result) }))
      .filter(item => item.receipt?.status === 'applied' && item.receipt.documentId === initial.documentId)
    const start = timing.find(mark => mark.stage === 'engine.prepare.started')
    const first = timing.find(mark => mark.stage === 'document.applied' && mark.detail?.documentId === initial.documentId
      && commits.some(item => item.receipt?.operationId === mark.detail?.operationId))
    const firstUseful = timing.find(mark => mark.stage === 'document.applied' && mark.detail?.operationId && usefulOperations.has(mark.detail.operationId))
    const end = [...timing].reverse().find(mark => mark.stage === 'run.ended')
    const elapsed = (mark: typeof first) => start && mark?.clockInstanceId === start.clockInstanceId ? mark.monotonicMs - start.monotonicMs : null
    const mainRequests = ended.requests.filter(request => request.kind === undefined)
    const fact = { round: name, runId: ended.runId, status: ended.status, wallDurationMs: Date.now() - startedAt,
      firstAppliedContentCommitMs: elapsed(first), firstTitleCommitMs: name === 'create' ? elapsed(firstUseful) : null,
      firstGrantedDataChangeCommitMs: name === 'create' ? null : elapsed(firstUseful), totalEngineMs: elapsed(end),
      requestAttempts: mainRequests.length, logicalRequestRounds: new Set(mainRequests.map(request => request.requestId.replace(/\.attempt-\d+$/, ''))).size,
      modelToolCalls: ended.tools.filter(tool => tool.origin !== 'host').length,
      toolRounds: new Set(ended.tools.filter(tool => tool.origin !== 'host').map(tool => tool.requestId)).size,
      emittedReceiptContentBytes: ended.messages.filter(message => message.role === 'tool').reduce((total, message) => total + bytes(message.content ?? ''), 0),
      requests: mainRequests.map(request => ({ requestId: request.requestId, state: request.state, actualModel: request.actualModel,
        payloadBytes: request.payload?.serializedBytes ?? null, usage: request.usage ? { inputTokens: request.usage.inputTokens,
          outputTokens: request.usage.outputTokens, totalTokens: request.usage.totalTokens, cachedInputTokens: request.usage.cachedInputTokens,
          reasoningTokens: request.usage.reasoningTokens } : null, finishReason: request.finishReason,
        failure: request.failure ? { code: request.failure.code, kind: request.failure.kind, outcome: request.failure.outcome } : null })),
      tools: ended.tools.map(tool => ({ name: tool.call.name, state: tool.state, resultKind: tool.result?.kind,
        application: committedFact(tool.call.name, tool.result)?.status ?? null })),
      failure: ended.failure ? { code: ended.failure.code, outcome: ended.failure.outcome } : null }
    rounds.push(fact)
    return ended
  }
  const preserve = async (stage: string) => {
    const snapshot = await host.internalAPI.read(initial.documentId), model = course(snapshot), driver = new CourseV10Driver()
    await fs.writeFile(join(directory, `attempt-${stage}.glx`), await driver.serialize(model))
  }
  const stop = async () => { for (const id of runIds) { await engine.stop(id); await engine.wait(id) } await events.flushPending() }
  const metrics = () => ({ route: LIVE_ROUTE, rounds, wire, transport, userAttention, comparison: { baseline: null, speedupClaim: false },
    bytesDefinition: { toolDefinitionsWireBytes: 'actual serialized tools array including wire names, descriptions and parameters',
      transmittedReceiptMessageBytes: 'actual wire tool messages; historical receipts count each transmission',
      emittedReceiptContentBytes: 'model-projected tool content emitted once in each ended run' } })
  return { host, engine, initial, surfaceId: course(initial).project.rootIds[0], workspace, run, preserve, stop, metrics,
    previous, previousProviderRequests: (previousEvidence?.providerTransportAttempts ?? 0) + (previousEvidence?.previousProviderRequests ?? 0) }
}

export function modelUsed(record: Pick<ExecutionRunRecord, 'tools'>, name: string, predicate?: (input: any) => boolean) {
  return record.tools.some(tool => tool.origin !== 'host' && tool.state === 'returned' && tool.result?.kind !== 'error'
    && (tool.call.name === name && (!predicate || predicate(tool.call.input))
      || tool.call.name === 'batch' && committedFact('batch', tool.result)?.status === 'applied'
        && (tool.call.input as { operations?: Array<{ name: string; input: unknown }> }).operations
        ?.some(operation => operation.name === name && (!predicate || predicate(operation.input)))))
}

/** Test-only Electron Main endpoint. Default Host/Gateway/File/measurement owners stay intact. */
export async function installAuditMain(directory: string) {
  const { app } = await import('electron')
  await app.whenReady()
  app.on('window-all-closed', () => { /* Measurement windows are disposable; the test owns Main shutdown. */ })
  let live: Awaited<ReturnType<typeof prepareAuditLive>> | undefined
  let cold: DocumentHostService | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  const controller = new AbortController(), pending: Array<{ host: string; event: unknown }> = [], unsubscribers: Array<() => void> = []
  const serializable = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => item instanceof Uint8Array ? [...item] : item))
  ;(globalThis as any).__auditP3Rpc = async (request: { method: string; args?: any[] }) => {
    const args = request.args ?? []
    let result: unknown
    if (request.method === 'preflight') {
      // This is the exact native measurement module used by default DocumentHostService.
      const { measureHtmlAtDesignViewport } = await import('../../src/main/workbench/contentApply/measurement/ElectronHtmlDesignMeasurement.js')
      const assembly = await measureHtmlAtDesignViewport({ html: '<!doctype html><html><body><h1>本地测量预检</h1><p>普通可编辑正文。</p></body></html>', viewport: { width: 640, height: 360 } })
      const media = await prepareAuditLive(join(directory, 'media-setup'), '')
      await media.host.tools.beginRun({ runId: 'media-setup', actor: 'agent',
        documents: [{ documentId: media.initial.documentId, writable: [{ kind: 'document' }] }],
        fileAccess: { workspaceRoot: media.workspace, permission: 'workspace' } })
      const target = await media.host.tools.issueTarget('media-setup', media.initial.documentId,
        { kind: 'course-instance', surfaceId: media.surfaceId, instanceId: media.surfaceId })
      const applied = await media.host.tools.execute('media-setup', 'insert-existing-svg',
        { name: 'media.insert', input: { target, resource: join(media.workspace, '散热示意.svg'), fit: 'contain' } })
      await media.host.tools.stop('media-setup')
      const model = course(await media.host.internalAPI.read(media.initial.documentId))
      result = { environment: 'actual-electron-main', rootKind: assembly.root.kind,
        diagnostics: assembly.diagnostics.map(item => ({ code: item.code, level: item.level })),
        admittedMedia: { resultKind: applied.kind, application: committedFact('media.insert', applied)?.status ?? null,
          assetCount: Object.keys(model.resources.assets).length } }
    } else if (request.method === 'setup') {
      const credential = process.env.AUDIT_P3_OFFICIAL === '1' ? process.env.DEEPSEEK_API_KEY : process.env.TEAMOROUTER_API_KEY
      if (!credential) throw new Error('authorized-provider-key-missing')
      live = await prepareAuditLive(directory, credential, process.env.AUDIT_P3_RESUME_GLX)
      unsubscribers.push(live.host.subscribeEvents(event => pending.push({ host: 'main', event })))
      deadline = setTimeout(() => controller.abort(), 19 * 60_000)
      result = { initial: live.initial, surfaceId: live.surfaceId, workspace: live.workspace,
        previous: live.previous, previousProviderRequests: live.previousProviderRequests }
    } else if (request.method === 'host') {
      const [hostId, name, callArgs] = args, host = hostId === 'main' ? live?.host : cold
      if (!host) throw new Error('audit-host-not-created')
      if (['list', 'read', 'dispatch', 'restore', 'save'].includes(name)) result = await (host.internalAPI as any)[name](...callArgs)
      else if (name === 'readAuthoringDrafts') result = await host.readAuthoringDrafts(callArgs[0])
      else if (name === 'writeAuthoringDrafts') result = await host.writeAuthoringDrafts(callArgs[0], callArgs[1])
      else if (name === 'clearAuthoringDrafts') result = await host.clearAuthoringDrafts(callArgs[0])
      else if (name === 'saveToPath') result = await host.saveToPath(callArgs[0], callArgs[1])
      else if (name === 'compileComponent') result = await host.compilation.compile(componentCompilationInputSchema.parse(callArgs[0]))
      else throw new Error('audit-host-method-not-exposed')
    } else if (request.method === 'run') {
      if (!live) throw new Error('audit-live-not-created')
      const [name, instruction, writable] = args, baseline = course(await live.host.internalAPI.read(live.initial.documentId)).project
      const ended = await live.run(name, instruction, writable, controller.signal, snapshot => {
        const project = course(snapshot).project
        return name === 'create' ? Object.values(project.instances).some(instance => JSON.stringify(instance.data).includes(TITLE))
          : writable.some((target: { instanceId?: string }) => target.instanceId && !isDeepStrictEqual(project.instances[target.instanceId]?.data, baseline.instances[target.instanceId]?.data))
      })
      result = { status: ended.status, tools: ended.tools }
    } else if (request.method === 'cold-open') {
      cold = new DocumentHostService(join(directory, 'cold-documents'))
      unsubscribers.push(cold.subscribeEvents(event => pending.push({ host: 'cold', event })))
      result = await cold.open(args[0])
    } else if (request.method === 'preserve') {
      if (!live) throw new Error('audit-live-not-created')
      await live.preserve(args[0]); result = true
    } else if (request.method === 'metrics') result = live?.metrics() ?? { route: LIVE_ROUTE, rounds: [], wire: [], transport: [] }
    else if (request.method === 'stop') {
      controller.abort(); if (deadline) clearTimeout(deadline)
      await live?.stop(); unsubscribers.splice(0).forEach(off => off()); result = true
    } else throw new Error('audit-rpc-method-not-exposed')
    return serializable({ result, events: pending.splice(0) })
  }
}
