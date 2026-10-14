import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ExecutionTimeline } from '../../src/renderer/workbench/ExecutionTimeline'
import { AttachmentComposer } from '../../src/renderer/workbench/attachments/AttachmentComposer'
import { MaterialLibraryDialog } from '../../src/renderer/ui/MaterialLibraryDialog'
import { ExecutionSettingsPanel } from '../../src/renderer/workbench/ExecutionSettingsPanel'
import type { ExecutionItem } from '../../src/shared/workbench/executionEvents'
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('CA-242 keeps the latest final card visible when 34 runs collapse their interrupted pairs', () => {
  const items: ExecutionItem[] = []
  for (let run = 0; run < 34; run++) {
    for (let attempt = 1; attempt <= 3; attempt++) for (const type of ['text', 'reasoning'] as const) items.push({ taskId: 't', runId: `run-${run}`, source: 'builtin', itemId: `round.attempt-${attempt}:${type}.delta`, type, time: items.length, sequence: items.length + 1, data: { status: attempt === 3 ? 'completed' : 'interrupted' }, content: [] })
    items.push({ taskId: 't', runId: `run-${run}`, source: 'builtin', itemId: 'final', type: 'text', time: items.length, sequence: items.length + 1, data: { label: `final-${run}` }, content: [{ kind: 'text', text: `final answer ${run}` }] })
    items.push({ taskId: 't', runId: `run-${run}`, source: 'builtin', itemId: 'end', type: 'run.end', time: items.length, sequence: items.length + 1, data: { status: 'completed' }, content: [] })
  }
  render(<ExecutionTimeline projection={{ conversationId: 'c', cursor: items.length, items }} />)
  expect(screen.getByText('final answer 33')).toBeTruthy()
})
it('CA-243 preserves ordinary paths, educational JSON values, public links and the full copied reply', async () => {
  const writeText = vi.fn(async () => {}); Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  const text = '成果：D:\\课程\\课件.html\n\n教学参数：{"token":"题目用词","password":"教学答案"}\n\n[教材](https://example.org/home/teacher/lesson)'
  render(<ExecutionTimeline projection={{ conversationId: 'raw-reply', cursor: 1, items: [{ taskId: 't', runId: 'r', source: 'builtin', itemId: 'reply', type: 'text', time: 1, sequence: 1, data: {}, content: [{ kind: 'text', text }] }] }} />)
  expect(screen.getByRole('link', { name: '教材' }).getAttribute('href')).toBe('https://example.org/home/teacher/lesson')
  expect(screen.getByText(/题目用词/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '复制内容' })); await waitFor(() => expect(writeText).toHaveBeenCalledWith(text))
})
it('CA-063 preserves native text paste when an embedded image is locally malformed', () => {
  const api = { snapshot: vi.fn(), cancel: async () => {}, release: async () => {} } as any
  render(<AttachmentComposer api={api} value={[]} onChange={() => {}}><textarea data-attachment-paste-target aria-label="input" /></AttachmentComposer>)
  expect(fireEvent.paste(screen.getByLabelText('input'), { clipboardData: { files: [], items: [], getData: (type: string) => type === 'text/html' ? '<p>正文</p><img src="data:image/png;base64,***">' : '有效正文' } })).toBe(true)
  expect(screen.getByRole('alert')).toBeTruthy()
})
it('CA-234 displays snapshot failure and removes that reference without needing its corrupt snapshot', async () => {
  const changed = vi.fn(), api = { snapshot: vi.fn(async () => { throw new Error('snapshot corrupt') }), cancel: async () => {}, release: async () => {} } as any
  render(<AttachmentComposer api={api} value={[{ attachmentId: 'bad-id', representationId: 'file' }]} onChange={changed} />)
  await screen.findByText('snapshot corrupt'); fireEvent.click(screen.getByRole('button', { name: '移除附件' }))
  expect(changed.mock.calls[0][0]).toEqual([])
})
it('CA-269 opens cached full material text without requiring the original file to be locatable', async () => {
  const record = { id: 'm', title: 'cached', text: '全文'.repeat(150), source: { kind: 'file', locator: 'gone.txt' } }
  const materials = vi.fn(async (request: any) => { if (request.operation === 'locate') throw new Error('original gone'); return [record] })
  const prior = window.desktopAPI; Object.defineProperty(window, 'desktopAPI', { value: { ...prior, materials }, configurable: true })
  try {
    render(<MaterialLibraryDialog projectId="p" projectPath="D:/fixture/p" onClose={() => {}} onInsert={async () => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: '查看原文' }))
    expect(screen.getByText(record.text)).toBeTruthy(); expect(materials).toHaveBeenCalledTimes(1)
  } finally { Object.defineProperty(window, 'desktopAPI', { value: prior, configurable: true }) }
})
it('CA-060 accepts an accurate custom model ID alongside a healthy catalog', async () => {
  const state = { connections: [{ connection: { id: 'c', revision: 1, provider: 'fixture', protocol: 'openai-chat',
    baseURL: 'https://fixture.invalid/v1', accountId: 'a', auth: { kind: 'api-key', credentialRef: 'fixture' }, billing: { kind: 'unknown' },
    capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } }, hasCredential: true, revoked: false }],
    secureStorageAvailable: true, profile: { revision: 1, updatedAt: '2026-10-11T00:00:00.000Z',
      roles: { conversation: { connectionId: 'c', model: 'catalog-model', parameters: {} }, vision: null, imageGenerate: null, imageEdit: null } } }
  const api = { read: vi.fn(async () => state), knownModels: vi.fn(async () => []),
    discoverModels: vi.fn(async () => ({ connectionId: 'c', connectionRevision: 1, models: [{ id: 'catalog-model' }], source: 'live',
      checkedAt: '2026-10-11T00:00:00.000Z', capabilitiesVerified: false })),
    saveProfile: vi.fn(async (input: any) => ({ ...state.profile, revision: 2, roles: input.roles })) } as any
  render(<ExecutionSettingsPanel open api={api} onClose={() => {}} />)
  await waitFor(() => expect(screen.getByLabelText('主力模型').querySelector('option[value="catalog-model"]')).toBeTruthy())
  fireEvent.change(screen.getByLabelText('自定义主力模型'), { target: { value: 'private-authoritative-alias' } })
  fireEvent.click(screen.getByRole('button', { name: '保存模型角色' }))
  await waitFor(() => expect(api.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ roles: expect.objectContaining({
    conversation: { connectionId: 'c', model: 'private-authoritative-alias', parameters: {} },
  }) })))
})
