import type { McpCallResult, McpDiscovery } from '../externalTools/McpClientService'
import type { EmbeddedBrowserViewport, EmbeddedBrowserViewportState } from '../../../shared/workbench/embeddedBrowser'

/** One backend instance owns exactly one task page. Human and automatic input address that page. */
export interface EmbeddedBrowserBackend {
  discover(writeAllowed: boolean): Promise<McpDiscovery>
  invoke(input: { operationId: string; name: string; arguments: Record<string, unknown>; signal?: AbortSignal }): Promise<McpCallResult>
  control(human: boolean): Promise<void>
  viewport(input: EmbeddedBrowserViewport): EmbeddedBrowserViewportState
  readResource(resourceId: string): Promise<{ mimeType: string; bytes: Uint8Array }>
  stop(): Promise<void>
}

export interface EmbeddedBrowserBackendOptions {
  runId: string
  scratch: string
  proxyUrl: string
  allowedUrl(url: string): boolean
  /** A page navigation invalidates observations held by the execution service. */
  onPageChanged(url: string): void
}

export type EmbeddedBrowserBackendFactory = (options: EmbeddedBrowserBackendOptions) => Promise<EmbeddedBrowserBackend>
