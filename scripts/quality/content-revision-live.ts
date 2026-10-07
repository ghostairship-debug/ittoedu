import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createFormulaComponentData, createTextComponentData, type TextComponentData } from '../../src/components/text/data'
import { documentTextLength, plainDocumentText } from '../../src/shared/document/content'
import { prepareExecutionContentOutput } from '../../src/core/tools/ToolTargets'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { EditSessionService } from '../../src/main/workbench/execution/EditSessionService'
import { OpenAIChatProvider } from '../../src/main/workbench/providers/OpenAIChatProvider'
import type { ModelProvider, ModelSelection } from '../../src/shared/workbench/modelProvider'

const route = { provider: 'teamorouter', baseURL: 'https://api.teamorouter.com/v1', model: 'deepseek-v4-flash', accountId: 'owner-authorized-test', accountBilling: 'unknown' }
const output = path.resolve(process.argv.find(value => value.startsWith('--output='))?.slice('--output='.length)
  ?? `output/content-revision/live-${new Date().toISOString().replace(/[:.]/g, '-')}`)
const selection: ModelSelection = { model: route.model, connection: { id: 'content-revision-teamorouter', revision: 1, provider: route.provider,
  protocol: 'openai-chat', baseURL: route.baseURL, accountId: route.accountId,
  auth: { kind: 'api-key', credentialRef: 'runtime-owner-authorized-test' }, billing: { kind: 'unknown' },
  // This is a requested configuration; successful actual tool calling is reported only from this run.
  capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }

async function run() {
  if (!process.argv.includes('--run')) {
    console.log(JSON.stringify({ status: 'script-ready-no-provider-request', route, output,
      command: 'npx tsx scripts/quality/content-revision-live.ts --run --output=output/content-revision/live-representative',
      scope: 'one actual Engine rich-bound task with shared product files owner and actual catalog; no preloaded tools, no image generation' }, null, 2))
    return
  }
  const credential = process.env.TEAMOROUTER_API_KEY
  if (!credential) throw new Error('TEAMOROUTER_API_KEY-missing')
  await fs.mkdir(output, { recursive: true })
  const workspace = path.join(output, 'workspace'); await fs.mkdir(workspace, { recursive: true })
  await fs.writeFile(path.join(workspace, '资料.md'), '# 教师材料\n\n正方形边长3厘米，面积9平方厘米。面积是边长的平方；请用这个例子解释平方关系。\n')
  const host = new DocumentHostService(path.join(output, 'documents'))
  const project = createBlankCourseProjectV10('真实资料改写代表样本')
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  const original = createTextComponentData({ inlines: [
    { type: 'text', text: '正方形面积', link: { href: 'https://example.org/area' }, style: { bold: true } },
    { type: 'text', text: '：待按教师材料解释。' }, createFormulaComponentData('kept-area-formula', 'x^2').formula,
  ] })
  project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: original, style: { opacity: 0.9 } }
  project.instances.untouched = { id: 'untouched', definitionId: TEXT_DEFINITION.id, data: createTextComponentData('未选正文保持原样') }
  project.surfaces = [{ id: 'flow', kind: 'flow', title: '讲义', childIds: ['body', 'untouched'] }]
  project.global = { underlay: [], overlay: [] }
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, '代表课件.h5lesson')
  const target = { kind: 'course-instance' as const, surfaceId: 'flow', instanceId: 'body', dataPath: ['content'], from: 0, to: documentTextLength(original.content) }
  const contentOutput = prepareExecutionContentOutput(initial, target)
  assert(contentOutput, 'Product preparation must expose the rich bound output')
  const requests: Array<Record<string, unknown>> = []
  const actual = new OpenAIChatProvider({ credentialResolver: async () => credential })
  const provider: ModelProvider = { retrySafety: actual.retrySafety, async *stream(request, options) {
    const record: Record<string, unknown> = { requestId: request.requestId, requestedModel: request.selection.model,
      actualCatalog: request.tools?.map(tool => tool.name) ?? [], startedAt: new Date().toISOString() }
    requests.push(record)
    for await (const event of actual.stream(request, options)) {
      if (event.type === 'response.completed') Object.assign(record, { actualModel: event.actualModel ?? null,
        usage: event.usage ? { inputTokens: event.usage.inputTokens, outputTokens: event.usage.outputTokens, totalTokens: event.usage.totalTokens,
          reasoningTokens: event.usage.reasoningTokens, cachedInputTokens: event.usage.cachedInputTokens } : null, finishReason: event.finishReason })
      if (event.type === 'response.failed') Object.assign(record, { failure: { code: event.failure.code, kind: event.failure.kind, outcome: event.failure.outcome } })
      yield event
    }
  } }
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, files: host.agentFiles, provider,
    edits: new EditSessionService(host.registry, host.tools), runs: new ExecutionRunStore(path.join(output, 'runs')), events: new ExecutionEventStore({ directory: path.join(output, 'events') }) })
  let runId: string | undefined
  const facts: Record<string, unknown> = { route, scope: 'one representative real-provider task; no supplier-wide or visual acceptance claim', requests }
  try {
    const started = await engine.start({ conversationId: 'live-representative', taskId: 'materials-rich-rewrite', selection,
      instruction: '按本工作区资料.md改写所选段落，以3厘米与9平方厘米解释正方形面积的平方关系，保留所选内容的原链接和原公式。只修改所选正文，完成后结束任务。',
      documents: [{ documentId: initial.documentId, writable: [target], selection: [target] }], contentOutput, workspaceRoot: workspace, permission: 'workspace' })
    runId = started.runId
    const ended = await engine.wait(runId), current = await host.internalAPI.read(initial.documentId)
    Object.assign(facts, { runId, status: ended.status, failure: ended.failure ? { code: ended.failure.code, kind: ended.failure.kind, outcome: ended.failure.outcome } : null,
      tools: ended.tools.map(tool => ({ name: tool.call.name, state: tool.state, resultKind: tool.result?.kind,
        ...(tool.result?.kind === 'document-operation' ? { receiptStatus: tool.result.result.status } : {}) })), undoDepth: current.undoDepth })
    assert.equal(ended.status, 'completed')
    assert.equal(current.model.kind, 'course-v10')
    if (current.model.kind !== 'course-v10') throw new Error('V10 required')
    const content = (current.model.project.instances.body.data as TextComponentData).content
    const body = plainDocumentText(content)
    assert(body.includes('3') && body.includes('9'), 'New prose must consume the material numbers')
    assert(content.inlines.some(inline => inline.link?.href === 'https://example.org/area'), 'Existing link must survive')
    assert(content.inlines.some(inline => inline.type === 'math' && inline.formulaId === 'kept-area-formula' && inline.latex === 'x^2'), 'Existing formula identity must survive')
    assert.deepEqual(current.model.project.instances.untouched, project.instances.untouched)
    assert.deepEqual(current.model.project.instances.body.style, project.instances.body.style)
    assert(ended.tools.some(tool => ['file.read', 'material.read'].includes(tool.call.name)), 'The material must be read through an actual offered product tool')
    const filename = path.join(output, 'result.h5lesson'); await host.internalAPI.save(initial.documentId, filename)
    const reopened = await new DocumentHostService(path.join(output, 'cold-documents')).internalAPI.open(filename)
    assert.deepEqual(reopened.model, current.model)
    Object.assign(facts, { materialConsumed: true, linkPreserved: true, formulaIdentityPreserved: true, unselectedPreserved: true, savedAndColdReopened: true })
  } catch (error) { facts.validationFailure = error instanceof Error ? error.message : 'validation-failed'; process.exitCode = 1 }
  finally {
    if (runId) { await engine.stop(runId); await engine.wait(runId) }
    await fs.writeFile(path.join(output, 'evidence.json'), JSON.stringify(facts, null, 2) + '\n')
    console.log(JSON.stringify({ status: facts.status ?? 'not-started', route, evidence: path.join(output, 'evidence.json'), validationFailure: facts.validationFailure ?? null }))
  }
}
void run().catch(() => { console.error('content-revision-live: setup failed; no credential value is logged'); process.exitCode = 1 })
