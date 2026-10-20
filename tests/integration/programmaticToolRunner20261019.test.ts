// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ProgrammaticToolRunner, projectProgrammaticModelResult, readProgrammaticResult } from '../../src/main/workbench/execution/ProgrammaticToolRunner'
import { estimateSerializedTokens } from '../../src/core/execution/modelContextBudget'
import type { ProgrammaticJournalEntry, ProgrammaticReceipt } from '../../src/shared/workbench/programmatic'
import type { ToolResult } from '../../src/shared/workbench/tools'

const scratch: string[] = []
afterEach(async () => { for (const directory of scratch.splice(0)) await fs.rm(directory, { recursive: true, force: true }) })

describe('PTC model result projection', () => {
  it('preserves mechanical reads and exact raw write receipts while giving the model a pageable value and actual child facts', async () => {
    let runId = 'projection-run', callId = 'projection-parent'
    let sources: ProgrammaticJournalEntry[]
    const frozen = process.env.PTC_FROZEN_RUN_PATH
    if (frozen) {
      const record = JSON.parse(await fs.readFile(frozen, 'utf8'))
      const parent = record.tools.findLast((entry: ProgrammaticJournalEntry) => entry.call.name === 'programmatic.execute')
      runId = record.runId; callId = parent.callId
      sources = record.tools.filter((entry: ProgrammaticJournalEntry) => entry.callId.startsWith(`${callId}:ptc:`))
      expect(JSON.stringify(parent.result).length).toBeGreaterThan(30_000_000)
    } else {
      const body = 'mechanical audio source '.repeat(1000)
      const receipt = { status: 'applied', documentId: 'document', operationId: 'committed-once', beforeRevision: 9, revision: 10,
        persistence: 'recoverable', appliedChanges: { changes: [{ type: 'instance.data.set', value: body }], affectedTargets: ['instance'] } }
      const operation = { kind: 'read', data: { path: 'pages/current.content.html', commit: 'committed', usability: 'partial', delivery: 'not_requested',
        input: { intent: 'content', target: { kind: 'instance', instanceId: 'instance' }, source: { kind: 'html', html: body } },
        diagnostics: [{ level: 'warning', code: 'owner-diagnostic', message: 'Actual owner diagnosis' }], insertedIds: [], receipt } } as ToolResult
      sources = [1, 2, 3, 4].map(index => ({ callId: `${callId}:ptc:${index}`, call: { name: 'file.read', input: {} },
        result: { kind: 'read', data: { text: body, total: body.length, truncated: false } } }))
      sources.push({ callId: `${callId}:ptc:5`, call: { name: 'project.apply', input: {} }, result: { kind: 'read', data: {
        commit: 'committed', usability: 'partial', delivery: 'not_requested', diagnostics: (operation as any).data.diagnostics,
        insertedIds: [], receipt, operations: [operation, operation, operation, operation] } } })
    }
    const seenLengths: number[] = [], records: ProgrammaticJournalEntry[] = []
    const runner = new ProgrammaticToolRunner({ execute: async input => {
      for (const entry of sources.filter(entry => entry.call.name === 'file.read')) {
        const result = await input.call('file.read', entry.call.input)
        seenLengths.push((result as any).data.text.length)
      }
      return { status: 'completed', value: await input.call('project.apply', sources.at(-1)!.call.input) }
    } })
    const raw = await runner.execute({ runId, callId, code: 'mechanical read then apply; return the original receipt', definitions: [],
      executeTool: async (childId, call) => {
        const source = sources[records.length]!
        expect(call.name).toBe(source.call.name)
        records.push({ callId: childId, call, result: source.result })
        return source.result!
      } })
    const parent: ProgrammaticJournalEntry = { callId, call: { name: 'programmatic.execute', input: {} }, result: raw }
    records.unshift(parent)
    const projection = projectProgrammaticModelResult(parent, records)!
    const rawData = (raw as any).data as ProgrammaticReceipt, view = (projection as any).data
    expect(seenLengths).toEqual(sources.filter(entry => entry.call.name === 'file.read').map(entry => (entry.result as any).data.text.length))
    expect(JSON.stringify(rawData.value) === JSON.stringify(sources.at(-1)!.result)).toBe(true)
    expect(view).not.toHaveProperty('value')
    expect(view).toMatchObject({ status: 'completed', atomic: false, read: { runId, callId }, failures: [],
      valueRead: { tool: 'programmatic.read', input: { runId, callId, path: ['data', 'value'] } } })
    expect(view.children.slice(0, 4).every((child: any) => child.result === undefined)).toBe(true)
    expect(view.children.at(-1).result).toMatchObject({ kind: 'read', data: { commit: 'committed', usability: 'partial',
      receipt: { status: 'applied', beforeRevision: 9, revision: 10 }, diagnostics: expect.any(Array) } })
    expect(JSON.stringify(view.children.at(-1).result)).not.toContain('"value":')
    expect(view.children.at(-1).result.data.diagnostics).toEqual((sources.at(-1)!.result as any).data.diagnostics)
    const readPath = ['data', 'value', 'data', 'operations', 0, 'data', 'input', 'source', 'html']
    const original = (rawData.value as any).data.operations[0].data.input.source.html as string
    expect(readProgrammaticResult({ ...view.valueRead.input, path: readPath, offset: 117, limit: 79 }, records))
      .toMatchObject({ kind: 'read', data: { value: original.slice(117, 196), offset: 117, total: original.length, nextOffset: 196 } })
    expect(estimateSerializedTokens(JSON.stringify(projection))).toBeLessThan(10_000)
    expect(JSON.stringify(projection).length).toBeLessThan(32_000)
  })

  it('leaves small values unchanged and does not infer child receipts from arbitrary large authored JSON', () => {
    const entry = (value: unknown): ProgrammaticJournalEntry => ({ callId: 'parent', call: { name: 'programmatic.execute', input: {} },
      result: { kind: 'read', data: { status: 'completed', atomic: false, read: { runId: 'run', callId: 'parent' }, children: [], failures: [], value } } })
    const small = entry({ kind: 'read', data: { commit: 'committed', diagnostics: ['authored text'] } })
    expect(projectProgrammaticModelResult(small, [small])).toBe(small.result)
    const large = entry({ kind: 'read', data: { commit: 'committed', receipt: { appliedChanges: { value: 'authored'.repeat(8000) } } } })
    const view = (projectProgrammaticModelResult(large, [large]) as any).data
    expect(view.children).toEqual([]); expect(view).not.toHaveProperty('value')
    const read = readProgrammaticResult(view.valueRead.input, [large]) as any
    expect(read.data.complete).toBe(false)
    expect(JSON.stringify(read).length).toBeLessThan(25_000)
    expect(readProgrammaticResult(view.valueRead.input, [large], { internal: true })).toMatchObject({ kind: 'read', data: { value: (large.result as any).data.value } })
  })
})

