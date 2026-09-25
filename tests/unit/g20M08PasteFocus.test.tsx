import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { useState } from 'react'
import sharp from 'sharp'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AttachmentService } from '../../src/main/workbench/attachments/AttachmentService'
import { AttachmentComposer } from '../../src/renderer/workbench/attachments/AttachmentComposer'
import type { AttachmentsDesktopAPI } from '../../src/shared/workbench/attachmentsDesktop'
import type { InputAttachmentReference } from '../../src/shared/workbench/attachments'

const directories: string[] = []
afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected M08 fixture path')
    await fs.rm(directory, { recursive: true, force: true })
  }
})

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m08-paste-'))
  directories.push(directory)
  const service = new AttachmentService({ directory })
  const receive = vi.fn((input: Parameters<AttachmentsDesktopAPI['receive']>[0]) => service.receiveBytes({
    name: input.name, bytes: input.bytes, source: { kind: input.source }, declaredMediaType: input.mediaType,
  }))
  const clipboardFiles = vi.fn(async () => [])
  const api = {
    receive, clipboardFiles, snapshot: (id: string) => service.readSnapshot(id),
    readRepresentation: (id: string, representation: string) => service.readRepresentation(id, representation),
    cancel: async () => {}, release: async () => {},
  } as unknown as AttachmentsDesktopAPI
  return { service, api, receive, clipboardFiles }
}

function Harness({ api, changed }: { api: AttachmentsDesktopAPI; changed(value: InputAttachmentReference[]): void }) {
  const [value, setValue] = useState<InputAttachmentReference[]>([])
  return <>
    <textarea aria-label="正文" />
    <AttachmentComposer api={api} value={value} onChange={next => { setValue(next); changed(next) }}>
      <textarea aria-label="聊天" data-attachment-paste-target />
      <input aria-label="页范围" />
      <textarea aria-label="其他输入" />
    </AttachmentComposer>
  </>
}

function clipboard(files: File[], html = '', text = '') {
  return { files, items: files.map(file => ({ kind: 'file', getAsFile: () => file })), getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? text : '' }
}

it('routes attachment paste only from the chat textarea and leaves IME composition and other text owners alone', async () => {
  const f = await fixture(); let refs: InputAttachmentReference[] = []
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#369' } }).png().toBuffer()
  const image = new File([png], 'focus.png', { type: 'image/png' })
  render(<Harness api={f.api} changed={next => { refs = next }} />)
  expect(fireEvent.paste(screen.getByLabelText('正文'), { clipboardData: clipboard([image]) })).toBe(true)
  expect(fireEvent.paste(screen.getByLabelText('页范围'), { clipboardData: clipboard([image]) })).toBe(true)
  expect(fireEvent.paste(screen.getByLabelText('其他输入'), { clipboardData: clipboard([image]) })).toBe(true)
  const chat = screen.getByLabelText('聊天')
  fireEvent.compositionStart(chat)
  expect(fireEvent.paste(chat, { clipboardData: clipboard([image]) })).toBe(true)
  expect(f.receive).not.toHaveBeenCalled()
  expect(f.clipboardFiles).not.toHaveBeenCalled()
  fireEvent.compositionEnd(chat)
  expect(fireEvent.paste(chat, { clipboardData: clipboard([image]) })).toBe(false)
  await waitFor(() => expect(refs).toHaveLength(1))
  expect(f.receive).toHaveBeenCalledTimes(1)
  expect(Buffer.from(f.receive.mock.calls[0][0].bytes)).toEqual(png)
})

it('accepts a bytes-backed HTML image once, prefers a real clipboard File over duplicate HTML, and keeps plain text native', async () => {
  const f = await fixture(); let refs: InputAttachmentReference[] = []
  const png = await sharp({ create: { width: 3, height: 2, channels: 4, background: '#963' } }).png().toBuffer()
  const html = `<p><img src="data:image/png;base64,${png.toString('base64')}"></p>`
  render(<Harness api={f.api} changed={next => { refs = next }} />)
  const chat = screen.getByLabelText('聊天')
  expect(fireEvent.paste(chat, { clipboardData: clipboard([], html) })).toBe(false)
  await waitFor(() => expect(refs).toHaveLength(1))
  expect(f.receive).toHaveBeenCalledTimes(1)
  expect(Buffer.from(f.receive.mock.calls[0][0].bytes)).toEqual(png)
  const image = new File([png], 'real-image.png', { type: 'image/png' })
  expect(fireEvent.paste(chat, { clipboardData: clipboard([image], html) })).toBe(false)
  await waitFor(() => expect(refs).toHaveLength(2))
  expect(f.receive).toHaveBeenCalledTimes(2)
  expect(f.receive.mock.calls[1][0].name).toBe('real-image.png')
  expect(fireEvent.paste(chat, { clipboardData: clipboard([image], `<p>混合说明${html}</p>`, '混合说明') })).toBe(true)
  await waitFor(() => expect(refs).toHaveLength(3))
  expect(f.receive).toHaveBeenCalledTimes(3)
  expect(fireEvent.paste(chat, { clipboardData: clipboard([], '<p>普通文字</p>', '普通文字') })).toBe(true)
  expect(refs).toHaveLength(3)
  expect(f.clipboardFiles).not.toHaveBeenCalled()
})
