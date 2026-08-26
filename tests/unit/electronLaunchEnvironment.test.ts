import { describe, expect, it } from 'vitest'
import { assertElectronCanLaunchAsApp } from '../../scripts/electronLaunchEnvironment'

describe('assertElectronCanLaunchAsApp', () => {
  it('passes when nothing is holding Electron back', () => {
    expect(() => assertElectronCanLaunchAsApp({})).not.toThrow()
  })

  it('names the variable and how to clear it', () => {
    // The message is the whole point: Playwright only reports "Process failed to
    // launch!", so this text is the one place the reason can be stated.
    expect(() => assertElectronCanLaunchAsApp({ ELECTRON_RUN_AS_NODE: '1' }))
      .toThrow(/ELECTRON_RUN_AS_NODE/u)
    expect(() => assertElectronCanLaunchAsApp({ ELECTRON_RUN_AS_NODE: '1' }))
      .toThrow(/unset ELECTRON_RUN_AS_NODE/u)
  })

  it('treats the values a shell uses for "off" as absent', () => {
    // `ELECTRON_RUN_AS_NODE=` and `=0` both leave electron.exe an app, so
    // refusing to launch on them would block a usable environment.
    for (const value of ['', '0']) {
      expect(() => assertElectronCanLaunchAsApp({ ELECTRON_RUN_AS_NODE: value }), value)
        .not.toThrow()
    }
  })

  it('reads the real environment when given none', () => {
    // Production callers pass nothing; this is that path, asserted against
    // whatever this process actually has rather than a fixture.
    const blocked = process.env.ELECTRON_RUN_AS_NODE
    const expectation = expect(() => assertElectronCanLaunchAsApp())
    if (blocked !== undefined && blocked !== '' && blocked !== '0') expectation.toThrow()
    else expectation.not.toThrow()
  })
})
