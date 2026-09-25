// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

it('S11-T05 human and agent ordinary edits share one durable DocumentSession and History', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-s11-boundary-'))
  try {
    const host = new DocumentHostService(path.join(directory, 'recovery'))
    const initial = await host.operate({ type: 'create', suggestedName: 'note.md',
      model: { kind: 'markdown', source: 'first', resources: { assets: {}, components: {} } },
    }) as DocumentSnapshot
    const human = await host.internalAPI.dispatch({ documentId: initial.documentId, epoch: initial.epoch,
      baseRevision: initial.revision, operationId: 'human-edit', actor: 'human',
      mutation: { type: 'command', command: { type: 'markdown.replace', source: 'human' } },
    })
    expect(human).toMatchObject({ status: 'applied', revision: 1, persistence: 'recoverable' })

    await host.tools.beginRun({ runId: 'agent-run', actor: 'agent', documents: [
      { documentId: initial.documentId, writable: [{ kind: 'document' }] },
    ] })
    const target = await host.tools.issueTarget('agent-run', initial.documentId, { kind: 'markdown-range', from: 0, to: 5 })
    const agent = await host.tools.execute('agent-run', 'agent-edit', {
      name: 'text.replace', input: { target, content: 'agent' },
    })
    expect(agent).toMatchObject({ kind: 'document-operation', result: {
      status: 'applied', revision: 2, persistence: 'recoverable',
    } })
    const afterAgent = await host.internalAPI.read(initial.documentId)
    expect(afterAgent).toMatchObject({ revision: 2, undoDepth: 2, model: { source: 'agent' } })
    expect(host.registry.list()).toHaveLength(1)

    const undone = await host.internalAPI.dispatch({ documentId: initial.documentId, epoch: afterAgent.epoch,
      baseRevision: afterAgent.revision, operationId: 'human-undo-agent', actor: 'human',
      mutation: { type: 'undo' },
    })
    expect(undone).toMatchObject({ status: 'applied', revision: 3 })
    expect(await host.internalAPI.read(initial.documentId)).toMatchObject({
      undoDepth: 1, redoDepth: 1, model: { source: 'human' },
    })
    const filename = path.join(directory, 'note.md')
    await host.saveToPath(initial.documentId, filename)
    await host.operate({ type: 'close', documentId: initial.documentId })
    expect((await host.open(filename)).model).toMatchObject({ source: 'human' })
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
