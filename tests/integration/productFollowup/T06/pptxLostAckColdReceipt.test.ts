// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import PptxGenJS from 'pptxgenjs'
import { expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../../../src/main/workbench/execution/ExecutionEventStore'
import { WorkspaceCreationOutcomeUnknown } from '../../../../src/main/workbench/WorkspaceFiles'
import { AgentFileOutcomeUnknown } from '../../../../src/core/tools/AgentFileTools'
import { documentDigest } from '../../../../src/core/documents/documentDigest'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { createCourseProjectV10Archive, openCourseProjectV10Archive } from '../../../../src/core/drivers/codecs/courseProjectV10Archive'
import type { HostToolServices } from '../../../../src/core/tools/HostToolServices'
import type { ExecutionRunRecord } from '../../../../src/shared/workbench/execution'
import type { ToolResult } from '../../../../src/shared/workbench/tools'
import type { ModelEvent, ModelProvider, ModelSelection } from '../../../../src/shared/workbench/modelProvider'

const selection: ModelSelection = { model: 'controlled-pptx-receipt', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
  baseURL: 'https://fixture.invalid/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'unused' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unsupported' } } }

it('cold Engine lookup settles a PPTX create whose ACK was lost without converting creating reopening or renewing stopped authority', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T06-pptx-cold-ack-'))
  let releaseAck: () => void = () => {}, engine: ExecutionEngine | undefined
  try {
    const workspace = path.join(directory, 'workspace'), hostDirectory = path.join(directory, 'documents')
    await fs.mkdir(workspace)
    const source = path.join(workspace, 'source.pptx'), destination = path.join(workspace, 'imported.glx')
    const pptx = new PptxGenJS()
    pptx.addSlide().addText('Original teacher slide', { x: 1, y: 1, w: 4, h: 1 })
    await pptx.writeFile({ fileName: source })
    const project = createBlankCourseProjectV10('Converted once')
    const archiveBytes = createCourseProjectV10Archive({ project, resources: { assets: {}, components: {} } })
    // Only conversion is controlled here. The real converter/editability/GUI carrier is covered by T06 publicPptxImport.
    const convert = vi.fn(async (input: { name: string; bytes: Uint8Array }) => {
      expect(input.name).toBe('source.pptx')
      expect(input.bytes.byteLength).toBeGreaterThan(100)
      return { archiveBytes, issues: [] as Array<{ page?: number; type: string; message: string }> }
    })
    const port = (owner: DocumentHostService): NonNullable<HostToolServices['pptxImport']> => ({
      import: async ({ grant, operationId, requestDigest, path: sourcePath, destination: target, assertActive }) => {
        const access = grant.fileAccess!
        const context = { runId: grant.runId, workspaceRoot: access.workspaceRoot!, permission: access.permission, assertActive }
        const input = await owner.agentFiles.readAuthorizedFile(context, sourcePath)
        const prepared = await convert(input)
        assertActive()
        const filename = path.resolve(context.workspaceRoot, target!)
        const outcome = await owner.agentFiles.createPreparedCourse(context, { path: path.dirname(filename), name: path.basename(filename), bytes: prepared.archiveBytes },
          operationId, { requestDigest, issues: prepared.issues })
        return { kind: 'read', data: { ...(outcome.data as Record<string, unknown>), status: 'saved', issues: prepared.issues } }
      },
      lookup: async (runId, operationId, requestDigest) => {
        const outcome = await owner.agentFiles.lookupPreparedCourse(runId, operationId, requestDigest)
        return outcome ? { kind: 'read', data: outcome.data } : null
      },
    })
    const host = new DocumentHostService(hostDirectory)
    host.tools.configureHostServices({ pptxImport: port(host) })
    const create = vi.spyOn(host.files, 'createFile'), preparedCreate = vi.spyOn(host.agentFiles, 'createPreparedCourse')
    const runs = new ExecutionRunStore(path.join(directory, 'runs')), crashRuns = new ExecutionRunStore(path.join(directory, 'crash-runs'))
    const events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
    let modelCalls = 0, created = false, originalResult: ToolResult | undefined, crash: ExecutionRunRecord | undefined
    const ackHold = new Promise<void>(resolve => { releaseAck = resolve })
    const execute = host.tools.execute.bind(host.tools)
    vi.spyOn(host.tools, 'execute').mockImplementation(async (runId, callId, call) => {
      const result = await execute(runId, callId, call)
      if (call.name !== 'course.importPptx') return result
      expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read', data: { status: 'saved', path: destination, operation: { status: 'success' } } })
      originalResult = result
      // Capture the real executing checkpoint before Engine sees the successful Gateway return.
      crash = (await runs.read(runId))!
      expect(crash.tools).toHaveLength(1)
      expect(crash.tools[0]).toMatchObject({ callId, state: 'executing', call })
      expect(crash.tools[0].result).toBeUndefined()
      await crashRuns.save(crash)
      created = true
      await ackHold
      throw Object.assign(new Error('Controlled loss of ACK after actual PPTX course publication'), { code: 'tool-outcome-unknown' })
    })
    const provider: ModelProvider = { async *stream(request) {
      modelCalls++
      expect(modelCalls).toBe(1)
      expect(request.tools?.map(tool => tool.name)).toContain('course.importPptx')
      const input = { path: 'source.pptx', destination: 'imported.glx' }, callId = `call-${request.requestId}`
      yield { type: 'response.completed', requestId: request.requestId, sequence: 1, responseId: request.requestId, actualModel: selection.model,
        nativeResponse: {}, finishReason: 'tool_calls', toolCalls: [{ id: callId, name: 'course.importPptx', argumentsText: JSON.stringify(input) }],
        assistant: { role: 'assistant', content: '', tool_calls: [{ id: callId, type: 'function', function: { name: 'course.importPptx', arguments: JSON.stringify(input) } }] } } satisfies ModelEvent
    } }
    engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, files: host.agentFiles, provider, runs, events })
    const start = await engine.start({ conversationId: 'conversation', taskId: 'original-pptx-import', instruction: '导入 source.pptx 为 imported.glx',
      documents: [], workspaceRoot: workspace, permission: 'workspace', selection })
    await expect.poll(() => created).toBe(true)
    expect(convert).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
    expect(preparedCreate).toHaveBeenCalledTimes(1)
    expect(openCourseProjectV10Archive(new Uint8Array(await fs.readFile(destination))).project.title).toBe('Converted once')
    expect((await fs.readdir(workspace)).filter(name => name.endsWith('.glx'))).toEqual(['imported.glx'])
    const stopping = engine.stop(start.runId)
    releaseAck()
    expect((await stopping)?.status).toBe('stopped')
    await events.flushPending()
    if (!crash || originalResult?.kind !== 'read') throw new Error('No real executing crash slice or successful original publication')
    const tool = crash.tools[0]
    const operationId = host.tools.operationIdentity(crash.runId, tool.callId)
    expect(create.mock.calls[0][0]).toMatchObject({ operationId, creationReceipt: { runId: crash.runId, requestDigest: expect.any(String) } })
    const cold = new DocumentHostService(hostDirectory)
    cold.tools.configureHostServices({ pptxImport: port(cold) })
    const coldCreate = vi.spyOn(cold.files, 'createFile'), coldPreparedCreate = vi.spyOn(cold.agentFiles, 'createPreparedCourse'), coldOpen = vi.spyOn(cold, 'open')
    const coldProvider: ModelProvider = { async *stream() { throw new Error('Historical receipt recovery must not call a model') } }
    const coldEngine = new ExecutionEngine({ registry: cold.registry, gateway: cold.tools, files: cold.agentFiles, provider: coldProvider, runs: crashRuns,
      events: new ExecutionEventStore({ directory: path.join(directory, 'cold-events') }) })
    await coldEngine.recover(crash.runId)
    const recovered = (await crashRuns.read(crash.runId))!
    expect(recovered.tools[0]).toMatchObject({ state: 'returned', result: { kind: 'read', data: { status: 'saved', historical: true,
      currentContentVerified: false, path: destination, operation: { status: 'success' }, issues: [] } } })
    const lookup = await cold.tools.lookup(crash.runId, tool.callId, tool.call)
    expect(lookup).toEqual(recovered.tools[0].result)
    if (lookup?.kind !== 'read') throw new Error('Missing historical create receipt')
    expect(lookup.data).toMatchObject({ operation: { operationId } })
    expect(lookup.data).not.toHaveProperty('documentId')
    expect(lookup.data).not.toHaveProperty('target')
    expect(lookup.data).not.toHaveProperty('opened')
    for (const item of (lookup.data as { operation: { items: unknown[] } }).operation.items) {
      expect(item).not.toHaveProperty('entryId')
      expect(item).not.toHaveProperty('sourceEntryId')
    }
    expect(await cold.tools.lookup(crash.runId, tool.callId, { ...tool.call, input: { path: 'source.pptx', destination: 'different.glx' } }))
      .toMatchObject({ kind: 'error', code: 'operation-payload-mismatch' })
    expect(cold.registry.list()).toHaveLength(0)
    expect(cold.tools.runtimeCounts(crash.runId)).toMatchObject({ activeRuns: 0, handles: 0, operationLeases: 0, host: { runs: 0 } })
    expect(await cold.tools.execute(crash.runId, 'new-write', { name: 'file.create', input: { name: 'must-not-exist.txt', kind: 'text' } }))
      .toMatchObject({ kind: 'error', code: 'run-stopped' })
    const human = createBlankCourseProjectV10('Later human replacement')
    await fs.writeFile(destination, createCourseProjectV10Archive({ project: human, resources: { assets: {}, components: {} } }))
    expect(await cold.tools.lookup(crash.runId, tool.callId, tool.call)).toEqual(lookup)
    expect(openCourseProjectV10Archive(new Uint8Array(await fs.readFile(destination))).project.title).toBe('Later human replacement')
    await fs.unlink(destination)
    expect(await cold.tools.lookup(crash.runId, tool.callId, tool.call)).toEqual(lookup)
    expect(await fs.readdir(workspace)).toEqual(['source.pptx'])
    expect(cold.registry.list()).toHaveLength(0)
    expect(cold.tools.runtimeCounts(crash.runId)).toMatchObject({ activeRuns: 0, handles: 0, operationLeases: 0, host: { runs: 0 } })
    expect(convert).toHaveBeenCalledTimes(1)
    expect(modelCalls).toBe(1)
    expect(coldCreate).not.toHaveBeenCalled()
    expect(coldPreparedCreate).not.toHaveBeenCalled()
    expect(coldOpen).not.toHaveBeenCalled()
  } finally {
    releaseAck()
    await engine?.shutdown()
    vi.restoreAllMocks()
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe cleanup')
    await fs.rm(directory, { recursive: true, force: true })
  }
}, 15_000)

