// @vitest-environment jsdom
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { AttachmentService } from '../../src/main/workbench/attachments/AttachmentService'
import { AttachmentsDesktopService } from '../../src/main/workbench/attachments/attachmentsDesktopService'
import { AttachmentComposer } from '../../src/renderer/workbench/attachments/AttachmentComposer'
import { PayloadCompiler } from '../../src/core/execution/PayloadCompiler'
import { serializeModelRequest } from '../../src/main/workbench/providers/OpenAIChatProvider'
import type { AttachmentReadProgress, AttachmentsDesktopAPI } from '../../src/shared/workbench/attachmentsDesktop'
import type { InputAttachmentReference } from '../../src/shared/workbench/attachments'
import type { ModelSelection } from '../../src/shared/workbench/modelProvider'

const roots: string[] = []
afterEach(async () => {
  cleanup(); vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture root')
    await fs.rm(root, { force: true, recursive: true })
  }
})
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m08-failure-')); roots.push(root)
  const grants = new Map<string, string>()
  const store = new AttachmentService({ directory: path.join(root, 'managed'), resolveAuthorizedPath: async id => {
    const filename = grants.get(id); if (!filename) throw new Error('No exact file grant')
    return { path: filename, kind: 'file' }
  } })
  return { root, grants, store }
}
function windowFor(id: number): BrowserWindow {
  return { webContents: Object.assign(new EventEmitter(), { id, isDestroyed: () => false }) } as unknown as BrowserWindow
}
const selection: ModelSelection = { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
  baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'supported', vision: 'unsupported', stream: 'supported', reasoning: 'unknown' } } }

it('M08-T04 keeps good snapshots while a failed read is retried, another failed item removed, and a large late result cancelled before send', async () => {
  const { root, grants, store } = await fixture()
  const paths = new Map([['good.txt', path.join(root, 'good.txt')], ['bad.txt', path.join(root, 'bad.txt')],
    ['remove.txt', path.join(root, 'remove.txt')], ['large.txt', path.join(root, 'large.txt')]])
  const largeBytes = Buffer.alloc(8 * 1024 * 1024, 'L')
  await fs.writeFile(paths.get('good.txt')!, 'GOOD ORIGINAL')
  await fs.writeFile(paths.get('large.txt')!, largeBytes)
  const files = [...paths].map(([name, filename]) => { const authorizationId = randomUUID(); grants.set(authorizationId, filename); return { authorizationId, name } })
  const listeners = new Set<(progress: AttachmentReadProgress) => void>()
  let releaseLarge: (() => Promise<void>) | undefined, largeRequestId = ''
  const emit = (progress: AttachmentReadProgress) => listeners.forEach(listener => listener(progress))
  const api: AttachmentsDesktopAPI = {
    select: async () => files, clipboardFiles: async () => [], workspaceFiles: async () => [],
    subscribeProgress: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    release: async ids => { ids.forEach(id => grants.delete(id)) },
    receiveGranted: async input => {
      const filename = grants.get(input.authorizationId)!
      if (path.basename(filename) === 'large.txt') {
        largeRequestId = input.requestId
        emit({ requestId: input.requestId, loaded: 4 * 1024 * 1024, total: largeBytes.length })
        return new Promise((resolve, reject) => { releaseLarge = async () => { try { resolve(await store.receivePath(input)) } catch (error) { reject(error) } } })
      }
      try { return await store.receivePath(input) } catch { throw new Error('文件读取失败，请重试') }
    },
    receive: async () => { throw new Error('Unexpected byte intake') },
    snapshot: id => store.readSnapshot(id), readRepresentation: (id, representation) => store.readRepresentation(id, representation),
    extract: async () => { throw new Error('Unexpected extraction') }, cancel: vi.fn(async () => {}),
  }
  let references: InputAttachmentReference[] = [], sent: InputAttachmentReference[] = []
  function Harness() {
    const [value, setValue] = useState<InputAttachmentReference[]>([]), [busy, setBusy] = useState(false)
    return <><AttachmentComposer api={api} value={value} onChange={next => { references = next; setValue(next) }} onBusyChange={setBusy}>
      <textarea aria-label="聊天" /></AttachmentComposer>
      <button type="button" disabled={busy || !value.length} onClick={() => { sent = [...value] }}>发送附件</button></>
  }
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: '添加附件' }))
  await waitFor(() => expect(references).toHaveLength(1))
  await waitFor(() => expect(within(screen.getByLabelText('附件准备：bad.txt')).getByText('文件读取失败，请重试')).toBeVisible())
  await waitFor(() => expect(within(screen.getByLabelText('附件准备：remove.txt')).getByText('文件读取失败，请重试')).toBeVisible())
  const large = await screen.findByLabelText('附件准备：large.txt')
  await waitFor(() => expect(within(large).getByText('50%')).toBeVisible())
  expect(screen.getByRole('button', { name: '发送附件' })).toBeDisabled()

  await fs.writeFile(paths.get('bad.txt')!, 'BAD RECOVERED')
  fireEvent.click(within(screen.getByLabelText('附件准备：bad.txt')).getByRole('button', { name: '重试' }))
  await waitFor(() => expect(references).toHaveLength(2))
  fireEvent.click(within(screen.getByLabelText('附件准备：remove.txt')).getByRole('button', { name: '移除失败项' }))
  fireEvent.click(within(large).getByRole('button', { name: '取消处理' }))
  emit({ requestId: largeRequestId, loaded: largeBytes.length, total: largeBytes.length })
  expect(within(large).getByText(/已取消，此项不会发送/)).toBeVisible()
  await waitFor(() => expect(screen.getByRole('button', { name: '发送附件' })).not.toBeDisabled())
  fireEvent.click(screen.getByRole('button', { name: '发送附件' }))
  expect(sent).toEqual(references); expect(sent).toHaveLength(2)
  await act(async () => { await releaseLarge?.() })
  await waitFor(() => expect(references).toHaveLength(2))
  expect(api.cancel).toHaveBeenCalledWith(largeRequestId)
  const compiled = await new PayloadCompiler({ attachments: store, serializePayload: serializeModelRequest }).compile({
    input: { id: 'm08', capturedAt: 1, instruction: '', context: [], attachments: sent }, selection, tools: [], budget: { maxSerializedBytes: 100_000 },
  })
  expect(compiled.manifest.explicitAttachments).toHaveLength(2)
  expect(compiled.serialized).toContain('GOOD ORIGINAL'); expect(compiled.serialized).toContain('BAD RECOVERED')
  expect(compiled.serialized).not.toContain('LLLLLLLL')
  expect(await fs.readFile(paths.get('good.txt')!, 'utf8')).toBe('GOOD ORIGINAL')
  expect(await fs.readFile(paths.get('bad.txt')!, 'utf8')).toBe('BAD RECOVERED')
  expect((await fs.readFile(paths.get('large.txt')!)).equals(largeBytes)).toBe(true)
})

