import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PixabaySettingsSection } from '../../src/renderer/workbench/PixabaySettingsSection'
import type { PixabaySettingsAPI } from '../../src/shared/workbench/pixabaySettingsDesktop'

afterEach(cleanup)
it('shows default availability, saves a write-only optional key, clears it, and restores the default', async () => {
  const api: PixabaySettingsAPI = { read: vi.fn(async () => ({ hasUserKey: false, hasDefaultKey: true, secureStorageAvailable: true })),
    saveKey: vi.fn(async key => ({ hasUserKey: key !== null, hasDefaultKey: true, secureStorageAvailable: true })) }
  render(<PixabaySettingsSection api={api} />)
  await screen.findByText('当前使用果铃默认 key。')
  fireEvent.change(screen.getByLabelText('Pixabay 自有 API key'), { target: { value: 'user-fixture' } })
  fireEvent.click(screen.getByRole('button', { name: '保存 Pixabay key' }))
  await waitFor(() => expect(api.saveKey).toHaveBeenCalledWith('user-fixture'))
  await waitFor(() => expect(screen.getByLabelText('Pixabay 自有 API key')).toHaveValue(''))
  await screen.findByText('当前使用自有 key。')
  fireEvent.click(screen.getByRole('button', { name: '移除自有 key，使用默认' }))
  await waitFor(() => expect(api.saveKey).toHaveBeenCalledWith(null))
  await screen.findByText('当前使用果铃默认 key。')
})
