// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { AgentFileText } from '../../src/main/workbench/execution/AgentFileText'

const temporaryRoots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture(source: string, humanSource: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'g20-observed-file-'))
  temporaryRoots.push(root)
  const filename = path.join(root, 'notes.txt')
  await writeFile(filename, source)
  const host = new DocumentHostService(path.join(root, 'journal'))
  const observed = await host.open(filename)
  const session = host.registry.get(observed.documentId)
  const context = { runId: 'file-run', workspaceRoot: root, permission: 'workspace' as const }
  await host.tools.beginRun({ runId: context.runId, actor: 'agent', documents: [] })
  const attach = host.tools.attachRunDocument.bind(host.tools)
  vi.spyOn(host.tools, 'attachRunDocument').mockImplementationOnce(async (...args) => {
    const current = session.read()
    const result = await session.execute({ documentId: current.documentId, epoch: current.epoch,
      baseRevision: current.revision, operationId: 'human-change', actor: 'human',
      mutation: { type: 'command', command: { type: 'markdown.replace', source: humanSource } } })
    expect(result.status).toBe('applied')
    return attach(...args)
  })
  return { filename, host, session, context, files: new AgentFileText(host),
    version: `document:${observed.documentId}:${observed.epoch}:${observed.revision}` }
}

describe('file commit preserves the originally observed document', () => {
  it.each(['write', 'patch'] as const)('rejects overlapping %s after a human edit between version check and attach', async mode => {
    const f = await fixture('before', 'HUMAN!')
    const operation = mode === 'write'
      ? f.files.write(f.context, f.filename, 'AI draft', 'replace', f.version, 'ai-write')
      : f.files.patch(f.context, f.filename, f.version, 'before', 'AI draft', undefined, 'ai-patch')
    await expect(operation).rejects.toThrow(/改变|失效|冲突|修改/)
    expect(f.session.read()).toMatchObject({ revision: 1, model: { source: 'HUMAN!' } })
    await f.host.tools.stop(f.context.runId)
  })

  it('maps a nonoverlapping patch without overwriting the human suffix', async () => {
    const f = await fixture('before tail', 'before HUMAN!')
    const result = await f.files.patch(f.context, f.filename, f.version, 'before', 'AI', undefined, 'ai-patch')
    expect(result.data).toMatchObject({ status: 'applied', beforeVersion: f.version })
    expect(f.session.read()).toMatchObject({ revision: 2, model: { source: 'AI HUMAN!' } })
    await f.host.tools.stop(f.context.runId)
  })
})