it('M08-T04 reports real granted-file byte progress, cancels without deleting the original, then retries the exact grant', async () => {
  const { root } = await fixture(), directory = path.join(root, 'desktop-managed')
  const source = path.join(root, 'large.txt'), bytes = Buffer.alloc(1024 * 1024, 'P')
  await fs.writeFile(source, bytes)
  const desktop = new AttachmentsDesktopService(directory), owner = windowFor(31), other = windowFor(32)
  const authorizationId = randomUUID(), requestId = randomUUID()
  const grants = (desktop as unknown as { grants: Map<string, { path: string; kind: 'file'; owner: number; expires: number }> }).grants
  grants.set(authorizationId, { path: source, kind: 'file', owner: 31, expires: Date.now() + 60_000 })
  const progress: AttachmentReadProgress[] = []
  let cancelled = false
  const first = desktop.operate({ type: 'receive-granted', authorizationId, requestId }, owner, event => {
    progress.push(event)
    if (event.loaded > 0 && !cancelled) { cancelled = true; void desktop.operate({ type: 'cancel', requestId }, owner) }
  })
  await expect(first).rejects.toMatchObject({ code: 'attachment-operation-cancelled' })
  expect(progress[0]).toEqual({ requestId, loaded: 0, total: bytes.length })
  expect(progress.some(item => item.loaded >= 65536)).toBe(true)
  expect(progress.every(item => item.requestId === requestId && item.loaded <= item.total)).toBe(true)
  expect((await fs.readFile(source)).equals(bytes)).toBe(true)
  await expect(desktop.operate({ type: 'receive-granted', authorizationId, requestId: randomUUID() }, other)).rejects.toMatchObject({ code: 'attachment-path-not-authorized' })
  const retryProgress: AttachmentReadProgress[] = []
  const retried = await desktop.operate({ type: 'receive-granted', authorizationId, requestId: randomUUID() }, owner, event => retryProgress.push(event)) as Awaited<ReturnType<AttachmentService['readSnapshot']>>
  expect(retryProgress[0]?.loaded).toBe(0)
  expect(retryProgress.at(-1)?.loaded).toBe(bytes.length)
  expect(Buffer.from((await desktop.attachments.readRepresentation(retried.id, 'original-text')).bytes)).toEqual(bytes)
  expect((await fs.readFile(source)).equals(bytes)).toBe(true)
})
