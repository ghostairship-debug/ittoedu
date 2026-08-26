export interface PreviewNetworkLeaseInput {
  leaseId: string
  connectOrigins: readonly string[]
  remoteAssetUrls: readonly string[]
}

export interface PreviewNetworkDocumentOwner {
  processId: number
  frameToken: string
  documentToken: string
}

const CONNECT_PROTOCOLS = new Set(['https:', 'wss:'])
const BASE_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:'])

function exactOrigin(value: string, protocols: ReadonlySet<string>): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Invalid network origin: ${value}`)
  }
  if (
    !protocols.has(url.protocol)
    || url.username !== ''
    || url.password !== ''
    || url.hostname.includes('*')
    || url.pathname !== '/'
    || url.search !== ''
    || url.hash !== ''
    || url.origin !== value
  ) {
    throw new Error(`Network origin must be exact: ${value}`)
  }
  return url.origin
}

function remoteAssetOrigin(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Invalid remote asset URL: ${value}`)
  }
  if (
    url.protocol !== 'https:'
    || url.username !== ''
    || url.password !== ''
    || url.hostname.includes('*')
  ) {
    throw new Error(`Remote asset URL must use credential-free HTTPS: ${value}`)
  }
  return url.origin
}

function requestOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return null
    return url.origin
  } catch {
    return null
  }
}

function previewOrigins(input: PreviewNetworkLeaseInput): Set<string> {
  const origins = new Set<string>()
  for (const value of input.connectOrigins) {
    origins.add(exactOrigin(value, CONNECT_PROTOCOLS))
  }
  for (const value of input.remoteAssetUrls) origins.add(remoteAssetOrigin(value))
  return origins
}

/**
 * Mutable main-session network policy. The webRequest handler keeps one stable
 * reference to this object while preview leases are replaced and released.
 */
export class PreviewNetworkPolicy {
  readonly #baseOrigins = new Set<string>()
  readonly #previewLeases = new Map<string, ReadonlySet<string>>()
  #activeDocumentOwner: PreviewNetworkDocumentOwner | null = null

  replaceBaseOrigins(values: Iterable<string>): void {
    const next = new Set<string>()
    for (const value of values) {
      next.add(exactOrigin(value, BASE_PROTOCOLS))
    }
    this.#baseOrigins.clear()
    next.forEach((origin) => this.#baseOrigins.add(origin))
  }

  beginDocumentNavigation(): void {
    this.#activeDocumentOwner = null
    this.#previewLeases.clear()
  }

  activateDocument(owner: PreviewNetworkDocumentOwner): void {
    if (
      !Number.isInteger(owner.processId)
      || owner.processId < 0
      || owner.frameToken.length === 0
      || owner.documentToken.length === 0
    ) {
      throw new Error('Preview network document owner is invalid')
    }
    this.#activeDocumentOwner = { ...owner }
    // The committed document starts without leases, even if a navigation-start
    // event raced an IPC queued by the document it replaced.
    this.#previewLeases.clear()
  }

  replacePreviewLease(
    input: PreviewNetworkLeaseInput,
    owner: PreviewNetworkDocumentOwner,
  ): void {
    this.#assertActiveDocument(owner)
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(input.leaseId)) {
      throw new Error('Preview network lease id is invalid')
    }
    // Validate the complete replacement before changing the effective policy.
    const next = previewOrigins(input)
    this.#previewLeases.set(input.leaseId, next)
  }

  releasePreviewLease(leaseId: string, owner: PreviewNetworkDocumentOwner): void {
    this.#assertActiveDocument(owner)
    this.#previewLeases.delete(leaseId)
  }

  clearPreviewLeases(): void {
    this.#previewLeases.clear()
  }

  allowsRequest(value: string): boolean {
    const origin = requestOrigin(value)
    if (origin === null) return false
    if (this.#baseOrigins.has(origin)) return true
    for (const origins of this.#previewLeases.values()) {
      if (origins.has(origin)) return true
    }
    return false
  }

  #assertActiveDocument(owner: PreviewNetworkDocumentOwner): void {
    if (
      this.#activeDocumentOwner === null
      || this.#activeDocumentOwner.processId !== owner.processId
      || this.#activeDocumentOwner.frameToken !== owner.frameToken
      || this.#activeDocumentOwner.documentToken !== owner.documentToken
    ) {
      throw new Error('Preview network policy source is not the active document')
    }
  }

}

export const mainPreviewNetworkPolicy = new PreviewNetworkPolicy()
