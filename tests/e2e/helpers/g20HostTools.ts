import type { ElectronApplication, Page } from '@playwright/test'
import type { ModelToolCall, ToolResult, ToolTarget } from '../../../src/shared/workbench/tools'

type HostRequest = { kind: 'begin'; runId: string; documentId: string; target: ToolTarget }
  | { kind: 'call'; runId: string; call: ModelToolCall }
  | { kind: 'image'; runId: string; documentId: string; bytes: number[]; mimeType: string; filename: string }
  | { kind: 'stop'; runId: string }
  | { kind: 'artifact'; runId: string; job: string; artifact: string }

declare global { interface Window { g20HostTool: (request: HostRequest) => Promise<ToolResult | string | null> } }

/** Only transports tests to the actual application's singleton Gateway and configured host services. */
export async function installHostToolTestTransport(app: ElectronApplication, page: Page): Promise<void> {
  await page.exposeFunction('g20HostTool', (input: HostRequest) => app.evaluate(async ({ app }, request) => {
    const { createRequire } = process.getBuiltinModule('node:module')
    const requireProduct = createRequire(`${app.getAppPath()}/package.json`)
    const { randomUUID } = requireProduct('node:crypto') as typeof import('node:crypto')
    const { documentHost } = requireProduct('./dist-electron/main/workbench/documentHost.js') as typeof import('../../../src/main/workbench/documentHost')
    const gateway = documentHost().tools
    if (request.kind === 'artifact') {
      const { ControlledBuildService } = requireProduct('./dist-electron/main/workbench/build/ControlledBuildService.js') as typeof import('../../../src/main/workbench/build/ControlledBuildService')
      const service = new ControlledBuildService({ directory: `${app.getPath('userData')}/workbench-v2/builds`, admission: {
        async run() { throw new Error('Evidence read must never execute admission') },
      } })
      return { kind: 'read' as const, data: await service.artifact(request.runId, request.job, request.artifact) }
    }
    if (request.kind === 'begin') {
      await gateway.beginRun({ runId: request.runId, actor: 'agent', documents: [{ documentId: request.documentId, writable: [request.target] }] })
      return gateway.issueTarget(request.runId, request.documentId, request.target)
    }
    if (request.kind === 'stop') { await gateway.stop(request.runId); return null }
    if (request.kind === 'image') return gateway.provideImage(request.runId, request.documentId,
      { bytes: Uint8Array.from(request.bytes), mimeType: request.mimeType, filename: request.filename })
    return gateway.execute(request.runId, randomUUID(), request.call)
  }, input))
}
