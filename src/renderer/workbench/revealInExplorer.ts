export interface RevealInExplorerDetail {
  workspaceId?: string
  path: string
  kind: 'folder' | 'file'
}

export const REVEAL_IN_EXPLORER_EVENT = 'guoling:reveal-in-explorer'

let pending: RevealInExplorerDetail | null = null

export function dispatchRevealInExplorer(detail: RevealInExplorerDetail): void {
  // Kept until an explorer takes it: a closed explorer opens on this event and reveals it once mounted.
  pending = detail
  window.dispatchEvent(new CustomEvent<RevealInExplorerDetail>(REVEAL_IN_EXPLORER_EVENT, { detail }))
}

export function takePendingReveal(): RevealInExplorerDetail | null {
  const detail = pending
  pending = null
  return detail
}
