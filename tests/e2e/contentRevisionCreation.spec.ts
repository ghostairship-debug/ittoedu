import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import { buildSync } from 'esbuild'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import sharp from 'sharp'
import { tableCellContent } from '../../src/components/table/data'
import { plainDocumentText } from '../../src/shared/document/content'
import { closeSelectionApp, launchSelectionApp } from './helpers/g20SelectionHarness'

test('T10 small V10 creation uses actual local compute, editable table/chart, reused image, save/cold reopen, public exports and one real Player answer click', async ({}, info) => {
  // Harness time only. No product timeout, generation service, paid request or WSL dependency is added.
  const liveMode = process.env.CONTENT_REVISION_CREATION_LIVE === '1'
  const resumeFrom = process.env.CONTENT_REVISION_CREATION_RESUME_FROM
  if (liveMode && resumeFrom) throw new Error('Controlled closure must not start a new paid provider')
  const liveArtifacts = liveMode || !!resumeFrom
  test.setTimeout(liveMode ? 0 : 180_000)
  const root = resolve(__dirname, '../..'), base = join(root, 'output/content-revision/creation-chain')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-'))
  const workspace = join(resumeFrom ? resolve(resumeFrom) : directory, 'workspace')
  if (!resumeFrom) {
    mkdirSync(workspace)
    writeFileSync(join(workspace, '分数.csv'), '班级,分数\n一班,80\n一班,100\n二班,70\n二班,90\n')
    writeFileSync(join(workspace, '资料.md'), '# 班级平均分\n\n每位学生等权重，先比较班级均分，再计算全体平均分。铃铛图是已有素材，复用，不再生成。保留可编辑表格、图表与来源说明。\n')
  }
  const providerFile = join(directory, 'controlled-provider.cjs')
  // Only this owned text-provider fixture is compiled; product runtime remains the E-built candidate.
  buildSync({ entryPoints: [join(root, 'tests/integration/productFollowup/T10/creationChainHarness.ts')],
    outfile: providerFile, platform: 'node', format: 'cjs', bundle: true, target: 'node22' })
  let app: ElectronApplication | undefined
  let browserConsumer: ElectronApplication | undefined
  try {
    app = await launchSelectionApp(resumeFrom ? resolve(resumeFrom) : directory)
    await expect((await app.firstWindow()).getByRole('button', { name: '新建会话', exact: true })).toBeEnabled()
    const facts: any = await app.evaluate(async ({ app }, input) => {
      const { createRequire } = process.getBuiltinModule('node:module')
      const requireProduct = createRequire(`${app.getAppPath()}/package.json`)
      const { documentHost } = requireProduct('./dist-electron/main/workbench/documentHost.js') as typeof import('../../src/main/workbench/documentHost')
      const { DocumentHostService } = requireProduct('./dist-electron/main/workbench/DocumentHostService.js') as typeof import('../../src/main/workbench/DocumentHostService')
      const { ExecutionEngine } = requireProduct('./dist-electron/main/workbench/execution/ExecutionEngine.js') as typeof import('../../src/main/workbench/execution/ExecutionEngine')
      const { ExecutionRunStore } = requireProduct('./dist-electron/main/workbench/execution/ExecutionRunStore.js') as typeof import('../../src/main/workbench/execution/ExecutionRunStore')
      const { ExecutionEventStore } = requireProduct('./dist-electron/main/workbench/execution/ExecutionEventStore.js') as typeof import('../../src/main/workbench/execution/ExecutionEventStore')
      const { creationChainProvider, actualCreationEvidence } = requireProduct(input.providerFile) as typeof import('../integration/productFollowup/T10/creationChainHarness')
      const host = documentHost(), setup = new AbortController()
      const fs = requireProduct('node:fs') as typeof import('node:fs')
      const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
      const checkpoint = (phase: string, detail: unknown = {}) => fs.appendFileSync(`${input.directory}/checkpoints.jsonl`, JSON.stringify({ time: new Date().toISOString(), phase, detail }) + '\n')
      const runs = new ExecutionRunStore(`${input.resumeFrom ?? input.directory}/runs`)
      const originalFacts = input.resumeFrom ? JSON.parse(fs.readFileSync(`${input.resumeFrom}/facts.json`, 'utf8')) : undefined
      const originalEnd = input.resumeFrom ? fs.readFileSync(`${input.resumeFrom}/checkpoints.jsonl`, 'utf8').trim().split('\n')
        .map(line => JSON.parse(line)).filter(value => value.phase === 'engine.ended').at(-1) : undefined
      const previous = originalEnd ? await runs.read(originalEnd.detail.runId) : undefined
      if (input.resumeFrom) {
        assert(previous?.status === 'partial' && originalFacts.status === 'partial', 'Original supplier failure must remain partial')
        await host.internalAPI.restore(originalFacts.evidence.documentId)
        checkpoint('original.partial.restored', { runId: previous!.runId, originalProviderRequests: originalFacts.providerRequests })
      }
      let prep = originalFacts?.prep
      if (!input.resumeFrom) {
      checkpoint('material.delivery.before')
      // Trusted preparation imports the already authorized October 7 blue bell
      // through the existing singleton file owner. The model never sees its archive
      // path, old job/run IDs, hidden image handles or the wider repository root.
      const binding = await host.artifacts.bind(`${input.root}/docs/development-plan/20261007-content-revision/evidence/oauth-live-20261007/generate.png`)
      const bytes = await host.artifacts.read(binding, setup.signal)
      prep = await host.artifactDeliveries.deliver({ runId: 'creation-material-preparation', operationId: 'deliver-existing-blue-bell',
        workspaceRoot: input.workspace, permission: 'workspace', destination: 'bell.png', sourceKind: 'image',
        sourceId: 'oauth-live-20261007/generate.png', bytes, assertActive: () => setup.signal.throwIfAborted() })
      assert(prep.status === 'written', `Existing material was not actually delivered: ${JSON.stringify(prep)}`)
      checkpoint('material.delivery.written', prep)
      }
      let human: { before: any; after: any; operation: unknown } | undefined
      const fixture = input.liveArtifacts ? undefined : creationChainProvider(async (documentId, observedPath) => {
        const runId = 'creation-human-layout'
        await host.tools.beginRun({ runId, actor: 'human', documents: [{ documentId, writable: [{ kind: 'document' }] }] })
        const call = async (id: string, name: string, value: unknown) => {
          const result = await host.tools.execute(runId, id, { name, input: value })
          assert(result.kind !== 'error', `Human public ${name}: ${JSON.stringify(result)}`)
          return result
        }
        await call('human-files', 'project.list', {})
        const observed = await call('human-read-table', 'project.read', { path: observedPath })
        assert(observed.kind === 'read', 'Human must read the actual public table data')
        const data = JSON.parse(observed.kind === 'read' ? (observed.data as any).content : '')
        assert(data.columns.length === 2, 'Expected two publicly read table columns')
        const columns = data.columns.map((column: any, index: number) => ({ ...column, width: index === 0 ? 260 : 160 }))
        const before = await host.internalAPI.read(documentId)
        // Flow's reading layout has no free-canvas frame. The mature table owner
        // exposes column widths and type size; retain IDs from its public read.
        const operation = await call('human-width', 'object.update', { path: observedPath,
          properties: { data: { columns, style: { fontSize: 20 } }, opacity: 0.9 } })
        assert(operation.kind === 'document-operation' && operation.result.status === 'applied', `Human layout must be committed: ${JSON.stringify(operation)}`)
        const after = await host.internalAPI.read(documentId)
        assert(before.model.kind === 'course-v10' && after.model.kind === 'course-v10', 'Formal V10 required')
        const changed = Object.values(after.model.kind === 'course-v10' ? after.model.project.instances : {}).find(instance => {
          const data = instance.data as any
          return instance.definitionId === 'guoling.table' && data.columns?.[0].width === 260 && data.columns?.[1].width === 160 && data.style?.fontSize === 20
        })
        assert(changed, 'Actual human column widths and type size were not stored')
        human = { before: before.model.kind === 'course-v10' ? before.model.project.instances[changed!.id] : null,
          after: changed, operation }
        await host.tools.stop(runId)
      })
      let selection: import('../../src/shared/workbench/modelProvider').ModelSelection = {
        model: 'controlled-creation', connection: { id: 'controlled', revision: 1, provider: 'controlled', protocol: 'openai-chat',
          baseURL: 'http://127.0.0.1:1/v1', accountId: 'controlled', auth: { kind: 'api-key', credentialRef: 'unused' },
          billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } },
      }
      let provider = fixture?.provider
      let route: unknown, catalog: unknown
      const requests: Array<Record<string, unknown>> = [], catalogs: string[][] = []
      if (input.resumeFrom) {
        route = originalFacts.route; catalog = originalFacts.catalog
        provider = { async *stream(request) {
          catalogs.push(request.tools?.map(tool => tool.name) ?? [])
          assert(catalogs.at(-1)?.includes('task.finish'), 'Public task.finish must be in the actual catalog')
          assert(requests.length === 0, 'Known terminal closure must not request another provider turn')
          const metadata = { requestId: request.requestId, actualModel: 'controlled-closure', source: 'no paid provider' }
          requests.push(metadata); checkpoint('controlled.closure.request', metadata)
          const call = { id: `${request.requestId}-finish`, name: 'task.finish', argumentsText: '{}' }
          yield { type: 'response.completed', requestId: request.requestId, sequence: 1, responseId: request.requestId,
            actualModel: 'controlled-closure', nativeResponse: {}, finishReason: 'tool_calls', toolCalls: [call],
            assistant: { role: 'assistant', content: '', tool_calls: [{ id: call.id, type: 'function',
              function: { name: call.name, arguments: call.argumentsText } }] } }
        } }
      }
      if (input.liveMode) {
        const credential = process.env.TEAMOROUTER_API_KEY
        assert(credential, 'TEAMOROUTER_API_KEY missing in Main runtime')
        const fixedRoute = { provider: 'teamorouter', baseURL: 'https://api.teamorouter.com/v1', model: 'deepseek-flash',
          expectedFamily: 'V4.1', expectedFamilySource: 'Owner confirmation 2026-10-07', accountBilling: 'unknown' }
        route = fixedRoute
        const { modelFetch } = requireProduct('./dist-electron/main/workbench/providers/modelFetch.js') as typeof import('../../src/main/workbench/providers/modelFetch')
        const response = await modelFetch()(`${fixedRoute.baseURL}/models`, { headers: { Authorization: `Bearer ${credential}` } })
        assert(response.ok, `Provider catalog HTTP ${response.status}`)
        const json = await response.json() as { data?: Array<{ id?: string }> }
        const ids = json.data?.flatMap(item => typeof item.id === 'string' ? [item.id] : []) ?? []
        catalog = { checkedAt: new Date().toISOString(), httpStatus: response.status, ids, selectedExact: ids.includes(fixedRoute.model) }
        assert(ids.includes(fixedRoute.model), 'Exact authorized deepseek-flash alias is absent; no provider fallback')
        const { OpenAIChatProvider } = requireProduct('./dist-electron/main/workbench/providers/OpenAIChatProvider.js') as typeof import('../../src/main/workbench/providers/OpenAIChatProvider')
        const actual = new OpenAIChatProvider({ credentialResolver: async () => credential! })
        selection = { model: fixedRoute.model, connection: { id: 'creation-live-teamorouter', revision: 1, provider: fixedRoute.provider,
          protocol: 'openai-chat', baseURL: fixedRoute.baseURL, accountId: 'owner-authorized-test',
          auth: { kind: 'api-key', credentialRef: 'runtime-owner-authorized-test' }, billing: { kind: 'unknown' },
          capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
        provider = { retrySafety: actual.retrySafety, async *stream(request, options) {
          catalogs.push(request.tools?.map(tool => tool.name) ?? [])
          const metadata: Record<string, unknown> = { requestId: request.requestId, requestedModel: request.selection.model,
            actualCatalog: catalogs.at(-1), startedAt: new Date().toISOString() }
          requests.push(metadata); checkpoint('provider.request', metadata)
          // Observes the actual adapter; never rewrites messages, tools or next calls.
          for await (const event of actual.stream(request, options)) {
            if (event.type === 'response.started') metadata.actualModel = event.actualModel ?? null
            if (event.type === 'response.completed') Object.assign(metadata, { actualModel: event.actualModel ?? null,
              finishReason: event.finishReason, usage: event.usage ? { inputTokens: event.usage.inputTokens, outputTokens: event.usage.outputTokens,
                totalTokens: event.usage.totalTokens, reasoningTokens: event.usage.reasoningTokens, cachedInputTokens: event.usage.cachedInputTokens } : null })
            if (event.type === 'response.failed') metadata.failure = { code: event.failure.code, kind: event.failure.kind, outcome: event.failure.outcome }
            if (event.type === 'response.completed' || event.type === 'response.failed') checkpoint('provider.returned', metadata)
            yield event
          }
        } }
      }
      assert(provider, 'Selected provider is required')
      const events = new ExecutionEventStore({ directory: `${input.resumeFrom ?? input.directory}/events` })
      const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, files: host.agentFiles, provider: provider!,
        runs, events })
      // Test operator only: the same live Engine owns Stop. This closure is not
      // advertised to the model and cannot perform any authoring operation.
      const diagnosticStop = { runId: undefined as string | undefined, async stop() {
        if (!diagnosticStop.runId) return null
        checkpoint('diagnostic.stop.requested', { runId: diagnosticStop.runId })
        const record = await engine.stop(diagnosticStop.runId)
        const receipt = record ? { runId: record.runId, status: record.status } : null
        checkpoint('diagnostic.stop.returned', receipt)
        return receipt
      } }
      ;(globalThis as any).__contentRevisionCreationDiagnosticStop = diagnosticStop
      let started: Awaited<ReturnType<typeof engine.start>>
      let ended: Awaited<ReturnType<typeof engine.wait>>
      try {
      checkpoint('engine.start.before')
      if (previous) started = await engine.resume(previous.runId, { ...previous.input, selection })
      else
      started = await engine.start({ conversationId: 'small-creation', taskId: 'class-average', selection, documents: [],
        workspaceRoot: input.workspace, permission: 'workspace',
        instruction: input.liveMode
          ? '根据工作区资料自动完成一份班级平均分教学作品。先实际读取资料与分数CSV，每位学生等权重，用本地Python实际计算两班和总体均分，并保存结果CSV与中文计算PNG。新建并保存一份V10课件，只保留一页Flow连续讲义，含原生可编辑结果表（包括一班、二班和总体均分）、另一个原生班级比较图、真实材料来源说明和平均分公式。插入实际计算PNG，复用已有bell.png作课堂提示图标，不再生成或编辑图像、不另做资料研究。增加标签为“显示平均分答案”的一次点击互动，点击后显示两班及总体平均分答案，未点击时答案隐藏。保存课件并交付离线HTML与DOCX。这是自动创作授权，不等待策划/框架确认；身份、资源登记和提交由现有软件工具维护。'
          : '自动创作一份小型班级平均分教学作品。先读取工作区资料与分数 CSV，用本地 Python 实际计算一班、二班及总体均分，保存 CSV 和中文计算 PNG。新建 V10 连续讲义，保留原生可编辑表、原生比较图、来源链接与平均值公式；插入计算 PNG 和 bell.png（已生成素材，只复用，不再生图）。增加“显示平均分答案”的一次点击互动。保留人工布局，保存课件并导出离线 HTML 与 DOCX。' })
      diagnosticStop.runId = started.runId
      checkpoint('engine.accepted', { runId: started.runId })
      ended = await engine.wait(started.runId)
      } finally {
        if ((globalThis as any).__contentRevisionCreationDiagnosticStop === diagnosticStop)
          delete (globalThis as any).__contentRevisionCreationDiagnosticStop
      }
      await events.flushPending()
      const failure = input.liveMode && ended.failure ? { code: ended.failure.code, kind: ended.failure.kind, outcome: ended.failure.outcome } : ended.failure
      checkpoint('engine.ended', { runId: started.runId, status: ended.status, failure })
      const sourceTools = [...previous?.tools ?? [], ...ended.tools]
      const sourceRequests = [...originalFacts?.requests ?? [], ...requests]
      const optionalLoadCatalogs = sourceTools.filter(tool => tool.call.name === 'tools.load'
        && (tool.call.input as any)?.families?.some((family: string) => family === 'content' || family === 'layout'))
        .map(tool => ({ families: (tool.call.input as any).families,
          visibleBeforeLoad: sourceRequests.find(request => request.requestId === tool.requestId)?.actualCatalog ?? [] }))
      const evidence = fixture?.evidence ?? actualCreationEvidence(sourceTools, [...originalFacts?.evidence.catalogs ?? [], ...catalogs])
      const common = { scope: input.resumeFrom ? 'controlled software closure of original supplier partial task; original live artifacts independently consumed; no fresh supplier completion'
        : input.liveMode ? 'one actual TeamoRouter creation task; no supplier-wide or artistic acceptance claim; no image generation'
        : 'actual Main singleton/Engine/default tools, local compute and public delivery; controlled text provider; supplier not tested',
        paidCalls: input.liveMode ? undefined : 0, providerRequests: requests.length, route, catalog, requests, prep, status: ended.status, failure,
        original: originalFacts ? { status: originalFacts.status, providerRequests: originalFacts.providerRequests, runId: previous!.runId } : undefined,
        closureTools: input.resumeFrom ? ended.tools : undefined, optionalLoadCatalogs,
        tools: input.liveArtifacts ? sourceTools.map(tool => ({ call: { name: tool.call.name }, state: tool.state,
          result: tool.result?.kind === 'error' ? { kind: 'error', code: tool.result.code } : { kind: tool.result?.kind } })) : ended.tools, evidence, human }
      if (ended.status !== (input.resumeFrom ? 'partial' : 'completed') || !evidence.documentId) return common
      const saved = await host.internalAPI.read(evidence.documentId)
      assert(saved.model.kind === 'course-v10', 'Created course must use V10')
      // The controlled case independently proves bell-embedding Undo/Redo. Live
      // consumes the model's actual saved state without a fixture-imposed last edit.
      const undo = input.liveArtifacts ? undefined : await host.internalAPI.dispatch({ documentId: saved.documentId, epoch: saved.epoch, baseRevision: saved.revision,
        actor: 'human', operationId: 'undo-last-bell-embedding', mutation: { type: 'undo', expectedTopOperationId: saved.undoHead?.operationId } })
      const undone = await host.internalAPI.read(saved.documentId)
      const redo = input.liveArtifacts ? undefined : await host.internalAPI.dispatch({ documentId: undone.documentId, epoch: undone.epoch, baseRevision: undone.revision,
        actor: 'human', operationId: 'redo-last-bell-embedding', mutation: { type: 'redo' } })
      const redone = await host.internalAPI.read(saved.documentId)
      if (!input.liveArtifacts) await host.internalAPI.save(saved.documentId)
      // A new registry, journal and Gateway read the saved archive; a second Engine
      // on the same Gateway would not be a cold reopen.
      const coldHost = new DocumentHostService(`${input.directory}/cold-documents`)
      const cold = await coldHost.internalAPI.open(input.liveArtifacts ? (evidence as ReturnType<typeof actualCreationEvidence>).savedPath! : `${input.workspace}/班级平均分.h5lesson`)
      const summarize = (snapshot: import('../../src/shared/workbench/document').DocumentSnapshot) => {
        if (snapshot.model.kind !== 'course-v10') throw new Error('V10 snapshot required')
        return { revision: snapshot.revision, undoDepth: snapshot.undoDepth, redoDepth: snapshot.redoDepth, dirty: snapshot.dirty,
          project: snapshot.model.project, resources: Object.fromEntries(Object.entries(snapshot.model.resources.assets).map(([id, value]) => [id, value.byteLength])) }
      }
      checkpoint('cold.opened')
      return { ...common, saved: summarize(saved), undo, undone: summarize(undone), redo, redone: summarize(redone), cold: summarize(cold), documentId: saved.documentId }
    }, { root, directory, workspace, providerFile, liveMode, liveArtifacts, resumeFrom: resumeFrom ? resolve(resumeFrom) : undefined })
    writeFileSync(join(directory, 'facts.json'), JSON.stringify(facts, null, 2))
    await info.attach('Creation public receipts and cold reopen facts', { path: join(directory, 'facts.json'), contentType: 'application/json' })
    expect(facts.status, JSON.stringify({ status: facts.status, failure: facts.failure })).toBe(resumeFrom ? 'partial' : 'completed')
    if (resumeFrom) {
      expect(facts.paidCalls).toBe(0); expect(facts.original.status).toBe('partial')
      expect(facts.providerRequests).toBe(1)
      expect(facts.closureTools.map((tool: any) => tool.call.name)).toEqual(['task.finish'])
      expect(facts.closureTools[0].result).toMatchObject({ kind: 'read', data: { status: 'partial', remaining: expect.any(Array) } })
    }
    if (!liveArtifacts) {
      expect(facts.paidCalls).toBe(0)
      expect(facts.evidence.computedRows).toEqual([['班级', '平均分'], ['一班', '90'], ['二班', '80'], ['总体', '85']])
      expect(facts.tools.filter((tool: any) => tool.call.name === 'compute.run')).toHaveLength(1)
    } else {
      expect(facts.route).toMatchObject({ provider: 'teamorouter', baseURL: 'https://api.teamorouter.com/v1', model: 'deepseek-flash',
        expectedFamily: 'V4.1', expectedFamilySource: 'Owner confirmation 2026-10-07', accountBilling: 'unknown' })
      expect(facts.catalog.selectedExact).toBe(true)
      expect(facts.requests.length).toBeGreaterThan(0)
      expect(facts.tools.some((tool: any) => tool.call.name === 'file.read')).toBe(true)
      expect(facts.tools.some((tool: any) => tool.call.name === 'compute.run')).toBe(true)
      expect(facts.evidence.computedFiles.csv, 'Actual written compute CSV receipt is required').toBeTruthy()
      const rows = readFileSync(facts.evidence.computedFiles.csv, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/)
        .map(line => line.split(',').map(value => value.trim().replace(/^"|"$/g, '')))
      const meanColumn = rows[0].findIndex(value => /平均|均分|mean|average/i.test(value))
      expect(meanColumn, 'Actual CSV must label its mean column').toBeGreaterThanOrEqual(0)
      const mean = (label: RegExp) => Number(rows.slice(1).find(row => row.some(cell => label.test(cell)))?.[meanColumn])
      expect(mean(/^一班$/)).toBe(90); expect(mean(/^二班$/)).toBe(80); expect(mean(/^(总体|全体|整体|overall)$/i)).toBe(85)
    }
    expect(facts.tools.some(tool => ['image.generate', 'image.edit'].includes(tool.call.name))).toBe(false)
    expect(facts.evidence.catalogs[0]).toEqual(expect.arrayContaining(['file.list', 'file.read', 'file.create', 'compute.run',
      'project.list', 'project.read', 'project.apply', 'project.save']))
    for (const load of facts.optionalLoadCatalogs) expect(load.visibleBeforeLoad).toEqual(expect.arrayContaining([
      'project.apply', 'project.save', 'text.replace', 'object.update', 'media.insert', 'document.export']))
    expect(facts.saved!.dirty).toBe(false)
    expect(facts.saved!.project.surfaces.map(surface => surface.kind)).toEqual(['flow'])
    const instances: any[] = Object.values(facts.saved!.project.instances)
    const tables = instances.filter(instance => instance.definitionId === 'guoling.table')
    const charts = instances.filter(instance => instance.definitionId === 'guoling.chart')
    const cellRows = (instance: any): string[][] => instance.data.rows.map((row: any) => row.cells.map((cell: any) => plainDocumentText(tableCellContent(cell))))
    if (!liveArtifacts) {
      expect(tables).toHaveLength(1); expect(charts).toHaveLength(1)
      const table: any = tables[0].data, chart: any = charts[0].data
      expect(cellRows(tables[0])).toEqual(expect.arrayContaining([['一班', '90'], ['二班', '80'], ['总体', '85']]))
      expect(chart.categories.map((category: any) => category.label)).toEqual(['一班', '二班'])
      expect(chart.series[0].points.map((point: any) => point.value)).toEqual([90, 80])
      expect(tables[0]).toEqual(facts.human!.after)
      expect(table.columns.map((column: any) => column.width)).toEqual([260, 160])
      expect(table.style.fontSize).toBe(20)
      expect(tables[0].style?.opacity).toBe(0.9)
    } else {
      expect(tables.length, 'Live result must retain an editable native table').toBeGreaterThan(0)
      expect(charts.length, 'Live result must include an editable native chart').toBeGreaterThan(0)
      const resultTable = tables.find((table: any) => [['一班', 90], ['二班', 80]].every(([label, value]) =>
        cellRows(table).some(row => row.includes(String(label)) && row.some(cell => Number(cell) === value))))
      expect(resultTable).toBeTruthy()
      for (const [label, value] of [['一班', 90], ['二班', 80], ['总体', 85]] as const) {
        const row = cellRows(resultTable).find(row => row.includes(label))
        expect(row, `Native table result row ${label}`).toBeTruthy()
        expect(row!.slice(1).some(cell => Number(cell) === value)).toBe(true)
      }
      const resultChart: any = charts.find((chart: any) => ['一班', '二班'].every(label => chart.data.categories.some((category: any) => category.label === label)))
      expect(resultChart).toBeTruthy()
      for (const [label, value] of [['一班', 90], ['二班', 80]] as const) {
        const category = resultChart.data.categories.find((category: any) => category.label === label)
        expect(resultChart.data.series.some((series: any) => series.points.some((point: any) => point.categoryId === category.id && point.value === value))).toBe(true)
      }
    }
    const pictures = (project: any): any[] => Object.values(project.instances).filter((instance: any) => instance.definitionId === 'guoling.image')
    if (!liveArtifacts) {
      expect(pictures(facts.saved!.project)).toHaveLength(2)
      expect(facts.undo).toMatchObject({ status: 'applied' }); expect(facts.redo).toMatchObject({ status: 'applied' })
      expect(pictures(facts.undone!.project)).toHaveLength(1)
      expect(facts.undone!.revision).toBe(facts.saved!.revision + 1)
      expect(facts.redone!.revision).toBe(facts.saved!.revision + 2)
      expect(facts.redone!.project.revision).toBe(facts.redone!.revision)
      const { revision: beforeRevision, ...beforeContent } = facts.saved!.project
      const { revision: afterRevision, ...afterContent } = facts.redone!.project
      expect(afterRevision).toBe(beforeRevision + 2)
      expect(afterContent).toEqual(beforeContent)
    } else expect(pictures(facts.saved!.project).length).toBeGreaterThanOrEqual(2)
    expect(facts.cold!.project).toEqual(facts.redone!.project)
    expect(facts.cold!.resources).toEqual(facts.saved!.resources)
    const computed = liveArtifacts ? facts.evidence.computedFiles.png : join(workspace, '均分图.png'), bell = join(workspace, 'bell.png')
    expect(computed, 'Actual written compute PNG receipt is required').toBeTruthy()
    const computeImage = await sharp(computed).metadata()
    if (!liveArtifacts) expect(computeImage).toMatchObject({ format: 'png', width: 500, height: 300 })
    else { expect(computeImage.format).toBe('png'); expect(computeImage.width).toBeGreaterThan(0); expect(computeImage.height).toBeGreaterThan(0) }
    expect(await sharp(bell).metadata()).toMatchObject({ format: 'png', width: 1254, height: 1254 })
    await info.attach('Actual local compute Chinese chart', { path: computed, contentType: 'image/png' })
    const docxReceipt = facts.evidence.exports.find(receipt => receipt.format === 'docx')
    const htmlReceipt = facts.evidence.exports.find(receipt => receipt.format === 'html-offline')
    const outputPath = (receipt: any, extension: string) => receipt.path ?? receipt.files?.find((file: any) => (file.path ?? file.suggestedName).endsWith(extension))?.path
    const docxPath = outputPath(docxReceipt, '.docx'), htmlPath = outputPath(htmlReceipt, '.html')
    expect(docxPath, JSON.stringify(docxReceipt)).toBeTruthy(); expect(htmlPath, JSON.stringify(htmlReceipt)).toBeTruthy()
    const archive = unzipSync(new Uint8Array(readFileSync(docxPath)))
    const word = strFromU8(archive['word/document.xml'])
    expect(word).toContain('<w:tbl>'); expect(word).toContain('一班'); expect(word).toContain('90'); expect(word).toContain('85')
    expect(word).toMatch(/<m:oMath(?:\s|>)/)
    expect(Object.keys(archive).filter(name => name.startsWith('word/media/'))).not.toHaveLength(0)
    // Consume the public offline artifact as a separate browser. Shared code
    // receives no workbench session, privileged preload, Host or model service.
    const consumerMain = join(directory, 'offline-browser.cjs')
    writeFileSync(consumerMain, `const { app, BrowserWindow } = require('electron')
const [filename, profile] = process.argv.slice(2)
app.setPath('userData', profile)
let window
app.whenReady().then(async () => {
  window = new BrowserWindow({ show: true, width: 1200, height: 1000,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  await window.loadFile(filename)
})
app.on('window-all-closed', () => app.quit())
`)
    const consumerEnv = Object.fromEntries(Object.entries(process.env).filter(([name, value]) =>
      value !== undefined && !/(?:API_KEY|TOKEN|SECRET|CREDENTIAL|VITE_DEV_SERVER_URL|BACKGROUND_E2E)/i.test(name))) as Record<string, string>
    const consumerProfile = join(directory, 'offline-browser-profile')
    mkdirSync(consumerProfile)
    browserConsumer = await electron.launch({ cwd: root,
      args: [consumerMain, htmlPath, consumerProfile], env: consumerEnv })
    const player = await browserConsumer.firstWindow()
    let answerFrame = player.mainFrame()
    await expect.poll(async () => {
      for (const frame of player.frames()) if (await frame.getByText('显示平均分答案', { exact: true }).count()) { answerFrame = frame; return true }
      return false
    }).toBe(true)
    const summary = answerFrame.getByText('显示平均分答案', { exact: true })
    // Passive observations only: retain the browser consumer configuration,
    // trusted click, assertion order and image-decode checks below.
    const playerDiagnostics: any = { pageErrors: [], observations: [] }
    player.on('pageerror', error => playerDiagnostics.pageErrors.push(error.message))
    for (const frame of player.frames()) await frame.evaluate(() => {
      const observations: unknown[] = []
      ;(window as any).__creationPassiveEvents = observations
      for (const name of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'toggle']) {
        document.addEventListener(name, event => {
          observations.push({ type: event.type, time: performance.now(), trusted: event.isTrusted,
            defaultPrevented: event.defaultPrevented,
            x: 'clientX' in event ? event.clientX : undefined, y: 'clientY' in event ? event.clientY : undefined,
            path: event.composedPath().filter(value => value instanceof Element).slice(0, 6)
              .map(value => ({ tag: (value as Element).tagName, id: (value as Element).id })) })
        }, { capture: true, passive: true })
      }
    })
    const observePlayer = async (phase: string) => {
      const windows = await browserConsumer!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({
        id: window.id, visible: window.isVisible(), focused: window.isFocused(), bounds: window.getBounds(),
        webContentsId: window.webContents.id, url: window.webContents.getURL(),
        backgroundThrottling: window.webContents.getBackgroundThrottling(),
      })))
      const frames = []
      for (const frame of player.frames()) frames.push({ selectedAnswerFrame: frame === answerFrame,
        url: frame.url().slice(0, 400), urlLength: frame.url().length,
        ...await frame.evaluate(() => {
          const describe = (element: Element | null) => {
            if (!element) return null
            const rect = element.getBoundingClientRect(), style = getComputedStyle(element)
            return { tag: element.tagName, text: element.textContent?.slice(0, 150),
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              display: style.display, visibility: style.visibility, pointerEvents: style.pointerEvents }
          }
          const label = [...document.querySelectorAll('summary')].find(element => element.textContent?.trim() === '显示平均分答案')
          const rect = label?.getBoundingClientRect()
          return { visibilityState: document.visibilityState, focused: document.hasFocus(),
            viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
            summary: describe(label ?? null), detailsOpen: label?.closest('details')?.open,
            answer: describe(label?.closest('details')?.querySelector('p') ?? null),
            hitAtSummaryCenter: rect ? describe(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) : null,
            iframes: [...document.querySelectorAll('iframe')].map(element => describe(element)),
            images: [...document.images].map(image => ({ complete: image.complete, naturalWidth: image.naturalWidth,
              naturalHeight: image.naturalHeight, rect: describe(image)?.rect })),
            events: (window as any).__creationPassiveEvents ?? [] }
        }) })
      playerDiagnostics.observations.push({ phase, windows, frames })
    }
    let playerClickFailed = false
    try {
    await observePlayer('before-click')
    if (!liveArtifacts) {
      const answer = answerFrame.getByText('一班 90，二班 80，总体 85', { exact: true })
      await expect(summary).toBeVisible(); await expect(answer).not.toBeVisible()
      await summary.click(); await expect(answer).toBeVisible()
      expect(await summary.evaluate(element => element.closest('details')?.open)).toBe(true)
    } else {
      await expect(summary).toBeVisible()
      const before = await answerFrame.locator('body').innerText()
      await summary.click()
      await expect.poll(() => answerFrame.locator('body').innerText()).not.toBe(before)
      const after = await answerFrame.locator('body').innerText()
      // Observe newly revealed text in the real DOM, without fixture selectors,
      // script invocation or dictating whether the model chose button/details.
      let begin = 0, beforeEnd = before.length, afterEnd = after.length
      while (begin < beforeEnd && begin < afterEnd && before[begin] === after[begin]) begin++
      while (beforeEnd > begin && afterEnd > begin && before[beforeEnd - 1] === after[afterEnd - 1]) { beforeEnd--; afterEnd-- }
      const revealed = after.slice(begin, afterEnd)
      expect(revealed).toMatch(/一班[\s\S]*90/); expect(revealed).toMatch(/二班[\s\S]*80/); expect(revealed).toMatch(/(?:总体|全体|整体)[\s\S]*85/)
      writeFileSync(join(directory, 'player-reveal.json'), JSON.stringify({ before, after, revealed }, null, 2))
    }
    } catch (error) {
      playerClickFailed = true
      playerDiagnostics.failure = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      try { await observePlayer('after-click-or-failure') }
      catch (error) { playerDiagnostics.observationFailure = error instanceof Error ? error.message : String(error) }
      const diagnosticPath = join(directory, 'player-click-diagnostics.json')
      writeFileSync(diagnosticPath, JSON.stringify(playerDiagnostics, null, 2))
      await info.attach('Passive Player click diagnostics', { path: diagnosticPath, contentType: 'application/json' })
      if (playerClickFailed) {
        try {
          const failureImage = join(directory, 'player-click-failure.png')
          await player.screenshot({ path: failureImage, fullPage: true })
          await info.attach('Player at original click failure', { path: failureImage, contentType: 'image/png' })
        } catch (error) { console.error('Player failure screenshot unavailable', error instanceof Error ? error.message : String(error)) }
      }
    }
    const decodedPictures: number[][] = []
    for (const picture of pictures(facts.saved!.project)) {
      const rendered = player.locator(`[data-component-object="${picture.id}"] img`)
      await expect(rendered).toHaveCount(1)
      await expect.poll(() => rendered.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0)).toBe(true)
      decodedPictures.push(await rendered.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight]))
    }
    if (!liveArtifacts) expect(decodedPictures.sort((left, right) => left[0] - right[0])).toEqual([[500, 300], [1254, 1254]])
    else expect(decodedPictures).toEqual(expect.arrayContaining([[computeImage.width, computeImage.height], [1254, 1254]]))
    await player.screenshot({ path: join(directory, 'player-answer.png'), fullPage: true })
    await info.attach('Actual exported Player after one answer click', { path: join(directory, 'player-answer.png'), contentType: 'image/png' })
    const afterPlayer = await app.evaluate(async ({ app }, documentId) => {
      const { createRequire } = process.getBuiltinModule('node:module'), requireProduct = createRequire(`${app.getAppPath()}/package.json`)
      const { documentHost } = requireProduct('./dist-electron/main/workbench/documentHost.js') as typeof import('../../src/main/workbench/documentHost')
      const current = await documentHost().internalAPI.read(documentId)
      return { undoDepth: current.undoDepth, dirty: current.dirty, project: current.model.kind === 'course-v10' ? current.model.project : null }
    }, facts.documentId!)
    expect(afterPlayer.project).toEqual(facts.redone!.project)
    expect(afterPlayer.undoDepth).toBe(facts.saved!.undoDepth)
    expect(afterPlayer.dirty).toBe(false)
  } finally {
    if (browserConsumer) await browserConsumer.close().catch(() => {})
    if (app) await closeSelectionApp(app)
  }
})
