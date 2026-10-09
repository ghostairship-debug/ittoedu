import { describe, expect, it, vi } from 'vitest'
import type { ToolRunGrant } from '../../src/shared/workbench/tools'
import type { ComputeJobInput } from '../../src/shared/workbench/compute'
import type { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { HostToolCoordinator, type HostJobRef, type HostToolServices } from '../../src/core/tools/HostToolServices'

const grant = (permission: NonNullable<ToolRunGrant['fileAccess']>['permission'] = 'workspace'): ToolRunGrant => ({
  runId: 'host-run', actor: 'agent', documents: [], fileAccess: { permission, workspaceRoot: 'D:/scratch' },
})
const coordinator = (services: HostToolServices) => new HostToolCoordinator(services, {} as DocumentRegistry, {} as never)

describe('M27-M29 host service wiring', () => {
  it('routes durable owner queries under the frozen run and stops web/MCP/media before further calls', async () => {
    const status = vi.fn(async (ref: HostJobRef) => ({ ...ref, status: 'ready', terminal: true, snapshot: { runId: ref.runId, resources: [] } }))
    const stopRun = vi.fn(async () => {})
    const webOpen = vi.fn(async () => ({ status: 'opened', source: { url: 'https://example.org/' }, text: 'Observed page' }))
    const services: HostToolServices = {
      beginRun: vi.fn(async () => {}), stopRun,
      jobs: { status, wait: vi.fn(async () => ({ kind: 'image' as const, jobId: 'image-1', status: 'ready', terminal: true, snapshot: {} })),
        logs: vi.fn(async () => ({ entries: [], nextCursor: 0 })), cancel: vi.fn(async () => ({ kind: 'image' as const, jobId: 'image-1', status: 'stopped', terminal: true, snapshot: {} })) },
      web: { search: vi.fn(async () => ({ status: 'not-configured' })), open: webOpen },
      mcp: { discover: vi.fn(async () => ({ status: 'not-configured' })), invoke: vi.fn(async () => ({ status: 'rejected' })),
        readResource: vi.fn(() => ({ mimeType: 'image/png', bytes: new Uint8Array(0) })), lookup: vi.fn(async () => ({ status: 'unknown' })) },
      media: { discover: vi.fn(() => [{ kind: 'speech', status: 'not-configured' }]), start: vi.fn(async () => ({ status: 'not-configured' })) },
    }
    const host = coordinator(services)
    await host.beginRun(grant())
    expect(await host.jobStatus('host-run', { kind: 'image', jobId: 'image-1' })).toMatchObject({ kind: 'read', data: { status: 'ready' } })
    expect(status).toHaveBeenCalledWith({ runId: 'host-run', kind: 'image', jobId: 'image-1' })
    expect(await host.webOpen('host-run', { url: 'https://example.org/' })).toMatchObject({ kind: 'read', data: { status: 'opened' } })
    expect(webOpen).toHaveBeenCalledWith({ runId: 'host-run', url: 'https://example.org/', signal: undefined })
    expect(host.mediaDiscover('host-run')).toMatchObject({ kind: 'read', data: [{ status: 'not-configured' }] })
    expect(await host.mediaStart('host-run', { kind: 'speech', prompt: 'hello' })).toMatchObject({ kind: 'read', data: { status: 'not-configured' } })
    expect(await host.mcpDiscover('host-run')).toMatchObject({ kind: 'read', data: { status: 'not-configured' } })
    expect(await host.runCompute('host-run', 'no-backend', { language: 'python', code: 'print(1)' })).toMatchObject({
      kind: 'error', code: 'service-unavailable',
    })
    await host.stop('host-run')
    expect(stopRun).toHaveBeenCalledWith('host-run')
    await expect(host.webOpen('host-run', { url: 'https://example.org/' })).rejects.toThrow('已经停止')
    expect(await host.lookupMcp('host-run', 'prior-op')).toMatchObject({ status: 'unknown' })
  })

  it('blocks write jobs in read-only runs and refuses service calls without built-in frozen access', async () => {
    const start = vi.fn(async () => ({ jobId: 'unused', runId: 'host-run', requestDigest: 'digest', status: 'ready' as const,
      createdAt: '', updatedAt: '', stopped: false, outputNames: [], artifacts: [] }))
    const host = coordinator({ compute: { start, readArtifact: vi.fn(), cancel: vi.fn(), cancelRun: vi.fn(async () => {}) } })
    await host.beginRun(grant('read-only'))
    await expect(host.runCompute('host-run', 'op-1', { language: 'python', code: 'print(1)' })).rejects.toThrow('只读任务')
    await expect(host.mediaStart('host-run', { kind: 'speech', prompt: 'hello' })).rejects.toThrow('只读任务')
    expect(start).not.toHaveBeenCalled()

    const external = coordinator({ web: { search: vi.fn(async () => ({})), open: vi.fn(async () => ({})) } })
    await external.beginRun({ runId: 'external-run', actor: 'external', documents: [] })
    await expect(external.webSearch('external-run', { query: 'anything' })).rejects.toThrow('冻结的宿主服务授权')
  })

  it('cancels a compute submission that returns after Stop while retaining its durable job receipt', async () => {
    let resolveStart!: (value: { jobId: string; runId: string; requestDigest: string; status: 'running'; createdAt: string;
      updatedAt: string; stopped: boolean; outputNames: readonly string[]; artifacts: [] }) => void
    const start = vi.fn((_input: ComputeJobInput) => new Promise<Parameters<typeof resolveStart>[0]>(resolve => { resolveStart = resolve }))
    const cancel = vi.fn(async (runId: string, jobId: string) => ({ jobId, runId, requestDigest: 'digest', status: 'cancelled' as const,
      createdAt: '', updatedAt: '', stopped: true, outputNames: [], artifacts: [] }))
    const cancelRun = vi.fn(async () => {})
    const host = coordinator({ compute: { start, cancel, cancelRun, readArtifact: vi.fn() } })
    await host.beginRun(grant())
    const submitted = host.runCompute('host-run', 'submit-1', { language: 'python', code: 'print(1)' })
    await Promise.resolve()
    expect(start).toHaveBeenCalledTimes(1)
    const requested = start.mock.calls[0]?.[0]
    if (!requested) throw new Error('compute owner did not receive a job')
    expect(requested).toMatchObject({ runId: 'host-run', language: 'python' })
    expect(requested.jobId).toMatch(/^compute-[a-f0-9]{64}$/)
    const stopping = host.stop('host-run')
    resolveStart({ jobId: requested.jobId, runId: 'host-run', requestDigest: 'digest', status: 'running',
      createdAt: '', updatedAt: '', stopped: false, outputNames: [], artifacts: [] })
    expect(await submitted).toMatchObject({ kind: 'read', data: { job: requested.jobId, status: 'cancelled', stopped: true } })
    await stopping
    expect(cancelRun).toHaveBeenCalledWith('host-run')
    expect(cancel).toHaveBeenCalledWith('host-run', requested.jobId)
  })
})
