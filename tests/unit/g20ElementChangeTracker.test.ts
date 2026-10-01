// @vitest-environment node
import { expect, it } from 'vitest'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { ElementChangeTracker } from '../../src/main/workbench/execution/ElementChangeTracker'
import type { DocumentCommand } from '../../src/shared/workbench/document'

async function fixture() {
  const session = await DocumentSession.create({ documentId: 'doc', epoch: 'epoch',
    model: { kind: 'markdown', source: 'P one tail', resources: { assets: {}, components: {} } },
    binding: { kind: 'untitled', suggestedName: 'card.md' } }, new MarkdownDriver(), {
      append: async () => {}, save: async () => { throw new Error('This fixture does not save files') },
    })
  const change = async (command: DocumentCommand, runId?: string) => {
    const result = await session.execute({ documentId: 'doc', epoch: 'epoch', baseRevision: session.read().revision,
      operationId: crypto.randomUUID(), actor: runId ? 'agent' : 'human', ...(runId ? { runId } : {}), mutation: { type: 'command', command } })
    expect(result.status).toBe('applied')
  }
  const text = () => (session.read().model as { source: string }).source
  const tracker = (runId: string, to: number, conversationId = 'card') => {
    const value = new ElementChangeTracker(conversationId, 'doc', { kind: 'markdown-range', from: 2, to }, session, session.read())
    value.bindRun(runId); return value
  }
  return { session, change, text, tracker }
}

it('successive card runs undo and redo in order while preserving unrelated human edits', async () => {
  const f = await fixture(), first = f.tracker('first', 5)
  await f.change({ type: 'markdown.splice', from: 2, to: 5, text: 'second' }, 'first'); first.finish()
  const second = f.tracker('second', 8)
  await f.change({ type: 'markdown.splice', from: 2, to: 8, text: 'third' }, 'second')
  await f.change({ type: 'markdown.splice', from: 2, to: 7, text: 'last' }, 'second'); second.finish()
  await f.change({ type: 'markdown.splice', from: 0, to: 0, text: 'X' })
  expect((await first.revert('a', 'undo')).status).toBe('unavailable')
  expect((await second.revert('b', 'undo')).status).toBe('applied'); expect(f.text()).toBe('XP second tail')
  expect((await first.revert('a', 'undo')).status).toBe('applied'); expect(f.text()).toBe('XP one tail')
  expect((await first.revert('a', 'redo')).status).toBe('applied'); expect(f.text()).toBe('XP second tail')
  expect((await second.revert('b', 'redo')).status).toBe('applied'); expect(f.text()).toBe('XP last tail')
})

it('does not revive a card inverse after a human overwrites its location even if identical text is restored', async () => {
  const f = await fixture(), first = f.tracker('first', 5)
  await f.change({ type: 'markdown.splice', from: 2, to: 5, text: 'second' }, 'first'); first.finish()
  const second = f.tracker('second', 8)
  await f.change({ type: 'markdown.splice', from: 2, to: 8, text: 'last' }, 'second'); second.finish()
  await f.change({ type: 'markdown.splice', from: 2, to: 6, text: 'human' })
  await f.change({ type: 'markdown.splice', from: 2, to: 7, text: 'last' })
  expect((await second.revert('b', 'undo')).status).toBe('unavailable')
  expect((await first.revert('a', 'undo')).status).toBe('unavailable')
  expect(f.text()).toBe('P last tail')
})

it('does not use a different card conversation as inverse provenance', async () => {
  const f = await fixture(), first = f.tracker('first', 5)
  await f.change({ type: 'markdown.splice', from: 2, to: 5, text: 'second' }, 'first'); first.finish()
  const other = f.tracker('other', 8, 'another-card')
  await f.change({ type: 'markdown.splice', from: 2, to: 8, text: 'last' }, 'other'); other.finish()
  expect((await other.revert('b', 'undo')).status).toBe('applied')
  expect((await first.revert('a', 'undo')).status).toBe('unavailable')
})

it('releases an earlier inverse when the later run finishes with no net text change', async () => {
  const f = await fixture(), first = f.tracker('first', 5)
  await f.change({ type: 'markdown.splice', from: 2, to: 5, text: 'second' }, 'first'); first.finish()
  const second = f.tracker('second', 8)
  await f.change({ type: 'markdown.splice', from: 2, to: 8, text: 'temporary' }, 'second')
  await f.change({ type: 'markdown.splice', from: 2, to: 11, text: 'second' }, 'second'); second.finish()
  expect(second.view('b').state).toBe('none')
  expect((await first.revert('a', 'undo')).status).toBe('applied')
  expect(f.text()).toBe('P one tail')
})
