import { createRef, useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ConversationInput } from '../../src/renderer/workbench/ConversationInput'
import { composerTrigger } from '../../src/renderer/workbench/composerTrigger'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function fixture() {
  const sendKey = vi.fn(), referenceEntries = vi.fn(), reference = vi.fn(), model = vi.fn()
  const actions = { addFiles: vi.fn(), referenceWorkspace: vi.fn(), referenceEntries, canAdd: true, canReference: true }
  function Host() {
    const [text, setText] = useState('')
    return <ConversationInput value={text} onChange={setText} inputRef={createRef()} disabled={false} readOnly={false} workspaceDirectory="C:/workspace"
      actions={actions} onBlur={() => undefined} onFocus={() => undefined} onKeyDown={sendKey} onCompositionStart={() => undefined} onCompositionEnd={() => undefined}
      onModel={model} onPermission={() => undefined} onNewConversation={() => undefined} onReference={reference} />
  }
  render(<Host />)
  return { input: screen.getByRole('textbox', { name: '给果铃AI发消息' }), sendKey, referenceEntries, reference, model }
}
it('does not turn email, URLs or normal nested paths into candidates', () => {
  for (const text of ['hello@example.com', 'https://site.test/a', 'C:/work/a', '/temp/a']) expect(composerTrigger(text, text.length)).toBeNull()
  expect(composerTrigger('看看 @教', 5)?.kind).toBe('@')
})
it('loads actual scoped Skill metadata, Enter selects accurate identity without sending or losing surrounding draft', async () => {
  const catalog = vi.fn(async () => ({ entries: [{ name: 'workspace/精修', description: '编辑已有内容' }], warnings: [] }))
  vi.stubGlobal('desktopAPI', { skillCatalog: catalog })
  const { input, sendKey } = fixture()
  fireEvent.change(input, { target: { value: '请帮忙 /精修 后续文字', selectionStart: 7 } })
  await screen.findByRole('option', { name: /workspace\/精修/ })
  expect(catalog).toHaveBeenCalledWith({ workspaceDirectory: 'C:/workspace' })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(input).toHaveValue('请帮忙 使用「workspace/精修」Skill： 后续文字')
  expect(sendKey).not.toHaveBeenCalled()
  expect(screen.queryByRole('listbox')).toBeNull()
})
it('references the controlled workspace entry rather than a decorative filename and keeps the rest of the draft', async () => {
  const files = vi.fn(async (request: { type: string }) => request.type === 'root' ? { workspaceId: 'authorized-workspace', rootEntryId: 'root' }
    : { entries: [{ status: 'accessible', entryId: 'real-entry', kind: 'file', name: '教学.docx' }] })
  vi.stubGlobal('desktopAPI', { workspaceFiles: files })
  const { input, sendKey, referenceEntries } = fixture()
  fireEvent.change(input, { target: { value: '看看 @教学.docx', selectionStart: 11 } })
  await screen.findByRole('option', { name: /教学.docx/ })
  fireEvent.keyDown(input, { key: 'Tab' })
  expect(referenceEntries).toHaveBeenCalledWith('authorized-workspace', ['real-entry'])
  expect(input).toHaveValue('看看 ')
  expect(sendKey).not.toHaveBeenCalled()
})
it('IME confirmation and candidate Escape never send; normal Enter is delegated after closing', async () => {
  vi.stubGlobal('desktopAPI', { skillCatalog: vi.fn(async () => ({ entries: [], warnings: [] })) })
  const { input, sendKey } = fixture()
  fireEvent.change(input, { target: { value: '/', selectionStart: 1 } })
  await screen.findByRole('option', { name: '选择模型' })
  fireEvent.compositionStart(input)
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  expect(sendKey).not.toHaveBeenCalled()
  fireEvent.compositionEnd(input)
  await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy())
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(input).toHaveValue('/')
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(sendKey).toHaveBeenCalledOnce()
})
