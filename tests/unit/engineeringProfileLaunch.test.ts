// @vitest-environment node

import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { resolveEngineeringProfileLaunch } from '../../scripts/engineeringProfileLaunch'

const appData = path.join('C:', 'Users', 'teacher', 'AppData', 'Roaming')
const profile = path.join(appData, 'Guoling-2.0-engineering-oauth')
const settings = path.join(profile, 'workbench-v2', 'settings', 'execution-settings-v1.json')

describe('explicit engineering profile launch', () => {
  it('leaves ordinary launches untouched', () => {
    const fileExists = vi.fn(() => false)
    expect(resolveEngineeringProfileLaunch(['.', '--remote-debugging-port=9337'], {}, fileExists)).toEqual({
      args: ['.', '--remote-debugging-port=9337'],
      profile: null,
    })
    expect(fileExists).not.toHaveBeenCalled()
  })

  it('points explicitly selected launches at the existing configured profile', () => {
    const fileExists = vi.fn((file: string) => file === settings)
    expect(resolveEngineeringProfileLaunch(['.', '--engineering-oauth-profile'], { APPDATA: appData }, fileExists)).toEqual({
      args: ['.', `--user-data-dir=${profile}`],
      profile,
    })
    expect(fileExists).toHaveBeenCalledExactlyOnceWith(settings)
  })

  it('fails instead of falling back to a fresh or conflicting profile', () => {
    expect(() => resolveEngineeringProfileLaunch(['.', '--engineering-oauth-profile'], { APPDATA: appData }, () => false)).toThrow('未配置')
    expect(() => resolveEngineeringProfileLaunch(['.', '--engineering-oauth-profile'], {}, () => true)).toThrow('APPDATA')
    expect(() => resolveEngineeringProfileLaunch(['.', '--engineering-oauth-profile', '--user-data-dir=other'], { APPDATA: appData }, () => true)).toThrow('不能与另一个')
  })
})
