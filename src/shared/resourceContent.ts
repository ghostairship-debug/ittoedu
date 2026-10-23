import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'

/** Binary identity is independent of logical asset IDs, component paths and MIME labels. */
export function resourceContentSha256(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes))
}

/** Renderer/import/export callers keep native digest work off their JS thread.
 * The worker/Node fallback uses the identical content identity.
 */
export async function resourceContentSha256Async(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) return resourceContentSha256(bytes)
  const input = Uint8Array.from(bytes)
  return bytesToHex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', input.buffer)))
}

export interface ResourceContent {
  sha256: string
  bytes: Uint8Array
}

/** A single save/export's content index, over the existing immutable resource snapshot.
 * It does not own resources or change their logical identities.
 */
export function createResourceContentIndex() {
  const contents = new Map<string, ResourceContent>()
  return {
    add(bytes: Uint8Array): ResourceContent {
      const digest = resourceContentSha256(bytes)
      let content = contents.get(digest)
      if (!content) {
        content = { sha256: digest, bytes }
        contents.set(digest, content)
      }
      return content
    },
    values: () => contents.values(),
  }
}
