/**
 * Make the run's environment safe for the specs that launch Electron.
 *
 * Half of `tests/e2e/` is pure Chromium against exported HTML and never starts
 * Electron, so this deliberately clears rather than refuses: removing
 * `ELECTRON_RUN_AS_NODE` lets the eight Electron specs launch and costs the
 * eight browser-only specs nothing. An earlier version threw here instead, which
 * blocked the browser subset over a variable it does not care about.
 *
 * Global rather than per-spec because Playwright workers inherit this process's
 * environment, so one removal covers every spec without eight copies of it.
 */
import { prepareElectronLaunchEnvironment } from '../../scripts/electronLaunchEnvironment'

export default function globalSetup(): void {
  prepareElectronLaunchEnvironment()
}
