import { useEffect, useRef } from 'react'
import type { ExecutionDocumentReference } from '../../shared/workbench/executionDesktop'
import type { ExternalMcpAPI, ExternalUiState } from '../../shared/workbench/external'

/** Answers Main's read-only "current workbench state" query for external AI sessions: space, foreground document and selection. */
export function useExternalUiStateProvider(api: ExternalMcpAPI | undefined, workspaceId: string,
  captureDocuments: (writable: boolean) => Promise<ExecutionDocumentReference[]>): void {
  const latest = useRef({ workspaceId, captureDocuments })
  latest.current = { workspaceId, captureDocuments }
  useEffect(() => api?.serveUiState?.(async (): Promise<ExternalUiState> => {
    const { workspaceId: space, captureDocuments: capture } = latest.current
    // Unfinished input or a view still loading only means there is no reportable foreground selection right now.
    const [reference] = await capture(false).catch(() => [])
    return { ...(space ? { workspaceId: space } : {}), ...(reference ? { activeDocumentId: reference.documentId } : {}),
      ...(reference?.selection ? { selection: { documentId: reference.documentId, targets: reference.selection } } : {}) }
  }), [api])
}
