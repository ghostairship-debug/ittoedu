import type { BrowserWindow } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { AppState } from '../../src/main/appState'
import { APP_NAME } from '../../src/shared/constants'

describe('AppState window title', () => {
  it('keeps the native title fixed while retaining dirty state for close protection', () => {
    const window = { isDestroyed: vi.fn(() => false), setTitle: vi.fn() } as unknown as BrowserWindow
    const state = new AppState()

    state.setDirty(true)
    state.attachWindow(window)

    expect(state.isDirty()).toBe(true)
    expect(window.setTitle).toHaveBeenCalledExactlyOnceWith(APP_NAME)

    state.setDirty(false)
    expect(state.isDirty()).toBe(false)
    expect(window.setTitle).toHaveBeenCalledExactlyOnceWith(APP_NAME)
  })
})
