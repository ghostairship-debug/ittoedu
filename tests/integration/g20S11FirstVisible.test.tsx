// @vitest-environment jsdom
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionTimeline } from '../../src/renderer/workbench/ExecutionTimeline'

const directories: string[] = []
afterEach(async () => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true })
})

it('does not mark a collapsed edit or commit title as visible content; marks the revealed edit body and a later reply', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-s11-visible-')); directories.push(directory)
  const events = new ExecutionEventStore({ directory })
  await events.append({ eventId: 'edit', conversationId: 'conversation', taskId: 'edit-task', runId: 'edit-run',
    itemId: 'preview', time: 1, source: 'builtin', type: 'edit', update: 'snapshot',
    data: { text: '真实编辑正文', status: 'ready' } })
  await events.append({ eventId: 'commit', conversationId: 'conversation', taskId: 'commit-task', runId: 'commit-run',
    itemId: 'commit', time: 2, source: 'builtin', type: 'document.commit', update: 'snapshot',
    data: { text: '提交标题以外的内容', documentId: 'document', applicationStatus: 'applied', status: 'applied' } })

  let nextFrame = 0
  const frames = new Map<number, FrameRequestCallback>()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextFrame; frames.set(id, callback); return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 300, bottom: 100, width: 300, height: 100, toJSON: () => ({}),
  } as DOMRect)
  const frame = () => act(() => {
    const scheduled = [...frames.values()]; frames.clear()
    for (const callback of scheduled) callback(performance.now())
  })
  const observed: { taskId: string; itemId: string }[] = []
  const onFirstVisible = (taskId: string, itemId: string) => { observed.push({ taskId, itemId }) }
  const { rerender } = render(<div className="execution-assistant__history">
    <ExecutionTimeline projection={await events.snapshot('conversation')} onFirstVisible={onFirstVisible} />
  </div>)
  frame(); frame()
  expect(observed).toEqual([])
  const details = screen.getByRole('article', { name: '编辑预览' }).querySelector('details')!
  act(() => { details.open = true; fireEvent(details, new Event('toggle')) })
  frame(); frame()
  expect(observed).toEqual([{ taskId: 'edit-task', itemId: 'preview' }])

  await events.append({ eventId: 'reply', conversationId: 'conversation', taskId: 'reply-task', runId: 'reply-run',
    itemId: 'reply', time: 3, source: 'builtin', type: 'text', update: 'snapshot', data: { text: '真实回复正文' } })
  rerender(<div className="execution-assistant__history">
    <ExecutionTimeline projection={await events.snapshot('conversation')} onFirstVisible={onFirstVisible} />
  </div>)
  frame(); frame()
  expect(observed).toEqual([{ taskId: 'edit-task', itemId: 'preview' }, { taskId: 'reply-task', itemId: 'reply' }])
})
