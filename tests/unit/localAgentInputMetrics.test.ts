import { workspaceIdentityV1Schema } from '../../src/shared/workspaceIdentity'
import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CodexAppServerAdapter } from '../../src/main/localAgent/codexAppServer'
import { ClaudeProcessTransportAdapter } from '../../src/main/localAgent/claudeProcessTransport'
import { OpenCodeAcpAdapter } from '../../src/main/localAgent/openCodeAcp'
import { generationRequestSchema } from '../../src/shared/generationContract'
import {
  aiObservationSchema, aiTaskSchema, localAgentRecordV2Schema,
  type AiTask, type LocalAgentCliAdapterV2,
} from '../../src/shared/localAgentTaskContract'
import {
  aiTaskInputMetricsSchema, localAgentInputMetricsSchema, measureLocalAgentInput,
  recordAiTaskInputMetrics, MAX_AI_TASK_INPUT_METRICS_ENTRIES,
} from '../../src/shared/localAgentInputMetrics'
import { recordAiTaskTiming, summarizeAiTaskTiming } from '../../src/shared/localAgentTiming'

const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8')
function fixture() {
  const task = aiTaskSchema.parse({
    version: 1, taskId: randomUUID(), epoch: 0, sessionId: randomUUID(), adapter: 'codex',
    workspace: { version: 1, projectId: 'metrics-lesson', normalizedPath: 'c:/lessons/metrics.h5lesson' },
    goal: '检查标题', intent: 'discuss', applyPolicy: 'preview', readScope: { kind: 'course' },
    writeDestinations: [], status: 'running', observationId: randomUUID(), committedResultIds: [],
    execution: { startedAt: 1, deadlineAt: 1000, turnCount: 1, formatRepairs: 0, stagnantCandidates: 0,
      lastChangeKey: null, lastDiagnostic: null },
  })
  const observation = aiObservationSchema.parse({
    version: 1, taskId: task.taskId, epoch: 0, workspace: task.workspace, observationId: task.observationId,
    capturedAt: 1, documentRevision: 1, sessionGeneration: 0, draftEpoch: null, viewEpoch: null, runtime: null,
    surfaceId: 'slide', locationId: 'page', stateId: null, source: 'generation-snapshot', readScope: task.readScope, files: [],
  })
  const record = (current: AiTask) => ({
    version: 3, id: task.sessionId, adapter: 'codex', workspace: task.workspace,
    externalSessionId: null, workingDirectoryId: randomUUID(), tasks: [current], observations: [observation], hostResults: [], events: [],
  })
  return { task, observation, record }
}
function measuredPrompt(text = '检查标题') {
  const transport = { input: [{ type: 'text', text }], threadId: 'fixture' }
  return measureLocalAgentInput({ boundary: 'native-turn-params', prompt: text, transport, technicalTransport: transport })
}

/** Existing resolver seam runs a real JSONL child; no installed CLI or network is used. */
const nativeProcess = `
const fs = require('node:fs');
if (process.argv.includes('--version')) { console.log('2.1.263'); process.exit(0); }
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const wire = JSON.parse(line), { id, method, params = {} } = wire;
  fs.appendFileSync('wire.jsonl', line + '\\n');
  if (wire.request?.subtype === 'initialize') send({ type: 'control_response', response: { subtype: 'success', request_id: wire.request_id, response: { models: [] } } });
  else if (method === 'initialize') send({ id, result: { userAgent: 'codex/0.153.4', protocolVersion: 1, agentInfo: { version: '1.18.26' } } });
  else if (method === 'model/list') send({ id, result: { data: [] } });
  else if (method === 'thread/start') send({ id, result: { thread: { id: 'native-thread' } } });
  else if (method === 'session/new') send({ id, result: { sessionId: 'native-session', configOptions: [] } });
  else if (method === 'turn/start') {
    send({ id, result: { turn: { id: 'native-turn' } } });
    send({ method: 'turn/completed', params: { threadId: params.threadId, turn: { id: 'native-turn', status: 'completed' } } });
  } else if (method === 'session/prompt') send({ id, result: { stopReason: 'end_turn' } });
  else if (wire.type === 'user') send({ type: 'result', is_error: false, session_id: 'e752f780-945c-4145-a788-d8cc5bc77d76', result: 'done' });
});
process.stdin.on('end', () => process.exit(0));
`

