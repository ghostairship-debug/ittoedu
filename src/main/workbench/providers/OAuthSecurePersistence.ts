import type { ChatGPTOAuthSecurePersistence } from './ChatGPTOAuthClient'
import type { ExecutionSettingsStore } from './ExecutionSettingsStore'

/** Uses the same atomic encrypted settings file and main-owned queues as all connection metadata. */
export function createOAuthSecurePersistence(store: ExecutionSettingsStore): ChatGPTOAuthSecurePersistence {
  return {
    read: ref => store.readOAuthCredential(ref),
    compareAndSet: (ref, version, credential) => store.compareAndSetOAuthCredential(ref, version, credential),
    withLease: (ref, operation) => store.withOAuthLease(ref, operation),
  }
}
