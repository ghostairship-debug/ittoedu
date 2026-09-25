export interface RevealInExplorerDetail {
  workspaceId?: string
  path: string
  kind: 'folder' | 'file'
}

export const REVEAL_IN_EXPLORER_EVENT = 'guoling:reveal-in-explorer'

export function dispatchRevealInExplorer(detail: RevealInExplorerDetail): void {
  window.dispatchEvent(new CustomEvent<RevealInExplorerDetail>(REVEAL_IN_EXPLORER_EVENT, { detail }))
}