describe('PTC in its real sandbox carrier and canonical Gateway/Session', () => {
  it('retires an unawaited pure read, retains completed work and ignores its late completion', async () => {
    let release!: (result: ToolResult) => void
    const hanging = new Promise<ToolResult>(resolve => { release = resolve })
    const runner = new ProgrammaticToolRunner({ execute: async input => {
      void input.call('read', { hanging: true }).catch(() => undefined)
      await input.call('read', { hanging: false })
      return { status: 'completed', value: 'retained aggregate' }
    } })
    const result = await runner.execute({ runId: 'run', callId: 'unawaited-read', code: '', definitions: [],
      executeTool: async (_id, call) => (call.input as any).hanging ? hanging : { kind: 'read', data: 'already complete' } })
    expect(result).toMatchObject({ kind: 'error', data: { status: 'partial', value: 'retained aggregate',
      children: [{ status: 'cancelled' }, { status: 'completed' }] } })
    const before = structuredClone(result)
    release({ kind: 'read', data: 'late source' })
    await Promise.resolve(); await Promise.resolve()
    expect(result).toEqual(before)
  })

  it('does not await or replay a started write whose result remains unknown when the script ends', async () => {
    let release!: (result: ToolResult) => void, writes = 0
    const original = new Promise<ToolResult>(resolve => { release = resolve })
    const runner = new ProgrammaticToolRunner({ execute: async input => {
      void input.call('text.replace', { content: 'exact first input' }).catch(() => undefined)
      await Promise.resolve(); await Promise.resolve()
      return { status: 'completed', value: 'other independent work' }
    } })
    const result = await runner.execute({ runId: 'run', callId: 'unknown-write', code: '', definitions: [],
      executeTool: async () => { writes++; return original } })
    expect(result).toMatchObject({ kind: 'error', data: { status: 'partial', children: [{ status: 'unknown',
      read: { runId: 'run', callId: 'unknown-write:ptc:1' } }] } })
    expect(writes).toBe(1)
    const before = structuredClone(result)
    release({ kind: 'read', data: 'actual late write receipt remains owned by Engine' })
    await Promise.resolve(); await Promise.resolve()
    expect(result).toEqual(before)
  })

  it.each(['read', 'text.replace'])('settles an unstarted %s behind a hanging write before that write returns', async queuedName => {
    let entered!: () => void, release!: (result: ToolResult) => void, invoked = 0
    const started = new Promise<void>(resolve => { entered = resolve })
    const original = new Promise<ToolResult>(resolve => { release = resolve })
    const runner = new ProgrammaticToolRunner({ execute: async input => {
      void input.call('text.replace', { content: 'first started write' }).catch(() => undefined)
      void input.call(queuedName, { content: 'must remain unstarted' }).catch(() => undefined)
      await started
      return { status: 'completed', value: 'script ended with queued work' }
    } })
    let delivered: ToolResult | undefined
    const pending = runner.execute({ runId: 'run', callId: 'queue-barrier', code: '', definitions: [], executeTool: async () => {
      invoked++; entered(); return original
    } })
    void pending.then(result => { delivered = result })
    try {
      await started
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(delivered).toMatchObject({ kind: 'error', data: { status: 'partial',
        children: [{ status: 'unknown' }, { status: 'cancelled' }],
        failures: [{ code: 'programmatic-child-not-started' }] } })
      expect(invoked).toBe(1)
      const before = structuredClone(delivered)
      release({ kind: 'read', data: 'original write actually returned late' })
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(delivered).toEqual(before)
      expect(invoked).toBe(1)
    } finally { release({ kind: 'read', data: 'fixture cleanup of original write' }); await pending }
  })

  it('cancels the old script after a steering not-started receipt and preserves its reason and completed work', async () => {
    const reason = '用户调整当前任务；这项旧调用尚未发起，没有执行或重放。'
    const invoked: string[] = []
    let runtimeStopped = false
    const runner = new ProgrammaticToolRunner({ execute: async input => {
      input.signal?.addEventListener('abort', () => { runtimeStopped = true }, { once: true })
      await input.call('read', {})
      await Promise.allSettled([input.call('text.replace', {}), input.call('text.replace', {})])
      await expect(input.call('read', {})).rejects.toThrow(reason)
      return { status: 'completed', value: 'obsolete script finished' }
    } })
    const result = await runner.execute({ runId: 'run', callId: 'steered', code: '', definitions: [], executeTool: async (_callId, call) => {
      invoked.push(call.name)
      return call.name === 'read' ? { kind: 'read', data: { text: 'acknowledged prior result' } }
        : { kind: 'read', data: { status: 'not-started', reason } }
    } })
    expect(invoked).toEqual(['read', 'text.replace'])
    expect(runtimeStopped).toBe(true)
    expect(result).toMatchObject({ kind: 'error', code: 'programmatic-cancelled', message: reason, data: { status: 'cancelled', error: reason,
      children: [{ status: 'completed' }, { status: 'cancelled' }, { status: 'cancelled' }],
      failures: [{ code: 'programmatic-child-cancelled', message: reason }, { code: 'programmatic-child-not-started', message: reason }] } })
    expect(result.kind === 'error' && result.data).not.toHaveProperty('value')
  })

  it('lets a script read and aggregate old receipts through the existing Engine callback', async () => {
    const readInput = { runId: 'ancestor', callId: 'prior:ptc:1', path: ['data', 'rows'] }
    const invoked: unknown[] = []
    const runner = new ProgrammaticToolRunner({ execute: async input => {
      const result = await input.call('programmatic.read', readInput)
      if (result.kind !== 'read') throw new Error('Expected actual read receipt')
      const rows = (result.data as { value: { amount: number }[] }).value
      return { status: 'completed', value: { total: rows.reduce((sum, row) => sum + row.amount, 0) } }
    } })
    const result = await runner.execute({ runId: 'current', callId: 'resume', code: '', definitions: [], executeTool: async (_callId, call) => {
      invoked.push(call)
      return readProgrammaticResult(readInput, [
        { callId: 'prior', call: { name: 'programmatic.execute', input: {} }, result: { kind: 'read', data: {} } },
        { callId: 'prior:ptc:1', call: { name: 'read', input: {} }, result: { kind: 'read', data: { rows: [{ amount: 2 }, { amount: 3 }] } } },
      ])
    } })
    expect(invoked).toEqual([{ name: 'programmatic.read', input: readInput }])
    expect(result).toMatchObject({ kind: 'read', data: { status: 'completed', value: { total: 5 } } })
    expect(JSON.stringify(result)).not.toContain('"amount"')
  })

  it('uses direct-tool job outcomes and retains caught terminal failures', async () => {
    for (const status of ['running', 'failed', 'unknown'] as const) {
      const runner = new ProgrammaticToolRunner({ execute: async input => {
        try { await input.call('job.status', {}) } catch { /* The parent must still expose the failure. */ }
        return { status: 'completed', value: { handled: true } }
      } })
      const result = await runner.execute({ runId: 'run', callId: `job-${status}`, code: '', definitions: [],
        executeTool: async () => ({ kind: 'read', data: { kind: 'compute', jobId: 'actual-job', status,
          terminal: status !== 'running', snapshot: { reason: 'Actual owner terminal reason' } } }) })
      if (status === 'running') expect(result).toMatchObject({ kind: 'read', data: { failures: [] } })
      else expect(result).toMatchObject({ kind: 'error', data: { status: 'partial', failures: [{ code: `tool-${status}` }],
        children: [{ status: status === 'unknown' ? 'unknown' : 'failed' }] } })
    }
  })

  it('keeps exact parent identities and distinguishes an unknown tool from an unknown effect', async () => {
    const callId = 'provider:ptc:1'
    const missing: ToolResult = { kind: 'error', code: 'unknown-tool', message: 'Tool does not exist' }
    const runner = new ProgrammaticToolRunner({ execute: async input => {
      try { await input.call('missing', {}); return { status: 'completed', value: null } }
      catch (error) { return { status: 'failed', error: String(error) } }
    } })
    const result = await runner.execute({ runId: 'run', callId, code: '', definitions: [], executeTool: async () => missing })
    expect(result).toMatchObject({ kind: 'error', data: { children: [{ status: 'failed', read: { runId: 'run', callId: `${callId}:ptc:1` } }] } })
    expect(readProgrammaticResult({ callId }, [{ callId, call: { name: 'programmatic.execute', input: {} }, result }]))
      .toMatchObject({ kind: 'read', data: { value: result } })
  })

  it('aggregates parallel reads, retains exact receipts, preserves partial work/batch history and stops CPU code', async () => {
    const directory = await fs.mkdtemp(path.join(process.cwd(), 'output', 'ptc-carrier-'))
    scratch.push(directory)
    const entry = path.join(directory, 'main.cjs'), preload = path.join(directory, 'programmatic.cjs'), marker = path.join(directory, 'result.json')
    await build({ entryPoints: ['tests/fixtures/ptc/programmaticCarrier.ts'], outfile: entry,
      bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent',
      banner: { js: "process.on('uncaughtException',error=>{console.error(error);process.exit(1)});process.on('unhandledRejection',error=>{console.error(error);process.exit(1)});" } })
    await build({ entryPoints: ['src/preload/programmatic.ts'], outfile: preload,
      bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'silent' })
    const executable = path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe')
    const code = await new Promise<number | null>((resolve, reject) => {
      const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE
      const child = spawn(executable, [entry, preload, marker, `--user-data-dir=${path.join(directory, 'profile')}`], { windowsHide: true, env: environment, stdio: 'inherit' })
      child.once('error', reject)
      child.once('close', resolve)
    })
    expect(code).toBe(0)
    expect(JSON.parse(await fs.readFile(marker, 'utf8'))).toEqual({ status: 'PTC_CARRIER_OK' })
  }, 30000)
})
