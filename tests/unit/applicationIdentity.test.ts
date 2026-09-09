// @vitest-environment node

import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  configureApplicationStorage,
  REBUILD_USER_DATA_DIRECTORY_NAME,
} from '../../src/main/applicationIdentity'

describe('application identity storage', () => {
  it('uses an isolated rebuild directory below the platform app-data root', () => {
    const setPath = vi.fn()
    const getPath = vi.fn((name: 'appData' | 'userData') =>
      name === 'appData'
        ? path.join('C:', 'Users', 'teacher', 'AppData', 'Roaming')
        : 'unused',
    )

    const result = configureApplicationStorage(
      { getPath, setPath },
      ['electron', '.'],
    )

    const expected = path.join(
      'C:',
      'Users',
      'teacher',
      'AppData',
      'Roaming',
      REBUILD_USER_DATA_DIRECTORY_NAME,
    )
    expect(result).toBe(expected)
    expect(setPath).toHaveBeenCalledOnce()
    expect(setPath).toHaveBeenCalledWith('userData', expected)
  })

  it('preserves an explicit user-data-dir for isolated tests and tooling', () => {
    const setPath = vi.fn()
    const getPath = vi.fn((name: 'appData' | 'userData') =>
      name === 'userData' ? path.join('D:', 'isolated-profile') : 'unused',
    )

    const result = configureApplicationStorage(
      { getPath, setPath },
      ['electron', '.', '--user-data-dir=D:\\isolated-profile'],
    )

    expect(result).toBe(path.join('D:', 'isolated-profile'))
    expect(setPath).toHaveBeenCalledExactlyOnceWith('userData', path.join('D:', 'isolated-profile'))
    expect(getPath).not.toHaveBeenCalled()
  })

  it('accepts the separate explicit user-data-dir argument form', () => {
    const setPath = vi.fn()
    const getPath = vi.fn()

    const result = configureApplicationStorage(
      { getPath, setPath },
      ['electron', '.', '--user-data-dir', 'D:\\isolated-profile'],
    )

    expect(result).toBe(path.join('D:', 'isolated-profile'))
    expect(setPath).toHaveBeenCalledExactlyOnceWith('userData', path.join('D:', 'isolated-profile'))
    expect(getPath).not.toHaveBeenCalled()
  })

  it.each([
    ['without a following value', ['electron', '.', '--user-data-dir']],
    ['with an empty equals value', ['electron', '.', '--user-data-dir=']],
    ['when the following token is another switch', ['electron', '.', '--user-data-dir', '--other-switch']],
  ])('rejects an explicit user-data-dir %s', (_case, argv) => {
    const setPath = vi.fn()
    const getPath = vi.fn()

    expect(() => configureApplicationStorage({ getPath, setPath }, argv)).toThrow('Missing value for --user-data-dir')
    expect(setPath).not.toHaveBeenCalled()
    expect(getPath).not.toHaveBeenCalled()
  })
})
