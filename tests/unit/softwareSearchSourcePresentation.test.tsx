import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionTimeline } from '../../src/renderer/workbench/ExecutionTimeline'
import { webSearchSources } from '../../src/core/tools/modelToolResult'
import { emptyExecutionProjection, foldExecutionEvents, type ExecutionEvent } from '../../src/shared/workbench/executionEvents'

const originalDesktop = Object.getOwnPropertyDescriptor(window, 'desktopAPI')
afterEach(() => { cleanup(); if (originalDesktop) Object.defineProperty(window, 'desktopAPI', originalDesktop); else Reflect.deleteProperty(window, 'desktopAPI') })

it('opens actual built-in and external search sources through the existing desktop link action', async () => {
  const lesson = vi.fn(async () => ({ opened: true }))
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { lesson } })
  const events = (['builtin', 'external-mcp'] as const).map((source, index): ExecutionEvent => ({
    eventId: source, itemId: source, runId: source, taskId: source, source, type: 'tool', conversationId: 'conversation',
    sequence: index + 1, time: index + 1, update: 'snapshot', data: { toolName: 'web.search', status: 'completed',
      webSources: webSearchSources('web.search', { kind: 'read', data: { status: 'results', results: [
        { title: `${source} actual source`, url: `https://example.com/${source}`, snippet: '' },
      ] } }) },
  }))
  const { container } = render(<ExecutionTimeline projection={foldExecutionEvents(emptyExecutionProjection('conversation'), events)} />)
  for (const group of container.querySelectorAll<HTMLDetailsElement>('.execution-timeline__tool-group>details')) {
    act(() => { group.open = true; fireEvent(group, new Event('toggle')) })
  }
  for (const detail of container.querySelectorAll<HTMLDetailsElement>('.execution-timeline__card--tool>details')) {
    act(() => { detail.open = true; fireEvent(detail, new Event('toggle')) })
  }
  for (const source of ['builtin', 'external-mcp']) fireEvent.click(screen.getByRole('link', { name: `${source} actual source` }))
  await waitFor(() => expect(lesson).toHaveBeenCalledTimes(2))
  expect(lesson).toHaveBeenNthCalledWith(1, { operation: 'open-link', url: 'https://example.com/builtin' })
  expect(lesson).toHaveBeenNthCalledWith(2, { operation: 'open-link', url: 'https://example.com/external-mcp' })
})
