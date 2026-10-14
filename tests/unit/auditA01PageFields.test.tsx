// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ write: vi.fn(async () => ({ ok: true, changed: true })) }))
vi.mock('../../src/renderer/composition/runtime/runtimeLightEditCommands', () => ({
  useRuntimeLightEditView: () => ({ documentId: 'author-fields', locked: false, pageCopy: ['同文'], overrides: [],
    entries: ['title', 'caption'].map(id => ({ id, text: '同文', spot: { id, instanceId: 'source', initialValue: '同文' } })) }),
  runtimeLightEditCommands: { capturePageText: (_documentId: string, spot: { id: string }) => ({ id: spot.id }), setPageText: fixture.write },
}))
import { RuntimePageTextList } from '../../src/renderer/workbench/RuntimePageText'
afterEach(() => { cleanup(); fixture.write.mockClear() })
it('shows equal text at distinct author addresses and commits only the chosen field', async () => {
  render(<RuntimePageTextList itemId="source" onError={() => {}} />)
  expect(screen.getByText('同文批量替换')).toBeTruthy()
  const title = screen.getByLabelText('作者字段 1：同文'), caption = screen.getByLabelText('作者字段 2：同文')
  fireEvent.change(caption, { target: { value: '只改说明' } })
  await act(async () => { fireEvent.keyDown(caption, { key: 'Enter' }) })
  expect(fixture.write).toHaveBeenCalledExactlyOnceWith({ id: 'caption' }, '只改说明')
  expect(title).toHaveValue('同文')
})