it('a creation receipt write failure stays unknown after publication and preserves the actual course without reopening or returning an ordinary failed create', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T06-pptx-receipt-write-failure-'))
  try {
    const workspace = path.join(directory, 'workspace'), hostDirectory = path.join(directory, 'documents')
    await fs.mkdir(workspace)
    const host = new DocumentHostService(hostDirectory), runId = 'receipt-failure-run', callId = 'original-create'
    const call = { name: 'course.importPptx', input: { path: 'source.pptx', destination: 'retained.glx' } }
    const operationId = host.tools.operationIdentity(runId, callId), requestDigest = documentDigest(call)
    const destination = path.join(workspace, call.input.destination), receiptDirectory = path.join(hostDirectory, 'creation-receipts')
    const project = createBlankCourseProjectV10('Published before receipt failure')
    const bytes = createCourseProjectV10Archive({ project, resources: { assets: {}, components: {} } })
    const rename = fs.rename.bind(fs)
    let receiptWrites = 0
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (path.dirname(String(to)) === receiptDirectory) {
        receiptWrites++
        throw Object.assign(new Error('Controlled receipt disk-full after actual publication'), { code: 'ENOSPC' })
      }
      return rename(from, to)
    })
    const create = vi.spyOn(host.files, 'createFile'), open = vi.spyOn(host, 'open')
    const publication = host.agentFiles.createPreparedCourse({ runId, workspaceRoot: workspace, permission: 'workspace', assertActive: () => {} },
      { name: call.input.destination, bytes }, operationId, { requestDigest, issues: [] })
    await expect(publication).rejects.toBeInstanceOf(AgentFileOutcomeUnknown)
    expect(receiptWrites).toBe(1)
    expect(create).toHaveBeenCalledTimes(1)
    const ownerOutcome = await (create.mock.results[0].value as Promise<unknown>).catch(error => error)
    expect(ownerOutcome).toBeInstanceOf(WorkspaceCreationOutcomeUnknown)
    expect(ownerOutcome).toMatchObject({ code: 'tool-outcome-unknown' })
    expect(openCourseProjectV10Archive(new Uint8Array(await fs.readFile(destination))).project.title).toBe('Published before receipt failure')
    expect(await fs.readdir(workspace)).toEqual(['retained.glx'])
    expect(host.registry.list()).toHaveLength(0)
    expect(open).not.toHaveBeenCalled()
    const cold = new DocumentHostService(hostDirectory), coldCreate = vi.spyOn(cold.files, 'createFile')
    expect(await cold.agentFiles.lookupPreparedCourse(runId, operationId, requestDigest)).toBeNull()
    expect(coldCreate).not.toHaveBeenCalled()
    expect(cold.registry.list()).toHaveLength(0)
    expect(openCourseProjectV10Archive(new Uint8Array(await fs.readFile(destination))).project.title).toBe('Published before receipt failure')
  } finally {
    vi.restoreAllMocks()
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe cleanup')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
