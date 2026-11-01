import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { HTML_PROGRAM_DEFINITION } from '../../src/components/web/data'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { ComponentProjectFileCoordinator, type ComponentProjectSnapshot } from '../../src/core/projectFiles/componentPlatform/coordinator'
import { planContentApply } from '../../src/main/workbench/contentApply/application/plan'
import { modelToolResult } from '../../src/core/tools/modelToolResult'
import { ExecutionModelImageProjection } from '../../src/main/workbench/execution/ExecutionModelImageProjection'
import { hostWorkFactSignature } from '../../src/main/workbench/execution/hostWorkFacts'
import { serializeChatGPTResponsesRequest } from '../../src/main/workbench/providers/ChatGPTResponsesProvider'
import type { ExecutionCompletionIssue } from '../../src/main/workbench/execution/executionOutcome'
import type { ModelChatMessage, ModelSelection } from '../../src/shared/workbench/modelProvider'
import type { DocumentModel } from '../../src/shared/workbench/document'
import { testContainerInstance } from './glxWorkFixture'

const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const reduction = (before: number, after: number) => ({ before, after, saved: before - after, fraction: before > 0 ? (before - after) / before : null })
type CourseModel = Extract<DocumentModel, { kind: 'course-v10' }>
export function payloadCostProjectFixture(): CourseModel {
  const project = createBlankCourseProjectV10('W7 payload cost fixture')
  project.definitions[HTML_PROGRAM_DEFINITION.id] = HTML_PROGRAM_DEFINITION
  const modules = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`scenes/scene-${index + 1}.js`,
    `${index === 0 ? 'export const TARGET_VALUE = 1;\n' : ''}` + Array.from({ length: 128 }, (_, line) =>
      `export const note_${line} = "场景${index + 1}的第${line + 1}条可编辑说明，保留邻近稿件与交互参数。";`).join('\n')]))
  project.instances.web = { id: 'web', definitionId: HTML_PROGRAM_DEFINITION.id, data: {
    html: '<h1>Fixed title</h1><script type="module" src="./scenes/scene-1.js"></script>', modules } }
  testContainerInstance(project, 0).childIds.push('web')
  return { kind: 'course-v10', project, resources: { assets: {}, components: {} } }
}

/** Uses current projection, paginated reader, content planner and canonical Session.
 * Every leg edits a private in-memory copy; source archives are never rewritten. */