describe('native input byte metrics', () => {
  it('closes byte counts against actual three-adapter subprocess payloads including image and output schema', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-input-metrics-'))
    const script = path.join(directory, 'native.cjs')
    await fs.writeFile(script, nativeProcess)
    const image = path.join(directory, 'observation.png')
    await fs.writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/JkAAAAASUVORK5CYII=', 'base64'))
    const resolve = async () => ({ executable: process.execPath, prefix: [script] })
    const { task } = fixture()
    const request = generationRequestSchema.parse({
      version: 1, requestId: randomUUID(), workspace: task.workspace, documentRevision: 1, sessionGeneration: 0,
      purpose: 'local-edit', instruction: '检查标题', context: {}, allowedCarriers: ['native'],
      destinations: [{ kind: 'update', target: {
        projectId: workspaceIdentityV1Schema.parse(task.workspace).projectId, documentRevision: 1, revisionPolicy: { kind: 'exact' }, sessionGeneration: 0,
        surfaceType: 'slide', surfaceId: 'slide', locationId: 'page', stateId: null, owner: 'scene', ownerKey: 'scene:page',
        itemId: 'title', authoringAddress: 'page/title',
      } }],
    })
    const adapters: LocalAgentCliAdapterV2[] = [
      new CodexAppServerAdapter({ resolve, generationRequest: request }),
      new ClaudeProcessTransportAdapter(resolve), new OpenCodeAcpAdapter(resolve),
    ]
    try {
      for (const adapter of adapters) {
        const cwd = path.join(directory, adapter.id)
        await fs.mkdir(cwd)
        await adapter.open({ cwd, externalSessionId: null })
        const prompt = '只检查“标题”\n保留 \\ 与 "引号" 🐕'
        const result = await adapter.startTurn({
          taskId: task.taskId, epoch: task.epoch, workspace: task.workspace,
          runId: randomUUID(), observationId: task.observationId!, text: prompt, imageFileIds: ['preview'],
        }, new Map([['preview', image]]))
        for await (const _event of adapter.events()) { /* Wait for the actual child to consume the payload. */ }
        const wires = (await fs.readFile(path.join(cwd, 'wire.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
        const wire = wires.find(value => adapter.id === 'codex' ? value.method === 'turn/start'
          : adapter.id === 'opencode' ? value.method === 'session/prompt' : value.type === 'user')
        expect(wire, adapter.id).toBeDefined()
        const payload = adapter.id === 'claude' ? wire : wire.params
        const technical = structuredClone(payload)
        if (adapter.id === 'codex') technical.input = technical.input.filter((item: { type: string }) => item.type !== 'localImage')
        else if (adapter.id === 'opencode') technical.prompt = technical.prompt.filter((item: { type: string }) => item.type !== 'image')
        else technical.message.content = technical.message.content.filter((item: { type: string }) => item.type !== 'image')
        const outputSchemaJsonBytes = payload.outputSchema === undefined ? 0 : jsonBytes(payload.outputSchema)
        expect(result.inputMetrics, adapter.id).toEqual({
          boundary: adapter.id === 'claude' ? 'native-user-message' : 'native-turn-params',
          promptUtf8Bytes: Buffer.byteLength(prompt, 'utf8'), promptJsonBytes: jsonBytes(prompt), outputSchemaJsonBytes,
          otherHostJsonBytes: jsonBytes(technical) - jsonBytes(prompt) - outputSchemaJsonBytes,
          hostTechnicalJsonBytes: jsonBytes(technical), imageTransportJsonBytes: jsonBytes(payload) - jsonBytes(technical),
          totalTransportJsonBytes: jsonBytes(payload),
        })
        expect(result.inputMetrics!.imageTransportJsonBytes).toBeGreaterThan(0)
        expect(outputSchemaJsonBytes > 0).toBe(adapter.id === 'codex')
        expect(JSON.stringify(result.inputMetrics)).not.toContain(prompt)
        await adapter.close()
      }
    } finally {
      for (const adapter of adapters) await adapter.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
  }, 15000)

  it('reads old metrics as unknown and rejects open schemas, unclosed bytes and contradictory identities', () => {
    const { task, record } = fixture(), metrics = measuredPrompt(), runId = randomUUID()
    expect(localAgentRecordV2Schema.parse(record(task)).tasks[0]!.execution!.inputMetrics).toBeUndefined()
    const next = recordAiTaskInputMetrics(task, task, runId, metrics)
    expect(localAgentRecordV2Schema.parse(record(next)).tasks[0]!.execution!.inputMetrics).toEqual(next.execution!.inputMetrics)
    for (const invalid of [
      { ...metrics, extra: 'secret' }, { ...metrics, promptUtf8Bytes: -1 },
      { ...metrics, totalTransportJsonBytes: metrics.totalTransportJsonBytes + 1 },
      { ...metrics, otherHostJsonBytes: metrics.otherHostJsonBytes + 1 },
      { ...metrics, boundary: 'model-tokens' },
    ]) expect(localAgentInputMetricsSchema.safeParse(invalid).success).toBe(false)
    const entry = next.execution!.inputMetrics!.entries[0]!
    expect(aiTaskInputMetricsSchema.safeParse({ version: 2, entries: [entry] }).success).toBe(false)
    expect(aiTaskInputMetricsSchema.safeParse({ version: 1, entries: [entry, entry] }).success).toBe(false)
    expect(aiTaskInputMetricsSchema.safeParse({ version: 1, entries: [entry], prompt: 'secret' }).success).toBe(false)
    expect(localAgentRecordV2Schema.safeParse(record({ ...next, execution: { ...next.execution!, inputMetrics: {
      version: 1, entries: [{ ...entry, observationId: randomUUID() }],
    } } })).success).toBe(false)
    expect(aiTaskSchema.safeParse({ ...next, execution: { ...next.execution!, timing: {
      version: 1, entries: [{ runId, observationId: randomUUID(), stage: 'turnAccepted', at: 1 }],
    } } }).success).toBe(false)

    let timed = next
    for (const [stage, at] of [['requestPrepared', 10], ['turnAccepted', 13], ['firstVisibleText', 20],
      ['resourcePreparationStarted', 22], ['resourcePrepared', 25], ['taskEnded', 40]] as const) {
      timed = recordAiTaskTiming(timed, timed, runId, stage, at)
    }
    expect(summarizeAiTaskTiming(timed)[0]!.durationsMs).toMatchObject({
      acceptedToFirstVisibleText: 7, resourcePreparation: 3, preparedToTaskEnded: 30,
      candidateParsedToHostCommitRecorded: null,
    })
    expect(summarizeAiTaskTiming(next)).toEqual([])
  })

  it('records two rounds once each and refuses stale workspace, epoch, observation and full-buffer writes', () => {
    const { task } = fixture(), firstRun = randomUUID(), secondRun = randomUUID(), metrics = measuredPrompt()
    const first = recordAiTaskInputMetrics(task, task, firstRun, metrics)
    expect(recordAiTaskInputMetrics(first, first, firstRun, measuredPrompt('不能覆盖第一次计数'))).toBe(first)
    for (const identity of [
      { ...first, taskId: randomUUID() }, { ...first, epoch: first.epoch + 1 },
      { ...first, observationId: randomUUID() },
      { ...first, workspace: { ...first.workspace, normalizedPath: 'c:/lessons/other.h5lesson' } },
    ]) expect(recordAiTaskInputMetrics(first, identity, secondRun, metrics)).toBe(first)
    expect(recordAiTaskInputMetrics(first, first, 'bad-run-id', metrics)).toBe(first)
    const continued = { ...first, observationId: randomUUID() }
    expect(recordAiTaskInputMetrics(continued, continued, firstRun, metrics)).toBe(continued)
    const second = recordAiTaskInputMetrics(continued, continued, secondRun, measuredPrompt('第二轮'))
    expect(second.execution!.inputMetrics!.entries.map(entry => [entry.runId, entry.observationId])).toEqual([
      [firstRun, first.observationId], [secondRun, continued.observationId],
    ])
    expect(recordAiTaskTiming(second, { ...second, observationId: first.observationId }, secondRun, 'turnAccepted', 5)).toBe(second)
    let full = first
    for (let index = 1; index < MAX_AI_TASK_INPUT_METRICS_ENTRIES; index++) full = recordAiTaskInputMetrics(full, full, randomUUID(), metrics)
    expect(full.execution!.inputMetrics!.entries).toHaveLength(MAX_AI_TASK_INPUT_METRICS_ENTRIES)
    expect(recordAiTaskInputMetrics(full, full, randomUUID(), metrics)).toBe(full)
    expect(aiTaskInputMetricsSchema.safeParse({ version: 1, entries: [
      ...full.execution!.inputMetrics!.entries, { runId: randomUUID(), observationId: full.observationId, metrics },
    ] }).success).toBe(false)
  })
})
