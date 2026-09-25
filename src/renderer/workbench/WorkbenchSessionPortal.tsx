import { createContext, useContext, useState, type ReactNode } from 'react'
import type { ConversationHome } from '../../shared/workbench/conversations'

export type ConversationScope = Pick<ConversationHome, 'kind' | 'path' | 'workspaceId'> | null

const SessionDockContext = createContext<{
  target: HTMLElement | null
  setTarget(target: HTMLElement | null): void
  scope: ConversationScope
  setScope(scope: ConversationScope): void
} | null>(null)

/** One assistant owns conversation state; only its list is displayed in the workspace rail. */
export function WorkbenchSessionPortalProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [scope, setScope] = useState<ConversationScope>(null)
  return <SessionDockContext.Provider value={{ target, setTarget, scope, setScope }}>{children}</SessionDockContext.Provider>
}

export function WorkbenchSessionDock() {
  const context = useContext(SessionDockContext)
  return <div className="workbench-session-dock" ref={context?.setTarget} />
}

export function useWorkbenchSessionDock() {
  const context = useContext(SessionDockContext)
  return { target: context?.target ?? null, inWorkspace: Boolean(context), scope: context?.scope ?? null, setScope: context?.setScope }
}
