import { createContext, useContext, type ReactNode } from 'react'
import type { WorkspaceFilesAPI } from '../../shared/workbench/workspaceFiles'

export interface WorkspaceMediaSource {
  directory: string | null
  files: WorkspaceFilesAPI | null
}

const WorkspaceMediaSourceContext = createContext<WorkspaceMediaSource>({ directory: null, files: null })

export function WorkspaceMediaSourceProvider({ directory, files, children }: {
  directory: string | null
  files?: WorkspaceFilesAPI
  children: ReactNode
}) {
  return <WorkspaceMediaSourceContext.Provider value={{ directory, files: files ?? null }}>{children}</WorkspaceMediaSourceContext.Provider>
}

export function useWorkspaceMediaSource(): WorkspaceMediaSource {
  return useContext(WorkspaceMediaSourceContext)
}