export async function measureModulePayload(input: { model: CourseModel; instanceId?: string; modulePath?: string; oldText?: string; newText?: string }) {
  const before = structuredClone(input.model), files = componentProjectFiles(before.project, before.resources)
  const module = files.find(file => file.webModule && file.target?.kind === 'instance'
    && (!input.instanceId || file.target.instanceId === input.instanceId) && (!input.modulePath || file.webModule.path === input.modulePath))
  assert(module?.webModule && module.target?.kind === 'instance', 'Select an existing author module')
  const targetId = module.target.instanceId, dataFile = files.find(file => file.kind === 'data' && file.path.endsWith('.data.json')
    && file.target?.kind === 'instance' && file.target.instanceId === targetId)
  assert(dataFile?.content !== undefined && module.content !== undefined)
  const oldText = input.oldText ?? 'TARGET_VALUE = 1', newText = input.newText ?? 'TARGET_VALUE = 2'
  assert(oldText.length > 0 && module.content.split(oldText).length === 2, 'Measured edit must have exactly one source match')
  const updatedModule = module.content.replace(oldText, newText)
  const wholeData = JSON.parse(dataFile.content) as { modules: Record<string, string> }
  wholeData.modules[module.webModule.path] = updatedModule
  const legs = [
    { label: 'whole-author-data', path: dataFile.path, input: { path: dataFile.path, content: JSON.stringify(wholeData, null, 2) } },
    { label: 'single-module-content', path: module.path, input: { path: module.path, content: updatedModule } },
    { label: 'single-module-patch', path: module.path, input: { path: module.path, edits: [{ old: oldText, new: newText }] } },
  ]
  const measured = [], resultingModels: CourseModel[] = []
  for (const leg of legs) {
    const session = await DocumentSession.create({ documentId: 'w7-copy', epoch: 'fixed-epoch', binding: { kind: 'untitled', suggestedName: 'w7.glx' },
      model: structuredClone(before) }, new CourseV10Driver(), { async append() {}, async save() { throw new Error('Payload fixture cannot publish files') } })
    const snapshot = () => session.read() as ComponentProjectSnapshot
    const coordinator = new ComponentProjectFileCoordinator({ document: async () => snapshot(),
      source: async () => { throw new Error('No external source in byte comparison') },
      apply: async (runId, operationId, _digest, baseline, request) => {
        if (request.intent !== 'content') throw new Error('Module payload fixture expects the existing content-change owner')
        const plan = planContentApply({ project: baseline.model.project, request, createId: () => 'unexpected-object' })
        const receipt = await session.execute({ documentId: baseline.documentId, epoch: baseline.epoch, baseRevision: snapshot().revision,
          operationId, actor: 'agent', mutation: { type: 'command', command: plan.command } }, { rebaseComponentExpectations: true })
        if (receipt.status === 'applied') coordinator.acknowledge(runId, baseline.documentId, baseline.epoch, receipt.revision, plan.command)
        return { commit: receipt.status === 'applied' ? 'committed' : 'not_committed', usability: 'usable', delivery: 'not_requested',
          input: request, diagnostics: [], insertedIds: [], receipt }
      } })
    let offset = 0, readRequestBytes = 0, readResultBytes = 0, readPages = 0, source = ''
    for (;;) {
      const request = { name: 'project.read' as const, input: { path: leg.path, ...(offset ? { offset } : {}) } }
      const result = await coordinator.execute('w7-run', `read-${++readPages}`, `read-${readPages}`, request.name, request.input)
      assert.equal(result.kind, 'read')
      if (result.kind !== 'read') throw new Error('Reader failed')
      const data = result.data as { content: string; hasMore: boolean; nextOffset?: number }
      assert.equal(typeof data.content, 'string'); source += data.content
      readRequestBytes += jsonBytes(request); readResultBytes += jsonBytes(modelToolResult('project.read', result))
      if (!data.hasMore) break
      assert(data.nextOffset !== undefined && data.nextOffset > offset, 'Reader must make progress')
      offset = data.nextOffset
    }
    assert.equal(source, leg.path === dataFile.path ? dataFile.content : module.content)
    const writeRequest = { name: 'project.apply' as const, input: leg.input }
    const applied = await coordinator.execute('w7-run', 'write', 'write', writeRequest.name, writeRequest.input)
    assert(applied.kind === 'read' && (applied.data as { commit: string }).commit === 'committed')
    const after = snapshot(); assert.equal(after.undoDepth, 1)
    const expected = structuredClone(before)
    ;(expected.project.instances[targetId]!.data as { modules: Record<string, string> }).modules[module.webModule.path] = updatedModule
    expected.project.revision = after.model.project.revision
    assert.deepEqual(after.model, expected, 'A payload leg changed unrelated content or author state')
    resultingModels.push(after.model)
    measured.push({ label: leg.label, readPages, readSourceBytes: Buffer.byteLength(source), readRequestBytes, readResultBytes,
      writeRequestBytes: jsonBytes(writeRequest), writeResultBytes: jsonBytes(modelToolResult('project.apply', applied)),
      totalReadWriteBytes: readRequestBytes + readResultBytes + jsonBytes(writeRequest) + jsonBytes(modelToolResult('project.apply', applied)) })
  }
  assert.deepEqual(resultingModels[0], resultingModels[1]); assert.deepEqual(resultingModels[0], resultingModels[2])
  // Normalize only the clone carrier on both sides: archived resource maps may
  // have null prototypes. Structured clone retains all model fields and typed
  // resource bytes, which strict deep comparison still checks in full.
  assert.deepEqual(structuredClone(input.model), before)
  return { source: { kind: 'current-owner-private-copy', moduleCount: Object.keys(wholeData.modules).length,
    selectedModuleSourceSha256: hash(module.content), originalAuthorDataSha256: hash(dataFile.content) }, legs: measured,
    contentReduction: reduction(measured[0]!.totalReadWriteBytes, measured[1]!.totalReadWriteBytes),
    patchReduction: reduction(measured[0]!.totalReadWriteBytes, measured[2]!.totalReadWriteBytes),
    sameCanonicalResult: true, sourceUntouched: true,
    scope: 'JSON request/receipt payload bytes including all read pages; no token, timing or paid-request savings are inferred.' }
}
const costSelection: ModelSelection = { model: 'gpt-6.1-terra', parameters: { reasoning: { effort: 'xhigh' } }, connection: {
  id: 'fixture', revision: 1, provider: 'openai', protocol: 'chatgpt-responses', baseURL: 'https://chatgpt.com/backend-api/codex',
  accountId: 'fixture', auth: { kind: 'oauth', credentialRef: 'fixture' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'supported' } } }
