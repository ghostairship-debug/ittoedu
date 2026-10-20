// @vitest-environment node
import { expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { MODEL_DELIVERY_BYTES } from '../../src/core/tools/modelDeliveryBudget'
import { callTool, residentMcpFixture } from '../helpers/residentMcpFixture'

it('bounds actual MCP text/structured replies and pages the frozen original query within its session and workspace', async () => {
  const base = path.resolve('output/creation-boundary-implementation-20261020/MCP')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(path.join(base, 'run-')), workspace = path.join(directory, 'space'), other = path.join(directory, 'other')
  await mkdir(workspace); await mkdir(other)
  const host = new DocumentHostService(path.join(directory, 'recovery'))
  let owner = 'SOURCE_' + '正文'.repeat(400_000) + '_TAIL', reads = 0
  const original = owner
  const fixture = await residentMcpFixture({ host, directory, workspaceRoot: workspace, files: files => ({
    releaseRun: files.releaseRun.bind(files),
    preflightCreate: files.preflightCreate.bind(files), preflightMutation: files.preflightMutation.bind(files),
    execute: async (context, name, raw, operationId) => name === 'file.read'
      ? (reads++, { data: { status: 'read', content: owner, diagnostics: [{ level: 'warning', message: 'Retained warning' }] } })
      : files.execute(context, name, raw, operationId),
  }) })
  try {
    const client = await fixture.connect('creation-budget'), reply = await callTool(client, 'file.read', { path: 'fixture.txt' })
    expect(reply.isError).toBe(false)
    expect(Buffer.byteLength(reply.content[0]!.text!, 'utf8')).toBeLessThan(MODEL_DELIVERY_BYTES)
    expect(JSON.parse(reply.content[0]!.text!)).toEqual(reply.structuredContent.result)
    expect(reply.structuredContent.result).toMatchObject({ kind: 'read', data: { status: 'read' },
      modelDelivery: { complete: false, source: { tool: 'operation.read', input: { ticket: reply.structuredContent.ticket } } } })
    const ticket = reply.structuredContent.ticket!
    owner = 'Changed current owner'
    const page = await callTool(client, 'operation.read', { ticket, path: ['data', 'content'], offset: 800_000, limit: 100 })
    expect(page.structuredContent.result).toMatchObject({ kind: 'read', data: { value: original.slice(800_000, 800_100) } })
    expect(page.structuredContent.result.data.value).toContain('_TAIL')
    expect(reads).toBe(1)
    const stranger = await fixture.connect('another-client')
    expect((await callTool(stranger, 'operation.read', { ticket })).structuredContent.result).toMatchObject({ kind: 'error', code: 'unknown-operation' })
    await fixture.conversations.registerWorkspace({ workspaceId: 'other', rootPath: await realpath(other), managed: false, authorization: 'user-selected' })
    await callTool(client, 'workspace.switch', { workspaceId: 'other' })
    expect((await callTool(client, 'operation.read', { ticket })).structuredContent.result).toMatchObject({ kind: 'error', code: 'unknown-operation' })
    await writeFile(path.join(directory, 'facts.json'), JSON.stringify({ reads, replyBytes: Buffer.byteLength(reply.content[0]!.text!, 'utf8'),
      textAndStructuredAgree: true, frozenTail: page.structuredContent.result.data.value, crossSessionRejected: true, switchedScopeRejected: true }))
  } finally { await fixture.close() }
})
