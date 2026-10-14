import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SearchSettingsSection } from '../../src/renderer/workbench/SearchSettingsSection'
import type { ExecutionSettingsAPI } from '../../src/shared/workbench/executionSettingsDesktop'
import type { ExecutionSettingsView } from '../../src/shared/workbench/executionSettings'
afterEach(cleanup)
it('saves only search preferences through the same profile revision and displays tested source links and fallback diagnostics', async () => {
  const settings: ExecutionSettingsView = { connections: [], secureStorageAvailable: false, profile: { revision: 7, updatedAt: '2026-10-12T00:00:00Z', roles: { conversation: null, vision: null, imageGenerate: null, imageEdit: null } } }
  const saved = vi.fn(), saveProfile = vi.fn(async () => settings.profile), testSearch = vi.fn(async () => ({ status: 'results' as const, query: 'q', searchedAt: 'now', provider: 'exa-mcp', results: [{ title: 'Official source', url: 'https://example.com', snippet: '' }], diagnostics: ['OpenAI 原失败'], attempts: [{ provider: 'exa-mcp', outcome: 'completed' as const }] }))
  const api = { saveProfile, read: async () => settings, testSearch } as unknown as ExecutionSettingsAPI
  render(<SearchSettingsSection settings={settings} api={api} onSaved={saved} />)
  fireEvent.change(screen.getByLabelText('搜索方式'), { target: { value: 'independent' } })
  fireEvent.click(screen.getByRole('button', { name: '保存搜索设置' }))
  await waitFor(() => expect(saved).toHaveBeenCalled())
  expect(saveProfile).toHaveBeenCalledWith({ expectedRevision: 7, roles: settings.profile.roles, search: { mode: 'independent', independent: 'exa', searxngURL: '', openai: null, deepseek: null } })
  fireEvent.change(screen.getByLabelText('搜索测试词'), { target: { value: 'q' } })
  fireEvent.click(screen.getByRole('button', { name: '测试搜索' }))
  const source = await screen.findByRole('link', { name: 'Official source' })
  expect(source.getAttribute('href')).toBe('https://example.com')
  expect(screen.getByText('OpenAI 原失败')).toBeTruthy()
  expect(testSearch).toHaveBeenCalledWith('q')
})
