// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ProgrammaticToolRunner, readProgrammaticResult } from '../../src/main/workbench/execution/ProgrammaticToolRunner'
import type { ToolResult } from '../../src/shared/workbench/tools'

const scratch: string[] = []
afterEach(async () => { for (const directory of scratch.splice(0)) await fs.rm(directory, { recursive: true, force: true }) })

describe('PTC in its real sandbox carrier and canonical Gateway/Session', () => {
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
