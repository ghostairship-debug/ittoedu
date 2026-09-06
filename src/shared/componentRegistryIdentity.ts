import { z } from 'zod'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'

const identity = z.string().min(1)
export const componentRegistryIdentityV1Schema = z.object({
  projectId: identity,
  packageId: identity,
  version: identity,
  sourceIdentity: identity,
  contentIdentity: identity,
}).strict()
export type ComponentRegistryIdentityV1 = z.infer<typeof componentRegistryIdentityV1Schema>

export function componentRuntimeSourceIdentity(source: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(source)))
}

export function componentRegistryKey(identity: ComponentRegistryIdentityV1): string {
  const parsed = componentRegistryIdentityV1Schema.parse(identity)
  return JSON.stringify([parsed.projectId, parsed.packageId, parsed.version, parsed.sourceIdentity, parsed.contentIdentity])
}
