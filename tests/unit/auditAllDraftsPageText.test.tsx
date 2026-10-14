// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { discardPropertiesDrafts, flushPropertiesDrafts, hasPropertiesDrafts } from '../../src/renderer/ui/properties/PropertyControls'

const fixture = vi.hoisted(() => ({ write: vi.fn(async () => ({ ok: true, changed: true })) }))
vi.mock('../../src/renderer/composition/runtime/runtimeLightEditCommands', () => ({
  useRuntimeLightEditView: () => ({ documentId: 'page-copy', pageCopy: ['original'], overrides: [], locked: false }),
  runtimeLightEditCommands: { capturePageCopy: (documentId: string, instanceId: string, original: string) => ({ documentId, instanceId, original }), setPageCopy: fixture.write },
}))
import { RuntimePageTextList } from '../../src/renderer/workbench/RuntimePageText'
afterEach(() => { cleanup(); discardPropertiesDrafts('page-copy'); fixture.write.mockClear() })

it('CA286 preserves page copy when its popover closes without blur and flushes after reopening', async () => {
  const ui = () => <RuntimePageTextList itemId="runtime" onError={() => {}} />
  const first = render(ui()); fireEvent.change(screen.getByLabelText('页面文字：original'), { target: { value: 'teacher draft' } })
  expect(hasPropertiesDrafts('page-copy')).toBe(true); first.unmount()
  expect(fixture.write).not.toHaveBeenCalled()
  render(ui()); expect(screen.getByLabelText('页面文字：original')).toHaveValue('teacher draft')
  await act(async () => { expect(await flushPropertiesDrafts('page-copy')).toBe(true) })
  expect(fixture.write).toHaveBeenCalledExactlyOnceWith({ documentId: 'page-copy', instanceId: 'runtime', original: 'original' }, 'teacher draft')
})
