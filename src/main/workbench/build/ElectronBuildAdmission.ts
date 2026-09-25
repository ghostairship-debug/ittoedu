import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { operateDynamicAdmission } from '../../dynamicAdmission'
import type { BuildAdmissionPort } from '../../../shared/workbench/build'

/** Fixed adapter to the same real Published/Player admission used by authored candidates. */
export function createElectronBuildAdmission(owner: WebContents, rendererEntryURL: string): BuildAdmissionPort {
  return { async run(payload, signal) {
    signal.throwIfAborted()
    const id = randomUUID()
    const cancel = () => { void operateDynamicAdmission({ operation: 'cancel', id }, owner, rendererEntryURL).catch(() => undefined) }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      const result = await operateDynamicAdmission({ operation: 'run', id, payload }, owner, rendererEntryURL)
      signal.throwIfAborted()
      return result
    } finally { signal.removeEventListener('abort', cancel) }
  } }
}
