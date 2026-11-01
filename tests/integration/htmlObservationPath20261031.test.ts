// @vitest-environment node
import { expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'

it('routes relative, canonical absolute and target HTML observations to the same granted document', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'guoling-html-path-'))
  const host = new DocumentHostService(path.join(root, 'recovery'))
  try {
    await mkdir(path.join(root, 'one')); await mkdir(path.join(root, 'two'))
    const first = path.join(root, 'one', 'lesson.html'), second = path.join(root, 'two', 'lesson.html')
    await writeFile(first, '<h1>first</h1>'); await writeFile(second, '<h1>second</h1>')
    const context = { runId: 'paths', workspaceRoot: root, permission: 'workspace' as const }
    const a = await host.agentFiles.execute(context, 'file.open', { path: first }, 'open-a')
    const b = await host.agentFiles.execute(context, 'file.open', { path: second }, 'open-b')
    const observed: string[] = []
    host.tools.configureHostServices({ htmlActions: {
      execute: async (_run, document) => { observed.push(document.documentId); return { documentId: document.documentId } },
      readResource: async () => { throw new Error('No image requested by this routing test') },
    } })
    await host.tools.beginRun({ runId: 'paths', actor: 'agent', documents: [a.opened!, b.opened!].map(value => ({ documentId: value.documentId, writable: [{ kind: 'document' as const }] })),
      fileAccess: { permission: 'workspace', workspaceRoot: root } })
    const facts = await host.tools.currentDocumentFacts('paths')
    const target = facts.find(value => value.documentId === a.opened!.documentId)!.target
    for (const [index, input] of [{ path: 'one/../one/lesson.html' }, { path: first }, { target }].entries())
      expect(await host.tools.execute('paths', `observe-${index}`, { name: 'view.observe', input })).toMatchObject({ kind: 'read', data: { documentId: a.opened!.documentId } })
    expect(await host.tools.execute('paths', 'observe-same-name', { name: 'view.observe', input: { path: 'two/lesson.html' } }))
      .toMatchObject({ kind: 'read', data: { documentId: b.opened!.documentId } })
    expect(observed).toEqual([a.opened!.documentId, a.opened!.documentId, a.opened!.documentId, b.opened!.documentId])
    const outside = await mkdtemp(path.join(tmpdir(), 'guoling-html-outside-'))
    try {
      const hidden = path.join(outside, 'private.html'); await writeFile(hidden, '<h1>ungranted</h1>')
      expect(await host.tools.execute('paths', 'observe-ungranted', { name: 'view.observe', input: { path: hidden } })).toMatchObject({ kind: 'error' })
      expect(observed).toHaveLength(4)
    } finally { await rm(outside, { recursive: true, force: true }) }
  } finally {
    await host.tools.stop('paths').catch(() => {})
    for (const document of host.registry.list()) await host.operate({ type: 'close', documentId: document.documentId, discardDirty: true })
    await rm(root, { recursive: true, force: true })
  }
})
