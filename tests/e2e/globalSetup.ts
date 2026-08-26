/**
 * One environment check for the whole e2e run.
 *
 * Every spec under `tests/e2e/` launches Electron, so the check belongs here
 * rather than repeated in each `beforeAll` — and failing during global setup
 * reports the reason once instead of once per spec.
 */
import { assertElectronCanLaunchAsApp } from '../../scripts/electronLaunchEnvironment'

export default function globalSetup(): void {
  assertElectronCanLaunchAsApp()
}
