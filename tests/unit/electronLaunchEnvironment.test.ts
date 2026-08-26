import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareElectronLaunchEnvironment } from '../../scripts/electronLaunchEnvironment'

afterEach(() => {
  vi.restoreAllMocks()
})

/** The warning is expected on every clearing path; keep it out of the report. */
function silenceWarning(): void {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
}

describe('prepareElectronLaunchEnvironment', () => {
  it('leaves a clean environment untouched', () => {
    const environment = { PATH: '/usr/bin' }
    expect(prepareElectronLaunchEnvironment(environment)).toEqual([])
    expect(environment).toEqual({ PATH: '/usr/bin' })
  })

  it('removes the variable at every value that degrades Electron', () => {
    // Measured against the pinned Electron 43.1.1: unset reports v43.1.1, while
    // '', '0', '1' and 'false' all report Node's v24.18.0. Presence is what
    // breaks the launch, so the shell conventions for "off" have to be removed
    // too -- treating them as absent was a false negative in the only check
    // between a sandboxed shell and an unreadable launch failure.
    for (const value of ['', '0', '1', 'false']) {
      silenceWarning()
      const environment: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: value, PATH: '/usr/bin' }
      expect(prepareElectronLaunchEnvironment(environment), JSON.stringify(value))
        .toEqual(['ELECTRON_RUN_AS_NODE'])
      expect(environment, JSON.stringify(value)).toEqual({ PATH: '/usr/bin' })
      expect('ELECTRON_RUN_AS_NODE' in environment, JSON.stringify(value)).toBe(false)
    }
  })

  it('says what it removed, so the repair is not silent', () => {
    silenceWarning()
    prepareElectronLaunchEnvironment({ ELECTRON_RUN_AS_NODE: '1' })
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(vi.mocked(console.warn).mock.calls[0]![0]).toContain('ELECTRON_RUN_AS_NODE')
  })

  it('is idempotent, so entry points may each call it', () => {
    silenceWarning()
    const environment: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1' }
    expect(prepareElectronLaunchEnvironment(environment)).toEqual(['ELECTRON_RUN_AS_NODE'])
    expect(prepareElectronLaunchEnvironment(environment)).toEqual([])
  })

  it('defaults to this process, which is what production callers use', () => {
    silenceWarning()
    prepareElectronLaunchEnvironment()
    expect(process.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })
})