export async function measureImagePayload(source?: { bytes: Uint8Array; mimeType: string }) {
  const bytes = source?.bytes ?? await sharp({ create: { width: 3072, height: 1536, channels: 4, background: '#fcfdf8' } })
    .composite([{ input: Buffer.from('<svg width="3072" height="1536"><path d="M0 0L3072 1536M0 1536L3072 0" stroke="#19433d" stroke-width="2"/></svg>') }])
    .png({ compressionLevel: 0 }).toBuffer()
  const mimeType = source?.mimeType ?? 'image/png', originalHash = hash(bytes)
  const message: ModelChatMessage = { role: 'user', content: [{ type: 'text', text: 'Read this authorized observation.' },
    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}` } }] }
  const originals = [message], before = serializeChatGPTResponsesRequest({ selection: costSelection, messages: originals })
  const projected = await new ExecutionModelImageProjection().project(originals, { runId: 'w7-cost', originals })
  const after = serializeChatGPTResponsesRequest({ selection: costSelection, messages: projected })
  assert.equal(hash(bytes), originalHash)
  assert.equal(serializeChatGPTResponsesRequest({ selection: costSelection, messages: originals }), before)
  return { source: source ? 'supplied-image-read-only' : 'generated-deterministic-diagram-fixture', originalSha256: originalHash,
    originalImageBytes: bytes.byteLength, providerBody: reduction(Buffer.byteLength(before), Buffer.byteLength(after)),
    derivativeApplied: projected[0] !== originals[0], originalRetainedExactly: true,
    scope: 'Actual current OAuth serializer body bytes, including representation metadata and original-read address; no model call.' }
}
export function measureHostFactPayload() {
  const base: ExecutionCompletionIssue = { callId: 'create-job', name: 'delegate.agent', status: 'pending',
    kind: 'delegation', job: 'delegate-one', message: '正在形成候选' }
  const captures = Array.from({ length: 20 }, (_, index) => [{ ...base, requestId: `request-${index}`, receiptCallId: `poll-${index}` }])
  captures.push([{ ...base, status: 'unverified', message: '候选完成，等待回读', requestId: 'request-final', receiptCallId: 'poll-final' }])
  let rawSignature = '', projectedSignature = '', before = 0, after = 0, beforeCount = 0, afterCount = 0
  for (const issues of captures) {
    const fragment = { currentWork: { remainingOperations: issues } }, raw = JSON.stringify(issues)
    const projected = hostWorkFactSignature('remainingOperations', issues)
    if (raw !== rawSignature) { before += jsonBytes(fragment); beforeCount++; rawSignature = raw }
    if (projected !== projectedSignature) { after += jsonBytes(fragment); afterCount++; projectedSignature = projected }
  }
  assert.equal(afterCount, 2)
  assert.notEqual(hostWorkFactSignature('remainingOperations', [{ ...base, status: 'unknown', receiptCallId: 'unknown-a' }]),
    hostWorkFactSignature('remainingOperations', [{ ...base, status: 'unknown', receiptCallId: 'unknown-b' }]))
  return { captures: captures.length, beforeAppendedFragments: beforeCount, afterAppendedFragments: afterCount,
    serializedHostFactFragments: reduction(before, after), statusChangeRetained: true, distinctUnknownReceiptsRetained: true,
    scope: 'Exact currentWork JSON fragments selected by the production fact-signature owner; raw tool receipts stay retained. Not total Engine request bytes.' }
}
export async function collectZeroModelPayloadCosts(input?: Parameters<typeof measureModulePayload>[0]) {
  return { version: '20261031-v1', mode: 'zero-model', providerCalls: 0,
    module: await measureModulePayload(input ?? { model: payloadCostProjectFixture(), instanceId: 'web', modulePath: 'scenes/scene-1.js' }),
    image: await measureImagePayload(), hostFacts: measureHostFactPayload(),
    limitations: ['Synthetic deterministic baseline unless a real archive is explicitly supplied; this does not measure the old 51-minute task.',
      'All legs use current real owners and exact serialized bytes. Timing, quality and billed tokens require separate evidence.'] }
}
