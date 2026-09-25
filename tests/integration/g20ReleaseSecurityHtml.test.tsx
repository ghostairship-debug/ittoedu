// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionTimeline } from '../../src/renderer/workbench/ExecutionTimeline'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const roots: string[] = []
afterEach(async () => {
  cleanup()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('Unsafe cleanup')
    await rm(root, { recursive: true, force: true })
  }
})

it('renders malicious live model text and tool output as inert text before the run ends', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'g20-release-html-'))
  roots.push(root)
  const events = new ExecutionEventStore({ directory: root })
  const payload = '<script>window.__releaseExecuted=true</script><img src=x onerror="window.__releaseExecuted=true"><a href="javascript:window.__releaseExecuted=true">click</a>'
  const base = { conversationId: 'live', taskId: 'task', runId: 'run', time: 1, source: 'builtin' as const, update: 'snapshot' as const }
  await events.append({ ...base, eventId: 'text', itemId: 'reply', type: 'text', data: { text: payload, status: 'running' } })
  await events.append({ ...base, eventId: 'tool', itemId: 'tool', type: 'tool', data: { toolName: 'read', status: 'running', output: payload } })
  const projection = await events.snapshot('live')
  expect(projection.items.some(item => item.type === 'run.end')).toBe(false)
  const view = render(<ExecutionTimeline projection={projection} />)
  expect(screen.getByText(payload, { exact: false })).toBeInTheDocument()
  expect(view.container.querySelector('script, img, iframe, object, embed, a[href^="javascript:"]')).toBeNull()
  expect((window as typeof window & { __releaseExecuted?: boolean }).__releaseExecuted).toBeUndefined()
})
